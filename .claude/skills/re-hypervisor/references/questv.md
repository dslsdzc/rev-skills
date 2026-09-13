# Quest-V：多内核 sandbox / 每 sandbox 一个 monitor / 故障与在线恢复

<CORE RULE>
不是"一个 hypervisor 管所有 VM"，而是**多个 sandbox kernel，每个配一个自己的 monitor**：

```
sandbox domain = 一个或多个 CPU + 一块主机物理内存
                 （内含【本地 monitor】+ sandbox kernel + 本地应用）

monitor 只为【一个】sandbox 维护 EPT 映射
  → 省掉传统 hypervisor 调度/切换 guest 地址空间的开销
```

于是两条容易误判成"缺失"的现象其实是设计：

```
没有大量 VM-exit          → sandbox 自己管 I/O
没有中央调度器/全局时钟    → 每 sandbox 自己调度、自己的物理时钟
```
</CORE RULE>

## 一、monitor 什么时候才被调用

**只在四件事上介入**：

```
① 引导各内核（bootstrapping）
② 处理故障（fault）
③ 管理与发起影子页表（shadow page tables）
④ 建立 sandbox 间通信通道
```

其余时间 **sandbox 直接在硬件上运行**。

- monitor 可以按**每核**建立，也可以为一个**核的集群**建立（"域/单元"）——**不是天然一核一 monitor**
- monitor 跟踪**影子页表映射**，这些映射表达**不可变的内存访问能力**，所以 **sandbox 代码无法修改"管辖主机内存访问的 EPT 映射"**

## 二、EPT 用于内存隔离，不是 CPU 虚拟化

- 用 EPT/嵌套页表主要是为了**内存隔离**（额外一层逻辑保护环），**指令直接在硬件执行**
- **sandbox kernel 的代码段实际是只读的**——因为 sandbox 代码**没有访问自己 EPT 映射的途径**
- 每个 sandbox 做**自己的本地调度与设备管理**

## 三、中断与 I/O：直接交给 sandbox

- **中断被定向到 sandbox kernel**（I/O APIC 广播或 IPI），并在驱动里做**早期解复用**——避免 monitor 介入与复杂的 I/O 虚拟化
- **部分驱动数据结构跨 sandbox 共享**，另一些是复制或同步的

## 四、sandbox 间通信

- **显式消息传递 + 共享内存通道**，传**缓存行大小**的消息
- 一个 sandbox 里的服务可以访问另一个 sandbox 里的服务
- **IPI 用于 sandbox 间通信**；APIC 机制**也用于重路由中断以做远程故障恢复**

## 五、故障路径（定位 monitor 的第一线索）

- 故障被检出时会产生 **EPT violation → 控制权转移（VM-exit）到对应的 monitor**
- **若某故障不会自动触发 VM-exit，故障处理器可以强制触发它**（例如用某条必然陷入的指令）
- sandbox kernel **只读段**里的故障检测代码被**假定安全**
- **抢占超时可周期性强制陷阱到 monitor**——这样**检测逻辑就位于 monitor 内**，与被篡改的 sandbox 隔离

## 六、恢复：本地与远程，都是在线的

- **本地恢复**：monitor 释放故障组件的内存、**可能重新初始化整个 sandbox**、或用**替代实现**替换组件（功能/实现多样性），并**通过调整该 sandbox 的 EPT 映射**来激活替代实现
- **远程恢复**：本地 monitor 选一个目标 sandbox（随机、轮转、或按负载），**经 IPI 通知**；远端 monitor 执行恢复，**经消息传递从共享内存取状态**
- 恢复**在线完成，不重启整机**；未受影响的 sandbox 继续正常运行

## 七、实操：手里这份映像，哪一段是 monitor

几个可用的判据（按可靠性排序）：

1. **谁持有并修改 EPT 映射/影子页表**——这是 monitor 独有的能力（sandbox 代码无法访问自己的 EPT 映射）
2. **故障入口**：VM-exit 的目标、以及"强制触发陷入"的那条路径
3. **抢占超时的定时逻辑**：它被刻意放在 monitor 内与被篡改的 sandbox 隔离
4. **引导/通道建立代码**：只在启动与建通道时出现

反之，**大量设备驱动与本地调度逻辑属于 sandbox kernel，不是 monitor**。

## 八、时间与迁移

- **没有全局时钟**：每个 sandbox 有自己的物理时钟，事件计时由**每核本地定时器**管理，**不保证同步**
- 既没有全局调度器也没有全局时钟 → **跨 sandbox 迁移与通信的时序分析必须把时钟偏差算进去**（相关研究专门推导过含时钟偏差的通信界限）
- 跨 sandbox 的时间戳**不能按单一时间线比较**

## 决策树

```
拿到多内核 sandbox 系统的映像
├─ 找不到中央 hypervisor
│    └─ 正常：每 sandbox 一个 monitor
├─ VM-exit 很少
│    └─ 正常：sandbox 自己调度与管 I/O，中断直接投递
├─ 要定位 monitor
│    ├─ 谁持有/修改 EPT 与影子页表
│    ├─ VM-exit 目标与"强制触发陷入"路径
│    ├─ 抢占超时的定时逻辑
│    └─ 引导/建通道代码
├─ 故障与恢复
│    ├─ EPT violation → VM-exit 到对应 monitor
│    ├─ 本地恢复可重初始化整个 sandbox 或换实现（改 EPT 激活）
│    └─ 远程恢复经 IPI + 共享内存传状态，全程在线
├─ 跨 sandbox 通信
│    └─ 显式消息 + 共享内存通道（缓存行大小消息）+ IPI
└─ 时间线对不上
     └─ 无全局时钟：各 sandbox 时钟不保证同步，别按单一时间线断言
```

## 工具与验证

- 资源：sandbox domain 到 CPU/内存/设备的映射
- monitor：EPT/影子页表、故障入口、抢占超时、引导与通道建立代码
- 通信：共享内存通道的消息流与 IPI
- 时间：各 sandbox 的本地时钟与偏差
- 验证：能同时说清「这段代码属于 monitor 还是 sandbox kernel + 该故障经哪条路径到 monitor + 这条跨域数据的时序基准是谁的时钟」

## 该平台的坑（汇总）

- **把"没有中央 hypervisor"当系统缺失**：每 sandbox 一个 monitor 是设计
- **把"VM-exit 很少"当没有虚拟化隔离**：指令直接在硬件跑是设计
- **以为 monitor 参与每次 I/O**：它只在引导、故障、影子页表、建通道时介入
- **把设备驱动当 monitor 的一部分**：驱动与本地调度属于 sandbox kernel
- **以为能改 EPT 映射**：sandbox 代码无法访问自己的 EPT 映射
- **把不同 sandbox 的时间戳按单一时间线比较**：没有全局时钟
- **以为恢复一定重启整机**：本地/远程恢复都在线进行
- **把"替代实现替换组件"当异常**：那是设计内的恢复手段
- **假设一核一 monitor**：monitor 可以按核集群建立
