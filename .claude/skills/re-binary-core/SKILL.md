---
name: re-binary-core
type: gateway
description: >
  软件逆向核心网关（公共底座）。编排：初勘 → 格式解析 → 反编译 → 调试/跟踪 → 内存。
  子技能：[[re-triage]] [[re-format-pe]] [[re-format-elf]] [[re-format-macho]]
  [[re-imports]] [[re-ghidra]] [[re-ida]] [[re-radare2]] [[re-gdb]] [[re-x64dbg]]
  [[re-lldb]] [[re-tracing]] [[re-memdump]] [[re-windbg]] [[re-binaryninja]]
  [[re-emulation]] [[re-shellcode]] [[re-kernel]] [[re-game]] [[re-go]] [[re-rust]]
  [[re-plugin-dev]] [[re-hypervisor]] [[re-anti-cheat]]、[[re-cpp-abi]]。
  触发词：静态分析、看这个程序的逻辑、反编译、逆向这个二进制、binary analysis。
---

# 软件逆向核心

## 完整工作流

1. 环境：探测 + 偏好（若未走 [[re-analyze]] 入口，先补做，读取 `RE_*` 会话变量）
2. 初勘：[[re-triage]] —— file/hash/熵/strings，确认文件类型与架构
3. 格式解析：按类型走 [[re-format-pe]] / [[re-format-elf]] / [[re-format-macho]]
4. 导入导出：[[re-imports]] —— 库指纹、IAT/符号，识别链接了什么
5. 反编译：按 `RE_DECOMPILER` 走 [[re-ghidra]] / [[re-ida]] / [[re-radare2]]（未装 → 按对应技能「工具准备」安装；默认推荐 Ghidra）
6. 动态（按需，默认沙箱）：[[re-gdb]] / [[re-x64dbg]] / [[re-lldb]]（按 OS）+ [[re-tracing]] + [[re-memdump]]
7. 产出：结论 / 报告（按 `RE_REPORT`）

## 分析方法论

本网关适用的通用分析方法论（用户实战经验），各技能坑与陷阱引用此处。

### 入口分析

- **R1 入口点≠main**：EP 是初始化入口，经 CRT/TLS/loader 才到 main
- **R2 字符串交叉引用优先于函数猜测**：关键字符串→XREF 回溯
- **R3 没有字符串≠没有逻辑**：编码/哈希/运行时拼接/解密生成，追踪使用点
- **R4 函数边界异常→检查反编译假象**：手写汇编/混淆/尾调用/无 frame pointer，不完全相信 decompiler

### 调用分析

- **R5 call 很少≠逻辑简单**：函数指针/虚表/回调/切换跳表间接调用
- **R6 间接调用异常→查函数指针来源**：追踪寄存器/内存中目标地址来源
- **R7 虚函数分析→先找 vtable**：对象指针→vptr→vtable→函数集合

### 内存与数据结构

- **R8 结构体识别不要只看字段访问**：结合初始化位置/生命周期/多处使用
- **R9 malloc/free 跟踪对象生命周期**：创建点和释放点定含义
- **R10 全局变量先找引用不找定义**：全局区噪声高

### API/行为

- **R11 API 调用只是结果不是逻辑**：分析参数来源和调用上下文
- **R12 异常处理可能是控制流**：SEH/C++ exception/signal handler 承担正常跳转
- **R13 系统调用层比 API 更可信**：hook/封装/替换时向下追到 syscall

### 混淆分析

- **R14 控制流平坦化→看状态变量**：调度器+状态变量+情况块
- **R15 垃圾代码比例高→不逐条分析**：找外部影响/数据流/真实调用
- **R16 opaque predicate→验证条件是否恒定**：永真/永假判断

### 动态调试

- **R17 断点失效→不一定没执行**：自修改代码/内存重映射/异常机制/反调试绕过
- **R18 单步异常→查反调试**：陷阱旗/时间检测/异常处理
- **R19 看见解密数据→立刻保存**：下一阶段可能清除

### PE/ELF 深层

- **R20 内存布局比文件布局重要**：loader 后的映射状态才是运行时真相
- **R21 section 名称不可信**：看权限/熵/内容
- **R22 重定位信息影响 dump**：地址不一致时先查 relocation

### 情报与初勘

- **R23 三表先行**：file（格式）→ 分区熵（代码/数据/密文分布）→ strings（**宽窄字符都要扫**，壳会转宽字符串）——任何深挖之前这三步做完，避免 80% 的方向性错误
- **R24 熵要分区采样**：整体 4KB 熵 7.9 ≠ 全部密文——入口区 64B 熵 5.6 可能是真代码；用 64B/1KB 窗口扫描找明文/密文边界；**高熵≠加密**：可能是压缩、VMProtect 变异、或数据，判断加密前先排除压缩与混淆
- **R25 导入表两面性**：(a) 导入表极小（几个函数）= 壳/动态解析信号；(b) **死导入**：IAT 有桩但 .text 零调用点 = LoadLibrary+GetProcAddress 动态加载，静态导入结论作废（c) **导入表数字≠API 面**：COM 接口（d3d11 等）1 个导入背后几百个 vtable 方法，真实调用面永远在导入表之外
- **R26 构建路径/日志函数名是最强情报**：`G:\BuildAgent\...\Graphics_Renderer_D3D11.cpp` 泄露整个渲染器架构；`Renderer::CreateAdapter()` 还原初始化链——优先于函数猜测

### 反汇编方法

- **R27 线性反汇编必漂移**：PE 代码节内嵌跳转表，从节头顺序解码到中段全是垃圾；免疫方案 = **逐字节模式扫描**（只认 FF15/FF25 call/jmp [rip] 与 8B/8D mov/lea [rip] 模式，目标地址用原始字节算 `next_ip + disp32`，不用解码器的 displacement 字段）
- **R28 反编译器卡死果断降级**：密文/混淆区当代码做函数分析会指数爆炸（4 核转 8 分钟）——限制分析范围（-analysisTimeoutPerFile）或换手写解码器，别等
- **R29 工具盲区交叉验证**：objdump 对异常节标志（MEM_NOT_PAGED）静默跳过、iced-x86 的 RIP 相对 displacement 返回非裸值、readelf 对伪造头报错中断——每个工具都有盲区，两个独立工具解析同一数据，不一致就是有问题
- **R30 入口字节判真伪**：`e8 xx xx xx xx`（call）+ `0f 05`（syscall）看着像代码也可能是随机巧合——顺序解码跟 30 条，出现 `fcom`/`int 88h`/`ret far` 类指令即为假

### 验证

- **R31 静态结论必须动态背书**："能跑"≠"正确"（重定位正确性只有运行时读内存槽位能证明）；逐字节验证只能证明"实现符合规格"，证明不了"规格正确"——动态侧从活内存读槽位与文件存储值比对
- **R32 两个独立工具解析同一数据**：addend 对照文件存储值、符号地址对照 nm 输出、RVA 对照 objdump——不一致就是有问题，别信单一工具输出
- **R33 动态最小侵入**：DLL 劫持代理（记录调用序列）> 调试器 > 插桩框架；能不改目标二进制就不改；**动态分析一律沙箱**（firejail/bwrap + 无网络 + 一次性环境）

### 知识获取

- **R34 格式偏移查规范，不凭记忆**：PE32+ 数据目录在 oh+112（+96 是 SizeOfHeapCommit）、TEB 偏移等字段类知识——凭记忆必错，MS 规范/ELF gABI 是唯一权威（具体值见 [[re-format-pe]]/[[re-format-elf]] 领域经验）
- **R35 开源实现是第二权威**：TEB 布局查 Wine winnt.h、系统调用语义查 ReactOS 源码——比博客可靠，且可交叉验证


## 何时用哪个原子技能（选择树）

- 刚拿到文件，不知是什么 → [[re-triage]]
- 已知 PE / ELF / Mach-O，要理解结构 → 对应格式技能
- 要知道程序链接了哪些库/API → [[re-imports]]
- 要读懂函数逻辑 → 反编译四选一（[[re-ghidra]] 默认；[[re-ida]] / [[re-radare2]] / [[re-binaryninja]]）
- 要看运行行为、设断点 → 按 OS 选调试器（Linux [[re-gdb]]、Windows [[re-x64dbg]] / [[re-windbg]]、macOS [[re-lldb]]）
- 要跟踪系统调用/函数调用 → [[re-tracing]]
- 要读/转储进程内存 → [[re-memdump]]（默认转储优先，见 [[platform-tips]]）
- 目标是驱动/内核模块/rootkit → [[re-kernel]]（配 [[re-windbg]] 内核调试）
- 目标是 hypervisor/VMM/虚拟化检测相关 → [[re-hypervisor]]（VT-x/SVM、VMCS/EPT）
- 目标是反作弊组件（EAC/BattlEye 驱动、内存校验）→ [[re-anti-cheat]]（驱动分析 + 内核调试，注意授权边界）
- 目标无环境/脱壳辅助，需模拟执行 → [[re-emulation]]
- 目标是 shellcode（无文件格式头的裸代码 blob：提取/解码循环/模拟执行）→ [[re-shellcode]]
- 目标是游戏（Unity/Unreal、CE 内存修改）→ [[re-game]]
- 目标是 Go 二进制（语言专项：符号/字符串表/goroutine）→ [[re-go]]
- 目标是 Rust 二进制（语言专项：符号解译/泛型展开/所有权）→ [[re-rust]]
- **目标是 C++（RTTI/异常表密集）** → [[re-cpp-abi]]（RTTI/虚表/异常恢复）
- 要写 Ghidra/IDA 脚本或插件（批量标注/解密循环/自定义格式解析，脚本→插件工程化）→ [[re-plugin-dev]]
- 怀疑带壳 → 转 [[re-anti-analysis]]

## 跨域联合

- [[re-mobile]]：移动 App 原生 .so 库分析 → 本网关 [[re-format-elf]] + [[re-ghidra]]（专项见 [[re-android-native]]）
- [[re-hypervisor]] / [[re-anti-cheat]]：hypervisor 与反作弊驱动的逆向分析以本网关技能为底座（[[re-kernel]] / [[re-windbg]] 内核调试）
- [[re-ctf]]：CTF 逆向题 → 本网关技能为底座
- [[re-anti-analysis]]：静态发现混淆/壳 → 转入脱壳域
- [[re-shellcode]]：shellcode 载荷专项分析（提取/解码/模拟执行）→ 反编译底座用本网关（[[re-radare2]] / [[re-ghidra]]）
- 本网关技能被 [[re-malware]] 深度逆向环节引用

## 常见坑与陷阱

- 探测到内存 <4GB 仍选 Ghidra → 提示 [[re-radare2]]
- strings 输出被加密/压缩干扰 → 用熵值（re-triage）判断是否先脱壳
- 直读 `/proc/<pid>/mem` 前必须查 maps（见 [[platform-tips]]）

### 未知格式与模拟执行

- **未知/魔改格式：让目标自己的解析器回答，别手工考古**：现象——手写解析魔改字节码/资源/协议格式，反复错位；原因——格式被目标厂商修改过，公开文档与实现脱节；对策——找目标内能加载该格式的组件（自带 VM、解析库），用它"编译/加载/导出"产出同源产物（如用目标自带 Lua VM 编译其字节码），格式兼容性问题归零——"能跑就不逆向"的通用化
- **模拟执行目标函数先分清依赖**：现象——模拟器里调用函数报内存未映射/越界；原因——函数引用了模块静态区/全局状态，超出映射范围；对策——优先选无全局依赖的纯计算函数（静态 getter、打包/解包器）作验证目标；确实需要全局的函数，按引用地址补齐内存映射后再调
- **补丁脚本型资源：用目标的编译管线产出同构产物**：现象——第三方编译器/打包器产出的字节码或资源，目标加载失败或行为异常；原因——编译器版本/配置与目标不一致；对策——优先用目标自带的编译/打包能力（导出的编译 API、`dump` 类函数）生成补丁产物
- **字节布局一律脚本解析 + 断言**：现象——手数 hex 偏移全盘错位（魔数长度数错、字段偏移差 1）；原因——眼算偏移不可靠；对策——用脚本解析头部/字段并加断言校验；解析器输出与工具矛盾时，先验证工具本身是否按预期工作（别名/包装/参数可能改变行为，如 grep 包装后跳过二进制内容）

