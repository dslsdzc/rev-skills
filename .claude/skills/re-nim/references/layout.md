# Nim 二进制布局：入口链 / 字符串结构 / GC 与异常实现

Nim 产物是 C 代码生成 + 运行时库链接：入口链、字符串布局、GC 与异常实现都随编译器版本与 GC 模式变化。先确认"版本 + GC 模式"再选布局是分析前提。

## 入口链（ELF，Linux 默认 C 后端）

```
C main
  └─ NimMain          （运行时初始化：GC 启动、堆栈底部设置）
       └─ NimMainInner
            └─ NimMainModule   （各模块初始化：全局变量构造、模块级代码）
                 └─ 业务 main（用户定义的 main 过程）
```

- 符号形态（实测 nim 2.2.10）：`NimMain`/`NimMainInner`/`NimMainModule` 均为导出函数；`main` 是 C 入口
- 模块级函数名带模块前缀与哈希后缀：`main__hello_u8`、`check__hello_u5`（`<proc>__<module>_<id>` 形态）
- 字符串等运行时类型以 C struct 形态存在于调试类型：`NimStringV2`/`NimStrPayload`（stripped 后消失，靠布局表恢复）

## 字符串结构（按 GC 模式分叉）

### orc/arc（2.x 默认 orc；实测 2.2.10 生成的 C 结构）

```c
struct NimStringV2 {          /* 8/16 字节（64 位）：len + 指针 */
    NI len;                   /* 字节长度（不含结尾 \0） */
    NimStrPayload* p;         /* 堆上 payload；len==0 时可 nil（字面量 p 指向静态区） */
};
struct NimStrPayload {
    NI cap;                   /* 容量；cap 高位 bit(62) 为 strlitFlag（字面量标记） */
    NIM_CHAR data[];          /* 内联字符数组 */
};
```

- `strlitFlag = 1 shl (sizeof(int)*8 - 2)`（64 位下 bit 62）：cap 带此位 = 字符串字面量（静态区，不可变）
- 分配函数：`rawNewString`（1.x 与 2.x 均为此 importc 名，实测 1.6 与 2.2 一致）
- 内存图：`NimStringV2` 可内联在栈/对象里，payload 独立堆分配（含 cap 前缀）

### refc（1.x 默认与 2.x --gc:refc；NimStringDesc）

```c
struct NimStringDesc {        /* len/reserved + 内联字符 */
    NI len;
    NI reserved;              /* 已分配容量（高位带 seqShallowFlag/strlitFlag 标记） */
    NIM_CHAR data[];          /* 内联 */
};
```

- 字符串本体即结构体，无独立 payload；`NimString = ptr NimStringDesc`

### 判别表（先判 GC 模式再选布局）

| 判别线索 | orc/arc（v2 字符串） | refc（NimStringDesc） |
|---|---|---|
| 编译默认 | Nim 2.x 默认 | Nim 1.x 默认 / 2.x 显式 `--gc:refc` |
| GC 符号（debug） | `nimIncRefCyclic` `nimDecRefIsLastCyclicDyn` | `nimGC_setStackBottom` `nimGCunref` `nimGCvisit` |
| 字符串分配函数 | `rawNewString`（2.x） | `rawNewString`（1.x 经 `newStringOfCap` importc，同名） |
| 字符串比较 | `eqStrings`（两者都有，debug 可见） | 同左 |

## GC 与所有权

- refc：引用计数 + 周期收集（nimGC_* 家族）；显式 inc/dec 调用点多
- orc/arc：ARC 语义 + 周期收集（`nimIncRefCyclic`/`nimDecRefIsLastCyclicDyn`）；retain/release 由编译器在赋值/作用域边界插入，无显式计数器
- release 构建（-d:release）下 GC 辅助函数常内联消除——符号表在 debug 构建完整，release 靠行为特征

## 异常实现（版本差异大）

| 版本/开关 | 机制 | 可见符号 |
|---|---|---|
| Nim 2.2.x 默认（Linux x86-64，orc） | goto 式异常表（--exceptions:goto） | 无 setjmp；`raiseExceptionEx`/`raiseExceptionAux` |
| 老默认（--exceptions:setjmp，Nim 2.0 及以前） | setjmp/longjmp | `nimSetjmp` |
| --exceptions:cpp | C++ 异常（C++ 后端） | __cxa_throw 等 |

- 实测（2.2.10 orc）：二进制含 `.eh_frame` 但无 `.gcc_except_table`、无 `__gxx_personality_v0`、无 setjmp——"有异常处理但看不见 setjmp"是 2.2+ 的常态
- 定位 catch：从 `raiseExceptionEx` 调用点回看异常表/分支结构；异常对象含类型字段（Nim 异常是引用对象，首字段类型指针）

## 版本演进要点

- 1.x：默认 refc + NimStringDesc + setjmp 异常
- 2.0.x：orc 成为默认 GC，strs_v2（v2 字符串）随 orc 启用；`--gc:refc` 仍是老布局
- 2.2.x：Linux amd64 默认 goto 式异常（无 setjmp 符号）；`rawNewString` 取代 `newString1` 命名
- 跨版本复用的方法：入口链定位、字符串比较点追踪、异常路径还原；不复用的：具体符号名、结构偏移

## 使用注意

- 静态分析无需沙箱；Nim 产物跨平台（Linux ELF / Windows PE / macOS Mach-O），符号形态一致（C 后端）
- 与 [[analysis-contract]]（符号表传递）、[[re-cpp-abi]]（C 混合侧）配合使用
