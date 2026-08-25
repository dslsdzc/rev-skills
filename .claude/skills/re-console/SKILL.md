---
name: re-console
description: >
  现代主机与复古平台逆向：Switch NSO/NPDM 容器与加密分区、PS4/PS5 ORBIS 结构、SDK 库指纹；复古 ROM 头/卡带格式/存档与 Cheat 码。
  触发词：主机逆向、Switch、NSO、NPDM、PS4、PS5、ORBIS、Xbox、复古、ROM、NES、GBA、模拟器、Cheat。
---

# 现代主机与复古平台逆向（Switch NSO/NPDM、PS4/PS5 ORBIS、复古 ROM/存档）

## 何时使用 / 何时不用

- 用：Switch 程序容器解析——NSO0（代码段结构）、NPDM（程序元数据/权限面）、ExeFS/NCA 分区边界识别；持合法 keyset 时解密 NCA/NAX0 分区并提取代码段
- 用：PS4/PS5 ORBIS 主程序（eboot.bin）——加密边界识别、合法解密样本的 ELF 结构解析（PT_SCE_* 程序头）、SDK 版本与导入库指纹
- 用：Xbox 系容器（XBE/XEX2）解析与入口定位
- 用：复古平台 ROM——NES（iNES/NES 2.0）、GB/GBC、GBA、PSX 的 ROM 头解析、卡带格式、存档文件、Cheat 码分析
- 用：SDK 库指纹（Switch NX SDK、ORBIS SDK、Xbox XDK、devkit 工具链）辅助版本识别与函数匹配
- 不用：PC 端游戏（Unity/Unreal、Cheat Engine 内存修改）走 [[re-game]]
- 不用：移动端游戏（[[re-mobile]]）
- 不用：容器解析出代码段后的通用反编译/调试底座（交 [[re-binary-core]]，Ghidra/IDA 照常使用）
- 不用：改机/自制固件刷写、主机破解、零售媒体解密与内容保护规避、盗版/未授权 ROM 的获取与分发——本技能只提供文件格式与分析方法，样本须来自合法渠道（自有设备备份、开发机/官方 SDK 内容、已获授权资料）；卡带 dump 仅限自有卡带的分析用途，各司法辖区对个人备份的规定不同，由使用者自行确认
- 不用：单纯使用成品存档修改器/Cheat 工具（本技能是分析路径，不提供成品工具）

## 工具准备

所有工具先验证再使用。静态分析可免沙箱；涉及动态执行（模拟器运行 ROM、运行解密样本）默认沙箱 + 网络隔离（[[platform-tips]] 最高原则）。

### 反编译器（Ghidra / IDA 任选其一）

- Ghidra（免费，官方 release 包，需 JDK；部分发行版仓库有 `apt install ghidra` / `pacman -S ghidra`）：
  - Linux: 官方 release 包；macOS: `brew install --cask ghidra`；Windows: 官方 zip
  - 验证: `analyzeHeadless -help`（headless 模式）或 GUI 导入目标文件
  - 架构覆盖：Switch 为 aarch64、PS4/PS5 为 x86-64、PSX 为 MIPS R3000（方法论见 [[re-mips]]）、GBA 为 ARM7TDMI（Thumb 处理见 [[re-arm]]）、NES 为 6502 系；GB 的 SM83 是 Z80 变体，Ghidra 无原生模块，用 Z80 近似或专用 Game Boy loader 插件（见坑 6）
- IDA：商业版架构模块齐全；Freeware 版架构支持范围以官方页面为准
- 导入 ROM 时按平台设基址：GBA 0x08000000（卡带映射区）、PSX 按 EXE 头 0x18 字段（典型 0x80010000，RAM 基址 0x80000000）；NES/GB 是固定地址空间 + bank 切换，需要 loader 支持 mapper/bank（见坑 6）

### hactool —— Switch 容器解析（NSO0/NPDM/NCA）

- 来源与安装: GitHub `SciresM/hactool` releases——1.4.0（2018 年发布的末版，支持 NSO0/NPDM 解析与解压，NPDM 可导出 JSON）提供 Windows 包（`hactool-1.4.0-win.zip`）；Linux/macOS 从源码构建（`config.mk.template` 拷为 `config.mk` 后 `make`，依赖 zlib/openssl）
- 验证: `hactool --help` 显示完整选项
- 注：旧教程/文章常见的 hactoolnet（LibHac 项目附带 CLI）仓库已下线——2026-08 核实 GitHub 404（`Thealexbarney/LibHac` 已不存在），引用到 hactoolnet 的资料先验证链接可用性，功能缺口用 hactool + 自写解析脚本（pyelftools）补齐
- 密钥: `-k keys.txt` 指定 keyset（每行 `key_name = HEX`）；默认读 `$HOME/.switch/prod.keys`（`-d` 时读 dev.keys）。解密 NCA/NAX0 需要对应 keyset，无密钥只能做结构层分析

### readelf / pyelftools —— ORBIS 与通用 ELF 解析

- Linux: binutils 自带（`apt install binutils` 等）；macOS: `brew install binutils` 或 LLVM 系 readelf；Windows: WSL 内
- pyelftools: `pip install pyelftools`（脚本遍历程序头/节表）
- 验证: `readelf --version`、`python3 -c "import elftools; print('ok')"`
- PS4/PS5 的 ORBIS ELF 是带 SCE 扩展程序头的合法 ELF64——readelf 可直接解析（`-l` 看 PT_SCE_* 段、`-S` 看节表）；不绑定专用 ORBIS 查看工具（场景社区工具维护不一，先验证再使用）

### 模拟器调试器（复古平台动态分析）

- mGBA（GB/GBC/GBA，内置调试器 + GDB stub）:
  - Debian/Ubuntu: `apt install mgba-qt`（Qt 前端，universe）或 `mgba-sdl`；Fedora: 官方仓库只有 libretro 核心 `dnf install libretro-mgba`（无调试器），带调试器的 mGBA 用 Flatpak 或第三方 COPR（如 `dnf copr enable archjun/mgba` 后 `dnf install mgba`，第三方源自行评估）；Arch: `pacman -S mgba`；macOS: `brew install mgba`；Windows: 官方站 mgba.io 安装包
  - 验证: `mgba --version`
  - 调试: GUI 加载 .gba/.elf 后 Tools → Start GDB Server（或命令行 `-g`/`--gdb`），默认监听 localhost:2345；GDB 侧 `target remote localhost:2345`，配合带符号 .elf 设断点（mGBA 的符号来自 .elf 而非 .gba）；命令行 `-d` 调试器是 SDL/GTK 版功能，Qt 版用 GDB stub
- FCEUX（NES，内置调试器/hex 编辑/RAM 搜索）:
  - Debian/Ubuntu: `apt install fceux`；Fedora/Arch: `dnf install fceux` / `pacman -S fceux`；Windows: 官方站 fceux.com
  - 验证: `fceux --version`
- no$psx（PSX 调试器，Windows 免费版）: 官方页 problemkaputt.de/psx.htm 下载（无发行版包，仅 Windows），自带反汇编/断点/内存与 VRAM 查看器；Linux/macOS 无对应版本，PSX 动态调试用 QEMU 系（[[re-fw-emulate]] 的 qemu-system 思路 + gdb）或纯静态
- 其他平台按需: SNES 调试器可用 Mesen（Windows 官方下载）等，以官方渠道为准

### 卡带读取器（选购指引，泛化）

- 思路: 按平台选对应接口——NES 72 针、SNES 62 针、GB/GBC 32 针、GBA 32 针；多平台通吃通常是主机板 + 转接板组合
- 选购要点: 开源固件优先（固件可审计、可自己编译）；确认支持目标机种与卡带变体（特殊 mapper、加速芯片、CGB 双电压）；支持双次 dump 校验（同一卡带读两遍比对，与已知 hash 库交叉验证）；供电与电平匹配（GB 系 3V、NES 5V，插错可能损坏卡带）；只读 dump 是分析基线，写入/烧录能力按授权边界决定用途
- 验证: 读出的 dump 与同平台模拟器可运行性/已知 hash 交叉验证

### binwalk —— 内嵌文件扫描

- 同 [[re-fw-extract]]：`pip install binwalk`（或发行版包）；验证: `binwalk --version`

## 操作步骤

按顺序执行，每步结果存档（hash、偏移表、解析产物 sha256，[[re-triage]] 存证）；动态执行默认沙箱。

1. **容器识别**（先定格式，再定工具链）：
   ```sh
   file target.bin
   xxd -l 64 target.bin
   binwalk target.bin    # 内嵌/拼接文件扫描
   ```
   - Switch: `NSO0`（NSO 程序）、`META`（NPDM 文件头）、`NCA3`（NCA 容器）、`NAX0`（SD 加密分区）、`PFS0`（NSP 明文包容器）；ExeFS 里 `main`（NSO）与 `main.npdm` 并存
   - PS4/PS5: 明文 ELF 以 `\x7fELF` 开头（ORBIS ELF 带 PT_SCE_* 程序头）；零售 dump 的 eboot.bin 是加密容器（无 ELF 魔数、熵高），加密边界在此——本技能只分析已合法获得的解密/未加密样本
   - Xbox: `XBEH`（初代 Xbox XBE）、`XEX2`（Xbox 360，24 字节大端头，0x8 指向内嵌 PE 数据、可选头表）；Xbox One/Series 为微软系变体容器（XVD/ERA 体系），解析前先按样本实测探测
   - 复古: NES `4E 45 53 1A`（"NES\x1A"）；GBA 无魔数（0x0 是 ARM 分支指令，0x4 起 156 字节 Nintendo logo）；GB 无魔数（0x104 起 48 字节 logo 判据 + 0x147 卡带类型）；PSX 光盘是 ISO9660（`CD001` 卷描述符），主程序 SYSTEM.CNF 指向的 EXE 以 `PS-X EXE` 开头；原始 .bin 镜像扇区 2352 字节（非 2048），定位卷描述符时按 2352 换算扇区偏移
   - 存档: GBA `.sav` 无统一魔数（按容量/内容结构识别）；PSX 记忆卡 dump 的 `MC` 签名在 0x0 与 0x1F80
   - 判定不明时先走 [[re-triage]] 常规初勘

2. **容器解析**（分区/加密边界区分）：
   - Switch NSO（hactool 自动识别 NSO0）：
     ```
     hactool -i main.nso                          # 段信息/压缩标志/ModuleId
     hactool --uncompressed=main_u.nso main.nso   # 压缩段解压（flags 压缩位置位时）
     ```
     NSO0 头要点：0x0 魔数 `NSO0`；0x10/0x20/0x30 三段头（各 0xC 字节：FileOffset/MemoryOffset/Size，依次对应 .text/.rodata/.data）；0x3C BSS 大小；0x40 起 0x20 字节 ModuleId（= ELF 的 build-id 摘要）；0x60/0x64/0x68 三段压缩后大小；0x100 起为段数据（压缩段用 LZ4；22.0.0+ 固件 flags bit7 置位时为 ZBIC/zstd 变体，nxdumptool NsoFlags_UseZbicCompression=BIT(7)）
   - Switch NPDM：
     ```
     hactool -t npdm --json=main.json main.npdm   # 导出权限 JSON
     ```
     NPDM 要点：0x0 `META` 头（0x80 字节）；0xE 主线程优先级、0xF 主线程核号、0x1C 主线程栈大小（0x1000 对齐）；0x70/0x74 ACI0 偏移/大小、0x78/0x7C ACID 偏移/大小；ACID 区 0x200 处 `ACID` 魔数（前为 RSA-2048 签名与公钥）、ACI0 区 0x0 处 `ACI0` 魔数；ACI0 内含 ProgramId、文件系统/服务访问控制、内核能力（kernel capability）——权限面分析看这里
   - Switch NCA（加密边界）：NCA 头含分区表（section table），正文按分区加密（AES-XTS）；持合法 keyset 时 `hactool -t nca -k keys.txt --exefsdir=exefs/ --romfsdir=romfs/ file.nca` 提取 ExeFS（内含 NSO/NPDM）与 RomFS；NAX0 另需 `--sdseed` 与 `--sdpath` 参数。无 keyset 只做结构层解析，不做解密绕过
   - ORBIS ELF：`readelf -l eboot` 看程序头——PT_SCE_DYNLIBDATA（0x61000000）、PT_SCE_PROCESS_PARAM（0x61000001）、PT_SCE_MODULE_PARAM（0x61000002）、PT_SCE_RELRO（0x61000010）；`readelf -S` 看节表（.comment/.sceNote 等）；导出表在 PT_SCE_DYNLIBDATA 内
   - XEX2：遍历可选头数组（每项 type+data 两项，数据大小由 type 低 8 位 ID&0xFF 决定）——执行信息可选头含入口点、导入库可选头含库名与序号；代码段位置由 0x8 的 PE 数据偏移推算；XEX 头部字段大端、内嵌 PE 部分按 PE 规则解析（[[re-format-pe]]）
   - 每步产物存档：解析出的段文件 + 魔数/偏移/大小记录

3. **代码段提取进通用反编译**：
   - NSO：按段头 MemoryOffset 在 Ghidra 中把 .text/.rodata/.data 建为内存块（先统一基址再自动分析），BSS 补 0 区域；导入选 aarch64
   - ORBIS：解密 ELF 直接导入 Ghidra（x86-64），ET_EXEC 按头内固定基址、ET_DYN 按加载约定；先用 `nm`/`readelf -s` 找未剥离符号，入口点常在模块参数段/入口节附近
   - PSX：提取 EXE 的 text 段（文件偏移 0x800 起、长度取头 0x1C 字段），按头 0x18 字段的加载地址导入，MIPS R3000 小端（延迟槽与 $gp 方法论见 [[re-mips]]）
   - GBA：整 ROM 按 0x08000000 导入，ARM7TDMI 混编 Thumb（见 [[re-arm]]）；GB/NES：无反编译器原生 CPU 时用近似指令集 + 手动 bank 展开（见坑 6），或专用 loader 插件
   - 存档：先 `strings` 找产品码/校验和特征（PSX 槽头 0x0A 处 `BXXXX-12345` 类产品码串）

4. **SDK 库指纹**（版本识别 → 函数匹配加速）：
   - Switch：NSO 头 0x40 的 ModuleId 对照 switchbrew 的 SDK 版本表/社区数据库可得 SDK 版本（映射表随固件演进，先核实时效）；二进制内 `NintendoSDK` 版本串以样本实测为准
   - ORBIS：PT_SCE_MODULE_PARAM 段内含 sdk_version 字段（uint32，如 0x08030001 对应 8.03 级）与模块参数魔数 0x3C13F4BF；`.comment`/`.sceNote` 节常含 SDK 版本串——sdk_version 是编译 SDK 版本，不等于运行固件版本
   - Xbox：XEX2 导入库可选头列出系统 DLL 名与序号（对应 XDK 版本范围）；XBE 的库版本数组同理
   - 复古：工具链指纹——GBA 商业 ROM 多为 ARM7TDMI + 厂商编译器（库函数形态/特征串），homebrew 常见 devkit 系特征串；PSX 商业盘常见厂商 SDK 库函数形态；对照已知库签名表加速函数识别
   - 产出：SDK/工具链版本 + 库函数特征表，供步骤 5 与后续反编译命名

5. **补丁差异**（联动 [[re-variant]]）：
   - 多版本对比：同游戏不同区域/更新档的 ROM 或主程序 diff——定位功能变化点、版本门控逻辑（地区判断、SDK 版本分支）
   - 方法：解压/解包对齐后 `diff` 或按 [[re-variant]] 的函数匹配流程；版本差异集中在 SDK 升级区与新增功能时，先按 SDK 指纹分层再逐层 diff
   - 产出：差异点清单 + 变化函数对应分析

6. **复古：存档与 Cheat 码分析**（内存地址 + 值模式）：
   - 存档结构解析：
     - PSX 记忆卡：128KB（0x20000）= 16 块 × 8KB，块 0 为头/目录块；`MC` 签名在 0x0 与 0x1F80；每块 64 帧 × 128 字节；槽头 128 字节——0x00 槽类型（0xA0 空/0x51 首块/0x52 中间/0x53 末块）、0x04 存档大小、0x08 下一块指针（多块存档是链表）、0x0A 产品码名、0x7F XOR 校验和；图标 16×16 4bpp 最多 3 帧（数据第 2 字节 0x11/0x12/0x13 表示帧数）
     - GB/GBA：`.sav` 大小由卡带类型决定——GB 看 0x149 字段（0x02=8KB、0x03=32KB 常见）；GBA 常见 SRAM 32KB、Flash 64/128KB、EEPROM 512B 级；无统一魔数，用容量 + 内容特征（校验和、ASCII 文本）识别
     - 分析目的：还原存档校验算法、字段语义（数值/道具/进度位图）
   - Cheat 码分析（方法论，非成品工具）：
     - 原理：Cheat 码 = 「内存地址 + 值/写模式」编码，如 GBA CodeBreaker 型 `AAAAAAAA 0000`（8 位地址 + 4 位值）——GB/GBC 用 GameShark 8 位格式，勿混称；NES 系 6 字符编码（地址/值 + 密钥变换）；先按编码规则解码出地址与值
     - 还原路径：模拟器调试器（mGBA/FCEUX）内存视图/搜索定位游戏内数值（金币、生命）→ 记录地址（GBA: EWRAM 0x02000000 起、IWRAM 0x03000000 起；GB: WRAM 0xC000-0xDFFF）→ 调试器断点找写该地址的代码 → 反编译器中还原该函数与数据流 → 得出「某地址存某值」的语义与所有引用点
     - 产出：地址语义表（地址 → 含义/类型/范围），供校验、反编译标注或行为研究；只做分析，不提供成品 Cheat 工具
   - 沙箱：模拟器内动态验证默认沙箱 + 网络隔离

## 跨域联合

- [[re-binary-core]]：代码段提取后的通用初勘/反编译/调试底座（[[re-ghidra]]、[[re-ida]]、[[re-gdb]] 照常使用）
- [[re-game]]：PC 端 Unity/Unreal 游戏逆向姊妹技能；「内存地址 + 值模式」的游戏逻辑分析方法互通
- [[re-cracking]]：授权/激活校验分析；主机场景的合规边界与本技能一致
- [[re-variant]]：多版本/多区域 ROM 与主程序 diff
- [[re-mips]]：PSX 的 MIPS R3000 指令集与方法论（延迟槽、$gp）
- [[re-arm]]：GBA ARM7TDMI 的 Thumb/ARM 处理
- [[re-fw-extract]] / [[re-fw-rootfs]]：卡带/光盘镜像内嵌文件与文件系统提取（binwalk 前置）
- [[re-patching]]：ROM/程序字节级修改落地（注意头校验和重算，见坑 4）
- [[re-sandbox]]：模拟器/动态执行强制隔离（[[platform-tips]] 默认沙箱原则）
- [[re-triage]]：容器识别前置初勘
- [[re-format-pe]]：XEX2 内嵌 PE 部分解析

## 常见坑与陷阱

- **加密容器当明文解**：现象——Switch NCA/NAX0 或 PS4/PS5 零售 eboot.bin 直接丢进反编译器，全是高熵乱码/反汇编出幻觉代码；原因——内容在 NCA 正文（AES-XTS）与 ORBIS 容器层加密，NSO0/ELF 魔数只在解密后可见；对策——先做加密边界识别（魔数缺失 + 熵高 = 密文），持合法 keyset 走容器工具解密提取（hactool 解 NCA/NAX0），无密钥只做结构层；本技能范围到合法获得的样本，不做解密绕过
- **SDK 指纹误判**：现象——把编译 SDK 版本当运行固件版本、或按旧对照表把 ModuleId 错配到别的 SDK，导致库函数表对不上；原因——ModuleId↔SDK 映射表随固件演进漂移，ORBIS 的 sdk_version 字段是编译时版本；对策——指纹结论标注「编译 SDK 版本」，对照表先核实时效（以当前维护页面为准），与二进制内实际版本串交叉验证再定论
- **元数据头与正文分离**：现象——只解析了 NSO 或只看了 NPDM，权限面/入口信息/代码互不关联，分析缺块；原因——NPDM（权限/入口元数据）是与 NSO 并存的独立文件，NCA 分区表在头部而分区数据按偏移散布，XEX2 的头部字段与 PE 数据分离存放；对策——把同批容器产物（NPDM+NSO、NCA 各分区、XEX 头+PE 段）作为一个整体建档，先列清单再逐个解析
- **ROM 头校验和与补丁失效**：现象——改 ROM（patch/汉化/修改）后模拟器或真机拒绝启动；原因——GBA 头 0xBD 是 0xA0-0xBC 逐字节求和的 complement 校验（再减 0x19 取 8 位），改标题/游戏码必须重算；GB 头 0x14D 校验和覆盖 0x134-0x14C；NES 改 mapper 位不影响启动但影响映射正确性；对策——改头后按算法重算校验和，补丁方案把校验和重算写进步骤
- **模拟器与真机行为差异**：现象——mGBA 上能跑的修改在真机闪退、FCEUX 与 Mesen 对同一 ROM 的 mapper 行为不同；原因——时序敏感代码（GBA 音频/中断时序）、mapper 实现差异、模拟器精度差异；对策——结论标注「模拟器环境验证」，需要真机级结论时用多种模拟器交叉验证 + 真机（读卡器/烧录卡）复核；存档写回与断电时序在模拟器上尤其不可靠
- **反编译器缺原生 CPU 支持时的错位反汇编**：现象——GB 的 SM83 无原生模块，用 Z80 近似反汇编出不存在指令；NES 6502 变体细节被当普通指令；原因——近似指令集不等于目标 CPU；对策——先识别 CPU（GB 看 0x104 logo/0x147 卡带类型、NES 看 flags 的 mapper），无原生支持时用专用 loader 插件或手动标注限制，近似反汇编结果标注「近似」，关键逻辑用模拟器调试器实测校正
- **授权边界**：改机/自制固件、零售媒体解密、未授权 ROM 获取与分发不在本技能范围；分析样本须来自合法渠道；卡带 dump 仅限自有卡带分析用途，按所在司法辖区规定自行确认；技能正文只提供格式解析与分析方法
