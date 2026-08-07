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
- Linux/macOS: 不适用（用 sysdig / bpftrace）
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

## 跨域联合

- [[re-malware]]：工作流第 3 步——行为分析是恶意样本判定的核心环节
- [[re-sandbox]]：本技能全部运行与复跑必须在沙箱内（强制前置）
- [[re-protocol]]：步骤 4 发现 C2 → 转流量捕获 / 协议重建
- [[re-anti-analysis]]：行为异常（延迟/交互检查、检测沙箱后退出）→ 转反分析对抗域
- [[re-tracing]]：Linux 下用 strace 系列补充 sysdig/bpftrace 的函数级调用记录
- [[re-ioc]]：步骤 3/4 产出的行为证据是 IOC 提取与报告的原料

## 常见坑与陷阱

- **行为被沙箱检测绕过**：现象——样本在沙箱里只做无害行为或什么都不做，换真实机才发作；原因——沙箱检测（VM 特征、交互检查、延迟触发，见 [[re-sandbox]] 坑 4 与 [[re-anti-analysis]] 域）；对策——延长观察窗口（数小时~数天）、伪造交互（输入/鼠标事件）、配合 [[re-sandbox]] 的 INetSim 完整网络、必要时用 [[re-anti-analysis]] 静态还原触发条件
- **只看进程树漏注入**：现象——进程树里只有样本自身，但恶意行为发生在别的进程里；原因——注入型样本自进程表现无害，恶意逻辑在宿主进程执行；对策——必须查注入特征序列（步骤 1 的 API 序列），行为证据以被注入目标进程的内存与模块为准
- **持久化藏于计划任务/WMI 常被忽略**：现象——重启后样本复活，Run 键/服务里查不到；原因——攻击者优先用计划任务（schtasks）与 WMI 事件订阅做持久化，常规检查覆盖不到；对策——持久化清单必须包含 `schtasks /query` 与 WMI __EventConsumer 查询（步骤 2），逐项核对创建时间与命令内容
