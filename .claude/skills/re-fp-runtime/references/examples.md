# 函数式运行时最小解析示例

示例以本机 GHC 9.14.1（ghcup）与 OCaml 4.14.2（opam）编译的真实产物为标本，readelf/nm/xxd 输出与字节验证可逐字段对照。布局规则见 [[layout]]。

## 0. 标本构建

```sh
# hello.hs
main :: IO ()
main = putStrLn "hi from ghc"
ghc -O1 hello.hs -o hello_ghc

# hello.ml
let add x y = x + y
let () = print_endline (string_of_int (add 40 2))
ocamlopt -o hello_ocaml hello.ml     # 原生
ocamlc   -o hello_bc   hello.ml      # 字节码
```

## 1. GHC 符号对照（readelf/nm 实测）

```
$ nm hello_ghc | grep -E 'Main_main|newCAF|hs_init'
0000000000407c12 T main                     ← C RTS 入口
00000000004da4f0 D Main_main_closure        ← 顶层 main 的 closure（CAF，数据段）
0000000000407bc8 T Main_main_info           ← entry code
00000000004da500 D Main_main4_closure
0000000000407be8 T Main_main4_info
0000000000494190 T newCAF                   ← CAF 分配（RTS）
000000000047f780 T hs_init_ghc              ← RTS 初始化

$ nm hello_ghc | grep -c stg_              # RTS STG 机械符号（实测 334 个）
334
$ nm hello_ghc | grep -E 'stg_upd_frame_info|stg_enter_info'
000000000049bba0 T stg_upd_frame_info      ← 更新帧（thunk 求值写回）
00000000004980e0 T stg_enter_info          ← 进入求值
```

对照要点：`模块_名字_closure`（数据）+ `模块_名字_info`（代码）成对；`newCAF`/`hs_init_ghc` 是 RTS 锚点；`stg_*` 机械符号数量级（数百个）是 GHC 特征。

## 2. GHC closure 字节验证（首字段 = info 指针）

```python
import struct

# hello_ghc 非 PIE 时 vaddr == file offset；PIE 需先按 PT_LOAD 换算（见 re-format-elf 思路）
d = open('hello_ghc', 'rb').read()
# 用 readelf 的节映射换算 0x4da4f0 的文件偏移（此处示意：已换算）
off = 0x4da4f0                       # Main_main_closure vaddr
v = struct.unpack_from('<Q', d, off)[0]
print(hex(v))                        # 0x407bc8 == Main_main_info 地址
# 前 16 字节: info 指针 + 8 字节字段（CAF 载荷）
print(d[off:off+16].hex())
# c87b400000000000 0000000000000000
# └─ info 指针(0x407bc8)┘ └─ 载荷区(CAF 空载荷)┘

# 反汇编 entry code（0x407be8 = Main_main4_info）：加载 closure 跳转 runMainIO
#   leaq 0xd28da(%rip), %r14           ; 装载 Main_main1_closure（thunk）
#   jmp  GHCziInternalziTopHandler_runMainIO1_info   ; 求值链（z 编码: GHC.Internal）
```

对照要点：closure 头部 8 字节 = info 指针（分派点）；entry code 从 info 指针处开始；`GHCziInternal` = `GHC.Internal`（z 编码）。

## 3. OCaml 原生符号对照（nm 实测）

```
$ nm hello_ocaml | grep -E 'camlHello__|caml_apply|caml_start|caml_alloc'
0000000000022a00 T caml_apply3             ← 闭包调用分派（3 参数）
0000000000022a50 T caml_apply2             ← 闭包调用分派（2 参数）
0000000000022ac0 T camlHello__add_267      ← 模块级函数：caml<模块>__<名>_<id>
00000000000239d0 T camlCamlinternalAtomic__entry   ← 各模块 entry
0000000000025ec0 T caml_startup_common     ← 入口链：caml_main → caml_startup_common
0000000000026150 T caml_startup            ← 等价 C API 入口（caml_startup(argv)）
0000000000026180 T caml_main               ← 入口链：main → caml_main（4.14.2 实测）
000000000004a990 T caml_start_program      ← native 也有此符号！不作字节码判据
000000000004df68 D camlHello               ← 模块全局数据

$ nm hello_ocaml | grep -wE 'main|_start'
00000000000261f0 T main                    ← C 入口（call caml_main）
0000000000022540 T _start
```

对照要点：`caml_applyN` 是闭包部分应用分派（参数个数驱动）；`caml_main` 存在于 4.14.2（0x26180，反汇编见 `main → call caml_main` → `caml_startup_common`），官方 runtime/main.c 各版本均定义 `caml_main(argv)`；模块 entry 符号 `caml<模块>__entry`。

## 4. OCaml 字节码产物判别（file + xxd 实测）

```
$ file hello_bc
hello_bc: a /home/user/.opam/default/bin/ocamlrun script executable (binary data)
                                   ↑ file 直接识别脚本头（示例路径为脱敏占位）

$ xxd -l 64 hello_bc
00000000: 2321 2f68 6f6d 652f 7573 6572 2f2e 6f70  #!/home/user/.op
00000010: 616d 2f64 6566 6175 6c74 2f62 696e 2f6f  am/default/bin/o
00000020: 6361 6d6c 7275 6e0a 5400 0000 df02 0000  camlrun.T.......
00000030: 0000 0000 5700 0000 0100 0f00 1000 0000  ....W...........
         └ 脚本头 "#!...ocamlrun\n"（脱敏占位路径）┘ └魔数 T┘ └代码区（分节表在尾部 TOC）┘

$ ocamlobjinfo hello_bc | head -8        # 结构视图（导入单位/CRC）
File hello_bc
Imported units:
        -------------------------------- Stdlib__Weak
        -------------------------------- Stdlib__Unit
        ...
```

对照要点：字节码 exe 头 = `#!<ocamlrun 路径>\n` + 魔数 `T` + 代码区；分节（CODE/PRIM/DATA/SYMB/CRCS 等）与长度表在文件尾部 TOC（大端，以 `Caml1999X031` 收尾）；`ocamlobjinfo` 可直接解析字节码可执行文件。示例路径为脱敏占位（本机实路径含用户名）。

## 5. OCaml 对象文件（.cmx）结构（ocamlobjinfo 实测）

```
$ ocamlobjinfo hello.cmx
File hello.cmx
Name: Hello
CRC of implementation: 63b3383284e2773bc5d450ad0fa510d5
Globals defined: Hello
Interfaces imported: Stdlib / CamlinternalFormatBasics ...
Clambda approximation:
  (0: function camlHello__add_267 arity 2 (closed) (inline) -> ...)
```

对照要点：`.cmx` 携带 CLambda 近似（函数名/元数/是否内联）——元数信息可直接用于调用点参数布局判断。

## 6. tagged int 与 block 头速查（反汇编判读用）

```
整数 42        → 内存值 0x55（42<<1|1），最低位=1
指向 block 的指针 → 最低位=0（8 字节对齐）
block 头(3 字段,tag 0) → (3<<10)|(0<<8)|0 = 0xC00
```

## 实现教训（内化）

- 一切从符号锚点出发：GHC `模块_名_closure/info` 对、OCaml `caml<模块>__<名>_<id>`
- closure 首字段 = info 指针是分派核心；模式匹配/闭包调用都经它跳转
- 字节码判别用 `file`/头字节，`caml_start_program` 不作判据（native 也有）

## 使用注意

- 本机 9.14.1 / 4.14.2 实测；用户产物以自身版本为准（入口符号/魔数随版本变，见 [[layout]] 版本差异）
- 与 [[analysis-contract]]（数据流图传递）、[[re-triage]]（初勘兜底）配合使用
