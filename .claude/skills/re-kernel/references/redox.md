# Redox OS：scheme / 启动链 / relibc / 驱动即用户态 daemon

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

第三条（分析定位）：**syscall ABI 是刻意不稳定的**——稳定层被推到了用户态库。所以你手上的二进制**未必对应当前内核的 syscall 号**，版本对不上不要急着判"被改过"。
</CORE RULE>

## 一、scheme 的形态

| 类型 | 提供者 |
|---|---|
| **用户态 scheme** | 用户态程序（通常是 daemon）——**可能实现的都放用户态** |
| **内核 scheme** | 内核直接实现（只保留关键部分） |

- 根 scheme（`:`）是内核提供的特殊 scheme，作为**所有其他 scheme 名字的容器**
- provider 通过创建 `":myscheme"` 建立 scheme，**返回的文件描述符就是它与内核之间的消息通道**
- **调度分类**：涉及路径的文件系统调用被标为**路径类**或**文件类**——内核**按路径前缀匹配 scheme 名**，或者**记住打开该 fd 时用的是哪个 scheme**；两套匹配方式决定了"换了个路径为什么行为变了"
- scheme 在内核侧是一个 trait（对应用户态 daemon 的 `UserScheme` 实现）
- **其他 IPC 不走 scheme**：管道一类用普通系统调用；另有专门的 IPC daemon 提供共享内存/通道风格的 IPC

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
3. **进入 null namespace——此后无法再按名字打开普通资源**
4. 把要监听的事件 fd 登记到事件 scheme
5. 进入循环：等事件 → 读事件判断是定时器 / 资源事件（如设备中断）/ scheme 请求 → 处理请求 → 按 tag 回响应

**所以**：

```
driver 初始化后进入 null namespace、随后打不开普通资源
  → 不是 sandbox 异常，是安全设计
```

## 四、启动链：从引导到第一个用户态程序

```
bootloader（BIOS 版 / EFI 版，后者覆盖 x86_64、aarch64、riscv64）
  → 载入 kernel 与 initfs 到内存、建立初始页表
  → 跳到内核入口（架构相关的汇编入口）
  → Rust 入口：校验 BSS/data、建初始栈、带"内核参数"结构进入
  → 初始化调试输出、内存管理器、分页与堆、（x86）GDT/IDT 与 syscall 指令
  → 主初始化
  → 进入用户态调度循环
```

- 那个"内核参数"结构携带：内核映像、栈、环境、**硬件描述**（x86 上是 ACPI RSDP，aarch64/riscv64 上是设备树）、引导器提供的内存区、以及 **bootstrap / initfs 区域**
- 多核的从核走**另一条入口路径**

**bootstrap（第一个用户态程序）**：

- 内核载入 initfs blob、为它建立地址空间、跳到引导器给的偏移
- bootstrap 在汇编桩里分配栈、**对自己做内存保护设置**、然后 exec `init`，并启动 initfs scheme daemon
- 它本身就是一个**极小的 ELF 加载器**（Rust 编写、带每架构的自定义链接脚本、静态链接）

**initfs 是压缩归档**，含两级启动所需的最小二进制与配置：架构相关的驱动（块设备、输入等）与核心 daemon。**这样系统就能支持多种文件系统驱动而不把它们编进内核。**

## 五、relibc 与 C 运行时

- **relibc** 是 Rust 写的 C 库（连头文件也是，宏除外），**同时支持 Redox 与 Linux，两套后端**：Linux 上走原始 syscall，Redox 上走运行时库
- **稳定 ABI 层在用户态**：应用面向一个稳定 ABI，不稳定部分（syscall ABI、IPC、进程管理）被收进运行时库
- **C 启动序列**：`_start`（crt0）→ 运行时启动函数解析**辅助向量**、建立 argc/argv/env、初始化线程控制块 → `.init_array` 构造 → `main()`
- 辅助向量里有平台特有的项（例如进程 fd、线程 fd、继承的信号屏蔽），**还有动态链接器要用的程序头指针**——所以"这个二进制是静态还是动态"可以从辅助向量侧确认
- 线程控制块用**架构寄存器**承载；线程经 `clone` 创建，**在 Redox 上每个线程用一个文件描述符表示**，共享地址空间并继承文件表
- syscall 包装层负责**可重启语义**（被信号打断后重试）与把内核错误映射成 errno

## 六、驱动与 daemon 的实际形态

- **驱动是独立的用户态程序**（driver schemes，表现为文件风格的服务）
- 它们在文件系统里有固定位置，**PCI 相关的设备配置也以数据文件形式存放**（按厂商/设备组织）
- **驱动是两遍构建**：initfs 里用**体积优化 + panic-abort** 的版本，主文件系统里用**标准 release** 版本

**逆向含义**：同一个驱动在两个位置**不是同一份产物**——不要拿 initfs 里的版本推断主系统里的行为。

## 决策树

```
拿到 Redox 目标
├─ 先判：内核 / 用户态 daemon / 应用
│    ├─ 内核很小，syscall ABI 刻意不稳定 → 版本对不上别判被改
│    └─ 用户态 daemon 是最可能的目标
├─ 一次 read/write 背后是什么
│    ├─ 先定位它是哪个 scheme（路径的 scheme 名即"类型"）
│    ├─ 匹配方式：路径前缀 还是 "记住打开时的 scheme"
│    └─ 别默认它是文件系统
├─ 两侧句柄对不上
│    ├─ 客户端 fd 与 provider 描述符本就不相等
│    └─ 经内核映射建立关系
├─ 某个进程之后打不开新资源
│    └─ 可能是 provider 主动进入 null namespace
├─ 想看消息内容
│    └─ 按 SQE/CQE 条目解析：opcode / flags / tag / caller / args
├─ 启动/加载相关
│    ├─ 找 bootstrap 与 initfs（两级启动、极小 ELF 加载器）
│    └─ 设备接线来自 initfs 与用户态 daemon，不在内核
└─ 同款驱动两份产物
     └─ initfs 版与主系统版构建方式不同
```

## 工具与验证

- 服务拓扑：路径里的 scheme 名 → provider daemon；scheme 的创建点（`:name`）
- 请求流：SQE/CQE 条目字段（opcode / tag / caller / args）与响应匹配
- 句柄：客户端 fd 与 provider 描述符的内核映射关系
- 启动：引导器类型、内核参数里的硬件描述来源（ACPI vs 设备树）、initfs 内容
- 运行时：辅助向量项（静态/动态、fd 承载的线程与进程句柄）
- 验证：能同时说清「这次 I/O 落到哪个 scheme + provider 是谁 + 两个句柄怎么对应 + 这份产物属于哪一遍构建」

## 该平台的坑（汇总）

- **把 read/write 默认当文件系统**：含义由 scheme 决定
- **跨侧比较句柄整数**：客户端 fd 与 provider 描述符由内核映射，不等价是常态
- **把进入 null namespace 当沙箱异常**：那是 provider 的安全设计
- **在内核里找设备驱动**：驱动多为用户态 daemon
- **忽略 scheme 的两种匹配方式**：路径前缀 vs 记住打开时的 scheme
- **把 syscall 号写死**：ABI 刻意不稳定，稳定层在用户态运行时
- **把 initfs 里的驱动当主系统的同一份产物**：两遍构建，优化与 panic 策略不同
- **把阻塞归因于死锁**：客户端阻塞是设计，由 provider 的事件唤醒机制驱动
- **忽略 fd 传递能力**：scheme 可以充当 IPC broker
- **把启动时的硬件描述来源搞错**：x86 与 aarch64/riscv64 不同（ACPI vs 设备树）
