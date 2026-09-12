# seL4 分析分支：capability 系统的逆向

<CORE RULE>
遇到 seL4 系统，**首先恢复的不是"模块调用图"，而是「对象图 + capability 分布 + IPC 拓扑 + VSpace/设备映射」**。
原因：seL4 的内核只提供机制，**绝大部分驱动与服务都在用户态**——设备 MMIO、IRQ 等通过 capability 暴露给用户态线程。
所以本分支的核心经验不是"内核模块怎么逆"，而是**如何不把 capability 系统的行为误判成普通 OS 行为**。
</CORE RULE>

## 一、先识别运行模型（决定后续一切）

拿到一个 ELF，**别先假设它是"普通进程"**。先判断它属于哪一类：

`root task` / 裸 libsel4 component / **capDL-loaded** / **CAmkES component** / MCS / VM(VMM) / user-space driver

- **capDL loader 按静态 specification 创建 kernel objects、CSpace、VSpace，再把 ELF 装进去** → **ELF 本身 ≠ 完整系统语义**：capability 的关键关系可能根本不在 ELF 的普通数据结构里，而在 capDL spec / CAmkES 生成物中
- 经验路径：**发现 capDL/CAmkES 痕迹 → 优先找 `.cdl` / 生成的 capDL / CAmkES ADL → 恢复对象图 → 再回 ELF 找业务代码**
- `.cdl` 对 seL4 RE 的价值**可能比完整符号表还大**

## 二、CPtr 是本地地址，不是全局对象 ID（最核心的一条）

`seL4_Call(0x12, ...)` 里的 `0x12` 是**该线程自己 CSpace 中的 capability address**——从它 TCB 里的 root CNode 起解析；另一个 component 里同样的 `0x12` 完全可能指向另一个对象。

所以下面这种推断是**错的**：

```
component A: Call(0x12)
component B: Recv(0x12)
   → "A 和 B 通信"          ← 错
```

必须恢复各自的 CSpace 映射，再**按 kernel object 对齐**：

```
A CSpace: 0x12 → Endpoint E1 [Write]
B CSpace: 0x34 → Endpoint E1 [Read]
即： A:0x12 → E1 ← B:0x34
```

**稳定的 identity 是 kernel object，不是 CPtr 数值。**

## 三、capDL-loaded 程序里不要照搬 root-task 语义

- 内核为 **root task** 建立的初始环境是：TCB + **一个** CNode（作为 CSpace）+ VSpace；`seL4_CapInitThreadCNode`（slot 2）是**指向初始 CSpace 的 CNode path/capability**（不是它指向的对象），`seL4_CapInitThreadVSpace`（slot 3）同理；初始 CNode 的 guard 被选成恰好解析 32 位
- capDL loader 以 root task 身份运行，**按 spec 创建**各应用的 CSpace/VSpace 并装入 ELF——这些 CSpace 来自 spec 与 loader 安装的 caps
- 因此 capDL-loaded 应用里的 `seL4_CapInitThread*` 常量**不能机械当成"TCB/CNode/VSpace"**：先确定"这是 root task 还是 loader 创建的子线程"，否则整张 capability graph 会标错

## 四、IPC 看起来像普通函数调用？先怀疑 CAmkES glue

CAmkES 会在 component/connector 周围生成大量 glue（marshal / selector switch / unmarshal）。反编译出来的东西可能长这样：

```
foo_rpc_call() → marshal → seL4_Call() → unmarshal     ← 真正的业务逻辑只有 foo_rpc_call()
server: seL4_Recv() → selector switch → unmarshal → 用户实现 → marshal → Reply
```

**不要把几十个 generated stub 当成几十个协议。** 处理：识别 CAmkES → 找 connector 类型 → 标识并**折叠 glue** → 提取 `interface / method ID / arguments / endpoint / badge / component pair`，最终得到 `Client.foo(x) --seL4RPCCall--> Server.foo(x)`——比纯 CFG 有意义得多。

## 五、Badge：可能是"调用者是谁"，也可能是一组事件位

- `seL4_Recv(ep, &badge)`：sender 信息来自 **sender 所用 capability 的 badge** → 看到 `if (x == 4)` 未必是消息类型，可能是**调用者身份**
- **Notification badge 可按 bit OR 聚合** → `badge == 0x5` 可能表示 event 0x1 + event 0x4，而不是"编号 5 的事件"
- 判据：`switch equality` → 偏 identity；`badge & MASK` → 偏 bitset/events
- badge 还能被 **Mint** 重新设置（API 允许），所以同一对象可以带多个不同 badge 的 cap

## 六、CSpace 查找失败 ≠ 槽为空

CSpace 是多级 CNode，且 **CNode capability 自身带 guard / guard_size**；寻址 CNode 还要给 **depth**。

lookup 失败的分类：**Invalid Root / Missing Capability / Depth Mismatch / Guard Mismatch**。

所以看到 `seL4_CNode_Copy(..., index=0x1234, depth=32, ...)` 要恢复的是 **CSpace radix/guard 路径**，而不是简单画一个"slot 0x1234"。

## 七、错误码是诊断信息，不要一律标成 generic error

| 错误码 | 含义（RE 视角） |
|---|---|
| `seL4_DeleteFirst` | 目标 CSlot **已经有 capability**（Copy/Mint/Move/Retype 要求目标为空）；映射类操作表示目标地址已有映射 |
| `seL4_RevokeFirst` | untyped **已被 retype 过**，或存在该 cap 的副本（另有 CB / IRQ handler / vspace service cap 已存在等场景） |
| `seL4_FailedLookup` | index/depth 无效，或 root 是类型不对的 capability |
| 其他 | `InvalidCapability`、`IllegalOperation`、`RangeError`、`TruncatedMessage`、`NotEnoughMemory`、`AlignmentError` |

**这些错误码暴露了作者期望的对象状态**——保留具体分支，比统一写成 `if (err != 0)` 有价值得多。

## 八、Untyped 分配：不是 malloc

- 路径：`Untyped → Retype → Endpoint / TCB / CNode / Frame / ...`；对象大小 `2^n` 且按 `2^n` 对齐；retype 要求 untyped 足够大 + 目标 CNode 有足够的**连续空 CSlot**
- 看到一个"按 size 降序排列的奇怪 allocator"：不要当成自定义 slab 算法——很可能只是**为降低 untyped retype 的对齐碎片**（小到大顺序会浪费）；要分配**特定物理地址**时，必须从 untyped 起点到目标地址按 2 的幂块全部占掉
- **删除子 cap ≠ 物理区间立刻可用**：往往要 **Revoke 父 untyped** 清掉派生对象，才能真正重用

## 九、Device untyped：只能变成 Frame（且限制更多）

- manual：**device untyped 只能 retype 成 frame 或子 untyped**——不能创建 TCB / Endpoint / CNode / 页表
- 额外限制：device frame **不能作为 IPC buffer**（`seL4_TCB_SetIPCBuffer` → `IllegalOperation`）、**不能用于创建 ASID pool**、ARM 上**不能做成可执行 frame**（内核不会对设备内存做 cache 维护）
- `device` 属性表示"**内核不能写**"的内存（MMIO，或内核窗口外的 RAM）；**属性会被子 untyped 继承**，无法更改
- 逆向主线：`Untyped → Frame → Map → volatile MMIO 读写` → 先判"这是设备寄存器映射还是共享内存" → 物理地址 → DTB/平台内存图 → 设备 → 寄存器偏移。**这才是 seL4 用户态驱动分析的主线**

## 十、IRQ 不进内核 handler，走用户态驱动

官方路径：

```
IRQControl → IRQHandler capability → bind Notification
   → 硬件中断 → 内核 signal Notification → 用户驱动 seL4_Wait() → 处理 → seL4_IRQHandler_Ack()
```

- 看到 `seL4_Wait(ntfn, &badge)` + `seL4_IRQHandler_Ack(irq_cap)` → 基本可判为 **IRQ 处理循环**
- **中断只来一次** → **先查有没有 Ack**（未 Ack 内核不会继续送后续中断），而不是先怀疑 Notification 坏了或路由配错

## 十一、MMIO 正常但 DMA 诡异：isolation proof 管不到 DMA

- seL4 的形式化保证**假定 MMU 能完全控制内存**；普通 DMA 设备可**绕过 CPU MMU 直接写物理内存**，因此 DMA **不自动落在核心 isolation 证明内**（需要 IOMMU/SystemMMU 才进入相应范围，且并非所有配置都在同一验证范围）
- 所以安全逆向时：**"A 没有 B 的 frame cap" 不能推出 "A 绝对改不了 B 的内存"**——还要问：A 是否**控制 DMA 设备**？IOMMU/SystemMMU 是否启用、如何配置？DMA mapping policy 是什么？
- **这是 capability graph 分析最容易漏掉的一条旁路**

## 十二、Fault 不等于"线程被内核杀掉"

fault 可以作为 **IPC** 送给指定 fault-handler 线程（官方教程就是这种设计）——程序 fault 之后继续执行并不奇怪：

```
thread faults → 内核构造 fault IPC → fault endpoint → handler 收到
   → 修改 mapping/register/capability → reply/resume
```

所以 `Recv(endpoint) → decode_fault() → write_regs() → reply()` 很可能是 **exception pager / fault handler**，而不是普通 RPC server。

**同一个 fault 反复出现**时：先判断 handler 是否真的修复了 fault 原因（mapping/register/IP）——没修就恢复线程，会立刻再次触发同一个 fault（官方明确说明），**不要先怀疑 kernel fault 循环坏了**。

## 十三、MCS 与 non-MCS 必须先分辨（大坑）

MCS 内核引入：**SchedulingContext（budget/period）**、**Reply object**、**passive server**、**SC donation**、**timeout fault**，且 **IPC ABI 有差异**。

- 拿到 binary 先判断 **MCS / non-MCS**，否则很容易把 **reply object** 误判成普通 endpoint/capability 参数
- SC 由 untyped retype 创建、`seL4_SchedControl_Configure` 配置（`budget == period` 即时间片/轮转；`budget < period` 即周期任务）；**线程没有 SC（或被捐赠）就不能运行**
- 捐赠机制：`seL4_Call` 捐赠 SC、`seL4_ReplyRecv` 归还；**server 必须处于"在 endpoint 上等待"状态**才会发生捐赠
- timeout fault 由 `seL4_TCB_SetTimeoutEndpoint` 注册处理
- **reply object 被撤销会打断调用链**：链中间的 reply object 被 revoke/delete → SC 再也回不到发起者（内核刻意不保留这条链）——多级调用链分析时要注意

## 十四、两条容易被判成"配置坏了"的正常现象

1. **server 没有 SchedulingContext 却能运行**：MCS 下这是**合法的 passive server**——它没有自己的 SC，阻塞在 endpoint 上，用 client 捐赠的 SC 执行，reply 后 SC 归还。看到"有 TCB 但没有 SC"不要判"这线程不可能运行 / capDL 配置损坏"
2. **线程"卡住"不一定是锁**：MCS 下即使优先级最高且未 blocked，**仍需要有可用 budget** 才能运行；budget 耗尽会等 replenishment。排查顺序：`blocked? → SC bound? → budget remaining? → replenishment? → passive/donated SC?`——不要只套 POSIX 的 mutex/deadlock/starvation
   - 同理：server 突然跑不动，也可能是 **client 预算不足** / **SC 捐赠链断了** / **server 没正确 ReplyRecv**

## 十五、capDL snapshot：静态图 vs 运行时图的 cross-view

- 调试构建（`CONFIG_DEBUG_BUILD` / `SEL4_DEBUG_KERNEL`）下 `seL4_DebugSnapshot()` 输出当前内核状态的 **capDL dump**；`seL4_DebugCapIdentify(cap)` 返回 capability 的类型号
- **注意形态**：据 devel 邮件列表，`seL4_DebugSnapshot` 不是普通文本转储——它等待命令字（0xa0–0xff）并回传**二进制数据**（实现见 `src/arch/*/machine/capdl.c`、`include/machine/capdl.h`）；syscall ID 随架构不同（如 AArch64 与 RISC-V32 不同）
- 用法（很强的 cross-view）：把**静态推导的 capability graph** 与**运行时 capDL snapshot** 对比——差异即运行时发生过的 **cap transfer / Mint / Copy**

## 十六、capability 图必须带 rights

同一个 endpoint，三种 cap 能力完全不同：

```
A: Endpoint E [Write]
B: Endpoint E [Read]
C: Endpoint E [Read, Write, Grant]
```

capDL 记录 **Read / Write / Grant / GrantReply + badge + guard** 等参数；**Grant / GrantReply** 直接关系 IPC 中的 capability transfer 与 reply 权限。

所以安全分析要画 **object graph + rights**，而不是 `component ↔ component`——否则会高估或低估攻击面。

## 逆向决策树（压缩版）

```
发现 seL4 binary/system
├─ 1 先识别运行模型：root task / 裸 app / capDL / CAmkES / MCS / VM(VMM)
├─ 2 重建对象图：TCB / Endpoint / Notification / CNode / Frame / Untyped / IRQHandler / SchedulingContext
├─ 3 重建 capability graph：CPtr 是本地地址 + rights + badge + guard/depth + derivation
├─ 4 重建通信：Send/Recv、Call/Reply、capability transfer、Notification、fault IPC
├─ 5 行为异常时按症状查：
│     FailedLookup → depth/guard/path/cap 类型
│     DeleteFirst  → 目标 slot 非空
│     RevokeFirst  → 存在派生/子对象或副本
│     fault 循环   → handler 没修 fault
│     线程不跑     → MCS 的 SC/budget/捐赠链
│     passive server 不跑 → SC donation
│     IRQ 只来一次 → 没 Ack
└─ 6 涉及设备时：device untyped → MMIO frame → Notification↔IRQ → Ack → DMA 另查 IOMMU/SystemMMU
```

## 工具与验证

- 静态：`capDL-tool`（解析 `.cdl` 得到对象与 cap 分布）、CAmkES 生成的 glue 与 ADL、`readelf`（ELF 层）
- 动态：QEMU 仿真目标系统；调试构建下用 `seL4_DebugSnapshot`（二进制 capDL 协议）/ `seL4_DebugCapIdentify`
- 验证：能同时给出「运行模型判定 + 对象图 + 带 rights 的 capability 图」——只给"两个 component 通过 Endpoint 通信"是不够的

## 该平台的坑（汇总）

- **把 `seL4_Call(0x12)` 里的数值当全局 ID**：CSpace 本地地址，跨 component 无意义
- **对 capDL-loaded 应用照搬 root-task 的 slot 语义**：整张 capability graph 会错
- **把 CAmkES glue 当协议**：先折叠生成代码
- **把 badge 当 enum**：可能是身份，也可能是 bit 聚合的事件集
- **把 FailedLookup 当"槽为空"**：还可能是 depth/guard/path/类型问题
- **把错误码统一成 generic error**：丢掉作者期望的对象状态
- **把 device untyped 当普通内存**：它只能变 Frame，还不能当 IPC buffer / ASID pool / 可执行 frame
- **IRQ 只来一次就怀疑内核**：先看有没有 Ack
- **"A 没有 B 的 cap" 就断定隔离成立**：忘了 DMA 旁路（查 IOMMU）
- **fault 后程序继续跑 = 见鬼**：那是 fault handler 在按设计工作
- **把 MCS 的 reply object 当普通 cap 参数**；**把 passive server 当配置损坏**；**把 budget 耗尽当死锁**
