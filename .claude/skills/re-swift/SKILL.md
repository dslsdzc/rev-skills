---
name: re-swift
type: atomic
description: >
  Swift 二进制逆向：mangling 解码、协议 witness table、闭包捕获、ObjC 互操作。
  触发词：Swift逆向、swiftc、witness table、swift demangle、闭包捕获、Swift 产物。
---

# Swift 逆向

## 何时使用 / 何时不用

- 用：Swift 产物（Mach-O/ELF 含 Swift mangling 特征 `$s` 前缀，或 `__swift5_*` 反射段），需要还原符号/协议一致性/闭包结构
- 用：混合产物中区分 Swift 层与 ObjC/C 层（先走 ObjC 路径再进 Swift 层）
- 不用：纯 ObjC（走 [[re-ios]] / [[re-macos]] 的 ObjC 路径）；纯 C/C++（走 [[re-cpp-abi]]）
- 不用：只需普通反编译（[[re-ghidra]] / [[re-ida]] 直接上）

## 工具准备

### swift-demangle（Swift 工具链，mangling 解码）

- macOS: Xcode 自带（`xcrun swift-demangle`）；Linux: Swift 官方工具链（swift.org 下载 tar 包解压即用，含 `swift-demangle`）；Windows: Swift 官方工具链
- 验证: `echo '$s4main6myFuncyyF' | swift-demangle`（macOS 用 `xcrun swift-demangle`；无参数时读 stdin，输出 `$s... ---> main.myFunc() -> ()`）
- 批量: `llvm-nm sample | swift-demangle`；`-simplified` 出精简名；`-expand` 出解码树

### swiftc / swift（可选，对照编译）

- macOS: Xcode 自带；Linux/Windows: 同上官方工具链（含编译器，可本地编译同版本样本对照符号形态）
- 验证: `swift --version`

### llvm-nm / llvm-objdump（符号与段）

- 安装与验证见 [[re-cpp-abi]] 工具准备；Mach-O 侧额外需要 otool（见 [[re-format-macho]] 工具准备）
- 用途: `llvm-nm -m sample` 看符号与段归属；`otool -l sample | grep swift5` 定位反射段

### Ghidra / IDA（反编译底座）

- 安装与验证见 [[re-ghidra]] / [[re-ida]]；Swift 符号解码结果用于批量重命名（Ghidra 可脚本化：demangle 输出写回 symbol 表，反编译视图即恢复可读函数名）

## 操作步骤

按顺序执行，每步产物存档（路径 + sha256，见 [[re-triage]]）。

1. **产物识别**：
   ```sh
   strings -a sample | grep -E '^\$s|^_T0|^_\$S' | head
   llvm-nm sample 2>/dev/null | grep -E 'swift_|^\$s' | head   # ELF 用 readelf -s 同效果
   otool -l sample 2>/dev/null | grep -c swift5               # Mach-O 反射段存在性
   ```
   - `$s`（Swift 5+）、`$S`（Swift 4.2）、`_T0`（Swift 4.0）是三代 mangling 前缀；`swift_*` 运行时导入（swift_retain / swift_release / swift_allocObject）确认运行时
   - 纯 ObjC 无上述特征 → 转 [[re-ios]] / [[re-macos]]；带 `__swift5_*` 段但 strip 了符号名 → 仍是 Swift（反射元数据不随 strip 消失，见坑 5）

2. **mangling 解码（批量）**：
   ```sh
   llvm-nm -m sample | awk '$3 ~ /^\$s/ {print $3}' | swift-demangle | head -20
   # ELF: readelf -s sample | awk '$8 ~ /^\$s/ {print $8}' | swift-demangle
   ```
   解码内容：模块名/类型/函数签名/泛型参数展开；结果写入符号表供 [[re-ghidra]] / [[re-ida]] 重命名。mangling 结构速览见步骤 3 与 [[layout]]。

3. **mangling 结构速览（手读符号）**：
   ```
   $s 前缀 + 长度前缀标识符 + 类型字母 + 签名
   $s 13ExampleModule 3Foo C 3bar Si y F
      └模块(13字符)   └类型 └类 └方法 └结果 └参数 └函数
   C=类 O=枚举 V=结构体 P=协议；Si=Int SS=String Sq=Optional；y=空元组 ()
   ```
   编码规则：标识符=十进制长度+ASCII；签名顺序是**结果类型在前、参数在后**，`F` 结尾表示函数；签名可带修饰位（async/throws，解码输出中显式出现）；`_To` 后缀=@objc 桥接 thunk；`TE` 后缀=distributed thunk。详细规则与官方示例见 [[layout]]/[[examples]]。

4. **协议 witness table（动态分派核心）**：
   - witness table 是协议方法的分发表；conformance 记录定位：Mach-O `__swift5_proto` 段 / ELF `swift5_protocol_conformances`（协议描述符在 `__swift5_protos` / `swift5_protocols`），或搜索 `_swift_getWitnessTable` 调用点
   - 还原：conformance 记录 = 方法槽位数组，槽值 = 对应协议要求的实现地址 → 结合 [[re-cpp-abi]] 的 vtable 恢复思路反推"哪个类型 conforms 哪个协议"
   - 无符号名时用协议方法调用点反推：找到 witness method 调用处的函数指针表，表序即协议声明序
   - 注意间接 conformance（`witness_table_indirect` 标志）：槽位存的是间接表指针而非直接实现地址，需再解一层

5. **闭包捕获**：
   - 闭包是 context 对象：`swift_allocObject` 调用点 → context 分配 → 捕获字段初始化；context 头部是指向捕获布局描述符的指针，其后按捕获顺序排列字段
   - 还原：context 结构体字段 → 捕获变量名/类型（与函数签名关联）；引用语义字段由 `swift_retain`/`swift_release` 调用点确认
   - 编译器生成的"partial apply forwarder"符号（解码含 `partial apply forwarder`）是闭包入点的典型形态

6. **ObjC 互操作**：
   - `@objc` 桥接：Swift 类经 ObjC runtime 可见（NSObject 子类、消息发送 objc_msgSend）；Swift 侧实现入口是 `_To` 结尾的桥接 thunk
   - 分析：ObjC 方法列表（class-dump 思路）→ 桥接 thunk → Swift 实现；`swift_` 运行时函数调用点区分 Swift 侧逻辑
   - 混合产物：先走 ObjC 路径（[[re-ios]] / [[re-macos]]）再进 Swift 层；Linux 上的 Swift 产物无 ObjC 层（无 __objc_classlist），纯 ELF 视角分析

7. **反射元数据（类型结构还原）**：
   ```sh
   otool -l sample | grep -A2 swift5_fieldmd      # 字段描述（类型内布局）
   otool -l sample | grep -A2 swift5_typeref      # 类型引用（字符串池）
   otool -l sample | grep -A2 swift5_reflstr      # 反射字符串
   ```
   `__swift5_fieldmd` 记录类型字段名/类型引用；配合 `__swift5_typeref` 可还原结构体/类布局，比纯反编译更快。

8. **符号化恢复**：解码结果批量重命名后，泛型特化符号（大量 `Gy` 后缀）按模块/类型聚类过滤，先恢复"每个类型的核心方法"再处理特化副本（见坑 2）。

9. **字节级核对**：符号提取/段定位输出异常时，用 `xxd` 按字节核对（mangled 名是长度前缀+ASCII，反射段是数据段内的定长记录）——最小字节样例与核对流程见 [[examples]]，别把工具解析失败当"非 Swift 产物"丢弃。

## 跨域联合

- [[re-binary-core]] 网关：本技能归属（选择树「Swift 产物」分支）
- [[re-ios]] / [[re-macos]]：生态衔接（ObjC 层、App 层分析）
- [[re-format-macho]]：Mach-O 段/反射段定位工具链
- [[re-cpp-abi]]：vtable/witness table 恢复思路同源
- [[re-frida]]：运行时 hook Swift 函数（符号解码后的名称直接作 hook 点）
- [[analysis-contract]]：符号表按数据契约传递

## 常见坑与陷阱

- **mangling 版本差异**：现象——新版本 Swift 产物解码失败或输出乱码；原因——mangling 方案演进（`$s`/`$S`/`_T0` 三代）；对策——用与目标编译版本同代或更新的 swift-demangle，`_T0` 老符号新工具也能解，但新符号老工具不行
- **泛型展开符号爆炸**：现象——解码输出大量 `$s...Gy` 泛型实例；原因——泛型特化；对策——按模块/类型聚类过滤，先还原未特化原型
- **witness table 无符号名**：现象——分发表槽位全是裸地址；原因——协议 conformance 无命名符号；对策——结合协议方法调用点（witness method 调用处）反推槽位语义
- **闭包捕获含引用语义**：现象——context 字段是引用计数对象；原因——捕获变量含类实例；对策——按 swift_retain/release 调用点确认引用字段，别当值类型读
- **纯 ObjC 误入**：现象——无 `$s` 却按 Swift 流程走；原因——产物实为 ObjC；对策——步骤 1 先确认（无 `$s`/`__swift5_*` 即转）
- **mangled 名不是普通字符串**：现象——`strings`/grep 截断或漏检部分符号；原因——mangled 名可含 `\x01-\x1f` 控制字符后跟指针字节（symbolic reference），不是以 `\0` 结尾的干净串；对策——符号提取用 `llvm-nm`/`readelf -s` 的符号表，不用 `strings` 兜底；解析器遇到控制字符要拒读指针字节
- **strip 后反射段仍在但符号名没了**：现象——`__swift5_proto` 段还在、`$s` 符号列表为空；原因——strip 只删符号表，反射元数据（conformance/fieldmd）属数据段；对策——从反射段重建类型/协议关系，不依赖符号名
- **`_To` 后缀被当普通符号**：现象——`foo.bar.bas(zim:)` 和 `@objc foo.bar.bas(zim:)` 两个符号并存，漏掉后者；原因——`_To` 是 @objc 桥接 thunk；对策——`_To` 与本体成对分析，ObjC 侧调用经 thunk 进 Swift 实现
- **入口不是 ObjC 的 main 视角**：现象——按 `main` 函数分析发现"入口"只有薄薄一层；原因——Swift 可执行文件入口是 `@main`/顶层代码经运行时初始化（swift_retain 大量出现于启动路径）；对策——从 `main` 反汇编沿运行时调用链找到第一个用户类型的方法调用点再深入，别在初始化包装里打转
- **Swift 4 老产物无反射段**：现象——没有 `__swift5_*` 段、符号又被 strip，只剩 `_T`/`_T0` 前缀残迹；原因——反射系统 5.0 才引入；对策——按 mangling 前缀（`_TtC` 等）与 `swift_retain`/`swift_release` 运行时调用点识别 Swift 侧代码，从 ObjC 段（__objc_classlist）补类型骨架

