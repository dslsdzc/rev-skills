# 监控报告对账判定表（2026-09-30）

## 一、由来

2026-09-12 至 2026-09-29 期间，一份外部对话对本仓库做了持续监控，累计报出 **121 条**报告项
（事实性错误与过时内容）。逐条对账结果：**30 条已修**、**91 条未修**。

本表对其中 95 条（91 条未修 + 5 条用于交叉验证的已修项，按 F 编号去重后 95）做逐条**判定**。
注意：判定的不是「修了没」，而是**报告本身对不对**。判定为「报告不成立」的条目**不得进入修复**——
照报告去改会把正确内容改错。仓库已有先例（补充 30 驳回 udsoncan `ClientConfig` 报告），本表沿用
同样要求：**驳回必须给证据链**。

## 二、方法

判定不看报告措辞，只看三类可核验依据：

1. **本地实测**——能跑的一律跑。clang 22 交叉编译（`--target=armv6m-none-eabi` / `mips-unknown-linux-gnu` /
   `riscv64-unknown-linux-gnu` / `i386-linux-gnu` / `armv7`）、`qemu-system-x86_64` 与 qemu-user / qemu-mips /
   qemu-riscv64、gdb `starti`、`openssl s_client -msg`、`apksigner` + `zipalign`、`go doc` 与 `LD_PRELOAD`
   探针、`pacman -Si`、本机 IDA 9.4 安装目录、`/usr/include/linux/bpf.h`、以及 6 份 `jni.h`（JDK 8/11/17/27、
   GraalVM 21、Android NDK 30）的声明序解析
2. **标准与官方文档原文**——ELF gABI、Apple `loader.h`、dyld 与 XNU 源码、Itanium C++ ABI、
   AAPCS32/AAPCS64、MIPS32 架构手册、System V x86-64 psABI、SMCCC、RFC 8446 / 7301 / 9293、
   JNI Specification、ISO 14229、eBPF UAPI、MS PE/COFF 文档、Embarcadero Delphi Language Guide
3. **官方元数据与发行页**——PyPI `info.version` / `requires_python`、GitHub `releases.atom`（REST API 常被
   未认证限流）、Debian `sources.debian.org` 与包文件列表、Fedora Bodhi、Arch 官方仓库

关键判据：**读代码推断不能替代实跑**。多条判定来自实际构造的样本——为验证「取第一个 `IEND` 定 PNG
结尾」，构造了子串 `IEND` 落在 tEXt 载荷内的 PNG；为验证 TCP 不保留消息边界，观察 3 次连续 `send()`
在接收端合并为 1 个 chunk；为验证 `RegisterNatives` 槽位，解析了 6 份头文件的声明序。

统计口径：**按 F 编号计**（同一行常合并多条重复上报，如 F058/F070/F088 是同一处原文）。

## 三、结论汇总

| 判定 | 条数 | 含义 |
|---|---|---|
| 采纳（报告成立） | 70 | 仓库确有该问题，按下述「改法」改 |
| 部分成立 | 9 | 事实层成立、报告定性偏高；改措辞而非推翻原文 |
| 驳回（报告不成立） | 11 | 仓库正确，**不改** |
| 已修 | 5 | 报告描述的原文已不存在，无需判定 |
| 合计 | 95 | |

驳回率约 11.6%。驳回集中在两类：「把 AI 可读的措辞当成事实错误」（e_entry / `LC_MAIN` 的公式类指控 5 条）
与「把开发线当成已发行版本」（pwntools / Capstone 2 条）。

## 四、驳回清单（不得修复）

以下条目**严禁**出现在任何 `fix:` 提交里。改动它们等于把正确内容改错。

| F 编号 | 位置 | 报告主张 | 驳回依据 |
|---|---|---|---|
| F022 | `.claude/skills/re-automotive/SKILL.md:119,128` | 示例 `from udsoncan.client import Client, ClientConfig` + `config = ClientConfig()` 不可执行，应改 `default_client_conf | venv 装 udsoncan 1.26.1 实跑——`ClientConfig` 是 TypedDict（`__mro__` 含 dict），`ClientConfig()` 返回 `{}` 且不抛错；`Client.refresh_config` 源码逐键补 `default_client_config`；`Client(Dummy(), request_timeout=2, config=部分配置)` 构造成功，配置键补齐至 19 个 |
| F034 | `.claude/skills/re-format-macho/SKILL.md:77` | LC_MAIN.entryoff 语义与入口 VA 公式写错 | Apple loader.h `entryoff; /* file (__TEXT) offset of main() */`；dyld 源码 common/MachOAnalyzer.cpp:627 `startAddress = preferredLoadAddress() + mainCmd->entryoff`；本机 ld64.lld 造的 Mach-O 实测：__TEXT.vmaddr=0x100000000、entryoff=0x330、_main=0x100000330（vmaddr+entryoff |
| F035/F072 | `.claude/skills/re-pwn/SKILL.md:27,28、.claude/skills/re-exploit/SKILL.md:27` | pwntools 已进入 5.x 主线，4.15.0 不再是当前正式版 | PyPI pwntools latest = 4.15.0（2025-10-12，>=2.7），122 个版本中无任何 5.*；GitHub releases 最新 tag 同为 4.15.0；dev 分支 `pwnlib/version.py` = `5.0.0dev`，dev README 的「since version 5.0.0」是开发线预告而非已发行版 |
| F036 | `.claude/skills/re-format-elf/references/layout.md:26` | 把 ET_DYN 的 e_entry 定义为"相对基址的偏移"是事实错误 | ELF gABI ch5 定义 base address = 内存地址与文件虚拟地址之差，对 executable/shared object 是同一常量，由最低 PT_LOAD p_vaddr 推出（不是"映射起始地址"）；Linux fs/binfmt_elf.c:1245 `e_entry = elf_ex->e_entry + load_bias;`——DYN 下 e_entry 就是相对 base 的值，仓库措辞与该模型一致，且从未称其为文件偏移/RVA |
| F047 | `.claude/skills/re-format-elf/references/layout.md:26`（与 F036 同句重复） | 同一句"表述不严谨/易误导" | 同上；报告担心的非零最低 PT_LOAD.p_vaddr 场景已被 load_bias 吸收，该措辞不会产生地址偏差 |
| F052 | `.claude/skills/re-riscv/SKILL.md:76` | 把带 PT_INTERP 的动态链接 ELF 的「进程第一条用户态指令」与主程序 `e_entry/_start` 混为一谈 | 该句本身已写「动态链接程序先经 ld.so（PT_INTERP）」，无混淆；实测 gdb starti /bin/ls 首条指令落在 ld.so（0x7ffff7fdf7e0），而其 e_entry=0x5620、ld.so 自身 entry=0x217e0；实测 riscv64 静态 ELF e_entry=0x111b4 恰等于 _start 且无 PT_INTERP（qemu-riscv64 可跑）——「入口即 e_entry=_start」对常规工具链产物成立，「从 _start 起」是分析程序本体的合理建 |
| F069 | `.claude/skills/re-format-elf/references/layout.md:26`（重复） | 同上 | 同上（gABI ch4 e_entry 定义 + ch5 base address 定义 + 内核 +load_bias） |
| F080 | `.claude/skills/re-emulation/references/gotchas.md:7` | upstream 已发布 Capstone 6 正式线，仓库仍写 5.x 当前 | PyPI capstone latest = 5.0.9（2026-05-28，>=3.8）；6.x 仅有 6.0.0a1–a11 预发行（a11 = 2026-09-21）；GitHub releases 最新同为 `6.0.0-Alpha11`，无正式 6.0.0 |
| F110 | `.claude/skills/re-format-elf/references/layout.md:26（重复；报告另引 :48 p_vaddr 同措辞）` | 同上 | 同上；p_vaddr 行同理——段虚拟地址整体施加 load bias，与该文件措辞一致 |
| F111 | `.claude/skills/re-exploit/SKILL.md:69` |  | psABI 原文即 "the stack needs to be 16 (32 or 64) byte aligned immediately before the call instruction is executed"，与仓库此句逐字对应；实测探针：`call printf` 前 rsp%16==0 正常（rc=0）、==8 触发 movaps SIGSEGV（rc=139）；ROP 式 `ret` 转移同样——转移前 rsp%16==0 正常、==8 SIGSEGV，规则在 ret 场景下同样成立 |

## 五、报告未列但同源需一并修的传播点

判定过程中扫出的、报告未点名但属同一错误的散布点。只改报告点名的位置，同一错误会留在别处，
且 gateway 会把旧规则注回工作流。

| 主题 | 报告未列的位置 |
|---|---|
| rizin 的 `apt install` | 报告点名 4 处，实际 6 处：另含 `re-deobfuscate/SKILL.md:31`、`re-unpack-advanced/SKILL.md:41` |
| binwalk 安装说明 | 报告点名 5 处，另含 `re-packer-id/SKILL.md:44`、`re-shellcode/SKILL.md:43-44` |
| QEMU 默认网络（安全基线） | `re-fw-emulate/references/commands.md:31,33,97`、`re-fw-emulate/SKILL.md:104,119,121`、`references/gotchas.md:14`。其中 `commands.md:33`「完全断网｜不加任何网络参数即可（默认 `-net none`）」最危险 |
| 「等 OEP 后转储」绝对化 | `re-analyze/references/platform-tips.md:93`、`re-loader/SKILL.md:101,106,111`、`re-crypto-keys/SKILL.md:38,61,112,120`、`re-forensics/SKILL.md:15`、`re-anti-analysis/SKILL.md:17,176,184,193`、`re-crypto-decrypt/SKILL.md:109` |
| `p7zip` 旧包名 | `re-fw-rootfs/SKILL.md:30` |
| JPEG/PNG 结束标记启发式 | `re-fw-extract/SKILL.md:89` 的 `rfind(IEND/FFD9)` |
| 分组对齐判密码类型 | `re-crypto-id/SKILL.md:136` 的「16/24/32 对齐」 |
| zipalign 顺序 | `re-apk/references/commands.md:38,66-67`、`re-apk/SKILL.md:93` |
| IDA 9.x 无 64 后缀 | `re-plugin-dev/SKILL.md:73,107`、`re-deobfuscate/SKILL.md:26`、`re-license/SKILL.md:32` |

另有两处**报告未提、判定时顺带实测出**的错误，一并纳入修复：

| 位置 | 问题 | 实测依据 |
|---|---|---|
| `re-arm/SKILL.md` 变体误选判据 | 报告只说「32 位指令不是幻觉」，未给真判据 | armv6m 下 `movw/movt` 报 `instruction requires: armv8m.base`、`clz/udiv` 报 `thumb2`；armv7m 下正常——这才是变体选错的判据 |
| `re-mips/SKILL.md` R6 描述 | 「MIPS32r6 起取消延迟槽」本身不准 | R6 仍保留 BEQ/BNE/JALR/JR 的延迟槽，删的是 branch-likely、新增的是 compact 无延迟槽形式（BEQC/BNEC/BC/BALC/JIC/JIALC） |

## 六、逐条判定

以下按判定类别分组：采纳 → 部分成立 → 驳回 → 已修。每条给出位置、报告主张、依据与改法。

### F005/F059/F071/F116 — 采纳（报告成立）

- 位置: `.claude/skills/re-fw-extract/SKILL.md:26（上下文 25/27/29）、.claude/skills/re-mips/SKILL.md:36、.claude/skills/re-arm/SKILL.md:42、.claude/skills/re-rtos/SKILL.md:103、.claude/skills/re-console/SKILL.md:71`
- 报告主张: `pip install binwalk` 被写成「跨平台、版本新、签名库全，推荐」，已非 upstream 当前安装渠道
- 依据: PyPI binwalk latest = 2.1.0（2015-01-22，无 requires-python）；GitHub releases 最新为 Binwalk v3.1.0（Rust 重写）；README 安装入口 = Docker / Cargo / 源码
- 改法: 删去「pip（跨平台、版本新、签名库全，推荐）」，把 pip 与发行版包一并标为 legacy v2（Debian trixie 2.4.3、bookworm 2.3.4 均为 2.x）并要求先 `binwalk --version` 确认 major；v3 走官方 README 的 Docker/Cargo/源码。re-mips/re-arm/re-rtos/re-console 四处只留「同 [[re-fw-extract]]」不带 pip 推荐。CLI 示例无需改：v3.1.0 tag 与 master 的 `src/cliparser.rs` 均保留 `-e/--extract`、`-M/--matryoshka`、`-E/--entropy`（`--carve` 是 master 新增，仓库未使用）

### F024 — 采纳（报告成立）

- 位置: `.claude/skills/re-format-pe/SKILL.md:125`
- 报告主张: 经典(Delphi 7 及以前 Win32) VMT 负偏移四处错位，64 位值随之错
- 依据: Embarcadero《Delphi Language Guide》VMT 表 Win32 列 TypeInfo -72/MethodTable -64/ClassName -56/InstanceSize -52（Win64 -168/-152/-136/-128），字段序与 undelphi 0.2.0 解析器一致；扣掉 D2009 给 TObject 新增的 3 个虚方法（Win32 3×4）得经典值 -60/-52/-44/-40。仓库四值 -0x20/-0x24/-0x18/-0x10 全落进 TObject 虚方法槽区（-0x20 实为 SafeCallException、-0x24 实为 vmtParent）
- 改法: 改为 TypeInfo -0x3C、published 方法表 -0x34、类名字符串指针 -0x2C、实例大小 -0x28（可附 vmtSelfPtr -0x4C、vmtParent -0x24）；删掉"64 位约 -0x40"的推演，改按官方 Win64 值（vmtClassName -0x88、vmtInstanceSize -0x80）；"现代布局"分界改为 Delphi 2009（XE2 只引入 Win64，未改负偏移）

### F025 — 采纳（报告成立）

- 位置: `.claude/skills/re-ios/references/gotchas.md:35`
- 报告主张: 越狱矩阵把 unc0ver 写成「iOS 14-15 系」，版本范围错误且陈旧
- 依据: appledb.dev/jailbreak/unc0ver 与 onejailbreak 均为 unc0ver 支持 **iOS 11.0-14.8**，末版 **v8.0.2（2022-07-11）**；iOS 15 由 Dopamine/Fugu15 覆盖，unc0ver 不支持任何 iOS 15
- 改法: `unc0ver（iOS 14-15 系）` → `unc0ver（iOS 11.0-14.8，A7-A14 分档；末版 v8.0.2/2022 已停更）`。同行的 palera1n「checkm8 设备全系」与 Dopamine「iOS 15-16 系」可保留（Dopamine 覆盖 15.0-16.6.1，与「15-16 系」相符）

### F037/F049/F061/F079/F101 — 采纳（报告成立）

- 位置: `.claude/skills/re-ghidra/SKILL.md:30`
- 报告主张: Ghidra 最新正式版已是 12.1.4，仓库仍写「2026-08 最新 12.1.3」
- 依据: github.com/NationalSecurityAgency/ghidra/releases.atom 首条 Ghidra 12.1.4（2026-09-21），次条 12.1.3（2026-08-18）
- 改法: 删掉 `2026-08 最新 12.1.3` 这类易腐化写法，改为「12.x 为当前主线；安装时以官方 Releases 的 Latest 为准（本文档核验基线 12.1.4，2026-09）」。JDK 描述保持不变：12.1.4 发布包 README 仍要求 64-bit JDK 21；master 构建为 JDK 25 + Gradle 9.1.0+（已实测，与现有表述一致）

### F038 — 采纳（报告成立）

- 位置: `.claude/skills/re-cpp-abi/SKILL.md:81（坑项 :103 同）`
- 报告主张: "lambda 无 RTTI"绝对化，且用 _ZTI 缺失反推 lambda 不可靠
- 依据: 实测 g++：`auto f1=[](int){...};` 且 `typeid(f1)` 时 nm 出现 `_ZTIN2f1MUliE_E`（"typeinfo for f1::{lambda(int)#1}"）；同一 lambda 不用 typeid 时 _ZTI 计数为 0——说明缺失只是常见产物、不是类型性质，"步骤 2 缺失 ⇒ lambda"的反推无效
- 改法: 两处统一改为：closure type 是真实匿名 class type；普通调用场景常不发射独立 RTTI，缺 _ZTI 既不能排除也不能反推 lambda；优先用 `_ZZ<作用域>ENK...`/`operator()` mangling、捕获成员布局、调用点识别；typeid 等 ODR-use 时可有对应 RTTI

### F039/F121 — 采纳（报告成立）

- 位置: `.claude/skills/re-ios/SKILL.md:54-57,96-103,116（另 .claude/skills/re-ios/references/commands.md:36,66-70、re-ios-jb/SKILL.md:126-127,132 联动）`
- 报告主张: 仍把原版 `AloneMonkey/frida-ios-dump` 当当前可用默认脱壳方案，给出 clone→pip install→dump.py 直跑路径
- 依据: 其 agent `dump.js`（master）使用 `Module.ensureInitialized`(:1)、静态 `Memory.readU8/U16/U32/U64/Pointer/readByteArray`(:27-90)、`Module.findExportByName(null,…)`(:109)、`Process.enumerateModulesSync`(:159)；本机 Frida **17.16.4** 实测这四类 API 全为 `undefined`（`Module.findGlobalExportByName`/`getGlobalExportByName` 为 function，实例方法 `Process.getModuleByName(x).findExportByName` 为 function）。仓库自身 `.claude/skills/re-frida/SKILL.md:147` 已载明 Frida 17 移除静态 Module 查找/枚举 API，两条知识自相矛盾
- 改法: 把该工具降为 legacy/historical（注明需旧 Frida 或自行移植 API），默认流程改为「按目标 iOS/越狱版本选已适配 Frida 17 的维护实现」，执行前先核对 `frida --version`、frida-server 与 dumper 的兼容矩阵；能力描述从「frida-ios-dump——App Store 加密应用脱壳」改为「iOS FairPlay 解密/脱壳（backend 按环境选择）」，可并列记录 mremap_encrypted 路线。commands.md 序列 3 与 re-ios-jb 的两处引用同步。未独立核验的次项：报告中「bagbak 已把 runtime dump 标为 deprecated」未复验，不影响结论

### F040 — 采纳（报告成立）

- 位置: `.claude/skills/re-console/SKILL.md:33`
- 依据: GB CPU 是 Sharp SM83/LR35902，无 IX/IY、无 DD/FD/ED 前缀、无 IN/OUT，与 Z80 不兼容（Pan Docs/GBdev、Cycle-Accurate GB Doc 均警告勿称 Z80）；Ghidra 核心确无 SM83（第三方 GhidraBoy 提供 SM83 SLEIGH + Game Boy loader）——「Ghidra 无原生模块」这半句是对的
- 改法: 第 33 行改为「GB/GBC 用 Sharp SM83：与 8080/Z80 编码相近但不是 Z80 兼容变体（无 IX/IY、无 DD/FD/ED 前缀、无 IN/OUT，有自家 STOP/LDH 与 HL 自增减）；Ghidra 核心无 SM83，装 GhidraBoy 等 SM83 SLEIGH + Game Boy loader；Z80 模块仅可作人工对照，不得作为 ROM 的处理器语言」。坑 6（第 158 行）同步：近似反汇编的具体后果是指令语义分叉（同一编码在 SM83/Z80 含义不同，如 0x22/0xE8/0x10），须以模拟器实测校正

### F041 — 采纳（报告成立）

- 位置: `.claude/skills/re-arm/SKILL.md:33,90,134`
- 依据: 实测 clang --target=armv6m-none-eabi：`bl` 编码 f7ff fffe（4 字节 32 位）；dsb/dmb/isb/mrs/msr 同为 32 位（f3bf 8f4f 等）。BL 范围实测：位移 16777214 可编码、16777216 报 Relocation out of range → ±16MB，非 ±4MB。反向判据实测：同一 .s 在 armv6m 下 `movw/movt` 报 instruction requires: armv8m.base、`clz/udiv` 报 thumb2，armv7m 下正常
- 改法: 三处同改——第 33 行「Cortex-M0/M0+ 实现 Armv6-M：以 16 位 Thumb 编码为主，但含少量合法 32 位编码（BL、DMB/DSB/ISB、MRS/MSR）；必须选 v6-M 变体，只有出现 Armv6-M 之外的编码（MOVW/MOVT、CLZ、硬件除/取模）才说明变体选错」；第 90 行删「（ARMv6-M 的 16 位 BL 仅 ±4MB）」改「Thumb 态 ±16MB（BL 为 32 位编码，Armv6-M 亦然）」；第 134 行坑项改为按具体 opcode 是否属于 Armv6-M 判定，不以指令宽度判定（第 130 行 veneer 坑的「Thumb-2 ±16MB」同步去掉 Thumb-2 限定）

### F042 — 采纳（报告成立）

- 位置: `.claude/skills/re-binaryninja/SKILL.md:32、:75、.claude/skills/re-binaryninja/references/gotchas.md:8`
- 报告主张: 版本说明停在 3.x/4.x，未反映 6.0（2026-09-03）的 Extension Manager / Python 3.13 / Free 版能力变化
- 依据: binary.ninja/2026/09/03/binary-ninja-6.0-krypton.html：Plugin Manager 重构为 Extension Manager、bundled Python 升至 3.13 并首次覆盖 Linux、最低外部 Python 仍 3.10、一次性 Plugin Migration 重装依赖；Free 新增 armv8(AArch64)+ARM64 Linux 构建（binary.ninja/free 仍写 No API/plugin access、IL 受限）
- 改法: `版本差异: 3.x/4.x…` → `6.x 为当前主线`，补 6.0 迁移条目（Extension Manager 取代 Plugin Manager / 旧 `pluginmanager` 仅 shim / bundled Python 3.13、外部 >=3.10 / 升级后依赖迁移对话框）；Free 能力矩阵改 `x86 / x86_64 / armv7+Thumb2 / armv8`，仍无 API 与插件。`install_api.py` 保留（docs 仍有 Installing via the API 章节），插件目录三平台路径不变（docs 现仍列 `~/.binaryninja/plugins` 等），无需改；菜单名 `File > Manage Plugins` 改指 Extension Manager（6.x 实际菜单路径实施时以 UI 实测确认）。不写死 patch 号

### F043 — 采纳（报告成立）

- 位置: `.claude/skills/re-arm/SKILL.md:105`
- 依据: AAPCS32 原文 "Bit 0 of a code pointer indicates the target instruction set type (0 Arm, 1 Thumb)"；AAPCS64 只定义 64-bit code pointer 且 "All 64 bits ... always significant"，无 Thumb 态、无函数指针低位语义
- 改法: 该句限定为 AArch32 并移入 AAPCS32 条目：「AArch32 C++ 虚表中指向 Thumb/T32 函数的函数指针同样带 Thumb 状态位（bit0=1，解析实际地址时清 bit0）；AArch64 用 A64、无 Thumb 态，不适用此规则（另有 PAC 等平台扩展）」；AAPCS64 条目内不再出现 Thumb-bit 判据

### F044 — 采纳（报告成立）

- 位置: `.claude/skills/re-radare2/SKILL.md:27`
- 报告主张: 「Fedora 42 及更早版本用官方 release 二进制」不成立，F42 仓库有 rizin
- 依据: Fedora Bodhi: `rizin-0.7.4-8.fc42` 于 2025-03-10 入 stable（0.7.4-1.fc42 = 2024-12-31，0.7.3-3.fc42 = 2024-09-01）；packages.fedoraproject.org 现列 F43/44/45/Rawhide + EPEL 8/9/10
- 改法: 删掉硬编码 Fedora 阈值，改为「Fedora 当前受支持版本 / EPEL 8+：`dnf install rizin`；已 EOL 的 Fedora 先查发行版仓库，无包再用 Rizin 官方 release 或 `rz-pm`」，EPEL 由 8/9 补到 10。附核报告次项：Debian sid 确有 `radare2 6.1.8+ds-1`，故 `.claude/skills/re-radare2/SKILL.md:34` 的 `apt install radare2` 保留

### F046 — 采纳（报告成立）

- 位置: `.claude/skills/re-mips/SKILL.md:78,111`
- 依据: 实测 qemu-mips 跑自建 MIPS32 探针：BEQL not-taken 时延迟槽被 annul（exit=0，槽内 `li $t0,0x11` 未执行），BEQ not-taken 时执行（exit=17）；BEQL taken 走目标（exit=34）；mips32r6 下汇编 beql 报错（R6 已删 branch-likely）
- 改法: 第 78 行改「pre-R6：普通 BEQ/BNE/J/JAL 的延迟槽在 taken/not-taken 两路都执行；Branch Likely（BEQL/BNEL/BLEZL/BGTZL/BLTZL/BGEZL 及 FP likely 类）只在 taken 时执行延迟槽，not-taken 时被 annul」；第 111 行坑项把「同时计入跳转两路」限定为 non-likely 分支。另注：同句尾「MIPS32r6 起取消延迟槽（r6 代码无此问题）」本身也不准确——R6 仍保留带延迟槽的 BEQ/BNE 与 JALR/JR，只是新增无延迟槽 compact 形式（BEQC/BNEC/BC/BALC/JIC/JIALC）并删除 branch-likely；实测 -march=mips32r6 产物中 bne 之后仍跟有效指令（延迟槽），建议一并改为「R6 删除 branch-likely、新增无延迟槽 compact 分支，按 ISA revision + opcode 分类」

### F048 — 采纳（报告成立）

- 位置: `.claude/skills/re-go/SKILL.md:131（:139 为冲突项）`
- 报告主张: 「LD_PRELOAD 对 Go 程序无效」被绝对化，cgo/动态库路径仍可插桩
- 依据: 本机 go1.27.1 实测——CGO_ENABLED=0 产物无 PT_INTERP、`readelf -d` 报「no dynamic section」，hook `open/openat` 未命中（现象成立）；CGO_ENABLED=1 + `import "C"` 产物 `DT_NEEDED libc.so.6`，同一 hook 输出 `[HOOK] puts("hello-from-C-puts") intercepted`（绝对表述不成立）。仓库 `re-go/SKILL.md:139` 已有「cgo 混合产物」条目，与之逻辑冲突
- 改法: 标题限缩为 `LD_PRELOAD 对纯 Go syscall 路径通常无效`；对策补「先 `readelf -l/-d/-Ws`、`ldd` 判 PT_INTERP/DT_NEEDED 与 cgo 痕迹；纯 Go 走 strace/eBPF/ptrace；存在 cgo 或动态 ELF 符号时 LD_PRELOAD 仍可 interpose」。与 :139 的 cgo 条目互引，消除冲突

### F051 — 采纳（报告成立）

- 位置: `.claude/skills/re-pwn/SKILL.md:106,109`
- 依据: psABI 的 va_list 有独立 reg_save_area / overflow_arg_area / gp_offset，并明示「假定所有参数都在栈上」的程序在 x86-64 不成立；实测 `printf("%1$p..%7$p")` 不传任何可变参时 %1$–%5$ 打印寄存器残留（每次运行不同），%6$/%7$ 才是调用者栈槽
- 改法: 第 109 行改为「`%N$` 是 printf 逻辑参数列表的第 N 个参数，不是第 N 个栈槽；SysV AMD64 下 format 占 RDI，前 5 个整型/指针可变参来自 RSI/RDX/RCX/R8/R9，第 6 个起才来自 overflow_arg_area；无对应实参时读到的是调用现场残留，偏移必须探测」；第 106 行注释删「即栈上第 1/2 个 8 字节」（若要保留该意思，须写成「%6$/%7$ 即调用者栈上第 1/2 个 8 字节」并移到寄存器列表之后）；示例补 marker + 全量 %p 扫描，注明 fmtstr_payload 的 offset 来自实测而非 ABI 常数

### F053 — 采纳（报告成立）

- 位置: `.claude/skills/re-dotnet/SKILL.md:45`
- 报告主张: 「mono 自 2021 年起不在官方仓库，AUR 亦无稳定 mono 包，仅 mono-git」，与当前 Arch 仓库状态不符
- 依据: 本机 `pacman -Si mono` → `Repository: extra`、`Version: 6.12.0.206-1`、`Architecture: x86_64`、Provides monodoc
- 改法: 改为 `Arch: sudo pacman -S mono`，删除「自 2021 年起不在官方仓库 / AUR 仅 mono-git」整段；仅在明确需要 upstream Git snapshot 时把 AUR `mono-git` 列为可选并注明属 AUR

### F054 — 采纳（报告成立）

- 位置: `.claude/skills/re-arm/SKILL.md:33`
- 依据: 同 F041 实测；另实测 armv6m 下 movw/movt 报 instruction requires: armv8m.base、clz/udiv 报 thumb2——这才是变体误选的真判据
- 改法: 同 F041（措辞可采用报告建议：「Armv6-M Thumb ISA 以 16 位为主但含少量合法 32 位编码；32 位≠幻觉，应按 Armv6-M 指令集合验证」）

### F055 — 采纳（报告成立）

- 位置: `.claude/skills/re-mem-forensics/SKILL.md:36`
- 报告主张: Arch 仍用旧包名 `pacman -S p7zip`
- 依据: `pacman -Si p7zip` → `error: package 'p7zip' was not found`；`pacman -Si 7zip` → `extra/7zip 26.03-1`（命令行程序仍为 `7z`，验证步骤无需改）
- 改法: `pacman -S p7zip` → `pacman -S 7zip`。同型的 `.claude/skills/re-fw-rootfs/SKILL.md:30` 需一并改（报告未列，同一错误）

### F056/F115 — 采纳（报告成立）

- 位置: `.claude/skills/re-crypto-decrypt/SKILL.md:51`
- 报告主张: 「找格式结束标记用第一个（JPEG EOI FFD9、PNG IEND），不是最后一个」不成立，不应以裸字节搜索定容器边界
- 依据: 构造实验——PNG：首个子串 `IEND` 落在 offset 78 的 tEXt chunk 载荷内，结构合法的 IEND 结尾在 104，按该规则截掉 26 字节合法数据；JPEG：首个子串 `FF D9` 落在 offset 22 的 APP1 载荷内，真实 EOI 在 63，按该规则截掉 43 字节。报告关于「entropy-coded scan 内因 FF00 stuffing 不会出现裸 FFD9」的纠正亦正确（真正失稳点是 APP/COM 等 length-delimited payload 与嵌入数据）
- 改法: 删「用第一个」启发式，改为「不要用 first/last 裸 marker 搜索定边界：PNG 从 8 字节签名起按 Length/Type/Data/CRC 遍历至结构合法且长度为 0 的 IEND（必要时验 CRC）；JPEG 从 SOI 起按 marker/segment 解析，SOS 后按 FF00 stuffing/RSTn 处理，语法位置成立的 EOI 才是结尾；裸字节搜索只能作候选定位」。`.claude/skills/re-fw-extract/SKILL.md:89` 的 `rfind(IEND/FFD9)` 同步（该处已写「第一个还是最后一个取决于…」，但同属启发式，建议一并改成结构化解析）

### F058/F070/F088 — 采纳（报告成立）

- 位置: `.claude/skills/re-tls/SKILL.md:107（:65,87,105 为上下文）`
- 报告主张: 把 TLS 1.3 的 ALPN 最终协商结果放在 ServerHello
- 依据: 本机 openssl s_server/s_client 走 TLS 1.3 + `-alpn h2` + `-msg`——ServerHello 段内 `00 10`（ALPN 扩展类型）出现 0 次、`68 32`（"h2"）0 次；EncryptedExtensions 报文为 `08 00 00 0b 00 09 00 10 00 05 00 03 02 68 32`，即 ext 0x0010 = ALPN，协议 "h2"。RFC 8446 扩展位置表为 `ALPN
- 改法: :107 注释改为「ClientHello 的 ALPN 是客户端候选列表；TLS ≤1.2 的最终选择在 ServerHello，TLS 1.3 的最终选择在 EncryptedExtensions（握手密钥/keylog 解密后可见）」；步骤 4 流程行区分「offered ALPN」与「negotiated ALPN」，不要把 `tls.handshake.extensions_alpn_str` 的输出直接当最终协议（:87 已对 TLS 1.3 Certificate 作过同类提示，原则一致）

### F060 — 采纳（报告成立）

- 位置: `.claude/skills/re-proto-rev/SKILL.md:64-78,102,104（步骤 5 的时序推演同受影响）`
- 报告主张: 整个流程把 TCP segment payload 当应用层 message，缺 TCP 流重组
- 依据: 代码侧已确认——步骤 2 `Counter()` 对 `bytes(p[TCP].payload)[:8]` 逐包计数、步骤 3 用「载荷实际长度」、步骤 4 逐包 `C2(load)`、步骤 5 按包序重建状态机，全库无 重组/reassemble/TCPSession/follow-stream 步骤（grep 仅命中 :131 的 IRC 应用层分片坑）。语义侧：RFC 9293 §3.7 定义 TCP 为字节流、不保留应用层消息边界。实测：3 次连续 `send()`（无间隔）在接收端合并为 1 个 chunk（`MSG1-payload-AMSG2-payload-BMSG3-payload-C`），间隔 20 ms 才是 3 个 chunk——说明「一次 write 恰好一段」只是时序巧合；反向（一条消息跨多段）在 MSS 限制下同理成立，未做抓包实证（本机 `tshark -i lo` 报 `dumpcap: Permission denied`）
- 改法: 在步骤 1 与步骤 2 之间加入强制阶段「TCP 流重建 → 应用层 framing」：按连接与方向依 SEQ 去重、处理重传/重叠/乱序、记录 capture gap，再在字节流上推断 framing（magic+length / 分隔符 / 固定长度 / TLV / 连接关闭）；`Counter(load[:8])` 改为对重组流扫描候选 magic 并验证相邻 frame 满足长度约束；`C2(load)` 改为持续 buffer parser，至少支持 0/1/N 条消息对应一个 segment；Scapy 路线可用 `TCPSession` + `tcp_reassemble()`，或先用 tshark follow-stream。UDP 等 datagram 传输单独说明（datagram 保留消息边界，不套 TCP 模型）

### F062/F086 — 采纳（报告成立）

- 位置: `.claude/skills/re-angr/SKILL.md:27（26/28/123 为上下文）、.claude/skills/re-angr/references/gotchas.md:5`
- 报告主张: 仍把 9.3.x 当最新主线，`pip install angr` 实际已解析到 10.x
- 依据: PyPI angr latest 10.0.1（2026-09-30 上传；10.0.0 = 2026-09-17），requires_python >=3.12；9.3.0–9.3.4 亦为 >=3.12
- 改法: `（最新 9.3.x 线）` → `（当前主线 10.x；Python >=3.12）`，不写死 patch。`Python 3.11 及以下 → angr<9.3` 分支保留（9.2.209 及以前 >=3.10、9.2.214+ 已 >=3.12，gotchas 的「按目标版本核验 requires-python」照留）。是否 pin `angr<10` 取决于本库有没有跑完 10.x 回归，不要在正文默认断言 10.x 兼容

### F063 — 采纳（报告成立）

- 位置: `.claude/skills/re-fw-emulate/references/gotchas.md:27（:28,29 同组）、.claude/skills/re-fw-emulate/references/commands.md:31,33,97、.claude/skills/re-fw-emulate/SKILL.md:104,119,121`
- 报告主张: 「qemu-user 无网络；qemu-system 默认 -net none」与 QEMU 实际默认行为相反
- 依据: 本机 QEMU **11.1.1**：不带任何网络参数启动后 `info network` 输出 `hub0port1: #net140: index=0,type=user,net=10.0.2.0,restrict=off` 与 `hub0port0: e1000.0: index=0,type=nic,model=e1000,macaddr=...`（默认即自动建 NIC + user/SLIRP backend）；加 `-nic none` 后无任何网络条目。qemu-user 侧：`qemu-aarch64` 运行 arm64 静态 Go 程序，`dial OK to 127.0.0.1:45671`，宿主监听端收到 `hi-from-qemu-user`——user-mode 只是 syscall 转发，不是网络沙箱
- 改法: 安全基线反转——`qemu-system 未显式声明网络时会自动创建默认 NIC + user backend（restrict=off）；分析不可信固件必须显式 -nic none`；需要受控网络时 `-nic user,restrict=on` 或隔离 TAP/namespace。**`commands.md:33` 的「完全断网

### F064 — 采纳（报告成立）

- 位置: `.claude/skills/re-patching/SKILL.md:108`
- 报告主张: `pesign -d 删除签名` 错误
- 依据: Debian pesign(1) 手册——`-d digest`/`--digest-type digest`: "Use the cryptographic digest with --hash (default: sha256)"，需带参数且只作用于 --hash；`-r`/`--remove-signature`: "Remove signature" 才是删除；`-S`/`--show-signature` 显示签名信息；`-u`/`--signature-number number` 供 remove/export/show 指定第 N 个签名
- 改法: 改为 `pesign -S -i signed.exe` 先查签名数 → `pesign -r [-u N] -i in.exe -o out.exe`；并把「移除 WIN_CERTIFICATE 证书表」与「仅清 PE Security 目录项 offset+size」明确区分为两种不同操作，保留原文件、输出新文件

### F065 — 采纳（报告成立）

- 位置: `.claude/skills/re-frida-script-author/SKILL.md:25-27`
- 报告主张: apt/pacman/choco 不是 frida-tools 的等价官方安装方式
- 依据: frida 官方 Installation 页（frida.re/docs/installation/）只给 `pip install frida-tools` 与 GitHub Releases，无 apt/pacman/choco；Ubuntu launchpad getPublishedSources(source_name=frida-tools)=0 条；Arch 官方库 name=frida 命中 0（同接口 radare2 命中 extra 6.2.0，接口有效）；chocolatey.org/packages/frida 与 /packages/frida-tools 均 HTTP 404（对照 radare2、windbg 均 200）——`choco install frida` 指向不存在的包
- 改法: 只保留 `python -m pip install -U frida-tools`（建议隔离 venv 或 pipx）；第三方渠道若保留须标注「非 upstream 渠道，安装前核验版本与维护状态」，不与 pip 并列

### F067 — 采纳（报告成立）

- 位置: `.claude/skills/re-unpack-simple/SKILL.md:101`
- 报告主张: 把 CheckSum 与 SizeOfImage/NumberOfSections 并列成普通用户态 PE dump 的加载失败原因
- 依据: Microsoft IMAGE_OPTIONAL_HEADER.CheckSum 官方原文："The following files are validated at load time: all drivers, any DLL loaded at boot time, and any DLL loaded into a critical system process."——普通用户态 EXE/DLL 无加载期校验
- 改法: 原因删去 CheckSum，只留 SizeOfImage/NumberOfSections 并补 SizeOfHeaders、节表 RVA/raw 范围与对齐；CheckSum 另起一句"普通用户态非加载条件，仅驱动/boot DLL/关键进程 DLL 需重算"

### F068 — 采纳（报告成立）

- 位置: `.claude/skills/re-deobfuscate/SKILL.md:32,42,82`
- 报告主张: rizin 语境应推荐 rzpipe，r2pipe 属 radare2
- 依据: Rizin README(dev) 原文 "We provide a way to interact with Rizin from Python, Haskell, OCaml, Ruby, Rust, and Go languages through [rzpipe](https://github.com/rizinorg/rz-pipe)"；PyPI rzpipe 0.6.2 desc="Interact with rizin"、home=rizin.re；PyPI r2pipe 1.9.8 desc="Interact with radare2 using the #!pipe command..."
- 改法: re-deobfuscate 三处 r2pipe → `pip install rzpipe` 并链接 rizinorg/rz-pipe，示例改用 rzpipe API。全仓 r2pipe 仅这 3 处且全在 rizin 语境，无 radare2 语境误伤，无需保留分支

### F074/F094 — 采纳（报告成立）

- 位置: `.claude/skills/re-radare2/references/gotchas.md:9`
- 报告主张: 版本节奏仍写 `r2 5.9.x 维护更新`，落后一个 major generation
- 依据: radare2 releases.atom 最新 6.2.2（2026-09-06），其后 6.2.0/6.1.8/6.1.6/6.1.4/6.1.2；rizin 最新 0.9.1（2026-06-29），故 rz 一侧表述仍成立
- 改法: `r2 5.9.x 维护更新；rz 0.7/0.8/0.9 滚动演进` → `radare2 当前主线 6.2.x；Rizin 当前主线 0.9.x`（不写死 patch），并补「2021 年分叉后独立演进，命令/API/插件 ABI 不按共同版本经验推断，执行前 `r2 -v` / `rizin -v` 核验」

### F075/F092 — 采纳（报告成立）

- 位置: `.claude/skills/re-ebpf/SKILL.md:114（:20,94 同源）`
- 报告主张: 「helper 调用号随内核版本漂移」「helper 号是 bpf_func_id 枚举序号，随内核版本增删漂移」不成立
- 依据: 本机 `/usr/include/linux/bpf.h`（内核 7.2 头文件）的 `___BPF_FUNC_MAPPER` 逐项显式编号——`FN(unspec, 0)`、`FN(map_lookup_elem, 1)`、`FN(map_update_elem, 2)`、`FN(map_delete_elem, 3)`、`FN(tail_call, 12)`…共 214 项，数值是显式指定而非 enum 位置序号，正是为保证 backport 场景下 ID 可移植
- 改法: 整条改为「helper ID 是 Linux BPF UAPI 的稳定编号，已有 BPF_FUNC_* 数值不随内核版本重新编号；版本差异影响的是 helper 是否存在、是否允许用于特定 prog_type/context，以及语义是否扩展。旧 bpftool 显示 `call unknown#N` 是它的名称表不认识较新 ID，不能反推 ID→名称漂移。解析按 UAPI 固定 ID 映射，可调用性用 `bpftool feature probe` + 目标内核确认；kfunc 不属于该稳定 ABI」。标题改「helper 集合/可用性随内核版本演进，ID 本身稳定」；:20「调用号…随版本漂移」与 :94「按运行内核版本查表」同步

### F076 — 采纳（报告成立）

- 位置: `.claude/skills/re-arm/SKILL.md:105`
- 依据: 同 F043（AAPCS64 无 Thumb 态，A64 无函数指针 bit0 状态语义）
- 改法: 同 F043

### F077 — 采纳（报告成立）

- 位置: `.claude/skills/re-frida/SKILL.md:31,146`
- 报告主张: 「版本必须完全一致」过度收紧，实为 major 一致
- 依据: 本机 frida 17.16.4 的 _frida.abi3.so 内嵌官方错误串 "Unable to communicate with remote frida-server; please ensure that major versions match and that the remote Frida has the feature you are trying to use"——官方自述判据即 major 一致 + 功能存在，非精确版本一致
- 改法: 改为「client 与 frida-server 至少须同 major；为避免 feature/API 差异推荐使用完全相同且最新的版本；报 ProtocolError 时先查 major mismatch，再查目标功能是否被对应版本支持」

### F081 — 采纳（报告成立）

- 位置: `.claude/skills/re-go/SKILL.md:134（同文另见 docs/superpowers/plans/2026-08-18-experience-absorption.md，属冻结存档不回改）`
- 报告主张: 把 `crypto/cipher.NewGCM` 第一个参数当 AES 密钥
- 依据: 本机 `go doc crypto/cipher.NewGCM` → `func NewGCM(cipher Block) (AEAD, error)`（"returns the given 128-bit block cipher wrapped in Galois Counter Mode"）；`go doc crypto/aes.NewCipher` → `func NewCipher(key []byte) (cipher.Block, error)`（key 必须 16/24/32 字节）
- 改法: 该条改为「跟踪 `crypto/aes.NewCipher` 的 key 参数来源，回溯拼接点；若先定位到 `crypto/cipher.NewGCM` / `NewGCMWithNonceSize` / `NewGCMWithTagSize`（及 `NewGCMWithRandomNonce`），其参数是 `cipher.Block` 不是密钥，需继续回溯该 Block 到 `aes.NewCipher` 再取 key」

### F082 — 采纳（报告成立）

- 位置: `.claude/skills/re-unpack-simple/SKILL.md:101`（与 F067 同条重复）
- 报告主张: 同上
- 依据: 同上（MS 官方文档；"头三字段"应拆开表述）
- 改法: 同 F067

### F083 — 采纳（报告成立）

- 位置: `re-ida/SKILL.md:14,27,28,46,79,116｜re-ida/references/commands.md:27,28,29,30,61｜re-plugin-dev/SKILL.md:73,107｜re-deobfuscate/SKILL.md:26｜re-license/SKILL.md:32（共 15 处 / 5 文件）`
- 报告主张: IDA 9.x 已移除 64 后缀，ida64/idat64 命令不存在
- 依据: 本机 IDA 9.4 安装目录（58 个顶层条目）顶层可执行文件仅 hv/ida/idapyswitch/idat/lc/lsadm/picture_decoder/upg32，`ls
- 改法: 以 IDA 9.x 为基线统一 `idat -A -S"script.py" sample`、验证用 `idat --help`，删除「idat=32 位 / idat64=64 位」表述；如需兼容旧版加一行版本分支（IDA<=8.x 才用 ida/idat 的 64 后缀形态）

### F084 — 采纳（报告成立）

- 位置: `.claude/skills/re-cpp-abi/SKILL.md:55`
- 报告主张: typeinfo 布局硬编码"前 8 字节 vptr、+8 类名"只对 64 位成立
- 依据: clang++ -c 实测 i386/armv7 `_ZTI1A` 大小 8，重定位显示 +0→`_ZTVN10__cxxabiv117__class_type_infoE(+8)`、+4→`_ZTS1A`；x86-64 同结构大小 16（+0/+8）。同技能 :66 已按 32/64 分列 vtable 前缀，属内部不一致
- 改法: 改为"typeinfo 起始为 vptr，下一 pointer-sized 槽为 __type_name；64 位通常 +0/+8、32 位 +0/+4；解析前先确定 ELF class/指针宽度，__si_class_type_info/__vmi_class_type_info 同样按目标 ABI 对齐与字段宽度解析"

### F085 — 采纳（报告成立）

- 位置: `.claude/skills/re-format-elf/SKILL.md:69`
- 报告主张: 步骤标题把 .fini_array 也标成"main 之前执行"
- 依据: 实测 constructor/destructor 程序输出 `[ctor][main][dtor B][dtor A]`——析构在退出阶段执行且按 .fini_array 逆序；同技能 :128 坑项已正确写"退出清理阶段"，文内自相矛盾
- 改法: 标题改"初始化与终止回调（.init_array / .fini_array）"，正文分写：.init_array→启动初始化、数组正序；.fini_array→退出/dlclose 清理、数组逆序

### F087 — 采纳（报告成立）

- 位置: `.claude/skills/re-arm/SKILL.md:105`
- 依据: 同 F043；该文件第 88 行已正确限定「Thumb 函数地址 LSB=1」，问题仅在第 105 行的跨架构泛化
- 改法: 同 F043，另可把「Thumb 函数边界」章节标题明确为「AArch32 Thumb/T32 函数边界」

### F089/F103 — 采纳（报告成立）

- 位置: `.claude/skills/re-apk/references/gotchas.md:19（:36 同组）、.claude/skills/re-apk/references/commands.md:38,66-67、.claude/skills/re-apk/SKILL.md:93`
- 报告主张: 「v1 签名需要 zipalign，v2/v3 不需要」「apksigner 默认 v1+v2」写反/不成立
- 依据: 官方 zipalign 文档原文「If you use `apksigner`, `zipalign` must be used **before** the APK file has been signed. If you sign your APK using `apksigner` and make further changes to the APK, its signature is invalidated」；`apksigner sign --help` 对 v1/v2/v3 三项均写「enabled based on min and max SDK version」（非固定 v1+v2）。实测（apksigner 0.9）：`--min-sdk-version 24` 签名后 verify 得 v1=false / v2=true / v3=true；签名后再 `zipalign -f 4` → `DOES NOT VERIFY`、`ERROR: ... indicates the APK is signed using APK Signature Scheme v2 but no such signature was found. Signature stripped?`（v3 同）
- 改法: gotchas.md:19 整条重写为「zipalign 与签名方案是正交要求：用 apksigner 时必须先 zipalign 后签名，签名后不得再修改 APK（v2/v3 保护 ZIP 元数据，签后对齐即失效）；jarsigner 顺序相反但已不推荐；实际启用的 scheme 由 apksigner 依 minSdk/maxSdk 决定」。commands.md:38 删「v2/v3 无需 zipalign」，:66 的重打包路径补 `zipalign -P 16 -f -v 4`（含未压缩 .so 时按官方要求做 16 KiB 页对齐）再 `apksigner sign`，并补 `zipalign -c -P 16 -v 4` 校验

### F091 — 采纳（报告成立）

- 位置: `.claude/skills/re-format-macho/SKILL.md:130`
- 报告主张: "64 位下 LC 最小 16 字节"不是规范规则
- 依据: loader.h:240 "The cmdsize for 32-bit architectures MUST be a multiple of 4 bytes and for 64-bit architectures MUST be a multiple of 8 bytes"，load_command 仅 cmd+cmdsize=8B；XNU bsd/kern/mach_loader.c:1358 只查 `lcp->cmdsize < sizeof(struct load_command)`(=8)；dyld common/MachOFile.cpp:472 同样 `cmdsize < 8`（%4 检查处带 8 字节对齐 FIXME）。8 字节 LC 头部规范上合法，无 16 字节下界
- 改法: 改为"所有 LC 至少 8 字节（load_command 头）；64 位 cmdsize 须为 8 的倍数、32 位为 4 的倍数；再按具体 cmd 校验其结构最小尺寸与尾随 section/字符串，累计不超 sizeofcmds"

### F093 — 采纳（报告成立）

- 位置: `.claude/skills/re-ai-model/SKILL.md:35`
- 报告主张: ONNX 版本说明停留 1.22，当前已是 1.23
- 依据: PyPI onnx latest 1.23.1（2026-09-29），requires_python >=3.10（1.23.0 = 2026-09-18）；仓库的 Python 下限 3.10 仍正确
- 改法: 去掉写死 minor，改为「当前 onnx 要求 Python >=3.10；具体版本以 PyPI Requires-Python 为准」；若需记录格式侧基线，另写 IR/opset 而非工具版本号

### F097 — 采纳（报告成立）

- 位置: `.claude/skills/re-format-elf/SKILL.md:92`
- 报告主张: DT_SYMENT 写死 24 字节对 ELF32 错
- 依据: /usr/include/elf.h Elf32_Sym=4+4+4+1+1+2=16B、Elf64_Sym=24B；实测 ld.lld 造的 i386 .so 与 PIE `readelf -d` 均 SYMENT=16，x86-64 为 24
- 改法: 改为"按 DT_SYMENT 给出的 entry size 遍历；标准 ELF32 的 Elf32_Sym 为 16 字节、ELF64 为 24 字节；应读取并校验 DT_SYMENT，勿硬编码 24"

### F098 — 采纳（报告成立）

- 位置: `.claude/skills/re-riscv/SKILL.md:44`
- 依据: Debian 包文件列表：binutils-riscv64-linux-gnu 提供 /usr/bin/riscv64-linux-gnu-objdump 等 16 个 riscv64-linux-gnu- 前缀命令；binutils-riscv64-unknown-elf 是独立包（bullseye–sid 均有）
- 改法: 第 44 行按安装项一一对应拆开——Debian/Ubuntu 装 binutils-riscv64-linux-gnu → 验证 riscv64-linux-gnu-objdump --version；需要裸机 triplet 时单列 binutils-riscv64-unknown-elf → riscv64-unknown-elf-objdump --version；Arch/brew 维持 unknown-elf，Fedora 维持 linux-gnu

### F099 — 采纳（报告成立）

- 位置: `.claude/skills/re-frida/SKILL.md:43`
- 报告主张: Objection 已要求 Python>=3.10，技能未注明
- 依据: PyPI objection 1.12.5 wheel METADATA `Requires-Python: >=3.10`（依赖 click>=8.2.0、frida>=16.0.0、frida-tools>=10.0.0）
- 改法: 写 `Python >=3.10: pip install -U objection`，建议另建 3.10+ venv；不要与 frida 的 Python 下限（frida 17.19.0 requires_python >=3.7）合并描述

### F100 — 采纳（报告成立）

- 位置: `.claude/skills/re-arm/SKILL.md:90`
- 依据: 同 F041 实测：armv6m 的 bl 是 32 位编码（f7ff fffe），范围 ±16MB（16777214 可编码、16777216 越界）
- 改法: 删除「（ARMv6-M 的 16 位 BL 仅 ±4MB）」，改「Thumb BL 为 32 位编码、±16MB；Armv6-M 虽无完整 Thumb-2 仍支持 BL；实际可达范围按具体编码/重定位（如 R_ARM_THM_CALL）判定，超距由链接器插 veneer」

### F102 — 采纳（报告成立）

- 位置: `.claude/skills/re-format-macho/SKILL.md:84`
- 报告主张: LC_DYLD_INFO(_ONLY) 漏 weak_bind，应为 5 组
- 依据: Apple loader.h 的 dyld_info_command 为 rebase/bind/weak_bind/lazy_bind/export 五组 off+size（8+5×8=48，恰与"48 字节"自洽）；weak_bind 有独立语义（弱符号合并，晚于普通 bind 处理），非别名
- 改法: 改为"五组：rebase、bind、weak_bind、lazy_bind、export，各带 offset+size，共 48 字节"，并注明 weak_bind 不得并入 bind

### F104 — 采纳（报告成立）

- 位置: `.claude/skills/re-crypto-id/SKILL.md:99-100（:136 同源）`
- 报告主张: 用「密文是否按分组大小对齐」区分分组密码与流密码不成立
- 依据: 本机 openssl，37 字节明文：`aes-128-ctr`/`aes-128-ofb`/`aes-128-cfb` 密文均 **37 字节**（与明文等长），`aes-128-cbc`/`aes-128-ecb` 为 48 字节（padding）。AES-CTR/AES-OFB 底层仍是 128-bit 分组密码，按 :100 的规则会被误分到「流密码（RC4/XOR/ChaCha）」一侧。NIST SP 800-38A 中 OFB/CTR 末块允许 `u` bit，CFB 粒度是 segment size `s`
- 改法: 两行改为「数据长度只能辅助判断 mode，不能区分 primitive：ECB/传统 CBC 常见整块或 padding 扩长；CTR/OFB/CFB 等基于分组密码的 mode 可产生与明文等长的任意长度密文；CBC-CTS 亦可避免 padding 扩长——长度任意不能推出 RC4/XOR/ChaCha。识别须结合常量表/轮函数/key schedule/IV-nonce-counter 数据流」。删除「16/32 字节对齐 → AES 最可能」启发式，并写明 AES block size 恒为 128 bit（16 字节），192/256 是 key size；:136 的「分组长度（16/24/32 对齐）」同属此误，一并改

### F105 — 采纳（报告成立）

- 位置: `.claude/skills/re-triage/SKILL.md:113`
- 报告主张: "ET_DYN=PIE"不成立
- 依据: 本机实测 .so 显示 `Type: DYN (Shared object file)`，-pie 可执行文件显示 `DYN (Position-Independent Executable file)`——现代 readelf 依 dynamic 区 DF_1_PIE 区分，e_type 无法区分共享库与 PIE
- 改法: 注释改"ET_EXEC 通常为非 PIE；ET_DYN 可能是 PIE 或共享对象"，并补一行 `readelf -d sample

### F106 — 采纳（报告成立）

- 位置: `.claude/skills/re-gdb/SKILL.md:28-40｜re-pwn/SKILL.md:43`
- 报告主张: pwndbg 的 git clone+setup.sh 已非官方主路径
- 依据: pwndbg 官方 setup 页把仓内那段 `git clone https://github.com/pwndbg/pwndbg; cd pwndbg; ./setup.sh` 明确排在 "Legacy install method" 标题下（"We still support a setup.sh script, but note it requires root as it calls sudo internally"）；主路径 Install Script 标注 "(recommended)"：`curl --proto '=https' --tlsv1.2 -LsSf 'https://install.pwndbg.re'
- 改法: portable installer 升为默认，git clone+setup.sh 降为 legacy/开发用；标题去掉「（二选一，装到 ~/.gdbinit）」（已不能覆盖 portable 发行与 pwndbg-lldb）；re-pwn:43 同步

### F107 — 采纳（报告成立）

- 位置: `.claude/skills/re-format-pe/SKILL.md:183`
- 报告主张: 由"IAT 槽无 .text 引用"推出"实际走 LoadLibrary+GetProcAddress"不成立
- 依据: PE 规范：导入目录表"contains address information that is used to resolve fixup references to the entry points within a DLL image"（loader 解析）；GetProcAddress 官方定义为"从指定 DLL 导出中取址"的独立机制，且纯动态解析的 API 通常根本不进导入表——无 xref 推不出机制改变
- 改法: 改为"未引用 import 检测：导入表中有符号但当前 CFG/.text 扫描未见引用，只能作 unused/间接引用候选；继续查数据引用、间接调用与反汇编覆盖。动态解析须由 LoadLibrary*/GetModuleHandle*+GetProcAddress、Ldr* 原生 API、PEB/导出遍历、API hash 等独立证据确认，不得由无 xref 反推"，并删"静态 IAT 分析结论作废"

### F109 — 采纳（报告成立）

- 位置: `package.json:26、CLAUDE.md:9`
- 报告主张: 运行时基线 `Node >=18` 已把 EOL 运行时纳入受支持配置
- 依据: nodejs/Release `schedule.json`：v18 end 2025-04-30、v20 end 2026-04-30（均 EOL）；v22 → 2027-04-30、v24 → 2028-04-30、v26 → 2029-04-30
- 改法: `engines.node` 与 CLAUDE.md 同步提升（推荐 `>=22`，或写「当前受支持 LTS」更耐久）；仓库无 `.github/workflows`，无 CI matrix 需改；`docs/superpowers/plans/2026-08-07-re-skills.md:50` 属冻结存档，按既有约定不回改。本波计划 Task 17 已列此项，基线取值与其对齐

### F112 — 采纳（报告成立）

- 位置: `.claude/skills/re-arm/SKILL.md:33`
- 依据: 同 F041（官方 Cortex-M0 datasheet 的 "Armv6-M Thumb instruction set with Thumb-2 technology" 与本机 armv6m 实测一致）
- 改法: 同 F041

### F113 — 采纳（报告成立）

- 位置: `.claude/skills/re-format-macho/SKILL.md:84`（与 F102 同条重复）
- 报告主张: 同上
- 依据: 同上（weak_bind_off/weak_bind_size 为独立成员）
- 改法: 同 F102

### F114 — 采纳（报告成立）

- 位置: `.claude/skills/re-frida/SKILL.md:164`
- 报告主张: 「frida 17+ 内置 Java bridge 已移除，需 frida-compile 打包」过度泛化
- 依据: frida.re/docs/bridges/ 原文 "Starting with Frida 17.0.0, bridges are no longer bundled with Frida's GumJS runtime... The Frida REPL and frida-trace do however come with all three bridges bundled, for compatibility with existing scripts"，并给出 `$ frida -p0 -l script.js` 直接可用的示例
- 改法: 改为「Frida 17 起 bridge 不再内置于底层 GumJS runtime；但 frida CLI/REPL 与 frida-trace 仍自带三个 bridge，普通 `frida -l` 脚本无需改动；仅自建 agent / 走 bindings 注入脚本时需显式 `npm install frida-java-bridge` 并 `import Java from "frida-java-bridge"`，必要时 frida-compile 打包」

### F117 — 采纳（报告成立）

- 位置: `.claude/skills/re-mips/SKILL.md:78,111`
- 依据: 同 F046 qemu-mips 实测（BEQL not-taken → 槽被 annul；BEQ not-taken → 槽执行）
- 改法: 同 F046

### F119 — 采纳（报告成立）

- 位置: `.claude/skills/re-variant/SKILL.md:35、.claude/skills/re-patching/SKILL.md:38、.claude/skills/re-license/SKILL.md:32、.claude/skills/re-imports/SKILL.md:37、.claude/skills/re-deobfuscate/SKILL.md:31、.claude/skills/re-unpack-advanced/SKILL.md:41（报告未列，同型，建议一并）`
- 报告主张: 把 `apt install rizin` 当 Debian/Ubuntu 通用安装方式
- 依据: packages.debian.org 与 packages.ubuntu.com 搜 rizin 均返回「no results」，sources.debian.org exact=null；`.claude/skills/re-radare2/SKILL.md:28` 已正确写明「Debian 仓库无 rizin 包」
- 改法: 六处统一改为引用 [[re-radare2]] 安装矩阵，删无条件 `apt install rizin`；Debian/Ubuntu 走官方 release / `rz-pm`（Kali 可用 apt，属其自有仓库，需注明前提）；`re-imports:37` 的「Debian 13+ / Ubuntu 24.04+」是伪版本门槛，一并删除。各技能不再复制发行版命令

### F120 — 采纳（报告成立）

- 位置: `.claude/skills/re-android-native/SKILL.md:103、references/probes.md:3,7,14,55,60`
- 报告主张: 把 `JNIEnv` 函数表里 `RegisterNatives` 的槽位描述成随 jni.h 声明序/NDK/ART 版本漂移
- 依据: 解析 6 份头文件的 `JNINativeInterface_` 声明序：JDK 8/11/17/27、GraalVM 21、Android NDK 30 结果完全一致——`RegisterNatives` = **index 215**、`UnregisterNatives` = 216、`NewStringUTF` = 167、`GetJavaVM` = 219；表项数 233（JDK8/NDK30）→236（JDK27），新增项只追加在尾部，正是固定 ABI 的维护方式。仓库自身 `references/experience.md:7` 已经写死「`RegisterNatives`=0x6b8（槽215）」「`NewStringUTF`=0x538（槽167）」（64 位下 215×8=0x6B8、167×8=0x538，数值正确），与 probes.md 的「槽号漂移」说法互相矛盾
- 改法: SKILL.md:103 改为「`RegisterNatives` 位于标准 JNIEnv function table index **215**（`UnregisterNatives` 216），这是 JNI ABI 的固定布局；实际 byte offset = index × 目标指针宽度。Android Dalvik/ART、NDK 与标准 jni.h 不应改变该 index」。probes.md:7 的「槽号随 jni.h 声明序/版本变化，禁止硬编码」删去，:55 的「布局漂移→按当前头文件重新推导」改为「运行时锚点仅用于校验 JNIEnv 有效性、检测 hook/代理函数表或非标准实现」，:3/:60 的「随 NDK/ART 版本演进」限定到真正的易变层（ABI 传参寄存器、libart 内部结构、实现细节）

### F045 — 部分成立（改措辞，不推翻原文）

- 位置: `.claude/skills/re-automotive/SKILL.md:143（:139 为对照）`
- 报告主张: 把 UDS ECU 下载流程固定写成 `0x27 → 0x34 → 0x36 → 0x37`，0x27 并非下载序列的固定第一步
- 依据: 0x34 自身的服务定义即「发起 client→server 数据传输」，ISO 定义的下载传输核心是 `0x34 → 0x36×N → 0x37`（仓库 :139 本已正确写成「0x34-0x36-0x37 固件下载流程」）；0x27 是独立服务，仅当 ECU 的 security level 配置要求时才是前置。但实车刷写中 0x27 确在 0x34 前，「明确错误」定性偏高。ISO 14229-1 原文为付费标准，未直接引用
- 改法: 拆两层保留实用信息——`UDS 标准传输核心：0x34 RequestDownload → 0x36 TransferData × N → 0x37 RequestTransferExit；实际 ECU 编程通常先按 OEM 要求进 0x10 编程会话，服务受安全级别保护时执行 0x27，擦除/完整性校验多经 OEM 定义的 0x31，过程可能需 0x3E 保活、结束可能 0x11 复位——具体序列从 ECU 行为/ODX/固件恢复，不假定固定顺序`

### F050 — 部分成立（改措辞，不推翻原文）

- 位置: `.claude/skills/re-frida/SKILL.md:45,116`
- 报告主张: `objection -g <应用> explore` 已被当前版本替换，应改 `-n ... start`
- 依据: 解包 objection 1.12.5 wheel 读 objection/console/cli.py——`--gadget/-g` 仍在（line 55，hidden=True + deprecated="Please use '-n' or '--name' instead"），`explore` 仍在（line 206，hidden + deprecated，经 ctx.invoke(start, ...) 转发，line 225）；click 8.3.3 的 deprecated 仅打告警不报错
- 改法: 改为 `objection -n <应用或Bundle ID> start`；报告「-g/explore 已被移除、会 unknown argument 在入口处失败」不成立——旧写法仍可跑，只出弃用告警。措辞写「1.12.x 起 -g/explore 已弃用（隐藏），新写作用 -n + start」，不得写成命令失效

### F057 — 部分成立（改措辞，不推翻原文）

- 位置: `.claude/skills/re-shellcode/SKILL.md:165,184`
- 依据: MS 官方 /Gd 页：/Gd 是默认（x86 自由函数 __cdecl、成员函数默认 __thiscall），只有 /Gz 才把默认改为 __stdcall——x86 半句确为过泛；但 MS x64 页自述 "uses a four-register, fast-call calling convention by default"，故「x64 默认 fastcall」不构成硬错
- 改法: 改为「32 位无唯一约定：Win32 API 常见 WINAPI/__stdcall（callee 清栈、有 RET n），程序自身默认 __cdecl、成员函数 __thiscall——按符号修饰 / 调用者栈平衡 / ECX-EDX 判定；64 位用统一 x64 ABI：前四整型/指针参数 RCX/RDX/R8/R9 + 32 字节 shadow space」（可保留「类 fastcall」的说法，但不要写成 __fastcall）

### F066 — 部分成立（改措辞，不推翻原文）

- 位置: `.claude/skills/re-memdump/SKILL.md:34`
- 报告主张: 把 Volatility 2 / Python 2 描述成正常「按需」兼容分支，未标已归档
- 依据: github.com/volatilityfoundation/volatility 页面显示「archived by the owner on May 16, 2025」，README 首句「This project is archived. See Volatility 3 for modern investigations」，Archived 状态属实；但现文已是「volatility2 旧版 Python2 按需」，并非把它写成当前主线，故「明确错误」定性偏高
- 改法: 按报告补一句即可——`Volatility 3 是唯一当前维护主线；Volatility 2 已于 2025-05-16 被 upstream 归档（只读），仅用于旧 V2-only 插件/profile 的历史镜像或结果复现，需置于隔离的 Python 2 环境，现代镜像勿作常规 fallback`。同技能的 vol2 风格描述（如 :55「相比 vol2 手选 profile 已简化」）是历史对照，无需改

### F073 — 部分成立（改措辞，不推翻原文）

- 位置: `.claude/skills/re-tee/references/gotchas.md:15(,13)`
- 依据: 通道归属本身正确（Arm「Learn the architecture」：SVC/HVC/SMC 分别目标 EL1/EL2/EL3；SCR_EL3.HCE/SMD 控制使能），该行给出的处置建议（先分通道、别把 hypervisor 调用归 TEE）也正确，故「明确错误」不成立；但同组第 13 行「x1-x17（SMC64）」缺版本限定——SMCCC 1.2 才把 SMC64 扩到入参 x1-x17 / 返回 x0-x17，1.0/1.1 仅 x0-x7
- 改法: 第 13 行补「（SMCCC ≥1.2；1.0/1.1 仅 x1-x7）」；第 15 行可补「指令由较低 EL 的调用者执行、同步异常取到 EL2/EL3；看到 smc 不能直接等价 TEE，继续按 SMCCC FID/OEN 判服务」

### F090 — 部分成立（改措辞，不推翻原文）

- 位置: `.claude/skills/re-ghidra/SKILL.md:30 + docs/audit/2026-09-13-factual-audit.md:890,989,1224`
- 报告主张: 同上，并指审计档把「当前最新正式 release」记为 12.1.3
- 依据: 12.1.4 已发布属实（同上）；但审计档三处均在 2026-09-13 的「补充」小节内，是当日快照
- 改法: 技能正文按上条改；审计档不回改历史行（仓库既有约定是追加「补充 NN」小节，本波计划同此做法），以新追加小节记录 12.1.4

### F095 — 部分成立（改措辞，不推翻原文）

- 位置: `.claude/skills/re-memdump/SKILL.md:50,57,134、references/commands.md:12,53、references/gotchas.md:20，并传播至 .claude/skills/re-analyze/references/platform-tips.md:93、.claude/skills/re-loader/SKILL.md:101,106,111、.claude/skills/re-crypto-keys/SKILL.md:38,61,112,120、.claude/skills/re-forensics/SKILL.md:15、.claude/skills/re-anti-analysis/SKILL.md:17,176,184,193、.claude/skills/re-crypto-decrypt/SKILL.md:109`
- 报告主张: 把「到 OEP」当通用转储完成条件，与 re-unpack-simple 的「第一次执行即 OEP 不成立」冲突
- 依据: 现文确为绝对式（`脱壳样本必须在进程运行到 OEP（壳解密完成）后再 dump`；platform-tips:93 `脱壳须等进程运行到 OEP 完全解密后再 dump`），而 re-memdump 的定位是通用内存转储（`用：任何需要读进程内存的任务`），把加壳专用时机写成默认规则确有不妥；但 `.claude/skills/re-unpack-simple/SKILL.md:70,104` 已要求越过 loader/多阶段/fake OEP 并「重复下断直到控制流稳定离开壳代码」，即库内「OEP」语义已含「壳已完成」，故报告所称「直接逻辑冲突」被放大。次要支持：`re-loader/SKILL.md:111` 已自行写出「太晚（已执行完毕被清理）」的生命周期视角
- 改法: 统一限定语——`转储时机由目标明文/代码的 materialization 决定：经典单层壳在真实 OEP 附近转储通常合适，但 OEP 不是通用完成判据；多阶段 loader、按需/逐页解密、虚拟化保护、反射加载、进程注入与 fake OEP 应按「写→执行转移 + 内存保护变化 + payload 头/导入恢复」定 dump 点，必要时多时点快照`。同步 platform-tips:93 与 re-loader/re-crypto-keys/re-forensics/re-anti-analysis 的「等 OEP 后」简写（否则 gateway 会把旧规则注回工作流）；`re-unpack-simple` 原文无需改，作为正例互引

### F108 — 部分成立（改措辞，不推翻原文）

- 位置: `.claude/skills/re-format-elf/SKILL.md:106`
- 报告主张: 符号出现直接等价"有 Canary"不严谨
- 依据: 报告设想的假阴性不成立——grep 为子串匹配（`printf '__stack_chk_fail_local'
- 改法: 命令保留，注释改为">0 仅为 SSP 线索（静态链接会因 libc 自带 SSP 误报；SSP 按函数施加，不代表全部函数受保护）"，必要时再抽查 canary 载入/比较序列

### F118 — 部分成立（改措辞，不推翻原文）

- 位置: `.claude/skills/re-format-elf/SKILL.md:132`
- 报告主张: "缺 PT_GNU_STACK → dlopen EINVAL"过强；workaround 应为 execstack=2 而非 1
- 依据: 实测 glibc 2.44/x86-64：把 DSO 的 PT_GNU_STACK 改成 PT_NULL 后 dlopen 仍 EINVAL——因 elf/dl-load.c:1098 缺 header 时用 DEFAULT_STACK_PROT_PERMS，x86_64/i386/arm 等为 RWX、generic(aarch64/riscv 等) 为 RW，故"缺 header=要求可执行栈"只在部分架构成立；tunable 实测 `=1` 失败、`=2` 成功，dl-tunables.list maxval=2/default=1
- 改法: 条目改为"dlopen 的 DSO 要求可执行栈而进程启动时未启用可执行栈时加载失败（cannot enable executable stack / EINVAL）；缺 PT_GNU_STACK 是否算要求取决于目标 ABI 默认栈权限（x86/x86-64/arm32 默认可执行，aarch64 等默认不可执行）"，并把 workaround 由 `glibc.rtld.execstack=1` 改为 `=2`（降低安全性，仅兼容用；正解是给目标补非 X 的 PT_GNU_STACK）

### F022 — 驳回（报告不成立）

- 位置: `.claude/skills/re-automotive/SKILL.md:119,128`
- 报告主张: 示例 `from udsoncan.client import Client, ClientConfig` + `config = ClientConfig()` 不可执行，应改 `default_client_config`
- 依据: venv 装 udsoncan 1.26.1 实跑——`ClientConfig` 是 TypedDict（`__mro__` 含 dict），`ClientConfig()` 返回 `{}` 且不抛错；`Client.refresh_config` 源码逐键补 `default_client_config`；`Client(Dummy(), request_timeout=2, config=部分配置)` 构造成功，配置键补齐至 19 个
- 改法: 不改（与既有实测驳回结论一致；本轮为独立复核，非转述）

### F034 — 驳回（报告不成立）

- 位置: `.claude/skills/re-format-macho/SKILL.md:77`
- 报告主张: LC_MAIN.entryoff 语义与入口 VA 公式写错
- 依据: Apple loader.h `entryoff; /* file (__TEXT) offset of main() */`；dyld 源码 common/MachOAnalyzer.cpp:627 `startAddress = preferredLoadAddress() + mainCmd->entryoff`；本机 ld64.lld 造的 Mach-O 实测：__TEXT.vmaddr=0x100000000、entryoff=0x330、_main=0x100000330（vmaddr+entryoff 精确命中；__TEXT.fileoff=0 故"相对文件头"与"相对 __TEXT"同值）。报告未给正确值，仓库公式与 Apple 实现一致
- 改法: 不改

### F035/F072 — 驳回（报告不成立）

- 位置: `.claude/skills/re-pwn/SKILL.md:27,28、.claude/skills/re-exploit/SKILL.md:27`
- 报告主张: pwntools 已进入 5.x 主线，4.15.0 不再是当前正式版
- 依据: PyPI pwntools latest = 4.15.0（2025-10-12，>=2.7），122 个版本中无任何 5.*；GitHub releases 最新 tag 同为 4.15.0；dev 分支 `pwnlib/version.py` = `5.0.0dev`，dev README 的「since version 5.0.0」是开发线预告而非已发行版
- 改法: 不改（与仓库既有「进入迁移窗口、暂不标过时」的判定一致）

### F036 — 驳回（报告不成立）

- 位置: `.claude/skills/re-format-elf/references/layout.md:26`
- 报告主张: 把 ET_DYN 的 e_entry 定义为"相对基址的偏移"是事实错误
- 依据: ELF gABI ch5 定义 base address = 内存地址与文件虚拟地址之差，对 executable/shared object 是同一常量，由最低 PT_LOAD p_vaddr 推出（不是"映射起始地址"）；Linux fs/binfmt_elf.c:1245 `e_entry = elf_ex->e_entry + load_bias;`——DYN 下 e_entry 就是相对 base 的值，仓库措辞与该模型一致，且从未称其为文件偏移/RVA
- 改法: 不改

### F047 — 驳回（报告不成立）

- 位置: `.claude/skills/re-format-elf/references/layout.md:26`（与 F036 同句重复）
- 报告主张: 同一句"表述不严谨/易误导"
- 依据: 同上；报告担心的非零最低 PT_LOAD.p_vaddr 场景已被 load_bias 吸收，该措辞不会产生地址偏差
- 改法: 不改

### F052 — 驳回（报告不成立）

- 位置: `.claude/skills/re-riscv/SKILL.md:76`
- 报告主张: 把带 `PT_INTERP` 的动态链接 ELF 的「进程第一条用户态指令」与主程序 `e_entry/_start` 混为一谈
- 依据: 该句本身已写「动态链接程序先经 ld.so（PT_INTERP）」，无混淆；实测 gdb starti /bin/ls 首条指令落在 ld.so（0x7ffff7fdf7e0），而其 e_entry=0x5620、ld.so 自身 entry=0x217e0；实测 riscv64 静态 ELF e_entry=0x111b4 恰等于 _start 且无 PT_INTERP（qemu-riscv64 可跑）——「入口即 e_entry=_start」对常规工具链产物成立，「从 _start 起」是分析程序本体的合理建议
- 改法: 不改

### F069 — 驳回（报告不成立）

- 位置: `.claude/skills/re-format-elf/references/layout.md:26`（重复）
- 报告主张: 同上
- 依据: 同上（gABI ch4 e_entry 定义 + ch5 base address 定义 + 内核 +load_bias）
- 改法: 不改

### F080 — 驳回（报告不成立）

- 位置: `.claude/skills/re-emulation/references/gotchas.md:7`
- 报告主张: upstream 已发布 Capstone 6 正式线，仓库仍写 5.x 当前
- 依据: PyPI capstone latest = 5.0.9（2026-05-28，>=3.8）；6.x 仅有 6.0.0a1–a11 预发行（a11 = 2026-09-21）；GitHub releases 最新同为 `6.0.0-Alpha11`，无正式 6.0.0
- 改法: 不改（无 `--pre` 时 `pip install capstone` 仍得 5.0.9，「当前 5.0.x」准确）。6.0.0 正式发行后再复核

### F110 — 驳回（报告不成立）

- 位置: `.claude/skills/re-format-elf/references/layout.md:26（重复；报告另引 :48 p_vaddr 同措辞）`
- 报告主张: 同上
- 依据: 同上；p_vaddr 行同理——段虚拟地址整体施加 load bias，与该文件措辞一致
- 改法: 不改

### F111 — 驳回（报告不成立）

- 位置: `.claude/skills/re-exploit/SKILL.md:69`
- 依据: psABI 原文即 "the stack needs to be 16 (32 or 64) byte aligned immediately before the call instruction is executed"，与仓库此句逐字对应；实测探针：`call printf` 前 rsp%16==0 正常（rc=0）、==8 触发 movaps SIGSEGV（rc=139）；ROP 式 `ret` 转移同样——转移前 rsp%16==0 正常、==8 SIGSEGV，规则在 ret 场景下同样成立
- 改法: 不改

### F006/F029 — 已修（无需判定）

- 位置: `.claude/skills/re-ai-model/SKILL.md:59`
- 报告主张: protobuf 仍写 `Python 3.8+`
- 依据: 现文已是「当前 7.x 要求 Python >=3.10，6.x 起下限已在抬升；3.8/3.9 需 pin 对应旧版本」；PyPI protobuf 7.36.2 requires >=3.10
- 改法: 不改

### F007/F030 — 已修（无需判定）

- 位置: `.claude/skills/re-blockchain/SKILL.md:37`
- 报告主张: web3.py 仍写 `7.x / Python ≥3.8`
- 依据: 现文已是「当前 8.x 要求 Python >=3.10，PyPI requires-python 为 `<4,>=3.10`——7.x 才支持 3.8」；PyPI web3 8.0.0 = `<4,>=3.10`
- 改法: 不改

### F032 — 已修（无需判定）

- 位置: `.claude/skills/re-ai-model/SKILL.md:47`
- 报告主张: torch 仍写 `Python 3.9+`
- 依据: 现文已是「当前 torch 2.x 要求 Python >=3.10…3.9 需 pin 到 2.8.x 及更早」；PyPI torch 2.14.0 >=3.10、2.8.0 >=3.9.0、2.9.0 起 >=3.10（pin 建议准确）
- 改法: 不改
