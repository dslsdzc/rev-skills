# 事实性缺陷审查记录

日期：2026-09-13
来源：批 1——外部 AI 审查清单（覆盖约几十个技能，**非 121 全量穷尽**）+ 本库逐条独立核验；批 2——独立监控（每日核对事实/技术/逻辑/命令错误）+ 本库自查补充
用途：为「增量审查机制」（TODO.md）提供 finding 与核验结论

**状态机**：open（已记录待修）→ fixed（已修）→ verified（复核通过）

**核验方法**：本库原文 grep 定位（确认审查引文与文件一致）+ 上游权威源比对（AOSP 源码 / onnx.proto / can-utils 源码 / QEMU 源码 / HF safetensors 规范 / PyPI 元数据）。只有"原文与权威源直接冲突"才记为确认；术语与措辞类问题按"是否会导致错误推理"定级。

**结论汇总**：批 1 高 11 / 中 5，批 2 高 1 / 中 4，共 21 项**全部确认，误报 0**；需澄清 2 点（见文末）。**21 项已全部修复**（状态 fixed，待复核——见文末修复记录）。

---

## 高严重度（11 项，会直接导致错误操作）

| # | 技能 | 位置 | 现状（原文） | 问题 | 修正方向 | 核验依据 |
|---|---|---|---|---|---|---|
| 1 | re-android-crypto | SKILL.md:69 | `const alias = ks.getKeyAlias(key);` | **API 不存在**。`java.security.KeyStore` 无 `getKeyAlias(Key)`（只有 `getCertificateAlias(Certificate)`，且只对证书条目有效） | hook `KeyStore.getKey(alias, …)` 时直接记录 alias；或枚举 `aliases()` 建 Key→alias 映射；或经 `SecretKeyFactory…getKeySpec(key, KeyInfo.class)` 取 `KeyInfo.getKeystoreAlias()`（AOSP 定义为 public，SDK 暴露面以官方 API 列表为准） | JDK KeyStore API + AOSP KeyInfo.java |
| 2 | re-android-crypto | SKILL.md:58, 96 | "TEE 与 StrongBox 区分需 `isStrongBoxBacked`（API 28+）" | **类搞错**。`KeyInfo` 无此方法；`isStrongBoxBacked()` 在 `KeyGenParameterSpec`/`KeyProtection.Builder` 上（生成侧） | 已生成 Key 的判定：API 31+ 用 `KeyInfo.getSecurityLevel()`（`SECURITY_LEVEL_STRONGBOX`/`TRUSTED_ENVIRONMENT`/`SOFTWARE`）；API 23–30 只能 `isInsideSecureHardware()` 粗判（TEE 与 StrongBox 同为 secure hardware，无法区分） | AOSP KeyInfo.java（无 isStrongBoxBacked，有 getSecurityLevel/isInsideSecureHardware） |
| 3 | re-macos | SKILL.md:79 | "Secure Enclave 密钥：`SecKeyCreateWithData` 带 `kSecAttrTokenIDSecureEnclave`" | **API 用错**。`SecKeyCreateWithData` 是从外部 key data 导入/恢复，不是 SE 密钥生成；SE 密钥不能导入（只能设备内生成） | `SecKeyCreateRandomKey`（属性含 `kSecAttrTokenID: kSecAttrTokenIDSecureEnclave`），或旧 API `SecKeyGeneratePair` | Apple 文档语义（SecKeyCreateWithData = 外部数据导入；SE 绑定走随机生成） |
| 4 | re-ai-model | SKILL.md:70 | "Safetensors：前 8 字节 = 大端 u64 头长度" | **字节序反了**，实为**小端** | `struct.unpack("<Q", data[:8])` | HF safetensors README 原文："8 bytes: `N`, an unsigned little-endian 64-bit integer" |
| 5 | re-mobile-forensics | SKILL.md:70, 72 | "Manifest.plist（文件映射表：domain/相对路径 → 哈希文件名）" | **文件搞错**。现代备份（iOS 10+）的文件索引是 `Manifest.db`（SQLite `Files` 表：fileID/domain/relativePath/flags/file）；`Manifest.plist` 存备份元数据（Version/Date/IsEncrypted/BackupKeyBag/ManifestKey/Lockdown 设备信息等）。旧版 iOS（<10）索引才是 `Manifest.mbdb` | 映射表指向 `Manifest.db`；`Manifest.plist` 改述为元数据与密钥材料载体 | iOS 备份结构（Manifest.plist 元数据 / Manifest.db 索引）；本库 gotchas 与 decision-tree 方向一致，SKILL.md 与二者冲突 |
| 6 | re-mobile-forensics | SKILL.md:72 | "文件按内容哈希命名" | **不是内容哈希**。fileID = SHA1(domain + "-" + relativePath)，由路径派生，与文件内容无关——不能拿它当完整性校验 | 明确写 path-derived fileID；与 gotchas.md:13 的既有正确表述对齐 | 同上（库内 gotchas:13 已写对，SKILL.md 与之矛盾） |
| 7 | re-mobile-forensics | SKILL.md:74 | "加密备份判定：Manifest.plist 无法明文读取而 Info.plist/Status.plist 正常" | **判定反了**。`Manifest.plist` 在加密备份中**仍可明文读取**（`IsEncrypted`/`BackupKeyBag`/`ManifestKey` 就在其中）；被加密的是 `Manifest.db` 与各文件内容 | 改为：读 `Manifest.plist` 的 `IsEncrypted` 键判定；再按备份密码/keybag 解 `Manifest.db` | 同上（加密备份的密钥材料存放位置） |
| 8 | re-riscv | SKILL.md:76 | "reset 向量（QEMU virt 机器 0x80000000…）" | **地址语义混淆**。virt 的 MROM（reset 向量所在）在 `0x1000`；`0x80000000` 是 DRAM 基址，即 reset stub 跳转的默认目标 | 写作：CPU 从 `0x1000` 的 MROM reset stub 起，stub 跳 `start_addr`（默认 DRAM `0x80000000`；pflash 固件场景为 `0x20000000`） | QEMU `hw/riscv/virt.c`：`VIRT_MROM=0x1000`、`VIRT_DRAM=0x80000000`、`riscv_setup_rom_reset_vec(…, start_addr, MROM.base, …)` |
| 9 | re-dotnet | SKILL.md:72 | "EntryPoint RVA（0=DLL）" | **不总是 RVA**。该字段是 union（ECMA-335 II.25.3.3 EntryPointToken）：未置 `COMIMAGE_FLAGS_NATIVE_ENTRYPOINT` 时为 metadata token（MethodDef/File），置位时才是 native code RVA；"0 = 无入口"成立 | 写作 EntryPointToken / EntryPointRVA union，按 `COMIMAGE_FLAGS_NATIVE_ENTRYPOINT` 决定解释 | ECMA-335 II.25.3.3 CLI header 字段定义 |
| 10 | re-automotive | SKILL.md:89, 149 | `candump can0 -f 0x7E0:0x7FF`（注释作 ID 过滤） | **命令错**。`-f <fname>` 是把日志写入文件（这条命令会生成名为 `0x7E0:0x7FF` 的日志文件）。过滤语法在接口名后的逗号位：`candump can0,7E0:7FF`（`can_id:can_mask`，匹配条件 `received & mask == can_id & mask`） | 两条命令拆开：过滤 `candump can0,7E0:7FF`；写文件 `candump -f <file> can0` | can-utils 源码 `candump.c` usage（`-f <fname> (log CAN-frames into file <fname>)`）+ Debian manpage 过滤语法节 |
| 11 | re-forensics | SKILL.md:15 | "转储来源：…没有则按 [[re-memdump]] 转一份（`gcore -o out <pid>`…）；已有 .raw/.mem/.core 直接进入下一步" | **与子技能自相矛盾且工作流错误**。gateway 把 gcore 产物当取证默认来源；但 [[re-mem-forensics]]:52 与 [[re-memdump]]:73 明确 gcore 是单进程 ELF core（无内核结构/页表），Volatility 整机插件不可解析 | 分流：gcore → gdb/eu-stack 进程级复盘；整机镜像（LiME/AVML/崩溃转储等）→ Volatility | 库内三处原文对照（re-forensics / re-mem-forensics / re-memdump） |

## 中严重度（5 项，会导致错误推理）

| # | 技能 | 位置 | 现状（原文） | 问题 | 修正方向 | 核验依据 |
|---|---|---|---|---|---|---|
| 12 | re-ai-model | SKILL.md:69 | "起始字节形如 `08 08 12 <len> ...`" | **不能当识别 signature**：第二字节是 ir_version 的**值**，随 ONNX 版本递增（当前已发布 13 = `0x0D`，main 分支枚举已到 14），不是固定 8；`producer_name` 为 SHOULD present，不保证出现 | 保留"protobuf 无固定魔数"，把 `08 08 12…` 降为"部分旧样本的形态举例"，并说明首字段是 ir_version（tag `0x08` + 变长值） | onnx.proto `Version` 枚举（IR 1…13 已发布，14 待发布） |
| 13 | re-dotnet | SKILL.md:73 | "版本串（"v4.0.30319"，.NET Framework/.NET Core/.NET 10 产物恒定）" | **常见默认值≠不变量**。`MetadataRootBuilder` 默认确为 v4.0.30319，但参数可指定其他串；ECMA-335 允许 vendor-specific 版本串 | 改为"典型默认值（Roslyn/MetadataRootBuilder 产物常见）"，不作恒定断言 | ECMA-335（版本串为自由格式）+ MetadataRootBuilder 默认值语义 |
| 14 | re-macos | SKILL.md:78 | "钥匙串条目类型…与 ACL（`kSecAttrAccessible` 可访问性类）" | **术语不准**。`kSecAttrAccessible` 管"设备处于什么状态时条目可读"（可访问性）；访问控制是 `kSecAttrAccessControl`/`SecAccessControl`（生物识别/密码门槛），macOS 传统 ACL 另有 `SecAccess`/`kSecAttrAccess` | SKILL.md 与 gotchas.md:30 的既有正确区分对齐（ACL 与可访问性分开表述） | Apple 钥匙串属性语义；库内 gotchas:30 已正确区分 |
| 15 | re-mem-forensics | SKILL.md:21 vs :23 | 标题"（Python 3.8-3.11）"，正文"官方要求 Python 3.8+…3.14 可安装" | **标题与正文矛盾**：官方只要求 `Python >=3.8.0`，无 3.11 上限 | 标题去掉上限（"Python 3.8+"） | PyPI volatility3 元数据（Requires Python >=3.8.0） |
| 16 | re-ransomware | SKILL.md:65 | "熵（>7.0 已加密）" | **高熵≠加密**：压缩数据、媒体文件、随机填充、压缩 section 同样高熵；此处把证据写成了判定 | 改为"高熵（>7.0）→ 加密/压缩/高随机性候选，需结合文件头与上下文佐证" | 方法论（本库 re-anti-analysis:199、re-binary-core R24 已写"高熵≠加密"） |

**#16 范围补充**：库内多数位置措辞正确（"可疑加壳/加密""密文/压缩候选""提示加壳/加密"），硬化表述目前定位到 2 处——re-ransomware:65 与 re-proto-rev:136（">7.5 几乎肯定加密"）。修复时一并收敛。

---

## 批 2（2026-09-13，独立监控 + 本库自查）

| # | 严重度 | 技能 | 位置 | 现状（原文） | 问题 | 修正方向 | 核验依据 |
|---|---|---|---|---|---|---|---|
| 17 | 高 | re-frida 等 9 文件 | re-frida/SKILL.md:76,90,113,136；re-frida/references/frida-scripts.md:33-34；re-android-native/SKILL.md:115；re-android-native/references/probes.md:26；re-crypto-id/SKILL.md:111；re-ios-jb/SKILL.md:86；re-flutter/SKILL.md:114；re-address-space/SKILL.md:26,72,80 | `Module.findExportByName(...)` / `Module.getExportByName(...)` / `Module.enumerateExports(...)` / `Module.findBaseAddress(...)` 等静态调用 | **Frida 17.0.0 移除了全部静态查找/枚举 API**（静态仅存 `Module.load` / `findGlobalExportByName` / `getGlobalExportByName`）——安装指引给的是 `pip install frida-tools`，用户拿到 17+ 后示例报 `is not a function`；属横向污染（多技能共享旧模板） | 迁移为模块实例调用：`Process.getModuleByName("libfoo.so").findExportByName("func")`、`.base`、`.enumerateExports()`；全局符号（原 null 模块参数）用 `Module.findGlobalExportByName(...)`；re-frida 补迁移条目，其余技能就地改写 | Frida 17.0.0 发布公告（静态 API 移除清单与替代写法）+ 官方 JavaScript API 文档（Module 静态/实例方法现行清单） |
| 18 | 中 | re-frida-script-author | SKILL.md:73 | "`Interceptor.attach` 的 onEnter/onLeave 里 `this.context` 读寄存器、`this.returnValue` 改返回值" | **`this.returnValue` 不存在**：`this` 上只有 returnAddress/context/errno/lastError/threadId/depth；改返回值必须用 onLeave 参数 `retval.replace(...)`——脚本生成方法论技能写错会系统性复制进新脚本 | 改为 onLeave `retval.replace(...)`；注明 retval 跨调用复用、需留存时先复制 | 官方文档 Interceptor 节（onLeave(retval)、replace()、`this` 属性清单无 returnValue） |
| 19 | 中 | re-ics | SKILL.md:87 | `ModbusPDU03ReadHoldingRegistersRequest(start_addr=0, quantity=10)` | **字段名错**：scapy 定义为 camelCase `startAddr`（`XShortField("startAddr", 0x0000)`），可直接复现 | 改 `startAddr=` | scapy 源码 `scapy/contrib/modbus.py` 字段定义 |
| 20 | 中 | re-angr | SKILL.md:25,122；references/gotchas.md:5 | "angr 9.2.x 支持 Python 3.8–3.11" | **9.2.x 不是固定区间**：下限随补丁版本抬高（9.2.91 要求 ≥3.8 → 9.2.203 要求 ≥3.10）；"9.3.0 起 3.12+" 半句正确 | 改为"9.2.x 下限随补丁版本抬高，装前以目标版本 PyPI `requires-python` 为准" | PyPI 元数据：9.2.91（≥3.8，2024-02）、9.2.203（≥3.10，2026-02）、9.3.4（≥3.12） |
| 21 | 中 | re-ios-jb | SKILL.md:88 | `Memory.readCString(a[0])` | **`Memory` 下无 readCString**（Memory 静态仅 scan/alloc/copy/dup/protect/patchCode/queryProtection/allocUtf8String 等）；读 C 字符串是 NativePointer 实例方法（本库自查发现，与 #17 同类） | 改 `a[0].readCString()` | 官方文档 Memory 节方法清单 + NativePointer 节 |

**说明**：re-frida-script-author 的 gotchas.md 与 SKILL.md 坑节此前已正确记载 Frida 17 迁移写法——说明问题不在知识缺失，而在"迁移只写进了说明、没落到示例"；本次修复即把示例与说明对齐。

## 需澄清（非误报，但审查表述需修正）

1. **candump `-f` 确实存在**：上游 can-utils 当前版本有 `-f <fname>`（写日志文件），Debian bookworm 打包的 manpage（can-utils 2020.11.0）尚未收录该选项——核验时以源码为准。#10 的结论（原命令会写文件而非过滤）成立。
2. **re-mobile-forensics 是局部不一致而非全错**：gotchas.md:13 与 decision-tree 已含正确表述（SHA1(domain+relativePath)），缺陷集中在 SKILL.md 正文与 references 互相矛盾——修复时以 gotchas 为准并消除分歧。

## 未覆盖范围（局限）

- 批 1 为外部 AI 抽查（约几十个技能）结果、本库核验其列出的 16 项；批 2 为独立监控首轮 4 项 + 本库自查 1 项——**均非 121 技能全量逐条审计**
- #17 同类风险面：本轮已 grep 排查 `Memory.read*/write*` 型访问器与 legacy 回调式枚举（`Process.enumerateModules({...})`），未见残留——但属关键字排查，未做全量语义校验
- 未核验的外部结论一律未入库；后续批次沿用本文档状态机续记

## 核验来源清单

| 来源 | 用途 |
|---|---|
| AOSP `KeyInfo.java`（frameworks/base/keystore） | #1 #2 方法列表 |
| JDK `java.security.KeyStore` API | #1 |
| Apple Security 框架文档语义 | #3 #14 |
| HF `safetensors` README（Format 节） | #4 |
| iOS 备份结构（Manifest.plist / Manifest.db） | #5 #6 #7 |
| QEMU `hw/riscv/virt.c` | #8 |
| ECMA-335 II.25.3.3（CLI header） | #9 #13 |
| can-utils `candump.c` + Debian manpage | #10 |
| 库内原文三处对照 | #11 |
| onnx.proto `Version` 枚举 | #12 |
| PyPI volatility3 元数据 | #15 |
| 库内既有正确表述（re-anti-analysis / re-binary-core） | #16 |

## 修复记录（2026-09-13）

批 1（#1–#16）与批 2（#17–#21）共 21 项**已全部修复**，状态 **fixed（待复核）**。

- 涉及文件 28 个（技能 SKILL.md 21 + references 7），其中 Frida 17 横向迁移覆盖 9 个文件
- 校验：`npm test` 通过（`OK: 121 skills validated` + 25 项单测）；grep 复核确认已移除 API 无残留（保留的"旧写法"文字均为迁移说明性注释）
- 复核入口（后续波次）：按状态机 fixed → verified 逐项复核；重点复核两处语义选择——① Frida 迁移中 `find*`（返 null）与 `get*`（抛异常）在各示例语境下是否选得恰当；② re-forensics 转储分流的表述是否与实际 [[re-mem-forensics]] / [[re-memdump]] 边界完全一致

## 后续机制建议（来自同一审查，待评估）

审查提出把验证体系分四层：Syntax → API/CLI validity → Format/spec assertion → behavior fixture，即对 API 名做静态符号表比对、对 CLI 示例跑 `--help`、对格式常量做 spec 断言、对关键结论建最小 fixture（如生成最小 safetensors 验证前 8 字节、起 `-S -s` QEMU 验证 $pc、用脱敏备份验证 fileID 派生）。

可选落点：与 TODO「增量审查机制」合并设计——finding 记录（本文档格式）+ 高风险技能的 fixture 子集，先覆盖 ABI/offset/格式字段/API 名四类断言。
