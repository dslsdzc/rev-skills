# Bao：静态资源分区 / shmem_id / cache coloring

<CORE RULE>
Bao 是**纯粹的静态分区** hypervisor：

- 内存按两阶段翻译**静态分配**；I/O **只做直通**；**虚拟中断直接映射到物理中断**；vCPU 与物理 CPU **1:1**，**没有调度器**
- **没有运行时内存分配、没有完整设备模拟**
- **CPU、内存区、中断默认独占、不共享**；只有配置里明确声明的共享内存/IPC 才跨 VM

因此第一条判断是：

```
两个 VM 都能访问同一段物理 RAM
  → 若它不是 IPC/共享资源配置的一部分 → 先怀疑配置错，或你把地址层级看错了
```

**不要用"地址相同/不同"判断两个 VM 是不是在看同一个共享对象。**
</CORE RULE>

## 一、identity 来自配置，不来自地址

配置是一个 C 源文件，定义全局 `struct config`：

- **`.shmemlist`**：共享内存区列表。每个 `struct shmem` 含 `size`、`place_phys`、`base`/`phys` 联合体，以及 **`colors`**（L2 共享缓存的颜色位图；默认 `0x0` 表示使用全部颜色）
- **`.vmlist`**：VM 列表（必需）。每个 `struct vm_config` 含 guest 镜像（基址/装载地址、大小、`separately_loaded`、`inplace`）、`entry`、**`cpu_affinity`**（期望的物理 CPU 位图，**约定在各 VM 之间互斥**）、`colors`、`platform`
- 每个 VM 的 `struct vm_platform` 含：`cpu_num`、内存区（`regions`）、**IPC 通道（`ipcs`）**、MMIO 设备区（`devs`）、`mmu` 等

**IPC 通道 `struct ipc` 的关键字段**：

| 字段 | 含义 |
|---|---|
| `base` | 该 IPC 内存区**在本 VM 中的虚拟基址** |
| `size` | 大小，**应小于或等于其 `shmem_id` 所指向共享区的大小** |
| **`shmem_id`** | **关联到 `.shmemlist` 中某个共享区的 ID——这才是共享对象的 identity** |
| `interrupt_num` / `interrupts` | 分配给该 IPC 通道的中断号数组（doorbell 机制） |

**所以：**

```
VM A: 0x70000000 → shmem_id 2
VM B: 0x90000000 → shmem_id 2
```

**两个地址不同，底层却是同一个通信对象**——按"地址相等 == 同一 buffer"推理会直接出错。（反过来，两个 VM 用了相同虚拟地址也**不**说明是同一对象。）

## 二、中断与设备：直通、独占、1:1

- 设备在配置时**独占分配给某个 VM**，中断**直接路由到该 VM**，以避免虚拟化开销
- vCPU 按配置的 affinity 分配到物理 CPU（未定义 affinity 时顺序分配）
- **Bao 自己只需要一个中断**，用于核间通信/同步的 IPI
- 初始化分七个阶段（early boot → CPU init → memory init → platform init → interrupt init → VMM init → VM launch/run），**之后不再有调度或动态重配置**

## 三、cache coloring：干扰抑制，但不是万能

- 通过 `colors` 位图把 LLC 分成互不相同的颜色分给各 VM，减少互相干扰
- **默认未启用**；取值在运行时会**按平台可用颜色数截断**，所以**效果是平台相关的**
- 实测（16 色 × 32 KiB 的平台上）：每 VM 分 7 色（224 KiB），另留 2 色给 hypervisor，干扰可降低近一半——**但不能完全消除**
- **代价**：coloring 会让**超大页无法使用**（Bao 本来用大页降低 TLB 压力），从而**增加 TLB 压力与开销**

**做延迟/性能归因时不能假设所有 VM 天然共享整个 LLC。**

## 四、MPU 目标上的额外细节

在无 MMU（MPU）目标上，共享内存区需要**跨核同步**：某核映射共享区时会与共享该区的其他核交换消息（类型/ID 与区域配置），以 IPI 通知；**early boot 尚未启用 IPI 时，非主核以轮询方式等待**。vMPU 用内存保护条目替代页表，Arm PMSAv8 的粒度是 64 字节。

## 决策树

```
拿到 Bao 目标
├─ 先取配置（struct config：shmemlist + vmlist）
│    ├─ CPU 亲和、内存区、设备、中断各自归属哪个 VM
│    └─ 是否存在跨 VM 共享：看 shmem 条目与 ipc 的 shmem_id
├─ 两个 VM 访问同一物理内存
│    ├─ 是 IPC/共享配置的一部分？→ 正常（按 shmem_id 对齐，不看地址）
│    └─ 不是？→ 先怀疑配置错误或地址层级判断错误
├─ 共享区地址在两个 VM 里不同
│    └─ 正常：identity 是 shmem_id，base 只是本 VM 的映射地址
├─ 性能/延迟归因
│    ├─ 是否启用 cache coloring（colors 位图）
│    ├─ coloring 生效会牺牲大页 → TLB 压力上升
│    └─ 效果随平台可用颜色数截断，不能跨平台照搬结论
└─ 无 MMU（MPU）目标
     └─ 共享区映射靠跨核消息 + IPI（early boot 期非主核轮询）
```

## 工具与验证

- 配置：`struct config`（`.shmemlist` / `.vmlist`）、`vm_platform`（regions / ipcs / devs）、`struct ipc`（base / size / shmem_id / interrupts）
- 共享：按 `shmem_id` 对齐不同 VM 的映射，而不是按地址
- 隔离：CPU 亲和与设备/中断的独占归属；七个初始化阶段之后的运行期无重配置
- 验证：能同时说清「共享对象的 identity（shmem_id）+ 各 VM 的映射地址 + 中断归属」

## 该平台的坑（汇总）

- **用地址相等判断共享对象 identity**：identity 是 `shmem_id`，各 VM 的 `base` 可以不同
- **看到两个 VM 访问同一物理内存就判"配置泄漏"**：先看它是不是 IPC/共享配置的一部分
- **以为资源可以运行时申请**：静态分区，初始化七阶段之后没有动态重配置
- **期待有调度器**：vCPU 与物理 CPU 1:1，没有调度器
- **以为中断会被虚拟化/模拟**：中断直接路由给所属 VM，I/O 只做直通
- **忽略 IPC 的 `size ≤ 对应 shmem 大小` 约束**：配置不满足时行为不可预期
- **在性能分析里假设 VM 共享整个 LLC**：cache coloring 会改变这一点，且受平台颜色数限制
- **为了 coloring 忽略大页损失**：会抬高 TLB 压力，可能抵消收益
- **在 MPU 目标上忽略跨核共享同步**：共享区映射需要跨核消息与 IPI
