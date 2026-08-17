---
name: re-fp-runtime
type: atomic
description: >
  函数式语言运行时逆向（Haskell/OCaml）：闭包/堆对象模型、调用约定、数据流优先策略。
  触发词：Haskell逆向、OCaml逆向、GHC RTS、thunk、STG、OCaml runtime、闭包、函数式产物。
---

# 函数式运行时逆向（Haskell / OCaml）

## 何时使用 / 何时不用

- 用：Haskell/OCaml 产物（GHC RTS 符号、OCaml block 头特征）
- 不用：命令式语言产物（各归各技能：C++ → [[re-cpp-abi]]、Go → [[re-go]]、Rust → [[re-rust]]）

## 工具准备

### readelf / llvm-nm（符号分析）

- 安装与验证见 [[re-cpp-abi]] 工具准备

### ghc 工具链（Haskell 侧，可选）

- Linux/macOS: GHC 安装包（`apt install ghc` / `brew install ghc` / ghcup）；验证: `ghc --version`

### ocamlobjinfo（OCaml 侧，可选）

- Linux/macOS: OCaml 工具链（`apt install ocaml` / `brew install ocaml`）；验证: `ocamlobjinfo -version`

### Ghidra / IDA（反编译底座）

- 安装与验证见 [[re-ghidra]] / [[re-ida]]

## 操作步骤

按顺序执行；逆向着重**数据流**而非控制流（函数式产物控制流被打散，见坑 4）。每步产物存档（路径 + sha256，见 [[re-triage]]）。

1. **运行时识别**：
   ```sh
   readelf -s sample | grep -iE 'ghc|stg_|RTS|HsMain' | head   # GHC 特征
   readelf -s sample | grep -iE 'caml_|camlMain' | head         # OCaml 特征
   ```
   - GHC：`HsMain` 入口、`stg_*` 运行时符号、`RTS` 段
   - OCaml：`camlMain` 入口、`caml_*` 运行时符号
   - **字节码 vs 原生**：OCaml 字节码产物（非 native）特征（`caml_start_program`）→ 字节码可反汇编还原；native 产物走常规反编译

2. **闭包与堆对象**：
   - GHC：thunk（未求值闭包）与已求值值的堆对象布局——closure header（info table 指针）+ 字段；CAF（顶层常量）在启动时初始化
   - OCaml：block 头（tag + 大小，低 2 位 = 标记）；tagged int（奇数值 = 直接整数，偶数值 = 指针）
   - 分析：字段与构造器是主要线索（数据流优先）

3. **调用约定**：
   - GHC：函数参数经栈传递（STG 机），返回在栈顶——与常规寄存器约定不同
   - OCaml：参数经寄存器（前 N 个）传递，闭包调用经 `caml_applyN`
   - 分析：先识别运行时包装（`caml_apply` / stg 入口）再进用户逻辑

4. **分析策略（数据流优先）**：
   - 控制流打散：惰性求值导致求值顺序不可预测——静态控制流分析价值低
   - 数据流线索：闭包字段初始化点（构造器参数）、模式匹配分支（构造器标签分发）、字符串/常量引用
   - 产出：数据流图（构造器 → 字段 → 使用点）替代控制流图（与 [[analysis-contract]] 数据契约衔接）

## 跨域联合

- [[re-binary-core]] 网关：本技能归属（选择树「Haskell/OCaml 产物」分支）
- [[analysis-contract]]：数据流图按数据契约传递

## 常见坑与陷阱

- **RTS 版本差异**：现象——closure 布局解读失败；原因——GHC/OCaml 版本演进；对策——按目标版本确认布局
- **thunk 惰性求值误导**：现象——未求值闭包被当已求值数据；原因——惰性求值；对策——区分 thunk 头（info table 指向求值代码）与已求值值
- **OCaml 字节码非 native**：现象——反编译全是运行时包装；原因——字节码产物；对策——识别 `caml_start_program` 后按字节码反汇编（非常规反编译）
- **控制流打散导致静态分析失效**：现象——函数体无连续逻辑；原因——函数式编译产物；对策——转数据流分析（步骤 4），不硬追控制流
- **tagged int 误读**：现象——整数被当指针/指针被当整数；原因——OCaml 值标记位；对策——按低 2 位区分（1=整数，0=指针），访问前先解标记
