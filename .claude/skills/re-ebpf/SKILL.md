---
name: re-ebpf
description: >
  eBPF 程序逆向与对抗分析：BPF-64 指令集、progs/maps 关联、bpftool 反汇编、跟踪取证/恶意样本/EDR 对抗三用途。
  触发词：eBPF、BPF、bpftool、bcc、libbpf、xlated、BPF 指令、bpf hook、EDR 对抗、tracepoint、kprobe。
---

# eBPF 程序逆向与对抗分析（BPF-64、progs/maps、xlated）

## 何时使用 / 何时不用

- 用：BPF-64 指令集（8 字节定长指令、r0-r10 寄存器、lddw/alu32/helper 调用约定）层面的程序分析
- 用：三种来源形态——BCC（运行期编译，多只剩内核态 prog）、libbpf（常规 BPF ELF，.maps/.BTF 齐全）、手工字节码（bpf_insn 数组/预编译 blob，无元数据）
- 用：三用途——跟踪取证（bpftrace/bcc 程序功能还原）、恶意 eBPF（内核驻留/加载链/规避手法）、EDR 对抗（bpf hook 识别与反制）
- 用：progs/maps 关联还原、hook 点（kprobe/tracepoint/cgroup/xdp/tc/fentry）识别、helper 调用号到内核 API 的语义映射
- 不用：经典内核模块（.ko 驱动）——走 [[re-kernel]]
- 不用：seccomp/套接字过滤器等传统 cBPF（经典 BPF，指令集与 BPF-64 不同，本技能不覆盖）
- 不用：仅需分析宿主加载器二进制的通用场景（[[re-binary-core]]）；链上 BPF 字节码（Solana 类）语义表不同，走 [[re-blockchain]]
- 注意：helper 调用号与内核结构布局随版本漂移，分析环境内核版本与样本目标版本尽量一致（见坑 3）

## 工具准备

所有工具先验证再使用。加载/运行 BPF 程序到内核需要 root（或 CAP_BPF/CAP_SYS_ADMIN）；恶意样本（内核驻留/规避类）的动态分析默认在隔离虚拟机 + 快照中进行（[[re-sandbox]]，[[platform-tips]] 最高原则）；仅只读查询（`prog list`/`dump xlated`）风险较低，但同样建议在可控环境核对内核版本一致性。

### bpftool —— 核心工具（prog/map 查询与 xlated 反汇编）

- Debian/Ubuntu: `apt install bpftool`（Debian bullseye 起有独立包；Ubuntu 19.10+ 亦可装 `linux-tools-common` + `linux-tools-generic`——前者只是 wrapper，真实二进制在 `linux-tools-$(uname -r)` 内核配套包里）；旧版 Debian（buster 及更早）无独立包，从内核源码编译 `tools/bpf/bpftool` 或克隆 libbpf/bpftool 仓库构建
- Fedora: `dnf install bpftool`（官方仓库）；Arch: `pacman -S bpftool`
- Windows: 原生无 eBPF，在 WSL2（Linux 内核）内按发行版安装；macOS: 无内核 eBPF 支持，用 Linux 虚拟机
- 验证: `bpftool version`；查询类命令加 `sudo`（`bpftool prog list`、`bpftool prog dump xlated id N`、`bpftool feature probe`、`bpftool map show/dump id N`、`bpftool net show`、`bpftool btf dump file /sys/kernel/btf/vmlinux`）

### llvm-objdump —— 静态反汇编 BPF ELF

- Debian/Ubuntu: `apt install llvm`；Fedora: `dnf install llvm`；Arch: `pacman -S llvm`；macOS: `brew install llvm`（llvm-objdump 在 /opt/homebrew/opt/llvm/bin/）
- 验证: `llvm-objdump --version`；反汇编: `llvm-objdump -d prog.o`（ELF e_machine=EM_BPF(247) 自动识别，无需指定目标）；GNU objdump（binutils 2.29+ 带 bpf 目标）也可作备选
- 注意: 静态反汇编的是源码编译产物，与内核中执行形态（xlated）有差异（见坑 2）

### bpftrace —— 跟踪取证还原（被分析的 bpftrace/bcc 程序还原时对照用）

- Debian/Ubuntu: `apt install bpftrace`；Fedora: `dnf install bpftrace`；Arch: `pacman -S bpftrace`
- 验证: `bpftrace --version`；`bpftrace -d -e 'probe { ... }'` 输出其生成的 BPF 指令，用于对照 xlated dump 还原脚本行为

### pyelftools —— ELF section 定位脚本化

- `pip install pyelftools`（跨平台）
- 验证: `python3 -c "import elftools; print(elftools.__version__)"`；用于批量提取 BPF ELF 的 `.text`/`.maps`/`.BTF`/`.rel*` 段

### Ghidra —— eBPF 处理器（10.3+ 内置）

- Ghidra 10.3 起官方内置 eBPF 处理器（社区 eBPF-for-Ghidra 扩展已并入上游；旧版 Ghidra 需装该扩展），支持 lddw/ALU32/JMP32/BPF_ATOMIC、bpf2bpf 相对调用、map 重定位、helper 以 syscall 形式带签名
- Linux: 官方 release（需 JDK）或发行版包（部分仓库有 `apt install ghidra`/`pacman -S ghidra`）；macOS: `brew install --cask ghidra`；Windows: 官方 zip
- 验证: 导入 BPF ELF，语言栏应显示 eBPF:LE:64:default
- 已知限制: eBPF 无专用栈指针寄存器，模块以 r10 充当 SP（栈深度恒 0、部分 r10 相对访问被当死代码）——反编译结果需与 xlated dump 交叉验证

### LIEF —— eBPF 反汇编库（批量处理）

- `pip install lief`（新版内置 LLVM MC 驱动的 eBPF 反汇编器，`lief.parse()` 后按 section/地址反汇编）
- 验证: `python3 -c "import lief; print(lief.__version__)"`
- 适合脚本化批量反汇编；无 GUI/反编译

### 专用逆向框架现状（边界说明）

- 此前设想的「bpf-gazelle 类」专用 eBPF 逆向框架：经检索（2026-08）未发现公开可用实现，本技能不依赖此类工具；当前做法为组合通用工具链（Ghidra 处理器 + bpftool xlated + llvm-objdump/LIEF），后续若出现专用框架再补充

## 操作步骤

按顺序执行，每步结果存档；运行期查询需要 root，动态分析默认沙箱。

1. **定位载体**（样本是什么形态，决定后续手段）：
   - **libbpf 型 BPF ELF**: `file prog.o` 显示 eBPF；`readelf -S prog.o` / `llvm-readelf -S` 查看 section——`.text` 与按 attach 点命名的 section（如 `kprobe/do_sys_openat2`、`tracepoint/syscalls/sys_enter_openat`、`xdp`、`tc`、`cgroup_skb/ingress`、`fentry/<fn>`）、`.maps`（BTF-defined map 定义）、`.BTF`（类型信息）、`.BTF.ext`（line info + CO-RE 重定位）、`.rel*`（重定位段）；需要批量提取时用 pyelftools
   - **BCC 型**: 运行期由内嵌 clang 现场编译，编译产物通常不留盘——静态侧只剩加载脚本（Python/其它语言），内核侧才是成品；取证还原以 `bpftool prog dump xlated` 为主
   - **手工字节码**: bpf_insn 数组或预编译 blob，无 ELF 元数据无 BTF——只能整体反汇编（lddw 双指令、偏移字段手工解）或从内核 dump
   - **运行期定位**: `sudo bpftool prog list` 列出全部已加载 prog（id/type/name/tag/map_ids/btf_id），核对样本特征（name/tag/加载时间）

2. **反汇编（静态与运行期双视角）**：
   - 静态: `llvm-objdump -d prog.o` —— 编译产物，符号与注释保留，利于快速通读逻辑
   - 运行期: `sudo bpftool prog dump xlated id <id> opcodes`（追加 `linum` 显示源码行信息）——verifier 处理后的真实执行形态
   - 双份并排对比：差异点即 verifier 重写点（上下文访问改写、map 访问内联、常量折叠等，见坑 2）
   - xlated 输出格式：`序号: (opcode十六进制) 指令`，例：`0: (b7) r0 = 0`、`4: (18) r1 = map[id:2]`、`6: (85) call bpf_tail_call#12`、`7: (15) if r0 == 0x0 goto pc+18`；`opcodes` 选项在每行下附原始字节
   - 指令集要点：8 字节定长（opcode/dst:src/16 位 off/32 位 imm）；r0 返回值、r1-r5 传参、r6-r9 被调用者保存、r10 帧指针只读；ALU32 用 w0-w9 寄存器（r0-r9 低 32 位，零扩展）；`call`（0x85）统一编码——imm 为 helper 调用号，bpf2bpf 子程序调用则以相对偏移 + src_reg 标记区分；lddw（0x18）占两条指令（第二条存高 32 位），src_reg 区分 map 指针/map 值地址/子程序地址等用途

3. **progs/maps 关联还原**：
   - 运行期: `prog list` 的 map_ids 字段给出 prog 引用的 map；xlated 中 `(18) r1 = map[id:N]`（需 kallsyms 可用，见坑 3）→ `sudo bpftool map show id N`（类型/key_size/value_size/max_entries/pinning）→ `sudo bpftool map dump id N`（部分类型支持；prog_array 可枚举尾调用目标链）
   - 静态: 从 `.maps` section 的 BTF 结构还原 map 定义（type/key/value/max_entries/pinning/flags），`.rel*` 段记录 map 引用点；运行期实例与静态定义按 name/id 关联
   - 注意共享关系：多 prog 共用一个 map（内核态收集、用户态读取）是常态，还原时按 map 聚合所有引用方

4. **hook 点识别**：
   - ELF 侧: section 名即 attach 目标（`kprobe/xxx`、`tracepoint/syscalls/sys_enter_*`、`fentry/<函数>`——fentry 系需要 vmlinux BTF）
   - 运行期侧: prog type 定 attach 大类（KPROBE/TRACEPOINT/RAW_TRACEPOINT/XDP/SCHED_CLS/CGROUP_*/LSM/TRACING 等），具体挂点用 `sudo bpftool net show`（tc/xdp 及网卡）、`sudo bpftool cgroup show`（cgroup 系）、`sudo bpftool link show`（fentry/fexit/kprobe 链接）确认
   - prog type 同时决定 verifier 允许的 helper 白名单与 ctx 语义（如 KPROBE 的 ctx 是 pt_regs、tracepoint 的 ctx 是事件结构体）——白名单直接约束了语义还原空间

5. **语义还原**：
   - helper: xlated 中 `call <名称>#<调用号>`，调用号对照运行内核版本的 `include/uapi/linux/bpf.h` 的 bpf_func_id 枚举查表（方法见坑 3）；调用约定 r1-r5 参数、r0 返回值
   - 数据面: map 内容（收集的数据）、perf ring buffer/trace_pipe 输出（helper 写出的记录）还原程序行为闭环
   - 恶意样本重点: 加载链（加载器 ELF/脚本 + 字节码如何进内核）、持久化（pin 到 /sys/fs/bpf、配套守护进程）、规避手法（hook 目标选择、fentry 前置/后置篡改）；内核语义交叉参考 [[re-kernel]]
   - 产出: 伪代码级说明（xlated 指令 → 函数语义）+ hook 点 + map 布局 + 行为结论

## 跨域联合

- [[re-kernel]]: helper 调用号到内核 API 的语义映射、xlated 中直接访问的内核结构体布局交叉
- [[re-tracing]]: 运行期系统调用/函数跟踪的互补视角——strace 覆盖不到的 skb/内核路径由 BPF 观测还原
- [[re-evasion]]: EDR 对抗——识别与分析驻留的 bpf hook（fentry/kprobe/tracepoint/cgroup），对抗侧手法联动
- [[re-sandbox]]: 加载/运行 BPF 样本强制前置（隔离 VM + 快照）
- [[re-ghidra]]: Ghidra 内置 eBPF 处理器反编译工作流
- [[re-format-elf]]: BPF ELF 的 section 解析底座（.maps/.BTF/.rel* 语义）
- [[re-malware]]: 恶意 eBPF 样本的完整分析流程（本技能承担字节码还原环节）
- [[re-blockchain]]: Solana 等链上 BPF 字节码（指令集同源、helper 表不同）
- [[re-variant]]: 同程序多版本/补丁的指令级对比
- 配套: [[re-binary-core]]（宿主加载器通用分析）、[[re-behavior]]（eBPF 驻留侧行为归纳）

## 常见坑与陷阱

- **helper 调用号随内核版本漂移**：现象——xlated 里 `call <名>#<号>` 的号与手上内核版本表对不上，或 bpftool 显示 `call unknown#<号>`（kptr_restrict=2 时显示 `bpf_unspec#0`）；原因——helper 号是 bpf_func_id 枚举序号，随内核版本增删漂移，且 bpftool 显示的 name 来自其编译时表（与运行内核可能不同版本）；对策——按版本查表：以运行内核源码 `include/uapi/linux/bpf.h` 的 bpf_func_id 枚举为准（bpftool 版本过旧时尤其要查源码）；`sudo bpftool feature probe` 列出该内核实际支持的 helper（按名，分 prog type）；kallsyms 关联（`/proc/sys/kernel/bpf_jit_kallsyms`=1、kptr_restrict=0）影响名称显示，号始终以内核源码为准
- **xlated 与源码不对应（verifier 重写）**：现象——xlated 指令数/顺序/常量与 llvm-objdump 结果明显不同；原因——xlated 是 verifier 处理后的形态：上下文访问改写（如 __sk_buff 改为 sk_buff 直接偏移）、map 访问内联（helper 调用替换为直接地址加载）、helper 内联为内核实现函数（如 `__htab_map_lookup_elem`）、常量折叠、不可达代码删除；bpf2bpf 子程序显示为 `call pc+X#<tag>` 相对调用；尾调用目标不在本 prog（藏在 prog_array map 里，xlated 只见 `bpf_tail_call`）；对策——以 xlated 为执行真相，静态反汇编仅作语义参考；用 `linum` 选项把源码行信息贴到 xlated 上对齐；尾调用链沿 prog_array map 的 fd 逐跳展开
- **BTF 缺失类型盲区**：现象——手写字节码/旧工具链产物没有 `.BTF`，map 布局、结构体偏移无从解析，Ghidra 里全是裸地址；原因——BTF 是类型信息的唯一权威来源（CO-RE 重定位也依赖它）；对策——从 xlated 的 ldimm64 目标与 STX/ST 指令的偏移常量反推布局；有 `.BTF` 时用 `bpftool btf dump file prog.o` 导出类型，vmlinux 侧用 `bpftool btf dump file /sys/kernel/btf/vmlinux` 对照结构体
- **map 与 prog 分离/生命周期**：现象——只 dump prog 不 dump map，行为链条断裂；prog 卸载后未 pin 的 map 即销毁，现场不留证据；原因——map 独立于 prog 存在（可多 prog 共享、可 pin 于 /sys/fs/bpf 持久化）；对策——分析现场先 `bpftool map show` + `prog list` 做全量快照，再逐 map dump；取证前把 pin 目录 /sys/fs/bpf 完整归档
- **无符号库函数匹配**：现象——剥离符号的加载器/字节码 blob 里，自实现的字符串/哈希/编码逻辑无任何符号可打；原因——BPF 程序无动态链接，所有逻辑内联在 prog 内；对策——按常量模式（字符串、magic 值、表基址）与行为指纹（与 helper 调用序列的组合形态）识别；对照同源加载器源码或常见模式库
- **CO-RE 重定位陷阱**：现象——静态读 ELF 里结构体字段偏移，与目标内核实际布局不符，语义还原错误；原因——CO-RE 程序（`.BTF.ext` 带重定位记录）的字段偏移是加载时由 libbpf 按目标内核 BTF 计算的，ELF 里的偏移只是占位；对策——结合目标内核版本的 vmlinux BTF 重算偏移，或直接以 xlated（已重定位后的最终偏移）为准
