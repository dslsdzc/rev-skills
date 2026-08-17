# 4 个语言逆向技能设计（2026-08-18）

## 背景

rev-skills（97 技能）语言逆向覆盖目前只有 re-go / re-rust。用户确认新增 4 个语言技能：Swift / Zig / Nim / 函数式运行时（Haskell+OCaml 合并）。

设计约束（沿用全库红线与原则）：
- **红线 1 呈现中性**：禁用「最推荐」「强烈建议」等最高级强推措辞
- **红线 2 隐私脱敏**：内容不指向具体项目/公司/产品
- **不绑定具体工具**：方法为核心，工具为可替换示例（工具准备保留跨 OS 安装指引）
- 工作区已干净（无未提交文件）——re-binary-core 可正常修改提交
- 当前分支 `main`

## 变更总览

| # | 新技能 | 类型 | 挂载 | 计数 |
|---|---|---|---|---|
| 1 | re-swift | 原子 | re-binary-core | 98 |
| 2 | re-zig | 原子 | re-binary-core | 99 |
| 3 | re-nim | 原子 | re-binary-core | 100 |
| 4 | re-fp-runtime | 原子 | re-binary-core | 101 |

最终：101 技能 = 1 入口 + 12 网关 + 88 原子。

## ① re-swift（Swift 生态）

- **定位**：Swift 二进制逆向——mangling、协议 witness table、闭包捕获、ObjC 互操作
- **frontmatter**：`name: re-swift`；触发词：Swift逆向、swiftc、witness table、swift demangle、闭包捕获、Swift 产物
- **章节**：
  1. 何时使用 / 何时不用——用：Swift 产物（Mach-O/ELF 含 Swift mangling 特征）；不用：纯 ObjC（走 [[re-ios]] / [[re-macos]] 的 ObjC 路径）
  2. 工具准备——swift-demangle（Swift 工具链）、llvm-objdump、Ghidra/IDA；跨 OS 安装命令
  3. 操作步骤——
     1. 产物识别（`$s` mangling 前缀、swift_* 运行时导入）
     2. mangling 解码（swift-demangle 批量：类型/函数/泛型展开）
     3. 协议 witness table（协议方法分发表定位与还原）
     4. 闭包捕获（context 结构：捕获变量布局还原）
     5. ObjC 互操作（@objc 桥接、NSObject 子类、消息发送路径）
  4. 跨域联合——[[re-binary-core]] 网关；[[re-ios]] / [[re-macos]] 生态衔接
  5. 常见坑与陷阱——mangling 版本差异、泛型展开符号爆炸、witness table 无符号名、闭包捕获含引用语义
- **挂载**：re-binary-core 子技能列表 + 选择树分支；re-ios / re-macos 跨域引用

## ② re-zig（Zig 产物）

- **定位**：Zig 编译产物逆向——ABI 简单（无 RTTI/无异常）、comptime 展开、panic/错误处理路径
- **frontmatter**：触发词：Zig逆向、zig、comptime、zig 产物、panic
- **章节**：
  1. 何时使用 / 何时不用——用：Zig 产物（无 C++ RTTI/异常表、panicking 函数特征）；不用：C/C++ 产物（走 [[re-cpp-abi]]）
  2. 工具准备——readelf / llvm-nm、Ghidra/IDA；跨 OS 安装
  3. 操作步骤——
     1. 产物识别（panicking 函数特征、std 符号模式、无 RTTI/异常表）
     2. 导出符号与启动路径（start/main、comptime 展开产物）
     3. panic/错误处理路径（错误联合类型布局）
     4. C ABI 边界（@extern/@cImport 产物识别）
  4. 跨域联合——[[re-binary-core]] 网关；[[re-cpp-abi]] 边界区分
  5. 常见坑与陷阱——comptime 展开导致符号膨胀、panic 路径误导、错误联合布局版本差异、与 C 混合编译难分界
- **挂载**：re-binary-core

## ③ re-nim（Nim 产物）

- **定位**：Nim 编译产物逆向——GC/异常运行时、NimString、导出符号
- **frontmatter**：触发词：Nim逆向、nim、NimString、NimMain、nim 产物
- **章节**：
  1. 何时使用 / 何时不用——用：Nim 产物（NimMain/GC 符号特征）；不用：C 产物（走 [[re-binary-core]] 通用）
  2. 工具准备——readelf、Ghidra/IDA；跨 OS 安装
  3. 操作步骤——
     1. 产物识别（NimMain / GC 符号、NimString 结构特征）
     2. 字符串与序列结构（NimStringV2 布局：len/reserved/data）
     3. 异常与 raises 路径（Nim 异常机制）
     4. GC 与引用计数（refc/orc 差异）
  4. 跨域联合——[[re-binary-core]] 网关
  5. 常见坑与陷阱——GC 版本差异（refc/orc）、NimString 布局随版本变化、导出符号被 strip、C 混合编译
- **挂载**：re-binary-core

## ④ re-fp-runtime（函数式运行时：Haskell / OCaml 合并）

- **定位**：函数式语言运行时逆向——GHC RTS 与 OCaml runtime 的闭包/堆模型；逆向着重数据流而非控制流
- **frontmatter**：触发词：Haskell逆向、OCaml逆向、GHC RTS、thunk、STG、OCaml runtime、闭包、函数式产物
- **章节**：
  1. 何时使用 / 何时不用——用：Haskell/OCaml 产物（RTS 符号、block 头特征）；不用：命令式语言产物（各归各技能）
  2. 工具准备——readelf、ghc 工具链（ghc-nm 等）、ocamlobjinfo、Ghidra/IDA；跨 OS 安装
  3. 操作步骤——
     1. 运行时识别（GHC RTS 符号 / OCaml block 头；字节码 vs 原生产物区分）
     2. 闭包与堆对象（GHC thunk/CAF 布局；OCaml tagged int / block 头）
     3. 调用约定（GHC 栈/寄存器约定；OCaml 参数传递）
     4. 分析策略（数据流优先——函数式产物控制流被打散，闭包字段与构造器是主要线索）
  4. 跨域联合——[[re-binary-core]] 网关
  5. 常见坑与陷阱——RTS 版本差异、thunk 惰性求值误导（未求值闭包 vs 已求值）、OCaml 字节码非 native、控制流打散导致静态分析失效
- **挂载**：re-binary-core

## 同步

- re-binary-core：子技能列表加 4 个 + 选择树加 4 分支（目标语言 → 对应技能）
- re-ios / re-macos 跨域联合各加一行 [[re-swift]]
- README：技能导航（97）→（101）、「12 大类网关 → 84 原子技能」→ 88、re-binary-core 导航行加 4 个
- AGENTS.md：（97 个技能）→（101 个技能）、原子技能（84）→（88）
- marketplace.json：97 个技能 → 101 个技能

## 校验与测试

- validate.mjs 自动覆盖 4 个新技能（frontmatter name=目录名 / type=atomic / 工具准备 / 链接）
- `npm test` 全绿（101 skills validated）
- 工作区已干净，无未提交文件冲突
