# QNX Hypervisor：三层地址 / vdev / 虚拟中断

<CORE RULE>
guest 里的"物理地址"根本不是宿主物理地址。地址至少三层：

```
guest virtual → guest physical（ARM 术语 IPA）→ host physical
```

而且 guest 看到的那台"设备"**可能是由配置人工制造出来的**：

```
guest driver 的 MMIO 地址 = 0x1c090000
  ≠ 真实 SoC 上那里就有该设备
```

如果那是 **vdev**，这个地址完全由 VM 配置决定。**先判"这是直通、还是 vdev"，再谈驱动写得对不对。**
</CORE RULE>

## 一、地址模型

- guest RAM 由创建 VM 的进程（qvm）配置；对 guest 看起来是物理内存，**但仍需再翻译一层**
- **直通设备**：guest 看到的设备物理地址与宿主物理地址**没有直接对应关系**（与共享内存不同）——虚拟化层做转换
- **shmem vdev**：配置里那个"工厂页地址"（例如放在所分配 RAM 之外的某处）**明确是 guest physical，不是真实硬件地址**

**所以"guest 里的 MMIO 地址在真实 SoC 上找不到东西"不是错误**。

## 二、vdev：guest 驱动必须匹配被暴露出来的虚拟硬件

- hypervisor 配一个 PL011 vdev，guest 就**应当认为那里真的有一个 PL011**——匹配的对象是 vdev 暴露的硬件模型，不是板子上的原件
- 推论：**guest 的 device tree ≠ 物理板级 device tree**，完全可能不同

## 三、shmem vdev：工厂页 + 控制页

共享内存 vdev 在 guest 侧表现为"一组映射在 guest-physical 里的寄存器 + 能触发中断"，可以是 MMIO（直接在配置里给 `loc`/`intr`），也可以是 PCI（默认；位置与中断由 hypervisor 分配）。

**工厂页（4 KB）** 是它的虚拟寄存器页：

| 字段 | 作用 |
|---|---|
| `name` | 区域名 |
| `size` | 大小——**写入即触发创建** |
| `shmem` | 返回控制页的 guest-physical 地址 |
| `vector` | 中断向量 |
| `status` | 状态 |

- **创建是首次使用时完成的**，因此**各 guest 可以任意顺序启动**——"先启动的那个也正常"不需要额外解释
- 每个共享区前面还有自己的**控制页**：`status`（活跃客户端 / notify 位）、`idx`（连接 ID）、`notify`（写位集以通知其他 guest）、`detach`
- guest 之间就是**通过写控制页**通信的

## 四、虚拟中断：`intr pass` 与 `intr vdev` 是两条不同的路

VM 配置里的 `intr` 关键字决定中断来源：

| 形式 | 含义 |
|---|---|
| `pass` | 由**宿主**把物理设备的中断路由给 guest（可给 guest 中断号，或引用一张把宿主向量映射到 guest 中断号的宿主 PIC） |
| `vdev` | 中断由**运行在宿主侧的 vdev 代码**产生（引用 guest vdev 向其发中断的宿主 PIC，或直接指定 guest 中断控制器与线号） |

- **x86 上 LAPIC 自动提供**（vdev 只写 `intr apic`，无需线号），例如 `vdev ioapic` + `intr apic`、`vdev ser8250` + `intr myioapic:4`
- **ARM 上 GIC 自动提供**（也可显式指定）
- shmem 的通知走 `notify` 位集：接收方 guest 的 IRQ 处理程序去读 `status`（低位表示谁通知了它，高位表示活跃连接）

**所以"driver 的 ISR 很短，但中断延迟明显变大"不一定是 driver 慢**：路径可能是

```
物理设备 → hypervisor（中断归属/路由） → 虚拟中断 → guest ISR
```

做延迟分析时必须把虚拟化层算进去。

## 五、guest exit 何时发生（决定了你能看到什么 trace）

Halt、**vdev 访问**（例如对 shmem 工厂页 size 寄存器的 MMIO 写会被 trap，用于创建/接入区域）、宿主侧中断、虚拟定时器、CPUID 类指令。

## 六、直通设备：一次只能有一个 resident 访问

- 直通时 **hypervisor 不需要设备驱动**：它只负责识别并放行物理设备到 guest 的中断、把 guest 的信号直接交给设备，其余交互都是 guest 对设备
- **同一时刻只允许一个 resident（host 或 guest）访问某个直通设备**——"host 与 guest 同时操作同一设备"不是可选项，是错误状态

## 决策树

```
拿到 QNX Hypervisor 目标
├─ 先判设备形态
│    ├─ 直通（pass）→ GPA 与 HPA 无直接对应；一次只能一个 resident 访问
│    └─ vdev → 地址/寄存器布局由 VM 配置制造，guest DT ≠ 板级 DT
├─ 地址对不上真实硬件
│    └─ 正常：至少三层地址；shmem 工厂页地址明确是 guest physical
├─ 共享内存相关
│    ├─ 找工厂页（name/size/shmem/vector/status），写 size 才触发创建
│    ├─ 首次使用时创建 → 各 guest 启动顺序无所谓
│    └─ 数据面写控制页（status / idx / notify / detach）
├─ 中断相关
│    ├─ 分清 intr pass（宿主路由）与 intr vdev（宿主侧 vdev 产生）
│    ├─ 延迟变大 → 把 hypervisor 的中断归属/路由算进路径
│    └─ shmem 通知 → 读 status 判定谁通知、谁活跃
└─ trace 里 VM-exit 很多
     └─ 检查是否有 vdev 寄存器写（如工厂页 size）被 trap
```

## 工具与验证

- 配置：VM 配置里的 RAM 布局、`loc`/`intr` 关键字、vdev 类型（MMIO 还是 PCI）
- 共享内存：工厂页字段与控制页字段（`status` / `idx` / `notify` / `detach`）
- 中断：区分 `pass` 与 `vdev` 两条来源，再看 guest 侧中断控制器（x86 LAPIC / ARM GIC 自动提供）
- 验证：能同时说清「地址处于哪一层 + 设备是直通还是 vdev + 通知与中断来自哪条路径」

## 该平台的坑（汇总）

- **拿 guest 的 MMIO 地址去真实 SoC 上找设备**：三层地址；vdev 的地址完全由配置决定
- **把 guest device tree 当板级 device tree**：vdev 暴露的是虚拟硬件模型
- **以为共享区一定要先由某个 guest 创建**：工厂页写 size 时按需创建，启动顺序无关
- **把 shmem 当普通 PCI 设备**：它可以是 MMIO 也可以是 PCI，寄存器语义由工厂页/控制页定义
- **分不清 `intr pass` 与 `intr vdev`**：一个由宿主路由物理中断，一个由宿主侧 vdev 代码产生
- **把延迟归因于 driver**：先看中断是否经过 hypervisor 的归属与路由
- **以为 host 与 guest 能同时用同一台直通设备**：同一时刻只允许一个 resident 访问
- **把 vdev 寄存器写引发的 VM-exit 当异常**：那是 vdev 的正常工作机制（例如创建共享区）
