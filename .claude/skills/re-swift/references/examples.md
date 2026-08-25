# Swift 最小解析示例

示例符号均取自官方测试向量（swiftlang/swift test/Demangle/Inputs/manglings.txt 与 ABI 文档 Mangling.rst），可本机直接对照。语法规则见 [[layout]]。

## 1. 符号提取与解码命令链

```sh
# Mach-O: 提取 $s 符号 → 批量解码
llvm-nm -m sample | awk '$3 ~ /^\$s/ {print $3}' | swift-demangle | head -20
# ELF 同效果
readelf -s sample | awk '$8 ~ /^\$s/ {print $8}' | swift-demangle | head -20
# 单条解码（macOS 用 xcrun swift-demangle；无参数时读 stdin）
echo '$s4main6myFuncyyF' | swift-demangle
# $s4main6myFuncyyF ---> main.myFunc() -> ()
# 精简模式与展开树
echo '$s4main3FooC3barSiyF' | swift-demangle -simplified
echo '$s4main3FooC3barSiyF' | swift-demangle -expand
```

## 2. 官方测试向量对照（manglings.txt 实测摘录）

| mangled 名 | demangled 结果 |
|---|---|
| `$s4main6myFuncyyF` | `main.myFunc() -> ()` |
| `$s3foo3barC3bas3zimyAaEC_tF` | `foo.bar.bas(zim: foo.zim) -> ()` |
| `_$s3foo3barC3bas3zimyAaEC_tFTo` | `{T:_$s3foo3barC3bas3zimyAaEC_tF,C} @objc foo.bar.bas(zim: foo.zim) -> ()`（`_To` = @objc 桥接 thunk） |
| `$s4main3fooyySiFyyXEfU_TA.1` | `{T:} partial apply forwarder for closure #1 () -> () in main.foo(Swift.Int) -> () with unmangled suffix ".1"`（闭包 forwarder） |
| `$s4main8MyStructV3fooyyF` | `main.MyStruct.foo() -> ()`（结构体方法） |
| `_T04main1_yyF` | `main._() -> ()`（Swift 4.0 `_T0` 前缀） |
| `_TtVCC4main3Foo4Ding3Str` | `main.Foo.Ding.Str`（Swift 3.x `_Tt` 前缀，V=struct 链） |

对照要点：`yyF` 中两个 `y` 分别是结果 `()` 与参数 `()`；`Si` 为结果 Int 时排在参数前（`3barSiyF` → `bar() -> Int`）；`_To` 与本体成对出现；`TA` 是闭包 forwarder（闭包入点）。

## 3. Python 最小解码器（无替换/无泛型的简单符号）

```python
import re
KIND = {'C': 'class', 'O': 'enum', 'V': 'struct', 'P': 'protocol'}
STDLIB = {'Si': 'Int', 'SS': 'String', 'Sq': 'Optional', 'Sa': 'Array',
          'Sd': 'Double', 'Sb': 'Bool'}

def ident(sym, p):            # 长度前缀标识符：3Foo -> "Foo"
    m = re.match(r'(\d+)', sym[p:])
    n = int(m.group(1)); start = p + len(m.group(1))
    return sym[start:start+n], start+n

def typ(sym, p):              # 类型单元：y=() Si=Int ...
    c = sym[p]
    if c == 'y': return '()', p + 1
    if c == 'S': return STDLIB.get(sym[p:p+2], 'S?'), p + 2
    raise ValueError('unhandled type char %r' % c)

def sig(sym, p):              # 签名顺序：结果类型在前、参数在后
    result, p = typ(sym, p)
    params, p = typ(sym, p)
    if sym[p] != 'F': raise ValueError('no F')
    return '%s -> %s' % (params, result), p + 1

def decode(sym):
    p = 2 if sym.startswith('$s') else 3   # 仅支持 $s / _$s
    mod, p = ident(sym, p)
    parts = [mod]
    while p < len(sym) and sym[p].isdigit():
        name, p = ident(sym, p)
        if p < len(sym) and sym[p] in KIND:
            parts.append('%s (%s)' % (name, KIND[sym[p]])); p += 1
        else:
            parts.append(name)
    s, _ = sig(sym, p)
    return '.'.join(parts) + s

print(decode('$s4main6myFuncyyF'))              # main.myFunc() -> ()
print(decode('$s4main3FooC3barSiyF'))           # main.Foo (class).bar() -> Int
print(decode('$s13ExampleModule3FooC3barSiyF')) # ExampleModule.Foo (class).bar() -> Int
```

局限（对照官方语法）：不处理替换表（`A` 起）、泛型签名（`G`）、标签列表、`E` 扩展与 `To/TE/Tg` 后缀——复杂符号以 `swift-demangle` 为准，本解码器用于快速手读与理解编码顺序。

## 4. 反射段定位（stripped 产物的类型结构来源）

```sh
otool -l sample | grep -A2 'sectname __swift5_proto'    # conformance 记录
otool -l sample | grep -A2 'sectname __swift5_protos'   # 协议描述符
otool -l sample | grep -A2 'sectname __swift5_fieldmd'  # 字段描述
otool -l sample | grep -A2 'sectname __swift5_types'    # 类型描述符
# ELF 侧
readelf -S sample | grep -i swift5
```

## 5. 字节样例（符号在文件中的形态）

```
$s4main6myFuncyyF 的 ASCII 字节（符号表字符串池内）：
24 73 34 6d 61 69 6e 36 6d 79 46 75 6e 63 79 79 46 00
 $  s  4  m  a  i  n  6  m  y  F  u  n  c  y  y  F \0
└前缀┘ └模块"main"┘ └函数名"myFunc"┘ └yyF 签名┘
```

对照要点：正常符号以 `\0` 结尾（字符串表内），但含 symbolic reference 的符号名内嵌 `\x01-\x1f` + 指针字节，`strings`/`grep` 按文本处理会截断——提取一律走符号表（llvm-nm/readelf -s）。

## 实现教训（内化）

- 解码顺序是"模块 → 类型上下文 → 实体名 → 签名"，签名里结果类型在参数前——手读符号按这个顺序切，别倒着猜
- `_To`/`TA`/`Tg5` 等后缀是实体修饰，解码时先剥离再读主体
- 官方测试向量（manglings.txt）是最好的离线对照集：任何解码器/工具的输出都可拿它验收

## 使用注意

- 符号提取用符号表工具，不用 strings；strip 产物靠 `__swift5_*` 反射段（见 SKILL.md 坑 5）
- 与 [[re-format-macho]]（段定位）、[[re-cpp-abi]]（vtable 思路）配合使用
