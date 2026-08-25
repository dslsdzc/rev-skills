# Unicorn / Qiling 命令速查与操作序列

两框架都是 Python 库："命令"即 API。分工：Unicorn 只管 CPU+内存（单函数/代码段）；Qiling 在 Unicorn 之上接管系统调用/文件/动态链接（程序级）。API 名以官方文档与目标版本源码为准（版本差异见 [[gotchas]]）。

## Unicorn API 族

```python
from unicorn import *
from unicorn.x86_const import *        # 按架构: arm_const / arm64_const / mips_const ...

mu = Uc(UC_ARCH_X86, UC_MODE_32)       # 架构 × 模式
mu = Uc(UC_ARCH_ARM, UC_MODE_ARM | UC_MODE_BIG_ENDIAN)   # armeb 大端

# 内存（必须先 mem_map 再 mem_write；地址与大小须页对齐）
mu.mem_map(0x1000, 0x1000)             # 一页
mu.mem_write(0x1000, CODE)             # 写代码/数据
data = mu.mem_read(0x2000, 0x100)      # 读内存（脱壳明文落盘）
mu.mem_protect(0x1000, 0x1000, UC_PROT_ALL)   # 改权限（UC_PROT_READ/WRITE/EXEC/ALL）
mu.mem_unmap(0x1000, 0x1000)

# 寄存器
mu.reg_write(UC_X86_REG_ESP, 0x2000)   # 栈必须设，否则崩
rax = mu.reg_read(UC_X86_REG_EAX)

# 执行
mu.emu_start(0x1000, 0x1000 + len(CODE), timeout=0, count=0)  # until 必须覆盖代码结束
mu.emu_stop()

# 钩子
mu.hook_add(UC_HOOK_CODE, hook_code)              # 每指令
mu.hook_add(UC_HOOK_MEM_READ | UC_HOOK_MEM_WRITE, hook_mem)  # 内存读写
mu.hook_add(UC_HOOK_MEM_UNMAPPED, hook_bad)       # 未映射访问（可现场补映射继续）
mu.hook_add(UC_HOOK_MEM_FETCH, hook_fetch)        # 取指（追踪执行流）
mu.hook_add(UC_HOOK_INTR, hook_intr)              # 中断（syscall 类拦截）
mu.hook_del(handle)                               # 卸钩
```

钩子回调签名（2.x 与 1.x 一致）：

```python
def hook_code(uc, address, size, user_data): ...                 # UC_HOOK_CODE
def hook_mem(uc, access, address, size, value, user_data): ...   # 内存类
def hook_bad(uc, access, address, size, value, user_data): ...   # 返回 True 继续
```

常用常数（见 [[gotchas]] 版本组）：`UC_ARCH_X86/ARM/ARM64/MIPS/RISCV`；`UC_MODE_16/32/64/ARM/THUMB/BIG_ENDIAN`；`UC_PROT_READ/WRITE/EXEC/ALL`；寄存器 `UC_X86_REG_RAX/ESP/EIP/RIP` 等。

## Qiling API 族

```python
from qiling import Qiling
ql = Qiling(["./rootfs/x8664_linux/bin/target", "arg1"], "./rootfs/x8664_linux")
# 构造: Qiling(argv, rootfs, env=..., verbose=..., console=...)；rootfs 下才是目标可见文件系统
ql.run()                                  # 或 ql.run(begin, end, timeout, count)
ql.save(snapshot="stage1.qsave")          # 状态存档（1.1+；reg/mem/fd 等可分别开关）
ql.restore(snapshot="stage1.qsave")       # 恢复继续
ql.hook_address(fn, addr)                 # 地址断点（等价 Unicorn 按地址判断的 hook_code）
ql.hook_code(fn)                          # 每指令
ql.hook_mem_read(fn) / ql.hook_mem_write(fn) / ql.hook_mem_unmapped(fn)
ql.mem.read(addr, size) / ql.mem.write(addr, data)
ql.reg.read("eax") / ql.reg.write("eax", 0)
ql.os.fs                                   # 文件系统视图（rootfs 内路径）
```

## 操作序列（组合套路）

### 1. 脱壳：摘出解密例程模拟执行拿明文

```
静态定位解密循环（[[re-unpack-simple]] / [[re-unpack-advanced]] + [[re-ghidra]]）
摘取: 代码段字节 + 入口寄存器初值（栈/数据指针）+ 输入密文区
Unicorn 加载: mem_map 代码页+数据页+栈页 → mem_write → reg_write → emu_start
hook_mem_write 记录目标区段写入时机 → mem_read 读出明文段 → sha256 存档
验证: 与沙箱实跑（[[re-sandbox]]）解密结果对照
```

### 2. 单函数逻辑验证（反编译产物 ↔ 模拟真值）

```
反编译还原算法（[[re-binary-core]]）→ 汇编级实现提取（objdump 段）
Unicorn 跑该段，输入用真值/边界值（0、-1、0x7fffffff）→ 输出对照反编译预期
不一致即反编译理解有误——以模拟为准修正逻辑
```

### 3. shellcode 行为分析

```
从样本提取 shellcode（[[re-shellcode]]）→ 映射可执行页
hook_code 记录指令序列 + hook_mem_write 记录写入（找解密循环落点）
hook_intr 拦截 int 0x80/syscall，打印 eax 与参数（不真执行系统调用）
产物（指令轨迹/写点）入证据目录
```

### 4. Qiling 全程序模拟 + 关键点 dump

```
Qiling 加载（rootfs 放好 libc/ld-linux 与输入文件）
hook_address 到 OEP/解密完成点 → ql.save 或 ql.mem.read 落盘解密段
ql.restore 回到存档点继续分支探索（多阶段流程用）
```

## 实现教训（内化）

- **页对齐**：mem_map 的地址与大小必须页（0x1000）对齐，报 `Invalid memory` 先查对齐
- **栈与 until 必设**：不设 ESP 进栈指令即崩；`emu_start` 的 until 必须覆盖代码结束地址，否则跑到非法地址
- **回调里抛异常 = 静默停**：2.x 把回调异常存起来并 emu_stop，外层可能只看到"模拟提前结束"——回调内 try/except + 打印，`emu_start` 后用 `reg_read` 检查 PC 判断停在哪
- **hook 里改 PC 可跳转**：`reg_write(UC_X86_REG_EIP, target)` 实现 patch 跳转；跳转后记得 `hook_del` 避免再进
- **系统调用不模拟**：Unicorn 裸跑遇 syscall 即停——hook_intr 假返回或换 Qiling
- **慢**：UC_HOOK_CODE 每指令回调是数量级开销，只在追踪段用；大数据区读写用 mem_read/mem_write 批量而非逐字节 hook

## 使用注意

- 模拟属动态执行，默认沙箱 + 网络隔离（[[platform-tips]] 最高原则）；模拟结论与真实沙箱执行交叉验证
- 产物（明文段/轨迹/快照）sha256 存档（[[re-triage]]）；结论入 [[analysis-contract]]
