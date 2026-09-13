---
name: re-rtos
description: RTOS 结构分析：FreeRTOS/ThreadX/Zephyr/RT-Thread/VxWorks/QNX/RTEMS/NuttX/eCos/µC-OS/SYS-BIOS/SAFERTOS/CMSIS-RTX5/T-Kernel/TOPPERS/OSE/INTEGRITY/ARINC 653/PikeOS/Deos 运行模型判定、任务表与 TCB 定位、内核对象还原、按任务拆分反编译。触发词：RTOS、FreeRTOS、ThreadX、Zephyr、VxWorks、QNX、RTEMS、NuttX、eCos、µC/OS、Micrium、SYS/BIOS、SAFERTOS、CMSIS-RTX5、T-Kernel、TOPPERS、ITRON、OSE、OSEck、Nucleus、INTEGRITY、ARINC 653、PikeOS、VxWorks 653、Deos、任务表、TCB、固件调度、MCU 固件、confdefs、devicetree、DKM、resource manager、FromISR、DSR、OSIntEnter、Swi、Hwi、module preamble、upper half、分区调度、major frame、Safety Class
capabilities: [rtos-analysis]
---

# RTOS 结构分析（FreeRTOS / ThreadX / Zephyr / RT-Thread / VxWorks / QNX / RTEMS / INTEGRITY）

<CORE RULE>
**RTOS 之间的差异不只是"换个 TCB 布局"，而是"驱动/服务在哪个地址空间、什么时候被注册"。**

各内核形态不同（链表任务表 / 编译期设备图 / 全局符号环境 / 用户态 server / 构建期配置），但共性是：**注册模型决定你能看到什么**——一个函数"没有直接交叉引用"，在不同 RTOS 上可能分别意味着"正常（linker 注册）"、"正常（装载时符号解析）"、"正常（用户态 server）"或"真的没被引用"。

所以顺序永远是：**先判这个 RTOS 的运行与注册模型，再谈任务与内核对象。**
</CORE RULE>

## 运行模型差异（不是同义替换）

| 平台 | "驱动/服务"在哪 | 注册与发现机制 | 先判什么 |
|---|---|---|---|
| FreeRTOS / ThreadX / RT-Thread | 与内核同镜像；任务 + 内核对象表 | 显式创建 API + 静态对象实例 | 任务表/TCB（本主文档） |
| **Zephyr** | 与内核同镜像，但**设备图在编译期生成** | devicetree + Kconfig + **iterable sections**、`SYS_INIT` | 是否 linker 注册（[[zephyr]]） |
| **VxWorks** | **两种**：DKM 内核态 / RTP 用户态 | DKM 动态加载 + **全局符号环境**；RTP 走标准 ELF/`.so` | 先分 DKM 还是 RTP（[[vxworks]]） |
| **QNX** | **用户态 server**；网络驱动是 io-pkt 内的共享对象 | **pathname 注册** + 消息传递 | 先判形态（[[qnx]]） |
| **RTEMS** | 与内核/应用同处**单一地址空间** | 构建期配置（`confdefs.h`）+ 设备驱动表 + 运行期链接器 | 配置与驱动表（[[rtems]]） |
| **INTEGRITY / ARINC 653 / VxWorks 653 / PikeOS** | **分区**（空间 + 时间 + 资源三域） | 静态配置；分区级 **major frame / partition window** + 分区内调度 | **先对齐分区窗口与分区模式**（[[partitioned-rtos]]） |
| **NuttX** | 与内核同镜像或分离，**取决于构建方式** | 由构建模型决定：FLAT 直接调用 / PROTECTED 走 syscall proxy / KERNEL 走 MMU | **先判 FLAT / PROTECTED / KERNEL**（[[nuttx]]） |
| **eCos** | 与内核同镜像；中断处理分三层 | ISR → DSR → thread，各层同步机制不同 | 判断工作落在哪一层（[[ecos]]） |
| **ThreadX Modules** | 常驻内核 + 可动态装载模块 | **module preamble + request ID 经软件 dispatch** | 先认 module ABI（[[threadx-modules]]） |
| **FreeRTOS（上下文）** | 与内核同镜像；中断上下文特殊 | task API 与 FromISR API 分离 | 先判上下文（[[freertos-context]]） |
| **µC/OS、SYS/BIOS** | 与内核同镜像；**中断参与调度** | ISR 显式通知内核（进入/退出）；分层线程 Hwi > Swi > Task | 调度时机要把中断进出算进去（[[ucos-sysbios]]） |
| **SAFERTOS、CMSIS-RTX5** | 与内核同镜像；**带访问控制与安全等级** | per-task 区域/保护域、API 与对象访问策略、ISR 延迟队列 | 先判"谁能访问什么"（[[safertos-rtx5]]） |
| **T-Kernel、TOPPERS** | 与内核同镜像；**服务调用合法性取决于上下文** | 静态配置生成 task/handler；设备驱动以准任务部分运行 | 先恢复上下文类型与规格家族（[[tkernel-toppers]]） |
| **OSE / OSEck** | 与内核同镜像但**消息可跨节点** | 消息式 IPC + 分布式透明传输层（共享内存/DMA/互连） | 先判消息对端在不在本地（[[ose-oseck]]） |
| **Nucleus** | 与内核同镜像；**MMU/MPU 子系统隔离 + 线性内存映射** | 动态 reload/restart/update 应用与内核模块（不必停机） | "模块被替换但系统继续跑"与"隔离存在但 VA 不像每进程独立"都不是异常 |

## 失败模式决策表（本技能的主入口）

**当"找不到调用关系""这段代码像死的""模块加载不了"时，按这张表先怀疑、再排除**：

| 症状 | 优先怀疑 | 处理方向 |
|---|---|---|
| 某个 init / 设备对象**没有直接 xref** | 注册机制：iterable section / `SYS_INIT` / `DEVICE_DEFINE`（Zephyr） | 到 linker section 与 map 文件里裁决，**别标 dead code**（[[zephyr]]） |
| 一整段**规则排列**的函数指针或结构体 | 同上：linker 生成的注册表 | 先按注册表理解，再考虑 vtable / jump table / 混淆（[[zephyr]]） |
| early init 里不调用内核服务 | `PRE_KERNEL_*` 阶段服务尚不可用（设计如此） | 别判"被裁剪"；反之出现线程/互斥/睡眠应先怀疑阶段判错（[[zephyr]]） |
| 一个进程**没有内核模块却控制硬件** | QNX 用户态 resource manager | 找 `resmgr_attach` / `dispatch_*` / `MsgReceive` 与注册的 pathname（[[qnx]]） |
| 网络驱动**既不是进程也不是模块** | 被 io-pkt 加载的 `devnp-*.so` | 找加载它的 io-pkt，确认原生还是经 shim 的旧驱动（[[qnx]]） |
| 线程优先级在采样中**突然变化** | QNX 消息驱动的**优先级继承** / server boost | 不是主动调 `pthread_setschedparam`（[[qnx]]） |
| 线程**长时间阻塞在 IPC** | `MsgSend` 本就同步等待（正常状态） | 找"谁该 reply"；pulse 才是非阻塞那类（[[qnx]]） |
| 独立模块里**大量 unresolved symbols** | VxWorks DKM 链接到**目标镜像的全局符号环境** | 先定位 image 与 VSB/VIP 配置，别判 malformed（[[vxworks]]） |
| 模块在**同版本** VxWorks 上不工作 | 具体 image configuration 不同 | 核对 VSB/VIP 而不是版本字符串（[[vxworks]]） |
| `dlopen()` 行为**不像 Unix 动态库** | RTEMS 运行时链接器 | 重定位进当前地址空间；对象名可为 `libfoo.a:bar.o`（[[rtems]]） |
| 找不到设备回调的 `file_operations` | RTEMS 设备驱动表（major = 表索引） | 恢复 `rtems_driver_address_table` 与 `rtems_io_register_name`（[[rtems]]） |
| 任务数/调度器**找不到运行期创建点** | RTEMS 构建期配置生成 | 找定义 `CONFIGURE_INIT` 的那个翻译单元（[[rtems]]） |
| 高优先级线程**不运行**（分区系统） | **分区级调度**：当前没有它所属分区的执行窗口 / 预算，或分区还没进 NORMAL | 先对齐 major frame 与 partition window，再看线程优先级（[[partitioned-rtos]]） |
| "连写 A B C 只读到 C" | **采样端口**的覆盖语义 | 对队列端口才是异常（[[partitioned-rtos]]） |
| 固定地址函数表被当成混淆 | APEX 服务表一类的 ABI | 先当服务表核对（[[partitioned-rtos]]） |
| 同一个 API 反编译结果在不同样本里完全不同 | NuttX 的 **FLAT/PROTECTED/KERNEL** 构建差异 | 先判构建模型；极短 API + 立即 trap 是自动生成的 syscall proxy（[[nuttx]]） |
| 某地址"用户能访问 / 用户 fault" | 可能分别来自 **malloc 与 kmalloc**（双堆） | 分清 user heap 与 kernel heap（[[nuttx]]） |
| 找不到真正操作硬件的地方 | NuttX 的 **upper half / lower half** 分层 | 硬件实现常在 `arch/` 或 `boards/`，不在 `drivers/`（[[nuttx]]） |
| ISR 里调用了 task 版 API | 上下文判定或符号识别有误（FreeRTOS） | 先判任务/ISR 上下文与 API 变体（[[freertos-context]]） |
| 某地址"有时能访问、有时不能" | **MPU 受限任务**或运行期改了 MPU 区域（FreeRTOS-MPU） | 查区域配置与运行期改区调用（[[freertos-context]]） |
| ISR 只清状态位就返回 | eCos 的 **DSR** 承担真正工作 | 查 ISR 返回值是否调度 DSR（[[ecos]]） |
| 大量「填 request ID → 跳公共 dispatcher」 | ThreadX Module 的 ABI | 建 request ID → 服务名映射，别判混淆（[[threadx-modules]]） |
| 代码地址不在模块内存区内 | **XIP** 模块（指令在 Flash、数据在 RAM） | 别判控制流劫持（[[threadx-modules]]） |
| ISR 尾部发生切换 / task 已就绪却不切换 | **中断进出参与调度**（µC/OS 的进入退出协议；SYS/BIOS 的 `Swi_disable` **连带禁用 Task 调度**） | 把中断进出算进调度时机（[[ucos-sysbios]]） |
| 同一地址在不同 task 下可访问性不同 | **per-task MPU 区域 / 保护域**（SAFERTOS、RTX5） | 查区域配置与安全等级，别判内存损坏（[[safertos-rtx5]]） |
| 句柄不像内存指针 | **间接对象 ID + 交叉引用表**（SAFERTOS ESM） | 别指望从它推出对象布局（[[safertos-rtx5]]） |
| ISR 里调用的 API 没立即生效 | **ISR FIFO 延迟队列**（RTX5） | 对象状态在 IRQ 退出后才变化，属正常（[[safertos-rtx5]]） |
| 服务调用"非法"或被拒 | **上下文类型**（T-Kernel 任务/准任务/任务独立；TOPPERS 任务/非任务/ISR/循环/闹钟） | 对照规范的有效上下文表，别按 API 名推测（[[tkernel-toppers]]） |
| 消息/信号的对端找不到 | **消息可跨 core / CPU / DSP / node**（OSE 的分布式透明传输层） | 别假定对端在本地，也别只查本地 syscall（[[ose-oseck]]） |
| 模块被替换但系统继续运行 | **Nucleus 的动态 reload/update**（线性内存映射 + MMU/MPU 子系统隔离） | 见运行模型表；别先判劫持 |

## 何时使用 / 何时不用

- 前置：**先用特征串/魔数/符号确认是哪一个 RTOS**（本家族内极易互认）→ [[re-analyze/system-fingerprints]] 的 RTOS 段与易混淆对
- 用：MCU/IoT 固件跑 RTOS——定位任务表/TCB、按任务拆分反编译、还原队列/信号量/互斥/定时器等内核对象
- 用：拿到的是裸镜像（无文件系统、无符号），需要从启动代码链找出调度器与全部任务入口
- 用：商业 RTOS 固件（VxWorks/QNX/RTEMS/INTEGRITY）——车机中控、航电、工控场景，同样从任务/线程控制块定位出发，按进程/分区/任务拆分分析
- 用：**"驱动/服务不以内核模块形式存在"**或**"注册关系不在源码里成立"**的情形——先判定运行模型（用户态 server / 全局符号环境 / linker 注册 / 构建期配置），见分支与决策表
- 不用：裸机固件（无任务表/调度器，按普通 MCU 镜像分析，[[re-fw-extract]] → [[re-binary-core]]）
- 不用：Linux/Windows 内核（走 [[re-kernel]]）
- 不用：只需动态跑起来观察行为（走 [[re-fw-emulate]]）

## 工具准备

本技能以纯静态分析为主（免沙箱，[[re-analyze/platform-tips]] 最高原则）；需要动态验证时转 [[re-fw-emulate]]。工具可替换，方法为核心。

### Ghidra（反编译与结构体定义主力）

- 下载: GitHub `NationalSecurityAgency/ghidra` releases，解压即用（无需安装）
- JDK 21（Ghidra 11.3+ 要求）:
  - Linux: `apt install openjdk-21-jdk` / `dnf install java-21-openjdk` / `pacman -S jdk21-openjdk`
  - macOS: `brew install openjdk@21` 或 `brew install --cask temurin`
  - Windows: `choco install temurin21`
- 启动: `./ghidraRun`（GUI）/ `./support/analyzeHeadless`（无头）
- 验证: `java -version`（须 21+）；`./support/analyzeHeadless -help` 正常输出
- 用法核心：Data Type Manager 定义 TCB/内核对象结构体后，类型传播会显著改善反编译质量

### binwalk（镜像提取先行）

- Linux: `apt install binwalk`（Debian/Ubuntu）/ `dnf install binwalk` / `pacman -S binwalk`
- pip（跨平台、版本新）: `pip install binwalk`
- macOS: `brew install binwalk`
- Windows/WSL: Windows 本机无官方包，用 WSL 内 Linux/pip 版
- 验证: `binwalk --version`

### python3（脚本化解析与批量标注）

- Linux: `apt install python3` / `dnf install python3` / `pacman -S python`
- macOS: 自带；Windows: 官方安装器或 `choco install python`
- 验证: `python3 --version`
- 用途: 批量搜特征串/魔数、按字段偏移解析任务表、生成 Ghidra 脚本自动标注任务名/入口

## 操作步骤

按顺序执行，每步结果存档（任务清单、内核对象表、Ghidra 工程）。

1. **前置：镜像提取与格式识别（衔接 [[re-fw-extract]] 流程）**：
   - 先按 [[re-fw-extract]] 完成：binwalk 解包 / dd 按偏移切分 / `file` + `readelf -h` 确认架构与字节序（大端 ARM/MIPS 固件常见）
   - 产物通常是裸镜像（raw binary）或单个 ELF；记录 reset handler 入口与 RAM 基址（从链接脚本/启动代码推断）——任务表与 TCB 都在 RAM 区，按链接地址解读
   - 确认字节序与架构后再导入 Ghidra，避免整个分析白做

2. **RTOS 识别：启动代码链 + 特征串/符号搜索**：
   - 启动链形态：reset handler → 时钟/外设/内存初始化 → 创建任务（`xTaskCreate` / `osThreadNew` / `tx_thread_create` / `k_thread_create` / `rt_thread_create` / VxWorks `taskSpawn`（6.x 及更早常用；7 中仍存在，内部实现为 taskCreate+taskActivate）或 `taskCreate`（7 起，创建挂起任务需显式 taskActivate）/ QNX `ThreadCreate` / INTEGRITY ARINC 653 APEX `CREATE_PROCESS`）→ 调度器启动（`vTaskStartScheduler` / `osKernelStart` / `tx_kernel_enter` / `rt_system_scheduler_start` / VxWorks `kernelInit` / QNX 启动脚本拉起系统进程 / INTEGRITY `START` 进入运行态）。调度器启动调用点之前的代码全是初始化，不属于任何任务
   - 特征串：strings 搜内核名（"FreeRTOS"）、任务名（"Idle" 等）、版本/断言串；ELF 未 strip 时直接搜符号（`nm` / Ghidra Symbol Table：`pxCurrentTCB`、`_tx_thread_created_list`、`_kernel`、`rt_thread_ready_priority_group`）
   - 商业 RTOS 特征串：VxWorks 任务名（"tIdle" 空闲任务（VxWorks 6.x+）、"tRootTask" 根任务）与版本串；QNX 内核/镜像名（"procnto"、"imagefs"）与系统进程名（资源管理器惯用命名 `io-*`/`devb-*`/`devc-*`）；INTEGRITY 分区名/进程名与 ARINC 653 APEX 服务名
   - ThreadX 无版本串可搜，靠调度入口 `tx_kernel_enter` + TX_THREAD 魔数 ID（步骤 3）确认
   - 不确定内核时：找 3-4 个任务创建调用点与调度入口的调用形态，对照各内核公开结构逐个排除

3. **任务表定位**（按内核选结构；用 Ghidra 定义结构体后逐字段还原优先级/状态/栈指针/任务名）：
   - **FreeRTOS**：TCB（tskTaskControlBlock）关键字段——pxTopOfStack（栈顶指针）、uxPriority（优先级）、pcTaskName（任务名数组，默认 16 字节）、pxStack（栈起始，新版另有 pxEndOfStack）；任务链表在静态区——pxReadyTasksLists[优先级数]（按优先级索引的链表数组）、xDelayedTaskList1/2、xSuspendedTaskList；当前任务指针 pxCurrentTCB。定位方法：在上下文切换代码里找对 TCB 字段的读写（保存/恢复栈指针、更新当前任务指针），交叉引用回静态区
   - **ThreadX**：`_tx_thread_created_list` 全局双向链表（每个 TX_THREAD 经 created_next/created_previous 字段互链），配 `_tx_thread_created_count` 计数；TX_THREAD 关键字段——tx_thread_id（魔数 0x54485244 'THRD'，用于确认结构）、tx_thread_name（任务名）、tx_thread_priority、tx_thread_state、tx_thread_stack_start/end/ptr（栈区）、tx_thread_entry（入口函数）
   - **Zephyr**：`_kernel` 全局结构（新版本为 struct _cpu，老版本为 struct _kernel）——current（当前线程指针）、ready_q（就绪队列：优先级位图 + 按优先级索引的队列数组）、timeout_q（超时队列）、idle 线程指针；另有 slist 全局线程链链着所有 k_thread；k_thread 关键字段——base.prio（优先级）、stack_info.start/size（栈区）、name（线程名）
   - **RT-Thread**：rt_thread_ready_priority_group（优先级位图）+ rt_thread_priority_table[RT_THREAD_PRIORITY_MAX]（按优先级索引的链表数组）；rt_thread 结构关键字段——name、priority、stack_addr/stack_size、entry（入口函数）
   - **VxWorks**：WIND_TCB 关键字段——td_name（任务名，字符串指针指向字符串池，非内联数组）、td_sp（保存的栈指针）、td_priority（优先级 0-255，0 最高）、td_status、td_options、td_entry（入口函数）、td_pStackBase/pStackLimit/pStackEnd（栈底/有效栈界/实际栈界）、td_stackSize/td_stackHigh（栈尺寸/历史最高用量）。注意版本差异：VxWorks 7 起 WIND_TCB 为不透明类型，taskLib.h 只提供 VX_WIND_TCB_SIZE 大小宏，字段偏移随版本/SMP 配置变化。定位方法：任务名串在字符串池里（搜 "tIdle"/"tRootTask"），交叉引用回指向它的 TCB；或从上下文切换代码（保存寄存器组到栈、写 td_sp、按 td_priority 挑选任务）反推字段偏移，再沿任务链表回静态区
   - **QNX**：procnto（微内核 + 进程管理器一体）管理线程控制块——线程是调度最小单位，进程只是地址空间容器；线程关键属性——tid（进程内线程号）、优先级（256 级，0 为 idle）、线程名（6.3.2+ 支持）、栈与 TLS 区（含 tid/pid/栈基/errno）（内部布局无官方公开定义，属性经系统调用参数与 /proc 侧信道观察）。定位方法：QNX 固件是 IFS 镜像（startup 头魔数 0x00ff7eeb + "imagefs" 签名），用 dumpifs 解出各系统进程 ELF 再逐个分析（procnto 即内核本体）；应用侧从 `ThreadCreate`/`MsgSend` 等内核调用点定位线程，线程名串交叉引用回线程控制块；动态环境可用 /proc/<pid>/ctl 的 DCMD_PROC_TIDSTATUS 读线程状态做侧信道
   - **INTEGRITY**：分区（partition）是空间+时间隔离单元——空间上每分区独立内存区（MMU 强制），时间上按模块调度表（module schedule）循环分配执行窗口（一轮 = major frame）；分区内任务为 ARINC 653 进程，进程控制块属性含入口、栈尺寸、基优先级、周期/期限。定位方法：全静态配置——启动时一次性分配，无动态内存/无动态任务创建，对象地址固定，boot table 定义资源归属；分区/进程名串在固件里可读，交叉引用回配置表；ARINC 653 APEX 服务名（CREATE_PROCESS/SET_PRIORITY/GET_TIME 等）调用点即内核服务入口
   - 产出任务清单：逐个 TCB 读出任务名/优先级/栈区间/入口地址，每任务一行

4. **任务栈识别**：
   - 每任务 TCB 里有栈区字段：FreeRTOS pxStack/pxEndOfStack、ThreadX tx_thread_stack_start/end、Zephyr stack_info.start/size、RT-Thread stack_addr/stack_size、VxWorks td_pStackBase/pStackLimit/pStackEnd + td_stackSize（默认 0xee 填充，VX_NO_STACK_FILL 选项关闭）、QNX 线程栈界可从 TLS 区（栈基/tid/pid）辅助确认、INTEGRITY 进程栈在分区内存区内（栈尺寸在进程创建属性里）
   - 栈区形态：.bss 中按配置宏对齐的静态数组，或从内存池分配；FreeRTOS 开栈溢出检查时栈内为 0xa5 填充模式，可辅助确认栈范围
   - 按栈归属切分任务边界：栈区间属于该任务（局部变量、嵌套调用链），反编译时用"哪段栈属于哪个任务"划分代码归属；任务切换时保存/恢复的栈指针值直接对应 TCB 的栈顶字段

5. **内核对象（队列/信号量/互斥/定时器）**：
   - 从内核 API 调用点反推：`xQueueSend`/`xQueueReceive`/`xSemaphoreTake`/`xTimerCreate`（FreeRTOS）、`tx_queue_send`/`tx_semaphore_get`/`tx_mutex_put`/`tx_timer_create`（ThreadX）、`k_sem_take`/`k_mutex_lock`/`k_queue_get`/`k_timer_start`（Zephyr）、`rt_sem_take`/`rt_mutex_take`/`rt_mq_recv`（RT-Thread）——调用点第一个参数就是对象指针，沿交叉引用回溯到对象定义处（.bss 静态实例或内存池）
   - 商业 RTOS 内核对象：VxWorks 信号量（semGive/semTake）、消息队列（msgQSend/msgQReceive）、事件（eventSend/eventReceive）、看门狗（wdCreate）——调用点参数即对象 ID，沿交叉引用回溯到静态区定义；QNX 是 channel/connection 模型——MsgReceive 线程建 channel、MsgSend 线程建 connection，同步消息使线程进入 SEND/REPLY/RECEIVE 阻塞态（消息跨地址空间直拷、无中间缓冲），pulse 是 4 字节数据 + 1 字节 code 的非阻塞通知；INTEGRITY 分区间通信是采样端口（sampling port，覆盖写语义）/队列端口（queuing port，排队语义），分区内为信号量/事件/缓冲/黑板，按 ARINC 653 服务名搜索
   - ThreadX 对象头有魔数 ID 可逐个确认（以官方源码为准，勿凭资料记忆）：TX_QUEUE 0x51554555 'QUEU'、TX_SEMAPHORE 0x53454D41 'SEMA'、TX_MUTEX 0x4D555445 'MUTE'、TX_TIMER 0x4154494D 'ATIM'、TX_EVENT_FLAGS 0x4456444E 'DVDE'、TX_BYTE_POOL 0x42595445 'BYTE'、TX_BLOCK_POOL 0x424C4F43 'BLOC'（旧资料中 TIMR/EVEN 写法不实，勿沿用）
   - FreeRTOS 中信号量/互斥是队列（Queue_t）特例（结构同构），定时器为 Timer_t；用 Ghidra 定义结构体后，调用点参数类型传播自动改善反编译
   - 对象用途从语义推断：谁 send 谁 receive、take 之后处理什么，即任务间通信链路

6. **按任务拆分反编译**：
   - 每任务一个入口独立分析：任务创建 API 的 entry 参数 → 函数 → 重命名为 task_<优先级>_<名字>，Ghidra 中逐任务标记入口
   - 任务内阻塞点（延时/等信号量/收队列/等事件）是调度切换点，按阻塞点把任务逻辑切成状态段分析
   - 任务间通信对象（队列/信号量）连接不同任务：先画"任务-对象-任务"关系图，再按图逐个深挖

## 平台分支（references）

以下四个平台的"驱动/服务模型"与通用任务表方法差异足够大，单独成篇——**先读分支判定运行模型，再回到本主文档做任务与对象分析**：

- [[qnx]] —— **用户态 server 模型**：resource manager（`dispatch_create` → `resmgr_attach` → `dispatch_block/handler`，底层是 `MsgReceive`）、`connect`/I/O 两张函数表与 `iofunc_*` 默认实现的区分、`devctl` 与 `_IO_DEVCTL`、**io-pkt 与 `devnp-*.so`（含单线程栈上下文）**、消息驱动的**优先级继承**与 server boost、`MsgSend` 同步阻塞 vs pulse
- [[vxworks]] —— **DKM（`.out`，内核态）vs RTP（`.vxe`，用户态）**、DKM 与**全局符号环境**的链接关系、`undefined symbol` 的真实成因（VIP 未含组件）、独立模块 unresolved 属常态、VSB/VIP 与"同版本不同 ABI 环境"
- [[zephyr]] —— **编译期设备图**：`DEVICE_DEFINE`/`DEVICE_DT_DEFINE` 与 linker section、`SYS_INIT` 的 level/prio 与**返回值后果**、**iterable sections**（规则排列的结构体未必是混淆表）、`/chosen` 与 `/aliases` 不是硬件节点、map 文件裁决归属、**LLEXT**（导出符号表、`llext_unload` 后指针失效、User Mode 下需 `llext_add_domain`）
- [[rtems]] —— **单地址空间 + 构建期配置**：`confdefs.h` 与 `CONFIGURE_INIT` 唯一性、`rtems_driver_address_table` 六入口与 **major = 表索引**、`rtems_io_register_name`、**运行时链接器不是 Unix 共享库模型**（`libfoo.a:bar.o`、懒/立即绑定等价、未解析不报错、重名即错误、基镜像需 `rtems-syms`）
- [[partitioned-rtos]] —— **分区系统（INTEGRITY / ARINC 653 / VxWorks 653 / PikeOS）**：**major frame + partition window** 的两层调度（PikeOS 三层）；分区模式 IDLE/COLD_START/WARM_START/NORMAL（进程"不跑"常是还没进 NORMAL）；**采样端口 vs 队列端口**的覆盖语义；INTEGRITY 的固定 CPU/内存预算与静态启动表；PikeOS 的 **APEX 固定地址服务表**与 POSIX guest 的 system thread 映射
- [[nuttx]] —— **FLAT / PROTECTED / KERNEL 三种构建**：同一 API 产物完全不同；PROTECTED 的**自动生成 syscall proxy**（极短函数 + 立即 trap，不是 hook）；**双堆**（user heap / kernel heap）；驱动的 **upper half / lower half** 分层
- [[freertos-context]] —— **ISR 与任务上下文**：task 版 vs `...FromISR()` 版 API、`pxHigherPriorityTaskWoken` 与 `portYIELD_FROM_ISR`（真正的切换发生在中断退出后）、`configMAX_SYSCALL_INTERRUPT_PRIORITY`（更紧急的 ISR 一个 API 都不能调，且优先级数值方向相反）；**FreeRTOS-MPU** 的受限任务与运行期改区
- [[threadx-modules]] —— **module preamble**（必在第一个地址、properties 位决定特权/MPU）+ **request ID 经软件 dispatch 调用常驻 Module Manager**（本质是 syscall table，不是混淆）+ XIP 与拷贝装载
- [[ecos]] —— **运行期**：ISR / DSR / thread 三层、三种同步级别与各自的锁（**ISR 不能用 DSR 级锁；DSR 能 signal 条件变量但不能 wait**）、三种驱动模型；**构建期**：CDL 配置系统决定编入项与构建目标、HAL 向量表（VSR）与虚拟向量、RedBoot 启动顺序与**构造函数在向量表初始化之后运行**（区域重叠会被冲掉）、调试桩的去向
- [[ucos-sysbios]] —— **中断进出参与调度**：µC/OS 的 `OSIntEnter`/`OSIntExit` 成对协议与"只有最后一个嵌套 ISR 退出才判断切换"；SYS/BIOS 的 **Hwi > Swi > Task** 分层、**`Swi_disable()` 连带禁用 Task 调度**、Hwi/Swi 共用 ISR 栈
- [[safertos-rtx5]] —— **认证 RTOS 的隔离特性**：SAFERTOS ESM 的 **API 访问策略 / 对象访问策略 / 间接对象 ID / per-task 区域**；RTX5 的 **Safety Class / MPU 保护域 / 线程看门狗 / 对象与 SVC 指针检查**、**ISR FIFO 延迟队列**（溢出时系统状态已不一致）
- [[tkernel-toppers]] —— **上下文合法性**：T-Kernel 的任务/准任务/任务独立三种上下文与设备驱动（准任务部分、必须可重入、不保证互斥）；**TOPPERS 的四个家族**（ASP3 / HRP3 / FMP3 / HRMP3）与静态配置生成
- [[ose-oseck]] —— **信号模型**（不是 POSIX 信号；**信号号不唯一，需配合次级 id**；先注册后发送否则丢；一次事件可能关联多个信号要取空）+ **进程/块/段/池的内存所有权**（只能在**自己的池**里分配，跨域发送会被拷贝）+ 监督与错误处理器（含"结尾标记能检出什么、检不出什么"）+ OSE 与 OSEck 的差异与**异构边界**（信号跨 core/CPU/DSP/节点；系统信息接口可看信号空间与保存的寄存器/栈）
- [[nucleus]] —— **线性内存映射 + 受保护区域 + entitlement**（MMU 在 Cortex-A、MPU 在 Cortex-M；**不是每进程独立 VA**）；**`NU_PARTITION_POOL` 是固定块内存池**（与隔离域同名的术语坑）；`NU_SUSPEND` 下池空则任务本就挂起；**模块可动态 reload/restart/update 而不停机**

## 跨域联合

- [[re-fw-extract]]：镜像提取与格式识别前置（binwalk 解包、magic 扫描、字节序判断、偏移切分）
- [[re-fw-emulate]]：需要动态验证（跑任务、触发调度、观察切换时序）时仿真目标固件
- [[re-automotive]]：QNX 车机中控场景联动（车载系统侧固件/进程分析，与 CAN/ECU 侧互补）
- [[re-binary-core]]：RTOS 应用深层反编译底座（[[re-ghidra]] 定义结构体，或按环境选 [[re-radare2]]）
- 发现恶意逻辑 → [[re-malware]]；任务与服务器通信 → [[re-protocol]]
- 本技能可被 [[re-firmware]] 网关的 MCU 固件深挖路径调用

## 常见坑与陷阱

- **调度器启动前的代码当任务分析**：现象——把 reset handler 到调度器启动之间的初始化序列当成某个任务的主逻辑，分析半天对不上业务；原因——启动代码（时钟/外设/内存/创建任务）先于调度器执行，不属于任何任务，且与任务入口的调用形态相似；对策——先定位调度器启动调用点（vTaskStartScheduler/osKernelStart/tx_kernel_enter/rt_system_scheduler_start/kernelInit），之前的归为初始化，任务入口一律从创建 API 的 entry 参数取
- **stripped 固件没有任务名**：现象——TCB 里名字字段全空/乱码/全 0；原因——固件 strip 符号且裁剪了字符串表，pcTaskName/tx_thread_name 无内容可读；对策——用栈指针范围（每任务独享栈区间）、优先级值、创建顺序编号区分任务，任务名只当辅助线索
- **链表 vs 静态表结构差异**：现象——按"静态数组任务表"假设在固件里找不到任务列表；原因——各内核组织方式不同：FreeRTOS 是静态链表数组（pxReadyTasksLists 按优先级索引）+ 当前指针 pxCurrentTCB，ThreadX 是全局双向链表 _tx_thread_created_list，Zephyr 是 slist 全线程链 + ready_q 位图队列，RT-Thread 是优先级位图 + 数组链表，VxWorks 任务挂全局任务链表（taskIdListGet 可枚举语义），QNX/INTEGRITY 布局不公开、从创建/服务调用点与句柄表反推；对策——先识别内核再选对应结构（步骤 3），别拿一种内核的布局套另一种
- **新版 RTOS 去字符串/去符号后搜不到特征**：现象——strings 和符号表里什么都没有，内核识别卡住；原因——发布固件常 strip 符号、关断言/关字符串、甚至裁剪版本串；对策——用结构特征兜底：ThreadX 魔数 ID（THRD/QUEU/SEMA…）、FreeRTOS 临界区模式（Cortex-M 上 BASEPRI 保存/恢复的固定序列）、调度入口与上下文切换代码形态、按版本比对 TCB 字段偏移（从任务入口参数如何写入 TCB 反推全结构）
- **idle/低优先级兜底任务当业务任务**：现象——把空转循环任务当成主要业务逻辑深挖；原因——FreeRTOS 自动创建 prvIdleTask（最低优先级 0）、Zephyr 有 idle 线程、VxWorks 有 tIdle 任务，它们只跑钩子/清理/低功耗代码，与业务无关；对策——任务清单按优先级排序，最低优先级、无阻塞的无限循环先排除为兜底任务，业务任务从高优先级和含阻塞点（队列/信号量等待）的任务里找
- **上下文切换/调度代码当普通业务函数**：现象——PendSV/SVC handler 或调度循环被当业务逻辑跟踪，调用关系混乱；原因——RTOS 的上下文切换（保存/恢复寄存器组、切换 pxCurrentTCB/current）与任务代码同属固件，反编译器视为普通函数；对策——识别切换特征（保存全寄存器组、更新当前任务指针、从栈顶恢复 PC/LR）后标记为调度代码不深入，任务逻辑只看创建 API 入口往下的调用树
- **商业 RTOS 结构无公开定义，旧资料偏移不可套用**：现象——按网上 VxWorks 5.x 的 WIND_TCB 偏移在 VxWorks 7 固件里解出乱码；原因——VxWorks 7 起 WIND_TCB 为不透明类型（taskLib.h 只给 VX_WIND_TCB_SIZE）、QNX 线程控制块与 INTEGRITY 进程表布局未公开，且随版本/SMP 配置变化；对策——字段名只当语义线索，偏移一律从上下文切换/创建代码现场反推，用字段读写模式验证
- **任务名字段是字符串指针不是内联数组**：现象——在 TCB 里按 FreeRTOS 习惯找定长名字数组，读到的却是地址值；原因——VxWorks td_name 是 char* 指向字符串池，QNX/INTEGRITY 线程名同理；对策——拿到字段后先判断是地址还是内联数据（交叉引用看是否指向字符串区），固件裁剪字符串后名字字段会失效，改用栈范围/优先级区分任务
- **QNX 固件是 IFS 镜像，不能当裸二进制直接搜**：现象——整块固件里搜不到 procnto 或进程代码；原因——QNX 镜像内文件常 LZO 压缩，字符串与代码都不可见；对策——先按 startup 头（0x00ff7eeb）+ "imagefs" 签名定位镜像，用 dumpifs 解压提取（startup 头字段被改过时加 -z），得到各进程 ELF 再分析
- **INTEGRITY 运行期没有动态创建**：现象——把分区模式切换（SET_PARTITION_MODE 的 COLD_START/WARM_START/NORMAL）或进程启停（START/STOP）当"创建任务"逻辑分析；原因——INTEGRITY 资源启动时静态分配，运行期主要是状态迁移，无动态内存分配；对策——创建类代码只出现在初始化/配置路径，业务逻辑按周期调度（major frame）与 APEX 服务调用组织
