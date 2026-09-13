# Fuchsia / Zircon：handle 模型 / DFv2 驱动框架 / FIDL

<CORE RULE>
两条会把整条分析链带错的事实：

① **Zircon 的 handle 整数值只在当前进程内有意义**——它和 seL4 的 CPtr 是同一类坑（见 [[sel4-kernel]]）；
② **驱动是用户态 component**——不在内核里，不是"另一种 kext/`.sys`"。

```
handle（进程本地数值）
  → 该进程的 handle 表
  → 内核对象
  → rights
```

这三者必须一起恢复。**只拿 handle 数值做跨进程对齐，一切结论都不可信。**
</CORE RULE>

## 一、handle 语义：数值不是对象的全局 ID

- handle 的整数**只对当前进程有意义**：**同一个数值在另一个进程里可能根本不对应任何 handle，也可能对应完全不同的内核对象**
- **handle 被关闭后，其数值允许被重用**
- 因此下面这条推理是**无效**的：

```
A: zx_channel_write(0x4f, ...)
B: zx_channel_read(0x4f, ...)
  → "同一个 channel"
```

  正确做法是分别恢复两个进程各自的 handle 表，**按底层的 kernel object 对齐**，而不是按数值对齐。

## 二、handle 可以"随消息搬家"：in-transit 与 transfer

- channel 不只是传字节，**还能传 capability**：handle 写进 channel 后，会**从发送进程移除**并挂到消息上，接收方读到后拿到**新的 handle**
- **传输途中属于 in-transit 状态**：只绑定在进程上或只绑定在内核中；**绑定在内核中的 handle 对用户态不可见**——"in-transit 的 handle 在用户态看不到"是设计如此，不是丢失
- 所以 trace 里出现下面这种序列**可能是完全正常的**，不是 UAF：

```
A 曾持有 handle 0x57
  → channel_write 把它送走
A 再访问 0x57 → BAD_HANDLE
```

- 权限约束：channel 自身需 `ZX_RIGHT_WRITE`；**被发送的每个 handle 需 `ZX_RIGHT_TRANSFER`**
- **写入失败不等于 handle 还在**：失败时 handle 被**丢弃而非转移**（写操作被改成"始终消费"语义）。所以"调用失败了，那它应该还持有这个 handle"是错的
- 原子性：一次写入中的 handle **要么全部进入 channel，要么全部被丢弃**
- 变体 `zx_channel_write_etc`：每个 handle 包在 `zx_handle_disposition_t` 里，操作为 **`ZX_HANDLE_OP_MOVE`**（等价于 `handle_replace` + write，源 handle 总是被关闭）或 **`ZX_HANDLE_OP_DUPLICATE`**（源 handle 保留）
- **rights 只能收窄不能放大**：可以在传输时降权，甚至可以置为 `ZX_RIGHT_NONE`；**若移除了 `ZX_RIGHT_TRANSFER`，接收方拿到的 handle 就无法再转手**——这是"为什么这一段传不下去了"的常见解释
- 特例：**in-transit 且它所在的 channel/socket 被销毁 → 该 handle 被关闭**

**推论**：reachability / security 关系图必须同时记录 **object + handle + rights**——两个 handle 可以指向同一个对象却持有不同的 READ / WRITE / MAP / TRANSFER 权限，"同一个对象"不等于"同样的能力"。

## 三、DFv2：驱动是用户态 component，绑定靠 bind rules 不是 probe

DFv2 的实体分工：

| 实体 | 职责 |
|---|---|
| **driver manager** | 启动/停止驱动、为驱动路由 FIDL capability、**维护全部节点（node）的拓扑** |
| **driver host** | 承载驱动实例的进程（独立地址空间与线程）；**一个 driver host 可以同驻多个驱动** |
| **driver index** | 登记全部可用驱动及其元数据（component URL + **bind rules**），按请求对节点做匹配 |
| **driver runtime** | 同驻驱动之间的本地通信机制 |
| **FIDL** | 驱动之间、驱动与框架、驱动与非驱动组件之间的主要通信方式 |

绑定序列：

```
父驱动创建子节点
  → driver manager 向 driver index 发 MatchDriver
  → driver index 用各驱动的 bind rules（字节码）比对节点属性
  → 返回最匹配驱动的 URL
  → driver manager 创建/复用 driver host，启动驱动实例（Start()）
  → 驱动可以再创建子节点，循环继续
```

**所以不要去找 Linux 式的 `bus probe()`**：应恢复的是

```
node properties → bind rules → driver index → driver component → driver host → FIDL services
```

驱动还有层级之分（boot driver / base driver / universe driver）——**"系统里没有这个驱动"先按加载来源分层看**，universe driver 是开发期手动登记的。

## 四、同驻驱动：syscall trace 里找不到 channel 调用，不一定是分析错了

- **同驻（co-located）**：驱动可以要求被放进父驱动所在的 driver host，从而**共享同一地址空间**
- 同驻驱动之间，**driver runtime 提供进程内通信路径**——比走内核 channel 更快，代价是**不产生 `zx_channel_write()` 这类 syscall 痕迹**

所以：**功能上明显发生了 driver A → driver B 的 IPC，但 syscall trace 里干干净净**——先怀疑 driver-runtime local transport，而不是"看漏了"或"样本在隐藏调用"。

- 相关的还有 node "symbols"（键值对，值可含虚拟地址）：**仅在父子同驻同一个 driver host 时用于进程内通信**；不同驻时走 FIDL
- 反向推论：**看到大量直接内存地址交换，往往说明这两个驱动同驻**——这本身是一条拓扑证据，可用于恢复 driver host 划分

## 五、`/dev/foo` 不是 Unix 设备文件

- 打开 devfs 里的 entry 后，**拿到的通常是一个 FIDL channel**，之后的通信走 FIDL，而不是 read/write/ioctl 那套设备文件语义
- 新工具链还在**逐步从 devfs 转向 service discovery**：设备能力的暴露方式随年代变化，**"我在 `/dev` 里没找到它"不等于它不存在**

## 决策树

```
拿到 Fuchsia 目标
├─ 先问：这是用户态 component 还是内核？
│    ├─ 用户态（绝大多数驱动与系统服务）→ DFv2 模型
│    └─ 内核（Zircon 本体）→ 内核对象与 handle 表
├─ handle 相关
│    ├─ 跨进程比对 handle 数值 → 无效！改成按 kernel object 对齐
│    ├─ 曾经有 handle、现在 BAD_HANDLE → 先查是否被 channel_write 送走（in-transit/transfer）
│    └─ 传不过去 → 查 ZX_RIGHT_TRANSFER 是否被移除（rights 收窄过）
├─ 设备/驱动相关
│    ├─ 别找 bus probe() → 恢复 node properties → bind rules → driver index → driver host
│    ├─ 驱动"没加载" → 分辨 boot/base/universe 来源
│    ├─ 有 IPC 但无 syscall → 查是否同驻同一 driver host（driver runtime local transport）
│    └─ 找设备 → 别只翻 devfs，现代路径可能走 service discovery
└─ 权限/能力异常 → 画 object + handle + rights 三方关系图，而不是只看对象图
```

## 工具与验证

- 拓扑：driver manager 维护的 node 拓扑、driver index 的匹配结果（node → bind rules → driver URL）
- 组件与进程：driver host 是进程——**同驻与否可以从 driver host 划分直接读出来**，也是解释"无 syscall IPC"的关键证据
- 通信：FIDL 调用链（驱动与框架/其他组件的主路径）
- 验证：能同时说清「对象归属（哪个进程的哪个 handle）+ rights + 通信路径（FIDL / 同驻本地通道 / 内核 channel）」

## 该平台的坑（汇总）

- **把 handle 数值当全局对象 ID**：数值只在进程内有效，跨进程比对无意义，关闭后数值还会被重用
- **把 in-transit 当丢失**：绑定在内核中的 handle 对用户态不可见是正常状态
- **把"送走后再访问报 BAD_HANDLE"当 UAF**：transfer 成功后发送方本来就不再持有
- **以为写入失败 handle 就还在**：失败时是被丢弃而不是转移
- **忽略 rights**：同一对象上的两个 handle 能力可以不同；`ZX_RIGHT_TRANSFER` 被移除会让能力无法继续传递
- **按 Linux 思路找 bus probe()**：Fuchsia 的绑定是 node properties + bind rules 由 driver index 匹配
- **在 syscall trace 里找不到 IPC 就认为分析错了**：同驻驱动走 driver runtime 的进程内通道，本来就不产生内核调用
- **用 Unix 设备文件模型理解 `/dev/foo`**：打开后通常得到 FIDL channel；新代码还在转向 service discovery
- **把同驻驱动的内存地址交换当信息泄露或异常**：那是父子同驻 driver host 时的正常进程内通信机制
