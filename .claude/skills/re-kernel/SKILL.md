---
name: re-kernel
description: >
  内核逆向（跨平台）：Windows 驱动（.sys/IRP/SSDT）、Linux 内核模块（.ko/ET_REL/LKM/rootkit）、
  macOS KEXT 与 System Extension/DriverKit、Android GKI/vendor module、seL4（capability 系统）。
  触发词：内核、驱动、.sys、.ko、LKM、kext、dext、rootkit、内核模块、IRP、GKI、内核扩展、
  seL4、capability、CSpace、CNode、capDL、CAmkES、MCS。
  English triggers: kernel module, driver reversing, LKM, kext, rootkit, GKI, seL4, capability system, capDL.
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
| Windows | `.sys`（PE；DRIVER_OBJECT / IRP） | SCM 注册 + 驱动签名（测试签名 / 生产签名） | PDB、WDK / `ntddk.h` 类型 | WinDbg 内核调试、`!drvobj`/`!process`、Volatility |
| Linux | `.ko`（**ET_REL** 可重定位目标） | `insmod`/modprobe + vermagic / symbol CRC / 签名尾 | BTF（含 split BTF 与 `.BTF.base`）、vmlinux、源码 | `/proc/kallsyms`、`/sys/module/*/sections/`、kprobe/ftrace、内存 cross-view |
| macOS | **两代**：KEXT（Mach-O kext）与 DEXT（**用户态**） | AuxKC（启动时加载）/ System Extension 激活审批 | 符号、Mach-O、`Info.plist` | IORegistry、`kmutil`、lldb；dext 走用户态分析 |
| Android | GKI module / vendor module | GKI 签名 + **KMI 符号白名单** | BTF、KMI symbol list、`Module.symvers` | 模块所在分区、`modules.load` 计划 |
| seL4（微内核） | **capability 系统**：对象（TCB/Endpoint/CNode/Frame/Untyped/SC）+ cap 分布 | **无 capability 即无访问权**；对象在构造期由 spec/loader 创建 | capDL spec（`.cdl`）、CAmkES ADL、ELF | capDL snapshot（`seL4_DebugSnapshot`）、`seL4_DebugCapIdentify`、QEMU 仿真 |

## 失败模式决策表（本技能的主入口）

**当反编译结果或运行观察与预期冲突时，按这张表先怀疑、再排除**：

| 症状 | 优先怀疑（按顺序） | 处理方向 |
|---|---|---|
| struct offset 全错 | ① BTF 与目标是否匹配 ② kernel build 是否匹配 ③ **RANDSTRUCT**（`CONFIG_GCC_PLUGIN_RANDSTRUCT`；此类内核带 taint `T`） | 优先级：目标 BTF > exact build debug info > exact seed+config > 动态验证 > 猜 offset（最差） |
| symbol resolution 怪异 | ① **MODVERSIONS**（CRC）② **Android KMI** ③ **livepatch**（`.klp.rela`/`.klp.sym`）④ split BTF | 各按对应分支核对，别当"文件损坏" |
| 文件与运行行为不一致 | ① Linux 运行时 relocation / init-only 段已消失 ② **macOS AuxKC 仍在跑旧版本** ③ Android 实际加载的是另一分区的同名模块 | 记录"磁盘版本 / 运行版本 / boot 时间"，别只看磁盘 |
| 模块"消失" | ① built-in（本就没有模块文件）② **rootkit 摘链**（module list unlink）③ macOS Kernel Collection ④ Android 另一分区或另一 boot stage | cross-view 交叉比对，别用单一视图下结论 |
| driver IPC 调不通 | ① selector/ABI ② **entitlement** ③ sandbox ④ Team ID（macOS）⑤ service 根本没 activate | 从"能不能连"排到"连上之后怎么调"，而不是直接猜 selector |
| 看见异常 ELF section | ① 签名尾（附加在 ELF 末尾）② livepatch `.klp.rela` ③ BTF/`.BTF.base` ④ ORC unwind ⑤ 架构/工具链元数据 | 先分类再处理；**不要为了"修好"去 truncate/strip** |
| 相同 CPtr 数值被当作同一对象 | **CPtr 是各 CSpace 的本地地址**，不是全局 ID（seL4） | 先恢复各自 CSpace 映射，按 **kernel object** 对齐 |
| 线程/服务"卡住"或像"配置损坏" | ① MCS：SC 未绑定 / budget 耗尽 / passive server 本就没有 SC ② fault handler 没修复 fault | 按 MCS 语义排查（SC / budget / 捐赠链），**别套 POSIX 死锁** |
| IRQ 只来一次 | 没有 Ack（seL4：未 ack 内核不再送后续中断） | 查 IRQ 处理循环里的 `seL4_IRQHandler_Ack` |

## 通用主线

1. **确认身份**：这是哪一份（磁盘 / 运行 / 加载集合中的版本）、什么构建（vermagic / CRC / KMI / 签名）、什么形态（PE / ET_REL / Mach-O / 用户态 dext）
2. **类型与符号**：优先官方类型来源（PDB / BTF / 符号表 / KMI list），其次精确构建信息，最后才是推断
3. **功能骨架**：从 imports/exports 与内核 API 调用关系切分功能——闭源或 stripped 时这一步尤其有效
4. **hook 与隐藏**：枚举 hook 落点（表项 / inline text / 回调数组 / operation 结构）+ **cross-view 交叉**（用户态视图 vs 内核真实对象与内存）
5. **验证与收尾**：运行时核对（调试器 / kprobe / IORegistry / 内存侧），结论与证据按 [[re-analyze/analysis-contract]] 入档

## 平台分支（references）

- [[windows-kernel]] —— DriverEntry / IRP 分发表 / 设备对象、SCM 加载链、SSDT 与 inline hook、minifilter、WinDbg 验证、Volatility 对照
- [[linux-kernel]] —— `.ko`（ET_REL）分析路径、四类"看着像坏"的合法形态（签名尾 / BTF 与 split BTF / RANDSTRUCT / livepatch）、5.7 起的符号解析变化、rootkit cross-view
- [[macos-kernel]] —— KEXT（`Info.plist` 先行、selector map、AuxKC 版本坑、codeless kext、arm64e PAC）与 System Extension / DriverKit（用户态模型、激活与 entitlement 排错）
- [[android-kernel]] —— GKI vs vendor module、protected symbol 与 KMI 白名单、KMI 分支不可互换、模块位置与加载计划
- [[sel4-kernel]] —— **capability 系统**：CPtr 是本地地址不是全局 ID、capDL/CAmkES 语义、badge 与 rights、CSpace guard/depth、错误码即诊断、Untyped 与 device untyped、用户态驱动的 IRQ 与 DMA 旁路、fault IPC、MCS（SC/budget/passive server/reply object）、capDL snapshot cross-view

## 何时使用 / 何时不用

- 用：各平台内核态载荷与驱动（恶意驱动 / rootkit / 反作弊 / EDR 对抗 / 闭源驱动）的静态逆向与运行时验证
- 用：**capability 系统**（seL4 等微内核）的对象图 / capability 分布 / IPC 拓扑恢复，以及"行为为何与普通 OS 不同"的判定
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
