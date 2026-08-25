# angr 命令速查与操作序列

angr 是 Python 库，没有 CLI 命令——"命令"即 API 调用。全部用法以官方文档（docs.angr.io）与目标版本源码为准；版本差异见 [[gotchas]]。

## 装载族（Project）

```python
import angr, claripy
p = angr.Project("./target", auto_load_libs=False)   # 关库加载：快且稳（默认行为按版本有差异）
p.loader.main_object.mapped_base                     # 实际装载基址（PIE 目标先查它）
p.loader.main_object.entry                           # 入口点
p.factory                                             # 状态/块工厂
p.factory.block(addr).vex                             # 取 VEX IR（汇编级核对）
```

## 状态族（State）

```python
s = p.factory.entry_state()                          # 从入口
s = p.factory.full_init_state(stdin=claripy.BVS('in', 32*8))            # 标准输入符号化
s = p.factory.full_init_state(args=["./target", claripy.BVS("arg1", 64*8)])  # argv 符号化
s = p.factory.blank_state(addr=0x401000)             # 任意地址起步（校验函数入口常用）
s.regs.rax = claripy.BVS('rax', 64)                  # 设符号寄存器
s.mem[0x601000].int32 = ...                          # 符号内存写
s.posix.dumps(0)                                     # 当前 stdin 内容（find 条件常用）
s.solver.eval(...) / s.solver.add(...)               # 该状态的求解器
# 状态选项（未初始化内存/寄存器行为）
opts = {angr.options.ZERO_FILL_UNCONSTRAINED_MEMORY, angr.options.ZERO_FILL_UNCONSTRAINED_REGISTERS}
s = p.factory.entry_state(add_options=opts)
```

## 文件系统族

```python
s.fs.insert('/tmp/in', angr.SimFile('in', content=claripy.BVS('in', 32*8)))  # 符号文件
# 程序 fopen('/tmp/in') 后读取即符号化；按 fd 操作走 s.posix.fd[0]（0=stdin，1/2 是 stdout/stderr 勿混）
```

## SimManager 族（路径探索）

```python
simgr = p.factory.simgr(s, veritesting=True)         # veritesting 合并路径（长循环题常用）
simgr.explore(find=0x4011xx, avoid=[0x4012xx, 0x4013xx], num_find=1)  # 找到即停
simgr.found / simgr.deadended / simgr.active         # 各 stash
simgr.move('deadended', 'active')                    # stash 操作
simgr.run(n=100)                                     # 手动步数上限
simgr.prune()                                        # 剪掉已无解路径
```

## 求解族（claripy / solver）

```python
inp = claripy.BVS('inp', 32*8)                       # 符号变量（位宽=字节数*8）
claripy.BVV(0x41, 8)                                 # 具体值
solver = found.solver
solver.add(inp.get_byte(0) == ord('f'))              # 加约束（逐字节）
flag = solver.eval(inp, cast_to=bytes)               # 求值
solver.satisfiable()                                 # 可满足性检查
solver.min(inp) / solver.max(inp)                    # 极值（长度约束常用）
for c in flag_sym.chop(8): solver.add(0x20 <= c, c <= 0x7e)   # 可打印字符约束
# eval 超时与数量: solver.eval(expr, n=..., cast_to=bytes, timeout=...) 按需
```

## Hook 族（路径爆炸应对）

```python
project.hook(addr, angr.SIM_PROCEDURES["stubs"]["ReturnUnconstrained"]())  # 地址处替换
project.hook_symbol("sleep", angr.SIM_PROCEDURES["libc"]["sleep"])          # 按符号替换
project.hook_symbol("rand", angr.SIM_PROCEDURES["libc"]["rand"])            # 固定随机值
project.unhook(addr) / project.unhook_symbol("sleep")                        # 还原
# SIM_PROCEDURES 类目: "stubs" 通用替身 / "libc" / "linux_kernel" / "posix" 等
```

## 分析族（其他内置分析）

```python
p.analyses.CFGFast()              # 快速控制流图（找关键函数/循环边界）
p.analyses.CFGEmulated()          # 模拟 CFG（重/慢）
p.analyses.BackwardSlice(...)     # 后向切片（定位影响输出的输入字节）
p.analyses.VariableRecovery(...)  # 变量恢复
```

## 操作序列（组合套路）

### 1. CTF find/avoid 标准模板（argv 变体）

```python
import angr, claripy
p = angr.Project("./target", auto_load_libs=False)
arg = claripy.BVS("arg1", 64*8)
s = p.factory.full_init_state(args=["./target", arg])
simgr = p.factory.simgr(s, veritesting=True)
simgr.explore(find=0x4011xx, avoid=[0x4012xx, 0x4013xx])
if simgr.found:
    print(simgr.found[0].solver.eval(arg, cast_to=bytes))
```

### 2. 文件输入符号化（fopen 读取型）

```python
s = p.factory.full_init_state()
s.fs.insert('/tmp/in', angr.SimFile('in', content=claripy.BVS('in', 0x40*8)))  # 长度按读取上限
simgr = p.factory.simgr(s)
simgr.explore(find=..., avoid=...)
sol = simgr.found[0].solver.eval(s.fs.get('/tmp/in').content, cast_to=bytes)
open('flag.bin','wb').write(sol)     # 沙箱内 ./target < flag.bin 验证
```

### 3. blank_state 从校验函数入口起步（跳过无关代码）

```python
# 反编译定位校验函数入口（[[re-ghidra]]）与参数约定
s = p.factory.blank_state(addr=check_entry, add_options={angr.options.ZERO_FILL_UNCONSTRAINED_REGISTERS})
s.regs.rdi = claripy.BVS('inp', 32*8)     # 按调用约定放参数
s.mem[s.regs.rsp] = 0x0                   # 栈帧最小化（返回地址）
simgr = p.factory.simgr(s)
simgr.explore(find=success_addr, avoid=fail_addr)
```

### 4. 循环题提速（hook + veritesting + 分段）

```
hook 无关调用（sleep/memset/rand）→ simgr(veritesting=True)
仍慢: 探索到循环边界地址 → 对循环体单独符号化展开（人工定位循环不变量）
仍爆炸 → 换 [[re-z3]] 对已展开约束建模
```

## 实现教训（内化）

- `auto_load_libs=False` 是默认建议：库加载既慢又让求解空间虚胖；样本带壳先脱壳（[[re-deobfuscate]]）再符号执行
- find/avoid 的地址**按 angr 装载基址**填（PIE 与 Ghidra 显示基址差固定偏移），脚本头部注释标明换算关系
- 求解出的值先 `repr()` 检查再重放：非打印字符常是符号化长度 < 实际读取长度
- 涉及除法的表达式显式加"分母非零"约束（Z3 对 a/0 求值全 1）——见 [[gotchas]]
- 探索超时用 `simgr.explore(..., timeout=...)` 或 `s.solver.eval(..., timeout=...)` 设秒级上限，别无限等
- `eval(expr, cast_to=bytes)` 只对整字节宽符号有意义；逐字节用 `get_byte(i)`/`chop(8)`
- 一个目标多轮求解时，脚本参数化（find/avoid/长度/通道放头部注释）逐参跑，别改一处全重写

## 使用注意

- 求解过程在进程内仿真器完成，无需沙箱；**用求解结果运行目标验证时默认沙箱**（[[platform-tips]] 最高原则）
- 结果（地址/约束/求解脚本/flag）存档 sha256 + 路径（[[re-triage]] 证据链）；结论入 [[analysis-contract]]
