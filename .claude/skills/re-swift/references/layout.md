# Swift 二进制布局：mangling 语法 / swift5 反射段 / witness table / 闭包

Swift 产物相对 C/C++ 产物多两类结构：mangled 符号名（全部顶层符号经 `$s` 编码）与 `__swift5_*` 反射元数据段（协议一致性、类型描述、字段描述）。两者互补：符号名给"名字"，反射段给"结构"。

## mangling 前缀变体

| 前缀 | 时期 | 说明 |
|---|---|---|
| `$s` | Swift 5+ | 当前稳定 mangling（本技能默认处理对象） |
| `$S` | Swift 4.2 | 4.2 过渡期变体 |
| `_T0` | Swift 4.0 | 4.0 变体 |
| `_T` / `_Tt` | Swift 3.x 及更早 | ObjC 时代 mangling（`_TtC3foo3bar` 形态） |
| `$e` | — | Embedded Swift（不稳定） |
| `@__swiftmacro_` | — | 宏展开的文件名符号 |

## 编码语法（`$s` 稳定格式）

### 基本单元

| 单元 | 规则 | 示例 |
|---|---|---|
| 标识符 | 十进制长度 + ASCII 字符串（非 ASCII 用 Punycode，前缀 `00`） | `4Test` → "Test"；`13ExampleModule` → "ExampleModule" |
| 类型字母 | C=类 O=枚举 V=结构体 P=协议 E=扩展 | `3FooC` → 类 Foo |
| 标准库缩写 | Si=Int SS=String Sq=Optional Sa=Array Sd=Double Sb=Bool | `Si` → Swift.Int |
| 模块缩写 | s=Swift So=C/ObjC 模块 SC=Clang importer | `s4main` 中 `s` 为 Swift 模块 |
| 空元组 | y | `() `（参数或结果为空） |
| 函数 | 声明名 + 标签列表 + 签名 + `F`；**签名顺序 = 结果类型在前、参数在后** | `3bar Si y F` → `bar() -> Int` |

### 后缀修饰（实体级）

| 后缀 | 含义 |
|---|---|
| `_To` | @objc 桥接 thunk（与本体成对出现，ObjC 侧经它进 Swift 实现） |
| `TE` | distributed thunk |
| `Tg5`/`Tg` 等 | 泛型特化（generic specialization） |
| `TA` | 闭包 partial apply forwarder |
| `TW` | 协议 witness thunk（`{T:} protocol witness for ...`） |
| `TI` | 可派发 thunk（method dispatch thunk） |

### 替换与符号化引用

- 替换表（substitution）：`A` 起的小写字母引用已出现的模块/类型（压缩重复前缀）
- 符号化引用（symbolic reference）：mangled 名内嵌 `\x01-\x1f` 控制字符 + 指针大小字节——**不是 \0 结尾的普通字符串**，`strings`/strlen 处理会截断（见 SKILL.md 坑 6）

### 手读示例（官方测试向量）

```
$s4main6myFuncyyF          → main.myFunc() -> ()
└模块"main"└函数"myFunc"└结果y(())└参数y(())└F

$s3foo3barC3bas3zimyAaEC_tF  → foo.bar.bas(zim: foo.zim) -> ()
└模块foo └类bar └方法bas └标签zim └参数y └结果(替换A→foo.zim)└F

$s3foo3barC3bas3zimyAaEC_tFTo → {T:...,C} @objc foo.bar.bas(zim: foo.zim) -> ()
                                 （同符号 + _To = @objc 桥接 thunk）

$s4main3fooyySiFyyXEfU_TA.1 → {T:} partial apply forwarder for closure #1
                               () -> () in main.foo(Swift.Int) -> ()（闭包）
```

## swift5 反射段（Mach-O 名 / ELF 名 / COFF 名）

| 内容 | Mach-O（__TEXT 段内） | ELF | COFF |
|---|---|---|---|
| 协议一致性（conformance 记录） | `__swift5_proto` | `swift5_protocol_conformances` | `.sw5prtc$B` |
| 协议描述符 | `__swift5_protos` | `swift5_protocols` | `.sw5prt$B` |
| 类型描述符 | `__swift5_types` | `swift5_types` | `.sw5tyd$B` |
| 字段描述（类型内布局） | `__swift5_fieldmd` | `swift5_fieldmd` | `.sw5fld$B` |
| 类型引用字符串池 | `__swift5_typeref` | `swift5_typeref` | `.sw5tyr$B` |
| 反射字符串 | `__swift5_reflstr` | `swift5_reflstr` | `.sw5rfl$B` |
| 闭包捕获描述 | `__swift5_capture` | `swift5_capture` | `.sw5cpt$B` |
| 关联类型 | `__swift5_assocty` | `swift5_assocty` | `.sw5ast$B` |
| 内建类型 | `__swift5_builtin` | `swift5_builtin` | `.sw5bui$B` |
| 多态枚举 | `__swift5_mpenum` | `swift5_mpenum` | `.sw5mpe$B` |
| 可访问性 | `__swift5_accessible` | `swift5_accessible` | `.sw5acc$B` |
| 替换范围 | `__swift5_replace` | `swift5_replace` | `.sw5rpc$B` |
| 模块哈希 | `__swift_modhash` | `swift_modhash` | `.sw5mh$B` |

定位命令：Mach-O `otool -l sample | grep -A2 swift5_`；ELF `readelf -S sample | grep -i swift5`。这些段是数据段（常驻内存），**strip 不删除**——stripped Swift 产物靠它们重建类型/协议关系。

## witness table 与 conformance 记录

- conformance 记录（`__swift5_proto`）指向：witness table（若间接）、conformance 描述符、名义类型描述符、协议描述符
- witness table 槽位 = 协议要求方法的实现地址数组；槽序与协议声明顺序一致
- 定位入口：`_swift_getWitnessTable`（直接取）或 `swift_getWitnessTable`（查表）调用点；调用处的第二个参数即 conformance 记录
- 无符号名时：找到 witness method 调用点（泛型函数内对协议方法的间接调用），其函数指针表即 witness table

## 闭包 context 布局

```
swift_allocObject(闭包布局描述符, size, align) → context 对象
context 头部 = 指向闭包捕获布局描述符的指针（swift5_capture 段条目）
其后按捕获顺序排列字段：值类型=内联值；引用类型=强引用指针（配 swift_retain/release）
```

定位：`swift_allocObject` 调用点的常量参数 = 捕获布局描述符（含捕获字段数/类型）；闭包入点是 partial apply forwarder（`TA` 后缀符号）。

## 运行时符号（swift_ 前缀，导入确认）

| 符号 | 含义 |
|---|---|
| swift_retain / swift_release | 强引用增/减（引用语义字段标记） |
| swift_allocObject / swift_allocBox | 堆对象/闭包 box 分配 |
| swift_beginAccess / swift_endAccess | 独占访问修饰（exclusivity） |
| swift_getWitnessTable / _swift_getWitnessTable | 协议 witness table 获取 |
| swift_getTypeByMangledName | 按 mangled 名查类型元数据 |
| swift_dynamicCast | 动态类型转换 |

## 版本差异要点

- mangling 前缀三代（$s/$S/_T0），工具链与产物同代或更新才能解码
- Swift 4 及更早产物无 `__swift5_*` 段（反射系统 5.0 引入）；老产物靠符号名 + ObjC 段（__objc_classlist）恢复
- 泛型特化数量随版本增长（编译器更激进）；`Tg5` 特化符号与原型共存

## 使用注意

- 与 [[re-format-macho]]（段定位）、[[re-cpp-abi]]（vtable 思路）、[[re-ios]]/[[re-macos]]（ObjC 层）配合
- 符号提取走符号表（llvm-nm/readelf -s），不用 strings（symbolic reference 会截断）
