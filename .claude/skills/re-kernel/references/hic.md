# HIC：capability + 物理沙箱 + 多版本驱动系统

<CORE RULE>
**在 capability / sandbox / 多版本 / live-update 型驱动系统里，不从 CPL、地址、直接调用或 MMIO 指令推导信任边界。**

先恢复 **domain、capability、mapping、device ownership、version、lifecycle topology**，再解释控制流。

具体到 HIC：**Privileged-1 与 Core-0 处于相同物理特权级、靠 MMU 隔离**；驱动只映射自己被授权的 MMIO/共享内存，同时特定 privileged 服务还存在更宽的物理内存访问通道。所以下面这条老推理

```
Ring 0  →  kernel driver  →  full kernel addressability
```

**必须直接标成 invalid assumption**。
</CORE RULE>

## 一、跨系统对照：这些规则从哪来

| 真实系统 / 机制 | 实际经验 | 迁移到本类的规则 |
|---|---|---|
| Fuchsia DFv2 | 驱动跑在 driver host 内；不同驱动可分处不同进程，也可 **co-locate 到同一 driver host 共享地址空间**；driver manager 负责拓扑/绑定/capability 路由 | **不要用"是否直接 call"判断驱动边界**。两个逻辑独立的驱动可能共享地址空间；同一设备栈也可能跨多个隔离域。先恢复 driver/node/host 拓扑 |
| Fuchsia 崩溃恢复 | 驱动 crash 后可重新 spawn，但**重新 bind 时硬件可能已处于未知状态**，初始化不能假设设备是 reset 状态 | 驱动初始化里那些"看起来多余"的 reset / 状态探测**不要删成 boilerplate**——它可能是 sandbox restart / recovery path |
| Fuchsia 绑定元数据（DFv1） | 可把 bind program 放进 ELF NOTE，让协调者在**不完整加载驱动**的前提下检查绑定条件 | **先解析模块元数据，再反汇编**——模块自带 UUID、版本、端点、资源需求、依赖与签名，这些就是第一层 triage |
| seL4 / CAmkES | MMIO 可表现为 dataport / 共享内存映射；IRQ 可表现为 event / notification；RPC、共享 dataport、直接调用都可能存在 | **不能通过指令形态推断安全边界**：`mov [addr]` 可能是被授权的 MMIO；普通函数调用可能跨逻辑组件；共享页也可能是 capability 中介的 IPC |
| Xen frontend/backend | 设备协议由 shared ring + grant table + event channel 构成；**grant reference 是跨域页面授权，不是普通地址**；迁移后 event-channel 本地端口甚至可能变化 | 看到整数 handle / 页索引 / ring offset 时**不要先类型化成 pointer**。先判断它是 capability、共享页偏移，还是 domain-local 标识 |
| Xen grant table | 本质上承担**类似 paravirtual IOMMU 的角色**；页面所有权与跨域访问权是**独立状态** | 内存取证要区分 **VA / PA / backing frame / capability / owner domain / mapped domain**——只存虚拟地址远远不够 |
| Genode | 驱动可经 IO_MEM、IO_PORT、IRQ 等服务获得**细粒度**硬件资源；platform driver 可把设备资源细粒度隔离给沙箱化驱动 | **"能直接访问 MMIO" ≠ "拥有整机的内核权限"** |
| QNX Neutrino | **用户态驱动同样可以 mmap 物理设备寄存器并直接读写**，IRQ 通过专门机制交付；物理内存映射还受 ability/privilege 控制 | 逆向未知系统时，**看到直接 MMIO 不要自动归类成 monolithic kernel driver**——代码运行位置与硬件访问权限是两个独立变量 |
| Barrelfish | 用户态驱动经 capability 获得设备内存，中断被转发到用户态；**capability space 可以是 core-local，不同核甚至运行不同的 CPU driver** | **不要默认存在单一 global namespace**。必须记录 core / domain / cspace / device 上下文；同一个数字 handle 在不同域可能完全不同 |
| MINIX 3 live update | 更新前必须进入 quiescence；新实例做 state transfer，成功则替换旧实例，**失败则 rollback**；线程尤其麻烦，因为栈/寄存器里的指针与上下文很难安全迁移 | 滚动升级取证中**旧实例 + 新实例同时存在是合法状态**。只有确认迁移完成后旧实例仍在收新请求，才应怀疑 stale routing / UAF / hook |
| MINIX 协议静止 | 有些服务不能只做到"当前没有工作"，而必须达到 **request-free / protocol-free** 才能更新 | 对网络/NVMe/GPU 这类驱动，**不能把"线程 idle"当成可安全替换**——还要查 outstanding DMA、descriptor ownership、IRQ、协议事务 |

## 二、本系统特有的四个特殊情况

### 1. 先识别 generation，再恢复语义

同一能力在不同代际的实现模型可能不同——例如 **capability 分配在一代实现里是 per-core / 无全局锁**，而另一代（较大模型）描述的是**受保护的全局 capability table**。

**所以绝对不能**：

```
找到 capability 结构体 → 直接按最新文档套布局
```

**正确顺序**：用**代码签名、数据布局、调用路径**确认目标属于哪一代实现，再套结构。

**这条可推广到所有快速演化的实验系统。**

### 2. IPC 边界有专门的"入口页"形态

典型路径：

```
call   →   入口页
   →   bt [位图]        （测试）
   →   jnc fail         （失败分支）
   →   jmp 业务页
```

而**隔离模式下，后面的跳转甚至可以故意触发 page fault**，再由内核验证来源并完成映射/地址空间切换。

**所以碰到 `call unknown / bt [...] / jnc trap / jmp unmapped` 不要按传统 RE 思维判成**：obfuscation、CFI stub、broken CFG——**它可能就是正常的 IPC 边界**。

### 3. 共享内存指针必须带域语义

共享内存页**页对齐且受 capability 控制**；IPC 传大数据时直接通过**预映射共享内存**传 offset/length。

数据结构应记成：

```
{ domain, shmem_cap, mapping, offset, length, rights }
```

**而不是**

```
void *buffer;
```

否则数据流分析会把**大量合法的跨域数据流错误合并**。

### 4. 驱动生命周期与硬件生命周期分开建模

驱动可动态加载、热插拔、sandbox 销毁重建；滚动更新中旧/新服务并行、迁移后再终止旧实例。而跨系统经验（见上表）说明：**软件实例重建并不意味着硬件状态回到 clean boot**。

所以状态模型要从

```
loaded → initialized → running → unloaded
```

扩展成**分别跟踪**：

```
module instance / driver domain / device ownership / DMA ownership /
IRQ routing / client binding / version binding / migration state
```

## 三、触发条件（命中 / 不要命中）

**这一节的目的：让本分支只在确实是本类系统时被命中，不在 Xen / Fuchsia / seL4 一类系统上误触。**

**命中（任一即可）**：

- 模块元数据里带**自定义模块格式标识**（自描述模块：UUID + 版本 + 端点 + 资源需求 + 依赖 + 签名）
- 出现"**同名特权级进程之间靠 MMU 隔离**"的模型（服务与内核核心同物理特权级，靠页表而非 CPL 区分）
- IPC 快路径出现**入口页 + 位图测试 + 失败分支 + 跳业务页**的固定形态
- 证据显示**两种 capability 记账模型并存**（per-core 无全局锁 ↔ 受保护的全局表）——即代际差异
- 模块可**动态加载/销毁重建**，且存在**旧新实例并行的滚动更新**语义

**不要命中（这些属于别的分支）**：

| 现象 | 该走哪里 |
|---|---|
| 只是"驱动在用户态" | [[re-rtos/qnx]]（用户态 server）、[[helenos]]（DDF）、[[redox]]（scheme）——**用户态驱动本身不足以命中本分支** |
| 只是"有 capability / handle 是本地标识" | [[sel4-kernel]]、[[zircon-kernel]]、[[genode]]；多内核类系统（core-local capability space）也各走自己的分支 |
| 只是"共享内存 + 通知" | [[re-hypervisor/xen]]（grant/event）、[[re-hypervisor/hyperv-vmbus]]（GPADL）、[[re-rtos/qnx]]（io-pkt 类） |
| 只是"有滚动更新" | [[minix3]]（RS 自愈 / live update）、[[netbsd-kernel]]（按需加载） |
| 只是"看到直接 MMIO" | 不足以说明任何事——见上表 QNX / Genode 两条 |

**判据**：**本地分支的标志是"特权级相同 + MMU 隔离 + 模块自描述元数据 + 代际可变的 capability 记账"这一组合**，而不是其中任何单独一条。

## 决策树

```
拿到目标
├─ 先做模块元数据 triage（自描述模块：UUID/版本/端点/资源/依赖/签名）
│    └─ 元数据先于反汇编
├─ 确认代际
│    ├─ capability 记账是 per-core 还是全局表？
│    └─ 用代码签名 / 数据布局 / 调用路径判定，别按最新文档直接套结构
├─ 不要从指令形态推信任边界
│    ├─ 直接 call ≠ 同一组件
│    ├─ 直接 MMIO ≠ 全机内核权限
│    └─ mov [addr] 可能是被授权的 MMIO
├─ IPC 形态
│    ├─ 入口页 + 位图 + 失败分支 + 跳业务页 → 正常 IPC 边界
│    └─ 跳转触发 fault 后由内核验证来源并映射/切换 → 也是正常
├─ 数据流
│    └─ 共享内存指针带 {domain, cap, mapping, offset, length, rights}
└─ 生命周期
     ├─ 模块实例 / 域 / 设备所有权 / DMA / IRQ 路由 / 客户端绑定 / 版本 / 迁移状态 分别跟踪
     └─ 旧新实例并存 = 合法状态；软件重建 ≠ 硬件回到 clean boot
```

## 工具与验证

- 元数据：模块自描述字段（UUID、版本、端点、资源需求、依赖、签名）
- 域模型：谁与谁同特权级、谁靠 MMU 隔离、capability 记账在哪个粒度
- 映射：共享内存的 {domain, cap, mapping, offset, length, rights}；物理页的 owner / mapped domain
- 生命周期：模块实例、设备所有权、DMA、IRQ 路由、绑定与版本、迁移阶段的分别记录
- 验证：能同时说清「这是哪一代实现 + 该调用的信任边界由什么决定 + 这块内存在哪些域里可见」

## 该平台的坑（汇总）

- **用 "Ring 0 → 全内核可寻址" 推理**：同特权级进程之间靠 MMU 隔离，这条不成立
- **用"是否直接 call"判断驱动边界**：可能同地址空间，也可能跨隔离域
- **把初始化里的 reset / 状态探测当 boilerplate 删掉**：可能是恢复路径
- **先反汇编后看模块元数据**：顺序反了，元数据是第一层 triage
- **把整数 handle / 页索引 / ring offset 先当指针**
- **内存取证只存虚拟地址**：还要 owner domain / mapped domain / backing frame / capability
- **"能访问 MMIO"就判有内核权限**：访问权限与运行位置是两个变量
- **默认存在单一全局命名空间**：capability space 可能是 core-local
- **按最新文档直接套结构体布局**：先做代际指纹
- **把入口页 IPC 形态判成混淆 / CFI stub / 坏 CFG**
- **共享内存指针只记 `void *`**：会把合法跨域流错误合并
- **把"线程 idle"当可安全替换**：还要看 outstanding DMA / descriptor ownership / IRQ / 协议事务
- **滚动更新中看到旧新实例并存就判异常**：这是合法状态
- **软件实例重建就假设硬件已回到初始状态**
