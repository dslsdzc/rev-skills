---
name: re-riscv
description: >
  RISC-V 架构逆向：RV32/RV64、压缩指令（RVC）、gp 相对寻址、ABI 与 ecall 系统调用约定、工具链指纹。
  触发词：RISC-V、riscv、RV32、RV64、RVC、压缩指令、ecall、ESP32-C3、GD32V。
---

# RISC-V 架构逆向（RV32/RV64、RVC、gp 相对寻址）

## 何时使用 / 何时不用

- 用：RV32/RV64 架构二进制——Linux 用户态程序、裸机固件、RISC-V MCU 固件（ESP32-C3 类 RV32IMC）
- 用：压缩指令（RVC）混编代码流、gp 相对寻址恢复、RISC-V ABI 识别、ecall 系统调用/环境调用边界
- 用：工具链与库函数指纹（glibc/musl/newlib 系、指令扩展特征）
- 不用：ARM / x86 / MIPS 等其他架构（走 [[re-binary-core]] 通用底座，本技能只补 RISC-V 特有语义）
- 不用：工具链极端定制且无头绪时，先走 [[re-fw-emulate]] 仿真兜底（能跑就先看行为，再回静态）
- 不用：只需解包固件看内容（[[re-fw-extract]]）/ 分析文件系统与配置（[[re-fw-rootfs]]）/ 整体启动固件（[[re-fw-emulate]]）

## 工具准备

所有工具先验证再使用。静态分析可免沙箱；qemu 动态执行默认沙箱 + 网络隔离（[[platform-tips]] 最高原则）。

### 反编译器（Ghidra / IDA 任选其一）

- Ghidra（内置 RISC-V 处理器模块，RV32/RV64 + I/M/A/F/D/C 扩展，自动处理 RVC 压缩指令）：
  - Linux: 官方 release 包（需 JDK）；部分发行版仓库有 `apt install ghidra` / `pacman -S ghidra`
  - macOS: `brew install --cask ghidra`；Windows: 官方 zip
  - 验证: `analyzeHeadless -help`（headless 模式）或 GUI 导入 RISC-V ELF
- IDA：商业版含 RISC-V 模块；Freeware 版架构支持范围以官方页面为准
- 导入时确认 RV32/RV64 与端序——标准 RISC-V 小端、大端变体罕见，选错全部错位

### readelf / file —— 架构与字节序确认（binutils）

- Linux: binutils 自带（`apt install binutils` 等）；macOS: `brew install binutils` 或 LLVM 系 readelf；Windows: WSL 内
- 验证: `readelf --version`

### binutils 交叉工具链 —— RISC-V 反汇编/符号表（objdump）

- Debian/Ubuntu: `apt install binutils-riscv64-unknown-elf`（提供 `riscv64-unknown-elf-objdump`，裸机；Ubuntu 在 universe）；用户态目标: `apt install gcc-riscv64-linux-gnu`（提供 `riscv64-linux-gnu-objdump`）
- Fedora: `dnf install binutils-riscv64-linux-gnu gcc-riscv64-linux-gnu`（cross-binutils / cross-gcc 源包，提供 `riscv64-linux-gnu-objdump`；官方仓库无 riscv64-unknown-elf 裸机工具链，裸机反汇编用 riscv64-linux-gnu-objdump，RVC 支持一致）
- Arch: `pacman -S riscv64-elf-binutils riscv64-elf-gcc`（裸机，提供 `riscv64-unknown-elf-objdump`）或 `pacman -S riscv64-linux-gnu-binutils riscv64-linux-gnu-gcc`（用户态）
- macOS: `brew install riscv64-elf-binutils riscv64-elf-gcc`（homebrew-core，提供 `riscv64-unknown-elf-objdump`）；Windows/WSL: WSL 内 Linux 版
- 验证: `riscv64-unknown-elf-objdump --version`（Debian/Ubuntu/Arch/brew）、`riscv64-linux-gnu-objdump --version`（Fedora）；objdump 对 RVC 混编流自动识别（2/4 字节）

### qemu-riscv64 / qemu-riscv32 —— RISC-V 用户态仿真（动态验证）

- Linux: `apt install qemu-user` / `dnf install qemu-user` / `pacman -S qemu-user`
- macOS: `brew install qemu`（含用户态）；Windows/WSL: WSL 内 Linux 版
- 64 位为 `qemu-riscv64`、32 位为 `qemu-riscv32`；`-L <rootfs>` 指定动态库/链接器来源，`-strace` 跟踪系统调用
- 验证: `qemu-riscv64 --version`、`qemu-riscv32 --version`
- 裸机 RISC-V（无 OS）qemu-user 不适用——用 `qemu-system-riscv64/32`（Debian trixie 起 / Ubuntu 25.10 起独立包 `apt install qemu-system-riscv`，Ubuntu 24.04 及更早、Debian bookworm 在 `qemu-system-misc` 内；Fedora / Arch `dnf install qemu-system-riscv` / `pacman -S qemu-system-riscv`）`-machine virt` 或板级模型（`-s -S` 接 gdb），或 [[re-emulation]] 用 Unicorn 逐指令

### gdb-multiarch —— 交叉调试

- Linux: Debian/Ubuntu `apt install gdb-multiarch`（riscv32/riscv64 目标内置）；Fedora `dnf install gdb`（官方 gdb 支持多目标）；Arch `pacman -S gdb`（内置 multiarch）
- macOS: `brew install gdb`（需 Developer Tools 授权，见 [[platform-tips]] macOS 分支）或 WSL 内 Linux 版；Windows/WSL: WSL 内 Linux 版
- 验证: Debian/Ubuntu `gdb-multiarch --version`；Fedora/Arch `gdb --version`；载入固件后 `set architecture riscv:rv64`（或 riscv:rv32）再 `info registers` 确认

## 操作步骤

按顺序执行，每步结果存档；动态执行默认沙箱。

1. **架构确认（RV32/RV64 + 字节序）**：
   ```sh
   file target.bin                 # "RISC-V" + 32-bit/64-bit + little-endian 提示
   file target.elf
   readelf -h target.elf           # Machine=RISC-V (243)；Data=little-endian；Flags 含 RVC/浮点 ABI 位
   readelf -A target.elf | head    # Tag_RISCV_arch 属性，如 rv64imafdc
   ```
   - e_flags（readelf -h 的 Flags 字段）：`EF_RISCV_RVC`(0x1)=含压缩指令；浮点 ABI 位掩码 0x6（0=软浮点、2=单精度 F、4=双精度 D、6=四精度 Q）；`EF_RISCV_RVE`(0x8)=RV32E 精简寄存器
   - 标准 RISC-V 为小端；大端变体罕见，以 file/readelf 实际输出为准
   - 裸机 .bin（无 ELF 头）由步骤 2 的复位向量上下文与指令形态判定（RV32 定宽 4 字节 vs RVC 混编 2/4 字节）

2. **入口定位（reset / 启动代码）**：
   - **Linux 用户态**：入口即 ELF e_entry（`readelf -h` 的 Entry point）= `_start`；动态链接程序先经 ld.so（PT_INTERP），断点/分析从 _start 起
   - **裸机**：RISC-V 无固定向量表（对比 ARM Cortex-M），入口 = SoC datasheet 的 reset 向量（QEMU virt 机器 0x80000000、部分 MCU flash 基址 0x08000000 类）；异常/中断向量基址在 mtvec（M 态）/ stvec（S 态）CSR，trap 处理代码按 CSR 值定位
   - 启动流程一般为：设栈（`la sp, ...`）→ 拷贝 .data / 清零 .bss → 跳 main（裸机）或 __libc_start_main（Linux）
   - 定位入口后在反编译器中标注，沿调用链展开主逻辑

3. **RVC 压缩指令识别（2/4 字节混合，勿固定宽度切割）**：
   - RVC 让代码 2 字节对齐（半字），地址全为偶数；32 位指令可落在 2 mod 4 的奇半字位置——不能按固定 4 字节步长切割
   - 起点错 → 整条指令流错位成乱码；正确做法：用支持 RVC 的反汇编器（Ghidra / riscv64-*-objdump 自动识别），从入口/跳转目标对齐，出现合法压缩指令（c.addi/c.li/c.j/c.lw 等）即对齐正确
   - 识别信号：e_flags RVC 位（0x1）、objdump 输出含 2 字节指令、-Os 编译的裸机固件
   - 同一函数内 16/32 位指令交错是常态，无固定步长

4. **gp 相对寻址恢复（lui+addi 对、.sdata/.sbss）**：
   - gp（x3）= `__global_pointer$`，一般落在 .sdata 段内，12 位有符号偏移（±2048）覆盖 .sdata/.sbss 小数据区
   - 访问形态：启动时 `lui gp, %hi(...)` + `addi gp, gp, %lo(...)` 一次设置 → 后续 `lw/ld aN, off(gp)` 小偏移数据访问（-msmall-data-limit 默认 8 字节以内的全局变量走 gp）
   - 符号剥离后：从 _start/crt0 序言的 lui+addi 序列计算 gp 实际值 → 反编译器中标注 → 数据引用恢复；有 ELF 时 `readelf -s` 查 `__global_pointer$` 符号值
   - gp 缺失时这些访问解析为「未知全局」、数据流散乱——先定 gp 再分析（见坑 2）

5. **ABI 识别（整数/浮点 ABI、a0-a7 约定）**：
   - 整数约定：参数 a0-a7（x10-x17，第 9 个起栈传）、返回值 a0、被调用者保存 s0-s11（x8-x9、x18-x27）；ra=x1、sp=x2、gp=x3、tp=x4、fp=s0(x8)；调用边界 sp 16 字节对齐
   - ABI 名：RV32 为 ilp32/ilp32f/ilp32d，RV64 为 lp64/lp64f/lp64d——f/d 后缀表示浮点参数走浮点寄存器（F/D 扩展）
   - 浮点约定：参数 fa0-fa7（f10-f17）、返回值 fa0、被调用者保存 fs0-fs11（f8-f9、f18-f27）；硬浮点 ABI 浮点参数进 fa0-fa7，软浮点进 a0-a7
   - 判定：`readelf -h` Flags 浮点 ABI 位 + 反汇编浮点指令密度（flw/fadd/fmv 等）佐证；混编软/硬浮点编译单元时按单元确认（同 ARM 场景）

6. **系统调用边界（ecall + a7 号）**：
   - **Linux 用户态**：`ecall` 触发系统调用，号在 a7（x17）、参数 a0-a5、返回 a0；RISC-V 用 asm-generic 编号（read=63、write=64、openat=56、exit=93、mmap=222）——与 x86/ARM 编号不同，别拿其他架构的号套
   - 定位：objdump 搜 `ecall`（0x73），往回找 `li a7, imm` 立即数；Ghidra 反编译中识别系统调用点
   - **裸机（无 OS）**：ecall 是自定义语义——M 态固件/SBI 调用（a7=扩展号、a6=功能号）或厂商 monitor，不能按 Linux 号解读；按运行环境查 SBI/厂商 SDK 文档对照
   - 行为验证：`qemu-riscv64 -strace` 直接打印系统调用序列（联动 [[re-tracing]]）

7. **生态指纹（工具链/库函数特征）**：
   - 用户态：glibc（动态、PT_INTERP、__libc_start_main）/ musl（静态常见、入口小）/ 目标板发行版特征（busybox 等）
   - 裸机：newlib/picolibc（crt0：_start → __libc_init_array → main）；厂商 SDK 启动链（ROM → bootloader → app）与分区表结构
   - 指令扩展：向量指令（RVV，v0-v31 寄存器组）提示较新工具链；压缩指令密度高多为 -Os 编译
   - 特征串定位库函数版本（思路同 [[re-imports]]），交叉库指纹辅助还原

## 跨域联合

- [[re-binary-core]]：RISC-V ELF 通用初勘/反编译/调试底座（[[re-ghidra]]、[[re-ida]]、[[re-gdb]]、[[re-radare2]] 照常使用）
- [[re-firmware]]：固件类样本网关路径（re-firmware → re-fw-extract → re-fw-rootfs → 本技能）
- [[re-fw-extract]] / [[re-fw-rootfs]]：固件解包与文件系统/配置分析前置
- [[re-fw-emulate]]：整体启动固件或用户态运行 RISC-V 程序（qemu 系列）
- [[re-emulation]]：无 qemu 场景用 Unicorn/Qiling 模拟执行（裸机逐指令验证）
- [[re-rtos]]：MCU 固件内 RTOS 任务表/TCB 定位后按任务拆解反编译
- [[re-hardware-io]]：JTAG/SWD 真机调试与 flash 读取（OpenOCD + gdb）
- [[re-cpp-abi]]：RISC-V 上 C++ 产物 RTTI/异常/虚表恢复
- [[re-variant]]：固件多版本对比与补丁 diff
- [[re-tracing]]：qemu -strace / strace 系统调用跟踪验证 ecall 边界
- [[re-sandbox]]：一切动态执行强制前置（[[platform-tips]] 默认沙箱原则）
- 配套：[[re-patching]]（RVC 感知的字节补丁）、[[re-triage]]（初勘/架构识别前置）

## 常见坑与陷阱

- **压缩指令流按 4 字节切割全错**：现象——按固定 4 字节步长反汇编，指令全乱、引用全错位；原因——RVC 混编流 2/4 字节混合、2 字节对齐，固定宽度切割会从指令中间起拆；对策——用支持 RVC 的反汇编器（Ghidra/objdump 自动识别），从入口/跳转目标对齐起点，出现合法压缩指令（c.addi/c.j/c.lw）即对齐正确；补丁时指令长度可能 2↔4 字节变化
- **gp 全局指针缺失致数据访问散乱**：现象——大量 `lw/ld off(gp)` 数据访问解不出地址，全局变量互不关联、逻辑碎片化；原因——符号剥离后 `__global_pointer$` 丢失，或反编译器未推导 gp；对策——从 _start/crt0 的 `lui gp`+`addi gp` 序列计算实际 gp 值并在反编译器中标注；有 ELF 时 `readelf -s` 查 `__global_pointer$`
- **la/li 伪指令展开形态多变**：现象——同一逻辑不同函数里指令序列不同（单条 addi / lui+addi / auipc+addi），被误判为不同逻辑；原因——汇编器按立即数大小与重定位类型选展开形态，链接器 relax 后还可能缩短成单条；对策——以机器码语义为准（目标地址一致即同一引用），跨工具对照，关键逻辑回指令级核实
- **ecall 系统调用号绑定运行环境、无 OS 时为自定义语义**：现象——裸机固件里 ecall 被当 Linux 系统调用解读，语义全错；原因——ecall 只是「环境调用」指令，号语义由运行环境定义（Linux：a7=系统调用号；裸机：SBI 扩展/厂商 monitor）；对策——先确认运行环境（有无 OS、动态库、_start 形态），无 OS 时查 SBI 扩展号或厂商 SDK 文档对照 a7/a6
- **链接器 relax（R_RISCV_RELAX）影响反汇编边界**：现象——反汇编 .o 中间产物与最终二进制指令流对不上，或按未 relax 的布局找地址错位；原因——链接器 relax 把 auipc+addi 收缩为 addi、jal 缩短为 c.j 等，R_RISCV_RELAX 标记的序列尺寸在链接后变小；对策——分析最终链接产物（不是 .o），地址引用以最终二进制为准；改动字节前先确认是否受 relax 影响（重新链接或比对反汇编）
