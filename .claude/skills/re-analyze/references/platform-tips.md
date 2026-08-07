# 平台经验知识库

> 跨大类共享的实战经验。所有技能的工具准备与操作步骤按 OS 分支执行。
> 原则：**先给最轻的可行方案**（Wine 直读 > 用户态仿真 > 全系统虚拟化 > 物理机）。

## 最高原则：默认沙箱

一切动态分析/运行样本默认在沙箱中执行（强制前置）：虚拟机快照 / 容器（Docker、firejail）/ 专用沙箱（Cuckoo/CAPE）；网络隔离（INetSim、fake DNS、断网）。静态分析可免沙箱，一切动态执行默认在沙箱内，分析结束后恢复快照。此原则优先于本文件所有其他条目。

## 平台分支

### 所有平台
- 动态分析默认沙箱（见上）。
- **入口之前执行点**：PE 的 TLS 回调与 ELF 的 `.preinit_array`/`.init_array`/`__libc_start_main` 的 init 参数都在入口点/main 之前执行——只断入口会漏掉入口前逻辑；动态断点设在 `ntdll!LdrpCallInitRoutine`（Windows）与 `__libc_start_main`（Linux）。
- **工具解析 ≠ 加载器视图**：损坏/歧义的头字段没有唯一正确解析，恶意样本利用解析器差异规避工具——工具报错 ≠ 文件损坏，先手工核对关键头字段，结论对照真实加载器语义复核。
- **反汇编函数边界有误差**：线性反汇编对 PE（代码节内联跳转表等数据）准确率约 99%，函数边界识别在主流工具中也有 20%+ 误判（尾调用/非标准序言/内联导致）——反编译结论需交叉验证，别全信工具的函数列表。

### Linux
- 分析 Windows PE 程序：**Wine 直读进程内存**——wine 运行 PE → `gdb attach` 或读 `/proc/<pid>/mem`，无需整机虚拟化；脱壳/读内存直接对 Wine 进程操作。
- 跑非本机架构程序：QEMU 用户态仿真（`qemu-<arch>`）优先，全系统仿真仅必要时用。

### Linux 内存转储极端段
- `[vsyscall]`（固定地址 `0xffffffffff600000`，只执行 `--xp`）、`[vdso]`/`[vvar]`：`/proc/<pid>/mem` 读取失败、gdb 访问报错均属正常。
- 转储前必须按 `/proc/<pid>/maps` 过滤这些段（只 dump `r--p`/`rw-p` 可读映射），否则 dump 含垃圾页、脱壳/分析全被污染。
- 识别特征：`maps` 中 `[vsyscall]`/`[vdso]`/`[vvar]` 名称、地址落在 `0xffffffffff6xxxxx` 高段、无文件路径的匿名 `00:00` 映射。

### Windows
- 读目标进程内存：需装 Sysinternals 套件（`procdump`）/ `DumpIt` 做内存转储 + Volatility 分析；attach 需要管理员权限。
- 常用工具链：x64dbg、Process Explorer（替代 System Informer）、APIMonitor。

### macOS
- attach/调试：SIP 与 TCC 限制，调试工具需授权（Developer Tools 权限），`lldb` attach 前检查。

### WSL
- WSL 无法直接 attach Windows 进程——跨边界分析走 Windows 侧工具，WSL 内只做文件/静态分析。

## 「直读 vs 转储」决策（默认转储优先）

一次转储获得完整内存布局 + 寄存器/线程状态（ELF notes），可导入 Ghidra/IDA、可存档复现；后续所有定向提取（密钥搜索、脱壳段、DEX 挖掘）都从转储产物里做。

| 场景 | 方案 |
|---|---|
| 默认（任何需要读内存的任务） | **转储** `gcore` → ELF core；取证/存档用全量转储 + manifest |
| 需要完整布局 + 寄存器/线程（导入调试器、事后复现） | **转储** `gcore`（含 ELF notes） |
| 进程已死 | 直接分析已有 core（`kernel.core_pattern` / systemd-coredump / 容器 runtime dump） |
| ptrace 被禁 / 沙箱容器 / attach 失败 | 转储兜底（不依赖 `/proc/<pid>/mem` 权限路径） |
| 特例①：进程必须保持运行、实时交互调试 | **直读** `/proc/<pid>/mem`：先读 maps 定址 → SIGSTOP 防竞态 → chunked `pread` 只取目标区段 |
| 特例②：只需极小特定区段且性能敏感 | **直读** 单区段，同上流程 |

**关键经验**：转储时机——脱壳须等进程运行到 OEP 完全解密后再 dump；直读前必须先查 maps；dump 前过滤 `[vsyscall]`/`[vdso]`。

## 来源（Task 15 调研，2026-08）

按查询分组的检索链接（WebSearch 实测结果）：

- TLS 回调 / init_array / 入口之前执行点：
  - DShield: How Malware Defends Itself Using TLS Callback Functions — https://secure.dshield.org/diary/How+Malware+Defends+Itself+Using+TLS+Callback+Functions/6655
  - Mandiant: Newly Observed Ursnif Variant Employs Malicious TLS Callback Technique — https://cloud.google.com/blog/topics/threat-intelligence/newly-observed-ursnif-variant-employs-malicious-tls-callback-technique-achieve-process-injection/
- ELF vs PE 分析误区：
  - USENIX Security 2016 (Andriesse): 函数边界/线性反汇编误差 — https://www.usenix.net/sites/default/files/conference/protected-files/security16_slides_andriesse.pdf
  - HAL 论文: PE 解析无唯一正确解（解析器差异规避） — https://hal.science/hal-04611598v1/file/publi-6603.pdf
  - CSDN 文库: Linux ELF 思维在 PE 上的 19 个符号假设性错误（__libc_start_main 幻觉/.interp 缺失误判） — https://wenku.csdn.net/column/38b5um95xq
  - inventivehq: Understanding PE, ELF, and Mach-O — https://inventivehq.com/blog/executable-file-formats-guide
  - binutils 邮件列表: COFF vs ELF 未定义符号处理差异 — https://www.sourceware.org/pipermail/binutils/2025-June/142006.html
  - CyberChallenge 2024 课件: 伪造 ELF 头字段使 readelf 报错 — https://cyberchallenge.it/assets/data/workshop/2024/files/CCIT2024%20-%20Workshop%20-%20Keynote%20-%20Van%20Eeden.pdf
- 进程内存取证 vsyscall/vdso：
  - StackOverflow: What are vdso and vsyscall（固定地址/ASLR/auxv） — https://stackoverflow.com/questions/19938324/what-are-vdso-and-vsyscall/19942352#19942352
  - DEF CON 23 (O'Neil): Advances in Linux Forensics (ECFS，core 低分辨率与重建) — https://infocon.org/cons/DEF%20CON/DEF%20CON%2023/DEF%20CON%2023%20presentations/DEF%20CON%2023%20-%20Ryan-O%27Neil-Advances-in-Linux-Forensics-ECFS.pdf
- 恶意持久化（注册表/WMI/计划任务）：
  - win-persistence-checker（注册表 ASEP 检测工具） — https://github.com/cwsecur1ty/win-persistence-checker
  - analyzing-malware-persistence-with-autoruns — https://github.com/mukul975/anthropic-cybersecurity-skills/blob/main/skills/analyzing-malware-persistence-with-autoruns/SKILL.md
  - RootGuard knowledge-base: persistence TA0003 技术库（隐藏计划任务 SD 删除） — https://github.com/andranglin/RootGuard/blob/master/knowledge-base/mitre-aligned-threat-dectection/persistence-ta0003-techniques.md
  - Blue-Team-Scripts: Malware Persistence Mechanisms — https://deepwiki.com/jwardsmith/Blue-Team-Scripts/6.2-malware-persistence-mechanisms
- 进程注入检测：
  - detecting-t1055-process-injection-with-sysmon（Sysmon 事件 8/10/7/25） — https://github.com/seikaikyo/dash-skills/blob/main/external/anthropic-cybersecurity-skills/skills/detecting-t1055-process-injection-with-sysmon/SKILL.md
  - detecting-process-injection-techniques — https://github.com/mukul975/Anthropic-Cybersecurity-Skills/blob/main/skills/detecting-process-injection-techniques/SKILL.md
  - Hexnode: What is Process Injection（mavinject 等 LOLBin 滥用） — https://www.hexnode.com/blogs/explained/what-is-process-injection/
- YARA 规则最佳实践：
  - Trail of Bits: yara-rule-authoring（atom 质量/条件顺序/模块取舍） — https://github.com/trailofbits/skills/blob/e8cc5baf9329ccb491bfa200e82eacbac83b1ead/plugins/yara-authoring/skills/yara-rule-authoring/SKILL.md
  - performing-threat-hunting-with-yara-rules — https://github.com/seikaikyo/dash-skills/blob/main/external/anthropic-cybersecurity-skills/skills/performing-threat-hunting-with-yara-rules/SKILL.md
  - VMware Security Blog: Hunting IcedID and unpacking automation（针对壳结构写规则） — https://blogs.vmware.com/security/2021/07/hunting-icedid-and-unpacking-automation-with-qiling.html
  - Google GTI: YARA-X Livehunt 规则编写 — https://security.googlecloudcommunity.com/google-threat-intelligence-3/agentic-google-threat-intelligence-query-to-help-write-yara-x-rules-for-livehunts-7242
