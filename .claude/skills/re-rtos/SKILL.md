---
name: re-rtos
description: RTOS 结构分析：FreeRTOS/ThreadX/Zephyr/RT-Thread 任务表与 TCB 定位、内核对象还原、按任务拆分反编译。触发词：RTOS、FreeRTOS、ThreadX、Zephyr、任务表、TCB、固件调度、MCU 固件
---

# RTOS 结构分析（FreeRTOS / ThreadX / Zephyr / RT-Thread）

## 何时使用 / 何时不用

- 用：MCU/IoT 固件跑 RTOS——定位任务表/TCB、按任务拆分反编译、还原队列/信号量/互斥/定时器等内核对象
- 用：拿到的是裸镜像（无文件系统、无符号），需要从启动代码链找出调度器与全部任务入口
- 不用：裸机固件（无任务表/调度器，按普通 MCU 镜像分析，[[re-fw-extract]] → [[re-binary-core]]）
- 不用：Linux/Windows 内核（走 [[re-kernel]]）
- 不用：只需动态跑起来观察行为（走 [[re-fw-emulate]]）

## 工具准备

本技能以纯静态分析为主（免沙箱，[[platform-tips]] 最高原则）；需要动态验证时转 [[re-fw-emulate]]。工具可替换，方法为核心。

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
   - 启动链形态：reset handler → 时钟/外设/内存初始化 → 创建任务（`xTaskCreate` / `osThreadNew` / `tx_thread_create` / `k_thread_create` / `rt_thread_create`）→ 调度器启动（`vTaskStartScheduler` / `osKernelStart` / `tx_kernel_enter` / `rt_system_scheduler_start`）。调度器启动调用点之前的代码全是初始化，不属于任何任务
   - 特征串：strings 搜内核名（"FreeRTOS"）、任务名（"Idle" 等）、版本/断言串；ELF 未 strip 时直接搜符号（`nm` / Ghidra Symbol Table：`pxCurrentTCB`、`_tx_thread_created_list`、`_kernel`、`rt_thread_ready_priority_group`）
   - ThreadX 无版本串可搜，靠调度入口 `tx_kernel_enter` + TX_THREAD 魔数 ID（步骤 3）确认
   - 不确定内核时：找 3-4 个任务创建调用点与调度入口的调用形态，对照各内核公开结构逐个排除

3. **任务表定位**（按内核选结构；用 Ghidra 定义结构体后逐字段还原优先级/状态/栈指针/任务名）：
   - **FreeRTOS**：TCB（tskTaskControlBlock）关键字段——pxTopOfStack（栈顶指针）、uxPriority（优先级）、pcTaskName（任务名数组，默认 16 字节）、pxStack（栈起始，新版另有 pxEndOfStack）；任务链表在静态区——pxReadyTasksLists[优先级数]（按优先级索引的链表数组）、xDelayedTaskList1/2、xSuspendedTaskList；当前任务指针 pxCurrentTCB。定位方法：在上下文切换代码里找对 TCB 字段的读写（保存/恢复栈指针、更新当前任务指针），交叉引用回静态区
   - **ThreadX**：`_tx_thread_created_list` 全局双向链表（每个 TX_THREAD 经 created_next/created_previous 字段互链），配 `_tx_thread_created_count` 计数；TX_THREAD 关键字段——tx_thread_id（魔数 0x54485244 'THRD'，用于确认结构）、tx_thread_name（任务名）、tx_thread_priority、tx_thread_state、tx_thread_stack_start/end/ptr（栈区）、tx_thread_entry（入口函数）
   - **Zephyr**：`_kernel` 全局结构（新版本为 struct _cpu，老版本为 struct _kernel）——current（当前线程指针）、ready_q（就绪队列：优先级位图 + 按优先级索引的队列数组）、timeout_q（超时队列）、idle 线程指针；另有 slist 全局线程链链着所有 k_thread；k_thread 关键字段——base.prio（优先级）、stack_info.start/size（栈区）、name（线程名）
   - **RT-Thread**：rt_thread_ready_priority_group（优先级位图）+ rt_thread_priority_table[RT_THREAD_PRIORITY_MAX]（按优先级索引的链表数组）；rt_thread 结构关键字段——name、priority、stack_addr/stack_size、entry（入口函数）
   - 产出任务清单：逐个 TCB 读出任务名/优先级/栈区间/入口地址，每任务一行

4. **任务栈识别**：
   - 每任务 TCB 里有栈区字段：FreeRTOS pxStack/pxEndOfStack、ThreadX tx_thread_stack_start/end、Zephyr stack_info.start/size、RT-Thread stack_addr/stack_size
   - 栈区形态：.bss 中按配置宏对齐的静态数组，或从内存池分配；FreeRTOS 开栈溢出检查时栈内为 0xa5 填充模式，可辅助确认栈范围
   - 按栈归属切分任务边界：栈区间属于该任务（局部变量、嵌套调用链），反编译时用"哪段栈属于哪个任务"划分代码归属；任务切换时保存/恢复的栈指针值直接对应 TCB 的栈顶字段

5. **内核对象（队列/信号量/互斥/定时器）**：
   - 从内核 API 调用点反推：`xQueueSend`/`xQueueReceive`/`xSemaphoreTake`/`xTimerCreate`（FreeRTOS）、`tx_queue_send`/`tx_semaphore_get`/`tx_mutex_put`/`tx_timer_create`（ThreadX）、`k_sem_take`/`k_mutex_lock`/`k_queue_get`/`k_timer_start`（Zephyr）、`rt_sem_take`/`rt_mutex_take`/`rt_mq_recv`（RT-Thread）——调用点第一个参数就是对象指针，沿交叉引用回溯到对象定义处（.bss 静态实例或内存池）
   - ThreadX 对象头有魔数 ID 可逐个确认：TX_QUEUE 0x51554555 'QUEU'、TX_SEMAPHORE 0x53454D41 'SEMA'、TX_MUTEX 0x4D555445 'MUTE'、TX_TIMER 0x54494D52 'TIMR'、TX_EVENT_FLAGS 0x4556454E 'EVEN'、TX_BYTE_POOL 0x42595445 'BYTE'、TX_BLOCK_POOL 0x424C4F43 'BLOC'
   - FreeRTOS 中信号量/互斥是队列（Queue_t）特例（结构同构），定时器为 Timer_t；用 Ghidra 定义结构体后，调用点参数类型传播自动改善反编译
   - 对象用途从语义推断：谁 send 谁 receive、take 之后处理什么，即任务间通信链路

6. **按任务拆分反编译**：
   - 每任务一个入口独立分析：任务创建 API 的 entry 参数 → 函数 → 重命名为 task_<优先级>_<名字>，Ghidra 中逐任务标记入口
   - 任务内阻塞点（延时/等信号量/收队列/等事件）是调度切换点，按阻塞点把任务逻辑切成状态段分析
   - 任务间通信对象（队列/信号量）连接不同任务：先画"任务-对象-任务"关系图，再按图逐个深挖

## 跨域联合

- [[re-fw-extract]]：镜像提取与格式识别前置（binwalk 解包、magic 扫描、字节序判断、偏移切分）
- [[re-fw-emulate]]：需要动态验证（跑任务、触发调度、观察切换时序）时仿真目标固件
- [[re-binary-core]]：RTOS 应用深层反编译底座（[[re-ghidra]] 定义结构体，或按环境选 [[re-radare2]]）
- 发现恶意逻辑 → [[re-malware]]；任务与服务器通信 → [[re-protocol]]
- 本技能可被 [[re-firmware]] 网关的 MCU 固件深挖路径调用

## 常见坑与陷阱

- **调度器启动前的代码当任务分析**：现象——把 reset handler 到调度器启动之间的初始化序列当成某个任务的主逻辑，分析半天对不上业务；原因——启动代码（时钟/外设/内存/创建任务）先于调度器执行，不属于任何任务，且与任务入口的调用形态相似；对策——先定位调度器启动调用点（vTaskStartScheduler/osKernelStart/tx_kernel_enter/rt_system_scheduler_start），之前的归为初始化，任务入口一律从创建 API 的 entry 参数取
- **stripped 固件没有任务名**：现象——TCB 里名字字段全空/乱码/全 0；原因——固件 strip 符号且裁剪了字符串表，pcTaskName/tx_thread_name 无内容可读；对策——用栈指针范围（每任务独享栈区间）、优先级值、创建顺序编号区分任务，任务名只当辅助线索
- **链表 vs 静态表结构差异**：现象——按"静态数组任务表"假设在固件里找不到任务列表；原因——各内核组织方式不同：FreeRTOS 是静态链表数组（pxReadyTasksLists 按优先级索引）+ 当前指针 pxCurrentTCB，ThreadX 是全局双向链表 _tx_thread_created_list，Zephyr 是 slist 全线程链 + ready_q 位图队列，RT-Thread 是优先级位图 + 数组链表；对策——先识别内核再选对应结构（步骤 3），别拿一种内核的布局套另一种
- **新版 RTOS 去字符串/去符号后搜不到特征**：现象——strings 和符号表里什么都没有，内核识别卡住；原因——发布固件常 strip 符号、关断言/关字符串、甚至裁剪版本串；对策——用结构特征兜底：ThreadX 魔数 ID（THRD/QUEU/SEMA…）、FreeRTOS 临界区模式（Cortex-M 上 BASEPRI 保存/恢复的固定序列）、调度入口与上下文切换代码形态、按版本比对 TCB 字段偏移（从任务入口参数如何写入 TCB 反推全结构）
- **idle/低优先级兜底任务当业务任务**：现象——把空转循环任务当成主要业务逻辑深挖；原因——FreeRTOS 自动创建 prvIdleTask（最低优先级 0）、Zephyr 有 idle 线程，它们只跑钩子/清理/低功耗代码，与业务无关；对策——任务清单按优先级排序，最低优先级、无阻塞的无限循环先排除为兜底任务，业务任务从高优先级和含阻塞点（队列/信号量等待）的任务里找
- **上下文切换/调度代码当普通业务函数**：现象——PendSV/SVC handler 或调度循环被当业务逻辑跟踪，调用关系混乱；原因——RTOS 的上下文切换（保存/恢复寄存器组、切换 pxCurrentTCB/current）与任务代码同属固件，反编译器视为普通函数；对策——识别切换特征（保存全寄存器组、更新当前任务指针、从栈顶恢复 PC/LR）后标记为调度代码不深入，任务逻辑只看创建 API 入口往下的调用树
