# 跨系统运行模型与误判总表

**用途**：任何"现象看起来异常"的时刻，先过这张表。它的价值不在于介绍系统，而在于**阻止把某个系统的正常机制判成 bug / hook / dead code / 恶意**。

**前置**：本文件假设你已经知道"这是哪个系统"。**认不出目标时先走 [[system-fingerprints]]**（载体格式 → 家族 → 系统 → 易混淆对 → 负判据）。两者配合使用：先定身份，再查该身份允许哪些"正常异常"。

判定顺序（本文件的核心主张）：

```
观察异常现象
  → 识别目标的运行模型（哪个系统、哪个构建、哪个阶段）
  → 判断该模型允许哪些"正常异常现象"
  → cross-view / 配置核对 / 运行时验证
  → 最后才判定：损坏、恶意，或真的是 bug
```

## 一、十类高频误判（先怀疑，再排除）

| 观察到的现象 | 不要直接推断 | 必须先排除 |
|---|---|---|
| 函数 0 xref | dead code | linker set、generated registry、callback、IPC dispatch、RTE、init table、AST、exception table |
| 地址变化 | hook / 不同 binary | KASLR、KARL、relocation、PAC、GPA/HPA、local handle |
| 同一个整数 | 同一个对象 | CPtr、Zircon handle、endpoint、fid、grant ref、event port、capability name |
| driver 没有 syscall / IRP handler | 没有 I/O | framework callback、user-space driver、miniport、resource manager、DDF、scheme |
| thread READY 却不运行 | scheduler bug | partition window、budget、SC、safety class、上层 scheduler、调度器被禁用 |
| 文件存在但代码没运行 | loader bug | activation state、AuxKC、Function Group、module load stage、按需发现 |
| disk code ≠ runtime code | rootkit | livepatch、ftrace、jump labels、kernel collection、runtime relocation、init 段已释放 |
| IPC 没有 syscall trace | 没发生通信 | shared-memory channel、local transport、co-located driver、VMBus、grant table |
| memory access fault | 内存坏了 | MPU zone、capability rights、cell/partition 归属、IOMMU、当前特权级 |
| 服务突然换 PID / endpoint | 劫持 | restart / live update / reincarnation / 按需加载 |

## 二、共同规律 A：本地句柄 ≠ 全局标识

跨进程、跨分区、跨域建图之前，**必须先恢复 `本地标识 → 命名空间/表 → 真实对象`**，再谈关系。

| 系统 | 本地标识 | 恢复方式 |
|---|---|---|
| seL4 | CPtr | 各自的 CSpace 映射 → kernel object |
| Fuchsia/Zircon | handle 整数 | 进程 handle 表 → 对象 + rights |
| MINIX 3 | endpoint / grant ID | label 解析、grant 表条目 + 序列号 |
| Genode | capability 局部名 | PD 局部命名 → session/对象 |
| Plan 9 | 9P fid | 连接 + walk 历史 + qid |
| Xen | grant ref / event port | grant 表条目；`shared_info` 位掩码（远端端口才稳定） |
| Bao | —— | 共享对象 identity 是配置里的 `shmem_id`，不是地址 |
| ACRN / Jailhouse | —— | 共享区归属由配置/前缀（`dm:/` vs `hv:/`）决定 |

## 三、共同规律 B：ready 不是"有资格现在占用 CPU"的充分条件

分区/安全系统（ARINC 653、PikeOS、INTEGRITY、Deos、XtratuM、LynxSecure、Jailhouse、Bao、Quest-V）**共用一条经验**：

```
资源资格（budget/quota）
  → 分区/域资格（当前窗口、调度计划、CPU 归属、safety mode）
  → 本地调度器资格
  → 线程优先级
```

**不能简化为"最高优先级 READY 者运行"。** 分析时先对齐分区级时间线，再看线程级。

## 四、共同规律 C：没有内核入口 ≠ 没有 I/O

用户态驱动/服务形态各异，但结论相同——**在 kernel 里找不到 dispatch 是常态**：

resource manager（QNX）、DriverKit/System Extension（macOS）、driver host（Fuchsia）、DDF（HelenOS）、scheme（Redox）、user-space service + RS（MINIX 3）、user-space file server（Plan 9）。

## 五、共同规律 D：没有 CFG 边 / 没有 syscall ≠ 没发生

- **注册式**：linker set（FreeBSD `set_*`）、iterable section + `SYS_INIT`（Zephyr）、generated RTE（AUTOSAR）、配置生成的 task/handler（TOPPERS、RTEMS）、autoconf（OpenBSD）、按需 autoload（NetBSD）
- **回调式**：framework callback（Windows 各模型）、SDK callback（VxWorks io-pkt、`nw_pthread_create`）
- **异步控制流**：AST（OpenVMS）、SRB（z/OS）、fault handler（seL4）
- **异常边**：`__ex_table`（Linux exception fixup）
- **共享内存式**：PV ring（Xen）、driver runtime local transport（Fuchsia）、grant（MINIX）、VMBus（Hyper-V）、VirtIO/共享页

## 六、共同规律 E：信任边界不能从指令形态推导

**在 capability / 沙箱 / 多版本 / live-update 型驱动系统里**（覆盖 seL4、Genode、Fuchsia、多内核系统、分区 hypervisor、用户态驱动 OS 等）：

```
不从 CPL、地址、直接调用或 MMIO 指令推导信任边界
```

先恢复 **domain、capability、mapping、device ownership、version、lifecycle topology**，再解释控制流。四条推论：

| 看起来像 | 实际可能是 |
|---|---|
| 直接 call | 跨逻辑组件的调用（同地址空间 ≠ 同组件；同组件也可能跨隔离域） |
| 直接 MMIO | 被授权的设备映射（**"能访问 MMIO" ≠ "有整机内核权限"**） |
| 同特权级 | 靠 MMU 隔离的独立域（**Ring 0 → 全内核可寻址** 在这类系统上是 invalid assumption） |
| 整数句柄 | capability / 共享页偏移 / domain-local 标识（跨域比较无意义） |

配套要求：内存取证要区分 **VA / PA / backing frame / capability / owner domain / mapped domain**；共享内存指针要带域语义（`{domain, cap, mapping, offset, length, rights}`），否则数据流分析会把合法跨域流错误合并。具体系统分支见 [[re-kernel/hic]]、[[re-kernel/sel4-kernel]]、[[re-kernel/zircon-kernel]]、[[re-kernel/genode]]。

## 七、共同规律 F：磁盘上的 ≠ 正在跑的

livepatch / ftrace / jump label（Linux）、AuxKC 与 Kernel Collection（macOS）、runtime relocation 与 `__init` 释放（Linux）、live update（MINIX 3）、动态模块替换（Nucleus、OSE）、按需发现（Haiku）。

**动手比较前先对齐三份身份**：磁盘版本 / 加载集合中的版本 / 当前真正在跑的版本。

## 七、跨系统异常处理树

```
看到"异常"
│
├─ 函数没有 caller
│   ├─ callback registration
│   ├─ linker set
│   ├─ generated RTE / config
│   ├─ IPC dispatch
│   ├─ AST / SRB
│   ├─ exception table（__ex_table）
│   └─ init / iterable section
│
├─ 地址不一致
│   ├─ KASLR / KARL
│   ├─ PE / ELF relocation
│   ├─ PAC
│   ├─ GPA / HPA
│   ├─ local handle namespace
│   └─ runtime KC / image
│
├─ driver 没有内核入口
│   ├─ user-space driver
│   ├─ resource manager
│   ├─ DriverKit
│   ├─ Fuchsia driver host
│   ├─ Redox scheme
│   ├─ HelenOS DDF
│   └─ MINIX service
│
├─ thread 不执行
│   ├─ partition window
│   ├─ budget / quota
│   ├─ SC donation
│   ├─ safety class
│   ├─ Hwi/Swi scheduler 被禁用
│   ├─ partition mode（未进 NORMAL）
│   └─ 上层 scheduler
│
├─ IPC 没有 syscall
│   ├─ shared-memory ring
│   ├─ polling
│   ├─ co-located transport
│   ├─ VMBus / GPADL
│   ├─ grant table
│   └─ hypervisor channel
│
├─ memory access fault
│   ├─ capability rights
│   ├─ MPU zone
│   ├─ task isolation
│   ├─ cell / partition assignment
│   ├─ IOMMU
│   └─ runtime privilege level
│
├─ binary 存在但没运行
│   ├─ AUTOSAR Function Group / Machine State
│   ├─ System Extension activation
│   ├─ boot / module stage
│   ├─ partition mode
│   └─ on-demand driver discovery
│
└─ runtime 与 disk 不同
    ├─ livepatch
    ├─ jump-label / ftrace
    ├─ AuxKC / kernel collection
    ├─ dynamic module relocation
    ├─ init code 已释放
    └─ live update / restart
```

## 八、使用方式

1. 现象命中上表任一行 → **先按"必须先排除"逐项核对**，不要跳到结论
2. 需要某个系统的细节 → 按 [[rerouting]] A 表或 [[capability-index]] 反查对应技能与分支
3. 核对手段统一是三样：**cross-view**（多视图交叉）、**configuration**（配置/清单/计划文件）、**runtime verification**（运行时状态而非磁盘内容）
4. 只有在排除完该模型允许的正常机制之后，才写"损坏 / 恶意 / bug"的结论——并在报告里写明**排除了哪些可能性、依据是什么**

## 九、异常速查表（按现象直查）

| 现象 | 优先考虑 |
|---|---|
| AUTOSAR binary 存在但 process 不存在 | Function Group State / Execution Manifest |
| AUTOSAR service 暂时发现不到 | 服务发现允许空结果 / 可用性回调生命周期 |
| AUTOSAR process 无 crash 却重启 | 平台健康监控 → 状态管理 |
| AUTOSAR 更新后仍旧数据 / 数据消失 | Persistency 更新策略（keep / overwrite / delete） |
| 分离内核里找不到 runtime 配置器 | 静态配置 + 无动态系统修改 |
| guest 直接操作真实 MMIO / IRQ | 静态 direct assignment（I/O 被导出到 guest） |
| 分区 RTOS 里高优先级 READY 不执行 | 时间窗 / 调度域资格 |
| 分区 RTOS 多出 CPU 时间 | slack 回收 |
| 分区 RTOS 的 major frame 起点缓慢漂移 | 外部时钟同步类机制（需在具体型号文档确认） |
| 认证 RTOS 里同一地址权限不同 | per-task MPU/MMU 区域 |
| 认证 RTOS 里句柄不像指针 | 间接对象 ID + 交叉引用表 |
| ISR 唤醒了 task 却不切换 | 嵌套 ISR / ISR 退出协议 / 调度器锁 |
| task 被唤醒但没有资源 | 中止等待路径（唤醒 ≠ 获取成功） |
| 线性地址下仍存在隔离 | 线性映射 + entitlement（不是每进程独立 VA） |
| module 无 reboot 被替换 | 动态 reload / restart / update |
| 遇到 "partition" 一词 | 先分：空间隔离域 vs 固定块内存池 |
| 高优先级 task READY 不跑（TI SYS/BIOS） | 禁用 Swi 调度会连带禁用 Task 调度 |
| Swi 的栈看起来像 ISR 栈 | Swi 本就运行在系统/ISR 栈上 |
| ISR 里调用的 API 效果延后 | ISR FIFO 延迟队列 |
| 同一对象不同线程权限不同 | Safety Class / MPU 保护域 |
| plan switch 延迟生效 | 普通切换要等当前计划/MAF 结束 |
| plan 瞬间切换 | 健康监控切维护计划 |
| 采样端口"丢中间值" | latest-value 覆盖语义 |
| Service VM 里设备消失又回来 | 设备所有权移交给 post-launched VM |
| 共享内存设备各自正常却互不相通 | 两种实现（dm-land / hv-land）不互通 |
| 小整数被当地址（Hyper-V） | GPADL 是句柄 |
| 删除 GPADL 时卡住 | server 仍映射，阻塞直到解除 |
| packet 回调返回但资源未释放 | 完成调用可延后 |
| 取外部数据返回"待决" | 需要分页；稍后可能在不同 IRQL 再次回调 |
| 网络 VMBus 流量突然消失但网络正常 | SR-IOV VF 直通路径切换 |
| ring 更新却没有通知（Xen） | 通知抑制（阈值未越过） |
| event unmask 行为奇怪 | pending / masked / FIFO 语义 |
| 迁移后 domid / 端口变化 | 协议需要重新协商 |
| 同一 build 里事件记账布局不同 | 两套 ABI，解析器不能混用 |
| 0 xref 的 init 函数（Unikraft） | 多级初始化表（构造/早期/平台/库/rootfs/系统/晚期） |
| 同名 syscall 出现多个符号 | libc 风格 / raw-error 风格 / shim 三层包装 |
| 缺 syscall 返回 ENOSYS 但应用照跑 | 可选 syscall 桩 |
| 同一源码的 I/O 完全不同（MirageOS） | 构建目标决定 backend |
| 全部"线程"一起卡死 | 协作式线程不让出（饿死事件循环） |
| 后台任务异常没有直接杀系统 | 异步异常处理策略 |

## 十、版本与代际提示

- **按目标做版本指纹再套条目**：规范与手册存在代际差异——例如某平台规范已推进到新版本而多数公开细节来自上一版；某 hypervisor 最完整的公开手册属于某一代（如 XM-4），**不要无条件套到其他代际**
- 同一系统的不同产品线（安全认证版与基础版）**也不是同一份二进制/内核**，机制可选项不同
