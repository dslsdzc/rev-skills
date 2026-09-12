# Linux 平台分支：VMA / mmap-mprotect 追踪 / process_vm_readv

观测对象是**进程的 VMA（virtual memory area）**——Windows 的 VAD 在这里叫 VMA，但事件与读取路径完全不同。

## 一、VMA 枚举与信号

- 主线：`/proc/<pid>/maps`（或 `smaps`，含更细的统计）→ 筛可执行 VMA → backing-file/provenance 判断 → 线程 PC/栈归属 → dump
- `maps` 每行字段：`address perms offset dev inode pathname`
  - `perms` 四字符含义：`r` 读 / `w` 写 / `x` 执行 / `s` 共享 / `p` 私有（COW）
  - `pathname` 为**空 = 匿名映射**；无文件映射另显示为 `[heap]`、`[stack]`、`[vdso]`、`[anon:<名字>]`、`[anon_shmem:<名字>]`
- **高效查询**：Linux **6.11 起**提供 `PROCMAP_QUERY` **ioctl**（`struct procmap_query`，定义在 `linux/fs.h`），可按条件过滤单个 VMA，适合程序化扫描——比解析文本更稳（内核文档：`Documentation/filesystems/proc.rst`）
- **高价值信号**：
  - **匿名 `r-x` / `rwx` VMA**（无文件背书却可执行）
  - **`/memfd:<名字> (deleted)`** 或 "deleted" 的文件背书可执行映射（载体已从文件系统消失）
  - **正常 ELF 映射的内容与磁盘上的 ELF 不一致**（代码被改写/替换，对应 Windows 的 module stomping）
  - **heap/匿名 VMA 事后变为可执行**（W→X 转换）
  - **线程 PC/RIP 落进这些区域**；**栈上的返回地址指向这些区域**
- |注意：**"匿名可执行"是 signal，不是 verdict**——JIT（JVM / V8 / Mono）、Wine/Proton、QEMU TCG 都产生这类 VMA；要看 provenance 与执行史（见本节末）

## 二、动态侧（trigger）：不要只 hook libc

- 只 hook `libc` 的 `mmap()` / `mprotect()` 会被**直系统调用**绕过
- 更底层的事件源：
  - **syscall tracepoint / kprobe**（`bpftrace`、`perf`）——直接看 `mmap`/`mprotect`/`memfd_create` 等系统调用
  - **BPF LSM**——把 BPF 程序挂到 LSM hook 上；内核 BPF LSM 文档（`Documentation/bpf/bpf_lsm.rst`，新版为 `prog_lsm.rst`）**正是拿 `file_mprotect` 作示例**：
    `int file_mprotect(struct vm_area_struct *vma, unsigned long reqprot, unsigned long prot);`，示例程序 `SEC("lsm/file_mprotect")` 在命中时返回 `-EPERM`（即可审计、也可拦截）
  - 可挂 hook 的清单见内核 `include/linux/lsm_hooks.h`（新版在 `security/security.c`）；挂载用 `BPF_RAW_TRACEPOINT_OPEN` 或 libbpf `bpf_program__attach_lsm`；需特权（文档提到 `CAP_MAC_ADMIN` 与 `CAP_SYS_ADMIN`）
  - 采集侧只需要 **executable protection transition** 这类事件作 trigger，落点即 dump 时机（见 [[re-ebpf]] 的 eBPF 侧细节）

## 三、执行上下文归属

- 线程：枚举 `/proc/<pid>/task/`；读 `stat`/`status` 得到状态与位置线索；对可疑线程做栈回溯（gdb/`eu-stack`）取返回地址
- 判据：线程 PC 或栈上返回地址落在**匿名/已删除背书的可执行 VMA** 内

## 四、Dump

- **`process_vm_readv()`**：跨进程地址空间读取，直接按 [基址, 长度] 取区域；权限受 **ptrace access check** 约束（含 Yama `ptrace_scope`，见 [[re-memdump]] 坑）
- 其他路径：`ptrace`（`PTRACE_ATTACH` + `PTRACE_PEEKDATA`/`process_vm_readv`）、`gcore`（整进程 core，注意它是单进程镜像不是整机镜像）、`/proc/<pid>/mem`（同样受 ptrace 权限约束）
- Linux 的可执行格式是 ELF：**擦头/无头的载荷同样存在**——保存整区后按内容分类（完整 ELF / 手工映射 ELF / 裸 shellcode / JIT code / 解密 blob）
- **内存 vs 磁盘 diff**：`/proc/<pid>/maps` 给出 backing 路径的，取磁盘副本与内存内容逐页/摘要比对（发现代码被替换）；配 `[[re-variant]]` 思路做差异定位

## 五、误报与白名单

- 白名单/降权：JVM、V8/Node、Mono/.NET、Wine/Proton、QEMU TCG、解释器生成的 trampoline、安全软件自身的探针
- 评分与 Windows 分支同构：匿名可执行 + 线程 PC/栈命中 + 近期 W→X + 内容熵/ELF 特征 + 无已知运行时来源

## 工具与验证

- 基础：`cat /proc/<pid>/maps`（验证能看到 address/perms/pathname 三段）；`smaps` 看 `Rss`/`Private_Dirty` 等
- 事件：`bpftrace -l 'tracepoint:syscalls:*mprotect*'` 应与目标内核实际提供的 tracepoint 对得上；BPF LSM 需内核 `CONFIG_BPF_LSM` 与 BTF（验证 `ls /sys/kernel/btf/vmlinux`）
- 采集：`python3 -c "import ctypes; ..."` 或直接用 gdb `dump memory` 验证 `process_vm_readv` 路径可达

## 该平台的坑

- **只 hook libc 就以为覆盖**：直系统调用绕过——用 tracepoint/kprobe 或 BPF LSM
- **把 VMA 当 VAD 直接翻译**：Linux 没有"模块链与 VAD 交叉"那套（模块 = 文件背书映射），替代物是 maps 的 pathname/inode 与磁盘文件比对
- **`process_vm_readv` 报 EPERM**：先看 Yama ptrace_scope 与目标进程关系（[[re-memdump]] 坑），不要误判为载荷消失
- **把匿名可执行当恶意**：JIT/Wine/TCG 大量产生——先基线、再评分

## 六、内核态载荷（LKM / rootkit）的采集

用户态扫描看不到的内核态载荷，采集逻辑与用户态同构但要换观测面（分析方法见 [[re-kernel]] 的 Linux 分支）：

- **cross-view 是前提**：`lsmod` / `/proc/modules` 干净**不构成结论**（rootkit 可把模块从链表摘掉，模块仍在运行）。交叉比对：
  - 模块视图：`/proc/modules`、`/sys/module/<name>/`
  - 符号视图：`/proc/kallsyms`（受 `kptr_restrict` 影响）
  - 节地址视图：`/sys/module/<name>/sections/`
  - 内核可执行内存区间（离线镜像侧见 [[re-mem-forensics]]；在线侧需要内核态手段，属授权场景）
  - 视图互相矛盾时，**优先信任离线内存取证**，而不是被分析系统自己给出的输出
- **inline text patch 的发现**：内核 text 与磁盘 `vmlinux` / 模块副本逐段比对（函数头被改写但地址不变——与用户态的 inline hook 同构）
- **hook 落点不止 syscall table**：`file_operations`、`seq_operations`、proc handlers、网络协议回调、ftrace、kprobes 都被用过——"syscall table 干净"不是结论
- **采集时机**：内核态载荷同样有"用后清除"（模块自卸、hook 复原）——命中即 dump
- 授权边界：内核态采集通常需要加载自己的模块 / 用 kprobe 一类机制，**只在自有或已授权设备上做**，并记录停止条件
