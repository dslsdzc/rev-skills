---
name: re-zig
type: atomic
description: >
  Zig 编译产物逆向：产物识别、comptime 展开、panic/错误处理路径、C ABI 边界。
  触发词：Zig逆向、zig、comptime、zig 产物、panic。
---

# Zig 逆向

## 何时使用 / 何时不用

- 用：Zig 产物（无 C++ RTTI/异常表、panicking 函数特征）
- 不用：C/C++ 产物（走 [[re-cpp-abi]]）

## 工具准备

### readelf / llvm-nm（符号与节分析）

- 安装与验证见 [[re-cpp-abi]] 工具准备

### Ghidra / IDA（反编译底座）

- 安装与验证见 [[re-ghidra]] / [[re-ida]]

## 操作步骤

按顺序执行，每步产物存档（路径 + sha256，见 [[re-triage]]）。

1. **产物识别**：
   ```sh
   readelf -s sample | grep -iE 'panicking|std.debug|zig' | head
   readelf -S sample | grep gcc_except_table   # 应无输出（Zig 产物常带 .eh_frame，不能作判别）
   readelf -s sample | grep __gxx_personality_v0   # 应无匹配
   # 无 .gcc_except_table / 无 __gxx_personality_v0 → 无 C++ 异常机制
   ```
   - Zig 特征：panic 函数（std.debug.panic 等，panic 处理链）、std 符号模式（std.debug.print 等）、**无 C++ RTTI/异常表**（对比 [[re-cpp-abi]] 的 RTTI/异常密集特征）
   - 与 C 混合编译：Zig 符号与 C 符号共存（见步骤 4 边界）

2. **导出符号与启动路径**：
   ```sh
   readelf -s sample | grep -wE '_start|main|_init' | head
   ```
   - 启动路径：`_start` → 运行时初始化 → `main`（Zig 的 main 入口）
   - comptime 展开产物：编译期计算已内联/展开——无对应源码结构，按行为分析

3. **panic/错误处理路径**：
   - panic 链：`@panic` → panic 函数（打印 + abort）——定位 panic 调用点可找输入校验/不变量
   - 错误联合（error union）：`!T` 类型布局（错误码 + 值），调用点检查 `orelse`/`catch` 分支
   - 分析：错误路径是逆向重点（校验逻辑、失败分支）

4. **C ABI 边界**：
   - `@extern` / `@cImport`：Zig 调用 C 库（导入表清晰可查）
   - 混合产物：按符号来源区分（Zig 符号 vs C 符号——链接器分组/节归属）
   - 边界处是逻辑入口（Zig 主体逻辑在边界内侧）

## 跨域联合

- [[re-binary-core]] 网关：本技能归属（选择树「Zig 产物」分支）
- [[re-cpp-abi]]：边界区分（无 RTTI/异常 → 非 C++）
- [[analysis-contract]]：符号表按数据契约传递

## 常见坑与陷阱

- **comptime 展开导致符号膨胀**：现象——产物符号与源码不对应；原因——编译期展开/内联；对策——按行为分析而非源码映射
- **panic 路径误导**：现象——大量 panic 处理代码被当主逻辑；原因——错误路径与正常路径交织；对策——先分离 panic 调用点（校验），再分析正常路径
- **错误联合布局版本差异**：现象——错误码读取错位；原因——error union 布局随版本变化；对策——按目标版本确认布局（错误码位宽/对齐）
- **与 C 混合编译难分界**：现象——Zig/C 符号混杂；原因——混合编译；对策——按符号来源与节归属分组，边界处进 Zig 逻辑
- **无异常表 ≠ 无保护**：现象——误判无错误处理；原因——Zig 错误处理走 error union 不走异常表；对策——查错误联合调用点（`catch`/`orelse` 分支）
