---
name: re-angr
description: angr 符号执行：符号化输入、求解。触发词：angr、符号执行、自动解题、constraint
---

# angr 符号执行（符号化输入 / 自动求解）

## 何时使用 / 何时不用

- 用：CTF 逆向题——输入在长循环 / 深比较链里逐字节校验（校验通过地址已知或可定位），人工逆推繁琐易错
- 用：已知"输入必须到达某地址 / 避开某地址"，想把路径条件交给求解器（find / avoid 模式）
- 用：输入来源复杂（argv / 文件 / 标准输入），需要按通道符号化后求解
- 不用：简单 XOR / 明文比较（一屏伪代码内）——人工更快（[[re-binary-core]]）
- 不用：校验含不可符号化内容（环境相关值、随机数、未符号化输入）——会无解或误解（见坑 3）
- 不用：需要精确约束集合而非一条路径时——纯约束求解用 [[re-z3]] 更轻（见坑 2）
- 注意：符号执行是把双刃剑——先人工定位关键校验函数缩小符号化范围（见坑 2）；运行验证走沙箱（[[platform-tips]] 最高原则）

## 工具准备

参考 [[platform-tips]] 最高原则——用求解结果运行目标验证时默认沙箱；angr 本身是进程内仿真器，不接触真实系统调用，求解过程无需沙箱。

### angr（pip 安装）

- `pip install angr`（Linux / macOS / Windows 均可；Windows 下 pip 装 win32 wheel，WSL 内安装 Linux 版亦可）
- **Python 版本兼容性（重点）**：angr 9.x 官方支持 **Python 3.9–3.11**（9.3+ 系列要求 Python 3.11+）。系统默认 Python 3.12 / 3.13（如 Ubuntu 24.04 自带 3.12）时**不要直接 pip 装**——部分依赖无预编译 wheel，会现场编译甚至失败。对策：装 3.11 建独立环境：
  - Ubuntu/Debian: `apt install python3.11 python3.11-venv` → `python3.11 -m venv ~/venvs/angr && source ~/venvs/angr/bin/activate`
  - macOS: `brew install python@3.11` 同上建 venv
  - Windows: python.org 下载 3.11 安装包 → `py -3.11 -m venv angr-venv`
- 装前先升级基础工具：`pip install --upgrade pip setuptools wheel`（避免原生组件编译失败）
- Linux 建议补 `binutils`（angr 处理 / 重写二进制会调 objcopy）：`apt install binutils`
- 验证: `python3 -c "import angr; print(angr.__version__)"`

### python3

- Linux: `apt install python3`（多数自带）；macOS: `brew install python`；Windows: 官方安装包 / `choco install python`
- 验证: `python3 --version`

### 目标二进制

- 原始样本副本（**先备份**：符号执行不修改文件，但建模要反复对照，见坑 5）+ [[re-triage]] 初勘产物（架构 / 位数 / 是否静态链接 / 是否带壳）
- 验证: `file target` 确认架构与位数（arm 目标 angr 支持，注意字节序）

## 操作步骤

按顺序执行，每步记录结果（地址 / 约束 / 求解脚本 / flag，证据路径见 [[re-triage]]）。**先人工后自动化**：符号化范围越小越稳（见坑 2）。

1. **确定符号化点（输入 / argv / 文件）**：
   - 反编译定位输入读取点：`read` / `scanf` / `fgets` / `getline` / `main(int argc, char **argv)` 的 argv 使用处（[[re-ghidra]] / [[re-ida]] / [[re-radare2]]）
   - 决定符号化通道——
     - 标准输入：`project.factory.full_init_state(stdin=claripy.BVS('in', 32*8))`（N 字节长度定多少？对照读取点逻辑确认长度，见坑 3）
     - argv：`project.factory.full_init_state(args=["./target", claripy.BVS("arg1", 64*8)])`
     - 文件：先 `state.posix.get_file(2)` 或 `SimFileStream` 按 fd 符号化；简单场景直接把整个输入区符号化再约束
   - 记下：符号化的通道 + 字节数 + 读取点的地址（后续 find / hook 用）

2. **到达目标地址 / 避开地址建模（find / avoid）**：
   - 反编译确认**成功路径地址**（校验通过后打印 flag 的地址）与**失败路径地址**（打印 "wrong" 等处，有多个失败点要列全）
   - 建模：`simgr.explore(find=0x4011xx, avoid=[0x4012xx, 0x4013xx])`（find 可多地址或 lambda `lambda s: b"flag{" in s.posix.dumps(0)`）
   - find 选地址的技巧：选**校验循环出口**而非程序 exit——找到"经过校验通过分支"的状态即可，不必等打印（见坑 5）
   - 校验是通过调用函数返回判定（`if (check(input))`）→ find 设在 check 返回后的成功分支地址，avoid 设在失败分支

3. **路径约束与求解（solver）**：
   - 找到状态后，约束即该状态路径上累积的条件：`found = simgr.found[0]`
   - 求解：`flag = found.solver.eval(found.posix.stdin, cast_to=bytes)`（stdin 场景）或按符号变量名求：`found.solver.eval(flag_sym, cast_to=bytes)`
   - 多解时按需加约束（长度 / 可打印字符，见坑 4）：
     ```python
     for c in flag_sym.chop(8): found.solver.add(0x20 <= c, c <= 0x7e)
     ```
   - 输出到文件：`open('flag.bin','wb').write(flag)`，同时打印 repr 检查（非打印字符常是符号化长度问题，见坑 3）

4. **路径爆炸应对（hook / 限制深度 / 分段）**：
   - **hook 无关调用**：把与校验无关的重型 / 系统调用替换成轻量过程：
     ```python
     project.hook(addr_of_sleep_or_memset_impl, angr.SIM_PROCEDURES["stubs"]["ReturnUnconstrained"]())
     ```
     `angr.SIM_PROCEDURES` 自带库（`libc.sleep`、`linux_kernel` 等）优先：`project.hook_symbol("sleep", angr.SIM_PROCEDURES["posix"]["sleep"])`
   - **限制探索规模**：`simgr = proj.factory.simgr(state, veritesting=True)`（veritesting 合并路径，长循环题常用，见坑 2）；`simgr.explore(find=..., avoid=..., num_find=1)` 找到即停；`stash` 上限 / `lazy_solves` 选项控制
   - **分段探索**：长循环把入口地址 hook 住，先探索到循环边界，再对循环体单独符号化展开（人工定位循环不变量后缩小范围）
   - 仍爆炸 → 回到步骤 1 缩小符号化范围 / 结合人工分析（见坑 2），或换 [[re-z3]] 对已展开的循环体建模

5. **典型模板（find / avoid 模式）**：
   ```python
   import angr, claripy
   p = angr.Project("./target", auto_load_libs=False)   # 关库加载，快且稳
   inp = claripy.BVS("inp", 32 * 8)                      # 32 字节符号化输入
   state = p.factory.full_init_state(stdin=inp)
   simgr = p.factory.simgr(state, veritesting=True)
   simgr.explore(find=0x4011xx, avoid=[0x4012xx, 0x4013xx])
   if simgr.found:
       sol = simgr.found[0].solver.eval(inp, cast_to=bytes)
       print(sol)                                        # 直接保存进证据目录
   else:
       print("no path found")                            # 排查：地址错 / 输入长度 / 未符号化
   ```
   - 模板参数化：`find` / `avoid` / 输入长度 / 符号化通道写进脚本头部注释，逐个换参跑（见坑 5）

**验证**：沙箱内（[[re-sandbox]]）用求解出的输入原样跑目标（stdin 重定向 `./target < flag.bin` 或按 argv / 文件通道），必须打印 `flag{...}`；与 [[re-z3]] / 人工还原结果交叉对照（见坑 4）。

## 跨域联合

- [[re-ctf]]：本技能是 re-ctf 网关工作流第 3 步的自动化解题路径（逐字节长循环校验题）
- [[re-binary-core]]：前置工作台——反编译定位输入读取点 / 成功失败分支地址（[[re-ghidra]] / [[re-ida]] / [[re-radare2]]）；[[re-triage]] 初勘决定架构 / 位数 / 壳
- [[re-deobfuscate]]：混淆先还原再符号执行（花指令 / 平坦化函数直接符号执行会路径爆炸）
- [[re-z3]]：姊妹技能——无循环 / 已人工展开的约束集合用 z3 更轻更快；angr 求解慢时对约束子集转 z3
- [[re-crypto-decrypt]]：其「工具准备」将 angr 列为可选的解密仿真方案（还原算法失败时符号化执行解密函数）
- [[re-sandbox]]：求解输入的运行验证沙箱（[[platform-tips]] 最高原则）
- [[re-gdb]] / [[re-tracing]]：动态交叉验证（断点看校验分支实际走向，与 angr 路径结论对照）

## 常见坑与陷阱

- **路径爆炸**：现象——`explore` 跑十几分钟状态数飞涨，内存吃满；原因——符号化范围过大（整段程序都符号化）、无关分支（strlen / memcpy 展开、错误处理分支）被逐一探索、长循环不合并；对策——hook 无关系统调用（步骤 4）、`veritesting=True` 合并路径、`num_find=1` 找到即停、缩小符号化输入范围（步骤 1 只符号化校验真正读取的字节）；仍不行就分段探索或转人工分析
- **复杂校验慢 → 结合人工分析**：现象——一个看似简单的题 angr 几分钟没结果；原因——校验链中夹着查表 / 随机数 / 系统调用副作用，符号执行在这些点低效；对策——先人工反编译定位**关键校验函数**，把符号化入口设到校验函数入口（`blank_state` + 手动设置寄存器 / 内存），跳过前面无关代码；校验是纯等式集合时直接换 [[re-z3]]
- **未符号化输入 → 无解**：现象——`explore` 秒回 `no path found`，或求解出的值跑原程序不通过；原因——输入没被符号化（读取的是真实 stdin / 文件内容）、符号化字节数 < 实际读取长度（`fgets(buf, 0x40)` 却只符号化 16 字节）、输入含运行时才能确定的量（随机数 / 时间戳）；对策——对照反编译确认读取点与长度（步骤 1），stdin 长度按读取上限符号化；随机值点用 hook 固定（`hook_symbol("rand", ...)`）再符号化
- **python 版本兼容**：现象——`pip install angr` 报编译错误 / import 即崩（`ImportError` 指向 C 扩展）；原因——Python 3.12 / 3.13 下部分依赖（pyvex / unicorn 相关）无预编译 wheel，现场编译失败；对策——用 Python 3.9–3.11 建独立 venv 再安装（工具准备节），别在系统默认解释器里硬装；装前 `pip install --upgrade pip setuptools wheel`
- **find 地址选错 → 求解出的"flag"跑不通**：现象——求解成功但输出含非打印字符 / 程序不打印 flag；原因——find 设在错误处理循环（失败也经过）、多失败点只 avoid 了一个、符号化长度与程序读取不一致；对策——find 选**校验循环出口**（用反编译确认唯一成功路径），avoid 列全所有失败分支；输出先 `repr()` 检查再原样重放（见步骤 3 验证）；拿多个解逐一跑目标验证
