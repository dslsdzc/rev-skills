# ACRN：Service VM / pre-launched / post-launched + Device Model

<CORE RULE>
ACRN 里"谁在服务这个 I/O"有三个互斥的答案，**必须先判定是哪一个**：

| 路径 | 谁在服务 |
|---|---|
| **直通（passthrough）** | 硬件直接给 VM，hypervisor 只做映射与中断重映射 |
| **hypervisor 模拟** | hypervisor 自己实现设备 |
| **Service VM 的 Device Model** | 由 Service VM 里的用户态设备模型模拟 |

判定错了，后面所有"这个寄存器为什么这样写"的推理都会跑偏。

拓扑基本形是：

```
Hypervisor
├─ Service VM（直接拥有大量真实硬件，并为 post-launched VM 提供设备模拟/共享）
├─ Pre-launched VM（不依赖 Service VM 启动）
└─ Post-launched User VM（依赖 Service VM 的设备模型）
```
</CORE RULE>

## 一、guest 看到的 BAR 不是物理 BAR

直通时 hypervisor 会做 **虚拟 BAR ↔ 物理 BAR** 之间的映射：在两者之间建立 EPT 映射让 VM 直接访问 MMIO——**但 MSI-X 表所在的那几页必须被 trap**（不建立 EPT 映射），否则无法在虚拟向量与物理向量之间做重映射。

同时还有两件事：

- **VT-d DMA remapping**：把 GPA 翻译成 HPA 供设备 DMA 使用
- **VT-d 中断重映射**：ACRN 出于安全考虑要求它；**如果 VT-d 硬件不支持中断重映射，ACRN 会拒绝启动 VM**

**所以：**

```
Guest BAR0 = 0x80000000
Host 物理设备 BAR = 0xD2000000
```

**完全正常**，不要因为地址不一致就认为抓错了设备或驱动写错了。

## 二、中断：不是每次都有等量的 VM-exit

- 常规情况下虚拟中断由 hypervisor 注入；在支持时使用 **VT-d posted interrupt（PI）** 以获得更好的中断性能
- 因此：

```
guest ISR 明明执行了
hypervisor trace 里却找不到预期的完整中断注入路径
```

**不能直接判 trace 缺失**——先确认该设备/该 VM 是否走了 posted-interrupt 一类旁路。

## 三、ivshmem：dm-land 与 hv-land 是两套机制

ACRN 的共享内存设备（ivshmem）有两种实现，**可以同时存在，但不同实现的 VM 之间无法通过同一机制互通**：

| 实现 | 位置 | 共享内存取自 | 适用 VM |
|---|---|---|---|
| **dm-land** | Service VM 的 Device Model（`acrn-dm`） | Service VM 的内存空间 | **仅 post-launched User VM** |
| **hv-land** | hypervisor 内部 | hypervisor 的内存空间 | pre-launched 与 post-launched 都可 |

- 区分方式看名字前缀：`dm:/`（早期补丁里为 `sos:/`）与 `hv:/`；**前缀不对会导致 ivshmem 初始化失败**
- dm-land 由 `acrn-dm` 启动参数 `-s <slot>,ivshmem,<shm_name>,<shm_size>` 定义；hv-land 在构建期配置（`IVSHMEM_ENABLED` + `IVSHMEM_REGION`，格式 `名字,大小,VM ID 列表`），**最多八个 hv-land 区域**
- 设备是标准虚拟 PCI 设备：**BAR0 中断相关寄存器、BAR1 MSI-X 表、BAR2 共享内存**
- 寄存器语义：`IRQ_MASK(0x0)` 与 `IRQ_STA(0x4)` 保留（不支持传统中断）、`IV_POS(0x8)` 为跨 VM 位置/VM ID（当前为 0）、**`DOORBELL(0xC)` 用于触发对端中断**
- **通知（doorbell）只在 hv-land 支持**：发送方把目标 VM ID 与向量号写入 doorbell 寄存器，由 hypervisor 侧查表并**向目标 VM 注入 MSI**（最多 8 个 MSI-X 向量）；**dm-land 没有通知机制**（列为待支持）
- 已知坑：dm-land 下 **guest 若重新编程 BAR2，共享内存会变得不可用**（该场景的 GPA/HPA 重映射未处理）

**所以"两个 VM 各自 ivshmem 都正常、就是互相看不见"时，第一件事是查前缀与实现是否一致**，而不是怀疑设备模型。

## 四、VM 类型决定 MSI-X 的 trap 路径

ACRN 分别定义三类 VM 的 MSI-X 访问路径：

| VM 类型 | 路径 |
|---|---|
| Service VM | hypervisor 的 MMIO handler |
| **Post-launched VM** | **Device Model 的 MMIO handler，再涉及 hypervisor** |
| Pre-launched VM | hypervisor handler |

**所以不要做"所有 MSI-X 写都走同一条 hypervisor 路径"的假设。**

## 五、设备归属会在 VM 之间迁移

- Post-launched VM 启动时，物理设备的所有权**从 Service VM 移交给该 VM**；VM 关闭时再**移回 Service VM**
- 因此"Service VM 里某个 PCI 设备突然消失、过一会又回来"**不一定是热插拔故障**
- **pre-launched VM 由 hypervisor 创建**，不经过 Service VM 的 Device Model——**看不到设备模型进程不能推出启动过程缺了一层**
- passthrough 下 guest BAR 与 host BAR 不同属正常：guest GPA 经 EPT/VT-d 到 HPA，**DMA 还需 VT-d 的 GPA→HPA 转换**

## 决策树

```
拿到 ACRN 目标
├─ 先分清 VM 类型：Service VM / pre-launched / post-launched
│    └─ post-launched 才可能经过 Service VM 的 Device Model
├─ 一个 I/O 行为是谁在服务？
│    ├─ 直通 → 查虚拟 BAR ↔ 物理 BAR 映射、VT-d DMA/中断重映射
│    ├─ hypervisor 模拟 → 查 hypervisor 侧设备实现
│    └─ Device Model → 查 Service VM 里的设备模型
├─ guest BAR 与物理 BAR 不一致
│    └─ 正常（直通本来就做 MMIO remapping）；注意 MSI-X 表页必须被 trap
├─ 中断发生但 trace 里没有预期的注入路径
│    └─ 查是否走了 posted interrupt 等旁路，别判 trace 缺失
└─ ivshmem 通不了
     ├─ 查前缀：dm:/ 还是 hv:/（混用永不通）
     ├─ pre-launched 只能用 hv-land
     ├─ dm-land 无 doorbell → 只能共享数据，不能互相通知
     └─ dm-land 下 guest 重编程 BAR2 → 共享内存不可用（已知未处理）
```

## 工具与验证

- 拓扑：VM 类型（Service VM / pre-launched / post-launched）与设备归属
- 直通：虚拟 BAR 与物理 BAR 的 EPT 映射、MSI-X 表页是否被 trap、VT-d DMA/中断重映射是否启用
- 共享内存：ivshmem 的名字前缀（`dm:/` / `hv:/`）、BAR 布局、doorbell 寄存器与 MSI-X 向量
- 验证：能同时说清「VM 类型 + 该 I/O 的服务路径（直通/hypervisor/Device Model）+ 地址与中断经过了几层重映射」

## 该平台的坑（汇总）

- **不先分清 pre-launched 与 post-launched**：设备可用性和服务路径完全不同
- **把 guest 的 PCI BAR 当物理 BAR**：直通本来就有虚拟↔物理映射
- **以为 MSI-X 表页也能被 guest 直接访问**：那几页必须被 trap 才能做向量重映射
- **中断 trace 里没有 VM-exit 就判 trace 缺失**：posted interrupt 等旁路会减少甚至避免常规 VM-exit
- **把 dm-land 与 hv-land 的 ivshmem 混用**：两种实现之间永远不通，且前缀写错会直接初始化失败
- **在 pre-launched VM 上指望 dm-land**：dm-land 只支持 post-launched
- **指望 dm-land 有 doorbell 通知**：通知只在 hv-land 实现
- **忽略 dm-land 下 BAR2 被 guest 重编程的影响**：共享内存会变得不可用
- **忽略 VT-d 中断重映射的硬性要求**：不支持该硬件的平台上 ACRN 会拒绝启动 VM
