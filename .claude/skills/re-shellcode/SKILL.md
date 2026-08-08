---
name: re-shellcode
description: >
  Shellcode 分析：提取、解码循环、模拟执行。
  触发词：shellcode、shell code、位置无关、解码循环、恶意载荷
---

# Shellcode 分析

## 何时使用 / 何时不用

- 用：拿到的是"裸代码 blob"（无 PE/ELF/Mach-O 文件头）——漏洞利用载荷、文档/脚本解出的第二层载荷、释放器写进内存的代码
- 用：载荷带自解码（XOR/ROL 解码循环、msfvenom 类编码器生成）——静态看是乱码，需要先还原再分析
- 用：需要"无环境跑起来"验证载荷行为（架构不匹配/无宿主进程/不想在真实进程触发）——Unicorn 模拟
- 用：回答"这段代码调用哪些 API、想干什么"（API hash 解析）
- 不用：有文件格式头的完整程序（那是 [[re-binary-core]] 域）
- 不用：只需初勘结论（file/hash/熵，那是 [[re-triage]]）
- 注意：模拟执行属动态执行，默认在沙箱内进行（[[platform-tips]] 最高原则）；纯静态提取/解码分析可免沙箱，但把解码产物落盘后真实执行验证时必须进 [[re-sandbox]]

## 工具准备

所有工具先验证再使用。本技能静态解码可免沙箱；模拟执行默认沙箱内进行（[[platform-tips]] 最高原则）。

### python3 —— 解码/模拟脚本运行环境

- Linux: `apt install python3 python3-pip` / `dnf install python3 python3-pip` / `pacman -S python python-pip`（多数自带）
- macOS: `brew install python`（或 Xcode CLT 自带）；Windows: python.org 安装包（勾选 Add to PATH）或 `choco install python`；WSL 内 Linux 版
- 验证: `python3 --version`

### unicorn —— 模拟执行主力（pip，Python 3）

- 全平台: `pip install unicorn`（Python 3）
- 验证: `python3 -c "import unicorn; print(unicorn.__version__)"`

### capstone —— 反汇编输出（pip，Python 3）

- 全平台: `pip install capstone`
- 验证: `python3 -c "import capstone; print(capstone.__version__)"`

### binwalk —— 从宿主文件里扫出嵌入 blob

- Linux: `apt install binwalk` / `dnf install binwalk` / `pacman -S binwalk`
- macOS: `brew install binwalk`
- Windows: WSL 内 Linux 版（或 GitHub release 预编译 exe）
- 验证: `binwalk --help`

### xxd —— 十六进制查看/特征定位

- Debian/Ubuntu: `apt install xxd`（新版独立包，旧版在 vim-common）；Fedora: `dnf install xxd`（F38+ 独立子包，旧版 vim-common）；Arch: `pacman -S xxd`
- macOS: 自带（vim 附送）；Windows: 无自带——用 WSL 或 PowerShell `Format-Hex`
- 验证: `xxd -v`

### objdump（binutils）—— 裸二进制反汇编扫描

- Linux: `apt install binutils` / `dnf install binutils` / `pacman -S binutils`（多数发行版预装）
- macOS: 自带；Windows: 用 rizin 或 Ghidra 替代
- 验证: `objdump --version`

### 反汇编器 —— 按 `RE_DECOMPILER` 或环境选

- [[re-radare2]]（rizin，命令行/低内存，Raw Binary 支持好，推荐）；[[re-ghidra]]（GUI，Import File → Raw Binary 选架构）
- 安装与验证见对应技能工具准备

### scdbg —— 可选（shellcode 调试器）

- GitHub 检索 `Nypreo/scdbg` releases 下载（Windows 可执行文件；Linux 可在 Wine 下运行，或直接用 Unicorn 方案替代）
- 验证: `scdbg.exe -f blob.bin` 能输出反汇编与模拟结果

### msfvenom —— 可选（生成对照样本/编码器特征参考）

- Kali: 预装（`apt install metasploit-framework`）；Fedora: 添加 Rapid7 RPM 仓库后 `dnf install metasploit-framework`；Arch: `pacman -S metasploit`（extra 仓库，6.x）
- 验证: `msfvenom -l encoders | head -5`（msfvenom 可独立使用，不依赖 msfconsole 的 PostgreSQL）
- 用途: 用已知编码器（如 `x86/shikata_ga_nai`）生成样本，对照解码循环指令形态

## 操作步骤

按顺序执行，每步产物（blob/解码结果/模拟输出）存档 sha256 + 路径（[[re-ioc]] 证据链要求）。

1. **提取 shellcode blob（文件/内存/流量三来源）**：
   ```sh
   # 文件内嵌: 从宿主文件里扫嵌入段
   binwalk sample.bin
   binwalk -e sample.bin                    # 按签名自动提取
   # 定长段提取（已知偏移）:
   dd if=sample.bin of=blob.bin bs=1 skip=<off> count=<len>
   # ELF .text 段导出（载荷伪装成代码段时）:
   objcopy --dump-section .text=blob.bin sample.elf
   # 内存: 沙箱内 gcore 转储后按特征找（见 [[re-memdump]]）
   # 流量: tshark 提取 pcap 中的载荷字节（见 [[re-netcap]]）
   tshark -r c2.pcap -Y 'http' -T fields -e http.file_data > payload.hex
   xxd -r -p payload.hex blob.bin
   ```
   - 提取原则: 先确认边界再提取——多提比少提好（入口在 blob 内部），边界不确定时先按 0xEB 短跳/解码循环跨度扩展范围
   - 三来源共性: 载荷常被宿主"加工"过（编码/切块/重排）——提取出的 blob 先 `file blob.bin` + 熵判断，乱码先假设有解码层（步骤 3）

2. **定位入口（0xEB 短跳 / 反汇编扫描）**：
   ```sh
   xxd blob.bin | head -20                   # 头部特征
   # 入口候选: 首字节 0xEB（jmp short，跳到解码器）、0xE8（call，自定位取 EIP）
   objdump -D -b binary -m i386 blob.bin | head -40     # 32 位 x86 裸反汇编
   objdump -D -b binary -m i386:x86-64 blob.bin | head -40   # 64 位
   ```
   - 常见入口模式: ① `EB xx` 短跳（跳到解码循环，入口前留解码器空间）② `E8 00 00 00 00` + `pop reg`（call/pop 自定位，拿当前 EIP）③ 解码循环直接开头
   - rizin 侧: `rizin -a x86 -b 32 blob.bin` 进入后 `s <候选偏移>` + `pd 20` 逐段看（见 [[re-radare2]]）；Ghidra 导入选 Raw Binary（x86:LE:32:default），在候选入口 `L` 标函数
   - 定位判据: 入口处应为"自定位 + 解码循环 + 跳转解码后代码"结构；反汇编有意义的指令序列才算入口，全乱码先走步骤 3 解码再回来

3. **解码循环分析（XOR/ROL 自解码）**：
   ```sh
   # 特征指令（反汇编中找）:
   #   XOR byte ptr [reg+disp], imm    单字节 XOR 解码
   #   ROL/ROR byte ptr [reg], imm     循环移位解码
   #   ADD/SUB byte ptr [reg], imm     加减常量解码
   #   LOOP / JECXZ                    循环控制（计数在 ECX/RCX）
   ```
   - 静态还原: 从反汇编提取解码参数（key 字节/移位量/长度/起点）→ python 复刻:
     ```python
     data = bytearray(open('blob.bin','rb').read())
     key, start, length = 0x55, 0x00, len(data)   # 参数来自反汇编
     for i in range(start, start + length):
         data[i] ^= key
     open('decoded.bin','wb').write(data)
     ```
   - 还原后回步骤 2 重新定位入口——解码后的 blob 才是要分析的载荷（编码器可能还有第二层）
   - 对照验证: msfvenom 用 `x86/xor_dynamic` 等编码器生成样本，比较解码循环指令形态，确认识别没走偏（见坑 2）

4. **模拟执行（Unicorn 无环境运行、hook 系统调用）**：
   ```python
   from unicorn import *
   from unicorn.x86_const import *
   blob = open('blob.bin','rb').read()
   mu = Uc(UC_ARCH_X86, UC_MODE_32)          # 按步骤 2 确认的架构选模式
   CODE, STACK = 0x1000, 0x3000
   mu.mem_map(CODE, 0x1000); mu.mem_map(STACK, 0x1000)
   mu.mem_write(CODE, blob)
   mu.reg_write(UC_X86_REG_ESP, STACK + 0x800)     # 设栈（不设必崩）
   def hook_code(uc, addr, size, user):
       if addr in API_ADDRS:                  # 步骤 5 定位的 API 调用点
           uc.reg_write(UC_X86_REG_EIP, addr + size)  # 跳过 stub
           print("hit api", hex(addr))
   mu.hook_add(UC_HOOK_CODE, hook_code)
   try:
       mu.emu_start(CODE, 0x100000)           # until 给大上限，非法访问即终止
   except UcError as e:
       print("stop:", e)                      # 缺 API/越界 = 预期终止点
   open('decoded.bin','wb').write(mu.mem_read(CODE, len(blob)))   # 解码产物
   ```
   - 让解码循环"自己跑"比手工还原快且准（坑 3 的对策）；`hook_mem_write` 可记录解码产物落点（见 [[re-emulation]] 步骤 4）
   - 系统调用/API 处理: Unicorn 无 OS——先反汇编列出所有 call 目标，对已知 API 调用点 hook 返回假值并记录参数（stub 化，见步骤 5 与坑 4）

5. **与宿主交互面（API 解析：kernel32 遍历、hash 查找）**：
   - Windows shellcode 拿 API 的标准手法: PEB → PEB_LDR_DATA → 模块链表遍历到 kernel32.dll → 导出表按名字 hash 查找（GetProcAddress 的 shellcode 等价物）
   - 静态定位 API 集合: 反汇编找"push 4 字节常量; ...; call"模式，4 字节即 API 名 hash；用常见 hash 算法穷举对照:
     ```python
     def djb2(s):
         h = 5381
         for c in s:
             h = ((h << 5) + h + c) & 0xffffffff
         return h
     for name in ['LoadLibraryA','VirtualAlloc','VirtualProtect',
                  'WriteProcessMemory','CreateThread','WinExec']:
         print(name, hex(djb2(name.encode())))
     ```
   - 还原调用约定: 先确定位数/调用约定（Win32 默认 stdcall、x64 默认 fastcall）——决定参数寄存器/栈顺序与返回值位置（坑 3）
   - API 集合 = 行为意图: VirtualAlloc/VirtualProtect + WriteProcessMemory → 注入；CreateThread/CreateRemoteThread → 执行；WinExec/CreateProcess → 运行程序——直接对应 [[re-behavior]] 的 ATT&CK 映射（T1055 进程注入等）
   - 模拟 stub: 把 API 调用点加入 hook_code 的 API_ADDRS，按功能返回假值（如 VirtualAlloc 返回一块已映射内存地址），观察控制流走向

## 跨域联合

- [[re-binary-core]]：本技能是该网关的载荷分支——无文件格式头的裸代码 blob 专项分析；反编译底座复用 [[re-radare2]] / [[re-ghidra]]
- [[re-emulation]]：模拟执行框架与 hook 技巧（本技能步骤 4 直接复用其步骤 2-4）
- [[re-radare2]]：Raw Binary 反汇编、入口扫描（[[re-ghidra]] 同效，按 `RE_DECOMPILER` 选）
- [[re-memdump]]：从进程内存提取 shellcode（默认转储优先，gcore 后按特征找 blob）
- [[re-malware]]：恶意样本载荷层——加载器/无文件样本的解码载荷走到本技能
- [[re-anti-analysis]]：带壳/混淆样本里摘出的载荷段（脱壳产物回到本技能分析）
- [[re-triage]]：提取前初勘（file/熵判断有无编码层）
- 引用 [[platform-tips]] 最高原则（沙箱）与「静态优先」原则（先静态定位，动态按需）

## 常见坑与陷阱

- **位置无关地址（无基址概念）**：现象——Ghidra/objdump 反汇编出来跳转/数据引用全是"乱"地址，按虚拟地址分析对不上；原因——shellcode 无 PE/ELF 头、无固定基址，位置无关代码用相对偏移和 call/pop 自定位，偏移而非绝对地址才是真相；对策——按 blob 内偏移分析（rizin `s <偏移>`、xref 看相对偏移），Ghidra 用 Raw Binary 导入并从候选入口标函数，别拿绝对地址对齐
- **编码器变体（msfvenom 多种编码）**：现象——入口定位后反汇编全是垃圾字节，找不到"正常代码"；原因——载荷是编码器生成（shikata_ga_nai/xor_dynamic 等），解码循环执行前一切都是密文；对策——先找解码循环（XOR/ROL 特征指令 + LOOP），用步骤 4 模拟执行直接让它自己解码，或用 msfvenom 生成同编码器对照样本确认指令形态；shikata_ga_nai 的 key 是动态插入的，静态 key 还原法会失效——模拟执行是首选
- **宿主依赖（需先还原调用约定）**：现象——模拟执行到某处行为怪异/栈错乱/返回值不对；原因——shellcode 设计为在宿主进程内运行，假定宿主已初始化（已加载 DLL 基址、栈对齐、调用约定）；对策——先确定位数与调用约定再 stub（32 位 stdcall 参数在栈上、64 位 fastcall 在 rcx/rdx/r8/r9），栈页按宿主近似布局初始化，API 按签名返回合理值
- **模拟执行缺 API（stub）**：现象——Unicorn 执行到 `call kernel32...` 或 `syscall` 时 UcError 终止，控制流走不下去；原因——Unicorn 无 OS，内核与 DLL 都不存在；对策——步骤 5 先解析 API hash 还原真实 API 集合，按功能 stub（hook 调用点返回假值 + 记录参数），必要时 hook_mem 补内存映射（VirtualAlloc 返回的"新页"先 mem_map 好）
