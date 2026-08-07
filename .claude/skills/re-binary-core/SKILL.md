---
name: re-binary-core
type: gateway
description: >
  软件逆向核心网关（公共底座）。编排：初勘 → 格式解析 → 反编译 → 调试/跟踪 → 内存。
  子技能：[[re-triage]] [[re-format-pe]] [[re-format-elf]] [[re-format-macho]]
  [[re-imports]] [[re-ghidra]] [[re-ida]] [[re-radare2]] [[re-gdb]] [[re-x64dbg]]
  [[re-lldb]] [[re-tracing]] [[re-memdump]] [[re-windbg]] [[re-binaryninja]]
  [[re-emulation]] [[re-kernel]] [[re-game]]。
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
- 目标是游戏（Unity/Unreal、CE 内存修改）→ [[re-game]]
- 怀疑带壳 → 转 [[re-anti-analysis]]

## 跨域联合

- [[re-mobile]]：移动 App 原生 .so 库分析 → 本网关 [[re-format-elf]] + [[re-ghidra]]
- [[re-ctf]]：CTF 逆向题 → 本网关技能为底座
- [[re-anti-analysis]]：静态发现混淆/壳 → 转入脱壳域
- 本网关技能被 [[re-malware]] 深度逆向环节引用

## 常见坑与陷阱

- 探测到内存 <4GB 仍选 Ghidra → 提示 [[re-radare2]]
- strings 输出被加密/压缩干扰 → 用熵值（re-triage）判断是否先脱壳
- 直读 `/proc/<pid>/mem` 前必须查 maps（见 [[platform-tips]]）
