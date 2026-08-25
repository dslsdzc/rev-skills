---
name: re-rtos
description: RTOS 结构分析：FreeRTOS/ThreadX/Zephyr/RT-Thread/VxWorks/QNX/INTEGRITY 任务表与 TCB 定位、内核对象还原、按任务拆分反编译。触发词：RTOS、FreeRTOS、ThreadX、Zephyr、VxWorks、QNX、INTEGRITY、任务表、TCB、固件调度、MCU 固件
---

# RTOS 结构分析（FreeRTOS / ThreadX / Zephyr / RT-Thread / VxWorks / QNX / INTEGRITY）

## 何时使用 / 何时不用

- 用：MCU/IoT 固件跑 RTOS——定位任务表/TCB、按任务拆分反编译、还原队列/信号量/互斥/定时器等内核对象
- 用：拿到的是裸镜像（无文件系统、无符号），需要从启动代码链找出调度器与全部任务入口
- 用：商业 RTOS 固件（VxWorks/QNX/INTEGRITY）——车机中控、航电、工控场景，同样从任务/线程控制块定位出发，按进程/分区/任务拆分分析
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
   - 启动链形态：reset handler → 时钟/外设/内存初始化 → 创建任务（`xTaskCreate` / `osThreadNew` / `tx_thread_create` / `k_thread_create` / `rt_thread_create` / VxWorks `taskSpawn`（≤6.x）或 `taskCreate`（VxWorks 7）/ QNX `ThreadCreate` / INTEGRITY ARINC 653 APEX `CREATE_PROCESS`）→ 调度器启动（`vTaskStartScheduler` / `osKernelStart` / `tx_kernel_enter` / `rt_system_scheduler_start` / VxWorks `kernelInit` / QNX 启动脚本拉起系统进程 / INTEGRITY `START` 进入运行态）。调度器启动调用点之前的代码全是初始化，不属于任何任务
   - 特征串：strings 搜内核名（"FreeRTOS"）、任务名（"Idle" 等）、版本/断言串；ELF 未 strip 时直接搜符号（`nm` / Ghidra Symbol Table：`pxCurrentTCB`、`_tx_thread_created_list`、`_kernel`、`rt_thread_ready_priority_group`）
   - 商业 RTOS 特征串：VxWorks 任务名（"tIdle" 空闲任务、"tRootTask" 根任务）与版本串；QNX 内核/镜像名（"procnto"、"imagefs"）与系统进程名（资源管理器惯用命名 `io-*`/`devb-*`/`devc-*`）；INTEGRITY 分区名/进程名与 ARINC 653 APEX 服务名
   - ThreadX 无版本串可搜，靠调度入口 `tx_kernel_enter` + TX_THREAD 魔数 ID（步骤 3）确认
   - 不确定内核时：找 3-4 个任务创建调用点与调度入口的调用形态，对照各内核公开结构逐个排除

3. **任务表定位**（按内核选结构；用 Ghidra 定义结构体后逐字段还原优先级/状态/栈指针/任务名）：
   - **FreeRTOS**：TCB（tskTaskControlBlock）关键字段——pxTopOfStack（栈顶指针）、uxPriority（优先级）、pcTaskName（任务名数组，默认 16 字节）、pxStack（栈起始，新版另有 pxEndOfStack）；任务链表在静态区——pxReadyTasksLists[优先级数]（按优先级索引的链表数组）、xDelayedTaskList1/2、xSuspendedTaskList；当前任务指针 pxCurrentTCB。定位方法：在上下文切换代码里找对 TCB 字段的读写（保存/恢复栈指针、更新当前任务指针），交叉引用回静态区
   - **ThreadX**：`_tx_thread_created_list` 全局双向链表（每个 TX_THREAD 经 created_next/created_previous 字段互链），配 `_tx_thread_created_count` 计数；TX_THREAD 关键字段——tx_thread_id（魔数 0x54485244 'THRD'，用于确认结构）、tx_thread_name（任务名）、tx_thread_priority、tx_thread_state、tx_thread_stack_start/end/ptr（栈区）、tx_thread_entry（入口函数）
   - **Zephyr**：`_kernel` 全局结构（新版本为 struct _cpu，老版本为 struct _kernel）——current（当前线程指针）、ready_q（就绪队列：优先级位图 + 按优先级索引的队列数组）、timeout_q（超时队列）、idle 线程指针；另有 slist 全局线程链链着所有 k_thread；k_thread 关键字段——base.prio（优先级）、stack_info.start/size（栈区）、name（线程名）
   - **RT-Thread**：rt_thread_ready_priority_group（优先级位图）+ rt_thread_priority_table[RT_THREAD_PRIORITY_MAX]（按优先级索引的链表数组）；rt_thread 结构关键字段——name、priority、stack_addr/stack_size、entry（入口函数）
   - **VxWorks**：WIND_TCB 关键字段——td_name（任务名，字符串指针指向字符串池，非内联数组）、td_sp（保存的栈指针）、td_priority（优先级 0-255，0 最高）、td_status、td_options、td_entry（入口函数）、td_pStackBase/pStackLimit/pStackEnd（栈底/有效栈界/实际栈界）、td_stackSize/td_stackHigh（栈尺寸/历史最高用量）。注意版本差异：VxWorks 7 起 WIND_TCB 为不透明类型，taskLib.h 只提供 VX_WIND_TCB_SIZE 大小宏，字段偏移随版本/SMP 配置变化。定位方法：任务名串在字符串池里（搜 "tIdle"/"tRootTask"），交叉引用回指向它的 TCB；或从上下文切换代码（保存寄存器组到栈、写 td_sp、按 td_priority 挑选任务）反推字段偏移，再沿任务链表回静态区
   - **QNX**：procnto（微内核 + 进程管理器一体）管理线程控制块——线程是调度最小单位，进程只是地址空间容器；线程关键属性——tid（进程内线程号）、优先级（256 级，0 为 idle）、线程名（6.3.2+ 支持）、栈与 TLS 区（含 tid/pid/栈基/errno）。定位方法：QNX 固件是 IFS 镜像（startup 头魔数 0x00ff7eeb + "imagefs" 签名），用 dumpifs 解出各系统进程 ELF 再逐个分析（procnto 即内核本体）；应用侧从 `ThreadCreate`/`MsgSend` 等内核调用点定位线程，线程名串交叉引用回线程控制块；动态环境可用 /proc/<pid>/ctl 的 DCMD_PROC_TIDSTATUS 读线程状态做侧信道
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
