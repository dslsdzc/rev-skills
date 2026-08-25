# 函数式运行时布局：GHC 堆对象 / OCaml 值表示 / 调用约定

Haskell（GHC）与 OCaml 的产物共性：堆对象头部携带"分派指针"（GHC info table / OCaml block 头），函数调用经闭包间接跳转。本文件字段基于 GHC 9.14.1 与 OCaml 4.14.2 实测，版本差异单独标注。

## GHC 堆对象（closure）

### closure 布局（实测）

```
closure:
  +0  info table 指针（StgInfoTable 的 entry code 地址）← 分派点
  +8  字段 0（构造器参数/捕获变量/求值结果）
  +16 字段 1 ...
```

- **closure 首字段 = info 指针**（实测：`Main_main_closure` 内容 = `Main_main_info` 地址，字节验证见 [[examples]]）
- 分派：调用/求值 = 读 info 指针 → 跳到 entry code；entry code 末尾通常 `jmp` 到后续处理（更新帧/返回）

### info table 与 entry code

- `_info` 符号 = entry code 地址；info table 字段（layout/type/srt）在 entry code 之前的负偏移区
- 符号形态：`<模块>_<名字>_closure`（数据）+ `<模块>_<名字>_info`（代码）；模块名 z 编码（`zi`=`.` 等）
- 求值链：thunk 的 entry code 求值后写回 closure 并跳更新帧（`stg_upd_frame_info` 相关）——`stg_upd_frame_info`/`stg_enter_info` 出现处 = 惰性求值机制

### CAF（常量应用形式）

- 顶层常量/无参函数以 CAF 形式静态分配（.data 区），首次引用才求值（thunk）
- 定位：`newCAF` 调用点（RTS 符号）；`Main_main_closure` 即典型 CAF

### GHC 调用约定

| 项 | 规则 |
|---|---|
| 参数 | 经栈传递（STG 栈，非硬件栈） |
| 返回值 | R1-R3 寄存器（盒值在 R1） |
| 分派 | 经 info 指针（闭包调用 = 读 info → 跳 entry） |
| 求值触发 | thunk entry → 求值 → 更新 closure（WHNF） |

## OCaml 值表示

### tagged int 与 block（64 位，原生代码）

| 值 | 表示 | 判定 |
|---|---|---|
| 整数 | `value = 真值 << 1 \| 1` | 最低位=1（奇数） |
| block 指针 | 指向 header 的 8 字节对齐指针 | 最低位=0（偶数） |
| 未装箱 double | 特殊 tag（250）block 或寄存器 | — |

### block 头（header，64 位）

```
header = (size << 10) | (color << 8) | tag
         size: 字段数（字）   color: GC 三色   tag: 构造器标签
```

- tag 语义：0-246 构造器标签（模式匹配按 tag 分发）；247-255 特殊（250=double，248=string 等）
- 双字段加速：`caml_alloc2/alloc3` 一次分配多字段 block（`caml_alloc` 单字段通用）

### 闭包（函数值）

- 闭包 = 带 tag 的 block，字段 = 环境（捕获变量）+ 代码指针（首字段）
- 调用：装载参数到寄存器 → `caml_apply2`/`caml_apply3`（按参数个数分派）或直接跳闭包代码
- 运行时函数符号：`caml_apply1..N`（部分应用）、`caml_alloc*`（分配）、`caml_main`/`caml_startup_common`/`caml_startup`/`caml_start_program`（入口链）

### OCaml 入口链（原生，实测 4.14.2）

```
main (C 入口，runtime/main.c)
  └─ caml_main(argv)                ← runtime/main.c 定义 main 并调用 caml_main（caml_main 定义于 startup_byt.c/startup_nat.c）
       └─ caml_startup_common
            └─ caml_start_program   ← 仅 native 运行库（4.14.2 libasmrun.a 实测）；字节码入口 caml_main → caml_startup_aux → caml_interprete（无此符号）
                 └─ caml<模块>__entry（各模块初始化，含全局数据分配）
                      └─ 业务入口（camlHello__entry）
```

- 主链是 `caml_main`；`caml_startup`/`caml_startup_pooled` 是供 C 嵌入方调用的等价入口（签名同为 void (char_os **argv)，区别在 pooling 标志与异常行为），勿混淆。4.14.2 实测地址：caml_main=0x26180、caml_startup_common=0x25ec0、caml_startup=0x26150、caml_start_program=0x4a990（反汇编见 [[examples]]）
- 模块级函数命名：`caml<模块>__<名字>_<数字id>`（如 `camlHello__add_267`）

### OCaml 字节码产物结构

```
可执行文件:
  #!<ocamlrun 路径>\n    脚本头（file 报 "ocamlrun script executable"）
  T                      前导魔数（4.x 实测）
  代码区（无长度字段，长度见尾部 TOC）
  各分节数据 + 尾部 TOC: 分节名(4 字符)+大端长度逐条列出，末为分节数与 "Caml1999X031"
  分节: CODE 代码 / PRIM 原语表 / DATA 数据 / SYMB 全局符号 / CRCS CRC 串 / DLLS 动态库
```

- 判别：`file sample` 输出 `ocamlrun script executable`；`head -c 32 | xxd` 见 `#!` 头
- 结构分析：`ocamlobjinfo sample`（.cmo/.cmx/字节码 exe 均可，输出导入单位/CRC/CLambda 近似）

## 版本差异要点

| 项 | 老版本 | 实测版本（本文档） |
|---|---|---|
| OCaml 入口 | `main → caml_main → caml_startup_common → caml_start_program`（各版本一致；runtime/main.c 定义 `main` 并调用 `caml_main`，`caml_main` 定义于 startup_byt.c/startup_nat.c） | 同左（4.14.2 实测，地址见 [[examples]]） |
| 字节码魔数 | 魔法串在文件尾 TOC（`Caml1999X`+版本号，exec.h 定义） | 前导 `T` + 尾部 `Caml1999X031`（4.14 实测） |
| GHC 版本 | RTS 符号命名随版本微调 | 9.14.1（stg_ap_*/stg_upd_frame_info 稳定） |

- 跨版本稳定的锚点：OCaml tagged int 最低位规则、block 头 tag 低字节、GHC closure 首字段 info 指针

## 使用注意

- 静态分析无需沙箱；跨平台（Linux/Windows/macOS）产物结构一致（C 运行时移植）
- 与 [[analysis-contract]]（数据流图传递）、[[re-cpp-abi]]（表指针分派对照）配合使用
