---
name: re-cpp-abi
type: atomic
description: >
  现代 C++ 二进制逆向：RTTI/异常/虚表恢复、ABI 识别、mangling 解码。
  触发词：C++逆向、RTTI、虚表恢复、异常处理、C++ ABI、mangling、C++反编译。
---

# 现代 C++ 逆向（RTTI / 异常 / 虚表）

## 何时使用 / 何时不用

- 用：RTTI/异常表密集的二进制、反编译结果混乱的 C++ 目标（类层次/虚调用/异常流无法直接读出）
- 不用：C 代码或纯汇编（走 [[re-binary-core]] 通用路径）；混淆主导的目标（先 [[re-deobfuscate]]）

## 工具准备

### readelf / llvm-objdump（节表与异常表）

- Linux: `apt install binutils llvm` / `dnf install binutils llvm` / `pacman -S binutils llvm`
- macOS: `brew install llvm`（binutils 部分 macOS 自带）
- Windows: WSL 或 llvm 预编译
- 验证: `readelf --version`、`llvm-objdump --version`

### c++filt / undname（mangling 解码）

- Linux/macOS: `c++filt`（binutils 自带）；Windows: `undname`（VS 工具链）
- 验证: `echo '_ZN3foo3barEv' | c++filt`（输出 `foo::bar()`）

### Ghidra / IDA（反编译底座，脚本化 RTTI 遍历）

- 安装与验证见 [[re-ghidra]] / [[re-ida]] 工具准备

### gdb（异常断点，可选）

- 安装与验证见 [[re-gdb]]

## 操作步骤

按顺序执行，每步产物存档（路径 + sha256，见 [[re-triage]]）。

1. **ABI 识别**：
   ```sh
   readelf -s sample | grep -E '_ZN|_ZTV|_ZTI' | head    # Itanium（GCC/Clang）
   strings sample | grep -E '^\?\?_' | head              # MSVC
   ```
   - Itanium 特征：`_ZN`（函数）、`_ZTV`（虚表）、`_ZTI`（RTTI 类型信息）
   - MSVC 特征：`??_7`（vftable）、`??_R`（RTTI）
   - 识别错则后续全部偏——先确认再继续

2. **RTTI 重建（Itanium）**：
   ```sh
   readelf -s sample | grep _ZTI | head
   # _ZTI<类名> 指向 typeinfo；typeinfo+8 处 _ZTVN10__cxxabiv1... 链到 vtable 前缀
   ```
   - 结构：`typeinfo` → `__class_type_info` 派生链 → 每个类的完整继承路径
   - 脚本化：Ghidra/IDA 遍历 _ZTI 引用，重建类继承图（父子关系表）
   - 产出：类名 → 继承链映射（写入会话 symbols_known，见 [[analysis-contract]]）

3. **虚表恢复**：
   ```sh
   readelf -s sample | grep _ZTV | head
   ```
   - `_ZTV<类名>` 指向 vtable 起点（虚函数指针数组）；`offset to top` + `typeinfo ptr` 位于 vtable 前 8 字节（Itanium ABI）
   - 定位 vtable 后：每个槽位的函数地址 → 调用点反推虚方法名（结合步骤 2 的继承图）
   - 虚调用（`call *reg`）无法静态定名 → 用调用点上下文（参数/返回值使用）缩小候选

4. **异常处理表**：
   ```sh
   readelf -S sample | grep -E 'pdata|xdata'    # PE：.pdata/.xdata
   readelf -S sample | grep -E 'eh_frame|gcc_except'   # ELF：.eh_frame
   ```
   - PE：`.pdata` 的 RUNTIME_FUNCTION（Begin/End/UnwindInfo）→ `.xdata` 展开数据 → 异常处理器（__CxxFrameHandler3）
   - ELF：`.eh_frame` 的 FDE/CIE → 展开规则与 LSDA（.gcc_except_table）→ 异常处理函数
   - 用途：恢复被异常路径打断的控制流、定位析构/清理逻辑（catch 块）

5. **模板/lambda 识别**：
   - 模板：符号含 `<...>` 参数（Itanium mangling 中展开为长串）；实例化爆炸时按调用模式聚类
   - lambda：Itanium 中 `_ZZ<作用域>ENK...` 特征、MSVC 中 `<lambda_...>`；lambda 局部类**无 RTTI**（步骤 2 缺失时反推）
   - 输出：疑似模板实例化/lambda 的函数清单 + 调用点

6. **mangling 解码（批量）**：
   ```sh
   readelf -s sample | grep -E '_ZN|_ZTV|_ZTI' | awk '{print $8}' | c++filt | head -20
   ```
   - MSVC: `undname` 或在线等价工具
   - 解码结果写入符号表（供 [[re-ghidra]] / [[re-ida]] 重命名）

## 跨域联合

- [[re-binary-core]] 网关：本技能归属（选择树「现代 C++」分支待加）
- [[re-ghidra]] / [[re-ida]]：反编译底座与脚本化
- [[re-deobfuscate]]：混淆与 ABI 分析衔接
- [[analysis-contract]]：类继承图/符号表按数据契约传递
- [[rerouting]]：RTTI/异常表特征触发本技能（A 表已挂）

## 常见坑与陷阱

- **ABI 误判导致全部解析失败**：现象——用 Itanium 结构解析 MSVC 目标（或反之）全盘错位；原因——识别步骤跳过；对策——先做步骤 1，mangling 特征双查
- **模板展开导致符号爆炸**：现象——readelf 输出几万行 `_Z...`；原因——模板实例化；对策——按调用模式聚类、过滤标准库符号（libstdc++/STL 前缀）
- **lambda 无 RTTI**：现象——类继承图缺节点；原因——lambda 局部类不生成 typeinfo；对策——按 `_ZZ` mangling 特征与调用点识别，不硬找 RTTI
- **异常表版本差异**：现象——.xdata 解析错位；原因——MSVC 异常处理版本（__CxxFrameHandler3 等）不同；对策——按导入函数（__CxxFrameHandler）确认版本再解析
- **虚调用无法静态定名**：现象——`call *reg` 全是间接调用；原因——虚分派；对策——结合 vtable 槽位与调用点证据缩小候选，不猜
