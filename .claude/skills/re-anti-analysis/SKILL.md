---
name: re-anti-analysis
type: gateway
description: >
  反分析对抗网关。编排：壳识别 → 简单壳脱壳 → 强壳脱壳 → 反混淆。
  子技能：[[re-packer-id]] [[re-unpack-simple]] [[re-unpack-advanced]] [[re-deobfuscate]] [[re-evasion]]。
  触发词：脱壳、查壳、加壳识别、壳、UPX、VMProtect、Themida、反调试、反混淆、花指令、unpack、anti-analysis。
---

# 反分析对抗（壳识别 / 脱壳 / 反混淆）

## 完整工作流

1. **壳识别：[[re-packer-id]]** —— 先识别再动手。DIE/PEiD 签名库扫描、节名异常（UPX0/.aspack/自定义）、入口点是否指向非首节、熵 >7、导入表极小。**先记 OEP 线索**（EP 附近 pushad 等壳入口特征），识别出的壳名决定路径
2. **分派**：简单压缩壳（UPX/ASPack/FSG）→ [[re-unpack-simple]]；强壳/虚拟化壳（VMProtect/Themida）→ [[re-unpack-advanced]]；**识别不出 → 手动流程**（按 [[re-unpack-simple]] 的 ESP 定律 + 内存断点手动找 OEP，或按强壳流程处理），不硬猜壳名
3. **简单壳脱壳：[[re-unpack-simple]]** —— 优先官方/自动解包（`upx -d`）→ ESP 定律 / 内存断点找 OEP → **OEP 解密完成后转储**（时机见 [[platform-tips]] 关键经验，默认转储优先）→ IAT 修复（Scylla/ImpREC，Windows）
4. **强壳脱壳：[[re-unpack-advanced]]** —— 反调试对抗（scyllaHide 思路：NtQueryInformationProcess/时间差）→ 堆栈回溯/内存断点组合找 OEP → 转储（默认转储优先）→ IAT 修复（含重定向）→ 虚拟化代码区域标注（标记绕过而非还原）
5. **反混淆：[[re-deobfuscate]]** —— 脱壳后若仍有花指令 / 控制流平坦化 / 字符串加密：花指令清除、平坦化还原（D-810/手动）、字符串解密循环定位与仿真、批量脚本化、还原前后对比验证
6. **验证**：脱壳产物 sha256 存档 → 沙箱内复跑（[[re-sandbox]] 判定脱干净、[[platform-tips]] 最高原则）→ 导入 [[re-ghidra]] / [[re-ida]] 确认 OEP 处可正常反编译；导入表可解析才算完成。产物交回原调用域继续（恶意样本回 [[re-malware]] 行为分析、破解目标转 [[re-cracking]] 授权定位）

每步结果存档（证据路径 + sha256，见 [[re-triage]]）；壳指纹 / 脱壳产物是 [[re-ioc]] YARA 特征来源。

## 反调试方法论

本网关适用的反调试分析方法论（用户实战经验），各技能坑与陷阱引用此处。

### 基础检测

- **AD1 启动即退出先查调试检测**：EP/TLS/初始化函数
- **AD2 IsDebuggerPresent 不代表完整反调试**：组合检测，别只 patch 一点
- **AD3 PEB BeingDebugged 用户态快速检测**：找 PEB 访问/BeingDebugged/NtGlobalFlag
- **AD4 NtGlobalFlag 异常→查堆调试标志**
- **AD5 CheckRemoteDebuggerPresent 不可靠**：可能被 hook/替换/底层
- **AD6 NtQueryInformationProcess 是重点**：ProcessDebugPort/ProcessDebugObjectHandle/ProcessDebugFlags
- **AD24 断 WinAPI 没命中 → 可能直接走 Native API**：程序不一定调用 IsDebuggerPresent 等高层 API，可能直接调用 NtQueryInformationProcess、NtSetInformationThread、Zw 系列。分析时向下追。

### 异常机制

- **AD7 异常没崩溃→可能反调试**：INT3/INT 2D/单步异常
- **AD32 INT3 不止一种形式**：CC vs CD 03 长断点，异常行为不同
- **AD33 INT 2D 是 Windows 特殊反调试点**：调试器下/正常运行行为不同
- **AD34 ICE 指令检测单步**：F1 ICEBP
- **AD26 异常断点行为异常→查 VEH**：AddVectoredExceptionHandler——INT3 被主动处理/单步异常被吞/异常后继续运行
- **AD27 SEH 链异常→可能反调试控制流**：控制跳转/隐藏流程/检测 debugger

### 时间检测

- **AD8 断点后行为变化→查 Trap Flag**：EFLAGS/异常次数
- **AD9 时间突然变慢→查时间反调试**：QPC/GetTickCount/timeGetTime/RDTSC
- **AD10 RDTSC 检测不要只看一次读取**：start-end delta、比较阈值、分支位置
- **AD11 Sleep 检测→查时间加速**：Sleep(5000)+检查实际经过时间——调试环境/沙箱加速/时间跳跃
- **AD35 时间检测不只 RDTSC**：RDTSCP/QPC/GetTickCount64/APIC timer

### 环境与工具特征

- **AD12 窗口/鼠标检测→环境真实性**：自动化沙箱
- **AD16 调试器窗口检测低级但常见**：OllyDbg/x64dbg/WinDbg/IDA 窗口类或进程名
- **AD17 进程列表检测→查工具指纹**：debugger/monitor/sandbox，易误报
- **AD38 窗口检测只是低级手段**：高级样本更倾向 API 行为/内存特征/异常行为
- **AD39 父进程检测**：explorer→app vs debugger→app 启动链
- **AD40 命令行检测**：debugger/sandbox/分析环境参数
- **AD31 程序只在 x64dbg 崩→查调试器特征**：x64dbg 模块/窗口类/DLL 名称/内存特征
- **AD36 CPU 特征检测可能用于反调试**：程序可能读取 CPUID、MSR、TSC 特性，用于区分真实机器、VM、调试环境。

### 硬件痕迹

- **AD29 硬件断点也失效→可能检测 DR 寄存器**：DR0-DR3/DR7 或异常行为
- **AD43 调试寄存器不是唯一硬件痕迹**：DR/LBR/性能计数器状态
- **AD15 硬件断点检测→查 DR 寄存器**：DR0-DR3/DR6/DR7

### 线程与调试对象

- **AD25 线程突然消失→查 NtSetInformationThread**：ThreadHideFromDebugger——主线程正常/逻辑断点无效/调试器看不到异常
- **AD30 调试器暂停后逻辑变化→查 Debug Object**：ProcessDebugObjectHandle
- **AD37 调试器导致线程调度变化**：线程执行顺序/锁竞争/APC 调度

### 自修改与断点

- **AD13 断点被清除→查硬件断点/自校验**：0xCC 检测——校验代码段/比较 hash/扫描 0xCC
- **AD14 代码执行后恢复原样→可能是自修改**：静态内容≠实际执行内容，需内存 dump/执行跟踪
- **AD28 断点后代码改变→检查 self-modifying code**：55 8B EC→CC 8B EC——校验代码/恢复字节/主动检测断点

### 深层检测

- **AD41 PEB 检测不仅是 BeingDebugged**：NtGlobalFlag/ProcessHeap flags/HeapForceFlags
- **AD42 内核调试检测**：KdDebuggerEnabled/KdDebuggerNotPresent
- **AD44 反调试可能故意制造假逻辑**：返回错误数据/修改算法结果/延迟执行/跳过关键逻辑——比退出更常见
- **AD21 内核级反调试→用户态 patch 无效**：驱动/内核回调/内核对象检查需分析内核路径
- **AD22 反虚拟化≠反调试**：目标不同——观察者 vs 分析环境，不要混为一谈

### 方法论

- **AD18 TLS Callback 比 Entry Point 更早执行**：入口断点没触发反调试→查 TLS
- **AD23 入口断点没触发 → 不一定没执行，可能被 TLS callback 抢先**：Windows PE 的 TLS callback 可以在 Entry Point 前执行代码。遇到程序启动即退出、入口断点无效，优先检查 TLS Directory。典型场景：anti-debug 初始化、壳初始化、环境检测。
- **AD19 反调试逻辑不要急着 patch**：先确认检测结果如何影响控制流——退出/降功能/假数据/延迟
- **AD20 多点反调试→找汇聚点**：多个检测汇聚到一个 flag/状态变量/错误处理函数
- **AD45 Patch 反调试点可能触发完整性检测**：JNZ→JMP/CALL→NOP 触发 CRC/hash/self-check，先找检测链

## 反虚拟化方法论

本网关适用的反虚拟化分析方法论（用户实战经验），各技能坑与陷阱引用此处。

### 指令级与固件信息检测

- **AV-001 CPUID hypervisor 位检测**
  - **Trigger**：程序执行 CPUID leaf 1，检查 ECX bit 31（hypervisor present bit）
  - **Observation**：ECX bit 31 置位，表明当前运行在 hypervisor 之下
  - **Inference**：样本在探测虚拟化环境——反虚拟化检测最常见的起点
  - **Action**：继续 CPUID vendor leaf（0x40000000）确认 hypervisor 类型（Microsoft Hv / VMwareVMware / KVMKVMKVM 等）
  - **Constraint**：hypervisor_present ≠ 一定是恶意分析环境——云主机与正常用户系统同样有 hypervisor，仅凭该位不能断定是分析环境
- **AV-002 注册表 BIOS/System 信息**
  - **Trigger**：程序读取注册表 BIOS/System 信息（Manufacturer / ProductName / BIOS Version）
  - **Observation**：读取值被用于关联 VMware / VirtualBox / Hyper-V 特征字符串
  - **Inference**：注册表固件信息是 VM fingerprinting 的常见来源
  - **Action**：定位读取点与特征字符串匹配逻辑，收集全部命中的 VM 特征项
  - **Constraint**：单个字符串命中不能作为 VM 判断依据——需多特征联合判定

### 时间与硬件特征

- **AV-003 Sleep 前后时间差**
  - **Trigger**：Sleep 前后实测时间差明显短于预期
  - **Observation**：样本 Sleep(N) 后检查实际经过时间，明显小于 N——时间被加速/压缩
  - **Inference**：样本可能检测沙箱时间加速/虚拟化时间（计时 API 被 hook 或时钟被加速）
  - **Action**：跟踪 RDTSC / QPC / GetTickCount 来源——定位时间读数点与差值计算逻辑，确认样本所用时钟源
  - **Constraint**：时间检测常多点组合（RDTSC 配 CPUID 强制 VM exit、GetTickCount / QPC 交叉验证），别只处理一处
- **AV-004 硬件设备枚举**
  - **Trigger**：程序枚举硬件设备（PCI / Disk model / GPU name）
  - **Observation**：枚举结果与虚拟机硬件型号特征比对
  - **Inference**：VM fingerprinting——硬件设备型号是常见 VM 指纹来源
  - **Action**：建立硬件特征集合而非单点判断——列出全部被检查的硬件项，按集合整体评估
  - **Constraint**：单一硬件特征（如某块 disk model）不足以判定 VM，需特征集合联合评估

### 环境评分与交互检测

- **AV-005 检测结果汇聚统一变量**
  - **Trigger**：多个 VM 检测函数的检测结果写入统一变量（is_vm / sandbox_score / env_flag）
  - **Observation**：多处检测代码汇聚到同一变量/状态
  - **Inference**：样本采用环境评分机制——多检测项计数/加权汇成环境评分
  - **Action**：追踪汇聚变量——在变量读写处下断或静态追 xref，避免逐检测点分析
  - **Constraint**：只看单个检测点会漏掉整体评分逻辑——评分阈值与组合方式是关键
- **AV-006 用户交互检测**
  - **Trigger**：程序检测用户交互（鼠标 / 键盘 / uptime / 窗口活动）
  - **Observation**：样本检查鼠标移动、键盘输入、系统 uptime、窗口活动等交互痕迹
  - **Inference**：样本试图区分真实用户与自动沙箱——交互痕迹属于行为级环境指纹
  - **Action**：转向行为级分析而非硬件指纹——交互相关分支需动态配合（模拟交互或真实环境观察）
  - **Constraint**：交互检测多为行为级，纯静态难以完整还原——需与动态观察结合

### 虚拟化通道与执行路径

- **AV-007 VMware 专有通道调用**
  - **Trigger**：程序调用 VMware backdoor / Guest Additions / vmtools
  - **Observation**：样本访问 VM 专有通道（VMware I/O port backdoor、vmtools 服务/进程、Guest Additions 模块）
  - **Inference**：高概率虚拟化检测——这些通道只在虚拟机环境中真实存在
  - **Action**：确认调用结果如何影响控制流——定位 backdoor 调用点与返回值使用位置，再决定 patch 策略
  - **Constraint**：检测到 VM 通道不一定会退出——先看检测结果流向再动手
- **AV-008 检测结果影响执行路径**
  - **Trigger**：检测结果影响执行路径——VM 环境进入不同分支
  - **Observation**：检测为"是 VM"与"非 VM"走向不同代码分支
  - **Inference**：反虚拟化不仅用于退出——可能改变样本行为（假逻辑 / 降功能 / 不同载荷）
  - **Action**：分析两个分支差异——对比 VM / 非 VM 两条路径的代码与数据，别只 patch 检测点
  - **Constraint**：与反调试假逻辑同理（见反调试方法论 AD44）——patch 后别直接信任输出

## 何时用哪个原子技能（选择树）

**先识别、再选脱壳路径；识别不出走手动流程。**

- **输入是未知样本 / 怀疑带壳** → [[re-packer-id]] 识别 → 按结果分支（不跳步）
  - 识别出简单压缩壳（UPX / ASPack / FSG 等）→ [[re-unpack-simple]]
  - 识别出强壳 / 虚拟化壳（VMProtect / Themida 等）→ [[re-unpack-advanced]]
  - **识别不出壳名**（无签名匹配）→ 手动流程：先按 [[re-unpack-simple]] 的 ESP 定律 + 内存断点尝试；失败或发现反调试/虚拟化特征 → [[re-unpack-advanced]] 手动脱壳
- **目标只是确认壳**（"这是什么壳"）→ [[re-packer-id]] 即可，不进入脱壳
- **脱壳后仍有代码混淆**（花指令 / 平坦化 / 字符串加密）→ [[re-deobfuscate]]
- **目标已确认无壳** → 不需要本网关，转 [[re-binary-core]]（[[re-ghidra]] / [[re-ida]] / [[re-radare2]]）直接分析
- **检测规避/EDR 对抗（AMSI/ETW 绕过、无文件、lolbin 链，样本被检测"为什么"）** → [[re-evasion]]（动态优先，配 [[re-sandbox]] / [[re-memdump]]）
- 脱壳全程需要读进程内存 → [[re-memdump]]（OEP 后默认转储）；Windows 调试 → [[re-x64dbg]]；Linux/Wine 调试 → [[re-gdb]]

## 跨域联合

- 恶意样本加壳：[[re-malware]] → 本网关（packer-id → unpack-*），脱壳产物回沙箱复跑再行为分析
- 破解前置：[[re-cracking]] → 本网关（带壳先脱壳，再定位授权逻辑），授权定位产物供补丁/注册机
- 移动加固：[[re-mobile]] / [[re-apk]] → 本网关（Android 加固脱壳）
- 静态发现壳：[[re-binary-core]] / [[re-format-pe]] / [[re-format-elf]] / [[re-imports]]（导入表极小/壳隐藏导入）→ 转入本网关
- 动态辅助：[[re-gdb]]（断 OEP、Wine 下脱壳）、[[re-x64dbg]]（Windows OEP + Scylla）、[[re-memdump]]（OEP 后默认转储）、[[re-tracing]]（反调试样本检测 trace 环境时配合）
- 脱壳产物验证必须沙箱：[[re-sandbox]]（[[platform-tips]] 最高原则）
- 壳层常量污染指纹：[[re-crypto-id]] 加壳样本先脱壳再做常量表指纹
- 检测规避对抗：[[re-evasion]] —— 壳/混淆是"静态反分析"，AMSI/ETW/无文件/lolbin 是"检测对抗"，同属本网关（动态分析强制 [[re-sandbox]]）
- 本网关被 [[re-analyze]] 的 triage「样本带壳 / 脱壳」路径调用（re-anti-analysis → packer-id → unpack-* → 验证）

## 常见坑与陷阱

- **跳过识别直接脱**：现象——拿样本就上调试器/OEP 流程，撞上强壳反调试或浪费时间；原因——没先判壳类别；对策——先 [[re-packer-id]] 识别，简单壳自动解包秒解，强壳才值得上手动流程
- **转储时机过早**：现象——dump 出来还是壳的初始状态（压缩/加密数据），脱了个寂寞；原因——壳未运行到 OEP 就转储；对策——等解密完成后 dump（[[platform-tips]] 关键经验，默认转储优先）
- **IAT 不修当成品**：现象——脱壳后导入表乱，Ghidra/IDA 反编译一片混沌；原因——导入表在壳内动态重建，转储未修复；对策——Windows 上 Scylla/ImpREC 修复，修复后重新反编译验证
- **壳套壳**：现象——脱完一层发现里面还有一层（UPX 里包 Themida 等）；原因——多层加壳是常见反分析手法；对策——脱一层验证一层（sha256 + 导入表 + 沙箱复跑），套层时回到第 1 步重新识别
- **反调试干扰整个流程**：现象——调试器断点不生效、进程退出、时序错乱；原因——样本检测调试器（NtQueryInformationProcess、时间差、调试端口）；对策——[[re-unpack-advanced]] 反调试对抗先行（scyllaHide 思路），先攻最外层检测
- **OutputDebugString 计时陷阱**：现象——样本调用 `OutputDebugStringA/W` 后行为不同，或调试器下某段代码明显变慢触发时间检测；原因——调试器处理 ODS 消息有固定慢路径（接收-格式化-刷新），样本以长字符串 ODS 调用的耗时差异当调试器探针（2024-2025 恶意样本仍在使用）；对策——定位 ODS 调用点断住/绕过（返回假值或直接跳过），或 scyllaHide 隐藏 ODS 处理，与时间差检测（AD9）一并排查
