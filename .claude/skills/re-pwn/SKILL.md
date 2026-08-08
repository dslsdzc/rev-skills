---
name: re-pwn
description: >
  CTF pwn 入门：栈溢出、格式化字符串、ret2libc。
  触发词：pwn、栈溢出、格式化字符串、ret2libc、ROP、shellcode 注入
---

# CTF pwn 入门（栈溢出 / 格式化字符串 / ret2libc）

## 何时使用 / 何时不用

- 用：CTF pwn 赛题——栈溢出（覆盖返回地址）、格式化字符串（泄露 / 任意写）、ret2libc（泄露 libc 拿 shell）
- 用：拿到题目二进制 + 配套 libc，要写出能 get shell / 打印 flag 的利用脚本
- 用：入门级 ROP（ret2win / ret2shellcode / ret2libc / ret2csu 前几级）
- 不用：复杂 ROP 链工程化 / 堆利用（fastbin / tcache）→ [[re-exploit]]
- 不用：纯逆向题（还原算法找 flag）→ [[re-ctf]] 的逆向分支（[[re-binary-core]]）
- 不用：Windows 目标（[[re-x64dbg]] / [[re-windbg]]）；macOS 目标（[[re-lldb]]）
- 注意：利用验证是动态执行，默认在沙箱内跑（[[platform-tips]] 最高原则，见 [[re-sandbox]]）；沙箱内本地验证通过，再考虑连远程（坑 4）

## 工具准备

参考 [[platform-tips]]——利用验证默认沙箱；先静态分析（反汇编 / checksec）再动态调试，符合「静态优先」思路。

### pwntools（pip 安装，Python 3.8+）—— 利用脚本主力

- `pip install pwntools`（官方 PyPI，4.15.x；官方文档声明支持 Python 3.8+，64 位系统支持最好）
- 发行版包（版本可能落后，功能一致）：Debian/Ubuntu `sudo apt install python3-pwntools`、Fedora `sudo dnf install python3-pwntools`、Arch `sudo pacman -S python-pwntools`（Extra 仓库官方包）
- **Python 3.12+（如 Ubuntu 24.04 自带 3.12）直接 pip 装会报 PEP 668 `externally-managed-environment`**——对策：建 venv（`python3 -m venv ~/venvs/pwn && source ~/venvs/pwn/bin/activate` 后 pip install），或发行版 apt 包，或 `pip install --break-system-packages`（系统级，注意风险）
- 验证: `pwn --version` / `python3 -c "import pwn; print(pwn.version)"`

### checksec —— 防护检查（pwntools 内置）

- 随 pwntools 安装即用: `pwn checksec --file ./target`
- pwndbg 内置 `checksec` 命令（装好 pwndbg 即用，见 [[re-gdb]]）
- 验证: `pwn checksec --file ./target` 输出含 Arch/RELRO/Stack Canary/NX/PIE 各行

### gdb + pwndbg/gef（见 [[re-gdb]]）—— 动态验证

- gdb: Debian/Ubuntu `sudo apt install gdb`、Fedora `sudo dnf install gdb`、Arch `sudo pacman -S gdb`、macOS `brew install gdb`（建议 lldb）
- **32 位目标**：Debian/Ubuntu 需 `sudo apt install gdb-multiarch`（64 位 gdb 调 32 位目标要它）；跑 32 位动态链接程序还需 32 位运行库 `sudo apt install libc6-i386`
- pwndbg / gef 二选一（`git clone` 后 `./setup.sh` / curl 到 ~/.gdbinit，见 [[re-gdb]]）；验证: 进 gdb 有 pwndbg/gef banner

### one_gadget（可选）—— libc 一键 RCE

- `gem install one_gadget`（Ruby gem，one_gadget 1.10.0 要求 Ruby ≥ 3.1（gemspec 声明）；Debian/Ubuntu 先 `sudo apt install ruby`；macOS 自带 Ruby，`sudo gem install one_gadget`）
- Arch: `sudo pacman -S one_gadget`（Extra 仓库官方包）；Fedora 无包 → gem 安装
- 验证: `one_gadget /lib/x86_64-linux-gnu/libc.so.6`（列出候选 one_gadget 及其约束条件）

## 操作步骤

按顺序执行；每步产物（checksec 输出、偏移、libc base、flag）记录证据路径 + sha256（存证方法见 [[re-triage]]），供 writeup 引用。

1. **漏洞识别（checksec 保护 / 反汇编找危险函数）**：
   ```sh
   file target && sha256sum target > target.sha256
   pwn checksec --file target        # NX / PIE / Canary / RELRO —— 决定利用路线（见坑 1）
   ```
   - 反汇编/反编译找**危险函数与输入点**（[[re-binary-core]] 底座，[[re-ghidra]] / [[re-ida]] / [[re-radare2]]）：
     - 栈溢出：`gets` / `strcpy` / `scanf("%s")` / 手动 `read(fd, buf, 大长度)` / `sprintf` —— 重点看缓冲区大小与输入长度是否受限（`read(fd, buf, 0x40)` 配 0x20 的 buf 就是溢出点）
     - 格式化字符串：`printf(user_input)` / `sprintf(buf, user_input)`（第一个参数不是常量字符串）
     - 后门/flag 函数：strings 里有 `/bin/sh` 或函数名含 win/backdoor/flag，xref 确认可达性
   - 记录：漏洞类型、危险函数地址、输入通道（stdin / 远程 socket）、保护状态（决定 ② 走哪条路线）

2. **栈溢出利用（偏移计算、覆盖返回地址）**：
   ```sh
   # 偏移计算：cyclic 生成模式串，崩溃后定位返回地址在输入中的偏移
   python3 -c "from pwn import *; print(cyclic(200, n=8))" > /tmp/patt
   # 本地崩溃（沙箱内）→ gdb/pwndbg 看 $rsp，或直接 pwntools 一体化：
   ```
   ```python
   from pwn import *
   p = process('./target'); p.sendline(cyclic(200, n=8)); p.wait()
   core = p.corefile  # 需开启 core dump
   print("offset:", cyclic_find(core.pc, n=8))   # 64 位 rip 在 core.pc
   ```
   - 覆盖返回地址到后门函数（ret2win）：`offset * b'A' + p64(win_addr)`
   - **64 位注意**：调函数前参数进寄存器（rdi/rsi/rdx），不是栈——需要 `pop rdi; ret` 类 gadget 传参（坑 5）
   - NX 关闭（`pwn checksec` 显示 NX disabled）→ 可把 shellcode 放栈上，返回地址指向它（ret2shellcode）；NX 开启走 ③
   - 每轮用 gdb（[[re-gdb]]）断在返回点验证返回地址确实被控（`x/10gx $rsp`）

3. **ret2libc（PLT/GOT、libc 版本识别）**：
   - 前提：溢出可控但栈不可执行（NX on）、无后门——目标是调到 libc 的 `system("/bin/sh")`：
   ```sh
   objdump -d target | grep -E '<puts@plt>|<printf@plt>|<system@plt>'   # PLT 可调函数
   objdump -R target | grep puts                                          # GOT 存 libc 实际地址
   ```
   - 泄露 libc 地址：第一段 ROP 调 `puts@plt(puts@got)`（rdi = puts@got，见坑 5）→ 打印出 libc 中 `puts` 的真实地址 → 返回 main 再打第二段
   - **libc 版本识别**：拿到题目给的 libc 文件则本地算偏移；没给就用泄露的低 12 位（页内偏移不变）+ 在线库（libc.rip / libc-database，见坑 2）：
     ```sh
     one_gadget ./libc.so.6    # 若有 libc 文件：直接列 one_gadget
     # 或用泄露的 puts 地址后 3 位 hex 查 libc-database: ./find puts 7a0
     ```
   - 计算: `libc_base = leaked_puts - puts_offset`；`system_addr = libc_base + system_offset`；`binsh_addr = libc_base + binsh_offset`（`readelf -s libc.so.6 | grep system` 与 `strings -tx libc.so.6 | grep /bin/sh`）
   - 第二段 ROP：`pop rdi; ret` → binsh_addr → system → 收尾（对齐，坑 5）

4. **格式化字符串（泄露 / 写）**：
   ```sh
   # 泄露：把输入原样做 format 的参数，%p 逐个试偏移
   python3 -c "print('%p.'*20)" | ./target
   ```
   ```python
   from pwn import *
   p = process('./target')
   p.sendline(b'%6$p %7$p')      # 固定读第 6/7 个参数（%1$–%5$ 是 rsi/rdx/rcx/r8/r9 寄存器，即栈上第 1/2 个 8 字节）
   print(p.recvline())
   ```
   - 泄露：`%N$p` 直接读栈上第 N 个参数（往返几次定位 flag / 返回地址 / libc 地址，见坑 4 的环境差异）
   - 任意写：`%N$n` 把已输出字节数写到第 N 个参数指向的地址——payload 布局 = 目标地址（前 8 字节）+ 偏移到该地址 + `%<len>c%N$n` 分段写（先小后大，或用 `%hhn` 按字节写省字节数）
   - 经典目标：GOT 表项（RELRO partial 时）改成 system / win 函数地址；或改返回地址为 one_gadget
   - pwntools 辅助: `fmtstr_payload(offset, {got_addr: win_addr}, write_size='byte')`

5. **本地验证（pwntools 脚本）**：
   ```python
   from pwn import *
   context.binary = './target'            # 自动取架构/位数/保护
   context.log_level = 'debug'
   p = process('./target')                # 本地（沙箱内）；远程: remote('host', port)
   payload = b'A'*offset + p64(win_addr)
   p.sendline(payload)
   p.interactive()                        # 拿到 shell 后 cat flag
   ```
   - 验证纪律：本地跑通 → 记录 flag 与 payload 的 sha256 → 再连远程（坑 4）；失败时先 gdb 定位（断点下在返回点看返回地址是否命中）
   - 产物：exploit.py（含注释的版本）+ 运行输出（flag）+ flag sha256 —— writeup 引用

## 跨域联合

- [[re-ctf]]：本技能是 CTF 实践网关的 pwn 分支子技能——网关第 1 步题型识别到 pwn 题后固定调度本技能
- [[re-binary-core]]：反汇编/反编译定位危险函数、后门函数、PLT/GOT（[[re-ghidra]] / [[re-ida]] / [[re-radare2]]）；[[re-imports]] 的导入表思路定位 puts/system
- [[re-gdb]]：动态验证（断在返回点 / 格式化字符串参数验证 / core 文件拿 rip），pwndbg 的 `checksec` 命令
- [[re-angr]]：溢出偏移不确定 / 校验逻辑复杂时符号执行辅助（符号化输入找覆盖返回地址的约束）；[[re-z3]] 用于格式化字符串写地址的计算校验（少量）
- [[re-exploit]]：进阶衔接——复杂 ROP（SROP / ret2dlresolve）、堆利用、seccomp 绕过
- [[re-vuln]]：pwn 赛题即简化漏洞——赛题利用思路映射真实漏洞挖掘（崩溃分析 [[re-crash-triage]] / 找 bug [[re-fuzzing]]）
- [[re-sandbox]] / [[platform-tips]]：一切动态执行与利用验证默认沙箱内跑（最高原则）；远程目标仅验证用，不投入真实系统

## 常见坑与陷阱

- **保护全开（NX/PIE/Canary 组合）需要组合利用**：现象——单一 ret2shellcode 或 ret2libc 跑不动：NX on 栈不可执行、PIE on 二进制地址每次变、Canary 在返回地址前有随机金丝雀一覆盖就 abort；原因——现代题目保护组合是常态，一条路线解决不了所有保护；对策——按 checksec 结果组合：Canary → 先格式化字符串泄露 canary 再溢出（payload = pad + canary + pad + ret）；PIE → 先泄露一个二进制地址算 base（格式化字符串或 puts 泄露），gadget/后门地址 = base + 偏移；NX+PIE+Canary 全开 = 先两次泄露（canary + libc/二进制 base）再 ROP；泄露值最后 12 位页内偏移不变、直接拼算 base（坑 2 同理）
- **libc 版本不匹配（偏移全错）**：现象——本地 exploit 跑通，按泄露地址算的 `system`/`/bin/sh` 偏移打远程直接崩，或泄露地址用本地 libc 算 base 完全对不上；原因——不同 libc 版本符号偏移不同（glibc 2.27 与 2.31 的 puts 偏移差很多），本地 `/lib/x86_64-linux-gnu/libc.so.6` 与远程环境不一致；对策——题目给 libc 文件就用它（`strings -tx` / `readelf -s` 取偏移）；没给则用泄露的低 12 位 + libc-database（`./find puts 7a0`）或在线 libc.rip 匹配版本，再用匹配到的 libc 算所有偏移；远程打之前先确认远程 libc 与本地一致（用格式化字符串泄露 `__libc_start_main` 地址对比）
- **本地通远程挂（环境差异）**：现象——本地沙箱跑通 exploit，远程连接后同样的 payload 失败（段错误/无输出/超时）；原因——本地与远程环境差异：libc 版本（坑 2）、二进制位数/架构、pwntools 的 `context` 配置（位数/字节序错会 p64 全错）、stdin 交互时序（程序有打印延迟/提示符）、远程只读 flag 路径；对策——先把 `context.binary` 配对，本地用题目给的同版本 libc 与系统（`patchelf --set-interpreter` + `--replace-needed` 换成本地同一 libc 跑通）；远程脚本统一 `remote()` + 带 `sleep`/`recvuntil` 的时序处理；本地验证加 `setvbuf`/提示符差异模拟；最终以题目给的远程 libc 文件为准
- **64 位参数传递（rdi）**：现象——64 位程序 ROP 里直接"栈上摆参数"（32 位习惯），`system` 报段错误或调了不存在地址；原因——x86-64 SysV ABI 前 6 个参数走寄存器（rdi/rsi/rdx/rcx/r8/r9），不是栈；ROP 需要 `pop rdi; ret` 把栈上值弹进 rdi 再 ret 到目标函数；原因之二——`call` 后 `$rsp` 未对齐 16 字节时 `movaps` 类指令直接崩（glibc 新版本常见）；对策——`ROPgadget --binary target | grep 'pop rdi'` 或 ropper `--search "pop rdi"` 找 gadget（见 [[re-exploit]]）；每段调用前 gadget 链 = `pop rdi; ret` → 参数 → 目标地址；`system` 前栈地址先 `+8`（对齐 ret）或用 `ret` gadget 调整；32 位目标才用纯栈传参
- **格式化字符串偏移判断错 / 写崩**：现象——`%6$p` 读出的值与预期栈布局对不上，或 `%n` 写入后程序直接崩；原因——偏移数错（不同编译/平台参数位置不同，输入本身也在栈上占用位置）；写目标地址不可写（GOT full RELRO 只读、写到非法地址）；分段写顺序错（从大值写小值会死循环）；对策——先用 `%p` 全量 dump 对齐栈布局（`python3 -c "print('%p.'*30)"`），记录输入自身落在第几个参数位（它常是偏移基准）；写之前 `pwn checksec` 确认 GOT 是否可写（partial RELRO 才行）；`%hhn` 按字节写并从小到大排；每步用 gdb 验证目标地址内容确实被改
