---
name: re-behavior
description: >
  恶意行为分析：持久化、注入、进程树、文件/注册表、ATT&CK 映射。
  触发词：行为分析、持久化、注册表、进程注入、它在干什么
---

# 恶意行为分析

## 何时使用 / 何时不用

- 用：判定样本"在干什么"——运行后的进程/文件/注册表/网络行为；识别持久化与注入；ATT&CK 战术映射
- 用：动态分析的证据收集环节（与 [[re-tracing]] 互补）
- 不用：样本还没在沙箱里跑过（先 [[re-sandbox]]——动态执行是强制前置，见 [[platform-tips]] 最高原则）
- 不用：只需静态结论（走 [[re-triage]] / [[re-binary-core]] 域）；只需内存内容（走 [[re-memdump]]）

## 工具准备

本技能分析的是沙箱运行产物——运行环境先由 [[re-sandbox]] 建立（默认沙箱最高原则，见 [[platform-tips]]）。

### 沙箱产物（运行环境前置）

- 由 [[re-sandbox]] 建立：VM 快照 / 容器 / firejail + 网络隔离（INetSim / fake DNS / 断网）
- 产物包括：行为日志、进程快照、INetSim 网络记录、内存转储（[[re-memdump]]）
- 验证: 沙箱内样本已按 [[re-sandbox]] 步骤跑完并产出日志

### procmon / Process Monitor（Windows 行为记录主力）

- Windows: Microsoft Sysinternals —— `choco install sysinternals`，或微软官网下载 Procmon64.exe
- Linux/macOS: 不适用（用 sysdig / bpftrace；函数级记录见 [[re-tracing]]）
- 验证: 管理员运行 Procmon64.exe，出现捕获窗口并能记录事件
- 附加: Process Explorer（同套件）看进程树与句柄

### sysdig（Linux 系统行为追踪）

- Linux: `apt install sysdig` / `dnf install sysdig` / `pacman -S sysdig`
- macOS/Windows: 不支持（Linux 专用）；WSL 内可用 Linux 版（需 root）
- 验证: `sysdig --version`；`sysdig -c topprocs_cpu` 能输出
- 常用: `sysdig proc.name=target -w out.scap` 录制，事后 `sysdig -r out.scap` 回放

### bpftrace（Linux 内核级追踪，低开销）

- Linux: `apt install bpftrace` / `dnf install bpftrace` / `pacman -S bpftrace`
- 需要内核 BTF/追踪支持；macOS/Windows 不支持
- 验证: `bpftrace --version`；`sudo bpftrace -e 'tracepoint:syscalls:sys_enter_execve { print(comm) }'` 能打印
- 用途: 文件写、进程启动、网络连接等高频事件，比用户态监控轻量

### MITRE ATT&CK 导航

- 无需安装: 浏览器开 https://attack.mitre.org/matrices/enterprise/ 或 Navigator（https://mitre-attack.github.io/attack-navigator/）
- 本地部署（可选）: `git clone https://github.com/mitre-attack/attack-navigator`，静态页面直接打开
- 验证: 页面能按战术/技术检索

### Windows/Linux 内置命令（持久化/网络检查，零安装）

- Windows: `reg query`、`sc query`、`schtasks /query /fo csv`、`netstat -ano`、`Get-CimInstance Win32_StartupCommand`
- Linux: `ps -ef --forest`、`ss -tnp`、`cat /etc/crontab`、`systemctl list-unit-files --state=enabled`
- 验证: 各命令能正常输出

## 操作步骤

按顺序执行，每步记下结果并保存证据（路径 + sha256）。

1. **进程树与注入识别**：
   - Windows（沙箱内 procmon 录制中跑样本）: 过滤 Process Name = 样本，用 Process Explorer 的 Tree 视图看进程树——子进程、落盘后新起的进程（dropper → payload 两段）
   - 注入特征序列（procmon / sysdig 过滤 API）:
     - DLL 注入: OpenProcess → VirtualAllocEx → WriteProcessMemory → CreateRemoteThread（目标进程被写 + 新线程）
     - 进程空洞: CreateProcess(SUSPENDED) → NtUnmapViewOfSection → WriteProcessMemory → SetThreadContext → ResumeThread
     - APC 注入: OpenThread → QueueUserAPC → ResumeThread
   - Linux: `sysdig proc.name=target` 看 execve/clone 序列；`ps -ef --forest` 看进程树
   - 结论记录：注入目标、注入手法、被注入进程 PID

2. **持久化清单**（计划任务/WMI 常被忽略，见坑 3）：
   - Windows:
     ```bat
     reg query "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Run"
     reg query "HKCU\Software\Microsoft\Windows\CurrentVersion\Run"
     sc query state= all
     schtasks /query /fo csv
     ```
     WMI 持久化（隐藏最深）: `Get-CimInstance -Namespace root\subscription -ClassName __EventConsumer`（ActiveScriptEventConsumer / CommandLineEventConsumer 是恶意常见点）
   - Linux: `cat /etc/crontab`、`ls /etc/cron.d /etc/cron.daily`、`systemctl list-unit-files --state=enabled`、`/etc/rc.local`、`/etc/profile.d/*`、`~/.bashrc`
   - 逐项记录：位置、命令/路径、是否与样本相关

3. **文件与注册表操作**：
   - Windows: procmon 过滤 Operation = CreateFile / WriteFile / RegSetValue / RegCreateKey，进程 = 样本；重点看 %APPDATA%、%TEMP%、%ProgramData%、Startup 文件夹
   - Linux: `sysdig -c spy_file proc.name=target`（文件读写）；函数级调用用 [[re-tracing]] 的 strace 补
   - 记录的每项都算潜在 IOC（配置落地路径、下载的文件）——供 [[re-ioc]] 使用

4. **网络连接与 C2 特征**：
   - Windows: `netstat -ano` 对照 procmon 网络事件；沙箱 DNS 已指向 INetSim（[[re-sandbox]] 步骤 2）——INetSim 日志里的 DNS 查询就是 C2 域名的直接证据
   - Linux: `ss -tnp`、`sysdig fd.type=ipv4 proc.name=target`
   - C2 特征清单：非常规端口（>1024 或 443/53 伪装）、周期心跳（固定间隔短连接）、DNS 隧道（长随机子域名）、异常 User-Agent、HTTPS 到未知 IP 且证书不匹配
   - 发现 C2 → 流量细节转 [[re-protocol]]（[[re-netcap]] / [[re-proto-rev]] / [[re-crypto-id]] / [[re-crypto-keys]] / [[re-crypto-decrypt]]）

5. **ATT&CK 战术映射**：
   - 把步骤 1-4 的行为按 ATT&CK 战术归类：初始访问、执行、持久化（T1547 / T1053 / T1543）、防御规避（T1055 注入）、命令与控制（T1071 / T1568）…
   - 每个行为写「行为 → 战术:技术 (ATT&CK ID) → 证据路径」一行，汇总成映射表进报告（供 [[re-ioc]] 报告结构使用）

## 行为监控工具链（Windows）

Windows 侧行为采集四件套：ProcMon（全系统文件/注册表/网络/进程）、API Monitor（API 级 hook）、ETW（内核侧事件）、Process Explorer（实时进程视图）。前二者为用户态采集，ETW 在内核侧；本节是采集侧视角，与 [[re-evasion]] 的绕过侧互补。除注明外均为仅 Windows 工具，Linux/macOS 对应走 [[re-tracing]]（strace/ltrace/dtruss）与本文件「工具准备」的 sysdig/bpftrace。

### ProcMon：过滤 → 标注 → CSV 导出

- 过滤（Filter 对话框，Ctrl+L）: 规则 = 列 + 关系 + 值，多条件叠加；列可选 Process Name / Operation / Path / Result / PID 等；关系支持 is / is not / contains / begins with / ends with / less than / more than（数值列用大小比较）；右键事件可快速生成规则（Add to Include filter / Add process and children to Include filter）
- 过滤是非破坏性的: 不匹配事件仍入库只是不显示；勾选 Drop Filtered Events 才真正丢弃（超高频捕获控体积用，不可恢复——需要完整证据链时别勾）
- 标注: Include 规则把关注事件黄色高亮，Highlight（Ctrl+H）自定义高亮颜色，Exclude 灰显排除——「高亮=重点、灰显=噪音」的分层阅读
- CSV 导出: File → Save（Ctrl+S）对话框格式选 CSV，范围选 Events displayed using current filter（先过滤再导出，控制体量）；批量转换用命令行 `Procmon64.exe /OpenLog trace.pml /SaveAs out.csv`；原生 PML 保留全部字段与线程栈，可换机复盘
- 时间线关联: 按 Time of Day 排序，把 Process Create / CreateFile / WriteFile / RegSetValue / TCP-UDP Send-Receive 对齐成「进程 → 文件 → 注册表 → 网络」证据链（对应操作步骤 1-4）；Process Tree 工具（Ctrl+T）看进程父子与注入脉络
- 事件属性 Stack 标签页给线程调用栈（可配符号服务器），核对注入/持久化 API 序列（步骤 1 与坑 5-7 的实证）

### API Monitor：API 级 hook 链

- 定位: 以导入表 hook 挂接进程内 API 调用，逐调用记录参数（字符串已解码）与返回值，调用树展示嵌套层级——Windows 侧对应 [[re-tracing]] 的 strace/ltrace
- 用法: 管理员运行 → 选择目标进程 → 勾选 API 类（File / Network / Registry / Process / Thread）→ 附加；调用树展开到关键 API（CreateProcess / WriteProcessMemory / RegSetValue / NtWriteFile）看参数实况
- 位宽限制（常见坑）: 32 位版只能监控 32 位进程、64 位版只能监控 64 位进程——按样本位宽选 apimonitor-x86.exe / apimonitor-x64.exe
- 安装: 官方渠道 rohitab.com（免费软件，v2 alpha，zip 解压即用）；站点偶发不可达，拿到压缩包先核对校验值
- 验证: 附加目标进程后能列出调用树并记录参数与返回值

### ETW：内核侧事件采集（logman / wevtutil）

- 定位: Windows 内置事件框架，会话创建与事件解析用系统自带命令（logman / wevtutil / tracerpt），零安装；内核侧采集不受用户态 hook 影响——直通 syscall 的注入（坑 8）只能靠内核侧事件兜底
- 建会话（需管理员）:

  ```bat
  logman create trace bhev -p Microsoft-Windows-Kernel-Process 0x10 -o bhev.etl -ets
  logman stop bhev -ets
  logman delete bhev -ets
  ```

  `-p` 指定 provider（名称或 GUID），可带关键字与级别（如 `-p Microsoft-Windows-Sysmon 0xFF 5`）；内核 provider 必须显式给关键字——Kernel-Process 的 0x10 为进程关键字，0x20/0x40 为线程/镜像关键字，缺省可能静默采零事件；`logman query -ets` 看活动会话；`logman query providers` 枚举已注册 provider（管道 `findstr` 筛目标）
- 常用 provider: Microsoft-Windows-Kernel-Process（进程创建/退出）、Microsoft-Windows-PowerShell（脚本块）、Microsoft-Windows-Sysmon（装有 Sysmon 时直接复用其事件）
- 事件解析: .etl 转 CSV 用 `tracerpt bhev.etl -o out.csv -of csv`；事件日志用 wevtutil：

  ```bat
  wevtutil qe Security /q:"*[System[(EventID=4688)]]" /c:10 /rd:true /f:text
  wevtutil el
  wevtutil epl Security C:\secevt.evtx
  ```

  `/q` 为 XPath 过滤，`/c` 条数上限，`/rd:true` 最新在前，`/f:xml|text` 输出格式
- 与 re-evasion 互补: 本节是采集侧；绕过侧（patch EtwEventWrite、provider 掩码、事件流中断即禁用证据）见 [[re-evasion]]

### Process Explorer：实时进程视图

- 进程树: View → Show Process Tree（Ctrl+T）——父子关系、退出进程灰显保留；与 ProcMon 的 Process Tree 工具互补（PE 看实时、ProcMon 复盘录制）
- 底窗: Handles（Ctrl+H）看进程打开的句柄（文件/注册表/网络对象），DLLs（Ctrl+D）看已加载模块与映射——查注入 DLL 是否落位、哪个进程握着被删文件；Hide Lower Pane（Ctrl+L）收起
- Find Handle or DLL（Ctrl+F）: 按文件/路径/键反查持有进程——找谁在读写某路径
- 签名验证: Options → Verify Image Signatures 开启后进程列表出现 Verified Signer 列；进程属性 Image 页 Verify 按钮单查——快速区分系统合法模块与可疑注入模块（签名缺失/失效即告警，配合步骤 1）

### 跨 OS 约束

- 以上工具（ProcMon / API Monitor / Process Explorer / logman-wevtutil）均为 Windows 内置或 Windows-only；Linux/macOS 对应走 [[re-tracing]]（strace/ltrace/dtruss）与「工具准备」的 sysdig / bpftrace
- 例外注明: ProcMon 有微软官方 Linux 移植（ProcMon-for-Linux，GitHub microsoft 仓库，preview、系统调用级），实验性，正式分析仍以 sysdig/bpftrace 为主

## 跨域联合

- [[re-malware]]：工作流第 3 步——行为分析是恶意样本判定的核心环节
- [[re-sandbox]]：本技能全部运行与复跑必须在沙箱内（强制前置）
- [[re-protocol]]：步骤 4 发现 C2 → 转流量捕获 / 协议重建
- [[re-anti-analysis]]：行为异常（延迟/交互检查、检测沙箱后退出）→ 转反分析对抗域
- [[re-tracing]]：Linux 下用 strace 系列补充 sysdig/bpftrace 的函数级调用记录
- [[re-evasion]]：ETW 采集侧（「行为监控工具链」一节）与绕过侧互补——事件流中断即禁用证据
- [[re-ioc]]：步骤 3/4 产出的行为证据是 IOC 提取与报告的原料

## 常见坑与陷阱

- **行为被沙箱检测绕过**：现象——样本在沙箱里只做无害行为或什么都不做，换真实机才发作；原因——沙箱检测（VM 特征、交互检查、延迟触发，见 [[re-sandbox]] 坑 4 与 [[re-anti-analysis]] 域）；对策——延长观察窗口（数小时~数天）、伪造交互（输入/鼠标事件）、配合 [[re-sandbox]] 的 INetSim 完整网络、必要时用 [[re-anti-analysis]] 静态还原触发条件
- **只看进程树漏注入**：现象——进程树里只有样本自身，但恶意行为发生在别的进程里；原因——注入型样本自进程表现无害，恶意逻辑在宿主进程执行；对策——必须查注入特征序列（步骤 1 的 API 序列），行为证据以被注入目标进程的内存与模块为准
- **持久化藏于计划任务/WMI 常被忽略**：现象——重启后样本复活，Run 键/服务里查不到；原因——攻击者优先用计划任务（schtasks）与 WMI 事件订阅做持久化，常规检查覆盖不到；对策——持久化清单必须包含 `schtasks /query` 与 WMI __EventConsumer 查询（步骤 2），逐项核对创建时间与命令内容
- **隐藏的计划任务常规查询查不到**：现象——`schtasks /query` 与任务计划 GUI 都看不到任务，重启后样本仍复活；原因——攻击者删除任务的安全描述符（SD）注册表值或篡改 Index 元数据，任务从常规查询中隐藏；对策——直接检查 `C:\Windows\System32\Tasks\*.xml` 与注册表 `HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Schedule\TaskCache`，SD 缺失即告警
- **注入检测看系统侧信号，不只盯 API 序列**：现象——进程树无异常、API 序列未捕获，注入却已发生；原因——注入目标多为受信任系统进程，API 监控被绕过或覆盖不到；对策——配合 Sysmon 事件：8（CreateRemoteThread）、10（ProcessAccess 带 PROCESS_VM_WRITE/PROCESS_VM_OPERATION/PROCESS_CREATE_THREAD）、7（异常路径 ImageLoaded）、25（ProcessTampering，内存镜像与磁盘不一致=空洞化）；空洞化样本用 PE-sieve/Hollows Hunter 扫描（内存 PE 头与磁盘不匹配）
- **持久化位置超出 Run 键/服务**：现象——Run 键与服务清单干净，登录/启动后样本仍执行；原因——攻击者用 Winlogon Userinit、AppInit_DLLs、IFEO、COM 劫持、服务失败恢复"Run a Program"等位置（Autoruns 扫描 18+ 类 ASEP）；对策——持久化清单补全上述位置（步骤 2），逐项核对路径、签名与创建时间
- **KernelCallbackTable 注入（回调表重定向）**：现象——进程树正常、常规注入 API 序列（OpenProcess→VirtualAllocEx→WriteProcessMemory→CreateRemoteThread）一条都抓不到，注入却已发生；原因——攻击者克隆 PEB 的 KernelCallbackTable 并把某回调（如 __fnCOPYDATA）重定向到载荷，用窗口消息（WM_COPYDATA）触发，执行借合法进程身份隐藏（ATT&CK T1574.013，Lazarus/FinFisher 在用，有现成 Sigma 检测规则）；对策——API 序列之外补查回调表指针指向与回调函数地址（`dt _PEB KernelCallbackTable`）、Sysmon 10 对目标进程的写入事件，配合 T1574.013 Sigma 规则与内存扫描
- **直接/间接系统调用注入（直通 syscall）**：现象——Sysmon/procmon 的 API 监控完全看不到注入动作，注入却已发生；原因——DirectSyscalls/IndirectSyscalls 不经 ntdll 用户态导出（或借合法模块做跳板）直发系统调用，绕掉安全产品的用户态 hook；对策——监控降级到内核侧（ETW、Sysmon 25 进程篡改、内核驱动级事件），内存侧用 PE-sieve/Hollows Hunter 扫描内存与磁盘镜像不一致，别只依赖用户态 API 事件
- **Linux 侧注入监控盲区**：现象——Linux 样本 `ps -ef --forest` 进程树正常、sysdig 无异常 execve，恶意代码已在目标进程里跑；原因——Linux 注入不落盘：`process_vm_writev` 无痕写目标内存、攻击者读 `/proc/<pid>/syscall` 拿目标 RSP 后在栈上构造 ROP 调 `dlopen`（DD 面向对象注入 PoC 公开于 2024）、`LD_PRELOAD` 在监控启动前已注入；对策——审计 `/etc/ld.so.preload`（auditd 规则盯其写入），audit 记录 process_vm_writev/process_vm_readv/ptrace 调用，对比磁盘文件与 `/proc/<pid>/maps` 映射来源一致性
