---
name: re-kernel
description: >
  内核逆向（跨平台）：Windows 驱动（.sys/IRP/SSDT）、Linux 内核模块（.ko/ET_REL/LKM/rootkit）、
  macOS KEXT 与 System Extension/DriverKit、Android GKI/vendor module、seL4（capability 系统）、
  Fuchsia/Zircon（handle 模型 + DFv2 用户态驱动框架）、FreeBSD（linker sets/SYSINIT/KLD）、
  illumos/Solaris（DDI/DKI、dev_ops/cb_ops）、OpenBSD（KARL/autoconf/pledge）、NetBSD（模块按需自动加载）、
  Genode（组件树/session/quota）、MINIX 3（RS 自愈/grants/live update）、Plan 9（命名空间/9P）、
  HelenOS（fibril/DDF）、Redox（scheme）、Haiku（device_node/按需发现）、
  z/OS（TCB·SRB/cross-memory）、IBM i（单一存储层）、OpenVMS（AST）、Unikraft·MirageOS（unikernel）、
  HIC（同特权级 MMU 隔离的驱动模型 / capability / 物理沙箱 / 自描述模块 / 入口页 IPC）。
  触发词：内核、驱动、.sys、.ko、LKM、kext、dext、rootkit、内核模块、IRP、GKI、内核扩展、
  seL4、capability、CSpace、CNode、capDL、CAmkES、MCS、Fuchsia、Zircon、handle、DFv2、driver host、FIDL、
  FreeBSD、KLD、SYSINIT、linker set、illumos、Solaris、DDI、dev_ops、cb_ops、
  OpenBSD、KARL、autoconf、pledge、unveil、NetBSD、kmod、GENODE、session、quota、MINIX、RS、grant、9P、Plan 9、namespace、
  HelenOS、fibril、DDF、Redox、scheme、Haiku、device_node、z/OS、TCB、SRB、cross-memory、IBM i、single-level storage、OpenVMS、AST、$QIO、unikernel、Unikraft、MirageOS。
  English triggers: kernel module, driver reversing, LKM, kext, rootkit, GKI, seL4, capability system, capDL, Fuchsia, Zircon, handle, driver framework, FIDL, FreeBSD, KLD, SYSINIT, linker set, illumos, Solaris, DDI, dev_ops, cb_ops, OpenBSD, KARL, autoconf, pledge, NetBSD, kmod, Genode, session, quota, MINIX, reincarnation server, grant, 9P, Plan 9, namespace, HelenOS, fibril, DDF, Redox, scheme, Haiku, device node, z/OS, TCB, SRB, cross-memory, IBM i, single-level storage, OpenVMS, AST, QIO, unikernel, Unikraft, MirageOS.
capabilities: [kernel-analysis]
---

# 内核逆向（跨平台）

<CORE RULE>
**内核态分析的难点不是"用什么工具反编译"，而是"观察与预期冲突时先怀疑什么"。**
各平台形态不同（PE / ET_REL / Mach-O / 模块集合），但共性是：**构建与加载模型决定你能看到什么**——版本、符号解析方式、结构随机化、签名、加载阶段、缓存集合，都会让"看起来一样"的两份东西实际不同。
所以顺序永远是：**先确认"我在看的这份是不是正在运行/被加载的那份"，再谈逻辑。**
</CORE RULE>

## 平台差异（不是同义替换）

| 平台 | 单元形态 | 加载与签名模型 | 类型信息来源 | 主要观测面 |
|---|---|---|---|---|
| Windows | **先分驱动模型**：WDM / KMDF / UMDF / minifilter / NDIS·miniport；再谈 `.sys`（PE） | SCM 注册 + 驱动签名（WHCP / 测试签名；**2026-04 起 legacy cross-sign 默认不受信**） | PDB（public≠private）、WDK / `ntddk.h` 类型 | WinDbg 内核调试、`!drvobj`/`!process`/`!wdfkd.*`、Volatility |
| Linux | `.ko`（**ET_REL** 可重定位目标） | `insmod`/modprobe + vermagic / symbol CRC / 签名尾 | BTF（含 split BTF 与 `.BTF.base`）、vmlinux、源码 | `/proc/kallsyms`、`/sys/module/*/sections/`、kprobe/ftrace、内存 cross-view |
| macOS | **三套模型**：KEXT（内核态）/ DEXT·DriverKit（**用户态**）/ System Extension（框架） | AuxKC（启动时加载）+ UAKL + Reduced Security / System Extension 激活审批 | 符号、Mach-O、`Info.plist`（IOKitPersonalities） | IORegistry、`kmutil`、dSYM+KDK；dext 走用户态分析与调试 |
| Android | GKI module / vendor module | GKI 签名 + **KMI 符号白名单** | BTF、KMI symbol list、`Module.symvers` | 模块所在分区、`modules.load` 计划 |
| seL4（微内核） | **capability 系统**：对象（TCB/Endpoint/CNode/Frame/Untyped/SC）+ cap 分布 | **无 capability 即无访问权**；对象在构造期由 spec/loader 创建 | capDL spec（`.cdl`）、CAmkES ADL、ELF | capDL snapshot（`seL4_DebugSnapshot`）、`seL4_DebugCapIdentify`、QEMU 仿真 |
| **Fuchsia/Zircon** | **handle 引用内核对象**（数值**进程本地**）+ **用户态驱动 component**（DFv2） | driver manager 维护 node 拓扑、driver index 按 **bind rules** 匹配、driver host 承载实例 | FIDL、组件清单、bind rules | driver manager/driver index 的匹配与拓扑、driver host 进程划分、handle+rights 关系图 |
| **FreeBSD** | `.ko`（KLD，ELF 可重定位） | **linker sets + `SYSINIT`**（`SI_SUB_*` + `SI_ORDER_*` 排序）+ 运行期 kernel linker | 符号、`set_*` 集合、源码 | `__start_set_*`/`__stop_set_*` 边界、加载路径（内建/预加载/`kldload`） |
| **illumos/Solaris** | `.so` 内核模块（DDI/DKI 驱动） | `_init` → `mod_install(&modlinkage)`；`_fini` → `mod_remove` | `modlinkage`→`modldrv`→`dev_ops`→`cb_ops` 静态链 | 逐字段读 `dev_ops`/`cb_ops`（含 `nulldev`/`nodev` 占位语义） |
| **OpenBSD** | 与一般 Unix 同形，但内核**每次 boot 重新随机链接**（KARL）+ autoconf 运行时匹配 | link kit + rc 后台重链接；detach 可等待使用者退出 | 符号（**KARL 后必须按符号而非字节比较**） | link kit/rc 重链接痕迹、autoconf 表、pledge/unveil 状态 |
| **NetBSD** | `.kmod`（ELF，由内核 linker 解析） | **按需自动加载**（含依赖递归）+ 自动卸载；模块与内核版本强约束 | 模块版本报告与内核版本 | 实际模块路径（布局随 `KERNEL_DIR` 变化）、`.plist` 属性 |
| **Genode** | **组件树**：session + capability + quota | parent 中介的路由，名字**逐层重映射** | 组件的 XML 配置与路由表 | capability 的 PD 局部命名、quota 捐赠链、ROM 更新 |
| **MINIX 3** | **用户态服务 + RS 自愈重启** | RS 监控/重启；label 稳定、**endpoint 会变** | 定长消息（56 字节）定义与 grants | 服务 label↔endpoint、grant 校验、live update 阶段 |
| **Plan 9 / 9front** | **每进程命名空间 + 用户态 file server** | bind/mount/union；服务经 `/srv` 发布后挂载 | 9P 的 fid/qid/walk 与消息类型 | 命名空间绑定历史、9P 会话对齐 |
| **HelenOS** | 用户态 server + **fibril**（内核不知道） | 用户态 DDF；devman 按 match id 评分启动驱动 | DDF 结构（`driver_ops_t`） | kernel thread 与 user fibril 的区分 |
| **Redox** | **scheme + 用户态 daemon** | 内核把文件操作转成 SQE/CQE 消息 | SQE/CQE 字段、句柄映射 | scheme 名 → provider；客户端 fd 与 provider 描述符的映射 |
| **Haiku** | kernel module，但分 **driver module / device module** 两层 | Device Manager 的 device_node 树 + **按需发现** | 节点属性与总线类型规则 | `/dev` 路径 ↔ 节点 ↔ 驱动 |
| **IBM z/OS** | **TCB 与 SRB** 两类可调度单位 | cross-memory / PC / AR 模式 | 地址空间三元组（home/primary/secondary） | 当前 primary/secondary/home 与工作单位类型 |
| **IBM i** | 对象式（库即容器对象） | **单一存储层**：内存与磁盘同一 64 位地址空间 | 对象限定名与全局指针 | 对象引用 vs 主存地址 |
| **OpenVMS** | 进程/线程 + **AST 异步控制流** | `$QIO` + 事件标志 + AST | IOSB、AST 参数 | 完成流（IOSB → 标志 → AST） |
| **Unikraft / MirageOS** | **库操作系统 / unikernel**：应用与 OS 库整链 | 构建目标决定一切（native vs binary；unix/hvt/xen…） | 构建配置与 shim | 调用进入"内核"的方式、设备接线来源 |
| **HIC** | **同特权级进程 + MMU 隔离**（Privileged-1 与 Core-0 同物理特权级）；驱动只映射被授权的 MMIO/共享内存 | 自描述模块（UUID/版本/端点/资源/依赖/签名）+ capability 记账；动态加载与滚动更新 | 模块元数据、capability 表 | domain / capability / mapping / device ownership / version / lifecycle 拓扑 |

## 失败模式决策表（本技能的主入口）

**当反编译结果或运行观察与预期冲突时，按这张表先怀疑、再排除**：

| 症状 | 优先怀疑（按顺序） | 处理方向 |
|---|---|---|
| struct offset 全错 | ① BTF 与目标是否匹配 ② kernel build 是否匹配 ③ **RANDSTRUCT**（`CONFIG_GCC_PLUGIN_RANDSTRUCT`；此类内核带 taint `T`） | 优先级：目标 BTF > exact build debug info > exact seed+config > 动态验证 > 猜 offset（最差） |
| symbol resolution 怪异 | ① **MODVERSIONS**（CRC）② **Android KMI** ③ **livepatch**（`.klp.rela`/`.klp.sym`）④ split BTF | 各按对应分支核对，别当"文件损坏" |
| 文件与运行行为不一致 | ① Linux 运行时 relocation / init-only 段已消失 ② **macOS AuxKC 仍在跑旧版本** ③ Android 实际加载的是另一分区的同名模块 | 记录"磁盘版本 / 运行版本 / boot 时间"，别只看磁盘 |
| 磁盘代码与内存指令不一致 | **先排除合法动态 patching**：alternatives、static keys/jump labels、ftrace、livepatch、paravirt、kprobe（Linux） | 只有"无法解释的修改"才提高 rootkit 嫌疑——大量"像被篡改"其实是内核机制 |
| 内存里找不到某个函数 | ① `__init` 段已释放 ② built-in（本就没有独立 .ko）③ stripped ④ split BTF | 追"**init 留下了什么状态改变**"（callback/hook/改过的指针），而不是找 init 本身 |
| `kallsyms` 全 0 / 地址对不上 vmlinux | ① `kernel.kptr_restrict` ② **KASLR**（kernel text 与 module base 都随机化） | 先看策略与恢复 slide，别判"被 hook"或"不是同一个 kernel" |
| 符号化 offset 一直飘 / 解析成字符串 | ① 漏了 **`__TEXT_EXEC.vmaddr`**（arm64e 的 KEXT panic 基址要加它）② 符号文件与 panic image 的 **UUID/build** 不一致 | 先按段调整基址，再核对 UUID+arch+exact build（KDK），别怀疑反汇编 |
| kext 签名合法但就是加载不了 | 不只是签名：**UAKL / 用户批准 / Reduced Security / AuxKC 重建 + 重启**；x86_64 kext 还撞 `KMErrorDomain 71`（**Rosetta 不翻译 kext**） | 把 architecture / signature / approval / UAKL / boot policy / AuxKC inclusion 分开判断 |
| UserClient 连不上 / `kIOReturnBadArgument` | ① activated/entitlement/Team ID/sandbox ② **dispatch 的 count/size/completion 在 handler 之前就拒** | 按"先授权链、后 ABI、最后 handler"的顺序排，别先猜 selector 逻辑 |
| 模块"消失" | ① built-in（本就没有模块文件）② **rootkit 摘链**（module list unlink）③ macOS Kernel Collection ④ Android 另一分区或另一 boot stage | cross-view 交叉比对，别用单一视图下结论 |
| driver IPC 调不通 | ① selector/ABI ② **entitlement** ③ sandbox ④ Team ID（macOS）⑤ service 根本没 activate ⑥ **dispatch 的 count/size/completion 在 handler 之前就拒**（Windows 的 `kIOReturnBadArgument` 同构情况见 macOS 分支） | 从"能不能连"排到"连上之后怎么调"，而不是直接猜 selector |
| 找不到 IRP handler / `MajorFunction` 为空 | **先判驱动模型**：KMDF（`!drvobj` 指向 Wdf01000.sys 是正常）、NDIS/miniport、minifilter、UMDF | 去找对应的 **callback 注册图**（Evt* / Ndis* / FLT_* / WDF config dataflow），不是"没有 I/O" |
| `IoCallDriver` 已返回但行为没完成 | **completion edge**：`STATUS_PENDING` 不是失败，终态在 `IRP->IoStatus.Status` 与 completion path（`STATUS_MORE_PROCESSING_REQUIRED` 会接管） | CFG 要补 completion 边，否则 cleanup/copy-back/retry 像"没人调用" |
| 老 `.sys` 突然加载不了（签名看着没问题） | ① **2026-04 起 legacy cross-sign 默认不受信**（WHCP 才认；先行评估模式）② HVCI 下 Test Mode 仍要签名 ③ Secure Boot 阻挡 testsigning | 别判"签名损坏"或"API 变了"，先查策略层（见 [[windows-kernel]] §26–28） |
| 看见异常 ELF section | ① 签名尾（附加在 ELF 末尾）② livepatch `.klp.rela` ③ BTF/`.BTF.base` ④ ORC unwind ⑤ 架构/工具链元数据 | 先分类再处理；**不要为了"修好"去 truncate/strip** |
| 相同 CPtr 数值被当作同一对象 | **CPtr 是各 CSpace 的本地地址**，不是全局 ID（seL4） | 先恢复各自 CSpace 映射，按 **kernel object** 对齐 |
| 线程/服务"卡住"或像"配置损坏" | ① MCS：SC 未绑定 / budget 耗尽 / passive server 本就没有 SC ② fault handler 没修复 fault | 按 MCS 语义排查（SC / budget / 捐赠链），**别套 POSIX 死锁** |
| IRQ 只来一次 | 没有 Ack（seL4：未 ack 内核不再送后续中断） | 查 IRQ 处理循环里的 `seL4_IRQHandler_Ack` |
| 相同 handle 数值被当作同一对象 | **handle 数值只在当前进程内有意义**，关闭后还会被重用（Fuchsia/Zircon） | 按各进程的 handle 表恢复到 **kernel object** 对齐；关系图记 **object + handle + rights** 三项 |
| 曾经持有的 handle 现在报 `BAD_HANDLE` | **被 `channel_write` 送走了**（in-transit / transfer），或写入失败被丢弃 | 先查 transfer 语义（含 `ZX_RIGHT_TRANSFER` 是否被移除），**别判 UAF** |
| 明显有驱动间 IPC 但 syscall trace 里没有 channel 调用 | **两个驱动同驻同一个 driver host** → driver runtime 的进程内通道 | 用 driver host 划分验证（同驻时 node symbols 才走进程内），别判"调用被隐藏"（[[zircon-kernel]]） |
| 按 `bus probe()` 找不到驱动绑定 | DFv2 用 **node properties + bind rules 经 driver index 匹配** | 恢复 node → bind rules → driver component → driver host 链，而不是找 probe 回调（[[zircon-kernel]]） |
| 某个 init / 注册函数**没有任何调用者** | **linker set 注册**（FreeBSD `SYSINIT`；Zephyr 见 [[re-rtos/zephyr]]） | 由函数地址回溯到注册结构体与所属 `set_*` 集合，**别标 dead code**（[[freebsd-kernel]]） |
| 一大段连续指针/对象、section 名 `set_*` | 内核自己的**linker set** 集合 | 按注册集合解释，而不是 jump table / 混淆表 |
| 驱动的"支持什么"判断不一致 | `nulldev`（合法 no-op）与 `nodev`（不支持，返回 `ENXIO`）被混同 | 逐字段读 `dev_ops`/`cb_ops` 的占位符语义（[[illumos-kernel]]） |
| 同版本内核**每次启动布局都不同** / 两份二进制逐字节不一致 | **KARL 重链接**（OpenBSD）——不是被 patch、也不是版本不同 | 按符号/语义比较，别做字节比较（[[openbsd-kernel]]） |
| 模块**自己出现/自己消失**，找不到加载者 | 内核**按需自动加载**与自动卸载（NetBSD） | 对齐到触发它的事件与 `.plist` 设置，看时间线而非进程（[[netbsd-kernel]]） |
| 模块加载失败但文件看着正常 | 模块与内核**版本兼容性**（NetBSD） | 先核对 exact kernel version/build，别随手强制加载（[[netbsd-kernel]]） |
| 服务名相同却像连到了不同对象 / capability 数值被当作全局 ID | 名字只在**局部层级**成立、capability 是 **PD 局部命名**（Genode） | 按路由表 + label 链 / 按 session 对齐（[[genode]]） |
| 驱动进程**消失又出现** | **RS 自愈重启**（MINIX 3）——不是持久化 | 对齐 label（稳定）与 endpoint（会变）（[[minix3]]） |
| IPC 里的整数被当作 buffer 指针 | 可能是 **grant ID**（MINIX 3，消息定长 56 字节） | 按 `(endpoint, grant ID, offset, rights)` 还原；`EPERM` 是 grant 无效而非权限不足 |
| 路径相同却访问到不同对象 | **每进程命名空间**（Plan 9） | 恢复 bind/mount 历史与 9P 会话，别按路径断言同一资源（[[plan9]]） |
| 一个 OS thread 内出现大量"线程切换" | **fibril**：用户态协作调度，**内核不知道它**（HelenOS） | 别在内核调度里找证据（[[helenos]]） |
| `read`/`write` 落到的东西不是文件系统 | **scheme 决定含义**（Redox） | 按 scheme 名找 provider；客户端 fd 与 provider 描述符不相等（[[redox]]） |
| boot 时驱动不在、后来才出现 | **按需发现**（Haiku） | 查总线类型规则与按需标志，别判加载失败（[[haiku]]） |
| 执行地址属于另一个地址空间 | **cross-memory / PC 指令**（z/OS） | 区分 home/primary/secondary 与 TCB/SRB，别判劫持（[[zos]]） |
| 例程没有调用者却有行为 | **AST 异步控制流**（OpenVMS） | 补 AST 边；等待"返回后又等待"属正常（[[openvms]]） |
| 对象地址不像 DRAM 指针 | **单一存储层**（IBM i） | 内存与磁盘同一 64 位地址空间，别套 POSIX 文件模型（[[ibmi]]） |
| 找不到 user → syscall → kernel 边界 | **库操作系统 / unikernel** | 先判构建目标；"系统调用"可能只是函数调用（[[unikraft-mirageos]]） |
| 模块自带 UUID/版本/端点/资源/依赖/签名 的自描述元数据 | **先做元数据 triage，再反汇编** | 元数据是第一层证据（[[hic]]） |
| 快路径 IPC 呈"入口页 → 位图测试 → 失败分支 → 跳业务页"、跳转可触发 fault | **正常 IPC 边界**（隔离模式下的换页/验证路径） | 别判混淆 / CFI stub / 坏 CFG（[[hic]]） |
| 同一 capability 结构在不同版本或文档里布局不同 | **先做代际指纹**（per-core 无全局锁 ↔ 受保护全局表） | 别按最新文档直接套结构（[[hic]]） |
| 初始化里大量"看似多余"的 reset / 状态探测 | **sandbox restart / recovery 路径**（驱动重建 ≠ 硬件回到 clean boot） | 别当 boilerplate 删掉（[[hic]]） |

## 通用主线

1. **确认身份**：这是哪一份（磁盘 / 运行 / 加载集合中的版本）、什么构建（vermagic / CRC / KMI / 签名）、什么形态（PE / ET_REL / Mach-O / 用户态 dext）
2. **类型与符号**：优先官方类型来源（PDB / BTF / 符号表 / KMI list），其次精确构建信息，最后才是推断
3. **功能骨架**：从 imports/exports 与内核 API 调用关系切分功能——闭源或 stripped 时这一步尤其有效
4. **hook 与隐藏**：枚举 hook 落点（表项 / inline text / 回调数组 / operation 结构）+ **cross-view 交叉**（用户态视图 vs 内核真实对象与内存）
5. **验证与收尾**：运行时核对（调试器 / kprobe / IORegistry / 内存侧），结论与证据按 [[re-analyze/analysis-contract]] 入档

## 平台分支（references）

- [[windows-kernel]] —— **先分驱动模型**（WDM/KMDF/UMDF/minifilter/NDIS·miniport）；`GsDriverEntry` 不是业务入口；WDM 的 `DRIVER_OBJECT` 赋值图；KMDF 的 Evt* callback 与 `WDF_*_CONFIG` dataflow（`!drvobj` 指 Wdf01000.sys 属正常）；miniport/NDIS 的注册 callback；**device stack 与 INF 栈位置**；minifilter 的 altitude 与 pre/post 流水线；`CTL_CODE` 与 `METHOD_*` 的 buffer 语义（NEITHER 用户指针）；**completion edge 与 `STATUS_PENDING`**；`PAGE` section 的 IRQL 语义；Driver Verifier 的故障注入与 0xC9；PE relocation；PDB public/private 与 signature+age；`!analyze -v` 只是入口；**UMDF/Wudfhost 与 `!wdfkd.wdfumdevstacks`**；**2026 驱动签名策略与 HVCI 兼容要求**；callback-registration graph
- [[linux-kernel]] —— **三个不要**（.ko 非普通 ELF / 磁盘代码非运行态真值 / 怀疑 rootkit 后不信单一枚举）；artifact 识别（bzImage 是压缩 boot image）；relocation 优先与 `.modinfo`；`.ko` 合法形态全集（签名尾 / 压缩 / BTF 与 split BTF+`.BTF.base` / RANDSTRUCT / livepatch `.klp.*` / ORC unwind）；**合法动态 patching 清单**（alternatives/static keys/ftrace/livepatch/paravirt/kprobe）；`__ex_table` 的 exception edge；ENDBR；callback-registration graph；`__init` 释放与加载阶段诊断（`CONFIG_MODULE_STATS`）；MODVERSIONS 两代格式；KASLR 与 kptr_restrict；rootkit cross-view
- [[macos-kernel]] —— **三套模型混用**（KEXT 内核态 / DEXT 用户态 / System Extension 框架）；`Info.plist` 先行与 IOKit class graph（OSMetaClass/vtable）；codeless kext；**磁盘 vs AuxKC 版本**与 unload 假象；arm64e PAC 指针；`newUserClient`→`externalMethod` 与 dispatch 的 `check*` 字段（`kIOReturnBadArgument` 可能是框架拒的）；授权链排错顺序；dext 按用户态分析与调试；Kernel Collection；**panic 符号化的 `__TEXT_EXEC` 偏移与 UUID/KDK 匹配**；UAKL/Reduced Security/AuxKC 与 **KIP**；rootkit 的年代差异；KEXT 双机调试 vs DEXT 本机调试
- [[android-kernel]] —— GKI vs vendor module、protected symbol 与 KMI 白名单、KMI 分支不可互换、模块位置与加载计划
- [[sel4-kernel]] —— **capability 系统**：CPtr 是本地地址不是全局 ID、capDL/CAmkES 语义、badge 与 rights、CSpace guard/depth、错误码即诊断、Untyped 与 device untyped、用户态驱动的 IRQ 与 DMA 旁路、fault IPC、MCS（SC/budget/passive server/reply object）、capDL snapshot cross-view
- [[zircon-kernel]] —— **handle 本地性**（数值仅进程内有效、关闭后可重用、跨进程比对无意义）、**in-transit 与 transfer**（写入即从发送方移除、失败也会被消费、`ZX_RIGHT_TRANSFER`、rights 只能收窄；关系图记 object + handle + rights）、**DFv2**（driver manager / driver host / driver index / driver runtime；bind rules 匹配而非 `bus probe()`）、**同驻驱动的本地通道**（有 IPC 但无 syscall）、`/dev/foo` 是 FIDL channel 而非 Unix 设备文件
- [[freebsd-kernel]] —— **linker sets 与 `SYSINIT`**：注册项放进启动/关闭集合、按 `SI_SUB_*` + `SI_ORDER_*` 排序（同 sub 同 order 顺序未定义）、**现代 ELF 用 `__start_set_*`/`__stop_set_*` 定界且不再以 NULL 结尾**（按老结构扫描会越界）、`set_*` 集合的通用判据、KLD 的 `SI_SUB_KLD` 合并时机与反向拆除
- [[illumos-kernel]] —— **DDI/DKI 驱动骨架**：`_init`/`_fini`/`_info` → `modlinkage` → `modldrv` → `dev_ops` → `cb_ops`；**`nulldev`（合法 no-op）vs `nodev`（不支持，返回 `ENXIO`）**；`attach` 的 `DDI_ATTACH`/`DDI_RESUME`（`DDI_PM_RESUME` 已废弃）；每实例初始化属 `attach()`；`_fini` 在 `mod_remove` 失败时不得释放资源
- [[openbsd-kernel]] —— **KARL 重链接**（每次 boot 重新随机链接 `.o`，**变的是内部布局不是加载基址**，与 KASLR 不同；逐字节差异不能判 patch）；**autoconf** 运行时匹配/attach（`foo_attach` 无 caller 正常，detach 可等待使用者）；**pledge/unveil** 的单向棘轮与不可捕获 SIGABRT（"启动能访问、之后突然不能"是设计模式，别归因外部拦截）
- [[netbsd-kernel]] —— **按需自动加载模块**（无 modload 也会出现，含依赖递归）与**自动卸载**；**模块与内核版本强兼容约束**（不匹配失败，强制加载有官方警告）；模块路径随 `KERNEL_DIR` 新布局变化（硬编码 `/stand/...` 会漏样本）
- [[genode]] —— **组件树 + session + capability + quota**：服务名只在局部 parent 层级成立（每层可重映射，label 可被重写）；capability 是 PD 局部命名；**quota 捐赠沿路径被逐级扣减**（"系统还有内存"与"该 child OOM"不矛盾）；ROM session 支持更新
- [[minix3]] —— **RS 自愈重启**（驱动消失又出现是正常）；**label 稳定、endpoint 会变**；消息定长 56 字节、大数据走 **grants**（`EPERM` = grant 无效、`EFAULT` = 未映射）；**live update 期间旧/新实例共存**（不是注入）
- [[plan9]] —— **每进程命名空间**（同名路径可能是不同对象）；**union 只有单层叠加**；`/srv` 是服务注册表而非 socket；**9P 的 fid 是 session 内句柄**；`open/read/write` 常常是用户态 RPC
- [[helenos]] —— **fibril**（用户态协作调度实体，**内核不知道它存在**）；**用户态 DDF 驱动框架**（`driver_ops_t` 回调、devman 按 match id 评分匹配与启动）；业务不在内核 dispatch table 里
- [[redox]] —— **scheme 模型**：`read/write` 被内核转成 SQE/CQE 消息交给用户态 provider，**`read()` 不必然是文件系统**；**客户端 fd 与 provider 描述符由内核映射，不相等是常态**；provider 常主动进入 null namespace（安全设计）
- [[haiku]] —— **device_node 树 + 按需发现**（boot 时驱动没出现属正常）；**driver module 与 device module 两层**（前者绑定节点，后者暴露 `/dev` 接口），模块名有 `driver_v1`/`device_v1` 约束
- [[zos]] —— **TCB 与 SRB** 两类可调度单位（SRB 常被忽略：不能调 SVC、不能 WAIT）；**home/primary/secondary 三个地址空间**（PC 之后 primary ≠ home 属正常，home 永不改变）；AR 模式的 ALET 0/1/2
- [[ibmi]] —— **单一存储层**：内存与磁盘构成单一 64 位地址空间，对象**按名字而非硬件地址**访问，库本身也是对象
- [[openvms]] —— **AST 异步控制流**（例程可以没有调用者）；完成顺序 **写 IOSB → 置事件标志 → 触发 AST**；**AST 不会中止进行中的系统调用**，等待被打断后会重新执行
- [[unikraft-mirageos]] —— **库操作系统/unikernel**：单地址空间、单保护域；native（syscall 变函数调用）vs binary-compatible（捕获 Linux ELF 的 syscall）；**设备接线来自构建期配置**，同一源码不同目标行为全变
- [[hic]] —— **capability + 物理沙箱 + 多版本驱动系统**：**同物理特权级的进程之间靠 MMU 隔离**（`Ring 0 → 全内核可寻址` 在此为 invalid assumption）；**模块元数据先于反汇编**；**入口页 IPC 形态**不是混淆；共享内存指针带域语义 `{domain, cap, mapping, offset, length, rights}`；**驱动生命周期与硬件生命周期分开建模**（实例/域/设备所有权/DMA/IRQ 路由/绑定/版本/迁移状态）。含跨系统对照（Fuchsia / seL4-CAmkES / Xen / Genode / QNX / 多内核 / MINIX）与**命中-不命中清单**（避免在其他 capability 系统上误触）

## 何时使用 / 何时不用

- 用：各平台内核态载荷与驱动（恶意驱动 / rootkit / 反作弊 / EDR 对抗 / 闭源驱动）的静态逆向与运行时验证
- 用：**capability 系统**（seL4 等微内核）的对象图 / capability 分布 / IPC 拓扑恢复，以及"行为为何与普通 OS 不同"的判定
- 用：**Fuchsia/Zircon** —— handle 与 rights 关系恢复、DFv2 驱动的 bind rules 匹配与 driver host 划分、同驻驱动通信的判定（[[zircon-kernel]]）
- 用：**FreeBSD / illumos·Solaris** —— linker set 注册的初始化（找不到调用者）与 KLD 生命周期（[[freebsd-kernel]]）；DDI/DKI 驱动骨架与 `dev_ops`/`cb_ops` 能力判读（[[illumos-kernel]]）
- 用：需要判断"内存里/内核里这份代码是什么、从哪来、是否被改过"
- 不用：UEFI / 引导阶段（bootkit）→ [[re-uefi]]；RTOS 内核对象 → [[re-rtos]]；eBPF 程序（BPF-64 指令集、progs/maps）→ [[re-ebpf]]；TEE / TrustZone → [[re-tee]]；仅内核调试与崩溃定位 → [[re-windbg]] / [[re-lldb]]
- 不用：只需要采集内存里的载荷（不分析内核结构）→ [[re-sample-acquire]]

## 工具准备（按平台，细节见各分支）

- **Windows**：[[re-ghidra]] / [[re-ida]]（导入 WDK 内核类型）、[[re-windbg]]（双机 / KDNET 内核调试）、Microsoft 公共符号；测试签名仅在调试 VM 内开启（`bcdedit /set testsigning on`，需关 Secure Boot）
- **Linux**：`readelf`/`objdump -r`（ET_REL 与 relocation）、`modinfo`（vermagic/依赖/签名/livepatch）、`pahole`/`bpftool`（BTF）、`bpftrace`/`perf probe`（kprobe）、`ftrace`
- **macOS**：`otool`/`vmmap`/`ioreg`/`kmutil`/`codesign -d --entitlements`/`lldb`（[[re-lldb]]、[[re-format-macho]]）
- **Android**：`modinfo`/`readelf` + 目标分支的 KMI symbol list 与 `Module.symvers` 比对

## 跨域联合

- [[re-windbg]] / [[re-lldb]] / [[re-gdb]]：各平台内核调试与运行时验证
- [[re-binary-core]]：静态初勘底座（PE/ELF/Mach-O 解析、导入导出）
- [[re-malware]]：rootkit / 驱动型恶意样本的深度分析环节引用本技能
- [[re-anti-analysis]]：驱动加壳与混淆对抗
- [[re-sandbox]]：驱动加载与调试环境隔离（VM + 快照，[[re-analyze/platform-tips]] 最高原则）
- [[re-emulation]]：摘出的关键函数可模拟执行验证
- [[re-mem-forensics]]：rootkit 取证对照（cross-view 的离线侧）
- [[re-sample-acquire]]：内核态载荷的现场采集（异常执行区与执行上下文归属）
- [[re-ebpf]]：eBPF 程序（非 `.ko` 形态的内核代码）走那边
- [[re-rtos]] / [[re-uefi]] / [[re-tee]]：嵌入式内核、引导阶段与可信执行的分工
- 反编译工具选型：[[re-ghidra]] / [[re-ida]] / [[re-binaryninja]] 三选一

## 常见坑与陷阱（跨平台共性）

- **只看磁盘版本就下结论**：Linux 的 init-only 段在运行时已消失、macOS 的 AuxKC 可能还在跑旧版本、Android 可能加载的是另一分区的同名模块——**先对齐"磁盘 / 运行 / 加载集合"三份身份**
- **把"看着像坏"的合法形态当损坏**：Linux 的签名尾、livepatch 节、split BTF 都不是损坏（见 [[linux-kernel]] 的四类形态）
- **用同版本假设解释 offset 或符号错误**：RANDSTRUCT、MODVERSIONS、KMI 分支都会让"同版本"实际不同
- **单一视图判定"没有 hook / 没有隐藏模块"**：`lsmod`、syscall table、`/sys/module` 任一为干净都不构成结论——必须 cross-view，且**视图矛盾时优先信离线内存取证**
- **hook 手法只盯着老几样**：现代落点包括 operation 结构、ftrace、kprobes、inline text——"syscall table 没被 hook"不等于内核干净
- **内核态操作没有隔离**：加载/触发内核代码可能直接宕机（Windows 蓝屏）；一切在调试 VM + 快照内做（[[re-sandbox]] 最高原则）
- 各平台特有的坑见对应分支（[[windows-kernel]] / [[linux-kernel]] / [[macos-kernel]] / [[android-kernel]]）
