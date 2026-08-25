# strace / ltrace 工具特有坑与边界

## 进程树与附加

- **不加 -f 丢子进程**：fork/clone 后子进程行为全部丢失——`-f` 是标配；daemon 化（double-fork + setsid）目标尤其依赖
- **attach 权限与限制**：`-p` 需要与目标同权限（ptrace 权限）；跨 PID namespace（容器内 attach 宿主进程）直接拒绝；`/proc/sys/kernel/yama/ptrace_scope=1` 时非父进程 attach 失败（调 0 或保持同会话）
- **attach 时机盲区**：attach 之前的调用不可见——注册/初始化逻辑用启动模式重跑，或先静态定位断点（[[re-ida]] / [[re-binary-core]]）
- **多线程目标**：`-f` 隐含跟踪所有线程；输出按线程交错，`-e trace-fds=` 可精细到 fd

## 输出与过滤

- **输出体积失控**：不过滤时 GB 级日志拖垮磁盘——白名单 + `-o` 文件；只要结论时直接 `-c` 汇总
- **字符串截断**：默认 32 字节——路径/URL/加密参数被截断，`-s 200` 起步
- **`-e trace=` 类别名写错**：不存在的类别/调用名报 "invalid system call"（strace 会把整串当调用名解析）——类别用文档列出的 file/process/network/signal/ipc/memory/desc/read/write
- **新内核新调用解码缺失**：内核 6.x+ 的新系统调用在旧 strace 上显示为原始数字/名字——升级 strace 或查内核头文件补语义

## 反调试对抗

- **ptrace 自检测冲突**：样本对自己或子进程执行 ptrace(PTRACE_TRACEME) 与调试器冲突——表现为 strace 挂起/无输出/样本直接退出；对策：静态定位检测点（[[re-anti-analysis]]），或只跟踪关键路径
- **注入机制痕迹**：strace/ltrace 的注入可被 /proc/self/maps 枚举——检测到后行为跳变是常态，别把污染后的输出当真
- **时序破坏**：每调用开销放大，时序校验（自计时/rdtsc）目标会误判——时间敏感目标用 Intel PT（`perf record -e intel_pt`）或轻量 BPF（[[re-ebpf]]）替代

## ltrace 局限

- **只跟踪 PLT 层**：dlopen 后加载的库函数需要 `-l` 显式指定；静态链接程序无 PLT——ltrace 无输出，换 strace
- **无调试符号时参数语义不明**：参数显示为寄存器/裸指针——配合 `-i`（指令指针）+ 反汇编对照确认语义
- **维护滞后**：新 glibc 内部函数（如 malloc 变体）可能显示为地址而非名字——个别乱码不阻塞流程，语义靠 `-i` + 反汇编补

## macOS（dtruss）差异

- SIP 限制：系统签名进程（大部分 /usr/bin 与系统守护）dtruss 拒绝跟踪或权限失败——先拿普通用户态程序验证命令可用性
- 需要 root：`sudo dtruss`；无 Xcode CLT 时无 DTrace 工具链

## 版本差异

- **strace 7.x（当前主线）**：seccomp-bpf 为 opt-in（5.3 起，`--seccomp-bpf` 显式启用，与 `-p` attach 不兼容）；6.4 起指定 `--syscall-limit` 时自动关闭 seccomp-bpf 路径
- **ltrace 0.8.x**：长期小步维护，选项稳定（-e/-l/-S/-c/-i/-w）；与 0.7.x 差异主要在输出格式细节
- **发行版打包差异**：RHEL 系偏旧（strace 5.x 常见，无 6.x 新选项）——新选项不存在时按本机 help 为准
- **内核侧配置影响**：Yama ptrace_scope、seccomp 策略影响 attach 与跟踪能力——行为怪异先查内核配置

## 使用注意

- 全部在沙箱内执行（[[platform-tips]] 最高原则）
- trace 日志作为证据：路径 + sha256 + 时间戳入档（[[re-triage]]），结论写 [[analysis-contract]]
