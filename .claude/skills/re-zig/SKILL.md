---
name: re-zig
type: atomic
description: >
  Zig 编译产物逆向：产物识别、comptime 展开、panic/错误处理路径、C ABI 边界。
  触发词：Zig逆向、zig、comptime、zig 产物、panic。
---

# Zig 逆向

## 何时使用 / 何时不用

- 用：Zig 产物（无 C++ RTTI/异常表、panic 函数链特征、`_start → main` 启动形态），需要还原错误处理路径、C ABI 边界、comptime 展开后的行为
- 用：Zig/C 混合产物中区分 Zig 侧代码（无 RTTI 侧 + Zig 符号模式）
- 不用：C/C++ 产物（走 [[re-cpp-abi]]；有 RTTI/异常表即非 Zig 单方产物）
- 不用：只需函数逻辑（直接反编译技能）

## 工具准备

### readelf / llvm-nm（符号与节分析）

- 安装与验证见 [[re-cpp-abi]] 工具准备
- 用途: `readelf -S` 查异常表节；`readelf -s`/`llvm-nm` 查符号与可见性（Zig 业务函数多为 LOCAL 符号）

### llvm-objdump / objdump（反汇编）

- 安装与验证见 [[re-cpp-abi]] 工具准备
- 用途: 定位 panic 调用点、catch/orelse 的错误码比较（`cmpw` + 分支）

### Ghidra / IDA（反编译底座）

- 安装与验证见 [[re-ghidra]] / [[re-ida]]
- Zig 产物无类型信息（无 DWARF 时），配合行为分析（见步骤 3/4）

### strings（字符串池/错误名）

- 系统自带；验证: `strings --version`
- 用途: `@errorName` 错误名字符串、panic 消息、格式串定位

### zig 编译器（可选，对照编译）

- 官方 tarball / `brew install zig` / Windows 官方安装器；验证: `zig version`
- 用途: 同版本编译对照产物，验证 panic 链/错误联合布局（版本差异大，见 [[layout]]）

## 操作步骤

按顺序执行，每步产物存档（路径 + sha256，见 [[re-triage]]）。

1. **产物识别**：
   ```sh
   readelf -s sample | grep -iE 'panicking|panicExtra|defaultPanic|zig' | head
   readelf -S sample | grep gcc_except_table   # 应无输出（Zig 产物常带 .eh_frame，不能作判别）
   readelf -s sample | grep __gxx_personality_v0   # 应无匹配
   readelf -s sample | grep -wE '_start|main'      # 启动形态
   ```
   - Zig 特征：panic 函数链（`debug.panicExtra`/`debug.panicking` 等，版本相关）、`std` 符号模式（`std.debug.print` 等）、**无 C++ RTTI/异常表**（对比 [[re-cpp-abi]] 的 RTTI/异常密集特征）
   - 判别组合：无 `.gcc_except_table` + 无 `__gxx_personality_v0` + 无 `_ZTV*`（RTTI vtable）→ 无 C++ 异常机制；`.eh_frame` 两者都有，不能单独作判据
   - 与 C 混合编译：Zig 符号与 C 符号共存（见步骤 5 边界）

2. **符号可见性与启动路径**：
   ```sh
   readelf -s sample | grep -E 'GLOBAL|LOCAL' | grep -cE 'FUNC'
   readelf -s sample | grep -wE '_start|main' | head
   ```
   - 启动路径：`_start`（GLOBAL）→ 运行时初始化（std.start）→ `main`（LOCAL）；Zig 的 `main` 是普通函数，入口经 std.start 包裹（exit 处理在包裹层）
   - **符号可见性**：Zig 默认只导出 `_start` 与显式 `export` 的函数，业务函数是 LOCAL 符号（debug/ReleaseSafe 符号表仍在，ReleaseFast 可 strip）——`nm` 看得到不等于导出，hook/注入面按导出表算
   - comptime 展开产物：编译期计算已内联/展开——无对应源码结构，按行为分析（见坑 1）

3. **panic/错误处理路径**：
   ```sh
   readelf -s sample | grep -iE 'panic' | head        # panic 链符号（版本相关命名）
   ```
   - panic 链：`@panic`/断言失败 → panic 函数（打印 + abort）——定位 panic 调用点可找输入校验/不变量；panic 处理函数本身是"打印+退出"，调用点才是业务校验
   - 错误联合（error union）：`!T` 类型，布局按载荷大小分两种（小载荷 8 字节槽、错误码在高位；大载荷错误码在前、载荷按对齐内联——[[layout]] 有实测表）；调用点检查 `orelse`/`catch` 分支（编译为错误码比较 + 分支）
   - 分析：错误路径是逆向重点（校验逻辑、失败分支）——错误码比较点即分支条件，错误名可经 `@errorName` 字符串池还原
   - 错误名还原：`@errorName(e)` 的字符串在 `__zig_tag_name_*` 符号/字符串池——`strings` 里错误名与代码路径直接对应，是错误语义的第一手线索

4. **常量与字符串定位（行为分析入口）**：
   ```sh
   strings -n 5 sample | head -30        # 格式串/错误名/panic 消息
   readelf -S sample | grep -E 'rodata|data'   # 常量区
   ```
   - `std.debug.print` 的格式串在只读数据区，交叉引用可回到调用点（错误输出路径）
   - comptime 求值的常量直接内联为立即数，无常量表——找"魔数"按调用点回溯参数

5. **comptime 与泛型展开**：
   - comptime 计算的常量/内联函数无运行时痕迹；泛型实例化产生重复代码（按调用点参数特化）
   - 还原策略：按行为分析（常量出现处 → 回溯到哪个调用参数），不按源码映射
   - `std.debug.print` 等 std 函数大量内联（Release 模式），`readelf -s` 可能只剩启动与 panic 链

6. **C ABI 边界**：
   - `@extern` / `@cImport`：Zig 调用 C 库（导入表清晰可查——`readelf -d` 的 NEEDED 与导入符号）
   - `export fn`：Zig 侧导出给 C/宿主调用（GLOBAL 符号，导出表可见）
   - 混合产物：按符号来源区分（Zig 符号 vs C 符号——链接器分组/节归属），边界处是逻辑入口（Zig 主体逻辑在边界内侧）
   - 调用约定：默认 C ABI（`callconv(.c)` 为默认），x86-64 SysV——反编译时无特殊约定负担
   - C 库调用点的参数布局直接按 ABI 读（与 [[re-cpp-abi]] 的 C++ thiscall 不同，无隐藏参数/虚表间接层）

7. **stripped/ReleaseFast 兜底**：
   ```sh
   strings -n 6 sample | grep -iE 'panic|error' | head     # panic 消息/错误名（@errorName 字符串池）
   ```
   - ReleaseFast 下符号表与 panic 链都可能被裁；按行为特征（错误码比较模式、字符串池）恢复，初勘兜底见 [[re-triage]]

## 跨域联合

- [[re-binary-core]] 网关：本技能归属（选择树「Zig 产物」分支）
- [[re-cpp-abi]]：边界区分（无 RTTI/异常 → 非 C++）
- [[re-imports]]：C 库边界（NEEDED/导入符号）与导出表
- [[analysis-contract]]：符号表按数据契约传递
- [[re-triage]]：初勘兜底

## 常见坑与陷阱

- **comptime 展开导致符号膨胀**：现象——产物符号与源码不对应；原因——编译期展开/内联/泛型特化；对策——按行为分析而非源码映射
- **panic 路径误导**：现象——大量 panic 处理代码被当主逻辑；原因——错误路径与正常路径交织；对策——先分离 panic 调用点（校验），再分析正常路径
- **错误联合布局版本差异**：现象——错误码读取错位；原因——error union 布局随版本变化（小载荷 8 字节槽/错误码高位，大载荷按对齐内联）；对策——按目标版本确认布局（[[layout]] 实测表），错误码恒为 u16
- **与 C 混合编译难分界**：现象——Zig/C 符号混杂；原因——混合编译；对策——按符号来源与节归属分组，边界处进 Zig 逻辑
- **无异常表 ≠ 无保护**：现象——误判无错误处理；原因——Zig 错误处理走 error union 不走异常表；对策——查错误联合调用点（`catch`/`orelse` 分支的错误码比较）
- **业务函数是 LOCAL 符号**：现象——`nm` 列表里函数一大堆，但 `nm -g`（全局）只有 `_start`；原因——Zig 默认不导出业务符号；对策——hook/注入按导出表算；分析按 LOCAL 符号仍可定位
- **panic 链命名随版本变**：现象——按 `std.debug.panic` 找符号找不到；原因——0.14+ 重构为 `debug.panicExtra`/`defaultPanic` 链（老版本 `std.debug.panic` 直接命名）；对策——按 panic 调用点（`@panic` 编译产物：打印+abort 序列）定位，不依赖具体符号名
