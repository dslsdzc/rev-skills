# Xen：PV 前后端 / grant table / event channel / XenStore

<CORE RULE>
**不要把 Xen 的 PV 设备当普通 PCI/MMIO 驱动。**

典型 PV I/O 没有寄存器窗口，只有四件套：

```
frontend
  ├─ XenStore      ：交换配置（含 ring-ref / event-channel）
  ├─ grant table   ：共享 page
  ├─ shared ring   ：请求/响应
  └─ event channel ：通知
                   │
                backend
```

由此产生两类高频误判：**把 grant ref 当地址**、**把 event port 当 IRQ 号**。两者都只是**索引/句柄**，不是地址空间里的东西。
</CORE RULE>

## 一、XenStore：配置交换处，值以文本存放

- 前端在 XenStore 里记录后端域（`backend-id`，通常为 0），并把**共享 ring 的 grant 引用**写进去：`ring-ref`、`tx-ring-ref`、`rx-ring-ref`、`ctrl-ring-ref` 等
- 通知端口同样写进 XenStore：`event-channel`（网络控制环用 `event-channel-ctrl`）
- **值是字符串**（XenStore 是文本式的）——"ring-ref=42" 存的是文本 `"42"`，不是二进制字段
- **前端把内存共享给后端**（不是反过来）：前端用类似 `xenbus_grant_ring()` 的方式把本地分配的 ring 共享出去，再把引用告诉后端；后端拿到引用后在自己内核地址空间里分配页并映射

**RE 含义**：拿到一个 PV 前端，**先读它在 XenStore 里写了什么**——那里有后端域、ring 引用、事件端口，是恢复拓扑的现成入口。

## 二、grant reference 是**条目索引**，不是物理地址

```
ring-ref = 42
  ≠ page 0x2a / 物理地址 0x2a000

ring-ref = 42
  → 前端 grant table 的第 42 号条目
  → { flags, domid, frame(MFN) }
  → 后端据条目去映射那一页
```

- 每个域有自己的 grant table（一块与 hypervisor 共享的内存，由 guest 分配/初始化后经 hypercall 交给 Xen）
- 条目三个字段：**`flags`（操作与权限）、`domid`（被授权的远端域）、`frame`（被授权页的 MFN，注意是 MFN 而非虚拟地址）**
- **grant reference 就是条目下标**；下标被传给远端域，远端用它"激活"该条目
- 引用可以内嵌在 ring 消息里传递（如块设备的 `blkif_request_segment.gref`、网络的 `netif_tx_request.gref`）——**在 ring 里看到一个小整数，很可能是 gref，不是偏移或长度**

**权限与状态位（决定"能不能撤销"）**：

| 名称 | 含义 |
|---|---|
| `GTF_permit_access` | 允许远端域访问本域某页 |
| `GTF_accept_transfer` | 接受把一页转移进本域 |
| `GTF_readonly` | 只读导出/导入 |
| `GTF_reading` / `GTF_writing` | hypervisor 置位，表示该页**当前正被远端映射**（读/写） |
| `GTF_transfer_committed` | 转移已完成 |

- **映射期间 Xen 不支持撤销**：结束外来访问的调用**只是阻止后续映射**，不会撤销已建立的映射；发送方必须**等 reading/writing 标志清零**（用查询接口确认）之后才能真正回收
- 两种用法要分清：**保留所有权的 grant access**（块前端/后端：A 授权、B 映射、B 用完 unmap、A 再撤权）与**所有权的 transfer**（只适用于 PV；较老的网络前后端用它，新设计改为经 hypervisor 拷贝以避开 TLB 开销）

## 三、event-channel port 不是 IRQ number

```
event-channel = 17   ≠  hardware IRQ 17
```

- event channel 是 Xen 的通知原语（`event_channel_op` hypercall），类型包括 **VCPU/IPI、VIRQ、PIRQ、域间（interdomain）**
- 域间通道常用 `alloc_unbound` / `bind_interdomain` 建立，端口号通常经 XenStore 传给对端
- **端口整数绑定到每 guest `shared_info` 里的全局位掩码**（32 位 guest 为 1024 位，64 位 guest 为 4096 位）——这是"端口"在这个系统里的真实表示
- 用户态接口另有 `/dev/xen/evtchn`

**所以 trace 里出现 `port 17` 时，不要去 IOAPIC/GIC 里找 IRQ 17。**

## 四、迁移：**本地端口不稳定，远端端口才是稳定标识**

- 域间 event channel 本质是**一对端口**：本地端口 + 远端端口
- 持有者退出会关闭 `/dev/xen/evtchn`，内核随之关闭本地端口；**重新连接时是用原来的远端端口去绑定一个全新的本地端口**，新本地端口号**可能与旧值不同**
- 因此**要记录/对齐的是 remote port**；把本地端口号当作持久 object identity 会出错
- 更危险的一点：**本地端口号在解绑后可被重用**，残留引用会指向完全不同的通道

**这与 seL4 的 CPtr、Zircon 的 handle 是同一类坑**（见 [[re-kernel/sel4-kernel]]、[[re-kernel/zircon-kernel]]）：**整数句柄不是全局标识**。

## 五、shared ring 不是普通共享内存

典型流程：

```
前端拥有页 → grant 给后端 → gref 写入 XenStore
        → 双方各自映射同一批页 → event channel 只负责 kick
```

所以看到 **ring 内存持续变化、却找不到 `memcpy`/socket IPC** 是正常的——这是共享页 + 生产者/消费者索引的模型，通知只是"踢一下"。每个 ring 配一个 event channel：环变非空时唤醒接收方，变非满时唤醒发送方。

## 六、XenStore 是控制面，不是数据面

- **`state = Connected` 只表示协议协商完成**，不代表数据经 XenStore 传
- 真正的数据面可以是 **grant 共享 ring + event channel**：

```
XenStore 几乎没流量，设备 I/O 却很大
  → 正常
```

- **backend 不一定在 Dom0**：不要硬编码 `/local/domain/0/...`；前端里提供 **`backend` 与 `backend-id`** 用于明确定位 service domain——**正常 backend 区域不应当靠假设推导**

## 七、通知抑制：ring 前进却没有 kick 是正常的

- 生产侧的推送宏会**判断对端是否真的需要通知**：**只有新推进的请求越过了对端设置的 `req_event` 阈值时才发通知**（响应侧对称，用 `rsp_event`）
- 所以：

```
ring producer 前进 + 没有 event 发送
  → 完全正常
  → 对端已有工作在飞，它之后会自己再查 ring
```

- 顺序要求：写请求 → 写屏障（对端先看到请求）→ 更新 producer 索引 → 全屏障（对端先看到新请求）→ 再判断 `req_event`

## 八、"睡前再检查一次"是协议核心，不是奇怪 busy-loop

消费侧在准备睡眠时的标准形态：

```
发现无工作
  → 设置"下一个事件通知我"（req_event = req_cons + 1）
  → 全屏障
  → 再查一次 ring
```

- 这个屏障覆盖的竞态是：**producer 已经读过 `req_event`（因此决定不通知），而 consumer 随后才更新它**——不重新检查就会**丢唤醒**
- 已知副作用：按原样使用会带来"每 2^32 次事件一次多余唤醒"（索引回绕），实现里常见把事件指针推到过去的修法
- 另一个副作用：该宏**会推进 ring 的事件指针**，在 NAPI 类场景里可能"提前招来下一次中断"，所以有些路径只在真正切回中断模式时才用它

**所以不要把"双重检查"优化掉，也别把相关的强屏障当冗余。**

## 九、event channel 的掩码/待决语义：不是"使能位置 1"

- event channel 是**"一位事件状态"**模型；**unmask 不是简单地打开使能位**
- FIFO ABI 的 unmask 路径：清除 MASKED（连带 BUSY），**若 PENDING 置位则发起 unmask 调用**；该调用的语义要求：**若事件处于 pending，必须向对应 VCPU 投递通知**
- 因此"masked 期间事件到达、unmask 之后行为诡异"应从 **pending / masked / FIFO 语义**解释，而不是按普通中断使能理解

## 十、FIFO event ABI：优先级，以及两种 ABI 不能混

- **优先级 0 最高、15 最低**，默认 7；**每 VCPU 有 16 个事件队列**
- 每个事件是带标志的字：**PENDING / MASKED / LINKED / BUSY** 加上指向队列下一项的 LINK 字段；每 VCPU 控制块含 ready 字与 16 个队头
- 含义：**不同 event 的投递延迟可能来自 FIFO 优先级，而不是 vCPU 调度**
- **同一个 Xen build 里，事件记账布局可能完全不同**——存在 **2-level ABI 与 FIFO ABI**：

```
拿 shared_info 的 pending 位图解析器去解释 FIFO 控制块 → 全错
```

- 一个具体陷阱：**初始化 FIFO 控制块的操作不会重新投递当前 pending 的事件（它们会丢）**，因此应当在绑定任何事件之前完成

## 十一、迁移后的身份变化

迁移可能要求前后端**重新协商协议**，因为 **domid 与 event channel 状态不一定保留**：

```
迁移前：domid 7 / port 10
迁移后：domid 12 / 新连接
```

**不应当判设备劫持。（与 [[re-kernel/zircon-kernel]]、[[re-kernel/sel4-kernel]] 的句柄本地性同源。）**

## 十二、内存屏障是协议的一部分

ring 生产者索引更新的前后都有屏障，保证请求/响应数据**先对另一端可见**。**这些屏障不是编译器噪声，删除即破坏协议。**

## 决策树

```
拿到 Xen 目标
├─ 先判：PV 前端 / 后端 / 全虚拟化（HVM）设备？
│    ├─ PV → 找四件套：XenStore 条目 + grant ref + shared ring + event channel
│    └─ 找不到寄存器窗口/MMIO 循环 → 正常，PV 本来就没有
├─ 看到 `ring-ref = N`
│    └─ N 是 grant table 条目索引 → 去读条目 {flags, domid, frame}，不是地址
├─ 看到 `event-channel = N`
│    └─ N 是 event channel 端口（绑定到 shared_info 位掩码），不是 IRQ 号
├─ 页被远端访问 / 想回收页
│    ├─ 有 GTF_reading / GTF_writing → 映射仍在，撤销未生效
│    └─ 结束外来访问只阻止后续映射，必须等标志清零
└─ 迁移 / 重连后端口号变了
     └─ 正常：本地端口会重新分配，稳定的标识是 remote port
```

## 工具与验证

- 配置来源：XenStore 树（`~/device/...` 与 `~/backend/TYPE/DOMID/DEVID`）里的 ring 引用与事件端口；前端树里的 `backend-id`
- 内存路径：grant table 条目（flags / domid / frame）与 reading/writing 状态位
- 通知路径：event channel 类型（IPI / VIRQ / PIRQ / 域间）与端口号；用户态经 `/dev/xen/evtchn`
- 验证：能同时说清「拓扑（谁在前、谁在后、经哪个 XenStore 路径连接）+ 内存靠哪组 gref + 通知靠哪个端口」

## 该平台的坑（汇总）

- **把 grant ref 当物理地址/页码**：它只是本域 grant table 的条目下标，条目里才有 MFN
- **把 event-channel port 当 IRQ 号**：它是 Xen 的通知端口，绑定在 `shared_info` 的位掩码上
- **以为结束外来访问就能立刻回收页**：映射期间不支持撤销，必须等 `reading`/`writing` 清零
- **把 event port 整数当持久对象标识**：迁移/重连后本地端口会变；解绑后同一号码还会被重用
- **拿本地端口（而非远端端口）做对齐**：重连时稳定的是 remote port
- **在 ring 消息里把小整数当偏移或长度**：很可能是内嵌的 gref
- **看到 ring 内存变化却无 IPC 调用就认为分析有漏**：PV 的数据面本来就走共享页，通知只负责 kick
- **在前端/后端之间搞反共享方向**：是前端把 ring 共享给后端，再由后端映射
- **在 XenStore 里期待二进制字段**：它是文本式的，引用与端口都以字符串存放
- **把 XenStore 的 `Connected` 当数据面在传**：它只表示协商完成；数据在 grant 共享 ring 上
- **硬编码 backend 在 Dom0**：应读前端的 `backend` / `backend-id`
- **把"ring 前进却没通知"当丢事件**：通知抑制是协议设计
- **删掉消费侧的双重检查或强屏障**：那正是防丢唤醒的部分
- **按"中断使能位"理解 event unmask**：masked/pending 语义不同，pending 必须投递
- **用一套事件解析器解释两种 ABI**：2-level 与 FIFO 的记账布局不同
- **在绑定事件之后才初始化 FIFO 控制块**：当前 pending 的事件会丢
- **把 FIFO 优先级造成的延迟归因于 vCPU 调度**
- **把迁移后的 domid/端口变化判为劫持**：需要重新协商属正常
