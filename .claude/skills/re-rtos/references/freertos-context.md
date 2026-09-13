# FreeRTOS：ISR 上下文 / FromISR API / MPU 受限任务

<CORE RULE>
FreeRTOS 表面很小，**最大的坑不是"简单"，而是上下文**：

```
xQueueSend()            vs  xQueueSendFromISR()
xTaskNotifyGive()       vs  vTaskNotifyGiveFromISR()
taskENTER_CRITICAL()    vs  taskENTER_CRITICAL_FROM_ISR()
```

**这些不是可随意互换的别名。** 在 ISR 里看到 task 版 API，不能顺着"正常业务逻辑"继续分析——先判断**它到底在不在 ISR 上下文**、以及是不是符号/包装器识别错了。
</CORE RULE>

## 一、为什么要有 FromISR 变体

在 ISR 里，**调度器实际上是冻结的**：ISR 不能阻塞，内核也不能在 ISR 内做任务切换。普通 API 可能阻塞（例如等队列空位）或在内部触发调度——**在中断上下文里都是禁止的**。

`...FromISR()` 变体的共同点：**不阻塞、使用更轻量的临界区、把调度决定交回给应用**。

## 二、`pxHigherPriorityTaskWoken` 与 `portYIELD_FROM_ISR`

- 以 `xQueueSendFromISR(queue, item, pxHigherPriorityTaskWoken)` 为例：若这次发送解除了某个任务的阻塞**且该任务优先级高于当前运行任务**，则把 `*pxHigherPriorityTaskWoken` 置为 `pdTRUE`，表示**退出中断前应请求一次上下文切换**
- **自 V7.3.0 起该参数可选（可传 NULL）**。取舍要清楚：
  - 传 NULL 后若调用 `portYIELD_FROM_ISR(pdTRUE)` → **总是强制让出**（可能是不必要的切换，甚至切到同优先级轮转的对等任务）
  - 传 NULL 后不 yield → **更高优先级的就绪任务可能一直等到后续事件才被调度**
- 典型形态：

```c
BaseType_t xHigherPriorityTaskWoken = pdFALSE;
xQueueSendFromISR(xQueue, &item, &xHigherPriorityTaskWoken);
if (xHigherPriorityTaskWoken) { portYIELD_FROM_ISR(); }
```

- **`portYIELD_FROM_ISR()` 并不在调用点立即切换**：在 Cortex-M 上通常是 **pend PendSV**，真正的切换发生在中断退出之后（tail-chaining）——这对时序分析很重要

**所以**："函数尾部突然出现调度/yield 相关代码"的 CFG，**可能只是 ISR 正常触发高优先级任务切换**。

## 三、`configMAX_SYSCALL_INTERRUPT_PRIORITY`：越界的中断不能碰任何 API

- 该配置定义**允许调用 FreeRTOS API 的最高（数值最低的）中断优先级**
- **数值上比它更低（更紧急）的 ISR 不得调用任何 FreeRTOS API（包括 FromISR 版本），也不能使用 `portYIELD_FROM_ISR`**——这类 ISR 只能做纯硬件操作或置标志
- Cortex-M 的临界区通过写 **BASEPRI** 实现：只屏蔽该优先级及以下的中断，让最紧急的中断仍能通过
- **注意优先级数值方向**：Cortex-M/STM32 上数值越小优先级越高，**与任务优先级的方向相反**——这一条经常导致误判
- 典型故障：ISR 调用了 `xQueueSendFromISR` 但**没有设置 NVIC 优先级**（默认 0 = 最高），触发端口层的优先级校验断言（`vPortValidateInterruptPriority` 一类）

## 四、FreeRTOS-MPU：受限任务与运行期改区

**受限任务**通过 `xTaskCreateRestricted(TaskParameters_t *, TaskHandle_t *)` 创建。参数是静态配置的结构体：任务函数、名字、栈深度、参数、优先级、**栈缓冲**，以及 **`xRegions[portNUM_CONFIGURABLE_REGIONS]`**（Cortex-M3 上为 3 个）。

- **`uxPriority` 与 `portPRIVILEGE_BIT` 相或** → 特权模式任务；否则任务以**用户模式**运行
- 栈缓冲须满足 MPU 约束，常用编译期对齐（如 `__attribute__((aligned(...)))`）；传 NULL 时使用端口提供的对齐分配函数
- **`xTaskCreateRestrictedStatic()`**：完全不动态分配（需开启静态分配支持），还要求应用提供 `StaticTask_t` 存储——可把它放进内核特权数据区
- **`MemoryRegion_t { pvBaseAddress, ulLengthInBytes, ulParameters }`**：**区域的大小与对齐必须是同一个 2 的幂**（硬约束）
- `ulParameters` 可取（可相或）：读写、特权只读、只读、特权读写、可缓存/可缓冲、**永不执行** 等标志
- **每次任务切换时 MPU 会被动态重配**，为进入的任务授予其自身栈的读写权限
- **运行期可以改区**：`vTaskAllocateMPURegions(handle, regions)`（handle 传 NULL 表示修改当前任务），底层经端口函数写入硬件

**于是**：

```
任务 A 能访问 buffer X，任务 B 访问同一地址 fault
  → 不一定是内存损坏，可能是 MPU 策略

同一任务昨天能访问，运行到某阶段后不能了
  → 可能是因为运行期重新分配了 MPU 区域
```

另外：特权任务可访问整个内存映射；用户模式任务可访问除"特权专用"之外的全部 RAM/FLASH。端口层提供的降权入口（切到用户模式）**是单向的——无法再回到特权模式**。

## 决策树

```
拿到 FreeRTOS 目标
├─ 看到一个中断服务函数
│    ├─ 它调用的是 task 版还是 FromISR 版 API？
│    ├─ 是 task 版 → 先确认（上下文判定 / 符号或包装器识别）哪里错了
│    └─ 有 pxHigherPriorityTaskWoken + portYIELD_FROM_ISR → ISR 正常触发切换，不是混淆
├─ 中断优先级相关异常
│    ├─ 查该 ISR 的优先级是否高于 configMAX_SYSCALL_INTERRUPT_PRIORITY（更紧急）
│    ├─ 更紧急 → 它不应调用任何 FreeRTOS API
│    └─ 注意数值方向与任务优先级相反
├─ 某地址"有时能访问、有时不能"
│    ├─ 查是否 MPU 受限任务（xTaskCreateRestricted）
│    ├─ 查是否运行期调用了 vTaskAllocateMPURegions
│    └─ 别直接判堆/栈损坏
└─ 上下文判定
     └─ 区分任务上下文与 ISR 上下文（能否阻塞、能否触发调度）
```

## 工具与验证

- 上下文：ISR 与任务代码的入口、端口层的进入/退出宏、会话中使用的 API 变体
- 优先级：`configMAX_SYSCALL_INTERRUPT_PRIORITY` 相关配置与各中断的实际 NVIC 优先级
- MPU：任务的 `xRegions` 配置、运行期改区调用、端口层写硬件的路径
- 验证：能同时说清「上下文是任务还是 ISR + 所用 API 变体是否匹配 + 地址权限来自哪组 MPU 区域」

## 该平台的坑（汇总）

- **把 task 版与 FromISR 版 API 当可互换**：阻塞与调度语义完全不同
- **在中断上下文按阻塞语义继续分析**：ISR 不能阻塞，也不能在内部触发调度
- **忽略 `pxHigherPriorityTaskWoken`**：漏掉 yield 会让更高优先级就绪任务被推迟
- **以为 `portYIELD_FROM_ISR()` 立即切换**：通常是 pend，真正切换在中断退出后
- **把 ISR 尾部的调度代码当混淆**：那是正常的切换请求
- **忘记中断优先级数值方向与任务优先级相反**：判断"能否调用 API"会反
- **在高于 `configMAX_SYSCALL_INTERRUPT_PRIORITY` 的 ISR 里调用任何 API**：连 FromISR 也不行
- **把 MPU 导致的访问失败判成内存损坏**：受限任务的区域约束是配置决定的
- **假设 MPU 区域在任务生命周期内不变**：运行期可以重新分配
- **忽略"降权到用户模式无法回退"**：单向行为，不是权限丢失
