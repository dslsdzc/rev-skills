---
name: re-arm
description: >
  ARM 架构逆向（非 Android）：Cortex-M/A 向量表、Thumb/ARM 切换、AAPCS 调用约定、位置相关代码重定位、MMIO 外设寄存器交叉。
  触发词：ARM、arm32、Cortex-M、Cortex-A、Thumb、AAPCS、嵌入式逆向、裸机固件、stm32、向量表。
---

# ARM 架构逆向（Cortex-M/A、Thumb、AAPCS）

## 何时使用 / 何时不用

- 用：非 Android 场景的 ARM——嵌入式裸机/固件（Cortex-M0/M3/M4/M7、Cortex-A）
- 用：Thumb/ARM 指令集切换、AAPCS 调用约定识别、M 系向量表入口定位、位置相关代码重定位
- 用：MMIO 外设寄存器交叉分析（0x4000xxxx 外设区、LDR 立即数池）
- 不用：Android `.so`（走 [[re-android-native]]）
- 不用：通用 AArch64 Linux 用户态程序（走 [[re-binary-core]] 通用底座，本技能只补 ARM 特有语义）
- 不用：只需解包固件看内容（[[re-fw-extract]]）/ 分析文件系统配置（[[re-fw-rootfs]]）/ 整体启动固件（[[re-fw-emulate]]）
- 不用：RISC-V / x86 等其他架构（走 [[re-binary-core]]）

## 工具准备

所有工具先验证再使用。静态分析可免沙箱；qemu 动态执行默认沙箱 + 网络隔离（[[platform-tips]] 最高原则）。

### 反编译器（Ghidra / IDA 任选其一）

- Ghidra（内置 ARM 处理器模块，Cortex-M0/M0+ 选 v6M、Cortex-M3/M4/M7 选 v7 或 v8M、Cortex-A 选 v7，均为小端 LE）：
  - Linux: 官方 release 包（需 JDK）；部分发行版仓库有 `apt install ghidra` / `pacman -S ghidra`
  - macOS: `brew install --cask ghidra`；Windows: 官方 zip
  - 验证: `analyzeHeadless -help`（headless 模式）或 GUI 导入 ARM ELF
  - Ghidra 按 Thumb 函数位 0（TMode）自动切换 Thumb/ARM 反汇编；导入时核对处理器变体与端序
- IDA：商业版含 ARM32/ARM64 + Thumb 模块；Freeware 版架构支持范围以官方页面为准
- 导入时确认架构（ARM vs AArch64）与变体——Cortex-M0/M0+（ARMv6-M）只有 16 位 Thumb 指令集，选错变体会反汇编出 32 位 Thumb-2 幻觉指令

### readelf / file —— 架构与字节序确认（binutils）

- Linux: binutils 自带（`apt install binutils` 等）；macOS: `brew install binutils` 或 LLVM 系 readelf；Windows: WSL 内
- 验证: `readelf --version`

### binwalk —— 固件与内嵌文件扫描

- 同 [[re-fw-extract]] 工具准备：`pip install binwalk`（推荐）或发行版包；unblob: `pip install unblob`
- 验证: `binwalk --version`、`unblob --version`

### qemu-arm / qemu-aarch64 —— ARM 用户态仿真（动态验证）

- Linux: `apt install qemu-user` / `dnf install qemu-user` / `pacman -S qemu-user`
- macOS: `brew install qemu`（含用户态）；Windows/WSL: WSL 内 Linux 版
- 32 位为 `qemu-arm`、64 位为 `qemu-aarch64`；`-L <rootfs>` 指定动态库/链接器来源，`-strace` 跟踪系统调用
- 验证: `qemu-arm --version`、`qemu-aarch64 --version`
- 裸机 Cortex-M（无 OS 引导、向量表 0x0 起）qemu-user 不适用——用 `qemu-system-arm -machine mps2-an385`（Cortex-M3）等板级模型（`-s -S` 接 gdb），或 [[re-emulation]] 用 Unicorn 逐指令

### gdb-multiarch —— 交叉调试

- Linux: Debian/Ubuntu `apt install gdb-multiarch`（该包仅 Debian 系官方仓库有）；Fedora `dnf install gdb`（官方 gdb 支持多目标，嵌入式专用可 `dnf install arm-none-eabi-gdb`）；Arch `pacman -S gdb`（官方 gdb 已内置 multiarch）
- macOS: `brew install gdb`（需 Developer Tools 授权，见 [[platform-tips]] macOS 分支）或 WSL 内 Linux 版；Windows/WSL: WSL 内 Linux 版
- 验证: Debian/Ubuntu `gdb-multiarch --version`；Fedora/Arch `gdb --version`（选 arm-none-eabi-gdb 则 `arm-none-eabi-gdb --version`）；载入裸机固件后 `set architecture armv7-m` 再 `file` 加载，`info registers` 确认
- 真机 SWD/JTAG 调试走 OpenOCD + gdb（[[re-hardware-io]]）；仿真目标用 `qemu-system-arm -s -S` 或 `qemu-arm -g <port>`

## 操作步骤

按顺序执行，每步结果存档；动态执行默认沙箱。

1. **架构与字节序确认**：
   ```sh
   file target.bin                 # "ARM"=32 位（含 Thumb）、"AArch64"=64 位；MSB/LSB 端序提示
   file target.elf
   readelf -h target.elf           # Machine=ARM / AArch64；Data=little-endian / big-endian
   readelf -A target.elf | head    # Tag_ABI_VFP_args: 1=硬浮点(HFABI)、0=软浮点；EABI 版本
   ```
   - e_flags 高位直接标识浮点 ABI：`EF_ARM_ABI_FLOAT_HARD`(0x400) 硬浮点 / `EF_ARM_ABI_FLOAT_SOFT`(0x200) 软浮点（对应坑 5）
   - 裸机 .bin（无 ELF 头）由步骤 2 的向量表/复位向量判定架构、端序与 Cortex-M 变体

2. **入口定位**：
   - **Cortex-M 向量表**（默认 0x0 起，4 字节/项，地址 = 异常号×4）：
     - 第 1 项（offset 0x0）：初始 MSP 值——指向 RAM 区（0x20000000 附近），可反向佐证加载基址
     - 第 2 项（offset 0x4）：Reset handler（复位后执行的第一条指令）
     - 其后 NMI（0x8）、HardFault（0xC）……每项地址 LSB 必须为 1（Thumb）；LSB=0 触发 INVSTATE 进 HardFault
     - VTOR（0xE000ED08）可重定位向量表，固件可能把表放 RAM 或其他 flash 地址，先按 0x0 试，不成立再搜 MSP/Reset 组合
   - **Cortex-A 启动代码**：复位向量 0x00000000（或高端向量 0xFFFF0000），异常向量表 8 项（Reset/Undef/SWI/Prefetch Abort/Data Abort/Reserved/IRQ/FIQ）；启动流程一般为 设栈指针 → 拷贝 .data → 清零 .bss → 配置 MMU/时钟 → 跳 main；带引导链的（boot ROM → SPL → u-boot）按链逐级衔接 [[re-fw-rootfs]]
   - 定位复位向量后在反编译器中标注入口，沿调用链展开主逻辑

3. **Thumb 函数边界（Thumb/ARM 切换）**：
   - Thumb 函数地址 LSB=1：ELF 符号（`nm` / `readelf -s` 中 Thumb 函数为奇地址）、BL 目标、向量表项、虚表函数指针项都带 Thumb 位
   - `bx rN` / `blx rN`：按目标寄存器位 0 切换状态（1=Thumb）；`blx` 立即数形式直接切到 ARM 态目标
   - **BL 立即数距离上限**：ARM 态 ±32MB、Thumb-2 态 ±16MB（ARMv6-M 的 16 位 BL 仅 ±4MB）；超限时链接器插入 veneer 跳板（形态如 `ldr pc, =addr`、`movw+movt+bx`），看到片状跳板序列不要当业务逻辑；veneer 也用于 ARM↔Thumb 状态切换
   - 剥离符号的二进制：binutils 靠映射符号 `$a`/`$t`/`$d` 决定反汇编状态，映射符号丢失后会按错误状态反汇编——用 `arm-none-eabi-objdump -d -M force-thumb` 强制 Thumb，或交给 Ghidra 按 TMode 启发式切换
   - 用步骤 6 的立即数池与字符串引用交叉验证函数边界

4. **基址 / 重定位（加载地址 vs 链接地址）**：
   - 固件链接基址与提取物实际加载位置常不一致（例：链接 0x08000000 的 flash 固件被从外部存储地址提取；向量表第 1 项 MSP 指向的 RAM 范围可佐证）
   - 确定链接基址（复位向量推算 / 立即数池内字符串引用 / 跳转表交叉）→ 计算偏移 → Ghidra "Memory Map → Set Image Base" 或 IDA "Edit → Segments → Rebase program" 整体修正 → 修正后字符串、立即数池、跳转表全部对齐
   - 有 ELF 时对比 LMA/VMA（`readelf -l`）：VMA 即链接地址；加载地址看 LMA / p_paddr
   - 先修正再反编译，否则大量引用错位、反编译面目全非

5. **AAPCS 调用约定识别**：
   - **32 位（AAPCS32）**：r0-r3 传前 4 参（多余参数栈传）、返回值 r0、64 位参数占 r0:r1 等偶对；r4-r8/r10-r11 被调用者保存、r9 平台相关；r12(IP) 调用内临时、r13(SP)、r14(LR) 返回地址、r15(PC)；公共接口 8 字节栈对齐
   - 函数序言特征：`push {r4-r11, lr}`，尾部 `pop {..., pc}`（借 LR 同时恢复 PC）；叶子函数（无嵌套调用）常不 push LR，直接 `bx lr`
   - **HFABI（硬浮点）**：浮点参数走 VFP 寄存器 s0-s15 / d0-d7（双精度），结果 s0/d0；软浮点 ABI 浮点参数走 r0-r3；`readelf -A` 的 Tag_ABI_VFP_args 区分（混用时最易错，见坑 5）
   - **64 位（AAPCS64，AArch64）**：x0-x7 传参、x8 间接结果寄存器、x19-x28 被调用者保存、x29 帧指针、x30(LR)、SP 16 字节对齐；序言特征 `stp x29, x30, [sp, #-16]!`
   - ARM 上 C++ 产物（RTTI/虚表/异常）恢复交叉参考 [[re-cpp-abi]]，虚表函数指针项同样带 Thumb 位

6. **外设寄存器交叉（MMIO xref）**：
   - Cortex-M 外设区 0x40000000-0x5FFFFFFF（具体外设基址如 0x4000xxxx、0x48000000 随器件而异），0xE0000000 起为 PPB（NVIC/SCB/SysTick）；核对 SoC datasheet 的 memory map
   - 典型访问形态：`ldr rN, [pc, #imm]` 从函数尾部立即数池取地址 → `str`/`ldr` 访问外设；手工算池地址时注意 Thumb 态 PC=当前+4、ARM 态 +8，且按 4 字节对齐
   - 反编译器中把外设区标注为寄存器区（不是数据段）——防止误判（见坑 3）；按 UART/GPIO/timer 等寄存器语义反推硬件行为，轮询 status/flag 位的循环就是与外设交互的握手/等待逻辑
   - 交叉验证：外设地址常量 + 初始化序列（时钟使能、GPIO 配置）对照厂商参考代码模式

## 跨域联合

- [[re-binary-core]]：ARM ELF 通用初勘/反编译/调试底座（[[re-ghidra]]、[[re-ida]]、[[re-gdb]]、[[re-radare2]] 照常使用）
- [[re-firmware]]：固件类样本网关路径（re-firmware → re-fw-extract → re-fw-rootfs → 本技能）
- [[re-fw-extract]] / [[re-fw-rootfs]]：固件解包与文件系统/配置分析前置
- [[re-fw-emulate]]：整体启动固件或用户态运行 ARM 程序（qemu 系列）
- [[re-rtos]]：MCU 固件内 RTOS（FreeRTOS 等）任务表/TCB 定位后按任务拆解反编译
- [[re-hardware-io]]：JTAG/SWD 真机调试与 flash 读取（OpenOCD + gdb-multiarch）
- [[re-emulation]]：无 qemu 场景用 Unicorn 模拟执行（裸机 Cortex-M 逐指令验证）
- [[re-cpp-abi]]：ARM 上 C++ 产物 RTTI/异常/虚表恢复
- [[re-variant]]：固件多版本对比与补丁 diff
- [[re-sandbox]]：一切动态执行强制前置（[[platform-tips]] 默认沙箱原则）
- 配套：[[re-patching]]（Thumb 字节补丁）、[[re-android-native]]（Android .so 场景）

## 常见坑与陷阱

- **Thumb 奇地址误判（函数起点偏移 1 字节）**：现象——按符号或 BL 目标地址定位函数却从半条指令开始，反汇编全乱；原因——Thumb 函数地址 LSB=1 是模式位不是代码字节，直接当绝对地址用整体错位；对策——进函数/解跳转目标前把地址清位 0（&~1）；手工算地址时以此为准（Ghidra/IDA 已自动处理）
- **BL/BLX 距离上限外的 veneer 混淆**：现象——调用链里出现成片 `movw/movt + bx`、`ldr pc` 跳板，被当成业务逻辑分析；原因——BL 立即数只能覆盖 ARM ±32MB / Thumb-2 ±16MB，超限链接器插 veneer；对策——识别短跳板形态（结尾 bx/ldr pc 且目标为远地址）后跳过，继续跟踪最终目标；跨状态（Thumb↔ARM）调用同样经 veneer
- **M 系外设映射区当数据段**：现象——0x4000xxxx 区域被当"数据"且内容随机，外设读写被当普通内存访问分析不出语义；原因——MMIO 区是寄存器不是存储，读可改状态、写有副作用；对策——反编译器中标注为寄存器区，按 datasheet memory map + 寄存器表逐位还原语义，轮询 status 位识别握手/等待循环
- **R14(LR) 双用途反编译失真**：现象——某些函数"没保存返回地址"却调用了子函数，调用图断裂；原因——LR 是寄存器不是专用返回栈，叶子函数可把它当普通临时寄存器，Cortex-M 异常入口的 LR 还可能是 EXC_RETURN 特殊值；对策——按 `push {..., lr}` 与 `bl` 前后 LR 赋值点重建调用关系；异常入口现场恢复序列（入栈 8 字 r0-r3/r12/LR/PC/xPSR，PC 在 [sp,#0x18]）用于确认异常处理函数
- **HFABI 与软浮点混用时参数解读错误**：现象——函数首参是 float，反编译却从 r0 取，值全不对；原因——同一固件可能混编硬浮点（float 走 s0）与软浮点（走 r0）编译单元，或 ABI 识别错误；对策——`readelf -A` Tag_ABI_VFP_args + e_flags 0x400/0x200 定 ABI，按编译单元确认：s0 传参说明硬浮点，浮点参数进 r0-r3 说明软浮点；vcmp/vcvt 等浮点指令出现频率佐证
- **Cortex-M0 当 M3 反汇编（Thumb-2 幻觉）**：现象——反汇编出现大量 32 位 Thumb-2 指令但样本实为 M0；原因——ARMv6-M（M0/M0+）只有 16 位 Thumb-1 指令集、无 Thumb-2；对策——导入时确认变体（v6M vs v7/v8M），M0 固件中出现的 32 位指令是反汇编器越权补的，不可信
