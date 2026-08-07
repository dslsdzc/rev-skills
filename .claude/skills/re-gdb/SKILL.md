---
name: re-gdb
description: >
  GDB/pwndbg/gef 调试：attach、断点、内存读写。
  触发词：gdb、调试、pwndbg、attach
---

# GDB/pwndbg/gef 动态调试

## 何时使用 / 何时不用

- 用：Linux 目标动态调试（attach/启动/断点/内存读写）；core 文件分析；Wine 下调试 PE 进程
- 不用：Windows 原生目标（走 [[re-x64dbg]]，或 Wine 内 gdb 见 [[platform-tips]] Linux 分支）；macOS 目标（走 [[re-lldb]]）
- 不用：只读内存不调试（默认转储优先，走 [[re-memdump]]）

## 工具准备

参考 [[platform-tips]]：动态执行默认沙箱；Linux 分支的 Wine 进程 attach 经验；`直读 vs 转储` 决策——attach 失败即转 [[re-memdump]]。

### gdb

- Linux: `apt install gdb` / `dnf install gdb` / `pacman -S gdb`
- macOS: `brew install gdb`（需自签证书，一般直接用 lldb 更顺）
- WSL: Linux 包直接可用（跨 Windows 边界 attach 不可行，见 [[platform-tips]] WSL 分支）
- 验证: `gdb --version`

### pwndbg / gef（二选一，装到 ~/.gdbinit）

- pwndbg:
  ```sh
  git clone https://github.com/pwndbg/pwndbg
  cd pwndbg && ./setup.sh        # 自动装依赖并写 ~/.gdbinit
  ```
- gef:
  ```sh
  curl -L https://github.com/hugsy/gef/raw/master/gef.py -o ~/.gdbinit
  ```
- 验证: 进入 gdb 出现 pwndbg/gef banner

### checksec（二进制防护检查）

- pwndbg 内置 `checksec` 命令（装好 pwndbg 即用）
- 或 `pip install pwntools` → `pwn checksec --file ./target`
- 验证: `gdb -q -ex 'checksec' -ex quit ./target` 输出 NX/Canary/RELRO/PIE

## 操作步骤

1. **attach 前查 ptrace 权限**：
   ```sh
   cat /proc/sys/kernel/yama/ptrace_scope
   # 1 = 仅父进程可 attach（默认）；0 = 任意同属主；容器内常被强制禁止
   sudo sysctl -w kernel.yama.ptrace_scope=0   # 临时放宽（重启还原）
   ```
   ```sh
   gdb -q -p <pid>          # 同属主或 root；失败（Operation not permitted）→ 见坑 1
   ```
   沙箱容器内 attach 常被 seccomp 拦 → 直接走 [[re-memdump]] 转储。

2. **断点/单步/条件断点**：
   ```
   (gdb) file ./target
   (gdb) b *0x401000          # 地址断点
   (gdb) b sym.check if argc == 2    # 条件断点
   (gdb) r arg1 arg2          # 运行并传参
   (gdb) ni / si              # 单步（跳过/进入调用）
   (gdb) c                    # 继续
   (gdb) info b               # 列出断点
   ```
   带参数动态分析命令: `gdb -q -ex 'b main' -ex 'r' -ex 'x/10i $rip' ./target`

3. **查看/修改内存与寄存器**：
   ```
   (gdb) x/20wx $rsp          # 栈上 20 个 word
   (gdb) x/s 0x601000         # 字符串
   (gdb) p $rax               # 寄存器
   (gdb) set $rax = 0         # 改寄存器
   (gdb) set {int}0x601000 = 0x90909090   # 写内存（绕过校验）
   (gdb) find 0x400000, 0x410000, "flag{"  # 内存搜索字符串
   ```

4. **反调试绕过**：
   - 改标志位（anti-debug 常见检查点）:
     ```
     (gdb) p $eflags
     (gdb) set $eflags = $eflags | 0x100     # 置 TF 位
     ```
   - ptrace 自检: `ptrace(PTRACE_TRACEME)` 返回值被检查 → 断在调用点直接 `set $eax = 0`（x86）续跑
   - 时间差检测（rdtsc）: 先 `p $rax` 记两次调用差值，超阈值即退出——断到比较点 patch 比较寄存器
   - 以上修改只影响本次运行，不改文件（需持久化 patch 再动二进制并重新哈希对照）

5. **gcore 转储（默认转储优先）**：
   ```
   (gdb) gcore out
   ```
   或外部命令: `gcore -o out <pid>`（gdb 包附带，含寄存器/线程 ELF notes）
   按 [[platform-tips]]「直读 vs 转储」: 默认转储优先；脱壳须等 OEP 解密后再 dump；core 直接 `gdb ./target core` 复盘。

## 跨域联合

- [[re-binary-core]]：工作流第 6 步（Linux 调试器）
- [[re-anti-analysis]]：脱壳验证（断 OEP）与反调试绕过
- [[re-ctf]]：pwn 调试
- [[re-malware]]：Linux 恶意样本动态观察
- 与 [[re-memdump]] 互补（attach 失败→转储）

## 常见坑与陷阱

- **ptrace 被禁 → 转储兜底**：yama ptrace_scope=1 时非父进程 attach 被拒；容器 seccomp 直接杀 attach——不要死磕，按 [[platform-tips]] 转 [[re-memdump]]
- **反调试（ptrace 自检、时间差）**：样本用 `ptrace(PTRACE_TRACEME)` 自检或 rdtsc 时间差检测调试器——先静态定位检查点再断点 patch
- **Wine 进程 attach**：Wine 下 PE 进程是 Linux 进程，gdb 可 attach，但地址空间混 PE 映射与 Wine 结构——按 [[platform-tips]] Linux 分支经验处理（查 `/proc/<pid>/maps` 定位 PE 镜像段）
- 调试器注入痕迹（LD_PRELOAD/环境变量）会被检测——用 `unset env LD_PRELOAD` 类方式清理后 attach
- **时钟对抗分三类**：现象——样本检测到时间异常（计时倍率不对、单步耗时异常、时钟源非预期）后退出或改变行为；原因——时钟对抗分三类：时间倍率检测/单步延迟检测/VM 时间源检测；对策——先判定类别再分别应对：时间倍率类恢复真实时钟或 patch 比较点，单步延迟类用硬件断点减少被测量步数，VM 时间源类按 [[platform-tips]] 沙箱分支的环境指纹思路处理
- **断点失效 ≠ 代码没执行**：现象——在目标地址下断从不触发，误判该路径没跑、直接跳过关键逻辑；原因——四种机制使"断点没断"≠"代码没执行"：自修改代码（int3 字节被运行时覆盖或校验）、内存重映射（代码换到新映射、旧地址失效）、异常机制（流程经异常处理路径跳转，不走断点指令）、反调试绕过（样本扫描 0xCC/校验代码段字节后改道）；对策——先分四类排查：`x/i` 看断点处是否仍为 int3（自修改）、查 `/proc/<pid>/maps` 比对映射变化（重映射）、在异常上下文里找真实跳转目标（异常机制）、静态先找 0xCC 扫描与段校验点（反调试），再决定换断点位置 / 下内存断点 / patch 检查点（见 [[re-binary-core]] 分析方法论 R17）
- **单步异常 → 查反调试（陷阱旗 / 异常处理）**：现象——`si` 单步时触发未预期的 SIGTRAP/`#DB`，或单步后样本行为跳变（时间差类见"时钟对抗分三类"坑）；原因——陷阱旗检测（样本读 TF 位 / 利用单步异常自身做文章）与异常处理机制反调试（int3 由样本自身 handler 接管、SEH 链承担流程跳转、异常即控制流）；对策——先排除时间检测，再静态定位 `pushf`/`lahf` 后查 TF 的检查点与 int3 写入点，断 handler 入口看真实流向，patch 检查点或改用硬件断点（见 [[re-binary-core]] 分析方法论 R18）
