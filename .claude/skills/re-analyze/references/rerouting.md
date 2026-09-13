# 中途再路由触发表

运行时证据触发的唯一事实源（区别于 triage.md 的入口「目标→路径」决策表）。分析过程中按双轨使用：

- **轨 1（网关完成必查）**：每网关完成后对照 A/B 表检查新证据
- **轨 2（证据出现即查）**：每产出新证据类型（字符串/节表/行为/加密特征）立即对照 A 表
- **未命中** → 按 B 表约束行动，禁止自行硬琢磨

**A 表按能力匹配**：证据特征先映射到「需要能力」，再经 `capability-index.md` 反查提供该能力的技能——技能列是索引结果，不是领域名硬编码；`npm test` 校验「能力列标签在注册表内」且「本行技能确实声明了该能力」。

## A 表：证据特征 → 需要能力 → 触发技能

| 证据特征（分析中看到） | 需要能力 | 触发技能（索引反查） |
|---|---|---|
| 节表异常（UPX0/.aspack）、熵 >7.0 | `unpack` | [[re-packer-id]] → [[re-anti-analysis]] |
| 未知加密算法、S-box/常量指纹、加密流量 | `crypto-identification` | [[re-crypto-id]] |
| 硬编码密钥/口令、内存中的 key | `key-extraction` | [[re-crypto-keys]] |
| 解密函数已定位、密文可还原 | `crypto-decryption` | [[re-crypto-decrypt]] |
| 反调试/反 VM 特征（ptrace、CPUID、时间检测） | `evasion-analysis` | [[re-anti-analysis]] / [[re-evasion]] |
| 动态注册 JNI、so 函数级加密 | `jni-analysis` | [[re-android-native]] |
| 混淆（CFF/花指令/字符串加密） | `deobfuscation` | [[re-deobfuscate]] |
| 网络回连/信标/C2 特征 | `network-capture` | [[re-netcap]] → [[re-behavior]] |
| 持久化/注入/进程树异常 | `malware-behavior` | [[re-behavior]] |
| 崩溃/段错误/ASAN 报告 | `debugging` | [[re-crash-triage]] |
| Python 打包特征（PyInstaller/PyArmor） | `bytecode-parser` | [[re-python]] |
| 加固商特征（Android 加固壳） | `unpack` | [[re-mobile-pack]] |
| RTTI/异常表（.pdata/.xdata）密集 | `decompilation` | [[re-cpp-abi]] |
| PDF/Office 宏/钓鱼文档特征 | `document-malware` | [[re-doc-malware]] |
| 补丁/N-day 对比需求（修复前后/变体） | `binary-diffing` | [[re-variant]] |
| 文件尾附加/图片异常（隐写怀疑） | `stego-detection` | [[re-stego]] |
| 白盒加密特征（大查表 + 编码网络） | `crypto-identification` | [[re-whitebox]] |
| 内核驱动/rootkit 结构 | `kernel-analysis` | [[re-kernel]] |
| 内存区被改成可执行（W→X / RWX）、无背书区域在执行 | `sample-acquisition` | [[re-sample-acquire]] |
| 服务端动态注册的组件无对应类文件（内存马特征） | `sample-acquisition` | [[re-sample-acquire]] → [[re-java]] |
| 整机内存镜像（LiME/崩溃转储） | `memory-forensics` | [[re-mem-forensics]] |
| 磁盘镜像/未分配空间/分区表异常 | `disk-forensics` | [[re-disk-forensics]] |
| 越狱检测/tweak（dylib 注入）特征 | `jailbreak-analysis` | [[re-ios-jb]] |
| Flutter/RN 引擎特征 | `hybrid-app-analysis` | [[re-hybrid-app]] / [[re-flutter]] |
| Go buildinfo/pclntab 特征 | `lang-runtime-analysis` | [[re-go]] |
| Rust/Swift/Zig/Nim 产物特征 | `lang-runtime-analysis` | [[re-rust]] / [[re-swift]] / [[re-zig]] / [[re-nim]] |
| MMIO 外设区 + Thumb 特征（嵌入式裸机固件） | `arch-analysis` | [[re-arm]] |
| RISC-V 压缩指令/MIPS 延迟槽特征 | `arch-analysis` | [[re-riscv]] / [[re-mips]] |
| VT-x/SVM 指令（VMXON/VMREAD）或 VMCS 结构 | `hypervisor-analysis` | [[re-hypervisor]] |
| BPF ELF section（.maps/.BTF/.rel*，kprobe/tracepoint 命名节） | `ebpf-analysis` | [[re-ebpf]] |
| VxWorks/QNX 特征串（任务表符号/内核对象命名） | `rtos-analysis` | [[re-rtos]] |
| 进程注册了 pathname 并循环收消息、无内核模块却控制硬件 | `rtos-analysis` | [[re-rtos]]（QNX 资源管理器模型） |
| 驱动既不是独立进程也不是内核模块（在网络栈进程内加载） | `rtos-analysis` | [[re-rtos]] → [[re-rtos/qnx]] |
| init/设备对象没有直接 xref、一段规则排列的结构体（链接期注册） | `rtos-analysis` | [[re-rtos/zephyr]] |
| 独立模块大量 unresolved symbols、同版本系统之间行为不一致 | `rtos-analysis` | [[re-rtos/vxworks]] |
| dlopen 语义不像 Unix 共享库、设备分派看不到 file_operations | `rtos-analysis` | [[re-rtos/rtems]] |
| 跨阶段数据结构找不到 producer、runtime 地址与固件地址对不上 | `uefi-analysis` | [[re-uefi/pi-stages]] |
| handle 数值跨进程比对无效、传送后原值失效、同驻驱动有 IPC 无系统调用 | `kernel-analysis` | [[re-kernel/zircon-kernel]] |
| init 函数没有调用者、一段指针数组所在 section 名为 set_* | `kernel-analysis` | [[re-kernel/freebsd-kernel]] |
| 驱动入口为 _init/_fini/_info + modlinkage/dev_ops/cb_ops 骨架 | `kernel-analysis` | [[re-kernel/illumos-kernel]] |
| 同版本内核每次启动布局都不同、两份二进制逐字节不一致 | `kernel-analysis` | [[re-kernel/openbsd-kernel]] |
| 模块自己出现/消失却没有加载者、模块加载失败但文件正常 | `kernel-analysis` | [[re-kernel/netbsd-kernel]] |
| 服务名相同却像连到不同对象、capability 数值被当全局 ID、配额与系统剩余内存矛盾 | `kernel-analysis` | [[re-kernel/genode]] |
| 驱动进程消失又出现、IPC 里的整数疑似 grant、更新期出现两个相同实例 | `kernel-analysis` | [[re-kernel/minix3]] |
| 同名路径访问到不同对象、目录内容像多层叠加、出现不依赖内核模块的新文件系统 | `kernel-analysis` | [[re-kernel/plan9]] |
| PV 设备找不到寄存器窗口、grant ref/event-channel port 被当地址与 IRQ | `hypervisor-analysis` | [[re-hypervisor/xen]] |
| guest 的 MMIO/BAR 与真实硬件对不上、跨 VM 共享区通不了、越权访问后程序突然停住 | `hypervisor-analysis` | [[re-hypervisor/qnx-hypervisor]] / [[re-hypervisor/jailhouse]] / [[re-hypervisor/acrn]] / [[re-hypervisor/bao]] |
| 同一 API 在不同样本里形态完全不同（极短函数 + 立即 trap）、地址权限时有时无 | `rtos-analysis` | [[re-rtos/nuttx]] |
| ISR 里混用 task 版 API、访问权限随运行阶段变化（MPU） | `rtos-analysis` | [[re-rtos/freertos-context]] |
| 大量「填 request ID → 跳公共 dispatcher」、代码地址落在模块内存区之外 | `rtos-analysis` | [[re-rtos/threadx-modules]] |
| ISR 只清状态位就返回、没有线程入口却被反复调用的函数 | `rtos-analysis` | [[re-rtos/ecos]] |
| 高优先级线程不运行且无竞争、采样/队列语义混淆、固定地址的 APEX 服务表 | `rtos-analysis` | [[re-rtos/partitioned-rtos]] |
| 无 caller 的 runnable、隐式访问读到旧值、服务返回 E_OS_ACCESS | `automotive-analysis` | [[re-automotive/autosar-classic]] |
| 二进制已安装但进程不存在、进程清单与模型清单对不上 | `automotive-analysis` | [[re-automotive/autosar-adaptive]] |
| 一个 OS thread 内出现大量"线程切换"（内核调度对不上） | `kernel-analysis` | [[re-kernel/helenos]] |
| read/write 落到的东西不是文件系统、两侧句柄对不上 | `kernel-analysis` | [[re-kernel/redox]] |
| 驱动启动时不在、访问某设备后才出现 | `kernel-analysis` | [[re-kernel/haiku]] |
| 执行地址属于另一个地址空间、无调用者的例程却有行为 | `kernel-analysis` | [[re-kernel/zos]] / [[re-kernel/openvms]] |
| 对象地址不像 DRAM 指针、存储抽象与 POSIX 不符 | `kernel-analysis` | [[re-kernel/ibmi]] |
| 找不到 user→syscall→kernel 边界、syscall 没有特权切换 | `kernel-analysis` | [[re-kernel/unikraft-mirageos]] |
| 中断尾部发生切换、task 就绪不切换、ISR 里调用未立即生效 | `rtos-analysis` | [[re-rtos/ucos-sysbios]] / [[re-rtos/safertos-rtx5]] |
| 同一地址在不同 task 下可访问性不同、句柄不像指针 | `rtos-analysis` | [[re-rtos/safertos-rtx5]] |
| 服务调用在任务里合法、在中断里被拒 | `rtos-analysis` | [[re-rtos/tkernel-toppers]] |
| 消息/信号的对端找不到（疑似跨节点） | `rtos-analysis` | [[re-rtos/ose-oseck]] |
| 小整数句柄被当地址、网络流量中途消失但功能正常 | `hypervisor-analysis` | [[re-hypervisor/hyperv-vmbus]] |
| 找不到资源分配的重配置代码、计划切换不立即生效 | `hypervisor-analysis` | [[re-hypervisor/xtratum]] |
| VM-exit 很少却没有隔离缺失、跨域时间戳对不上 | `hypervisor-analysis` | [[re-hypervisor/lynxsecure-questv]] |
| 二进制在但进程不存在、服务发现空结果、无 crash 却重启、更新后数据保留或消失 | `automotive-analysis` | [[re-automotive/autosar-adaptive]] |
| 线性地址下仍有隔离、同一地址权限随任务变、"partition" 一词含义不明 | `rtos-analysis` | [[re-rtos/nucleus]] |
| 软件定时器回调里出现阻塞等待、任务被唤醒却没有资源 | `rtos-analysis` | [[re-rtos/ucos-sysbios]] |
| 小整数句柄被当地址、删除句柄时阻塞、回调返回但资源未释放 | `hypervisor-analysis` | [[re-hypervisor/hyperv-vmbus]] |
| ring 前进却没有通知、event unmask 行为异常、迁移后端口与 domid 变化 | `hypervisor-analysis` | [[re-hypervisor/xen]] |
| 同一源码在不同构建下 I/O 完全不同、全部任务一起卡死 | `kernel-analysis` | [[re-kernel/unikraft-mirageos]] |
| 模块带自描述元数据（UUID/端点/资源/依赖/签名）、IPC 呈入口页+位图+失败分支形态 | `kernel-analysis` | [[re-kernel/hic]] |
| .NSO/.NPDM 容器结构（Switch 加密分区） | `console-analysis` | [[re-console]] |
| asar 结构（resources/app.asar + 内部 files 树） | `electron-analysis` | [[re-electron]] |
| CAP 内 Header 组件魔数（DE CA FF ED，文件整体为 ZIP，Java Card 12 组件） | `bytecode-parser` | [[re-javacard]] |
| HarmonyOS hap/hsp 包结构、ArkTS .abc 字节码 | `bytecode-parser` | [[re-harmonyos]] |

## B 表：卡住信号 → 换路

| 卡住信号 | 换路 |
|---|---|
| 同参数重复 ≥2 次无新证据 | 对照 A 表重查 / 换工具视角（[[analysis-contract]] 调查预算） |
| 单命令 ≥3 次无进展 | 停下评估，重跑 re-analyze 第二步（任务识别）或换网关 |
| 分析跨目标累计超 30 次工具调用无结论 | 回退到最近有产出的环节，按 [[analysis-contract]] 复核格式交付部分结论 |
| 目标行为与静态结论矛盾 | 动态侧 [[re-sandbox]] / [[re-tracing]] 对照 |
| A 表命中的技能不适用（如目标形态不符） | 查 `capability-index.md` 同一能力下的其他技能（能力相同、形态不同） |

## 使用规则

1. 每产出新证据类型 → 查 A 表，命中即调用对应技能，完成后回到轨 1 继续
2. 每网关完成 → 查 A+B 表
3. 未命中任何表项 → 按 B 表约束行动（换思路/回退/交付部分结论）
4. 新增 A 表行时：先定「需要能力」（注册表标签），再用 `capability-index.md` 反查技能填入——**不要只写领域名技能**（`npm test` 会校验能力与技能声明是否对得上）
