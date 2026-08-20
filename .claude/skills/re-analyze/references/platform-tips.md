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
- **32 位程序**：gdb 架构切换影响 ABI/寄存器集/调用约定——调 32 位目标先确认调试器架构模式与目标一致；Windows 侧 32 位目标对应 x32dbg；Wine 跑 32 位 PE 用 wine32 前缀（WINEARCH=win32）。

### Linux
- 分析 Windows PE 程序：**Wine 直读进程内存**——wine 运行 PE → `gdb attach` 或读 `/proc/<pid>/mem`，无需整机虚拟化；脱壳/读内存直接对 Wine 进程操作。
- 跑非本机架构程序：QEMU 用户态仿真（`qemu-<arch>`）优先，全系统仿真仅必要时用。
- **attach 权限不是非黑即白**：ptrace_scope=1 限制子进程/父子关系/PR_SET_PTRACER——同属主不一定能 attach，还需父子关系或目标声明 PR_SET_PTRACER；root 也可能受限；容器内 CAP_SYS_PTRACE 影响 attach 能力。
- **QEMU 用户态仿真的主要差异**：QEMU 用户态最大问题=syscall ABI/kernel feature/指令扩展（非 libc）——程序跑不起来先按这三点排查，别只补库。

### Linux 内存转储极端段
- `[vsyscall]`（固定地址 `0xffffffffff600000`，只执行 `--xp`）、`[vdso]`/`[vvar]`：`/proc/<pid>/mem` 读取失败、gdb 访问报错均属正常。
- 转储前必须按 `/proc/<pid>/maps` 过滤这些段（只 dump `r--p`/`rw-p` 可读映射），否则 dump 含垃圾页、脱壳/分析全被污染。
- 识别特征：`maps` 中 `[vsyscall]`/`[vdso]`/`[vvar]` 名称、地址落在 `0xffffffffff6xxxxx` 高段、无文件路径的匿名 `00:00` 映射。

### Windows
- 读目标进程内存：需装 Sysinternals 套件（`procdump`）/ `DumpIt` 做内存转储 + Volatility 分析；attach 需要管理员权限。
- 常用工具链：x64dbg、Process Explorer（替代 System Informer）、APIMonitor。
- **attach 失败先区分权限与 PPL/保护进程**：管理员解决普通限制，PPL 取决于 Signer Level 等级（EDR 常见 PPL-Windows TCB/Antimalware），需对应级别调试能力。
- **Windows 读 Linux 样本**：静态无平台限制，动态需匹配运行环境——静态分析可在 Windows 侧直接进行，要运行样本则准备匹配的 Linux 环境（VM/容器）。

### macOS
- attach/调试：SIP 与 TCC 限制，调试工具需授权（Developer Tools 权限），`lldb` attach 前检查。
- **attach 失败层次**：task_for_pid entitlement/SIP/Hardened Runtime——Developer Tools 授权之外，调试器自身需 task_for_pid entitlement，目标启用 Hardened Runtime 时调试 API 受限。

### 沙箱
- **容器调试缺 SYS_PTRACE**：容器内 attach 受限来源=SYS_PTRACE 能力、/proc 挂载、seccomp、Yama 限制——先确认容器配置（如 `--cap-add=SYS_PTRACE`）再判断"环境限制"还是"程序不可分析"。
- **沙箱隔离≠分析环境伪装**：时间/硬件/输入检测是环境指纹，完整 VM 也会被检测——隔离保证安全，不保证"像真实环境"；环境指纹对抗单独处理。

### WSL
- WSL 无法直接 attach Windows 进程——跨边界分析走 Windows 侧工具，WSL 内只做文件/静态分析。

## 原则：分析前确认（动态分析前置）

动态分析前先确认目标 ABI、执行环境、权限模型，否则调试失败不代表程序不可分析——失败先归因（架构/环境/权限），再决定换方案还是下结论。

## 原则：静态优先（大型样本）

静态与动态不是替代关系，大型样本静态定位先行、动态验证在后——先静态缩小范围，动态按需补充。

## 原则：模拟执行优先（能跑就不逆向）

目标含官方原生库（签名算法/加密例程/混淆 VM）时，**模拟执行官方代码比逆向算法快一个数量级**——数周逆向 vs 一天模拟。适用场景：目标库可加载（依赖可满足）、调用方是 JNI/导出函数、只需"结果"不需"原理"。判定信号：算法复杂度高（轮数多/查表大/混淆深）、有现成库可加载、社区有同类模拟先例。
- 常用载体：unidbg（Android so + JNI 模拟，Java）、QEMU 用户态（`qemu-<arch>` + sysroot）、Qiling/Unicorn（单函数隔离）
- 模拟执行产出"看起来正常"的结果不等于正确——**真实环境/服务器响应才是唯一裁判**（模拟环境可能被检测并返回诱饵结果），先用低风险路径验证（白名单命令/非敏感操作），再决定是否触碰高价值目标

## 原则：JNI 导出名 = 协议契约路标

Java 层逆向时，`Java_包名_类名_方法名` 导出是**天然接口文档**——函数名直接给契约（encodeRequest/parseData/setAccountKey 一眼分工）；stripped 的 so 也保留 JNI 导出（JVM 运行时需要）。原生库逆向永远从 `nm -D` 列 JNI 导出开始。

## 原则：序列化/反序列化函数对互证

帧/包格式读 serialize 函数拿布局，再用 deSerialize 验证——**两个方向对上了才是真的**。协议类库通常同时含打包/解包函数（serialize/parse、encode/decode），互为对照。

## 原则：社区逆向成果先搜再挖

同类目标的开源项目是**前人逆向成果的沉淀**——协议结构、密钥表、算法还原、模拟器回调集都在里面。自挖之前先搜（GitHub 镜像/码云/codeload、相关生态项目）；即使版本/目标不同，**结构、模式、回调清单可移植**。自己从零解析的时间成本通常是移植的 10 倍。

## 工具链避坑（实测）

- **IDA interr（decompiler bug）**：`create_stkvar` 类内部错误硬崩溃且无法跳过——换 Ghidra，别硬刚
- **Ghidra 脚本 API 版本差异**：新版 MemoryBlock 无 `getPermissions()`（改 `getExecute()`）；脚本编译失败先查 API
- **dex 解析细节**：opcode 是 **u16 低字节**（高字节是寄存器位）；`fill-array-data` 是 **0x26**（31t）、goto 是 **0x28**（0x24 是 filled-new-array）；string_data_item 有 **uleb128 长度前缀**；code_item 的 `insns_size` 在 **+12**（+4 是 outs_size）
- **GitHub 下载不稳**：`codeload.github.com` 比 `github.com` 稳（git clone 被重置时 curl codeload 可通）

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
