# NuttX：FLAT / PROTECTED / KERNEL 三种内存模型

<CORE RULE>
分析 NuttX 之前**必须先问一句：这是 FLAT、PROTECTED 还是 KERNEL 构建？**

不知道是哪一种，反编译出来的 syscall 与地址语义**很容易全错**——同一个 API 在三种模型下的产物完全不同。
</CORE RULE>

## 一、三种模型

| 模型 | 结构 | 地址空间 |
|---|---|---|
| **FLAT** | OS 与应用在同一个平坦镜像里，可直接互相访问 | 单一 |
| **PROTECTED** | 两遍构建产出**两个 blob**：特权内核 blob + 非特权用户 blob；由 MPU 施加限制；**用户侧 API 是自动生成的 syscall proxy** | 内核态/用户态分离 |
| **KERNEL** | 内核地址空间 + **每个用户进程独立地址环境**；需要 MMU | 每进程独立 |

## 二、同一个 API，反编译结果完全不一样

以 `getpid()` 为例：

```
FLAT      ：直接 call 到 NuttX 的实现
PROTECTED ：pid_t getpid(void) { return (pid_t)sys_call0(SYS_getpid); }
            → 特权切换 → 内核侧 stub → 真正的 getpid
```

- **PROTECTED 下面向用户的 API 是自动生成的 syscall proxy**：由 `syscall/syscall.csv` 经 `tools/mksyscalls` 生成；内核侧另有自动生成的 stub 把 syscall 映射回真实调用
- 因此：

```
getpid() 只有两三条汇编、马上 SVC/trap
  → 不要判 "libc 被 hook" 或 "syscall wrapper 异常"
  → 这是该构建方式的正常形态
```

**RE 判据**：看到大量"极短函数 + 立即陷入特权级"的模式，先确认是不是 PROTECTED 构建，再谈可疑性。

## 三、两个堆（PROTECTED 下）

- 默认情况下可以只有**一个用户空间堆**，被内核态与用户态代码共用——简单，但内核态的分配没有隔离
- 开启 `CONFIG_MM_MULTIHEAP=y` 与 `CONFIG_MM_KERNEL_HEAP=y` 后有两套分配器：
  - **非受保护的用户堆**：内核与用户代码共用（分配器物理上位于用户地址空间，内核从用户 blob 头部的信息拿到它的地址）
  - **受保护的内核堆**：只有 NuttX 内核可访问，构建进内核块；`CONFIG_MM_KERNEL_HEAPSIZE` 设其大小（默认 8192 字节），剩余内存给用户堆，**按最小内存保护区对齐后内核堆实际可能更大**
- 接口分工：`up_allocate_heap()` 返回用户堆，`up_allocate_kheap()` 提供内核堆
- 该配置项在 protected/kernel 构建下默认开启、在 flat 下默认关闭

**所以**：

```
地址 A malloc 出来用户能访问
地址 B malloc 出来用户 fault
  → 不一定是堆损坏，可能是分别来自 malloc 与 kmalloc
```

## 四、KERNEL 模型的堆布局

一个内核堆 + **每个 task group 一个用户堆**；只有内核堆在架构的 `up_allocate_kheap()` 里初始化。典型内存图：内核 `.data` / 内核 `.bss` / 内核 idle 栈 / 填充 / 用户 `.data` / 用户 `.bss` / 内核堆（`CONFIG_MM_KERNEL_HEAPSIZE`）/ 用户堆（延伸到 SRAM 末尾）。

## 五、驱动分 upper half 与 lower half

NuttX 驱动通常分两层：

| 层 | 位置 | 职责 |
|---|---|---|
| **upper half** | `drivers/`（通用、与硬件无关） | 用 `register_driver()` / `register_blockdriver()` 注册，实现 `read`/`write`/`close`/`ioctl`/`poll` 等标准接口，**通过回调调用 lower half** |
| **lower half** | `arch/<架构>/src/...` 或 `boards/<架构>/<芯片>/<板>/src` | 寄存器访问与配置、中断处理，按标准回调结构（如串口的 `uart_ops_s`）暴露能力 |

- 一个 upper half 可以服务**多个** lower half 实例（一对多）
- **板级逻辑负责创建 lower-half 实例并把它与通用 upper half 绑定**
- 网络驱动同构：接口在 `include/nuttx/net/netdev_lowerhalf.h`，upper half 为 `drivers/net/netdev_upperhalf.c`，注册用 `netdev_lower_register()` 一类接口
- 驱动初始化分阶段：`drivers_early_initialize()`（堆/调度器可用之前）→ `drivers_initialize()`（注册核心伪设备如 `/dev/null`、`/dev/zero`）→ `board_app_initialize()`（经 `boardctl` 注册板级 lower half）

**所以**：

```
open/read("/dev/foo")
  → VFS → 通用 upper half → ops 回调 → 板级 lower half → 真正的 MMIO
```

**只逆 `drivers/foo.c` 很可能找不到真正操作寄存器的地方。**

## 决策树

```
拿到 NuttX 目标
├─ 先判构建模型：FLAT / PROTECTED / KERNEL
│    ├─ 看是否存在用户 blob、MPU/MMU 使用、是否有一堆极短的 syscall 包装函数
│    └─ 判错 → 后面地址与调用语义全错
├─ 看到极短的 API 包装 + 立即 trap
│    └─ PROTECTED 的自动生成 proxy（syscall.csv → mksyscalls），不是 hook
├─ 内存相关异常
│    ├─ 区分 malloc / kmalloc 与 user heap / kernel heap
│    ├─ PROTECTED 下默认可能只有一个共享堆；启用 MM_KERNEL_HEAP 才有内核专用堆
│    └─ 地址"用户不可访问"可能只是它来自内核堆
├─ 找不到硬件操作代码
│    └─ 走 upper half → lower half 两层：drivers/ 是通用层，真正 MMIO 在 arch/ 或 boards/
└─ 时序/初始化相关
     └─ 分清 drivers_early_initialize / drivers_initialize / board_app_initialize
```

## 工具与验证

- 构建模型：是否存在用户 blob、MPU/MMU 配置、syscall proxy 与自动生成的 stub
- 堆：`up_allocate_heap()` / `up_allocate_kheap()` 与相关 Kconfig 项
- 驱动：upper half（`drivers/`，注册接口）与 lower half（`arch/`、`boards/`，硬件实现）的绑定关系
- 验证：能同时说清「构建模型 + 该 API 走的是直接调用还是 syscall proxy + 地址属于哪个堆/哪个地址空间」

## 该平台的坑（汇总）

- **不先判 FLAT/PROTECTED/KERNEL**：同一 API 的产物与地址语义完全不同
- **把 syscall proxy 当真实实现**：PROTECTED 下用户侧 API 是自动生成的两三条汇编 + trap
- **把 proxy 判成 hook/libc 异常**：这是设计本身
- **忽略双堆**：用户不可访问的地址可能来自内核堆，不是堆损坏
- **以为所有构建都有内核堆**：`MM_KERNEL_HEAP` 在 flat 下默认关闭
- **只逆 `drivers/` 就找硬件操作**：真正 MMIO 通常在 `arch/` 或 `boards/` 的 lower half
- **忽略板级绑定逻辑**：实例由板级代码创建并与通用 upper half 绑定
- **混淆驱动初始化阶段**：early / drivers / board 三阶段可用的设施不同
