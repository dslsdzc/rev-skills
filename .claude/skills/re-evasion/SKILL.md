---
name: re-evasion
description: >
  检测规避/EDR 对抗分析：AMSI/ETW 绕过、无文件、lolbin 链。
  触发词：规避、evasion、AMSI、ETW、无文件、lolbin、EDR绕过
---

# 检测规避与 EDR 对抗分析

## 何时使用 / 何时不用

- 用：恶意样本/工具被检测（杀软、EDR）后分析其规避手段——AMSI 绕过、ETW 禁用、无文件执行、lolbin 链
- 用：回答"为什么被检测"与"绕过点在哪"（与检测侧对齐，步骤 5）
- 用：无文件/内存载荷的执行链分析（载荷不落盘的样本）
- 不用：纯静态代码分析（那是 [[re-binary-core]]）；不关心绕过机制、只观察行为的动态分析（那是 [[re-behavior]]）
- 不用：检测规则编写本身（那是 [[re-ioc]] 的 YARA 与检测工程侧）
- 注意：本技能以 Windows 为主（AMSI/ETW/lolbin 均为 Windows 概念）；Linux/macOS 的类似对抗（ptrace 检测、Dyld 注入、kext 绕过）按同一"规避识别→绕过点定位"框架套用

## 工具准备

规避分析必须动态执行 + 内存取证：全程在沙箱内（[[re-sandbox]] 强制前置，[[platform-tips]] 最高原则）。所有工具先验证再使用。

### amsi.dll 内存对照 —— AMSI patch 定位主力（无独立安装包）

- 原理: 磁盘 `C:\Windows\System32\amsi.dll` 与内存中的 amsi.dll 逐字节对照，函数头差异即 patch 点
- 取内存拷贝: Sysinternals procdump（微软官网/`winget install Microsoft.Sysinternals.Procdump`）`procdump -accepteula -ma <pid> mem.dmp`；或 [[re-memdump]]（gcore/WSL）全量转储
- 验证: 对未运行样本的场景用 AMSITrigger 兜底；对照脚本见步骤 2

### AMSITrigger —— 定位触发 AMSI 扫描的字符串（Outflank 出品）

- 下载: GitHub 检索 `AMSITrigger`（原 outflanknl 仓库已不可用，社区镜像常见，如 RythmStick/AMSITrigger）；.NET 工具，解压即用
- 验证: `AMSITrigger.exe -i test.ps1` 输出逐行触发状态（Detected / Not Detected）
- 用途: 分析"脚本里哪些字符串触发检测"→ 对应混淆/规避目标

### ETW 监控 —— logman / SilkETW / WPR / ETWConsumer 类工具

- logman（Windows 内置）: 验证 `logman query providers | findstr /i sysmon`；`logman query -ets` 看活动会话
- SilkETW（Mandiant 开源，C#）: GitHub releases 下载；验证: `SilkETW.exe -t user -pn Microsoft-Windows-Sysmon -ot file -p out.etl` 能生成 .etl
- WPR（Windows Performance Recorder，内置）: `wpr -start` 后 `wpr -stop out.etl`
- ETWConsumer 等第三方 ETW 消费者工具（GitHub 检索，按需）；本机看 provider 的替代: `tracerpt` 解析 .etl
- 用途: 确认 ETW 是否被禁——事件流中断/缺失即禁用证据（见步骤 3）

### Sysmon / procmon —— 进程链与执行行为（lolbin 链追踪）

- Sysmon（Sysinternals，微软官方）: 配置含 ProcessCreate（事件 1，记录父子进程与命令行）；验证: `Get-WinEvent -FilterHashtable @{LogName='Microsoft-Windows-Sysmon/Operational';Id=1} | select -First 1`
- procmon（Sysinternals）: 文件/注册表/进程/网络全量，可按进程树过滤；验证: `procmon.exe /AcceptEula /Quiet` 能启动
- 二者均无发行版包，从微软官网/Sysinternals 下载

## 操作步骤

按顺序执行，每步产物（内存转储/ETL/日志/命令行走访记录）存档 sha256 + 路径（[[re-ioc]] 证据链要求）。

1. **规避手段识别（先分类再深入）**：
   - 输入: 样本/工具 + 检测触发信息（杀软告警、EDR 日志、沙箱告警）
   - 分类清单（按特征归档）: AMSI 绕过（patch / 反射加载）、ETW 禁用（patch provider / 掩码）、无文件（内存执行 / 注册表运行键 + 远程脚本 / WMI）、lolbin 链（rundll32 / mshta / regsvr32 / WMI / PowerShell）、字符串编码混淆（防特征）
   - 证据采集: 沙箱内运行（[[re-sandbox]]）→ Sysmon/procmon 记录进程创建链与命令行；同时 [[re-memdump]] 留内存快照（默认转储优先，[[platform-tips]]「直读 vs 转储」）；PowerShell 开启 ScriptBlock 日志（事件 4104）与模块日志
   - 先跑一遍不 patch 的基准样本确认"检测触发点"（见坑 5 与步骤 5 对齐）

2. **AMSI 绕过分析（内存 patch 定位）**：
   ```sh
   procdump -accepteula -ma <pid> mem.dmp        # 运行后取进程内存（或 gcore，见 [[re-memdump]]）
   # 对照: 磁盘 amsi.dll 与内存中 amsi.dll 的函数头字节
   # 常见 patch: AmsiScanBuffer 入口改为直接返回 0x80070057（"AMSI 已初始化"假成功）
   #            或 EtwEventWrite 系列前几字节 patch 成 ret
   ```
   - 定位法: 磁盘 amsi.dll 里 AmsiScanBuffer 的入口偏移（Ghidra/IDA 或 `dumpbin /exports`）→ 内存 dump 同偏移字节对照；有差异即 patch 点
   - 其他形式: 反射加载 amsi.dll 前 hook（Detour 到用户代码）、CLR 侧绕过（托管层关闭 AMSI provider）
   - 用 AMSITrigger 验证"哪些字符串触发"→ 样本混淆目标与绕过有效性互证
   - patch 定位前确认环境基线: 不运行样本时磁盘/内存 amsi.dll 一致（排除 EDR 自身 hook 干扰，见坑 4）

3. **ETW 禁用分析**：
   ```sh
   logman query -ets                                   # 活动会话；与样本运行前后对比
   # SilkETW 捕获: 运行样本前后各抓一段，对比事件数量/内容
   # 定位: 内存中 ntdll 的 EtwEventWrite / EtwEventWriteEx 前几字节 vs 磁盘（同步骤 2 对照法）
   ```
   - 禁用证据: 样本运行后 ETW 事件流中断（某 provider 零事件/整体丢失）；patch 点通常位于 ntdll 的 `EtwEventWrite*`
   - 确认范围: 全局禁用（改 EtwEventWrite 本身）vs 特定 provider 禁用（改 provider 的 enable 掩码/Level）——决定影响面与检测侧恢复建议
   - 与 AMSI 常组合出现（一个 patch 多个目标），对照报告两者联动（见坑 1）

4. **lolbin 链追踪（rundll32/mshta 等）**：
   ```sh
   # Sysmon 事件 1（ProcessCreate）按进程树关联，重点看父进程 + 命令行
   Get-WinEvent -FilterHashtable @{LogName='Microsoft-Windows-Sysmon/Operational';Id=1} |
     Select TimeCreated, @{n='Parent';e={$_.Properties[1].Value}}, @{n='Image';e={$_.Properties[3].Value}}, @{n='Cmd';e={$_.Properties[4].Value}}
   ```
   - 典型链: `cmd → rundll32.exe javascript:"..."`、`regsvr32.exe /s /n /u /i:http://... scrobj.dll`、`mshta.exe javascript:...`、`powershell -enc ...` → 内存载荷
   - 关键: 只看样本自身进程会漏掉真实行为（样本借道白名单进程执行——见 [[re-sandbox]] 的 brokered execution 坑）；按整条进程树观察，父→子逐级记录
   - 无文件判定: 进程映像路径非常规（%TEMP%）、脚本引擎（wscript/cscript/mshta）加载远程或纯内存内容、无对应磁盘文件——载荷证据靠内存转储与命令行（见坑 3）

5. **与检测侧对齐（为什么被检测 → 规避点）**：
   - 把检测告警命中的内容（触发字符串/行为签名/导入表特征）与步骤 2-4 的证据对照，形成: 检测点（杀软签名/行为规则）→ 规避点（patch/混淆/lolbin）→ 仍可被检测的缺口（见坑 4 版本差异）
   - 输出: 规避手法清单 + 对应 IOC——内存 patch 后 amsi.dll/ntdll 的哈希、lolbin 组合的命令行模式、无文件载荷的内存特征（进 [[re-ioc]] YARA）
   - 结论必须标注验证环境（OS 版本/EDR 版本/杀软），规避有效性声明带版本限定

## 跨域联合

- [[re-anti-analysis]]：本技能是该网关的检测规避分支——壳/混淆是"静态反分析"，AMSI/ETW/无文件是"检测对抗"，编排上并列
- [[re-sandbox]]：动态执行强制前置——规避分析全程在隔离环境（网络隔离 + 快照，见 [[platform-tips]] 最高原则）
- [[re-memdump]]：内存 patch 定位与无文件载荷取证（默认转储优先）
- [[re-behavior]]：进程链/执行行为观察（lolbin 链的行为侧佐证）
- [[re-tracing]]：API 调用跟踪——patch 目标函数（AmsiScanBuffer/EtwEventWrite）的调用序列佐证绕过是否生效
- [[re-ioc]]：规避特征（内存哈希/命令行模式/lolbin 组合）进 IOC 与 YARA 规则
- [[re-malware]]：恶意样本的规避层分析（re-malware 行为分析后转本技能深挖规避）
- [[re-ebpf]]：驻留 bpf hook（fentry/kprobe/tracepoint/cgroup）的识别与反制
- 引用 [[platform-tips]] 最高原则（默认沙箱）与 Windows 分支

## 常见坑与陷阱

- **规避手段与反沙箱交织**：现象——沙箱里样本表现"正常"（无任何规避动作），真实环境才绕过；原因——规避代码里夹反沙箱检测（先探测环境再决定是否启用绕过）；对策——把"规避分析"与"环境伪装"分开（[[re-anti-analysis]] 域）：先定位反沙箱检测点（[[re-sandbox]] 的交互/时间/硬件指纹坑），或先按 [[re-behavior]] 的延迟观察拉长窗口，再分析规避逻辑
- **AMSI patch 触发完整性校验**：现象——patch 后样本行为异常/崩溃/检测反而升级；原因——EDR/Defender 校验 amsi.dll/ntdll 内存完整性（与磁盘比对哈希，见 [[re-anti-analysis]] AD13 自校验思路），或样本自身做自校验；对策——先确认校验存在（重复比对内存哈希频率），patch 改"校验看不见"的位置（hook 而非函数体、保持整体哈希一致），分析时记录 patch 时机与校验触发点
- **无文件样本取证难**：现象——磁盘上没有样本文件，报告无"物证"，结论站不住；原因——载荷全程在内存/远程脚本/注册表运行键，常规文件取证抓不到；对策——运行前先 [[re-memdump]] 全量转储 + procmon/Sysmon 记录命令行与网络；PowerShell 开 ScriptBlock 日志（事件 4104）；结论以内存证据 + 命令行 + 网络流为准，[[re-ioc]] 收内存哈希类特征
- **EDR 版本差异**：现象——同一 patch 手法在环境 A 成功、环境 B 失效或告警；原因——patch 偏移（如 AmsiScanBuffer 入口字节）随 Windows 补丁与 EDR hook 版本变化；对策——动态现场确认偏移（步骤 2 的内存对照法不依赖固定偏移，别信网上的硬编码偏移）；结论标注验证环境版本，规避有效性声明带版本限定
- **检测日志缺失 → 方向错误**：现象——没有 Sysmon/EDR 日志，无法确认"为什么被检测"，分析无从对齐；原因——环境未配置日志采集（默认 Windows 不记录 ProcessCreate 细节）；对策——补 Sysmon 配置（ProcessCreate + NetworkConnect + ImageLoad）+ PowerShell 4104，重跑复现；检测告警信息（杀软界面/EDR 事件）先截全再分析
