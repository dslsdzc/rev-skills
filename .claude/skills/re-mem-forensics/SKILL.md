---
name: re-mem-forensics
description: >
  Volatility 3 内存取证：进程/内核对象/网络/凭据线索。
  触发词：内存取证、Volatility、memdump分析、进程列表、mimikatz线索
---

# 内存取证（Volatility 3）

## 何时使用 / 何时不用

- 用：拿到 .raw/.mem/.core 内存转储做取证（进程列表、网络连接、注入检测、凭据哈希）；恶意样本内存残留分析；事件响应调查
- 用：取证要求可追溯的时间线（进程/网络/注册表事件序列，配合 timeliner）
- 不用：还没有转储——先按 [[re-memdump]] 取（默认转储优先，见 [[platform-tips]]「直读 vs 转储」决策表）
- 不用：实时交互调试（那是 [[re-gdb]] / [[re-x64dbg]] 的活）；文件系统/注册表静态分析（那是 [[re-binary-core]] / 主机取证工具）

## 工具准备

本技能只读转储文件、不运行样本；涉及动态确认的转 [[re-sandbox]]（默认沙箱最高原则，见 [[platform-tips]]）。

### volatility3 —— 内存取证主力（Python 3.8-3.11）

- 全平台: `pip install volatility3`（命令为 `vol`）；官方要求 **Python 3.8+**（README 表述），2026 实测 2.28.0 在 Python 3.14 可安装且插件正常加载——先 `python3 --version` 确认，版本不匹配用 pyenv/venv 建对应环境再装
- Windows/WSL: 同上 pip 方案（WSL 内可分析 Windows dump，见 [[platform-tips]] WSL 分支）
- 验证: `vol -h`；`vol -f dump.raw windows.info` 能输出镜像信息且不报符号错误
- 符号文件：首次运行对应插件时从 https://downloads.volatilityfoundation.org/ 下载符号表（Linux 为 `linux/` 下对应内核版本），网络受限或下载失败时用 `--offline` + 预置符号目录，否则插件报 MissingSymbol 类错误
- 依赖补充：凭据类插件（hashdump/lsadump/cachedump）需要 pycryptodome、yarascan 需要 yara-python——2026 实测 2.28.0 缺这两依赖时对应插件加载失败（`vol --help` 里直接缺失），装完 `pip install pycryptodome yara-python` 重试

### 7zip（可选，解 .7z 压缩转储）

- Linux: `apt install p7zip-full` / `dnf install p7zip-plugins` / `pacman -S p7zip`
- macOS: `brew install p7zip`
- Windows: 7-Zip 官网安装
- 验证: `7z --help`

### 工具包补充（按平台）

- Windows dump 建议同时备 Sysinternals（procdump/DumpIt 取 dump 用，见 [[platform-tips]] Windows 分支）
- 深度提取 `vol -f dump.raw windows.dumpfiles` 出的可疑对象，用 [[re-ghidra]] / [[re-ida]] 分析

## 操作步骤

按顺序执行，每步产物存档（路径 + sha256 + 时间戳，取证要求）。

1. **确认 dump 来源与架构**：
   ```sh
   file dump.raw          # 确认是内存转储（MEMORY_IMAGE 头 / crash dump），不是别的文件
   vol -f dump.raw windows.info    # Windows 镜像信息；Linux/macOS 无 info 插件——直接跑对应平台插件验证（如 linux.pslist / mac.pslist，符号表就位才正常输出）
   ```
   - 按转储来源选平台前缀：Windows 用 `windows.*`、macOS 用 `mac.*`、Linux 用 `linux.*`；volatility3 自动识别 profile（相比 vol2 手选 profile 已简化），但首次运行需下载对应符号文件（见工具准备）
   - 输入格式：raw 镜像（主格式）、LiME（lime 层自动识别）、Windows crash dump（crash 层）；VMware .vmem（vol 内置 vmware 层自动识别，可直接 `-f`）；休眠文件（hiberfil.sys）无内置层——先转 raw 或专用工具处理
   - 进程级转储（[[re-memdump]] 的 gcore 是单进程 ELF core，非整机镜像）Volatility 无法解析——用 gdb/eu-stack 复盘（见 [[re-memdump]] 步骤 3），本技能只处理整机镜像

2. **进程列表**：
   ```sh
   vol -f dump.raw windows.pslist            # 常规进程列表（含 PID/PPID/时间戳）
   vol -f dump.raw windows.psscan            # 池扫描，能发现已终止/隐藏进程
   vol -f dump.raw windows.pstree            # 进程树，看父子关系异常（如 IE 生成了 cmd）
   ```
   - 记下可疑 PID：父进程不匹配（浏览器 spawn 出 powershell）、常见白名单进程名/路径异常（`svchost.exe` 不在 `C:\Windows\System32`）
   - 已终止进程用 psscan 找，别只信 pslist
   - 补充插件：`windows.cmdline` 看进程命令行（混淆的 powershell -enc 参数）、`windows.svcscan` 服务列表（异常服务常是持久化）、`windows.sessions` 会话与桌面归属

3. **网络连接**：
   ```sh
   vol -f dump.raw windows.netscan           # 网络连接/监听（TCP/UDP，含已关闭连接）
   vol -f dump.raw windows.netstat           # 备用：通过流表/相关对象推断
   ```
   - 记录：本地/远程 IP:端口、所属进程 PID、连接状态；异常外连（非 53/80/443 的高端口、境外 IP）是 C2 线索，进 IOC 列表（衔接 [[re-ioc]]）

4. **注入/异常检测**：
   ```sh
   vol -f dump.raw windows.dlllist -p <pid>  # 进程模块列表，看路径异常（%TEMP%、AD 区）
   vol -f dump.raw windows.malfind           # 扫描隐藏/注入的可执行内存（MEM_COMMIT + PAGE_EXECUTE_READWRITE 等）
   vol -f dump.raw windows.hollowprocesses   # 进程镂空检测（替代合法性）
   ```
   - malfind 命中后 `--dump` 导出可疑区段（`vol -f dump.raw windows.malfind --dump --pid <pid>`），提取出的对象存 sha256，转 [[re-binary-core]] 静态深挖
   - malfind 有误报（见坑 3）——用 dlllist 路径与执行页权限交叉确认

5. **凭据线索与可疑对象提取**：
   ```sh
   vol -f dump.raw windows.hashdump          # 本地账户 NT/LM 哈希（SAM 缓存）
   vol -f dump.raw windows.lsadump           # LSA 凭据（缓存密码/域凭据，mimikatz 同源线索）
   vol -f dump.raw windows.cachedump         # 域缓存凭据
   ```
   - hashdump/lsadump 命中即凭据泄露证据，记录来源（Lsass 内存）与时间戳；离线破解交给 hashcat/john 等密码工具，本技能不破解
   - 提取可疑对象：`windows.dumpfiles`（指定文件）或 malfind/pslist `--dump`（`vol -f dump.raw windows.pslist --dump --pid <pid>` 导出进程内存）；每个对象算 sha256 存档
   - 文件对象池扫描：`vol -f dump.raw windows.filescan | grep -i <关键词>` 找已删除/可疑文件对象，命中后 `windows.dumpfiles` 提取（配合 `windows.svcscan`/`windows.amcache` 交叉确认）
   - YARA 规则直扫：`vol -f dump.raw yarascan.YaraScan --yara-file <规则.yar>` 扫内核内存（进程内扫 VAD 用 `windows.vadyarascan.VadYaraScan --yara-file <规则.yar> --pid <pid>`；均需 yara-python）——把 [[re-ioc]] 的规则直接作用于转储
   - 取证时间线（如需要）：`vol -r csv -f dump.raw timeliner` 生成事件时间线（timeliner 是顶级插件，无 windows. 前缀；`-r/--renderer` 是 vol 级选项，位于插件名之前；`-r csv` 为 CSV 渲染器），供报告与 [[re-ioc]] 引用

## 跨域联合

- [[re-forensics]]：本网关工作流第 2 步——本技能是内存取证环节
- [[re-memdump]]：转储产物来源（默认转储优先，见 [[platform-tips]]）；本技能只分析不取数
- [[re-malware]]：深度分析路径引用本技能——行为分析后查内存残留（注入/内存载荷/凭据）
- [[re-ti]]：提取出的 hash/域名/IP 转情报查询；凭据与注入对象进 [[re-ioc]] IOC 列表
- [[re-ioc]]：凭据哈希、网络连接、可疑对象汇总成 IOC 与报告证据段
- [[re-binary-core]]：malfind/dumpfiles 提取的可疑对象静态深挖
- 引用 [[platform-tips]]「直读 vs 转储」决策表（默认转储优先）与 Linux 内存转储极端段（vsyscall/vdso 过滤）

## 常见坑与陷阱

- **profile/符号文件错误 → 解析全错**：现象——`vol` 报 `Missing Symbol` / 解析出的进程列表明显荒谬（系统进程缺失、地址全 0）；原因——volatility3 虽自动选 profile，但对应平台符号表（windows 各版本 / linux 各内核）首次运行需在线下载，失败则插件无法解析；对策——网络可及时先 `vol -f dump.raw windows.info` 触发下载一次；受限环境用 `--offline` + 预置符号目录；Linux 转储确认内核版本与符号匹配，否则换对应版本再跑
- **dump 不完整（vsyscall 段污染）→ 分析偏差**：现象——malfind 命中大量 0xffffffffff6xxxxx 地址的"注入"，或提取对象全是对齐垃圾；原因——转储时未按 maps 过滤 `[vsyscall]`/`[vdso]`/`[vvar]`（见 [[platform-tips]] Linux 内存转储极端段），垃圾页混入；对策——取 dump 阶段就过滤极端段；分析时按地址区间跳过 0xffffffffff6xxxxx，别把垃圾页当证据
- **malfind 误报 → 假阳性**：现象——`windows.malfind` 命中大量私有执行页，但 dlllist 无异常模块、提取对象跑不了；原因——加载器/垃圾回收器/JIT 的正常 RWX 页也会被判定"异常"，malfind 只看内存属性不看执行语义；对策——用 dlllist 路径、hollow 检测、提取对象实际反编译（[[re-binary-core]]）三重交叉确认后再定论
- **只信 pslist 漏掉已终止进程**：现象——pslist 干净但网络/文件行为指向某 PID 已消失；原因——进程已被终止，常规列表不含；对策——补跑 `windows.psscan`（池扫描找残留对象），取证要求尽量全。
- **取证报告缺时间线**：现象——报告只有结论没有事件先后（"什么时候注入、什么时候外连"）；原因——未生成时间线证据；对策——用 `vol -r csv -f dump.raw timeliner`（顶级插件，无 windows. 前缀；`-r/--renderer` 是 vol 级选项，位于插件名之前）生成 CSV 时间线，进程/网络/凭据事件按时间归档，作为 [[re-ioc]] 报告证据段
- **内存内函数补丁型绕过 → 常规插件全干净**：现象——malfind/dlllist 全部干净，但样本的 ETW/AMSI 明显被抑制（日志缺失/扫描无响应）；原因——绕过不是注入新代码，而是改写已加载模块的函数头（如 `EtwEventWrite` 前 4 字节 patch 成 `ret 14`、`AmsiScanBuffer` 前 3 字节改成 `return 0`、`send` 开头跳到匿名私有内存），不产生新执行页也不改页权限，malfind 无感；对策——跑内置 `windows.etwpatch`（检测 ETW 补丁技术，vol3 2.28 起自带），或把内存中模块 dump 出来与磁盘原始 DLL 对照函数头字节
- **睡眠混淆 → 转储里载荷"消失"**：现象——转储中找不到植入体（无注入页、无落地文件），行为分析却确认 C2 植入体在运行；原因——Ekko/Foliage 类睡眠混淆在休眠期把 VAD 权限翻转为 `PAGE_NOACCESS`/`PAGE_READWRITE` 并把内容加密，唤醒瞬间才还原执行；对策——用 vadinfo 找权限翻转/NOACCESS 的区段，按轮转密钥还原休眠中的加密页，或配合 [[re-emulation]] 在唤醒点模拟执行抓取明文
- **BitLocker FVEK 可从 RAM 恢复（主版本无此插件）**：现象——拿到加密磁盘镜像+内存转储但没有密码，数据提取停滞；原因——系统运行时全卷加密密钥（FVEK）残留在 RAM（未被安全擦除），但主版本 Volatility 3 没有内置插件；对策——用社区 `volatility3-bitlocker` 插件跑 `windows.bitlocker.BitlockerFVEKScan`（`--tags FVEc Cngb`）提取 FVEK，再用 `dislocker -k` 挂载解密；v3 插件对旧内核结构报错时回退 Volatility 2 + breppo/Volatility-BitLocker
- **插件列表缺凭据/YARA 类条目**：现象——`vol --help` 里没有 windows.hashdump/lsadump/cachedump 或 yarascan；原因——缺 pycryptodome / yara-python 依赖，加载失败的插件被静默跳过（2026 实测 2.28.0 表现）；对策——`pip install pycryptodome yara-python` 后重跑 `vol --help` 确认条目出现，再跑对应插件
