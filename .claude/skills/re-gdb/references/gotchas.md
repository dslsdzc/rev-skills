# GDB 工具特有坑与边界

## ptrace 权限与沙箱坑

- **yama ptrace_scope**：`/proc/sys/kernel/yama/ptrace_scope` = 1（默认）时非父进程 attach 被拒（`Operation not permitted`）——同属主也不行；`sudo sysctl -w kernel.yama.ptrace_scope=0` 临时放宽（重启还原），或让目标以子进程方式跑（`gdb ./target` 而非 attach）
- **容器 seccomp 拦 ptrace**：docker/沙箱内 attach 常直接失败——不硬磕，走 [[re-memdump]] 转储路线
- **Wine 进程 attach**：Wine 下 PE 进程是 Linux 进程可 attach，但地址空间混 PE 映射与 Wine 结构——`/proc/<pid>/maps` 定位 PE 镜像段（wine 版本/位数不同基址不同），反调试与进程模型按 Linux 侧处理

## 断点机制坑（断点失效 ≠ 代码没执行）

- **自修改代码覆盖 INT3**：壳/自解密运行时把断点字节改写——`x/i` 看断点处还是不是 0xCC；解密完成后重新下断
- **内存重映射**：代码换到新映射（`mmap`/`mprotect` 后），旧地址失效——`info proc mappings` 前后对照
- **异常路径跳转**：流程经异常处理（handler/SEH）走，不经过断点指令——在 handler 入口下断看真实流向
- **0xCC 扫描检测**：样本扫描断点字节/校验代码段后改道——静态先找扫描点（见 [[re-anti-analysis]] 反调试方法论）

## 反调试对抗坑

- **ptrace 自检**：`ptrace(PTRACE_TRACEME)` 返回值检查——断调用返回后 `set $eax=0`；注意一次 ptrace 会话只能 attach 一次，gdb 已占用后样本再 ptrace 会失败，这本身就是检测点
- **rdtsc 时间差**：单步延迟被测量——降低单步频率、改用硬件断点减少被测量步数，或 patch 比较点
- **陷阱旗（TF）检测**：`si` 触发莫名 SIGTRAP/`#DB`，或单步后行为跳变——静态找 `pushf`/`lahf` 后查 TF 的检查点（见 SKILL.md 坑）
- **信号被样本接管**：`handle SIGTRAP nostop` 之类改动要谨慎——样本可能利用单步异常自身做控制流
- **时序/多线程竞态**：断点命中时机影响行为（多线程边跑边下断会错过）——先 `Ctrl+C`/`interrupt` 暂停再下断

## 环境与版本坑

- **PIE/ASLR 地址漂移**：无符号样本每次运行地址变——`set disable-randomization on` 固定；复盘 core 时先 `info proc mappings` 求偏移再对反编译地址
- **pwndbg 与 gef 冲突**：都写 ~/.gdbinit，同时装 = 后装覆盖前装，或残留 Python 初始化报错——二选一，装前先删旧 .gdbinit
- **pwndbg 依赖版本**：pwndbg 依赖较新的 gdb（Python 3 API）；发行版自带 gdb 过旧时 `./setup.sh` 会提示——先 `gdb --version` 核对（如 Debian 老版本自带 gdb 10.x 与新版 pwndbg 不兼容）
- **gdb 版本差异**：`catch syscall` 需 Linux gdb（macOS 的 lldb 走 `[[re-lldb]]`）；`dump memory`/`gcore` 各版本行为一致但文件名默认带 pid
- **LD_PRELOAD/环境注入痕迹**：调试器注入的 `LD_PRELOAD` 可被检测——`unset env LD_PRELOAD` 类方式清理后 attach；样本自身依赖 `LD_PRELOAD` 时先记录原始值

## 使用注意

- 动态执行默认沙箱 + 网络隔离（[[platform-tips]] 最高原则）；attach 失败即转 [[re-memdump]]
- 修改只影响本次运行；持久化 patch 后重新 sha256 对照（[[re-triage]] / [[re-patching]]）
- 结论写入 [[analysis-contract]]；工具版本差异以目标环境实际行为为准
