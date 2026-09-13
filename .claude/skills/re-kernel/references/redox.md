# Redox OS：scheme / 用户态服务 / 描述符映射

<CORE RULE>
Redox 的核心抽象不是"VFS + 内核驱动"，而是 **scheme**：

```
普通程序 read()/write()/mmap()
  → 内核翻译成 SQE 消息
  → scheme provider（通常是用户态 daemon）处理
  → CQE 消息 → 内核转成系统调用返回值
```

所以 **`read()` 不必然意味着文件系统**——它可能是网络、设备、IRQ 抽象或任意系统服务，**含义由目标 scheme 决定**。

第二条：**scheme 侧的 handle 描述符 ≠ 客户端的 fd**，两者由内核映射，**不能跨侧比较整数**。
</CORE RULE>

## 一、scheme 的形态

| 类型 | 提供者 |
|---|---|
| **用户态 scheme** | 用户态程序（通常是 daemon）——**可能实现的都放用户态** |
| **内核 scheme** | 内核直接实现（只保留关键部分） |

- 根 scheme（`:`）是内核提供的特殊 scheme，作为**所有其他 scheme 名字的容器**
- provider 通过创建 `":myscheme"` 建立 scheme，**返回的文件描述符就是它与内核之间的消息通道**

## 二、内核侧的转换与映射

- 普通程序的文件操作被内核**翻译成 SQE 消息**交给 provider；provider 用 **CQE 消息**回应，内核再把它转成系统调用的结果
- SQE/CQE 是双向队列条目：**opcode（Open/Read/Write…）、flags、tag（请求 ID）、caller（调用方进程 ID）、args（操作相关参数）**
- **描述符映射是关键**：`open` 请求里带待打开项的名字，scheme 分配自己的编号描述符；**这个描述符与客户端的文件描述符不是同一个**——内核在 `(客户进程, fd 号)` 与 `(provider 进程, handle 号)` 之间做映射，并把它们放进消息包

**RE 含义**：trace 里两侧各有一个整数句柄，**它们本来就不该相等**；建立关系要经内核的映射，而不是比较整数。

- **阻塞语义**：客户端做阻塞 read/write 时被挂起；内核对 provider 的事件描述符发事件包把它唤醒；完成后客户端被标记就绪并放入运行队列
- **缓冲区捕获**：对 `read(fd, buf, len)` 这类操作，内核把调用方缓冲区暴露给 provider——头部拷贝、**中间页零拷贝**（pin 住）、尾部处理
- **FD 传递**：scheme 可以当 IPC broker，把描述符插进调用方的文件表
- **内存映射**：用户态 scheme 经专用 opcode 提供 mmap 区域
- **命名空间**：进程继承父命名空间；较新的架构把命名空间管理移到**用户态 manager 守护进程**，scheme 在内核里匿名创建，请求经 `openat` + 命名空间描述符分发

## 三、daemon 侧的固定套路（决定了它的行为边界）

一个 scheme provider 的典型初始化：

1. 创建 scheme（拿到 fd）
2. 打开它需要的资源 fd（中断、定时器、事件等）
3. **进入 null namespace（`setrens(0,0)`）——此后无法再按名字打开普通资源**
4. 把要监听的事件 fd 登记到事件 scheme
5. 进入循环：等事件 → 读事件判断是定时器 / 资源事件（如设备中断）/ scheme 请求 → 处理请求 → 按 tag 回响应

**所以**：

```
driver 初始化后进入 null namespace、随后打不开普通资源
  → 不是 sandbox 异常，是安全设计
```

## 决策树

```
拿到 Redox 目标
├─ 一次 read/write 背后是什么
│    ├─ 先定位它是哪个 scheme（路径的 scheme 名即"类型"）
│    ├─ 用户态 scheme → 找对应 daemon
│    └─ 别默认它是文件系统
├─ 两侧句柄对不上
│    ├─ 客户端 fd 与 provider 描述符本就不相等
│    └─ 经内核映射建立关系，别比较整数
├─ 某个进程之后打不开新资源
│    └─ 可能是 provider 主动进入 null namespace（安全设计）
├─ 想看消息内容
│    └─ 按 SQE/CQE 条目解析：opcode / flags / tag / caller / args
└─ 设备/中断相关
     └─ 中断等资源也可以作为 scheme 暴露，未必是内核驱动
```

## 工具与验证

- 服务拓扑：路径里的 scheme 名 → provider daemon；scheme 的创建点（`:name`）
- 请求流：SQE/CQE 条目字段（opcode / tag / caller / args）与响应匹配
- 句柄：客户端 fd 与 provider 描述符的内核映射关系
- 验证：能同时说清「这次 I/O 落到哪个 scheme + provider 是谁 + 两个句柄是怎么对应的」

## 该平台的坑（汇总）

- **把 read/write 默认当文件系统**：含义由 scheme 决定
- **跨侧比较句柄整数**：客户端 fd 与 provider 描述符由内核映射，不等价是常态
- **把进入 null namespace 当沙箱异常**：那是 provider 的安全设计
- **在内核里找设备驱动**：驱动多为用户态 daemon（含 IRQ 等资源的 scheme 暴露）
- **忽略消息协议**：请求/响应是带 tag 的队列条目，不是裸 buffer
- **把阻塞归因于死锁**：客户端阻塞是设计，由 provider 的事件唤醒机制驱动
- **忽略 fd 传递能力**：scheme 可以充当 IPC broker，fd 会经内核插入调用方文件表
