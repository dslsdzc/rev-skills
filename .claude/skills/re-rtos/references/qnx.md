# QNX Neutrino：资源管理器 / 消息传递 / io-pkt

<CORE RULE>
QNX 的"驱动"大量是**用户态 server**，不是内核模块。

```
open("/dev/foo")
  → pathname resolution（进程管理器）
  → resource-manager 进程
  → MsgSend / MsgReceive
  → io_open handler
```

而不是：

```
syscall → VFS → kernel driver file_operations
```

所以见到一个进程：**没有 ioctl 的 syscall handler、没有内核模块、却控制硬件**——这在 QNX 上不奇怪，是常态。

第一条经验不是"先反汇编内核"，而是**先判形态**：这份代码是 resource manager、是 io-pkt 加载的共享对象，还是真在内核态。判错一种，后面全部推理作废。
</CORE RULE>

## 一、先判形态（决定后面全部）

| 形态 | 表现 | 分析入口 |
|---|---|---|
| **resource manager 进程** | 独立进程，注册了 pathname，循环收消息 | `resmgr_attach` 的 path + connect/io 函数表 |
| **io-pkt 加载的网络驱动** | `devnp-*.so` 共享对象，**既不是独立进程也不是内核模块** | 被 `io-pkt -d <名>` 加载；驱动回调在 io-pkt 内执行 |
| **内核态（procnto）** | 微内核 + 进程管理器一体 | IFS 镜像 → `dumpifs` 解出 procnto 再分析 |

## 二、resource manager：认 API 序列，不认工具链习惯

一个典型 resource manager 的骨架是固定序列：

```
dispatch_create() / dispatch_create_channel(-1, DISPATCH_FLAG_NOLOCK)
  → resmgr_attr_t（nparts_max / msg_max_size）
  → iofunc_func_init()          # 载入默认 POSIX handler 表
  → iofunc_attr_init()          # 每设备属性
  → resmgr_attach(dpp, &attr, path, file_type, flags, &connect_funcs, &io_funcs, &handle)
  → dispatch_context_alloc()
  → 循环：dispatch_block() → dispatch_handler()
```

- 张量表分两张：**connect 函数表**（`open` / `unlink` / `rename` / `mknod` / `readlink` / `link` / `unblock` / `mount`）与 **I/O 函数表**（`read` / `write` / `devctl` / `stat` / `lseek` …）
- `resmgr_attach()` 一次做完三件事：把 pathname 注册进命名空间、创建收消息用的 channel、把 dispatch handle 与函数表绑起来
- **收消息的底层就是 `MsgReceive`/`MsgReceivev`**——`resmgr_context_t` 里的 `rcvid` 就来自它；`dispatch_block()` 阻塞等消息，`dispatch_handler()` 解析并按表分发
- **`iofunc_func_init()` 给的是可用的默认实现**——很多 handler 是默认的，不是每个设备都要重写 `stat`/`chmod` 那一套；只有被显式覆盖的（例如 `io_funcs.read = io_read;`）才是该设备自己的逻辑
- 多线程版本：`thread_pool_attr_t`（`block_func = dispatch_block`、`unblock_func = dispatch_unblock`、`handler_func = dispatch_handler`、`context_alloc/free`）+ `lo_water`/`hi_water`/`increment`/`maximum` → `thread_pool_create()` / `thread_pool_start()`。**`lo_water` 就是"保持多少个线程阻塞在 RECEIVE 上"**
- 私有消息走 `message_attach()`，此时**用 `dispatch_*()` 而不是 `resmgr_*()`**

**反推要点**：拿到一个进程后，先找 `resmgr_attach` 的 path 参数——**注册了什么 pathname 就是它的身份**；再找被覆盖的表项——**没被覆盖的走默认语义，被覆盖的才是业务**。

## 三、控制通道是 devctl，不是 ioctl

- 控制路径是 I/O 函数表里的 `devctl`（`io_devctl_t`），命令码用 `_IO_DEVCTL`；自定义消息用 `_IO_DEVCTL` 或 `_IO_MSG`
- 老式的 `other_func` 已被明确不推荐——**在旧样本里见到它说明代码年代较早**，别把它当"主要协议入口"
- 恢复顺序：`devctl` 命令码 → 参数结构 → 对应的硬件/共享内存操作；命令码常量常在二进制的只读数据里成组出现

## 四、io-pkt：网络驱动的第三种形态

- io-pkt 是**多线程进程**，内含网络栈与 resource manager 分发器；**栈上下文（stack context）是单线程的**（以伪线程处理阻塞）
- **阻塞栈上下文 = 阻塞整个 io-pkt 的 resource manager**：`ifconfig` 卡住常常就是栈上下文被阻塞，不是 ifconfig 本身的问题
- 原生网络驱动是 **`devnp-*.so` 共享对象**：`io-pkt -d some_driver` 会去找 `devnp-some_driver.so` 并把它加载为原生驱动；找不到时回退尝试 `devn-some_driver.so`（经 **`devnp-shim.so`** 兼容层）
- **`devnp-shim.so`** 提供对 io-net 时代 `devn-*` 驱动的向后兼容（通常自动加载；也可显式 `io-pkt -d shim "/lib/dll/devn-speedo.so"`）；经 shim 加载的驱动接口名形如 `enX`；用 `pidin me` 确认加载结果
- 驱动内建线程**不要用裸 `pthread_create()`**，用 `nw_pthread_create()`（由 io-pkt 跟踪，并要求实现 quiesce 回调）；定时器用 `callout_*`

**RE 含义**：一个 NIC 驱动可能既没有独立进程也没有模块文件——它只是**某个 `devnp-*.so`**。要分析它，得先确认"谁在加载它、加载进哪个进程"。

## 五、优先级继承：trace 里优先级突变 ≠ 调了 `pthread_setschedparam`

- QNX 的 Send/Receive/Reply 带**消息驱动的优先级继承**：server 线程**继承发送者的优先级**，请求按优先级顺序被接收
- 提升可能发生在**发送时刻**（不等到 server 收到）——这是为了避免"中等优先级线程卡住高优先级客户端的消息投递"这一 inversions
- **server 回复后优先级不自动恢复**：一直保持，直到被新的消息/pulse 抬高或压低，或被显式改动
- `ChannelCreate()` 的 **`_NTO_CHF_FIXED_PRIORITY`** 可关闭这一继承
- **server boost**：当 channel 上没有 RECEIVE-blocked 线程（客户端被 SEND-blocked）时，内核会**提升该 channel 关联的某个 server 线程**；其原始优先级在首次 boost 时被记录，下次收到消息时内核重新评估

所以：**线程优先级在采样里突然变化，先当作正常的 IPC 继承**；对应地，"一个设计良好的多线程 server 应当始终有至少一个 RECEIVE-blocked 线程"。

## 六、"长时间阻塞"在 QNX 经常是正常状态

- `MsgSend()` 是**同步**的：发送线程进入 `STATE_SEND`（已发送未被接收）或 `STATE_REPLY`（已被接收未回复），直到 `MsgReply*()`、信号、超时、server 死亡等才解除
- **pulse** 是另一类东西：**固定大小、非阻塞**，载荷是 4 字节数据 + 1 字节 code；用于中断处理通知或 server 无需阻塞地通知客户端；同样按优先级排队并被接收
- 注意：在自适应分区下，**pulse 不继承发送者的分区**（Send/Receive/Reply 会）——分区的观测差异不要当成调度 bug

因此：**"线程卡在 IPC"、"server 里看到一堆 RECEIVE-blocked 线程"都不是 deadlock 证据**，除非能同时给出阻塞对象（谁该 reply 却没 reply）。

## 七、分析主线

```
pathname
 → resource manager（哪个进程注册的）
 → channel / connection（谁连谁）
 → 消息类型（_IO_* / 私有 message / pulse）
 → handler（connect 表 / io 表 / devctl 命令码）
 → 硬件 / 共享内存 / 另一个 server
```

对多 server 系统，这条链可以继续接下去：**QNX 的"驱动栈"常常是一串 server**（例如文件系统、块设备、网络各是一个 server），而不是内核里的一条调用链。

## 决策树

```
拿到 QNX 目标
├─ 先判形态
│    ├─ 有 resmgr_attach / dispatch_* 序列 → 用户态 resource manager
│    │    ├─ resmgr_attach 的 path 是什么（即"设备名"）
│    │    ├─ 哪些 connect/io 表项被覆盖（其余走 iofunc 默认）
│    │    ├─ devctl 命令码 → 控制路径
│    │    └─ channel/connection：谁在 MsgSend 它
│    ├─ 是 devnp-*.so → 找加载它的 io-pkt，判是原生驱动还是经 devnp-shim 的旧 devn-*
│    └─ 真在内核态 → IFS 镜像（startup 头 0x00ff7eeb + "imagefs"）→ dumpifs 解出 procnto
├─ 动态观测异常
│    ├─ 优先级突然变化 → 优先当 IPC 优先级继承 / server boost，而不是主动改调度
│    ├─ 线程长时间阻塞 → 优先当 MsgSend 同步等待，而不是死锁
│    └─ 栈上下文被阻塞 → 整个 io-pkt 的 resource manager 一起卡
└─ 多 server 系统 → 沿 pathname→channel→server 继续走链，别指望在内核里找到完整调用链
```

## 工具与验证

- 线程/进程：`pidin`（含 `pidin me` 确认某个进程里加载了什么）、`/proc/<pid>/ctl` 的 `DCMD_PROC_TIDSTATUS` 一类侧信道读线程状态
- 命名空间：查进程注册了什么 pathname、谁打开了它——**把 pathname 当作跨进程的锚点**
- 静态：先按 API 序列识别形态（`resmgr_attach` / `dispatch_*` / `MsgReceive` / `io_*`），再谈逻辑；不要从 `_start` 顺着啃
- 网络：确认驱动是被哪个 io-pkt 加载、是 `devnp-*` 还是经 shim 的 `devn-*`
- 验证：能同时说清「形态（用户态 server / io-pkt 共享对象 / 内核态）+ 注册的 pathname 或加载者 + 消息与命令码路径」

## 该平台的坑（汇总）

- **拿 Linux 驱动思维找"驱动"**：QNX 上控制硬件的进程可能既没有内核模块也没有 ioctl handler——它是用户态 resource manager
- **把 `iofunc_*` 默认实现当业务逻辑**：`iofunc_func_init()` 填了一整套可用默认值，**只有被显式覆盖的表项才是这个设备的逻辑**
- **在 trace 里把 IPC 优先级继承当成主动调调度**：server 继承 sender 优先级，且在 send 时刻就可能提升、回复后不自动恢复；`_NTO_CHF_FIXED_PRIORITY` 是关闭开关
- **把 MsgSend 的同步阻塞当死锁**：发送线程本来就会一直等到 reply；pulse 才是非阻塞的那一类
- **忘了 pulse 与消息在自适应分区上的差异**：pulse 不继承发送者分区
- **在进程列表里找不到某个网络驱动**：它可能是被 io-pkt 加载的 `devnp-*.so`（既不独立成进程也不是模块）
- **把 `devn-*.so` 当原生驱动**：那是 io-net 时代的形态，经 `devnp-shim.so` 兼容加载，接口命名也不同（`enX`）
- **以为阻塞某个驱动回调没关系**：驱动回调可能跑在 io-pkt 的**单线程栈上下文**里，阻塞它等于阻塞整个网络 resource manager
- **在驱动里看到裸 `pthread_create` 就当普通线程分析**：io-pkt 要求用 `nw_pthread_create()` 并配 quiesce 回调
- **把 `other_func` 当协议主入口**：该机制已被明确不推荐，通常是老代码
