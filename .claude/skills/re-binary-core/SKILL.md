---
name: re-binary-core
type: gateway
description: >
  软件逆向核心网关（公共底座）。编排：初勘 → 格式解析 → 反编译 → 调试/跟踪 → 内存。
  子技能：[[re-triage]] [[re-format-pe]] [[re-format-elf]] [[re-format-macho]]
  [[re-imports]] [[re-ghidra]] [[re-ida]] [[re-radare2]] [[re-gdb]] [[re-x64dbg]]
  [[re-lldb]] [[re-tracing]] [[re-memdump]] [[re-windbg]] [[re-binaryninja]]
  [[re-emulation]] [[re-shellcode]] [[re-kernel]] [[re-game]] [[re-go]] [[re-rust]]
  [[re-plugin-dev]]。
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

## 何时用哪个原子技能（选择树）

- 刚拿到文件，不知是什么 → [[re-triage]]
- 已知 PE / ELF / Mach-O，要理解结构 → 对应格式技能
- 要知道程序链接了哪些库/API → [[re-imports]]
- 要读懂函数逻辑 → 反编译四选一（[[re-ghidra]] 默认；[[re-ida]] / [[re-radare2]] / [[re-binaryninja]]）
- 要看运行行为、设断点 → 按 OS 选调试器（Linux [[re-gdb]]、Windows [[re-x64dbg]] / [[re-windbg]]、macOS [[re-lldb]]）
- 要跟踪系统调用/函数调用 → [[re-tracing]]
- 要读/转储进程内存 → [[re-memdump]]（默认转储优先，见 [[platform-tips]]）
- 目标是驱动/内核模块/rootkit → [[re-kernel]]（配 [[re-windbg]] 内核调试）
- 目标无环境/脱壳辅助，需模拟执行 → [[re-emulation]]
- 目标是 shellcode（无文件格式头的裸代码 blob：提取/解码循环/模拟执行）→ [[re-shellcode]]
- 目标是游戏（Unity/Unreal、CE 内存修改）→ [[re-game]]
- 目标是 Go 二进制（语言专项：符号/字符串表/goroutine）→ [[re-go]]
- 目标是 Rust 二进制（语言专项：符号解译/泛型展开/所有权）→ [[re-rust]]
- 要写 Ghidra/IDA 脚本或插件（批量标注/解密循环/自定义格式解析，脚本→插件工程化）→ [[re-plugin-dev]]
- 怀疑带壳 → 转 [[re-anti-analysis]]

## 跨域联合

- [[re-mobile]]：移动 App 原生 .so 库分析 → 本网关 [[re-format-elf]] + [[re-ghidra]]
- [[re-ctf]]：CTF 逆向题 → 本网关技能为底座
- [[re-anti-analysis]]：静态发现混淆/壳 → 转入脱壳域
- [[re-shellcode]]：shellcode 载荷专项分析（提取/解码/模拟执行）→ 反编译底座用本网关（[[re-radare2]] / [[re-ghidra]]）
- 本网关技能被 [[re-malware]] 深度逆向环节引用

## 常见坑与陷阱

- 探测到内存 <4GB 仍选 Ghidra → 提示 [[re-radare2]]
- strings 输出被加密/压缩干扰 → 用熵值（re-triage）判断是否先脱壳
- 直读 `/proc/<pid>/mem` 前必须查 maps（见 [[platform-tips]]）
