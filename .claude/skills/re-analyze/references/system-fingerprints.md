# 系统识别指纹表

**用途**：从证据判断**目标属于哪个系统**。[[cross-system-models]] 解决"看到异常先怀疑什么"，本文件解决它前面的一步——**"我在看的是什么东西"**。

**判据来源**：本文件不引入新断言，判据全部取自本库已核验的技能分支（各分支文末的"工具与验证"节）。标注 **[强]** 的是唯一性判据，可单独定案；**[弱]** 的需组合使用。

## 一、五层流程

```
① 载体与格式：我拿到的是什么（模块 / 镜像 / 配置 / 转储 / 流量）
② 超家族收敛：几条问题把它归到某一族
③ 家族内指认：按该族的表逐行排除
④ 易混淆对：命中易混对时按专项判据分开
⑤ 负判据：用"看到 X 就不是 Y"做排除
```

**顺序不能颠倒**：先格式、再家族、最后系统。跳过前两层直接猜系统，会得到一连串"似曾相识但都对不上"的结论。

## 二、第一层：载体与格式

| 载体 | 直接结论或下一步 |
|---|---|
| PE32/PE32+，subsystem = EFI 相关 | UEFI 模块 → 进 §3.6；否则 §3.1 Windows |
| PE，`.sys` 扩展、导出 `DriverEntry`/`GsDriverEntry` | Windows 驱动模型 → §3.1 |
| **ELF 但类型是 ET_REL** | **[强]** Linux 内核模块（`.ko`）或同类可重定位模块 → §3.1 |
| ELF 可执行，带 `ELFOSABI` 非 0/3 | 按 §5 的 OSABI 表定系统 |
| ELF，带 `.note.openbsd.ident` / `.note.netbsd.ident` / `.note.ABI-tag`(**FreeBSD**) | **[强]** 对应 BSD → §3.1 |
| Mach-O（含 KEXT 的 bundle 结构 / `.dext`） | macOS 家族 → §3.1 |
| 无标准容器、有 `0x00ff7eeb` + `"imagefs"` | **[强]** QNX IFS 镜像 → §3.2 |
| 固件结构（FV → FFS → section） | UEFI/PI → §3.6 |
| XML 配置文件 + 分区/major frame 词汇 | 分区 hypervisor 或分区 RTOS → §3.4/§3.5 |
| C 源文件形式的配置（含 `struct config` 一类） | 静态分区 hypervisor → §3.5 |
| ARXML | AUTOSAR → §3.8 |
| 大量 EBCDIC 文本、记录式数据集 | 大型机 → §3.7 |
| OCaml 源码 / Lwt 调用 | MirageOS → §3.9 |
| 单一镜像，内含 `uk_*` 符号与初始化表段 | Unikraft → §3.9 |

## 三、第二层 + 第三层：家族内指认

### 3.1 UNIX / Windows 系内核与驱动

| 系统 | 载体与结构 | 字符串与符号 | 配置与清单 |
|---|---|---|---|
| **Linux** | `.ko` = ET_REL；可能带签名尾、livepatch 节、BTF/split BTF | `__this_module`、`module_init`、`.modinfo`、`vermagic` | Kconfig、`modules.dep`、`modprobe.d` |
| **Android** | 同为 ELF 模块，但受 KMI 约束 | **ACK 分支串**（如 `android12-5.10` 一类）、KMI symbol list、protected symbol 标记 | `modules.load`、`vendor_boot` / `vendor_dlkm` / `odm_dlkm` / `system_dlkm` 分区 |
| **FreeBSD** | `.ko`（KLD，ELF）；**linker set 注册** | **[强]** `set_sysinit_set` 与 `__start_set_*` / `__stop_set_*`；`SYSINIT`/`SYSUNINIT` | `kldload`、`/boot/kernel`、`loader.conf` |
| **NetBSD** | `.kmod` | `module_autoload`、`MODCTL_*`、`noautoload` | `/stand/<架构>/<版本>/modules` **或** `<内核目录>/modules`（KERNEL_DIR 布局，两者并存） |
| **OpenBSD** | 内核每次 boot 被**重新随机链接**（KARL），无传统可加载模块生态 | 用户态带 `.note.openbsd.ident`；`ELFOSABI_OPENBSD` | link kit、rc 中的重链接脚本 |
| **illumos / Solaris** | `.so` 内核模块（DDI/DKI） | **[强]** `_init`/`_fini`/`_info` + `modlinkage`/`modldrv`/`dev_ops`/`cb_ops`；`nulldev` 与 `nodev` 并存 | `add_drv`、`/kernel/drv`、driver.conf |
| **macOS** | KEXT（Mach-O，AuxKC 内）/ DEXT（用户态） | `IOKitPersonalities`、`OSMetaClass`、`__TEXT_EXEC`、`__PRELINK` 一类段 | `Info.plist`、`kmutil`、Kernel Collection、UAKL |
| **Windows** | `.sys`（PE） | **先分驱动模型**：WDM（`DriverEntry`+`MajorFunction[]`）、KMDF（指向 `Wdf01000.sys`）、UMDF、minifilter（`FltRegisterFilter`）、NDIS（`Miniport*`/`Ndis*`）、StorPort、AVStream/PortCls | INF、服务注册项 |

### 3.2 capability / 用户态驱动型内核

| 系统 | 强判据 | 结构线索 |
|---|---|---|
| **seL4** | `seL4_*` 符号、`seL4_Call`、`seL4_DebugCapIdentify` | **capDL `.cdl`** 与 CAmkES ADL 是最有价值的 artifact；capDL 常比符号表更有信息量 |
| **Fuchsia / Zircon** | `zx_*` syscall、`fidl_*` | 组件清单（`.cm`）、**bind rules 字节码**、driver host 划分 |
| **Genode** | `session`、`ROM` / `IO_MEM` / `IO_PORT` / `IRQ` 服务名 | init 的 XML 配置（`<route>` / `<start>`）；capability 是 PD 局部命名 |
| **HelenOS** | `driver_ops_t`、`devman_driver_register`、`ddf_fun_*` | **fibril**（用户态协作调度）；devman 按 match id 评分 |
| **Redox** | `:SCHEME_NAME`、SQE/CQE、`relibc`、`redox-rt` | initfs 与 `/usr/lib/drivers`；scheme daemon |
| **Haiku** | **[强]** 模块名以 `driver_v1` / `device_v1` 结尾 | device_node 树；KDL；BeOS 兼容是单向的 |
| **MINIX 3** | 服务 label + endpoint、RS/SEF | 用户态服务与 `REQ_*` 消息 |
| **Plan 9 / 9front** | **[强]** 9P 消息（`Tversion`/`Tattach`/`Twalk`/`Rclunk`） | `/srv` 服务注册、fid、每进程命名空间 |
| **HIC** | **自描述模块元数据**（UUID/版本/端点/资源/依赖/签名）+ **入口页 IPC 形态**（入口页 → 位图测试 → 失败分支 → 跳业务页） | 同特权级 + MMU 隔离的进程模型；capability 记账存在代际差异 |
| **QNX Neutrino** | **[强]** `procnto`、`"imagefs"`、IFS 头魔数 `0x00ff7eeb` | `io-*` / `devb-*` / `devc-*` 命名、`devnp-*.so`（io-pkt）、`resmgr_attach`/`dispatch_*` |

### 3.3 RTOS

| 系统 | 强判据（符号/魔数） | 结构线索 |
|---|---|---|
| **FreeRTOS** | `"FreeRTOS"` 串、`pxCurrentTCB`、`pxReadyTasksLists` | `pcTaskName` 定长数组；栈填充 `0xa5`；`xTaskCreate` / `vTaskStartScheduler` |
| **ThreadX** | `tx_kernel_enter`、`_tx_thread_created_list` | **[强]** 对象头魔数：TX_THREAD `0x54485244`('THRD')、TX_QUEUE 'QUEU'、TX_SEMAPHORE 'SEMA'、TX_MUTEX 'MUTE'、TX_TIMER 'ATIM' 等（旧资料里的 TIMR/EVEN 不实） |
| **ThreadX Modules** | `txm_*`、`_txm_module_kernel_call_dispatcher` | **module preamble** 必在模块第一个地址；request ID + 公共 dispatcher |
| **RT-Thread** | `rt_thread_ready_priority_group`、`rt_thread_priority_table` | `rt_thread_create` / `rt_system_scheduler_start` |
| **Zephyr** | `DEVICE_DT_DEFINE`、`SYS_INIT`、`k_thread` | **`_kernel` / `struct _cpu`**；devicetree + Kconfig；**iterable section**；`zephyr.map` 里有 `__init_PRE_KERNEL*` 段 |
| **NuttX** | `syscall.csv`、`drivers_early_initialize` | **FLAT / PROTECTED / KERNEL 三种构建**；upper half / lower half 分层；`register_driver` |
| **VxWorks** | **[强]** `tIdle`、`tRootTask` | `WIND_TCB` / `td_*` 字段；**`.out`（DKM）/ `.vxe`（RTP）**；VSB/VIP 配置 |
| **RTEMS** | `CONFIGURE_INIT`、`Device_drivers` | **`confdefs.h`** 构建期配置；`rtems_driver_address_table`；`rtems-syms` / `rtems-execinfo` |
| **eCos** | **[强]** `CYG_*` 宏、`cyg_hal_invoke_constructors`、`hal_vsr_table`、`CYG_ISR_CALL_DSR` | CDL 配置、`mlt_*.ldi` 布局文件、RedBoot、虚拟向量表 |
| **µC/OS（Micrium）** | `OSIntEnter` / `OSIntExit`、`OSSchedLock` | `OS_TCB`、`OS_TmrTask`（定时器任务）、`OSTaskCreate` |
| **TI SYS/BIOS** | **[强]** `ti.sysbios.knl.*` 命名、`Swi_*` / `Hwi_*` / `Task_*` | **Hwi > Swi > Task** 分层；`.cfg` 配置；Swi 与 Hwi 共用系统栈 |
| **SAFERTOS** | `xMPUSetTaskRegions` 一类；与 FreeRTOS **同源但不是同一份二进制** | 安全认证产品线；ESM 的 ACP / OACP / 间接对象 ID |
| **CMSIS-RTX5** | **[强]** `osRtxError*`、`RTX_Config.h`、`OS_SAFETY_FEATURES` | `osThreadZone` / `osKernelProtect` / 安全等级 / 线程看门狗 / ISR FIFO |
| **T-Kernel** | `tk_def_dev`、`tk_rea_dev` / `tk_wri_dev` / `tk_wai_dev` | 三种执行上下文；设备驱动六个处理函数 |
| **TOPPERS** | `act_tsk`、`sta_cyc`、`cyc_*` | **先判家族**：ASP3 / HRP3 / FMP3 / HRMP3（保护与多核语义不同） |
| **OSE / OSEck** | **[强]** `hunt` / `attach` / `send` / `receive`、`SIGSELECT`、LINX | 信号队列附属于进程；域/块/段/池的所有权 |
| **Nucleus** | **[强]** `NU_Create_*` / `NU_Allocate_Partition` | `NU_PARTITION_POOL`（固定块池）——**别与"空间隔离域"混** |

### 3.4 分区 / 安全 RTOS

| 系统 | 强判据 | 结构线索 |
|---|---|---|
| **INTEGRITY / INTEGRITY-178** | ARINC 653 APEX 服务名 | 空间/时间/资源三域分区；静态启动表；内核空间不做动态分配 |
| **PikeOS** | **[强]** **链接在固定地址的 APEX 服务表** | 三层：分区调度器 → system thread → guest 调度器 |
| **ARINC 653 / VxWorks 653** | `major frame` / `partition window` 词汇、`SET_PARTITION_MODE` | 分区模式 IDLE / COLD_START / WARM_START / NORMAL；采样端口 vs 队列端口 |
| **Deos** | ARINC 653 + RMS + POSIX **三类调度模型并存** | 跨核对齐的时间窗 + 每核指派 scheduler；slack；SafeMC 缓存分区 |

### 3.5 Hypervisor

**先看宿主侧厂商串**（CPUID 叶 0x40000000）：`KVMKVMKVM` = KVM、`Microsoft Hv` = Hyper-V、`VMwareVMware` = VMware、`XenVMMXenVMM` = Xen。**[强]**

| 系统 | 强判据 | 结构线索 |
|---|---|---|
| **Xen** | **[强]** XenStore 路径（`~/device/...`、`~/backend/TYPE/DOMID/DEVID`）、`backend-id`、`ring-ref`/`event-channel` 键；`/dev/xen/evtchn` | grant table、shared ring、event channel 四件套；`shared_info` 位掩码 |
| **Hyper-V / VMBus** | **[强]** VMBus 总线（`/sys/bus/vmbus` 一类）、`netvsc` / `storvsc` | VSC/VSP、GPADL、SR-IOV 数据面切换 |
| **ACRN** | **[强]** `IVSHMEM_ENABLED` / `IVSHMEM_REGION`、`acrn-dm`、`dm:/` 与 `hv:/` 前缀 | Service VM / pre-launched / post-launched 三层 |
| **Jailhouse** | **[强]** `.cell` 配置、控制台串 `Parking CPU n (Cell: ...)`、`Unhandled data read` | cell 描述符（内存区标志、PCI/IRQ 归属）、ivshmem |
| **Bao** | **[强]** C 源配置：`struct config` / `shmemlist` / `vmlist` / `shmem_id` | 静态独占（CPU/内存/中断）、vCPU 与 pCPU 1:1 |
| **XtratuM** | **[强]** XM_CF XML：`<Partition>`、`<CyclicPlanTable>`、`<PortTable>`、`<Channels>` | Plan 0 初始化 / Plan 1 维护；IPVI |
| **QNX Hypervisor** | `qvm` 配置；shmem **工厂页**字段（`name` / `size` / `shmem` / `vector` / `status`） | 三层地址（guest VA → guest PA → host PA）；vdev |
| **LynxSecure** | 判据薄：无管理控制台入口、**无动态系统修改**、内核里**没有驱动与 I/O 栈** | 不可变 boot 分区；内核功能仅限三项职责 |
| **Quest-V** | 判据薄：**每 sandbox 一个 monitor**、VM-exit 极少、无全局时钟 | monitor 只在引导/故障/影子页表/建通道时介入 |

> **判据薄的两个系统**（LynxSecure / Quest-V）不要靠字符串定案——它们的定案方式是**结构与行为**（见各自分支）。

### 3.6 固件与引导

| 系统 | 强判据 | 结构线索 |
|---|---|---|
| **UEFI / PI** | PE32/PE32+ 且 subsystem 为 EFI 类；GUID 密集 | **FV → FFS file → section → PE32/TE**；HOB；`MODULE_TYPE`；PPI（PEI）vs Protocol（DXE）vs Runtime Services |

### 3.7 主机 / 大型机

| 系统 | 强判据 | 结构线索 |
|---|---|---|
| **z/OS** | **[强]** EBCDIC 文本、记录式数据集（`SYS1.*`）、JCL | load module / program object；TCB/SRB；AMODE/RMODE；XPLINK 与否 |
| **IBM i** | **[强]** 对象以 `库/对象` 限定名引用；`*PGM` / `*SRVPGM` / `*MODULE` 对象类型 | 单一存储层；MI/TIMI/SLIC 层次；activation group |
| **OpenVMS** | **[强]** **`ELFOSABI_OPENVMS` = 13**；DCL 命令文件 | `.EXE` 镜像、`SYS$SHARE:`、逻辑名、AST / `$QIO`、RMS、描述符调用标准 |

### 3.8 车载软件

| 系统 | 强判据 | 结构线索 |
|---|---|---|
| **AUTOSAR Classic** | **[强]** ARXML、`Rte_*` 接口 | Runnable / RTEEvent / OS Task 映射；`E_OS_ACCESS`；BSW |
| **AUTOSAR Adaptive** | **[强]** Execution / Service Instance / Machine Manifest | `ara::com`、Function Group State / Machine State、`ReportCheckpoint`（PHM）、UCM 与 Persistency |

### 3.9 unikernel

| 系统 | 强判据 | 结构线索 |
|---|---|---|
| **Unikraft** | **[强]** `uk_*` 符号、`uk_syscall_e_*` / `uk_syscall_r_*` 成对出现 | 初始化表段（构造/早期/平台/库/rootfs/系统/晚期）；Kconfig |
| **MirageOS** | **[强]** OCaml 源码 + Lwt 调用；目标名（`unix` / `hvt` / `spt` / `virtio` / `xen`） | 单一静态 ELF；设备接线来自构建期配置 |

## 四、第四层：易混淆对

| 容易混 | 分开的判据 |
|---|---|
| FreeRTOS / ThreadX / µC/OS / RT-Thread | 看对象头**魔数**（ThreadX 独有）→ 看唯一符号（`pxCurrentTCB` / `OSIntEnter` / `rt_thread_ready_priority_group`） |
| Zephyr / NuttX | 两者都有 Kconfig 风格构建；**Zephyr 有 devicetree + iterable section + `DEVICE_DT_DEFINE`**；**NuttX 有 `syscall.csv` + upper/lower half** |
| VxWorks / QNX | `.out` / `.vxe` + `tIdle`/`tRootTask` vs **IFS 镜像魔数 + `procnto` + `devnp-*.so`** |
| FreeBSD / NetBSD / OpenBSD | **linker set `set_*`** vs **`.kmod` + autoload** vs **KARL 重链接 + `.note.openbsd.ident`** |
| illumos / Linux | illumos 的 `_init`/`modlinkage`/`dev_ops` **不是** Linux 的 `module_init`/`file_operations`；且 `nulldev` 与 `nodev` 是两个占位 |
| seL4 / Fuchsia / Genode | `seL4_*` + capDL vs `zx_*` + `.cm`/bind rules vs `session` + init XML |
| Jailhouse / Bao / XtratuM | `.cell` vs **C 源 `struct config`** vs **XM_CF XML** |
| ACRN / Xen | ACRN 有 Service VM 三层与 `dm:/` `hv:/` 前缀；Xen 走 XenStore 路径 + grant/event |
| QNX Neutrino / QNX Hypervisor | 前者是 resource manager 生态（`io-*`/`devb-*`）；后者有 `qvm` 配置与 shmem **工厂页** |
| MINIX 3 / Plan 9 / Redox | RS + endpoint vs 9P + `/srv` vs scheme + SQE/CQE |
| Haiku / BeOS | Haiku 模块名以 `driver_v1`/`device_v1` 结尾；**调试接口与文件系统 API 与 BeOS 不兼容** |
| HIC / Fuchsia | HIC 有**自描述模块元数据**与**入口页 IPC 形态**；Fuchsia 有 driver host 与 bind rules |
| z/OS / IBM i / OpenVMS | EBCDIC + 数据集 + JCL vs `库/对象` + `*PGM` vs **`ELFOSABI=13`** + DCL |
| INTEGRITY / PikeOS / Deos / ARINC 653 | 都讲分区；**PikeOS 的 APEX 服务表链接在固定地址**、**Deos 三类调度模型并存**可作区分 |
| LynxSecure / Quest-V | 都"没有中央调度器"；前者是**不可变静态分区**，后者是**每 sandbox 一个 monitor** |

## 五、第五层：负判据（看到 X 就不是 Y）

| 看到 | 可以直接排除 |
|---|---|
| `set_sysinit_set` / `__start_set_*` | Linux（那是 FreeBSD 的 linker set） |
| `_init` + `modlinkage` + `dev_ops` | Linux、FreeBSD（那是 illumos/Solaris 的 DDI/DKI 骨架） |
| `0x00ff7eeb` + `"imagefs"` | 任何 Linux/BSD |
| `procnto` / `devnp-*.so` | 任何非 QNX 系统 |
| ARXML / `Rte_*` | 通用 RTOS 与桌面 OS |
| 大规模 EBCDIC 记录 | 任何 Unix 系 |
| `.cell`（Jailhouse 配置） | Xen / ACRN / Bao / XtratuM |
| `struct config` + `shmem_id` | 除 Bao 外的 hypervisor |
| ThreadX 对象头魔数 | FreeRTOS / µC/OS / RT-Thread |
| `ELFOSABI` = 9 / 2 / 12 / 13 | 分别是 FreeBSD / NetBSD / OpenBSD / OpenVMS，**不要按"BSD 都差不多"处理** |

## 六、指认流程（一页版）

```
1. 先看容器：PE / ELF(ET_REL?) / Mach-O / 无容器镜像 / 配置 / 转储 / 流量
2. ELF 的话先读 EI_OSABI 与 note 段 → 常常一步定系统
3. 无容器镜像 → 找魔数与签名串（IFS、固件卷、RTOS 特征串）
4. 有配置 → 配置格式本身就是强判据（.cell / XM_CF / ARXML / manifests / Kconfig+devicetree）
5. 符号与命名 → 表 3.x 逐行排除；命中易混对则走第四层
6. 仍不定 → 两条路：
   ├─ 看"缺什么"：没有驱动与 I/O 栈？没有中央调度器？（对应静态分离/多内核）
   └─ 看运行期可见面：系统信息接口、调试器命令、调试接口类型
7. 定案后 → [[cross-system-models]] 查该系统的"正常异常"，再按 [[rerouting]] A 表进对应分支
```

## 七、使用注意

- **判据强度分级**不是形式主义：**[弱]** 判据单独使用会把无关系统卷进来（例如"有 Kconfig"无法区分 Zephyr 与 NuttX 类构建）
- **易混淆对的裁断优先于单条特征**：命中第四层时，按该行的专项判据走
- **判不出不要硬判**：家族定下来、系统未定，也比"猜一个系统然后整条分析链跑偏"好——此时按家族级分支（如 [[re-rtos]] 主文档）先推进
- 新增系统分支时，**同步往本表加一行**（载体/强判据/结构线索三列必填）
