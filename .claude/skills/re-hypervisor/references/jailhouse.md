# Jailhouse：cell 配置 / park / loadable 内存 / ivshmem

<CORE RULE>
Jailhouse 是**静态分区** hypervisor：**配置文件比 inmate 的 ELF 本身更重要**。

它没有"VM 运行时申请资源"这回事——`.cell` 配置直接规定 CPU 集合、内存区、IRQ 芯片、PIO、PCI 与权限。

所以分析一个 inmate：

```
inmate 镜像 + .cell 配置 + root cell 配置 + 宿主 DT/ACPI
```

**缺了配置那一半，关于"它为什么能/不能访问某个地址"的判断基本都是猜。**
</CORE RULE>

## 一、资源归属在配置里，不在运行时协商

- cell 描述符包含：CPU set、内存区（含 `phys_start` / `virt_start` / `size` / 标志）、IRQ、PIO、PCI 归属与权限
- 内存区标志是判据：**`READ` / `WRITE` / `EXECUTE` / `DMA` / `COMM_REGION` / `LOADABLE`**（注意 **`DMA` 标志缺失会让非 root Linux cell 不把这些区识别为 RAM**）
- `jailhouse cell load` 会把镜像装进配置指定的内存区，**装载地址必须落在映射区内**（例如未设 `virt_start` 而镜像落在低内存之外，就会以 "Invalid argument" 失败——这是配置问题，不是镜像问题）

## 二、越权访问 → CPU 被 park（不是 guest 崩溃）

- 访问未映射给该 cell 的内存/外设时，hypervisor 记录 **"Unhandled data read" / "FATAL: unhandled trap"**，随后 **"Parking CPU n (Cell: ...)"**
- **被 park 的 CPU/cell 等于停止运行**

所以看到"程序突然不动了"、又找不到 page fault/总线错误的常规证据，**先对照 `cell.mem_regions`、PCI 与 IRQ 归属**：**非法访问被 hypervisor 拦下并停机**是一等公民的解释。

## 三、`JAILHOUSE_MEM_LOADABLE`：装载窗口是一次性的

- 标记为 `LOADABLE` 的内存区**可以映射进 root cell，用于装载/重装镜像**
- **cell 启动时，这些映射会被撤销**（"对标记为 loadable 的区域的 root cell 访问被收回"）
- 需要重装时走 **Cell Set Loadable** 超话：**关停运行中的 cell，并把其 loadable 区域重新映射回 root cell**
- 相关的错误码有区分度：非 root cell 发起或被目标 cell 拒绝关停 → `-EPERM`；cell 不存在 → `-ENOENT`；**root cell 不能被设为 loadable** → `-EINVAL`
- 后来还加入了在 Cell Set Loadable 时**复位 PCI 设备**的行为（此前活跃的设备先静默、停止 DMA，避免与装载冲突）

**典型现象**：

```
root Linux 启动前能直接访问 0xXXXX
inmate 启动后再访问 → fault
```

**这是设计如此**，不是"内存被保护起来了/被 hook 了"。

## 四、ivshmem：状态从共享内存协议里读，不要指望 pending 位

ivshmem v2 的寄存器语义与标准 PCI 设备**故意不同**：

- **Interrupt Control Register**：bit 0 使能中断；**若启用 one-shot 模式，设备在每次投递中断时把 bit 0 清零**——这是给 UIO 类驱动的自动节流，免去一次 VM-exit
- **设备没有 pending interrupt 的概念**：**读 MSI-X 的 Pending Bit Array 永远返回 0**；INTx 方面 **Status Register 的 Interrupt Status 位从不置位**（与 PCI 规范有偏差），没有"pending INTx"信息
- 规范的做法是：**事件状态从共享内存里的协议信息推导**
- **Doorbell Register**：只写；低 16 位是向量号，高 16 位是目标 ID；写一个目标未使能的向量没有效果，写不存在的目标也没有效果；**读该寄存器未定义**
- **State Register**：写入会更新本地状态，并在远端设备上触发 MSI-X 向量 0（或 INTx），前提是新值与旧值不同；对端通过比较本地副本区分"状态变化"与"doorbell 事件"
- **State Table**：共享内存起始处的只读区，每个 peer 一个 32 位状态值；复位/断开时清零
- 协议类型编码在 PCI Class Code 的 interface/sub-class 里（例如虚拟点对点以太网、用户定义区间、Virtio over shared memory）

**推论**：

- **"收到中断但 PBA 恒为 0" 不是 hypervisor bug**；**"没有 pending 位可查"也不能推导出"没有事件"**
- 排查要以**共享内存里的协议状态**为准，必要时结合 State Table/State Register

## 五、hypervisor 地址空间里扫不到 inmate 内存是正常的

Jailhouse **不会把整个 cell 永久映射进 hypervisor 地址空间**：只有显式共享页、以及处理 MMIO 等场景下临时映射的页才可见，而且临时映射**可能是 per-CPU 的**。

所以"用 hypervisor VA 直接遍历所有 VM RAM"的取证/调试工具会漏掉大量内容——**这不是内存被藏了**。

## 决策树

```
拿到 Jailhouse 目标
├─ 先拿配置：.cell / root cell config / 宿主 DT·ACPI
│    ├─ 内存区标志（含 DMA）与 virt_start 是否与镜像匹配
│    └─ PCI / IRQ / PIO 归属
├─ 访问某地址后程序停住
│    ├─ 查 hypervisor 日志：Unhandled trap → Parking CPU n
│    └─ 对照该地址是否属于本 cell（不是 → 违规，不是驱动 bug）
├─ root cell 能访问 → cell 启动后不能
│    └─ LOADABLE 映射在 cell 启动时被撤销；重装需 Cell Set Loadable
├─ ivshmem 中断相关
│    ├─ PBA 恒 0 / Status 位不置位 → 设备本就不维护 pending 语义
│    ├─ 事件状态去共享内存协议里读（State Table / State Register）
│    └─ one-shot 模式下 Interrupt Control bit0 会被设备清零
└─ 在 hypervisor VA 里找不到某 cell 的内存
     └─ 只有共享页与临时映射可见，且临时映射可能是 per-CPU
```

## 工具与验证

- 配置：cell 描述符（内存区与标志、PCI/IRQ/PIO 归属）、root cell 配置、宿主 DT/ACPI
- 违规判定：hypervisor 控制台输出（Unhandled trap / Parking CPU）
- ivshmem：寄存器区（Interrupt Control / Doorbell / State）、State Table、共享内存协议状态
- 验证：能同时说清「资源归属（配置里怎么分的）+ 访问为何被拦（违规 vs 映射撤销）+ 事件状态从哪里读」

## 该平台的坑（汇总）

- **只看 inmate ELF 不看 cell 配置**：资源归属全在配置里
- **把"访问后停机"当 guest 崩溃/驱动 bug**：越权访问会被 hypervisor park 掉 CPU
- **把 cell 启动后 root cell 失去访问当异常**：`LOADABLE` 映射在启动时被撤销，重装走 Cell Set Loadable
- **忘了内存区要标 `DMA`**：否则非 root cell 不把该区当 RAM，症状像"内存不见了"
- **用 MSI-X PBA 判断有无事件**：ivshmem 不维护 pending 语义，PBA 恒 0
- **把 Status Register 的 Interrupt Status 位当 pending 依据**：该位从不置位
- **读 Doorbell 寄存器**：它只写，读未定义
- **用 hypervisor VA 遍历所有 VM 内存**：只有共享页与临时映射可见
- **把 one-shot 模式下 bit0 被清零当"中断被吞"**：那是设备端的自动节流设计
