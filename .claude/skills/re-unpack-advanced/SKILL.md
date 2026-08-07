---
name: re-unpack-advanced
description: 强壳脱壳：VMProtect/Themida。触发词：VMProtect、Themida、强壳、虚拟化壳、手动脱壳
---

# 脱壳：强壳（VMProtect/Themida）

## 何时使用 / 何时不用

- 用：[[re-packer-id]] 识别为强壳 / 虚拟化壳（VMProtect、Themida、Enigma 等）；简单壳手动流程失败（可能套强壳）；样本存在多层反调试拦截普通调试
- 用：需要干净样本做深度静态分析 / 破解前置（[[re-cracking]] 路径）
- 不用：简单压缩壳（[[re-unpack-simple]] 秒解，别用重流程）
- 不用：虚拟化代码可接受黑盒标注的目标（标记绕过比还原省 10 倍时间，见坑 2）
- 注意：本技能高成本、易失败——先评估目标价值与"只标注不还原"是否够用

## 工具准备

### 调试器（按 OS）

- Linux / Wine 下调试 PE: [[re-gdb]] —— `apt install gdb` / `dnf install gdb` / `pacman -S gdb`；**Wine 直读**：`wine sample.exe` 后 `gdb -p <pid>` attach（见 [[platform-tips]] Linux 分支）
- Windows: [[re-x64dbg]] —— 官方 release zip；x64dbg 对强壳的附加/断点支持更好，强壳场景优先
- WSL: 无法 attach Windows 进程，走 Windows 侧工具（[[platform-tips]] WSL 分支）
- 验证: `gdb --version`；x64dbg 能载入样本并单步

### Scylla（IAT 修复，含重定向处理）

- x64dbg 新版内置；独立版 GitHub `NtQuery/Scylla` release
- Wine 环境：独立版 Scylla 可 attach Wine 进程（失败则在 Windows 环境完成）
- 验证: x64dbg 插件菜单出现 Scylla

### scyllaHide（反反调试，GitHub）

- GitHub `x64dbg/ScyllaHide` release zip；x64dbg 插件目录放入后启用；release 内含 Wine 加载方案
- 作用：批量隐藏调试痕迹（NtQueryInformationProcess、ThreadHideFromDebugger、时间差、调试端口等）
- 验证: x64dbg 插件菜单出现 ScyllaHide，勾选选项后能隐藏对应检测

### 脚本工具（脱壳辅助/标注）

- idapython: IDA 自带（[[re-ida]] 工作流），验证：IDA 内 `File > Script Command` 能执行 Python
- rizin 脚本: `apt install rizin` / `dnf install rizin` / `pacman -S rizin` / `brew install rizin`，验证 `rizin -v`

## 操作步骤

按顺序执行，每步记录结果（证据路径 + sha256，见 [[re-triage]]）。

1. **反调试对抗（scyllaHide 思路）**：
   - 核心检测点：`NtQueryInformationProcess`（ProcessDebugPort / ProcessDebugFlags / ProcessDebugObjectHandle）、`NtSetInformationThread`（ThreadHideFromDebugger）、时间差（`RDTSC` / `GetTickCount` / `QueryPerformanceCounter`）、调试端口（`NtQuerySystemInformation`）、窗口 / 进程名枚举。
   - x64dbg + ScyllaHide：插件菜单勾选全部选项 → 以隐藏状态启动目标。Wine 下用 release 内 wine 方案加载后再 attach。
   - **先攻最外层**：检测通常是链式，先静态定位最外层检测点（用 [[re-ida]] / [[re-radare2]] 找 `NtQueryInformationProcess` 的 xref），scyllaHide 批量隐藏 + 剩余单点 patch（见坑 1）。

2. **找 OEP（堆栈回溯 / 内存断点组合）**：
   - **入口 ≠ 原始程序逻辑入口**：虚拟化壳仍有"入口"——EP 加载后控制流进入壳代码（Themida 等是进 VM dispatcher），这个入口只是壳的加载/分发点，不是原始程序的逻辑入口。"虚拟化壳无 OEP 概念"的说法不准确——原始入口仍存在，只是被壳藏进 / 绕经 VM 解释层（见坑与陷阱"VM 入口特征随构建变异"），定位它才是本步目标。
   - 堆栈回溯：强壳 stub 尾部以 `ret` 回到 OEP——单步 / 断点停在 `ret`，看栈顶地址即 OEP 线索（stub 常多段、多线程，多断几次取规律）。
   - 内存断点组合：`bp VirtualAlloc`（x64dbg；gdb/Wine 用 `break *VirtualAlloc`）→ 每次返回后检查分配区域是否被写入可执行内容 → 对该区域下内存访问断点（View > Memory Map > 目标节 > Set breakpoint on access）→ 在"最后一次解密写入"后断下，附近即 OEP。
   - OEP 特征：函数序言（`push ebp; mov ebp,esp`）+ 密集正常 API 引用。记录 OEP 地址与镜像基址。

3. **转储（默认转储优先）**：
   - Linux/Wine：运行到 OEP 后 `gcore -o out <pid>`（默认转储优先，完整流程见 [[re-memdump]]；转储前按 maps 过滤 vsyscall/vdso；时机见 [[platform-tips]] 关键经验）。
   - Windows：x64dbg 到 OEP → Scylla → Attach → 填 OEP → Dump。
   - 转储前后各存 sha256，便于对比验证。

4. **IAT 修复（Scylla，含重定向处理）**：
   - `Plugins > Scylla > IAT Autosearch` → `Get Imports` → 逐项检查 "invalid" 导入。
   - **重定向处理**：强壳把 API 调用劫持到壳 stub（VM 内转跳）——对指向 VM stub 的无效项：记录重定向关系（原始 API → stub 地址），用 idapython / rizin 脚本批量把 stub 标注回真实 API；无法解析的项标记并在后续分析中手工补（先 `Get Imports` 确认大部分正常 API 已解析）。
   - **IAT Autosearch 异常时的导入关系恢复（三线索）**：Autosearch 找不到 / 大量 invalid，别只重跑 Autosearch——① **API 调用链**：定位实际 `CALL [addr]` 调用点，逆推地址表；② **解析函数**：找壳的 API 解析循环（GetProcAddress 调用点或其 API hash 解析实现），在**内存写入点**下断，记录它往 IAT 区写入的地址；③ 强壳可能 **API hash / 动态解析 / syscall 直通**（无 IAT 可修）——转入"标注"路径（记录调用点语义，思路见步骤 5）。**跟踪"第一个 API 调用"不是通用法**：强壳的解析可能发生在多线程 / 延迟阶段，或直接 syscall 直通（无 API 调用可跟）。
   - **延迟导入 / bound import / API resolver**：Scylla 对延迟导入勾选 `Delayed` 选项（处理延迟导入表）；bound import 按绑定时间戳判断并替换为真实导入；API resolver 类壳（运行时才解析）运行到 API 实际使用点后再 `Get Imports`，别在早期阶段 Fix Dump。
   - `Fix Dump` 输出修复后 exe；重新反编译验证导入表（[[re-ghidra]] / [[re-ida]]）。

5. **虚拟化代码区域标注（不还原则标记绕过）**：
   - **目标=降低 VM 解释层复杂度**：虚拟化保护的对抗目标是降低虚拟机解释层的分析复杂度，不是"把虚拟化函数还原成原始代码"——后者对 VMProtect/Themida 不存在可行路径。可达成目标二选一：**VM 还原**（极少数关键校验，还原 handler 语义重写逻辑）或**标注绕过**（黑盒观察输入输出）。投入按"可分析性"验收，不按"还原度"验收。
   - 定位 VM 入口：VMProtect 的 VM_Entry 形态 `push imm32; mov eax, imm; jmp vm_handler`（Themida 类似，节名 `.vmp0`/`.vmp1`/`.themida`）。
   - **标注而非还原**：把虚拟化函数标为黑盒（记录入口地址、参数个数、调用点清单），后续分析用动态观察输入/输出（[[re-gdb]] / [[re-x64dbg]] 断在 VM 入口记录参数与返回值）替代静态还原。确需还原的极少数关键校验（如注册码验证）才投入逆向 VM 字节码。
   - 产出：`vm_blackbox.txt` 标注清单（地址 → 说明），随分析报告存档。

## 跨域联合

- [[re-anti-analysis]]：工作流第 4 步（强壳分支）固定调用本技能；识别不出 / 简单壳流程失败的未知壳也走本流程
- [[re-analyze]] 的 triage「样本带壳 / 脱壳」路径调用
- [[re-malware]]：强壳恶意样本（VMProtect 加壳的常见）
- [[re-cracking]]：破解前置——带强壳先脱壳，再定位授权逻辑
- 配套：[[re-memdump]]（默认转储）、[[re-sandbox]]（脱壳产物复跑验证）、[[re-tracing]]（反调试检测 trace 环境时配合）、[[re-ida]] / [[re-radare2]]（静态定位检测点与 VM 入口）

## 常见坑与陷阱

- **反调试链多层 → 先攻最外层**：现象——scyllaHide 全开仍被踢，或过了一个检测又被下一个拦；原因——检测是链式的（外层过才触发内层）；对策——逐层攻：先静态定位最外层检测点（xref `NtQueryInformationProcess` / 时间差函数），scyllaHide 批量隐藏常规项，剩余单点 patch 后继续
- **VM 代码还原成本高 → 标记而非还原**：现象——陷在 VMProtect 字节码逆向里数天，进度停滞；原因——虚拟机指令集私有、还原工程量巨大；**目标设错——原始代码不是虚拟化保护的可达产物**；对策——**目标=降低 VM 解释层复杂度**（VM 还原 / 标注绕过两条路，见步骤 5），把虚拟化区域标为黑盒，动态观察输入输出（断 VM 入口记参数/返回值），只还原真正关键的小段（如注册码校验），**按"可分析性"验收而非"还原度"**
- **多线程壳（监控线程）干扰**：现象——调试中被踢、进程自毁、断点打上就被线程改掉；原因——壳起监控线程检测调试状态；对策——入口处挂起多余线程（x64dbg `Threads` 面板 Suspend；gdb `info threads` 后单线程 continue），只在目标线程内推进
- **壳检测调试器环境**：现象——一开调试器进程就退出 / 立即自毁；原因——检测调试端口、父进程名、窗口名（`FindWindowA`）、时间差；对策——ScyllaHide 隐藏 + 调试器进程改名 + 先静态 patch 检测点再 attach；仍在沙箱快照内操作（[[re-sandbox]]）
- **硬件断点被壳检测**：现象——ESP 定律的硬件访问断点不触发 / 一下断进程即退出；原因——新版 Themida 等检测硬件调试寄存器（DR0-3）；对策——ScyllaHide 用注入方式隐藏（配套 `HookLibraryx86.dll` + `InjectorCLIx86.exe` 配置），或改用内存断点 / TitanHide，再不行先静态 patch 检测点再 attach
- **VM 入口特征随构建变异 → 别只靠签名**：现象——按教程特征找 VM 入口 / dispatcher 定位失败，或还原产物错乱；原因——VMProtect 的 handler 每次构建都会变异（同 opcode 不同代码）、dispatcher 含 opaque predicate、多层 VM（VM 套 VM）叠加（见 [[re-deobfuscate]] 的 opaque predicate 处理）；对策——先试自动化框架（x64Unpack 混合仿真 / DragonSlayer 符号执行+污点跟踪），手动时用动态 trace 记录 handler 执行序列，以"字节码指针寄存器 + 循环分发"定位而非固定签名
- **带强壳名的样本未必启用虚拟化**：现象——DIE 报 VMProtect/Themida 就上全套强壳流程，标准断点技巧其实就能脱出；原因——虚拟化/反调试是壳的配置选项，大量真实样本（RisePro/Amadey/PrivateLoader 等）未启用、无反调试；对策——先试常规流程（VirtualAlloc 断点 + 内存断点 + 单步），确认 VM 分发型入口确实存在再投入高成本还原
- **把壳入口当原始入口 / 以为虚拟化壳"无入口"**：现象——在壳入口（VM dispatcher 分发点）找不到原始逻辑就判定"强壳无 OEP 概念"放弃，或在 dispatcher 里死挖原始代码；原因——混淆"壳入口"（EP 后进入的加载/分发点）与"原始程序逻辑入口"（被虚拟化藏起的原始 OEP）；对策——壳入口是客观存在的（Themida 加载即进 dispatcher），用它下断/设日志观察初始化行为；原始逻辑入口按步骤 2 定位，虚拟化部分按步骤 5 处理
- **IAT 修复死磕 Autosearch**：现象——IAT Autosearch 找不到 / 导入全 invalid，反复重跑仍无果；原因——强壳运行时重建导入表（API hash / 动态解析 / syscall 直通），静态无表可搜；对策——改用步骤 4 三线索（调用链 / 解析函数 / 内存写入点）恢复导入关系，无法恢复的项转标注；"跟踪第一个 API 调用"在强壳不是通用法（多线程 / 延迟解析 / syscall 直通时没有可跟的调用），别在首调上耗时间
- **把"找到 OEP"当脱壳成功**：现象——停在 OEP、转储、IAT 修复都做了，反编译结果仍不可用（代码段还是壳数据 / 重定位全乱 / 异常表指向壳代码 / 运行即崩），反复重脱无果；原因——把脱壳定义窄化为"找到 OEP"；对策——**脱壳=恢复可分析状态**：代码段为真实指令、导入表可解析、重定位 / 异常表 / 加载配置与真实映像一致（逐项核对见 [[re-format-pe]]），验证通过才算完成，缺哪项修哪项
- **反调试在入口断点前已跑（TLS 回调抢先）**：现象——在 EP 下断点/单步，反调试检测却已先触发（启动即退出或状态已被改过），入口断点根本没生效；原因——TLS 回调（TLS Callback）比 Entry Point 更早执行，壳把反调试藏进 TLS 回调；对策——先查 PE 的 TLS 目录（[[re-format-pe]]）列出回调地址，在回调入口下断 / 静态分析回调内逻辑，入口断点没触发反调试时优先查 TLS（见 [[re-anti-analysis]] 反调试方法论 AD18）
- **反调试不退出而是给假逻辑**：现象——过掉检测点后进程不退出，但返回错误数据 / 算法结果被改 / 关键逻辑被跳过 / 执行被延迟，脱壳产物行为诡异难定位；原因——反调试可能故意制造假逻辑（返回错误数据/修改算法结果/延迟执行/跳过关键逻辑），比直接退出更常见；对策——patch 检测点后别直接信任输出，对比"检测为真 / 为假"两条路径的结果差异，先确认检测结果如何影响控制流（退出/降功能/假数据/延迟）再决定改法（见 [[re-anti-analysis]] 反调试方法论 AD44）
