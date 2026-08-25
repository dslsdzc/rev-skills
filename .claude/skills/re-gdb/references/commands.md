# GDB 命令速查与操作序列

gdb 本体 + 增强前端二选一（pwndbg / gef，都写 ~/.gdbinit）。命令按族分组；pwndbg/gef 命令以各自官方 README 为准。

## 会话与运行族

| 命令 | 作用 |
|---|---|
| `gdb ./target` / `gdb -q -p <pid>` | 打开程序 / 静默附加 |
| `attach <pid>` / `detach` / `kill` | 附加 / 脱离 / 杀进程 |
| `r <args>` / `r < infile` | 运行并传参 / 输入重定向 |
| `c` / `si` / `ni` | 继续 / 步入 / 步过 |
| `finish` | 跑完当前函数停在返回处 |
| `until <addr>` | 运行到指定行/地址 |
| `set follow-fork-mode child` | 跟随子进程（fork 型样本） |
| `set detach-on-fork off` | fork 后两边都停住 |
| `set disable-randomization on` | 关 ASLR（PIE 地址固定，复盘方便） |
| `handle SIGALRM nostop noprint pass` | 不打断信号（超时类反调试常用） |

## 断点族

| 命令 | 作用 |
|---|---|
| `b *0x401000` / `b sym` / `b file.c:10` | 地址/符号/行断点 |
| `b sym if argc == 2` | 条件断点 |
| `hbreak` | 硬件断点（DR 寄存器，4 个上限） |
| `watch *(int*)0x601000` / `rwatch` / `awatch` | 写/读/读写数据断点 |
| `catch syscall <名>` | 系统调用断点（openat/write 等） |
| `commands ... end` | 命中自动执行（`silent` + printf + continue 批量打参） |
| `condition <n> <expr>` | 给已下断点加条件 |
| `ignore <n> <count>` | 跳过前 N 次命中 |
| `info b` / `disable` / `enable` / `delete` | 断点管理 |

## 内存与寄存器族

| 命令 | 作用 |
|---|---|
| `x/20wx $rsp` | 按格式看内存（`x/s` 字符串、`x/i` 指令、`x/30gx` 8 字节） |
| `p $rax` / `p *(int*)0x601000` | 寄存器/解引用 |
| `set $rax = 0` / `set {int}0x601000 = 0` | 改寄存器/写内存（本次运行内） |
| `find 0x400000, 0x410000, "flag{"` | 内存搜索字符串/字节 |
| `disassemble /r 0x401000` | 反汇编带原始字节 |
| `info registers` / `info proc mappings` | 寄存器全览 / 进程映射 |
| `dump memory out.bin 0x400000 0x401000` | 导出内存区间到文件（供 [[re-memdump]] 分析） |
| `bt` / `frame <n>` / `info locals` / `info args` | 调用栈回溯与帧切换 |

## core 与进程族

| 命令 | 作用 |
|---|---|
| `gcore <file>` | 当前进程转储 core（默认转储优先，见 [[re-memdump]]） |
| `gdb ./target core` | 复盘 core（`bt`、`info proc mappings`、`x/gx $rsp` 起点） |
| `info threads` / `thread <n>` | 线程切换（多线程样本） |
| `info sharedlibrary` | 已加载共享库（断点不命中先看它） |

## pwndbg 命令族（装 pwndbg 后可用）

| 命令 | 作用 |
|---|---|
| `checksec` | NX/Canary/RELRO/PIE 检查 |
| `vmmap` | 内存映射图（PIE 基址、栈/堆/库范围） |
| `heap` / `bins` / `tcache` | 堆结构/空闲链表（[[re-exploit]] 分析用） |
| `cyclic 200` / `cyclic -l <pattern>` | 生成/定位偏移（栈溢出定位） |
| `search "str"` / `search -t dword 0xdeadbeef` | 内存搜索 |
| `telescope $rsp` | 栈内容指针链展开 |
| `context` | 寄存器+反汇编+栈上下文（每步自动刷新） |

## gef 命令族（装 gef 后可用）

| 命令 | 作用 |
|---|---|
| `checksec` | 同 pwndbg |
| `context` / `telescope` | 上下文 / 指针链 |
| `xinfo 0x...` | 地址属于哪个映射/符号 |
| `heap bins` / `heap chunks` | 堆结构 |
| `xuntil` | 运行到地址（不设断点） |

## 脚本族（-ex / -x / python）

- 一行式: `gdb -q -ex 'b main' -ex 'r' -ex 'x/10i $rip' -ex quit ./target`
- 批处理: `gdb -q -batch -x script.gdb ./target`（script.gdb 内 `define` 自定义命令 + `commands` 断点组）
- Python: gdb 内置 Python 解释器，`python` 块或 `-ex 'python ...'`——pwndbg/gef 即 gdb Python API 的实现

## 操作序列（组合套路）

### 1. 授权校验比较点定位与绕过（带参数 + 条件断点）

```
gdb -q ./target
b main; r <input>            # 带样本输入启动
b strcmp                      # 或校验函数
commands                      # 命中自动打印参数
  silent
  printf "a=%s b=%s\n", $rdi, $rsi
  continue
end
c                             # 收集全部比较参数 → 静态还原校验逻辑
```

### 2. core 复盘（崩溃样本定位）

```
gdb ./target core
bt                            # 崩溃调用链
info proc mappings            # 映射基线（PIE 偏移核对）
x/20gx $rsp                   # 栈现场
# 需要环境再现场景时用 rr 录制重放（见 [[re-crash-triage]]）
```

### 3. pwndbg 堆利用分析（UAF/double free 定位）

```
vmmap                         # 堆范围
heap                          # 堆块总览
bins                          # fastbin/tcache 空闲链状态
# 下断点监控 malloc/free 参数（$rdi 地址）对照块链变化
```

### 4. 反调试自检绕过（ptrace 自检 patch）

```
静态定位 ptrace(PTRACE_TRACEME) 调用点（[[re-ida]] / [[re-ghidra]]）
gdb -q ./target
b *<ptrace返回后指令>; r
set $rax = 0                  # 伪造"未被跟踪"
c                             # 后续比较点同样 patch，或一次性静态改二进制
```

## 实现教训（内化）

- `b *地址` 的 `*` 表示"精确地址"（去符号解析），贴反编译地址时必加；贴文件偏移必须 + ASLR 基址，先 `vmmap`/`info proc mappings` 核对
- `commands` 里 `silent` 不加会每命中打一次 "Breakpoint n..." 噪声；printf 用 gdb 格式（`%s` 要传地址，`$rdi` 即参数）
- 断点不命中 ≠ 代码没执行：先查 `info b` 命中次数、`info sharedlibrary` 模块加载、`x/i` 断点处字节是否还是 int3（自修改代码覆盖）
- gdb 的 `set $reg` 只影响本次运行；要持久化得改二进制并重新哈希对照（[[re-patching]]）
- Python 脚本里 `gdb.execute("...")` 抛异常会中断脚本，批量跑包 try/except 并打印进度
- `find` 的地址范围参数是 `start, end`（逗号分隔不含空格），写错会按错误语法报错——范围先 `info proc mappings` 确认

## 使用注意

- 动态执行默认沙箱（[[platform-tips]] 最高原则）；attach 失败即转 [[re-memdump]] 转储
- 修改/转储产物 sha256 存档（[[re-triage]]）；结论写入 [[analysis-contract]]
