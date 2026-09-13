# 系统识别指纹表

**用途**：从证据判断**目标属于哪个系统**。[[cross-system-models]] 解决"看到异常先怀疑什么"，本文件解决它前面的一步——**"我在看的是什么东西"**。

**判据来源**：本文件不引入新断言，判据全部取自本库已核验的技能分支（各分支文末的"工具与验证"节）。

## 判据的两维标注（重要）

**一条判据有"多独特"和"多容易看见"两个互相独立的属性**，混为一谈会直接把结论带偏：

| 维度 | 取值 | 含义 |
|---|---|---|
| **特异度** | `独有` | 只有该系统有 |
| | `高` | 少数系统共有，需配合排除 |
| | `弱` | 只能收窄到家族 |
| **可观测性** | `稳定` | 剥离符号后通常仍可见（结构内魔数、容器魔数、必需导出名） |
| | `视构建` | 取决于是否 strip / 是否保留字符串 / 配置是否随产物 |
| | `仅运行期` | 只能从运行中的系统、流量或运行时接口获得 |

**标注形如 `独有·稳定`。** 典型误用：把 `独有·视构建` 的判据（如模块名后缀）当成"一定能看到"，于是对一个 strip 过的产物得出"不是该系统"的错误结论——**看不见不等于不存在**。

## ⓪ 先定证据归属（evidence_scope）

**同一个字符串，归属不同的对象，指向完全不同的结论。**

| scope | 含义 | 典型来源 |
|---|---|---|
| `container` | 容器本身 | 固件封装、磁盘镜像、升级包 |
| `executable` | 当前正在分析的执行体 | 主二进制 |
| `embedded payload` | 容器内的嵌入载荷（**可能属于另一种系统**） | 固件里嵌的 rootfs、MCU blob |
| `guest` | 虚拟化/分区下的客体 | VM 镜像、分区镜像 |
| `dependency` | 被链接或依赖的组件 | 静态库、第三方 `.a`、sysroot |
| `toolchain artifact` | 工具链产物（不是运行时主体） | 编译器 sysroot、示例配置、调试符号 |
| `documentation` | 文档/注释/示例 | README、示例配置 |

**规则：先判"这条证据属于谁"，再判"它是哪个系统"。**

固件里同时存在 Linux rootfs、一个 MCU blob、一个 guest 镜像与编译期 sysroot 时，找到 `procnto`、ARXML、`seL4_*`、FreeRTOS 特征串中的**任何一个**，都**不能**回答"当前正在逆向的主体是什么系统"——**证据为真、归属错误**，是这类目标上最常见的翻车方式。

**做法**：

```
1. 列出容器内全部可辨认对象，逐个标 scope
2. 确定分析主体（用户的目标）属于哪个 scope
3. 只在【同 scope 内】做指纹比对
4. 跨 scope 的命中只记为"存在性"，不作为主体身份依据
```

**指纹表越丰富，这条越重要**：判据多了以后，跨 scope 的假命中会同步变多。

## 一、四层流程

```
① 载体与格式：我拿到的是什么（模块 / 镜像 / 配置 / 转储 / 流量）
② 超家族收敛：几条问题把它归到某一族
③ 家族内指认：按该族的表逐行排除
④ 易混淆对与负判据：命中易混对时按专项判据；用"看到 X 就不是 Y"收尾
```

**顺序不能颠倒**：先定 scope、再定格式、再定家族、最后定系统。跳过前几层直接猜系统，会得到一连串"似曾相识但都对不上"的结论。

## 二、超家族：载体与格式

| 载体 | 结论或下一步 |
|---|---|
| ELF 且类型为 **ET_REL** | **[弱·稳定]** 仅说明"这是**可重定位 ELF**"（内核模块常用此形态，但不止内核模块）→ 需再命中 `.modinfo` / `__this_module` / `vermagic` 一类符号，才升到"Linux 可加载内核模块" |
| ELF 可执行，`EI_OSABI` 非 0/3 | 按 §六 的 OSABI 表定系统 |
| ELF，带 `.note.openbsd.ident` / `.note.netbsd.ident` / `.note.tag`(FreeBSD) | **[独有·稳定]** 对应 BSD → §3.1 |
| PE32/PE32+，subsystem = EFI 相关 | UEFI 模块 → §3.6；否则 §3.1 Windows |
| PE，`.sys` 扩展、导出 `DriverEntry`/`GsDriverEntry` | Windows 驱动模型 → §3.1 |
| Mach-O（KEXT bundle / `.dext`） | macOS 家族 → §3.1 |
| 无标准容器，含 `0x00ff7eeb` + `"imagefs"` | **[独有·稳定]** QNX IFS 镜像 → §3.2 |
| 固件结构（FV → FFS → section） | UEFI/PI → §3.6 |
| XML 配置 + 分区/major frame 词汇 | 分区 hypervisor 或分区 RTOS → §3.4/§3.5 |
| C 源文件形式的配置（含 `struct config` 一类） | 静态分区 hypervisor → §3.5 |
| ARXML | AUTOSAR → §3.8 |
| 大量 EBCDIC 文本、记录式数据集 | 大型机 → §3.7 |
| 单一镜像，内含初始化表段与成套 `uk_*` 符号 | Unikraft → §3.9 |
| OCaml 源码 / Lwt 调用 | MirageOS → §3.9 |

## 三、家族内指认

### 3.1 UNIX / Windows 系内核与驱动

| 系统 | 载体与结构 | 判据 |
|---|---|---|
| **Linux** | `.ko` = ET_REL；可能带签名尾、livepatch 节、BTF/split BTF | `.modinfo` / `__this_module` / `vermagic` **[独有·稳定]**；`module_init` **[独有·视构建]** |
| **Android** | 同为 ELF 模块，受 KMI 约束 | ACK 分支串、KMI symbol list、protected symbol **[高·视构建]** |
| **FreeBSD** | `.ko`（KLD，ELF）；**linker set 注册** | `set_sysinit_set` / `__start_set_*` **[独有·视构建]**（strip 后不可见） |
| **NetBSD** | `.kmod` | `module_autoload` / `MODCTL_*` **[独有·视构建]** |
| **OpenBSD** | 内核每次 boot 被**重新随机链接**（KARL） | 用户态 `.note.openbsd.ident` **[独有·稳定]**；link kit / rc 重链接脚本 **[高·视构建]** |
| **illumos / Solaris** | `.so` 内核模块（DDI/DKI） | `_init`/`_fini`/`_info` + `modlinkage`/`modldrv`/`dev_ops`/`cb_ops` **[独有·稳定]**（必需导出）；`nulldev` 与 `nodev` 并存 **[独有·视构建]** |
| **macOS** | KEXT（Mach-O，AuxKC 内）/ DEXT（用户态） | `IOKitPersonalities` **[高·视构建]**、`__TEXT_EXEC` 段 **[独有·稳定]**、`Info.plist` **[独有·稳定]**（就绪于 bundle） |
| **Windows** | `.sys`（PE） | **先分驱动模型**：WDM（`DriverEntry` + `MajorFunction[]` **[独有·稳定]**）、KMDF（指向 `Wdf01000.sys` **[独有·视构建]**）、minifilter（`FltRegisterFilter` **[独有·视构建]**）、NDIS（`Miniport*`/`Ndis*` **[独有·视构建]**） |

### 3.2 capability / 用户态驱动型内核

| 系统 | 判据 | 结构线索 |
|---|---|---|
| **seL4** | `seL4_*` / `seL4_Call` **[独有·视构建]** | **capDL `.cdl`** 与 CAmkES ADL 价值高于符号表 |
| **Fuchsia / Zircon** | `zx_*` / `fidl_*` **[独有·视构建]** | 组件清单、bind rules 字节码、driver host 划分 |
| **Genode** | `session` / `ROM` / `IO_MEM` / `IO_PORT` / `IRQ` 服务名 **[高·视构建]** | init XML（`<route>` / `<start>`）**[独有·稳定]**（配置就在身边时） |
| **HelenOS** | `driver_ops_t` / `devman_driver_register` / `ddf_fun_*` **[独有·视构建]** | fibril（用户态协作调度）**仅运行期** |
| **Redox** | `:SCHEME_NAME` / SQE-CQE / `relibc` / `redox-rt` **[独有·视构建]** | initfs 与驱动目录 **[高·稳定]** |
| **Haiku** | 模块名以 `driver_v1` / `device_v1` 结尾 **[独有·视构建]**（**符号被剥离后未必可见**） | device_node 树、KDL |
| **MINIX 3** | 服务 label + endpoint、RS/SEF **[高·仅运行期]** | 用户态服务与 `REQ_*` 消息 |
| **Plan 9 / 9front** | 9P 消息（`Tversion`/`Tattach`/`Twalk`）**[独有·仅运行期]** | `/srv`、fid、每进程命名空间 |
| **HIC** | **自描述模块元数据**（UUID/版本/端点/资源/依赖/签名）**[独有·稳定]**；**入口页 IPC 形态** **[独有·仅运行期]** | 同特权级 + MMU 隔离；capability 记账有代际差异 |
| **QNX Neutrino** | `procnto` / `"imagefs"` / IFS 魔数 `0x00ff7eeb` **[独有·稳定]** | `io-*` / `devb-*` / `devc-*` **[高·视构建]**；`devnp-*.so` **[独有·视构建]** |

### 3.3 RTOS

| 系统 | 判据 | 结构线索 |
|---|---|---|
| **FreeRTOS** | `"FreeRTOS"` 串、`pxCurrentTCB`、`pxReadyTasksLists` **[独有·视构建]** | `pcTaskName`、栈填充 `0xa5` **[高·视构建]** |
| **ThreadX** | `tx_kernel_enter`、`_tx_thread_created_list` **[独有·视构建]** | **对象头魔数**（THRD `0x54485244`、QUEU、SEMA、MUTE、ATIM…）**[独有·稳定]** |
| **ThreadX Modules** | `txm_*`、`_txm_module_kernel_call_dispatcher` **[独有·视构建]** | **module preamble 必在模块第一个地址** **[独有·稳定]** |
| **RT-Thread** | `rt_thread_ready_priority_group`、`rt_thread_priority_table` **[独有·视构建]** | `rt_system_scheduler_start` |
| **Zephyr** | `DEVICE_DT_DEFINE` / `SYS_INIT` **[独有·视构建]** | devicetree + Kconfig **[高·视构建]**；iterable section **[独有·视构建]**；map 里的 `__init_PRE_KERNEL*` 段 |
| **NuttX** | `syscall.csv` / `drivers_early_initialize` **[独有·视构建]** | FLAT/PROTECTED/KERNEL 三种构建 **[高·仅运行期]**；upper/lower half **[独有·视构建]** |
| **VxWorks** | `tIdle` / `tRootTask` **[独有·视构建]** | `WIND_TCB` / `td_*` **[独有·视构建]**；`.out`（DKM）/ `.vxe`（RTP）**[独有·稳定]**；VSB/VIP **[独有·稳定]** |
| **RTEMS** | `CONFIGURE_INIT` / `Device_drivers` **[高·视构建]** | `confdefs.h` 构建期配置、`rtems_driver_address_table` **[独有·视构建]** |
| **eCos** | `CYG_*`、`cyg_hal_invoke_constructors`、`hal_vsr_table`、`CYG_ISR_CALL_DSR` **[独有·视构建]** | CDL、`mlt_*.ldi`、RedBoot、虚拟向量表 **[独有·视构建]** |
| **µC/OS（Micrium）** | `OSIntEnter` / `OSIntExit` / `OSSchedLock` **[独有·视构建]** | `OS_TCB`、`OS_TmrTask` |
| **TI SYS/BIOS** | `ti.sysbios.knl.*`、`Swi_*` / `Hwi_*` / `Task_*` **[独有·视构建]** | Hwi > Swi > Task 分层 **仅运行期** |
| **SAFERTOS** | `xMPUSetTaskRegions` 一类 **[高·视构建]**；与 FreeRTOS **同源但非同一份二进制** | ESM 的 ACP / OACP / 间接对象 ID **[独有·视构建]** |
| **CMSIS-RTX5** | `osRtxError*` / `RTX_Config.h` / `OS_SAFETY_FEATURES` **[独有·视构建]** | `osThreadZone` / 安全等级 / 线程看门狗 **[独有·视构建]** |
| **T-Kernel** | `tk_def_dev` / `tk_rea_dev` / `tk_wai_dev` **[独有·视构建]** | 三种执行上下文 **仅运行期** |
| **TOPPERS** | `act_tsk` / `sta_cyc` **[高·视构建]** | **先判家族**（ASP3 / HRP3 / FMP3 / HRMP3）**[高·视构建]** |
| **OSE / OSEck** | `hunt` / `attach` / `send` / `receive` / `SIGSELECT` **[独有·视构建]** | 信号队列附属于进程 **仅运行期** |
| **Nucleus** | `NU_Create_*` / `NU_Allocate_Partition` **[独有·视构建]** | `NU_PARTITION_POOL`（**别与空间隔离域混**） |

### 3.4 分区 / 安全 RTOS

| 系统 | 判据 | 结构线索 |
|---|---|---|
| **INTEGRITY / INTEGRITY-178** | ARINC 653 APEX 服务名 **[高·视构建]** | 空间/时间/资源三域；静态启动表 **[独有·视构建]** |
| **PikeOS** | **链接在固定地址的 APEX 服务表** **[独有·稳定]** | 三层：分区调度器 → system thread → guest 调度器 **仅运行期** |
| **ARINC 653 / VxWorks 653** | `major frame` / `partition window` / `SET_PARTITION_MODE` **[独有·视构建]** | 分区模式、采样端口 vs 队列端口 **仅运行期** |
| **Deos** | 三类调度模型并存（ARINC 653 + RMS + POSIX）**[独有·视构建]** | 跨核对齐时间窗 + 每核 scheduler、slack、SafeMC **[独有·视构建]** |

### 3.5 Hypervisor

**宿主侧厂商串**（CPUID 叶 0x40000000）：`KVMKVMKVM`、`Microsoft Hv`、`VMwareVMware`、`XenVMMXenVMM` —— **[独有·仅运行期]**。

| 系统 | 判据 | 结构线索 |
|---|---|---|
| **Xen** | XenStore 路径、`backend-id`、`ring-ref`/`event-channel` 键 **[独有·仅运行期]**；`/dev/xen/evtchn` **[独有·稳定]** | grant table / shared ring / event channel；`shared_info` 位掩码 |
| **Hyper-V / VMBus** | VMBus 总线、`netvsc` / `storvsc` **[独有·仅运行期]** | VSC/VSP、GPADL、SR-IOV 数据面切换 |
| **ACRN** | `IVSHMEM_ENABLED` / `IVSHMEM_REGION` / `acrn-dm`；`dm:/` 与 `hv:/` 前缀 **[独有·视构建]** | Service VM / pre-launched / post-launched 三层 |
| **Jailhouse** | `.cell` 配置 **[独有·稳定]**；控制台串 `Parking CPU n (Cell: ...)` **[独有·仅运行期]** | cell 描述符（内存区标志、PCI/IRQ 归属） |
| **Bao** | C 源配置 `struct config` / `shmemlist` / `vmlist` / `shmem_id` **[独有·视构建]** | CPU/内存/中断独占；vCPU 与 pCPU 1:1 |
| **XtratuM** | XM_CF XML（`<Partition>` / `<CyclicPlanTable>` / `<PortTable>`）**[独有·视构建]** | Plan 0 初始化 / Plan 1 维护；IPVI |
| **QNX Hypervisor** | shmem **工厂页**字段（`name`/`size`/`shmem`/`vector`/`status`）**[独有·视构建]** | 三层地址；vdev |
| **LynxSecure** | 判据薄：**内核里没有驱动与 I/O 栈**、无管理控制台入口 **[独有·仅运行期]** | 不可变 boot 分区；内核功能仅限三项职责 |
| **Quest-V** | 判据薄：**每 sandbox 一个 monitor**、VM-exit 极少、无全局时钟 **[独有·仅运行期]** | monitor 只在引导/故障/影子页表/建通道时介入 |

> **判据薄的两个系统**（LynxSecure / Quest-V）不以字符串定案——定案方式是**结构与行为**（见各自分支）。

### 3.6 固件与引导

| 系统 | 判据 | 结构线索 |
|---|---|---|
| **UEFI / PI** | PE32/PE32+ 且 subsystem 为 EFI 类；GUID 密集 **[独有·稳定]** | **FV → FFS file → section → PE32/TE**；HOB；`MODULE_TYPE`；PPI（PEI）vs Protocol（DXE）vs Runtime Services |

### 3.7 主机 / 大型机

| 系统 | 判据 | 结构线索 |
|---|---|---|
| **z/OS** | EBCDIC 文本 + 记录式数据集 + JCL **[高·稳定]** | load module / program object；TCB/SRB；AMODE/RMODE；XPLINK 与否 |
| **IBM i** | `库/对象` 限定名、`*PGM` / `*SRVPGM` / `*MODULE` 对象类型 **[高·仅运行期]** | 单一存储层；MI/TIMI/SLIC 层次；activation group |
| **OpenVMS** | **`ELFOSABI_OPENVMS` = 13** **[独有·稳定]**；DCL 命令文件 **[高·稳定]** | `.EXE` 镜像、`SYS$SHARE:`、逻辑名、AST / `$QIO`、RMS、描述符调用标准 |

### 3.8 车载软件

| 系统 | 判据 | 结构线索 |
|---|---|---|
| **AUTOSAR Classic** | ARXML + `Rte_*` 接口 **[独有·稳定]** | Runnable / RTEEvent / OS Task 映射；`E_OS_ACCESS`；BSW |
| **AUTOSAR Adaptive** | 三类 Manifest（Execution / Service Instance / Machine）**[独有·稳定]** | `ara::com`、Function Group State / Machine State、`Checkpoint`（PHM）、UCM 与 Persistency |

### 3.9 unikernel

| 系统 | 判据 | 结构线索 |
|---|---|---|
| **Unikraft** | `uk_*` 符号 + `uk_syscall_e_*` / `uk_syscall_r_*` 成对出现 **[独有·视构建]** | 初始化表段（构造/早期/平台/库/rootfs/系统/晚期）；Kconfig |
| **MirageOS** | OCaml 源码 + Lwt 调用 **[独有·稳定]** | 单一静态 ELF；设备接线来自构建期配置 |

## 四、易混淆对

| 容易混 | 分开的判据 |
|---|---|
| FreeRTOS / ThreadX / µC/OS / RT-Thread | 看对象头**魔数**（ThreadX 独有，且 strip 不掉）→ 再看唯一符号 |
| Zephyr / NuttX | 都有 Kconfig 风格构建；**Zephyr 有 devicetree + iterable section**；**NuttX 有 `syscall.csv` + upper/lower half** |
| VxWorks / QNX | `.out`/`.vxe` + `tIdle` vs **IFS 魔数 + `procnto` + `devnp-*.so`** |
| FreeBSD / NetBSD / OpenBSD | **linker set `set_*`** vs **`.kmod` + autoload** vs **KARL 重链接 + `.note.openbsd.ident`** |
| illumos / Linux | illumos 有 `_init`/`modlinkage`/`dev_ops`；**没有** `module_init`/`file_operations`；`nulldev` 与 `nodev` 是两个占位 |
| seL4 / Fuchsia / Genode | `seL4_*` + capDL vs `zx_*` + bind rules vs `session` + init XML |
| Jailhouse / Bao / XtratuM | `.cell` vs **C 源 `struct config`** vs **XM_CF XML** |
| ACRN / Xen | ACRN 有 Service VM 三层与 `dm:/` `hv:/` 前缀；Xen 走 XenStore 路径 + grant/event |
| QNX Neutrino / QNX Hypervisor | 前者是 resource manager 生态；后者有 `qvm` 配置与 shmem **工厂页** |
| MINIX 3 / Plan 9 / Redox | RS + endpoint vs 9P + `/srv` vs scheme + SQE/CQE |
| Haiku / BeOS | Haiku 模块名以 `driver_v1`/`device_v1` 结尾；**调试接口与文件系统 API 与 BeOS 不兼容** |
| HIC / Fuchsia | HIC 有**自描述模块元数据**与**入口页 IPC 形态**；Fuchsia 有 driver host 与 bind rules |
| z/OS / IBM i / OpenVMS | EBCDIC + 数据集 + JCL vs `库/对象` vs **`ELFOSABI=13`** + DCL |
| INTEGRITY / PikeOS / Deos / ARINC 653 | 都讲分区；**PikeOS 的 APEX 服务表链接在固定地址**、**Deos 三类调度模型并存**可作区分 |
| LynxSecure / Quest-V | 都"没有中央调度器"；前者是**不可变静态分区**，后者是**每 sandbox 一个 monitor** |

## 五、负判据（看到 X 就不是 Y）

| 看到 | 可以直接排除 |
|---|---|
| `set_sysinit_set` / `__start_set_*` | Linux（那是 FreeBSD 的 linker set） |
| `_init` + `modlinkage` + `dev_ops` | Linux、FreeBSD（那是 illumos/Solaris 的 DDI/DKI 骨架） |
| `0x00ff7eeb` + `"imagefs"` | 任何 Linux/BSD |
| `procnto` / `devnp-*.so` | 任何非 QNX 系统 |
| ARXML / `Rte_*` | 通用 RTOS 与桌面 OS |
| 大规模 EBCDIC 记录 | 任何 Unix 系 |
| `.cell` | Xen / ACRN / Bao / XtratuM |
| `struct config` + `shmem_id` | 除 Bao 外的 hypervisor |
| ThreadX 对象头魔数 | FreeRTOS / µC/OS / RT-Thread |
| `ELFOSABI` = 9 / 2 / 12 / 13 | 分别是 FreeBSD / NetBSD / OpenBSD / OpenVMS，**不要按"BSD 都差不多"处理** |

## 六、`EI_OSABI` 取值参照

NONE=0、HPUX=1、**NETBSD=2**、LINUX=3、HURD=4、86OPEN=5、**SOLARIS=6**、AIX=7、IRIX=8、**FREEBSD=9**、TRU64=10、MODESTO=11、**OPENBSD=12**、**OPENVMS=13**、NSK=14、ARM=97、STANDALONE=255。

- **note 段与 OSABI 是两套独立标识**：BSD 系的 note 更常见（见 §3.1），OpenVMS 走 OSABI=13
- 注：2000 年曾有 FREEBSD=4 / NETBSD=5 / OPENBSD=6 的提案，**与现行值不同**——本表按现行值
- OSABI 为 0（NONE）是常态，**不能反推"不是某个系统"**

## 七、指认流程（一页版）

```
0. 证据归属：容器内有哪些对象？各自 scope 是什么？主体是哪一个？
1. 载体与格式：PE / ELF(ET_REL?) / Mach-O / 无容器镜像 / 配置 / 转储 / 流量
2. ELF：先读 EI_OSABI 与 note 段 → 常常一步定系统
3. 无容器镜像：找魔数与签名串（IFS、固件卷、RTOS 特征串）
4. 有配置：配置格式本身就是强判据（.cell / XM_CF / ARXML / manifests / Kconfig+devicetree）
5. 符号与命名：逐行排除；命中易混对走 §四
6. 仍不定：
   ├─ 看"缺什么"：没有驱动与 I/O 栈？没有中央调度器？
   └─ 看运行期可见面：系统信息接口、调试器命令、调试接口类型
7. 定案后 → [[cross-system-models]] 查该系统的"正常异常"，再按 [[rerouting]] A 表进对应分支
```

## 八、使用注意

- **先定 scope 再定系统**：跨 scope 的命中只记"存在性"，不作主体身份依据（§⓪）
- **两维要分开看**：`独有·视构建` 的判据**看不见不等于不存在**——strip 过的产物上，缺判据不构成反证
- **`弱` 级判据必须组合**：如 ET_REL 只能收到"可重定位 ELF"，不能直接定 Linux
- **易混淆对的裁断优先于单条特征**：命中 §四 时按该行专项判据走
- **判不出不要硬判**：家族定下、系统未定，也好过猜一个系统然后整条分析链跑偏；此时按家族级分支（如 [[re-rtos]] 主文档）先推进
- 新增系统分支时，**同步往本表加一行**（判据须带两维标注与 scope 说明）
