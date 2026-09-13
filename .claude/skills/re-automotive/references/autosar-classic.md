# AUTOSAR Classic：RTE 执行图 / 隐式访问 / OS-Application 保护

<CORE RULE>
AUTOSAR Classic 里**大量真正的控制流是配置驱动 + 代码生成出来的**：

```
TimingEvent / DataReceivedEvent / OperationInvokedEvent / ...
        ↓
       RTE（生成的胶水代码）
        ↓
   AUTOSAR Task 或 ISR2
        ↓
 RunnableEntity（业务函数）
```

所以：

```
void Runnable_10ms(void);   ← 0 个交叉引用
```

**绝不能直接判死代码。** 先找 `Rte_*` 包装、OS Task、`ActivateTask` / `SetEvent` / `WaitEvent` / Alarm / ScheduleTable，以及生成配置。
</CORE RULE>

## 一、执行图：RTE 没有独立调度能力

- RunnableEntity 由 **RTEEvent** 激活；事件类型包括定时、数据接收/接收错误、数据发送完成/写入完成、操作调用、异步服务调用返回、模式切换（及其确认/错误）、外部与内部触发、初始化事件、OS 任务执行事件等
- **RTE 不做调度**：每个 RTE Event 必须映射到一个具体的 OS Task，**RTE 在该 Task 被 OS 调度时按配置顺序调用相应 runnable**；映射必须写进 ECU 配置描述，作为 RTE 生成器的输入
- RunnableEntity 在 **OS Task 或 ISR2** 中执行
- 区分两个时刻：**activation**（RTEEvent 指向的事件发生）与 **start**（它的 C 函数在已启动的 task/ISR2 内被调用）
- 若某 runnable 没有被任何 RTEEvent 以 `startOnEvent` 角色引用，RTE **永远不会**激活它（但映射到 BSW 可调度实体的 runnable 仍可由 BSW 调度器激活）

## 二、隐式访问：消费者看到"旧值"可能是设计

- **隐式读**生成 `Rte_IRead_<port>_<data_element>`；**隐式写**生成 `Rte_IWrite_<port>_<data_element>`；显式读是 `Rte_Read_<port>_<data_element>(DataType*)`
- 隐式通信下，**RTE 在 runnable 被调用前自动读数据、在 runnable 结束后写回**；runnable 自身不主动发起传输；**写操作在 runnable 结束时才算完成**
- 可观察到的顺序：先为隐式读做数据元素拷贝，**之后**才触发 runnable 调用事件；runnable 终止事件**先于**隐式写回
- 隐式 S/R 通信**不支持 RTE API 的 trace 事件**

**所以**：

```
Producer:  x = 10;  x = 20;
Consumer runnable 执行期间一直看到 x = 10
```

**可能完全符合 RTE 语义**，不是 cache/一致性 bug。

**分析要求**：区分 `Rte_Read_*` / `Rte_IRead_*` / `Rte_Write_*` / `Rte_IWrite_*`，而不是只追底层 RAM 地址。通信形式由配置固定，**不能事后在代码里"改掉"**。

## 三、`E_OS_ACCESS` 不一定是"对象坏了"

AUTOSAR OS 的**分区表示是 OS-Application**，带所有权与保护状态：

- 若某 OS 对象标识被传给系统服务（例如 `ActivateTask`），而**调用方在配置时没有被授予对该对象的访问权**（如 `OsTaskAccessingApplication`），服务**返回 `E_OS_ACCESS`**
- 若服务调用针对**属于另一个、且不处于可访问状态的 OS-Application** 的对象，同样返回 `E_OS_ACCESS`
- **信任（trusted）与非信任（non-trusted）应用一视同仁**：默认拒绝，只有配置显式授予才能跨应用访问
- 例外：检查类服务（`CheckObjectAccess` 等）不需要授权——可用于调用前预判
- 信任级别只影响少数服务（例如终止应用：受信任应用的任务/中断可终止任意 OS-Application）
- 访问错误也可能触发保护钩子

**所以排查顺序是**：

```
对象属于哪个 OS-Application？应用状态？trusted / non-trusted？
内存保护？当前调用上下文？
        ↓
而不是先判"task ID 写错了"
```

- 另外：**Category 1 ISR 并不由 OS 完整管理**，因此常规 OS 保护不能简单覆盖这种上下文

## 四、并发问题多半在 OS 配置，不在应用逻辑

大量互斥区处理是**生成**的（RTE 自动保护、OS 资源、BSW 临界区），而不是手写。出现并发异常时，先核对 OS 配置：**runnable 映射到哪个 Task、优先级、ISR 抢占关系**，再看应用代码。

## 决策树

```
拿到 AUTOSAR Classic 目标
├─ 某个 runnable 没有调用者
│    ├─ 找 Rte_* 包装与 RTEEvent 映射
│    ├─ 找它被映射到的 OS Task（ActivateTask/SetEvent/Alarm/ScheduleTable）
│    └─ 别标 dead code
├─ 变量值与预期不符
│    ├─ 区分显式访问（Rte_Read_/Rte_Write_）与隐式访问（Rte_IRead_/Rte_IWrite_）
│    ├─ 隐式访问在 runnable 边界做快照/写回 → "看到旧值"可能是语义
│    └─ 别先判 cache 一致性或内存损坏
├─ 服务调用返回 E_OS_ACCESS
│    ├─ 查对象所属 OS-Application 与其实例状态
│    ├─ 查当前调用上下文（哪个 task/ISR）与信任级别
│    └─ 别先判参数错误
├─ 进程/任务不运行
│    ├─ 查 runnable 到 Task 的映射与 Task 是否被激活
│    └─ 查初始化/模式相关事件
└─ 并发异常
     └─ 先核对 OS 配置（Task 映射、优先级、抢占），再谈应用逻辑
```

## 工具与验证

- 执行图：ECU 配置描述（runnable → RTEEvent → OS Task 的映射）与生成的 RTE 胶水代码
- 访问语义：`Rte_Read_*` / `Rte_IRead_*` / `Rte_Write_*` / `Rte_IWrite_*` 的调用点与端口配置
- 保护：OS-Application 归属与访问权配置、状态检查服务、保护钩子
- 验证：能同时说清「runnable 由谁激活、在哪个 Task 里跑 + 数据是显式还是隐式访问 + 跨应用访问是否被授权」

## 该平台的坑（汇总）

- **把没有 caller 的 runnable 当死代码**：它由 RTEEvent 经 RTE 激活，映射在配置里
- **以为 RTE 会自己调度**：RTE 无独立调度能力，事件必须映射到 OS Task
- **混淆 activation 与 start 两个时刻**
- **把隐式访问的"旧值"当 cache/一致性 bug**：隐式访问在 runnable 边界做快照与写回
- **只追 RAM 地址不看 Rte_I* 系列**：无法区分显式/隐式语义
- **把 `E_OS_ACCESS` 当参数错误**：先查 OS-Application 归属与访问权配置
- **以为 trusted 应用可以随意跨应用访问**：默认拒绝，授权来自配置
- **忽略 Category 1 ISR 不受 OS 完整管理**：常规保护假设在这里不成立
- **在应用代码里找并发根因**：先核对 Task 映射、优先级与抢占配置
