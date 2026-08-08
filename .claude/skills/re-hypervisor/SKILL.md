---
name: re-hypervisor
description: >
  虚拟化逆向：VT-x/SVM、hypervisor 检测、VMCS/EPT 分析。
  触发词：hypervisor、VT-x、SVM、虚拟化检测、EPT
---

# 虚拟化逆向（VT-x / SVM / hypervisor 检测）

## 何时使用 / 何时不用

- 用：目标是 hypervisor / VMM 二进制或驱动（恶意 hypervisor、rootkit 虚拟化、VM-based 保护）
- 用：样本/程序检测自己是否运行在虚拟机或嵌套虚拟化中（CPUID 指纹、时序检测）
- 用：分析 VT-x（VMX）或 SVM 相关的启动代码、VMCS/VMCB 布局、EPT 相关操作
- 不用：普通 Windows 驱动/rootkit（走 [[re-kernel]]）；只要识别"我在不在 VM 里"（快速判断走 [[re-triage]] 思路或 `virt-what`）
- 不用：无 CPU 虚拟化支持 / 无嵌套虚拟化环境时的动态验证（静态分析先行，见坑 1）
- 注意：动态实验（QEMU/KVM 嵌套）按 [[platform-tips]] 最高原则在沙箱内进行；hypervisor 样本具有高特权，只在与宿主隔离的实验环境运行

## 工具准备

静态分析（CPUID 检查 / 反编译）免沙箱；QEMU/KVM 动态实验属动态执行，默认沙箱 + 快照（[[platform-tips]] 最高原则）。

### CPUID 检查工具（hypervisor 识别）

- Linux 内置：`grep -E 'vmx|svm' /proc/cpuinfo`——VT-x/SVM 支持标志（零安装，先用它）
- `cpuid` 工具（dump 各 CPUID 叶子的完整输出）：
  - Debian/Ubuntu: `apt install cpuid`；Fedora: `dnf install cpuid`
  - Arch 无独立 cpuid 包 → 用 `kcpuid`（`pacman -S kcpuid`，linux-tools 组）或 libcpuid 附带的 `cpuid_tool`（`pacman -S libcpuid`）
  - 验证: `cpuid -1` 输出含各叶子详情；`cpuid -1 -l 0x40000000`（hypervisor 厂商字符串叶子）
- Windows 侧：WinDbg 内核调试下 `!cpuid`（[[re-windbg]] 扩展命令）

### QEMU / KVM —— 嵌套虚拟化实验环境

- Debian/Ubuntu: `apt install qemu-system-x86 qemu-kvm`（Ubuntu 另加 `libvirt-daemon-system`）
- Fedora: `dnf install qemu-system-x86-core libvirt virt-install`（或 `dnf group install virtualization`）
- Arch: `pacman -S qemu-system-x86 libvirt virt-manager`（启用 `systemctl enable --now libvirtd`）
- macOS: `brew install qemu`（无 KVM，用 HVF）
- 验证: `qemu-system-x86_64 --version`；`ls /dev/kvm`（KVM 加速可用）；`kvm-ok`（Debian/Ubuntu 的 cpu-checker 包）

### 反编译工作台（[[re-ghidra]] / [[re-ida]]）

- [[re-ghidra]]（默认）/ [[re-ida]]：导入 hypervisor 二进制（内核模块 / 裸二进制）
- 验证: 导入后能反编译出 VMXON / VMPTRLD / VMREAD / VMWRITE 调用点

### Intel SDM / AMD APM（VMCS 字段编码参考，无安装）

- Intel SDM Volume 3C 附录 B（VMCS field encoding 表）；AMD APM Volume 2（VMCB 布局）
- 用途: VMREAD/VMWRITE 操作数解码、exit reason 编号对照（无独立包，官方文档）

## 操作步骤

按顺序执行，每步产物（CPUID 输出、VMCS 字段表、QEMU 配置）记录证据路径 + sha256（见 [[re-triage]]），供报告引用。

1. **hypervisor 识别（CPUID 叶子 / VMX 标志）**：
   ```sh
   grep -E 'vmx|svm' /proc/cpuinfo | head -1        # 宿主 CPU 虚拟化支持
   cpuid -1 -l 0x1 | grep -i -A1 'hypervisor'        # CPUID.1:ECX[31] hypervisor present bit
   cpuid -1 -l 0x40000000                            # 0x40000000 叶子的 hypervisor 厂商字符串
   #   "KVMKVMKVM" = KVM、"Microsoft Hv" = Hyper-V、"VMwareVMware" = VMware、"XenVMMXenVMM" = Xen
   ```
   - 检测要点：hypervisor present bit（CPUID.1:ECX[31]）→ 有 hypervisor；`0x40000000` 返回厂商字符串（`[!xchg]` 汇编技巧：先在 `0x40000000` 之前执行 `mov eax, 0x40000000; cpuid`，ECX 返回字串长度）
   - 恶意样本常在启动早期做此检测决定后续行为（[[re-evasion]] 联动，见坑 5）
   - 记录：宿主支持情况（vmx/svm）、是否已在 VM 内（含嵌套，坑 4）

2. **VMCS 结构分析（VT-x）**：
   - 启动路径：`VMXON`（进入 VMX 操作模式）→ `VMPTRLD`（加载当前 VMCS）→ 配置 VMCS 字段 → `VMLAUNCH`/`VMRESUME`（进 guest）→ VM exit 后查 `VM_EXIT_REASON` 字段分派
   - 反编译定位：搜 `VMXON`/`VMPTRLD`/`VMWRITE`/`VMREAD`/`VMLAUNCH` 指令（Ghidra 反汇编直接可读）；VMCS 区域是内存块，先找 VMCS 缓冲区分配与初始化代码
   - **VMREAD/VMWRITE 的操作数是 VMCS 字段编码**（16 位：bit15=访问类型、bit12-9 宽度、bit8-0 字段编号）——按 Intel SDM 附录 B 把每个魔数解码成字段名（如 0x6C10 = VMCS 的 GUEST_RSP？——以 SDM 表为准逐个核对），在 Ghidra/IDA 里建枚举/结构标注
   - 关注三块：guest-state（保存 guest 寄存器/CR3/RSP）、host-state（VM exit 后宿主现场）、control 字段（execution control 决定哪些事件触发 VM exit）
   - SVM 对应：VMCB（物理地址经 `VM_HSAVE_PA` MSR），字段是固定偏移——按 AMD APM 布局标注
   - 产物：VMCS 字段标注表（编码 → 字段名 → 作用）+ 初始化/exit 处理流程

3. **虚拟化技术检测对抗（EPT 隐藏内存）**：
   - EPT（Extended Page Tables）：guest 物理地址 → 宿主物理地址的第二层页表（VMM 控制）；恶意 hypervisor 可用 EPT 把同一 guest 页映射到不同宿主页、或在 EPT 层面修改页内容而 guest 页表看起来不变
   - 分析思路：反编译里找 EPT 相关操作——`INVEPT`/`INVVPID`（TLB 失效）使用点、EPT 指针字段（VMCS `EPTP`）赋值、EPT 页表构建函数（从 EPT 指针沿页表结构走）
   - 检测对抗的观察法：guest 内看到的内存内容与宿主侧直接读同一物理页不一致 → EPT 重映射证据（两个视图对照）；[[re-kernel]] 内核调试配合在宿主与 guest 两侧各 dump 同一页
   - 产物：EPT 构建/切换代码路径 + 内存视图差异证据

4. **嵌套虚拟化（VMM 内调试）**：
   ```sh
   # KVM 开启嵌套（宿主）
   echo 1 | sudo tee /sys/module/kvm_intel/parameters/nested    # Intel（AMD 为 kvm_amd）
   # QEMU 启动带 VT-x 透传的嵌套 VM（`-cpu host` 暴露 vmx 标志）
   qemu-system-x86_64 -enable-kvm -cpu host,+vmx -m 4096 disk.img &
   # 嵌套 VM 内再验证: grep vmx /proc/cpuinfo 可见 → 可在此跑 hypervisor 样本
   ```
   - 用法：宿主上的调试器（gdb/lldb 或 [[re-windbg]] 内核调试）直接观察嵌套 VM 内 hypervisor 的执行——样本以为自己在最底层，实际仍在宿主调试视野内
   - VMware/Hyper-V 同理（虚拟机设置里开"虚拟化引擎/嵌套虚拟化"）
   - 产物：嵌套配置存档 + 调试会话记录

5. **反虚拟化绕过（[[re-evasion]] 联动）**：
   - 识别检测手段：CPUID 厂商字符串（步骤 1）、时序（RDTSC 指令耗时）、设备名（VM 虚拟设备）、固件/ACPI 特征
   - 按 [[re-evasion]] 的"规避识别→绕过点定位"框架：hook CPUID（frida `Interceptor.attach(Module.findExportByName(null,'cpuid'))` 改返回值 / 内核 hook）、QEMU `-cpu` 参数伪造厂商字符串、设备名改名
   - 恶意样本"检测到 VM 就改变行为"（不执行恶意逻辑）也是常见对抗——记录检测点与分支
   - 产物：检测点清单 + 绕过方案（授权研究场景）

## 跨域联合

- [[re-evasion]]：反虚拟化检测/绕过框架（CPUID hook、时序对抗）；恶意样本 VM 检测行为分析
- [[re-kernel]]：hypervisor 驱动/内核模块分析底座（DriverEntry、IRP、内核调试配合）
- [[re-windbg]]：Windows 宿主/guest 内核调试（`!cpuid` 查 CPUID 叶子、驱动加载观察）
- [[re-ghidra]] / [[re-ida]]：VMCS/VMCB 相关代码反编译与结构标注（SDM 附录 B 建枚举）
- [[re-sandbox]] / [[platform-tips]]：QEMU/KVM 实验环境隔离最高原则；嵌套 VM 是默认沙箱形态
- [[re-triage]]：初勘阶段"是否在 VM 内 / CPU 虚拟化能力"快速判断（`virt-what` 思路）

## 常见坑与陷阱

- **硬件虚拟化调试环境复杂**：现象——hypervisor 样本在普通 VM 里跑不起来/直接崩溃，调试器附加失败，样本检测到嵌套环境后行为异常；原因——嵌套虚拟化需要宿主 CPU 支持 + 显式开启（KVM nested / Hyper-V / VMware 选项），且样本会检测自己是否"真的在底层"；对策——先纯静态积累信息（步骤 1-2 的 CPUID 与 VMCS 分析不需要跑样本），动态前确认三层能力：宿主 vmx/svm 标志（`grep vmx /proc/cpuinfo`）→ 嵌套开关（`/sys/module/kvm_intel/parameters/nested`）→ QEMU `-cpu host` 透传；实验全部在隔离沙箱（[[platform-tips]] 最高原则）
- **VMCS 内核对象逆向门槛高**：现象——反编译里 VMREAD/VMWRITE 一堆魔数，不知道读写的是什么字段，VM exit 分派逻辑看不懂；原因——VMCS 是硬件定义格式（字段编码不是符号），且各 CPU 架构（VT-x vs SVM）布局完全不同；对策——把 Intel SDM 附录 B 的字段编码表建进反编译器（Ghidra 枚举/结构），VMREAD/VMWRITE 操作数逐一解码；按 guest-state / host-state / control 三块组织分析；AMD 目标改用 VMCB 固定偏移布局（APM Volume 2）
- **EPT 使内存断点失效**：现象——调试器在 guest 里下的内存断点/页保护断点不触发或触发后行为诡异（寄存器对不上）；原因——EPT 的访问位/脏位独立于 guest 页表，VMM 通过 EPT 控制 guest 看到的内存视图（含隐藏页），普通调试器断点基于 guest 页表视角；对策——区分 EPT violation（VM exit reason 48）与 guest page fault（reason 14）；要观察 EPT 层必须看 EPT 页表结构本身（沿 VMCS EPTP 字段展开）而不是 guest 页表；[[re-kernel]] 内核调试下对照宿主/guest 两侧内存视图
- **CPU 特性差异（VT-x vs SVM）**：现象——在 Intel 机器上整理的 VMCS 偏移/exit reason 编号拿到 AMD 机器全对不上，或相反；原因——VT-x 与 SVM 是两套独立实现：VMCS（VMREAD/VMWRITE 编码）vs VMCB（固定偏移），exit reason 编号体系不同；对策——先确认目标平台（CPUID vendor + vmx/svm 标志，步骤 1），按平台选对应手册（Intel SDM Vol 3C / AMD APM Vol 2），分析笔记标注目标平台与 CPU 型号，不跨平台复用字段表
- **样本检测 VM 后改变行为（影响结论）**：现象——静态分析很清晰的恶意逻辑，动态运行时完全看不到（样本"正常"运行）；原因——样本检测到自己在 VM/调试环境里会走"无害分支"（反沙箱/反调试常见手法）；对策——按步骤 1 先确定样本视角的虚拟化状态，动态验证必须与样本检测条件一致（或逐项绕过检测）；结论以"检测点还原 + 绕过后的行为"为准，单跑一遍就下结论不可信
