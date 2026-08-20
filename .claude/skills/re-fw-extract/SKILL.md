---
name: re-fw-extract
description: >
  固件提取与解包：binwalk/unblob、magic 扫描、字节序。
  触发词：固件、binwalk、解包固件、firmware、IoT
---

# 固件提取与解包

## 何时使用 / 何时不用

- 用：拿到固件文件（.bin / .img / 升级包 / IoT 镜像）需要解开看内容
- 用：需要判断固件打包方式、架构与字节序
- 不用：已是文件系统镜像 / rootfs（直接走 [[re-fw-rootfs]]）
- 不用：需要运行固件观察行为（走 [[re-fw-emulate]]）
- 不用：需实物板子硬件提取（走 [[re-hardware-io]]）

## 工具准备

所有工具先验证再使用。解包与 magic 扫描是纯静态分析，可免沙箱（[[platform-tips]] 最高原则）；解出产物要运行时转 [[re-fw-emulate]]。

### binwalk —— 自动解包主力

- Linux: `apt install binwalk`（Debian/Ubuntu 仓库版为 2.x）/ `dnf install binwalk` / `pacman -S binwalk`
- pip（跨平台、版本新、签名库全，推荐）: `pip install binwalk`
- macOS: `brew install binwalk`（或 pip 版）
- Windows/WSL: Windows 本机无官方包，用 WSL 内 Linux/pip 版
- 验证: `binwalk --version`（2.x）或 `binwalk --help`（老版）

### unblob —— 更准的自动解包（推荐主力）

- 跨平台: `pip install unblob`（依赖较多，建议 venv: `python3 -m venv venv && venv/bin/pip install unblob`）
- 各发行版基本无官方包，用 pip
- 验证: `unblob --version`

### dd —— 按偏移切分

- Linux/macOS: coreutils 自带（macOS 自带 /usr/bin/dd）
- Windows/WSL: WSL 内 Linux 版；Windows 本机用 Git Bash 自带 dd 或 WSL
- 验证: `dd --version`

### hexdump —— 十六进制查看与手工 magic 扫描

- Linux: `apt install bsdmainutils`（Debian/Ubuntu）/ `dnf install util-linux`（Fedora/RHEL，含 hexdump）
- macOS: 自带 /usr/bin/hexdump
- Windows/WSL: WSL 内 Linux 版
- 验证: `hexdump -C /dev/null`（无报错即可用；macOS 版无 `--version`）

### sasquatch —— 老式/厂商魔改 squashfs 解包

- Linux: 源码编译（`git clone https://github.com/devttys0/sasquatch`，需 `apt install zlib1g-dev liblzma-dev build-essential` 后 `make`）
- macOS: 同上源码编译（需 Xcode Command Line Tools）
- Windows/WSL: WSL 内编译
- 验证: `sasquatch -h` 输出用法（编译产物在仓库子目录，需加入 PATH）

## 操作步骤

按顺序执行，每步记下结果。

1. **自动解包（unblob 优先，binwalk 兜底）**：
   ```sh
   unblob firmware.bin                      # 更准，自动识别 50+ 容器格式并递归解包
   # 或 binwalk：
   binwalk firmware.bin                     # 先列出签名与偏移
   binwalk -Me firmware.bin                 # -M 递归 -e 提取
   ```
   产物：`firmware.bin/`（unblob）或 `_firmware.bin.extracted/`（binwalk）目录。解出的文件系统转 [[re-fw-rootfs]]，ELF 转 [[re-binary-core]]。

2. **magic 手工扫描（自动解包不全时）**：
   ```sh
   hexdump -C firmware.bin | head -40
   # 或按 binwalk 报告的偏移核对：
   dd if=firmware.bin bs=1 skip=<偏移> count=16 | hexdump -C
   ```
   常见魔数：JPEG `FF D8 FF`、gzip `1F 8B`、squashfs `hsqs`、cramfs `45 3D CD 28`（小端，大端反序）、U-Boot `27 05 19 56`、jffs2 `85 19`、ELF `7F 45 4C 46`。识别出一个就按该格式处理。

3. **字节序判断**：
   ```sh
   file firmware.bin                        # 输出含 LSB/MSB 提示
   readelf -h <解出的ELF>                    # Machine 字段 + Data 字段（大小端）
   strings firmware.bin | head               # 可读串确认字节序
   ```
   大端 ARM/MIPS 固件常见：大端时魔数与字符串按大端编码（如 `hsqs` 反序出现）；确认后整个流程按该字节序进行。

4. **嵌套容器逐层解**：
   - unblob / `binwalk -Me` 会自动递归，但嵌套（tar 里再 zip、自定义头包着 gzip）常中途断
   - 逐层手动：先解外层 → `file` 确认内层类型 → 用对应工具（tar/gzip 系统自带；squashfs 用 sasquatch；其他用 [[re-fw-rootfs]] 工具准备的 7z/unsquashfs）再解，直到出现文件系统或 ELF
   - **结束标记后的附加数据**：图片（PNG `IEND`、JPEG `FFD9`）等格式的结束标记之后常附加容器/压缩流（解析器读到结束标记即停，附加数据对正常查看不可见）——`file` 会把整文件报成图片，检查 `rfind(IEND/FFD9)` 之后的部分，且**结束标记用第一个还是最后一个取决于数据里可能碰巧出现同样的字节对**
   - **zip 缺签名也能修复**：附加的 zip 可能缺本地文件头开头的 `PK\x03\x04`（4 字节被剥）——用字段自洽验证：补上签名后 version（常见 20/45）、mod date（年 1980+）、compressed/uncompressed size（与 EOCD/中央目录条目一致）全部合理，且 EOCD 在尾部完好 → 补 `PK\x03\x04` 前缀即完整可解（`unzip` 报 "missing 4 bytes" 或 zipfile `OSError: Invalid argument` 是典型征兆）
   - **套娃模式自动化**：同一手法重复出现（如每层都是"图片+尾部 zip 含下一层"）时写循环自动剥——提取尾部 → 修复 → 解压 → 定位下一层 → 重复，直到无附加数据；中间产物每层命名保留（可回滚）

5. **自动失败时手工切分（dd 按偏移）**：
   ```sh
   binwalk firmware.bin                     # 找内嵌文件偏移
   dd if=firmware.bin of=part1.bin bs=1 skip=<偏移1> count=<长度1>
   dd if=firmware.bin of=part2.bin bs=1 skip=<偏移2>
   file part*.bin                           # 每块验证
   ```
   厂商自定义头最常见：跳过头部 N 字节后才是标准格式（先 hexdump 目测头长度再切）。

## MCU 镜像分析（8051 / AVR / PIC / MSP430）

### 何时进入本节

- 前置：已走完步骤 1-5（自动解包、magic 扫描、字节序判断、嵌套解包、dd 切分），确认镜像里没有文件系统/ELF/可执行容器
- 判断条件（满足即可进入本节）：
  - 无文件系统：binwalk/unblob 零命中或只有少量误报，无 squashfs/cramfs/jffs2 等魔数
  - 单镜像：体积小（几十 KB 量级）、无分区表、无 bootloader 引导头、无多段结构
  - MCU 特征：`file` 报 data/unknown；strings 无操作系统与库特征串（无 "libc"、无 RTOS 内核名）；镜像开头低地址处是短跳转/向量数据而非可读头
- 例外分流：镜像中出现 RTOS 特征（调度器/任务创建字符串、TCB 形态）→ 定位复位向量与启动代码后转 [[re-rtos]]

### 镜像格式：Intel HEX 与二进制

- **Intel HEX（.hex）**：ASCII 文本，逐行记录 `:LLAAAATT<数据><校验和>`——LL 数据长度、AAAA 段内地址、TT 记录类型（00 数据 / 01 结束 / 02·04 扩展地址 / 03·05 起始地址）、末字节校验和
  - 地址可分段不连续：多段记录之间留空，整文件按 bin 反汇编必然错位
  - 先转内存映像：按记录把数据落位到实际地址（02/04 扩展地址记录决定地址高 16 位），再按 flash 起始基址导入反汇编器
- **二进制（.bin）**：原始内存映像，无地址信息，导入时手动给基址
- 程序内存布局（泛化，具体值因芯片而异）：
  - flash 起始：0x0000 或芯片映射基址（如 0x8000/0x10000 量级），以复位向量所在位置反推更可靠
  - 中断向量表：低地址固定区，复位向量位于表内固定偏移（见下节）

### 向量表定位

- 复位向量 → 启动代码：从复位向量位置取入口地址，沿此反汇编即为启动序列（禁中断、初始化堆栈/时钟/外设、跳 main）
- 复位向量位置各架构不同：8051 在 0x0000、AVR 在 0x0000、MSP430 在 0xFFFE（高地址端）、PIC 多为 0x0000（个别系列另有固定偏移）——按架构查位置，不猜
- 跑 RTOS 的固件：复位向量 → 启动代码 → 内核初始化/任务创建 → 调度器启动，衔接 [[re-rtos]] 按任务表拆分

### ISA 识别与反汇编

- 识别要点（结合指令字宽、寻址特征、字节序判断）：
  - **8051**：哈佛架构，程序/数据空间分离（MOVC 读程序区、MOVX 访问外部数据区）；SFR 特殊功能寄存器（0x80-0xFF 直接寻址）；0x20-0x2F 区可位寻址；累加器 A 与 DPTR 主导数据搬运
  - **AVR**：RISC，32 个通用寄存器（R0-R31）寄存器文件，指令大多单周期；哈佛架构
  - **PIC**：哈佛架构，寄存器分 bank、靠状态位切换（bank 切换）；指令字宽随系列不同（12/14/16 位），导入反汇编器时按对应宽度
  - **MSP430**：冯诺依曼（统一地址空间），16 位；中断向量表集中在高地址区（0xFFE0-0xFFFF）
  - 字节序：这些架构均以小端为主，导入反汇编器时以实际数据确认（多字节常量、跳转目标地址小端排列为常见形态）
- 反汇编：选对应架构的处理器模块导入（Ghidra 含 8051/AVR/PIC/MSP430 处理器支持，[[re-ghidra]]；其他反汇编器同样有对应处理器，工具可替换，方法为核心）
- 熔丝位/配置位（泛化概念）：烧录期配置项（各架构叫法不同：熔丝位/配置位/安全位），烧录时一次性写入，影响时钟源选择、看门狗、代码/读保护等。它不体现在镜像内容里，但决定芯片后续硬件行为——镜像读不到时要先怀疑它

### 本节常见坑与陷阱

- **Intel HEX 多段当 bin 直接反汇编**：现象——反汇编错位，地址与代码对不上，全是无效指令；原因——HEX 分段记录地址不连续，且忽略 02/04 扩展地址记录会把高地址段数据落到低地址；对策——先按记录类型把数据落到实际地址（扩展地址记录参与地址合成），生成连续内存视图，再按 flash 基址导入
- **向量表偏移猜错**：现象——从文件头直接反汇编得到一堆数据/无效指令，找不到入口；原因——各架构复位向量位置不同（8051/AVR 在 0x0000、MSP430 在 0xFFFE、PIC 多为 0x0000 或系列固定偏移），猜错就从数据开始反汇编；对策——先确认架构，再按该架构复位向量固定位置取入口，从复位向量跟启动代码
- **熔丝位锁定读保护，镜像不可得**：现象——芯片读保护开启，读取操作返回全 F/拒绝响应，拿不到完整镜像；原因——烧录期配置位开启了读保护（代码保护），正常读取接口被锁；对策——走替代路径：芯片自带 UART bootloader 交互（若未禁用）、逻辑分析仪采集固件升级/烧录流量（[[re-hardware-io]]）按协议还原；镜像不可读时不强求，改从行为侧分析（串口输出/协议交互）
- **数据 EEPROM 与程序 flash 混淆**：现象——反汇编出大量无效指令，或分析半天发现是数据；原因——镜像含数据 EEPROM/校准表/配置表映像（非易失数据区，独立于程序区），被当成代码；对策——用复位向量/向量表定位程序区起点，程序区之外的高熵/全 F/重复模式段先排除为数据区，再反汇编

## 跨域联合

- [[re-firmware]]：工作流第 2 步固定调用本技能
- 解出的文件系统 → [[re-fw-rootfs]]；解出的可运行程序 → [[re-fw-emulate]]
- 解出的 ELF → [[re-binary-core]]（[[re-format-elf]] / [[re-ghidra]]）；发现恶意样本 → [[re-malware]]
- 本技能被 [[re-analyze]] 的 triage「分析固件 / IoT 设备」路径调用（re-firmware → re-fw-extract）

## 常见坑与陷阱

- **自动解包失败 ≠ 没东西**：现象——binwalk 输出空白或解出 0 字节文件；原因——厂商自定义头/加密层使魔数不匹配，签名库漏判；对策——hexdump 手工扫自定义头（步骤 2），跳过头部偏移再用 dd 切分（步骤 5）
- **字节序错 → 全错**：现象——解出的文件/ELF/字符串全乱；原因——大端 ARM/MIPS 固件被当小端处理；对策——先 `file` + `readelf -h` 确认字节序（步骤 3），后续解包/分析全程保持一致
- **大端 MIPS 头被 binwalk 漏**：现象——binwalk 识别不出已知文件系统（如 squashfs）；原因——签名按小端特征匹配，大端魔数反序；对策——hexdump 手工找反序魔数，按偏移 dd，用 sasquatch 解
- **解包产物混入垃圾**：现象——解出的"文件"是随机数据，`file` 报 data；原因——签名误报或切分偏移错位；对策——每个产物 `file` + 看头 16 字节验证 magic，无效即重试偏移
- **扩展名与内容不符（伪装扩展名）**：现象——`.jpg` 报 PNG、`.so` 报 tar、`.c` 报 XZ；原因——作者故意用无关扩展名（隐写/套娃/免检场景常见）；对策——永远以 `file`/魔数为准，扩展名只当线索；`file` 输出带 "with extra data prepended" 等提示时直接照做
- **zip 报错但能列出文件**：现象——`unzip` 报 "missing 4 bytes"/"invalid zip with overlapped components"（zip bomb 误报）或 Python zipfile `OSError: [Errno 22] Invalid argument`；原因——本地文件头缺 `PK\x03\x04` 签名，或数据前有前缀垃圾；对策——先 `unzip -l` 看能否列出（能列出说明 EOCD/中央目录完好），补签名（步骤 4）或用 `UNZIP_DISABLE_ZIPBOMB_DETECTION=TRUE` 强制
- **ME 固件（Intel ME / CSME）从启动链入手**：现象——解出 ME 固件分区（FTPR/RBE/BUP）后不知从何下手，代码里一串 ROM_SVC_* 调用看不懂；原因——ME 是独立处理器固件，启动链与普通固件不同：ROM（PCH 内固化，不可提取）验签 FTPR → 解压 RBE（初始化 PCH/SPI、UTOK 校验、boot_cfg）→ kernel（ThreadX RTOS）→ BUP（硬件 bringup，读 boot_cfg 决定开不开 DCI）→ pm/vfs/heci/crypto 等 38 个 user processes；对策——先解 FPT（Flash Partition Table：ME 区域固定偏移处的分区路由表，记录各分区位置/大小/类型——ROM/RBE 无文件系统全靠查它定位分区，UEFIExtract 源码有解析参考），再按 RBE→kernel→BUP 顺序跟进；调试接口/硬件初始化逻辑在 BUP
- **UTOK 是 ME 调试解锁的 OEM 后门**：现象——想开 ME 调试接口（DCI/DFX）找不到开关；原因——Intel 为 OEM 留的解锁机制：SPI Flash 的 FPT 分区表中独立 UTOK 分区，写入数据即可解锁 DFX 调试接口（无需硬件熔丝）；对策——逆向 RBE 的 `rbe_utok_check` 定位校验逻辑：标志位 UTOK[0x298]==1 才启动调试能力（厂家默认 FF 不启动），且 DCI 开放受多层校验链控制（boot_mode==2、boot_cfg 解析、CT handler 门控、FPF Debug Auth 等），单改标志位不够；定位技巧：ME 运行 base 是 0x4000，字符串偏移按此换算
- **ME 固件漏洞利用受 ROM cookie 限制**：现象——ME 固件里找到缓冲区溢出（如 Intel-SA-00086：CT 文件 `num_records`（偏移 +0x06 的 uint16）无校验，record 数超 100 覆写栈 cookie/返回地址），ROP 却打不通；原因——ME 的 cookie 由 ROM（mask ROM 不可提取）在 SRAM 预填充进程上下文表生成，无法像 TXE 平台那样用 TLS 绕过；对策——先确认目标平台 cookie 来源（ROM 生成则溢出利用受限），完整逆向认证链路（UTOK→boot_cfg→CT handler 多层校验）后找非溢出路径
- **分块周期变换**：现象——单一全文件 XOR/旋转只在开头有效；原因——变换按块大小（常见 256/512/1024/2048/4096）重置；对策——先按常见 Flash/传输块大小检查变换是否按块重置周期，显式分块解码
- **块首自带掩码混淆**：现象——高熵固件被当强加密；原因——分块自带掩码混淆（如 `mask = block[0]`、`plain[i] = ROR8(packed[i], n) XOR mask`（mask 字节自身不参与变换，i 从 1 起））；对策——先用强 crib（向量表 SRAM 栈指针/Thumb Reset Vector）约束恢复首块，再验证模型
- **众数 crib 不可靠**：现象——文本密集块用众数字节做掩码仍乱码；原因——最常见明文字节不一定是零；对策——改用块首字节模型，验证标准：乱码消失 + 第二份同系列固件复现 + round-trip 逐字节一致
- **CRC 字符串 ≠ CRC 字段**：现象——看到 CRC 名字符串就假设末尾是标准 CRC；原因——字符串只是元数据键；对策——系统排除常见 CRC/硬件 CRC/Adler/累加族后保留为未知字段，不强行命名
（来源：reverse-skill field-journal，MIT）
