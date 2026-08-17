---
name: re-swift
type: atomic
description: >
  Swift 二进制逆向：mangling 解码、协议 witness table、闭包捕获、ObjC 互操作。
  触发词：Swift逆向、swiftc、witness table、swift demangle、闭包捕获、Swift 产物。
---

# Swift 逆向

## 何时使用 / 何时不用

- 用：Swift 产物（Mach-O/ELF 含 Swift mangling 特征 `$s` 前缀）
- 不用：纯 ObjC（走 [[re-ios]] / [[re-macos]] 的 ObjC 路径）

## 工具准备

### swift-demangle（Swift 工具链，mangling 解码）

- macOS: Xcode 自带（`xcrun swift-demangle`）；Linux: `apt install swiftlang` 或 Swift 官方工具链
- Windows: Swift 官方工具链
- 验证: `echo '$s3foo3bar' | swift-demangle`（macOS 用 `xcrun swift-demangle`；输出可读形式）

### llvm-objdump（反汇编辅助）

- 安装与验证见 [[re-cpp-abi]] 工具准备

### Ghidra / IDA（反编译底座）

- 安装与验证见 [[re-ghidra]] / [[re-ida]]

## 操作步骤

按顺序执行，每步产物存档（路径 + sha256，见 [[re-triage]]）。

1. **产物识别**：
   ```sh
   strings sample | grep -E '^\$s' | head
   readelf -s sample 2>/dev/null | grep -E 'swift_' | head   # ELF；Mach-O 用 llvm-nm
   ```
   - `$s` mangling 前缀是 Swift 标志；swift_* 运行时导入（swift_retain / swift_release / swift_allocObject）确认
   - 纯 ObjC 无 `$s` → 转 [[re-ios]] / [[re-macos]]

2. **mangling 解码（批量）**：
   ```sh
   readelf -s sample | awk '$8 ~ /^\$s/ {print $8}' | swift-demangle | head -20
   # Mach-O: llvm-nm sample | awk '$2 ~ /^\$s/ {print $2}' | swift-demangle
   ```
   - 解码内容：模块名/类型/函数签名/泛型参数展开
   - 解码结果写入符号表（供 [[re-ghidra]] / [[re-ida]] 重命名）

3. **协议 witness table**：
   - witness table 是协议方法的分发表（Swift 动态分派的核心）
   - 定位：Mach-O `__swift5_protoc` 段 / ELF `.swift5_protoc` 段的 conformance 记录（`$s...M` 符号），或搜索 `_swift_getWitnessTable` 调用点
   - 还原：表内槽位 = 协议要求的方法实现地址 → 结合 [[re-cpp-abi]] 的 vtable 恢复思路反推协议一致性

4. **闭包捕获**：
   - 闭包是 context 对象：捕获变量布局（按捕获顺序 + 引用语义标记）
   - 定位：`swift_allocObject` 调用点 → context 分配 → 捕获字段初始化
   - 还原：context 结构体字段 → 捕获变量名/类型（与函数签名关联）

5. **ObjC 互操作**：
   - `@objc` 桥接：Swift 类经 ObjC runtime 可见（NSObject 子类、消息发送 objc_msgSend）
   - 分析：ObjC 方法列表（class-dump 思路）→ Swift 实现入口（桥接 thunk）
   - 混合产物：先走 ObjC 路径（[[re-ios]] / [[re-macos]]）再进 Swift 层

## 跨域联合

- [[re-binary-core]] 网关：本技能归属（选择树「Swift 产物」分支）
- [[re-ios]] / [[re-macos]]：生态衔接（ObjC 层、App 层分析）
- [[re-cpp-abi]]：vtable/witness table 恢复思路同源
- [[analysis-contract]]：符号表按数据契约传递

## 常见坑与陷阱

- **mangling 版本差异**：现象——新版本 Swift 产物解码失败；原因——mangling 方案演进；对策——升级 swift-demangle 匹配目标编译版本
- **泛型展开符号爆炸**：现象——解码输出大量 `$s...Gy` 泛型实例；原因——泛型特化；对策——按模块/类型聚类过滤
- **witness table 无符号名**：现象——分发表槽位全是裸地址；原因——协议 conformance 无命名符号；对策——结合协议方法调用点反推
- **闭包捕获含引用语义**：现象——context 字段是引用计数对象；原因——捕获变量含类实例；对策——按 swift_retain/release 调用点确认引用字段
- **纯 ObjC 误入**：现象——无 `$s` 却按 Swift 流程走；原因——产物实为 ObjC；对策——步骤 1 先确认（无 `$s` 即转）
