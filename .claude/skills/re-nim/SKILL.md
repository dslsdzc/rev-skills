---
name: re-nim
type: atomic
description: >
  Nim 编译产物逆向：运行时识别、NimString 结构、异常与 GC 路径。
  触发词：Nim逆向、nim、NimString、NimMain、nim 产物。
---

# Nim 逆向

## 何时使用 / 何时不用

- 用：Nim 产物（NimMain / GC 符号、NimString 结构特征）
- 不用：C 产物（走 [[re-binary-core]] 通用）

## 工具准备

### readelf / llvm-nm（符号分析）

- 安装与验证见 [[re-cpp-abi]] 工具准备

### Ghidra / IDA（反编译底座）

- 安装与验证见 [[re-ghidra]] / [[re-ida]]

## 操作步骤

按顺序执行，每步产物存档（路径 + sha256，见 [[re-triage]]）。

1. **产物识别**：
   ```sh
   readelf -s sample | grep -iE 'NimMain|nimGC|NimString' | head   # ELF；Mach-O 用 llvm-nm
   ```
   - Nim 特征：`NimMain`（入口）、GC 符号（nimGC_*）、`NimString` 结构
   - 入口：`NimMain` 调用链（运行时初始化 → 模块初始化 → main）

2. **字符串与序列结构**：
   - NimStringV2 布局：`len`（int）+ `reserved`（int）+ `data`（char* 或内联）——按版本确认字段序
   - 定位：`newString` 分配调用点（Nim 2.0 起为 `newString1`） → 结构布局 → 字符串操作函数（`eqStrings` 等）
   - 分析：字符串比较点是关键逻辑（校验/协议/命令分发）

3. **异常与 raises 路径**：
   - Nim 异常：`raise` → 异常对象分配 → 异常表（Nim 有异常表，与 C++ 不同）
   - 定位：异常处理入口（`nimSetjmp` / 异常表）→ catch 分支
   - 分析：异常路径揭示输入校验与失败处理

4. **GC 与引用计数**：
   - refc（旧默认）：引用计数——`nimIncRef` / `nimDecRef` 调用点
   - orc（新默认）：循环收集——`nimGC_*` 分配/收集
   - 分析：GC 调用点帮助识别对象生命周期与所有权（配合字符串结构）

## 跨域联合

- [[re-binary-core]] 网关：本技能归属（选择树「Nim 产物」分支）
- [[analysis-contract]]：符号表按数据契约传递

## 常见坑与陷阱

- **GC 版本差异（refc/orc）**：现象——找不到引用计数调用；原因——orc 无显式 inc/dec；对策——按 Nim 版本确认 GC 模式再分析
- **NimString 布局随版本变化**：现象——data 字段偏移错；原因——版本演进；对策——按目标版本确认（字段序 len/reserved/data）
- **导出符号被 strip**：现象——无 NimMain/NimString 符号；原因——strip 处理；对策——按特征字符串/运行时行为识别（[[re-triage]] 初勘兜底）
- **C 混合编译**：现象——Nim/C 符号混杂；原因——`{.compile:}` 混合；对策——按符号来源分组，Nim 侧进本技能路径
- **字符串比较点误判**：现象——关键校验被当普通比较；原因——eqStrings 包装；对策——追踪 Nim 字符串函数调用点定位比较逻辑
