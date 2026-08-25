---
name: re-memdump
description: >
  内存转储与提取：默认转储优先(gcore)，直读特例。
  触发词：内存转储、dump内存、找密钥、DEX提取
---

# 内存转储与提取

## 何时使用 / 何时不用

- 用：任何需要读进程内存的任务（找密钥/解密数据、脱壳后提取干净样本、DEX 提取）；进程已死后的 core 分析；attach 被禁时的兜底
- 不用：实时交互调试（那是 [[re-gdb]] / [[re-lldb]] / [[re-x64dbg]] 的活）
- 不用：静态可得的字符串/结构（静态优先）

## 工具准备

参考 [[platform-tips]]「直读 vs 转储」决策表与 Linux 内存转储极端段——**默认转储优先**，直读仅特例。

### gdb / gcore（转储主力）

- Linux: `apt install gdb` / `dnf install gdb` / `pacman -S gdb`（gcore 随附）
- WSL: Linux 包
- 验证: `gcore --help` / `gdb --version`

### gdb core 分析工具

- gdb（`gdb ./target core`）、elfutils `eu-stack`（`apt install elfutils`）、`file core`
- 验证: `eu-stack --version`

### volatility（内存取证分析）

- 全平台: `pip install volatility3`（命令 `vol`）；volatility2 旧版 Python2 按需
- 验证: `vol -h`；`vol -f core windows.info` 能识别镜像

### proc / psmisc（进程状态）

- Linux: `apt install procps psmisc` / `dnf install procps-ng psmisc` / `pacman -S procps-ng psmisc`（多数自带）
- 验证: `ps aux`、`pkill` 可用

### Windows 转储（procdump / DumpIt，补充分支）

- procdump（Sysinternals 官方下载，或 `choco install sysinternals`）：`procdump -accepteula -ma <pid> out.dmp` 全进程内存转储（含托管堆）——x64dbg/windbg 可加载分析
- DumpIt（Comae 官网）：整机物理内存转储（.raw），管理员运行——供 [[re-mem-forensics]] 整机取证
- 验证: `procdump -accepteula -?` 输出 usage；转储产物用 `file` 确认（dmp/raw 头）

## 操作步骤

1. **默认转储：等 OEP 解密后 `gcore -o out <pid>`**：
   ```sh
   gcore -o out <pid>
   # 或调试器内
   gdb -q -p <pid> -ex 'gcore out' -ex detach -ex quit
   ```
   - 转储含完整内存 + 寄存器/线程状态（ELF notes），可直接导入 [[re-ghidra]] / [[re-ida]]
   - **时机**：脱壳样本必须在进程运行到 OEP（壳解密完成）后再 dump，否则拿到的是壳的初始状态（见坑 2）
   - 一次转储满足后续所有定向提取需求——不重复多次 dump

2. **转储前按 maps 过滤 vsyscall/vdso**：
   ```sh
   cat /proc/<pid>/maps > maps.txt
   grep -E 'vsyscall|vdso|vvar' maps.txt     # 这些段必须剔除
   # 只保留 r--p / rw-p 可读映射区域作为提取范围
   ```
   按 [[platform-tips]] Linux 内存转储极端段: `[vsyscall]`（0xffffffffff600000）、`[vdso]`/`[vvar]` 读取失败正常，dump 进 core 也只是垃圾页——转储后提取时跳过，或用 maps 白名单方式直读（步骤 5）。

3. **导入 Ghidra/IDA 分析（core 复盘）**：
   ```sh
   gdb -q ./target out         # core 复盘: bt / info registers / x/gx $rsp
   eu-stack -e out | head -30  # 快速栈回溯
   ```
   Ghidra: `File > Import File` 选 core（Ghidra 支持 ELF core 导入），符号/堆栈线索可用。
   - gcore 产物是单进程 ELF core，不是整机物理内存镜像——Volatility 的 `linux.pslist` 等插件只适用于整机镜像（采集方式如 LiME/`dd if=/dev/mem`），gcore 上按 [[re-mem-forensics]] 流程跑会失败；进程级枚举用 gdb/`eu-stack`/ELF core 解析与定向提取即可

4. **定向提取：密钥/DEX/字符串（magic 扫描）**：
   ```sh
   # DEX 魔数 "dex\n035\0"
   grep -abo $'dex\n035' out | head
   # PEM 私钥头
   grep -abo '-----BEGIN' out | head
   # 通用字符串
   strings -n 8 out | grep -iE 'key|secret|flag|BEGIN'
   ```
   ```python
   # 扫描指定地址范围找特定模式
   data = open('out','rb').read()
   i = data.find(b'\x89PNG')          # PNG 魔数
   while i != -1:
       print("found at", hex(i)); i = data.find(b'\x89PNG', i+1)
   ```
   密钥提取注意: 密钥可能在堆/栈上碎片化——先定位加密上下文再取（配合 [[re-ghidra]] 看调用点）。

5. **特例直读：maps 定址 → SIGSTOP → pread**：
   ```sh
   kill -STOP <pid>    # 先停住进程防竞态
   # 从 maps.txt 拿目标段地址偏移后:
   dd if=/proc/<pid>/mem bs=1 skip=0x7f0000000000 count=4096 of=seg.bin 2>/dev/null
   kill -CONT <pid>
   ```
   ```python
   import os
   pid = 1234
   f = open(f"/proc/{pid}/mem", "rb")
   os.lseek(f.fileno(), 0x7f0000000000, os.SEEK_SET)   # maps 定址
   data = f.read(4096)
   f.close()
   ```
   - 适用: 进程必须保持运行 / 只取极小特定区段（[[platform-tips]] 特例①/②）
   - `/proc/<pid>/mem` 偏移是**虚拟地址**，不是文件偏移——直接 open+read 从 0 开始读必报错（见坑 3）

6. **Windows 侧转储（分支补齐）**：
   ```sh
   procdump -accepteula -ma <pid> out.dmp   # 全进程内存（含堆），windbg/x64dbg 加载
   # 整机物理内存: DumpIt 管理员运行产出 .raw → [[re-mem-forensics]]
   ```
   - procdump 产物是进程级 minidump，与 gcore 同级——不是整机镜像，Volatility 不适用（[[re-mem-forensics]] 只吃整机镜像）
   - 分析入口：[[re-windbg]]（minidump 加载）/ [[re-x64dbg]]（`minidump` 命令）

## 跨域联合

- [[re-binary-core]]：工作流第 6 步（内存环节，默认转储优先）
- [[re-malware]]：恶意样本内存产物提取（脱壳后样本）
- [[re-mobile]]：App 内存中 DEX/so 提取
- [[re-anti-analysis]]：脱壳后提取干净镜像的标准动作
- [[re-crypto-keys]]：内存中密钥提取的方法论配合（先定位加密上下文再取，见步骤 4）
- [[re-format-elf]]：core 是 ELF 格式，节区/notes 结构解析可对照
- 与 [[re-gdb]] / [[re-x64dbg]] / [[re-windbg]] 互补（attach 失败→转储；需要交互→调试器；Windows 进程 dump→windbg）

## 常见坑与陷阱

- **vsyscall/vdso 读取失败正常**：`[vsyscall]` 只可执行、`[vdso]` 部分页不可读，gdb/pread 访问报错是预期行为——按 maps 过滤后提取，别当 bug 排查
- **转储时机过早 = 壳的初始状态**：在壳解密前 dump 拿到的是压缩/加密数据——脱壳样本必须等到 OEP 后（见 [[platform-tips]] 关键经验）
- **/proc/pid/mem 无脑 open 必报错**：直接 `open('/proc/pid/mem').read()` 会失败（偏移非法/权限）——必须 maps 定址 + SIGSTOP + chunked pread
- core 文件可达数 GB——先 `file out` 确认是 ELF core，再按需定向提取，别整文件导入工具
- **从转储重建进程时 vDSO 不可移植**：现象——重建/复现进程镜像后程序仍跳回原 vDSO 地址，或 `call *%gs:0x10` 间接调用断掉；原因——vDSO 地址记录在进程栈 auxv 的 `AT_SYSINFO`/`AT_SYSINFO_EHDR`，且 glibc 有缓存，修补 auxv 也不一定能重定位；对策——重建镜像时把 vDSO 相关调用视为必然失效（该页直接跳过），分析以其余映射为准
- **gcore 取证分辨率有限**：现象——core 里查共享库注入/函数指针重定向困难，堆栈信息残缺；原因——传统 core 是内核按段快照，无每进程 profile 与符号重建；对策——普通逆向 gcore 够用；深度取证（定位注入点/hook）改用 ECFS 类内核级转储（core_pattern 挂钩重建 `.symtab`/`.dynsym`）或配合 `/proc/<pid>/maps` 手工重建
- **看到解密数据 → 立刻保存**：现象——动态调试/转储中刚在内存里见到明文（解密字符串/密钥/第二层代码），切换工具或继续运行后该地址已被覆盖或清空，再也拿不回；原因——解密数据是阶段性的：解壳完成清理、自清除、用后即焚密钥、缓冲区复用都会立刻抹掉（注意与"转储时机过早"相反，这里是晚了就没了）；对策——动态里一确认解密产物立即 `gcore` / 定向提取（见步骤 1/4，默认转储优先），"先保存再继续"；需要再现时回到解密循环调用点重新观察（见 [[re-binary-core]] 分析方法论 R19）
- **gcore/直读被 ptrace 权限拦**：现象——`gcore` 报 `ptrace: Operation not permitted`，`/proc/<pid>/mem` 打开即失败；原因——`kernel.yama.ptrace_scope=1/2` 限制跨进程族 attach（非 root 且目标不是自己子进程时）；对策——root 运行转储，或临时 `sysctl kernel.yama.ptrace_scope=0`（用后恢复），或经调试器（[[re-gdb]]）以允许身份执行
