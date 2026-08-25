# Nim 最小解析示例

示例以本机 nim 2.2.10 编译的真实产物为标本（`nim c -d:release --gc:orc`），输出与 Python 解析可逐字段对照。产物结构定义见 [[layout]]。

## 0. 标本构建

```sh
# hello.nim（含字符串比较、对象、字符串拼接）
import std/strutils
type Pet = object
  name: string
  age: int
proc check(s: string): bool =
  if s == "admin": return true
  false
proc main() =
  let p = Pet(name: "rex", age: 3)
  if check(p.name): echo "match: ", p.age
  else: echo "no: ", p.name & "!"
main()

nim c -d:release --gc:orc -o:hello_orc hello.nim     # orc（2.x 默认）
nim c --gc:refc -o:hello_refc hello.nim              # refc（对照）
```

## 1. 符号对照（release 构建）

```
$ nm hello_orc | grep -iE 'NimMain|newString|eqStrings'
000000000000be10 T NimMain            ← 入口链（C main → NimMain → NimMainInner → NimMainModule）
000000000000bdf0 T NimMainInner
000000000000be30 T NimMainModule
0000000000008110 t rawNewString       ← 字符串分配（1.x 与 2.x 均为此 importc 名）
```

对照要点：release 下 `nimGC_*`/`eqStrings` 被内联（nm 无输出是正常现象，见 SKILL.md 坑 1/7）；`NimMain*` 与 `rawNewString` 是稳定锚点。debug 构建（`nim c --gc:orc`）可见 `eqStrings`、`nimIncRefCyclic`、`nimDecRefIsLastCyclicDyn`；refc 构建可见 `nimGC_setStackBottom`、`nimGCunref`、`nimGCvisit`——GC 模式判别直接看这些符号有无（判别表见 [[layout]]）。

## 2. 字符串布局验证（生成 C 结构，实测）

```
$ grep -A6 'struct NimStringV2' 生成缓存目录/@mhello.nim.c
struct NimStringV2 {
    NI len;
    NimStrPayload* p;
};
struct NimStrPayload {
    NI cap;
    NIM_CHAR data[SEQ_DECL_SIZE];   /* 内联字符 */
};
```

对照要点：orc 产物字符串是 `len + payload 指针`（payload = cap + 内联数据），**不是** 1.x refc 的 `len/reserved/data` 内联——手写解析器必须先按 GC 模式选布局（[[layout]] 判别表）。cap 的 bit 62（64 位）为字面量标记 strlitFlag。

## 3. Python 解析 NimStringV2（内存视图，最小示例）

```python
import struct

# 模拟 Nim 对象布局：Pet = { name: NimStringV2, age: int }
# NimStringV2 = { len: int64, p: ptr }（orc 布局，64 位小端）

def read_nimstr_v2(buf, off):
    ln, p = struct.unpack_from('<QQ', buf, off)
    if p == 0 or ln == 0:
        return '' if ln == 0 else '(nil payload!)'
    cap, = struct.unpack_from('<Q', buf, p)
    data = buf[p+8 : p+8+ln]
    return data.decode('utf-8', 'replace')

# 用途：在转储中定位 NimStringV2（len 字段与 payload 里的 cap/data 互相印证），
# 还原字符串即找到校验/命令分发点。refc 布局改为内联读取：
def read_nimstr_desc(buf, off):
    ln, reserved = struct.unpack_from('<QQ', buf, off)
    return buf[off+16 : off+16+ln].decode('utf-8', 'replace')
```

对照要点：v2 布局下字符串内容在堆上（payload），栈上只有 len+指针；搜索字符串时按 `cap` 前缀特征（对齐的容量值）比按内容更可靠。

## 4. 异常实现对照（2.2.10，Linux x86-64）

```
$ nim c --gc:orc -o:exc_nim exc.nim     # 含 try/except 的程序
$ nm exc_nim | grep -iE 'setjmp|raiseException|personality'
00000000000075db t raiseExceptionAux__system_u4320
00000000000076db t raiseExceptionEx
# 无 nimSetjmp、无 __gxx_personality_v0 —— goto 式异常（无 setjmp）
$ readelf -S exc_nim | grep -E 'except_table|eh_frame'
  [15] .eh_frame_hdr
  [16] .eh_frame                # 有 unwind 信息但无 .gcc_except_table

# 对照：--exceptions:setjmp 构建
$ nim c --gc:orc --exceptions:setjmp -o:exc_nim_sj exc.nim
$ grep -c setjmp 生成缓存目录/@mexc.nim.c
3                                  # setjmp 调用出现 = 老式异常
```

对照要点：2.2 默认产物"有异常处理但无 setjmp 符号"；`nimSetjmp` 只在老默认/显式 `--exceptions:setjmp` 下出现。raise 路径锚点是 `raiseExceptionEx`。

## 5. 字节样例（入口与特征串）

```
$ xxd -l 32 hello_orc | head -2
00000000: 7f45 4c46 0201 0100 0000 0000 0000 0000  .ELF............
00000010: 0300 3e00 0100 0000 9011 0000 0000 0000  ..>.............
         e_type=03(DYN/PIE) e_machine=003e(x86-64) e_entry=0x1190

$ strings -n 6 hello_orc | grep -E '\.nim' | sort -u
@mhello.nim.c                          ← C 代码生成缓存文件名（含模块名，release 也嵌入）
@psystem.nim.c  @pstd@sprivate@sdigitsutils.nim.c  ← 运行时模块
fatal.nim                              ← std 运行时源文件名
```

对照要点：Nim 产物嵌入的 `.nim` 特征串是 `@m<模块>.nim.c`（C 缓存名）与 std 模块源文件名，不含业务源码名——stripped 兜底按 `@m*.nim.c` 匹配模块列表。

## 实现教训（内化）

- 先判 GC 模式再选字符串/GC 布局：判别表见 [[layout]]，符号判据用 debug 构建，release 用行为特征
- `NimMain*` 三连与 `rawNewString`/`eqStrings` 是跨版本稳定锚点，符号定位从它们出发
- 异常"无 setjmp"不代表无异常处理：2.2+ 默认 goto 式，锚点改 `raiseExceptionEx`

## 使用注意

- 静态分析无需沙箱；本机 nim 2.2.10 实测输出与用户产物的差异以产物自身符号为准
- 与 [[analysis-contract]]（符号表传递）、[[re-triage]]（初勘兜底）配合使用
