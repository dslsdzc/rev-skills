---
name: re-fp-runtime
type: atomic
description: >
  函数式语言运行时逆向（Haskell/OCaml）：闭包/堆对象模型、调用约定、数据流优先策略。
  触发词：Haskell逆向、OCaml逆向、GHC RTS、thunk、STG、OCaml runtime、闭包、函数式产物。
---

# 函数式运行时逆向（Haskell / OCaml）

## 何时使用 / 何时不用

- 用：Haskell/OCaml 产物（GHC RTS 符号、OCaml block 头特征），需要还原闭包/堆对象、求值顺序、模式匹配分支
- 用：OCaml 原生/字节码产物判别与字节码分析（ocamlrun 脚本头特征）
- 不用：命令式语言产物（各归各技能：C++ → [[re-cpp-abi]]、Go → [[re-go]]、Rust → [[re-rust]]）
- 不用：只需函数逻辑且控制流完整（函数式产物控制流打散，直接反编译收益低，见步骤 4）

## 工具准备

### readelf / llvm-nm（符号分析）

- 安装与验证见 [[re-cpp-abi]] 工具准备

### ghc 工具链（Haskell 侧，可选）

- Linux/macOS: GHC 安装包（`apt install ghc` / `brew install ghc` / ghcup）；Windows: ghcup（`winget install ghcup` 或官网安装器）；验证: `ghc --version`
- 用途: 同版本编译对照产物，验证 closure/info table 形态（GHC 版本差异大）

### ocamlobjinfo / ocamlopt（OCaml 侧，可选）

- Linux/macOS: OCaml 工具链（`apt install ocaml` / `brew install ocaml`）；Windows: opam（`winget install OCaml.opam`）或官网安装器；验证: `ocamlobjinfo` 处理任意 .cmx 输出 CRC 与导入表
- 用途: 字节码产物/对象文件结构分析（ocamlobjinfo 可读 .cmo/.cmx/字节码可执行文件）

### Ghidra / IDA（反编译底座）

- 安装与验证见 [[re-ghidra]] / [[re-ida]]

### file / xxd / Python struct（字节级核对）

- 系统自带（`file`/`xxd`）；Python 3 自带 `struct`
- 用途: 字节码产物判别（ocamlrun 脚本头）、closure 首字段/block 头字节验证（示例见 [[examples]]）

## 操作步骤

按顺序执行；逆向着重**数据流**而非控制流（函数式产物控制流被打散，见坑 4）。每步产物存档（路径 + sha256，见 [[re-triage]]）。

1. **运行时识别**：
   ```sh
   readelf -s sample | grep -iE 'ghc|stg_|RTS|HsMain|_closure|_info' | head   # GHC 特征
   readelf -s sample | grep -iE 'caml_' | head                                # OCaml 特征
   file sample                                                              # 字节码产物判别（脚本头）
   ```
   - GHC：`main`（C RTS 入口）+ RTS 运行时符号（`stg_*`/`hs_*`）+ 业务符号 `Main_main_closure`/`Main_main_info`（`模块_名字_closure/info` 形态）
   - OCaml 原生：`main` → `caml_main` → `caml_startup_common` → `caml_start_program` → `caml<模块>__entry`；`caml_startup`/`caml_startup_pooled` 是供 C 嵌入调用的等价入口（签名同为 void (char_os **argv)，区别在 pooling 标志与异常行为），勿误当主链；`caml_*` 运行时符号（caml_alloc/caml_apply2/3 等）
   - **字节码 vs 原生**：`caml_start_program` 仅存在于 native 运行库（4.14.2 libasmrun.a 实测），是 native 特征；字节码判据用 `caml_interprete`（仅 libcamlrun.a 有）；字节码产物判别用 `file`（`ocamlrun script executable`）/`xxd` 头（`#!...ocamlrun\n` 脚本头 + `T`/`C` 魔数 + 分节）
   - 入口链各版本一致：runtime/main.c 定义 `main` 并调用 `caml_main(argv)`（`caml_main` 定义于 startup_byt.c/startup_nat.c；原生链 `main → caml_main → caml_startup_common → caml_start_program`，4.14.2 实测地址见 [[examples]]）；字节码运行库入口为 `caml_main → caml_startup_aux → caml_interprete`
   - 判别速查：GHC = `stg_*` 机械符号群 + `模块_名_closure/info` 对；OCaml 原生 = `caml_*` 群 + `caml<模块>__<名>_<id>`；OCaml 字节码 = `#!ocamlrun` 脚本头

2. **闭包与堆对象**：
   - GHC：thunk（未求值闭包）与已求值值的堆对象布局——closure 首字段即 info table 指针（实测字节验证见 [[examples]]）；CAF 以 thunk 形式静态分配，首次引用才求值（惰性）；`Main_main_closure` 是 CAF，其 info 指向 thunk 求值代码
   - GHC 值形态：未求值（thunk，info 指向求值代码）vs 已求值 WHNF（info 指向构造器头/函数头）——同地址空间的两种状态，求值后 closure 内容被覆写
   - OCaml：block 头（tag + 大小，64 位下 header = (size<<10)|(color<<8)|tag）；tagged int 判定用值的最低位（bit 0，奇数=整数，偶数=指针/block）
   - 分析：字段与构造器是主要线索（数据流优先）

3. **调用约定**：
   - GHC：参数经栈传递；返回值在寄存器 R1-R3（盒值在 R1）；entry 代码以 info table 为枢纽（`_info` 符号 = entry code）
   - OCaml：参数经寄存器（前 N 个）传递，闭包调用经 `caml_applyN`；原生代码调用闭包 = 寄存器装载 + `caml_apply2/3` 或直接跳 entry
   - 分析：先识别运行时包装（`caml_apply` / stg 入口）再进用户逻辑；尾调用优化使递归变跳转（无增长栈帧），按循环读
   - GHC 与 OCaml 共点：函数不是"被 call"，而是"跳到 entry"——反编译里的 `jmp` 目标地址即函数入口，别按 call/ret 配对思维读

4. **分析策略（数据流优先）**：
   - 控制流打散：惰性求值导致求值顺序不可预测——静态控制流分析价值低
   - 数据流线索：闭包字段初始化点（构造器参数）、模式匹配分支（构造器标签分发）、字符串/常量引用
   - 产出：数据流图（构造器 → 字段 → 使用点）替代控制流图（与 [[analysis-contract]] 数据契约衔接）
   - 模式匹配还原：分支按构造器 tag 分发（OCaml）或 info 表指针比较（GHC）——tag/指针值 → 构造器序号；还原出构造器集合即还原出数据类型
   - 产出格式（供分析报告与下一环节消费）：
     ```
     构造器 C1 (tag 0, 2 字段) ← 分配点 A (caml_alloc2 / info 表)
       字段0 ← 函数参数/常量（数据来源）
       字段1 ← 字符串池引用
     使用点: tag 比较 → 分支 B（业务逻辑）
     ```

5. **字节码产物（OCaml 特有）**：
   ```sh
   head -c 64 sample | xxd          # #!...ocamlrun 脚本头 + 魔数 T/C + 长度
   ocamlobjinfo sample              # 直接解析字节码可执行文件（导入单位/CRC）
   ```
   - 字节码 exe = 脚本头 + 魔数 `T` + 代码区 + 各分节数据；分节名（CODE/PRIM/DATA/SYMB/CRCS 等 4 字符）与大端长度表在文件尾部 TOC，文件以 `Caml1999X031` 收尾（结构见 [[layout]]，字节样例见 [[examples]]）
   - 字节码反汇编不是常规反编译（指令集为 OCaml bytecode 自定），分析入口用 ocamlobjinfo 的结构视图

## 跨域联合

- [[re-binary-core]] 网关：本技能归属（选择树「Haskell/OCaml 产物」分支）
- [[analysis-contract]]：数据流图按数据契约传递
- [[re-cpp-abi]]：vtable/info table 对照思路（表指针分派同构）

## 常见坑与陷阱

- **RTS 版本差异**：现象——closure 布局解读失败；原因——GHC/OCaml 版本演进；对策——按目标版本确认布局（本技能字段表基于 9.14/4.14 实测，见 [[layout]]）
- **thunk 惰性求值误导**：现象——未求值闭包被当已求值数据；原因——惰性求值；对策——区分 thunk 头（info 指向求值代码）与已求值值（info 指向 WHNF 头）；CAF 首引用前都是 thunk
- **OCaml 字节码非 native**：现象——反编译全是运行时包装；原因——字节码产物；对策——识别 ocamlrun 脚本头/字节码段特征后按字节码结构分析（非常规反编译；`caml_start_program` 仅 native 运行库有，是 native 特征；字节码判据用 `caml_interprete`）
- **控制流打散导致静态分析失效**：现象——函数体无连续逻辑；原因——函数式编译产物；对策——转数据流分析（步骤 4），不硬追控制流
- **tagged int 误读**：现象——整数被当指针/指针被当整数；原因——OCaml 值标记位；对策——按最低位区分（1=整数，0=指针），访问前先解标记（int >> 1 取真值）
- **GHC 模块名带 z 编码**：现象——符号 `GHCziInternalziTopHandler_runMainIO1_info` 难读；原因——`z`+小写转义特殊字符（GHC mangling：`zi`=`.` `zu`=下划线 `zz`=z `zc`=: `zh`=# 等）；对策——按转义规则手工还原模块名（`GHCziInternal` → `GHC.Internal`），还原后与源码模块结构对应
- **info table 与 entry code 是同一指针的两个视图**：现象——info 指针处反汇编出的是字段表数据而非代码；原因——info table 指针指向 entry code，表字段在 entry code 之前；对策——反汇编从 info 指针处开始（即 entry），字段表按负偏移读
- **尾调用优化把递归变跳转**：现象——按 call 树分析递归逻辑断裂；原因——函数式编译器的尾调用优化（TCO）；对策——`jmp` 回函数自身地址 = 递归，按循环语义读，别找增长栈帧
- **惰性求值顺序不可预测**：现象——按源码顺序单步动态分析对不上；原因——thunk 首次引用才求值，求值触发点在"需要值的地方"而非"产生值的地方"；对策——动态分析聚焦数据依赖（哪个闭包被强制求值），静态聚焦字段初始化点，别假设执行顺序
- **跨运行时误判（GHC 机械符号当业务代码）**：现象——`stg_ap_*`/`stg_upd_frame_info` 等被当成业务逻辑分析；原因——STG 机械符号是求值机制；对策——先按 `stg_`/`hs_` 前缀把 RTS 机械符号排除，业务代码集中在 `模块_名_info` 与调用 `caml_applyN`/`caml_alloc*` 的片段
