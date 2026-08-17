# 4 个语言逆向技能 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增 4 个语言逆向原子技能（re-swift / re-zig / re-nim / re-fp-runtime）+ 挂载同步，技能总数 97 → 101。

**Architecture:** 纯技能文档扩展。4 个新技能目录（SKILL.md，按 docs/skill-template.md 原子技能规范，全部挂 re-binary-core）+ 挂载（re-binary-core 子技能/选择树、re-ios/re-macos 跨域）+ 计数同步（README / AGENTS / marketplace）。

**Tech Stack:** Markdown / YAML frontmatter / validate.mjs（npm test，现有）

## Global Constraints

- **红线 1 呈现中性**：禁用「最推荐」「强烈建议」等最高级强推措辞
- **红线 2 隐私脱敏**：内容不指向具体项目/公司/产品
- **不绑定具体工具**：方法为核心，工具为可替换示例；「工具准备」按模板给跨 OS 安装命令
- validate.mjs：frontmatter `name`=目录名、`description` 非空、`type: atomic` 必含「## 工具准备」、`[[链接]]` 必须解析
- 工作区已干净（无未提交文件）——所有目标文件（含 re-binary-core/SKILL.md）可正常修改提交；各任务 commit 只 `git add` 本任务列出的文件
- 当前分支 `main`；`npm test` 预期按任务标注递增（98 → 101）

---

### Task 1: 创建 re-swift 技能

**Files:**
- Create: `.claude/skills/re-swift/SKILL.md`

**Interfaces:**
- Consumes: 无（新目录）
- Produces: 技能目录 `re-swift`（供 Task 5 的 [[re-swift]] 链接解析；计数 97 → 98）

- [ ] **Step 1: 创建目录与 SKILL.md**

```bash
mkdir -p .claude/skills/re-swift
```

写入 `.claude/skills/re-swift/SKILL.md`：

````markdown
---
name: re-swift
type: atomic
description: >
  Swift 二进制逆向：mangling 解码、协议 witness table、闭包捕获、ObjC 互操作。
  触发词：Swift逆向、swiftc、witness table、swift demangle、闭包捕获、Swift 产物。
---

# Swift 逆向

## 何时使用 / 何时不用

- 用：Swift 产物（Mach-O/ELF 含 Swift mangling 特征 `$s` 前缀）
- 不用：纯 ObjC（走 [[re-ios]] / [[re-macos]] 的 ObjC 路径）

## 工具准备

### swift-demangle（Swift 工具链，mangling 解码）

- macOS: Xcode 自带（`xcrun swift-demangle`）；Linux: `apt install swiftlang` 或 Swift 官方工具链
- Windows: Swift 官方工具链
- 验证: `echo '$s3foo3bar' | swift-demangle`（输出可读形式）

### llvm-objdump（反汇编辅助）

- 安装与验证见 [[re-cpp-abi]] 工具准备

### Ghidra / IDA（反编译底座）

- 安装与验证见 [[re-ghidra]] / [[re-ida]]

## 操作步骤

按顺序执行，每步产物存档（路径 + sha256，见 [[re-triage]]）。

1. **产物识别**：
   ```sh
   strings sample | grep -E '^\$s' | head
   readelf -s sample 2>/dev/null | grep -E 'swift_' | head   # ELF；Mach-O 用 llvm-nm
   ```
   - `$s` mangling 前缀是 Swift 标志；swift_* 运行时导入（swift_retain / swift_release / swift_allocObject）确认
   - 纯 ObjC 无 `$s` → 转 [[re-ios]] / [[re-macos]]

2. **mangling 解码（批量）**：
   ```sh
   readelf -s sample | grep '^\$s' | awk '{print $8}' | swift-demangle | head -20
   ```
   - 解码内容：模块名/类型/函数签名/泛型参数展开
   - 解码结果写入符号表（供 [[re-ghidra]] / [[re-ida]] 重命名）

3. **协议 witness table**：
   - witness table 是协议方法的分发表（Swift 动态分派的核心）
   - 定位：搜索 `swift_witnessTable` 相关引用 / 协议 conformance 记录（`_swift_getWitnessTable` 调用点）
   - 还原：表内槽位 = 协议要求的方法实现地址 → 结合 [[re-cpp-abi]] 的 vtable 恢复思路反推协议一致性

4. **闭包捕获**：
   - 闭包是 context 对象：捕获变量布局（按捕获顺序 + 引用语义标记）
   - 定位：`swift_allocObject` 调用点 → context 分配 → 捕获字段初始化
   - 还原：context 结构体字段 → 捕获变量名/类型（与函数签名关联）

5. **ObjC 互操作**：
   - `@objc` 桥接：Swift 类经 ObjC runtime 可见（NSObject 子类、消息发送 objc_msgSend）
   - 分析：ObjC 方法列表（class-dump 思路）→ Swift 实现入口（桥接 thunk）
   - 混合产物：先走 ObjC 路径（[[re-ios]] / [[re-macos]]）再进 Swift 层

## 跨域联合

- [[re-binary-core]] 网关：本技能归属（选择树「Swift 产物」分支）
- [[re-ios]] / [[re-macos]]：生态衔接（ObjC 层、App 层分析）
- [[re-cpp-abi]]：vtable/witness table 恢复思路同源
- [[analysis-contract]]：符号表按数据契约传递

## 常见坑与陷阱

- **mangling 版本差异**：现象——新版本 Swift 产物解码失败；原因——mangling 方案演进；对策——升级 swift-demangle 匹配目标编译版本
- **泛型展开符号爆炸**：现象——解码输出大量 `$s...Gy` 泛型实例；原因——泛型特化；对策——按模块/类型聚类过滤
- **witness table 无符号名**：现象——分发表槽位全是裸地址；原因——协议 conformance 无命名符号；对策——结合协议方法调用点反推
- **闭包捕获含引用语义**：现象——context 字段是引用计数对象；原因——捕获变量含类实例；对策——按 swift_retain/release 调用点确认引用字段
- **纯 ObjC 误入**：现象——无 `$s` 却按 Swift 流程走；原因——产物实为 ObjC；对策——步骤 1 先确认（无 `$s` 即转）
````

- [ ] **Step 2: 结构校验**

Run: `npm test`
Expected: `OK: 98 skills validated`（[[链接]]：re-ios/re-macos/re-cpp-abi/re-ghidra/re-ida/re-triage/analysis-contract 均存在）

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/re-swift/SKILL.md
git commit -m "feat: re-swift 技能——mangling/witness table/闭包捕获/ObjC 互操作"
```

---

### Task 2: 创建 re-zig 技能

**Files:**
- Create: `.claude/skills/re-zig/SKILL.md`

**Interfaces:**
- Consumes: 无（新目录）
- Produces: 技能目录 `re-zig`（供 Task 5 的 [[re-zig]] 链接解析；计数 98 → 99）

- [ ] **Step 1: 创建目录与 SKILL.md**

```bash
mkdir -p .claude/skills/re-zig
```

写入 `.claude/skills/re-zig/SKILL.md`：

````markdown
---
name: re-zig
type: atomic
description: >
  Zig 编译产物逆向：产物识别、comptime 展开、panic/错误处理路径、C ABI 边界。
  触发词：Zig逆向、zig、comptime、zig 产物、panic。
---

# Zig 逆向

## 何时使用 / 何时不用

- 用：Zig 产物（无 C++ RTTI/异常表、panicking 函数特征）
- 不用：C/C++ 产物（走 [[re-cpp-abi]]）

## 工具准备

### readelf / llvm-nm（符号与节分析）

- 安装与验证见 [[re-cpp-abi]] 工具准备

### Ghidra / IDA（反编译底座）

- 安装与验证见 [[re-ghidra]] / [[re-ida]]

## 操作步骤

按顺序执行，每步产物存档（路径 + sha256，见 [[re-triage]]）。

1. **产物识别**：
   ```sh
   readelf -s sample | grep -iE 'panicking|std.debug|zig' | head
   readelf -S sample | grep -E 'eh_frame|gcc_except'   # 无 C++ 异常表特征
   ```
   - Zig 特征：panicking 函数（panic 处理链）、std 符号模式（std.debug.print 等）、**无 C++ RTTI/异常表**（对比 [[re-cpp-abi]] 的 RTTI/异常密集特征）
   - 与 C 混合编译：Zig 符号与 C 符号共存（见步骤 4 边界）

2. **导出符号与启动路径**：
   ```sh
   readelf -s sample | grep -E 'start|main|init' | head
   ```
   - 启动路径：`_start` → 运行时初始化 → `main`（Zig 的 main 入口）
   - comptime 展开产物：编译期计算已内联/展开——无对应源码结构，按行为分析

3. **panic/错误处理路径**：
   - panic 链：`@panic` → panic 函数（打印 + abort）——定位 panic 调用点可找输入校验/不变量
   - 错误联合（error union）：`!T` 类型布局（错误码 + 值），调用点检查 `orelse`/`catch` 分支
   - 分析：错误路径是逆向重点（校验逻辑、失败分支）

4. **C ABI 边界**：
   - `@extern` / `@cImport`：Zig 调用 C 库（导入表清晰可查）
   - 混合产物：按符号来源区分（Zig 符号 vs C 符号——链接器分组/节归属）
   - 边界处是逻辑入口（Zig 主体逻辑在边界内侧）

## 跨域联合

- [[re-binary-core]] 网关：本技能归属（选择树「Zig 产物」分支）
- [[re-cpp-abi]]：边界区分（无 RTTI/异常 → 非 C++）
- [[analysis-contract]]：符号表按数据契约传递

## 常见坑与陷阱

- **comptime 展开导致符号膨胀**：现象——产物符号与源码不对应；原因——编译期展开/内联；对策——按行为分析而非源码映射
- **panic 路径误导**：现象——大量 panic 处理代码被当主逻辑；原因——错误路径与正常路径交织；对策——先分离 panic 调用点（校验），再分析正常路径
- **错误联合布局版本差异**：现象——错误码读取错位；原因——error union 布局随版本变化；对策——按目标版本确认布局（错误码位宽/对齐）
- **与 C 混合编译难分界**：现象——Zig/C 符号混杂；原因——混合编译；对策——按符号来源与节归属分组，边界处进 Zig 逻辑
- **无异常表 ≠ 无保护**：现象——误判无错误处理；原因——Zig 错误处理走 error union 不走异常表；对策——查错误联合调用点（`catch`/`orelse` 分支）
````

- [ ] **Step 2: 结构校验**

Run: `npm test`
Expected: `OK: 99 skills validated`（[[链接]]：re-cpp-abi/re-ghidra/re-ida/re-triage/analysis-contract 均存在）

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/re-zig/SKILL.md
git commit -m "feat: re-zig 技能——产物识别/comptime/panic 与错误路径"
```

---

### Task 3: 创建 re-nim 技能

**Files:**
- Create: `.claude/skills/re-nim/SKILL.md`

**Interfaces:**
- Consumes: 无（新目录）
- Produces: 技能目录 `re-nim`（供 Task 5 的 [[re-nim]] 链接解析；计数 99 → 100）

- [ ] **Step 1: 创建目录与 SKILL.md**

```bash
mkdir -p .claude/skills/re-nim
```

写入 `.claude/skills/re-nim/SKILL.md`：

````markdown
---
name: re-nim
type: atomic
description: >
  Nim 编译产物逆向：运行时识别、NimString 结构、异常与 GC 路径。
  触发词：Nim逆向、nim、NimString、NimMain、nim 产物。
---

# Nim 逆向

## 何时使用 / 何时不用

- 用：Nim 产物（NimMain / GC 符号、NimString 结构特征）
- 不用：C 产物（走 [[re-binary-core]] 通用）

## 工具准备

### readelf / llvm-nm（符号分析）

- 安装与验证见 [[re-cpp-abi]] 工具准备

### Ghidra / IDA（反编译底座）

- 安装与验证见 [[re-ghidra]] / [[re-ida]]

## 操作步骤

按顺序执行，每步产物存档（路径 + sha256，见 [[re-triage]]）。

1. **产物识别**：
   ```sh
   readelf -s sample | grep -iE 'NimMain|nimGC|NimString' | head
   ```
   - Nim 特征：`NimMain`（入口）、GC 符号（nimGC_*）、`NimString` 结构
   - 入口：`NimMain` 调用链（运行时初始化 → 模块初始化 → main）

2. **字符串与序列结构**：
   - NimStringV2 布局：`len`（int）+ `reserved`（int）+ `data`（char* 或内联）——按版本确认字段序
   - 定位：`newString` 分配调用点 → 结构布局 → 字符串操作函数（`eqStrings` 等）
   - 分析：字符串比较点是关键逻辑（校验/协议/命令分发）

3. **异常与 raises 路径**：
   - Nim 异常：`raise` → 异常对象分配 → 异常表（Nim 有异常表，与 C++ 不同）
   - 定位：异常处理入口（`nimSetjmp` / 异常表）→ catch 分支
   - 分析：异常路径揭示输入校验与失败处理

4. **GC 与引用计数**：
   - refc（旧默认）：引用计数——`nimIncRef` / `nimDecRef` 调用点
   - orc（新默认）：循环收集——`nimGC_*` 分配/收集
   - 分析：GC 调用点帮助识别对象生命周期与所有权（配合字符串结构）

## 跨域联合

- [[re-binary-core]] 网关：本技能归属（选择树「Nim 产物」分支）
- [[analysis-contract]]：符号表按数据契约传递

## 常见坑与陷阱

- **GC 版本差异（refc/orc）**：现象——找不到引用计数调用；原因——orc 无显式 inc/dec；对策——按 Nim 版本确认 GC 模式再分析
- **NimString 布局随版本变化**：现象——data 字段偏移错；原因——版本演进；对策——按目标版本确认（字段序 len/reserved/data）
- **导出符号被 strip**：现象——无 NimMain/NimString 符号；原因——strip 处理；对策——按特征字符串/运行时行为识别（[[re-triage]] 初勘兜底）
- **C 混合编译**：现象——Nim/C 符号混杂；原因——`{.compile:}` 混合；对策——按符号来源分组，Nim 侧进本技能路径
- **字符串比较点误判**：现象——关键校验被当普通比较；原因——eqStrings 包装；对策——追踪 Nim 字符串函数调用点定位比较逻辑
````

- [ ] **Step 2: 结构校验**

Run: `npm test`
Expected: `OK: 100 skills validated`（[[链接]]：re-cpp-abi/re-ghidra/re-ida/re-triage/analysis-contract 均存在）

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/re-nim/SKILL.md
git commit -m "feat: re-nim 技能——运行时识别/NimString/异常与 GC 路径"
```

---

### Task 4: 创建 re-fp-runtime 技能

**Files:**
- Create: `.claude/skills/re-fp-runtime/SKILL.md`

**Interfaces:**
- Consumes: 无（新目录）
- Produces: 技能目录 `re-fp-runtime`（供 Task 5 的 [[re-fp-runtime]] 链接解析；计数 100 → 101）

- [ ] **Step 1: 创建目录与 SKILL.md**

```bash
mkdir -p .claude/skills/re-fp-runtime
```

写入 `.claude/skills/re-fp-runtime/SKILL.md`：

````markdown
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
````

- [ ] **Step 2: 结构校验**

Run: `npm test`
Expected: `OK: 101 skills validated`（[[链接]]：re-cpp-abi/re-go/re-rust/re-ghidra/re-ida/re-triage/analysis-contract 均存在）

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/re-fp-runtime/SKILL.md
git commit -m "feat: re-fp-runtime 技能——函数式运行时逆向（GHC/OCaml 闭包与数据流）"
```

---

### Task 5: 挂载与计数同步

**Files:**
- Modify: `.claude/skills/re-binary-core/SKILL.md`（子技能列表加 4 个 + 选择树加 4 分支）
- Modify: `.claude/skills/re-ios/SKILL.md`（跨域联合加 [[re-swift]]）
- Modify: `.claude/skills/re-macos/SKILL.md`（跨域联合加 [[re-swift]]）
- Modify: `README.md`（计数 97→101、84→88、re-binary-core 导航行加 4 个）
- Modify: `AGENTS.md`（97→101、84→88）
- Modify: `.claude-plugin/marketplace.json`（97→101）

**Interfaces:**
- Consumes: Task 1-4 的 4 个技能目录（链接可解析）
- Produces: 4 技能全库可达；计数 101 = 1 + 12 + 88

- [ ] **Step 1: re-binary-core 挂载（2 处）**

`.claude/skills/re-binary-core/SKILL.md` 子技能列表（现含 `、[[re-cpp-abi]]` 的 description 行）末尾追加 `、[[re-swift]]、[[re-zig]]、[[re-nim]]、[[re-fp-runtime]]`（在 `[[re-cpp-abi]]` 之后）。

选择树（现含「**目标是 C++（RTTI/异常表密集）** → [[re-cpp-abi]]」行）在其后插入 4 行：

```markdown
- **目标是 Swift 产物（$s mangling 特征）** → [[re-swift]]（mangling/witness table/闭包捕获）
- **目标是 Zig 产物（无 RTTI/异常表、panicking 特征）** → [[re-zig]]（comptime/错误路径）
- **目标是 Nim 产物（NimMain/NimString 特征）** → [[re-nim]]（运行时/字符串结构）
- **目标是 Haskell/OCaml 产物（GHC RTS/OCaml block 特征）** → [[re-fp-runtime]]（闭包/数据流）
```

- [ ] **Step 2: re-ios / re-macos 跨域引用（2 处）**

`.claude/skills/re-ios/SKILL.md` 跨域联合节末尾追加：

```markdown
- Swift 层分析（mangling/witness table）→ [[re-swift]]
```

`.claude/skills/re-macos/SKILL.md` 跨域联合节末尾追加：

```markdown
- Swift 层分析（mangling/witness table）→ [[re-swift]]
```

- [ ] **Step 3: 计数同步（3 文件）**

`README.md`：
- `## 技能导航（97）` → `## 技能导航（101）`
- `入口 → 12 大类网关 → 84 原子技能` → `入口 → 12 大类网关 → 88 原子技能`
- 第 5 行 `97 个逆向工程技能` → `101 个逆向工程技能`
- re-binary-core 导航行末尾加 `、re-swift、re-zig、re-nim、re-fp-runtime`（在 `re-cpp-abi` 之后）

`AGENTS.md`：
- `（97 个技能）` → `（101 个技能）`
- `原子技能（84）` → `原子技能（88）`

`.claude-plugin/marketplace.json`：
- `97 个技能` → `101 个技能`

- [ ] **Step 4: 校验**

Run: `npm test`
Expected: `OK: 101 skills validated`

Run: `grep -c "re-swift\|re-zig\|re-nim\|re-fp-runtime" README.md`
Expected: ≥ 4

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/re-binary-core/SKILL.md .claude/skills/re-ios/SKILL.md .claude/skills/re-macos/SKILL.md README.md AGENTS.md .claude-plugin/marketplace.json
git commit -m "增强: 4 语言技能挂载与计数同步 101（re-binary-core 选择树/re-ios-macos 跨域/README-AGENTS-marketplace）"
```
