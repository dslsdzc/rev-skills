# 事实性缺陷审查记录

日期：2026-09-13
来源：批 1——外部 AI 审查清单（覆盖约几十个技能，**非 121 全量穷尽**）+ 本库逐条独立核验；批 2——独立监控（每日核对事实/技术/逻辑/命令错误）+ 本库自查补充
用途：为「增量审查机制」（TODO.md）提供 finding 与核验结论

**状态机**：open（已记录待修）→ fixed（已修）→ verified（复核通过）

**核验方法**：本库原文 grep 定位（确认审查引文与文件一致）+ 上游权威源比对（AOSP 源码 / onnx.proto / can-utils 源码 / QEMU 源码 / HF safetensors 规范 / PyPI 元数据）。只有"原文与权威源直接冲突"才记为确认；术语与措辞类问题按"是否会导致错误推理"定级。

**结论汇总**：批 1（高 11 / 中 5）、批 2（高 1 / 中 4）、批 3（高 9 / 中-高 2 / 中 5）、批 3 补充（工具链 1）累计 38 项 finding——**35 项技能缺陷 + 1 项工程性问题（历史文档污染）+ 1 项工具链一致性问题确认，1 项误报**（见批 3 #37）；需澄清 2 点（见文末）。已确认缺陷**全部修复**（状态 fixed，待复核——见文末修复记录）。

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

## 批 3（2026-09-13，独立监控第二轮）

覆盖 8 个技能，16 项——**15 项确认并修复，1 项误报**（#37）。

| # | 严重度 | 技能 | 位置 | 现状（原文） | 问题 | 修正方向 | 核验依据 |
|---|---|---|---|---|---|---|---|
| 22 | 高 | re-automotive | SKILL.md:96 | `candump -c can0  # 每 ID 帧计数` | **`-c` 是颜色模式**（increment color mode level），不计数——照抄得到彩色输出而非统计 | 改 `candump can0 \| awk '{print $2}' \| sort \| uniq -c`；坑节同步 | can-utils 源码 `candump.c` usage |
| 23 | 中 | re-automotive | SKILL.md:87 | "落盘日志（自动轮转…）" | **无轮转**：源码只一次 `fopen(logname,"w")`，无大小/时间触发；默认文件名带时间戳 | 改述为"默认文件名带时间戳；无轮转，需要轮转交给 logrotate/外部脚本" | can-utils 源码 `candump.c` 日志处理段 |
| 24 | 高 | re-disk-forensics | SKILL.md:89 | `tsk_recover -e …  # 批量恢复全部已删除文件` | **语义反了**：默认行为才是只导未分配（已删除）文件；`-e` 是已分配+未分配**全部文件**（`-a` 只导已分配） | 默认命令去掉 `-e`；`-e` 单列一行注明"全部文件" | sleuthkit `tsk_recover(1)` man page |
| 25 | 中-高 | re-disk-forensics | SKILL.md:115 | `dd … skip=<A_end> count=<B_start-A_end>` | **off-by-one**：mmls 的 End 是含端点的末扇区（源码 `part->start + part->len - 1`，即 Length=End-Start+1）；真正的 gap 从 A_end+1 起 | 改 `skip=$((A_end+1)) count=$((B_start-A_end-1))`；提示直接用 mmls 的 Unallocated 项 Start/Length | sleuthkit 源码 `tools/vstools/mmls.cpp`（printf 与算术） |
| 26 | 高 | re-format-pe | SKILL.md:102 | `for cid, count, off in rh['values']:` | **必然报错**：pefile 的 `values` 是扁平整数数组 `[compid, count, …]`（源码 `headervalues += [.., ..]`），无三元组、无 `off`，且已按 key 解密 | 改 `vals=rh['values']; zip(vals[0::2], vals[1::2])` | 本地装 pefile 读 `parse_rich_header` 源码 |
| 27 | 高 | re-format-pe | SKILL.md:86 | `ptr_size = 8 if pe.FILE_HEADER.Machine == 0x8664 else 4` | **判据错**：位宽由 Optional Header Magic 决定（0x10b=PE32 / 0x20b=PE32+）；ARM64(0xAA64) 也是 PE32+，会被按 4 字节读 | 改按 `pe.OPTIONAL_HEADER.Magic == 0x20b` 判定 | PE/COFF 规范（Machine 与 Magic 语义分离） |
| 28 | 高 | re-format-elf | SKILL.md:91 | "`DT_BIND_NOW`/FLAGS 出现 = 全 RELRO、GOT 只读" | **把两个独立条件写成等价**：BIND_NOW 只表示启动时完成绑定；只读重定位区由 `PT_GNU_RELRO` 建立 | 全 RELRO = `PT_GNU_RELRO` + BIND_NOW；仅 RELRO = Partial；仅 BIND_NOW 推不出 RELRO | GNU ld 文档（`-z now` 与 `-z relro` 分列定义） |
| 29 | 中 | re-format-elf | SKILL.md:73 | `objdump -d -j .init_array` "逐条反汇编回调地址" | **-d 不处理数据节**：.init_array 是函数指针数组，-d 只反汇编被标记为指令的节，实际无输出 | 改 `objdump -s` 取指针，再按指针地址反汇编目标函数 | objdump 语义（节标志决定 -d 范围） |
| 30 | 高 | re-format-elf/references/layout.md | :32,:34,:132 | e_phnum/e_shnum 扩展编号写成同一套（"同上 PN_XNUM 溢出处理"） | **混了三套独立规则**：e_phnum==PN_XNUM → `shdr[0].sh_info`；e_shnum==0 → `shdr[0].sh_size`；e_shstrndx==SHN_XINDEX → `shdr[0].sh_link` | 三条分别写清，并建议配 parser fixture 验证 | ELF 规范（扩展编号三规则） |
| 31 | 中 | re-format-elf/references/layout.md | :29 | e_flags "MIPS 的字节序/ABI 位" | **无字节序位**：MIPS e_flags 是 ABI/ISA/PIC/NaN 等；字节序始终由 `e_ident[EI_DATA]` 决定 | 改述为 ABI/ISA/PIC/NaN，并注明字节序看 EI_DATA | ELF/LLVM 的 EF_MIPS_* 定义 |
| 32 | 高 | re-format-macho | SKILL.md:70,:130；references/layout.md:89 | `__LINKEDIT` "无映射内容""运行时不可访问" | **错**：它是正常段（有 vmaddr/vmsize），通常映射为只读区域（vmmap 可见）；只是 shared cache 场景链接元数据驻留方式不同 | 改述为"只读映射段；shared cache 影响驻留方式"，并提示按 LC_SYMTAB 用 nm/dyldinfo 定位而非照抄文件偏移 | Mach-O 段语义 + dyld shared cache 行为 |
| 33 | 中 | re-macos | SKILL.md:56 | "看 `com.apple.quarantine`（…来源 URL）" | quarantine 记录隔离标志/时间戳/责任方，**不含来源 URL**；来源信息在 Spotlight 属性 | 来源改用 `mdls -name kMDItemWhereFroms` | Apple quarantine 与 kMDItemWhereFroms 语义 |
| 34 | 中 | re-address-space | SKILL.md:55 | "PIE = 0（所有地址是相对偏移）"当不变量 | **格式无此要求**：ET_DYN 的最低 p_vaddr 不必为 0；load_bias 应按最低 PT_LOAD p_vaddr 与运行时映射求差 | 改为"取最低 PT_LOAD 的 p_vaddr，别假设 PIE 必为 0" | ELF GABI（base / load bias 定义） |
| 35 | 高 | re-hypervisor | SKILL.md:68 | VMCS 编码"索引在 bits 9:0" | **漏 bit0 语义**：bit0=访问类型（full/high），索引在 bits 9:1（9 位）；类型 bits 11:10、宽度 bits 14:13 | 写全四段位域并给解码式 `index=(enc>>1)&0x1ff` 等 | Intel SDM VMCS 字段编码（示例 0x400C/0x681E 复核通过） |
| 36 | 高 | re-hypervisor | SKILL.md:87 | `echo 1 \| sudo tee /sys/module/kvm_intel/parameters/nested` | **当前内核写不进去**：`module_param(nested, bool, 0444)` 只读，sysfs 写入失败 | 改 `modprobe -r kvm_intel && modprobe kvm_intel nested=1`，`/etc/modprobe.d` 持久化，读参数验证 | 内核 commit 801d3424（`module_param(nested, bool, S_IRUGO)`，S_IRUGO=0444 只读）+ RHEL/Fedora/SUSE 文档均以 modprobe 重新加载开启 |
| 37 | 误报 | re-uefi | —— | 监控称仓库有 `uefifind fw.bin all list <GUID>` 并把 GUID 文本当 pattern | **仓库不存在该写法**：`uefifind` 全文仅 2 处且都正确（位置参数语法 + 紧邻一行已指向 UEFIExtract 的 GUID 模式） | 不修；记录为误报 | 全仓 grep + `uefifind(1)` man page 复核 |

### 工程性问题：历史文档污染（本轮记录，已缓解）

- **现象**：`docs/superpowers/{plans,specs}/` 是历史存档、不随技能修订同步——grep 确认 2 处保留已修正的旧错误（`plans/2026-08-18-six-skills.md:239` 的 `SecKeyCreateWithData`；`plans/2026-08-18-six-skills-v2.md:449` 的"内容哈希 + manifest.plist 映射"）
- **风险**：不在人读，而在 Agent/RAG 全仓检索时把已修错误重新召回
- **缓解（已实施）**：① 新增 `docs/superpowers/README.md` 声明本目录为历史存档、当前事实以 `.claude/skills/` 为准；② 两处旧错误就地标注"已于 2026-09-13 修正 + 现文位置"（保留原文，不重写历史）；③ `CLAUDE.md` 开发工作流节加注：历史存档不得当现行指引检索
- **待定**：是否给全部 27 个历史文档统一加头部横幅（当前只处理了含已知错误的 2 个文件）

### 批 3 补充：工具链一致性问题（#38，用户报告，已修）

| # | 严重度 | 位置 | 现象 | 问题 | 修正方向 | 核验依据 |
|---|---|---|---|---|---|---|
| 38 | 高（工具链） | `validate.mjs` vs `bin/convert.mjs` | 规范（`docs/skill-template.md`）写「frontmatter 标准 YAML」，但 `validate.mjs` 是逐行解析、**不支持块标量**；`bin/convert.mjs` 另有一套支持块标量的实现 | **同一仓库两个解析器对同一批文件结果不同**：104/121 个技能的 `description` 用 `>` 折叠块，validate 侧解析成字面量 `">"`（非空 → 恒过），**「description 非空」校验对 86% 的技能是空转**；且名称/描述一致性无从校验 | 抽出单一实现 `lib/frontmatter.mjs`（支持简单 scalar / 块标量 `>` `|` / 内联 flow list 与 JSON；其余 YAML 特性显式不支持并写明扩展流程），`validate.mjs` 与 `bin/convert.mjs` 改为共用；补回归测试 | 对全部 121 个技能同时跑两个解析器：修复前 104 个 `description` 不一致；块标量为空/歧义 0 个 |
| 38-fix | —— | 新增 `lib/frontmatter.mjs`、`tests/frontmatter.test.mjs`；改 `validate.mjs`、`bin/convert.mjs` | —— | —— | 6 条新测试：折叠/字面块标量、空块标量报错、块标量不吞并同级键、`splitFrontmatter` 行为、**全技能跨解析器一致性回归**（直接编码被破坏的那条不变量） | `npm test` 31 项通过（原 25 + 新 6）；修复后 `description` 不一致 0 个、空描述 0 个 |

### 批 3 补充 2：触发词双语校验（#39，用户要求，已实施）

- **背景**：#38 修复前 validate 看不到块标量里的真实 description，`AGENTS.md` 的「description 含中英触发词」约定从未被 CI 兜住
- **实施**：`validate.mjs` 的 `checkSkillDir` 增加断言——description 须同时含 CJK（U+3400–4DBF / 4E00–9FFF / 3040–30FF / AC00–D7AF）与拉丁字母；规格同步 `docs/skill-template.md`、`AGENTS.md`、`CLAUDE.md`
- **存量核查**：实施前全量检查 121 个技能——双语俱全 121、缺 CJK 0、缺拉丁 0，规则不误伤存量
- **测试**：新增 1 条（双语通过 / 仅中文报错 / 仅英文报错）；4 个测试夹具与 2 处内联 description 同步补英文（夹具只应暴露其目标缺陷，不叠加无关错误）
- **结果**：`npm test` 32 项通过（原 31 + 新 1）

### 批 3 补充 3：能力层未闭环（#40，用户报告，部分闭环）

- **核查（三处断点）**：
  1. **声明覆盖**：仅 23/121 技能声明 capabilities（网关 11/12、原子 12/108、入口 0/1）
  2. **消费**：0——全仓 `grep capabilit` 在 `re-analyze/` 下只命中注册表自身；triage/rerouting 仍按领域名与关键词路由
  3. **完整性**：只有"标签须在注册表内"一条检查；注册表 52 个标签中 **15 个无人声明**（悬空）
- **本次闭环**（元数据 → 索引 → 可查询 → CI 防漂移）：
  - 悬空清零：为 15 个悬空标签补声明（14 个技能，均为技能名与标签语义一一对应者，如 `tracing`→re-tracing、`tee-analysis`→re-tee、`binary-diffing`→re-variant）——现 **标签 52/52 有声明**
  - 新增查询表 `re-analyze/references/capability-index.md`（`lib/capability-index.mjs` 渲染、`bin/capindex.mjs` 生成）：「能力 → 技能」反查 + 未声明清单 + 覆盖率计数（标签口径 + 技能口径），路由/检索首次有消费入口
  - CI 两条新检查：注册表标签悬空 → 报错；索引过期 → 报错（提示 `node bin/capindex.mjs`）
  - 测试 +5（注册表解析 / 标签反查 / 悬空检出与消失 / 索引三态（缺失·过期·同步）/ 渲染内容）
- **仍未闭环（需定策略）**：
  - **技能覆盖 37/121**——按注册表既定的「渐进策略」，剩余 84 个技能未标注；本次只补悬空项，未做全量标注（避免与既定策略冲突）
  - **路由仍按领域名**——triage/rerouting 未改为「输入特征 → 需要能力 → 技能」，索引已就绪，属设计级改造
- **结果**：`npm test` 37 项通过；`OK: 121 skills validated`

### 批 3 补充 4：全局数据契约偏文件域（#41，用户报告，已修）

- **现象**：`re-analyze/references/analysis-contract.md` 的 §一 上下文清单与 §三 数据契约只有一套文件域字段（`sha256 / arch / format / entropy / sections / imports_exports / strings_refs / base_addr / symbols_known`），除 `sha256` 外均为 PE/ELF 视角——SDR、CAN、AI 模型、TEE、取证等域无字段可用
- **影响面**：81 个文件引用 `[[analysis-contract]]`；点名具体字段的仅 2 处（re-triage 输出契约、re-address-space 的 base_addr）；其余为非文件域技能的泛引（只引 §四 复核格式，域中立）——故改动以契约结构为主
- **修复**：改为两层结构——**核心字段**（所有域必带：target_id / sha256 / evidence / findings / unverified，与 §四 复核格式对齐）+ **域扩展字段**（10 个域组：文件/二进制、网络/协议、总线/车载、射频/SDR、AI 模型文件级、AI 模型行为级、移动/托管、TEE、取证/情报、沙箱/行为）；§一 上下文清单改按域展开；新增 §3.3 传递规则（核心必带、域字段选填不要求跨域填充、只增不改）
- **核验**：用户点名的 5 个域（SDR / CAN / AI model / TEE / 取证）均有字段组；契约内 `[[链接]]` 全部解析通过；非文件域技能无硬套文件域字段的表述（逐条 grep 确认）
- **结果**：`npm test` 37 项通过；`OK: 121 skills validated`

### 批 3 补充 5：能力层剩余缺口闭环（#42，用户要求，已闭环）

- **技能覆盖**：84 个未声明技能全部标注——**原子技能 108/108**（入口 `re-analyze` 与元网关 `re-feedback` 按策略省略，索引显示 119/121）
- **标签缺口**：全量标注暴露注册表缺口——12 类能力此前无标签可表达（架构相关、语言运行时产物、磁盘取证、eBPF、Electron、虚拟化、越狱、跨平台框架、利用开发、二进制补丁、插件开发、沙箱搭建），补齐（52→64）
- **路由按能力匹配**：`triage.md` 目标表（19→30 行）与 `rerouting.md` A 表（23→33 行）全部加「需要能力」列，技能列改为索引反查结果；A 表同时补齐此前缺行的域（语言产物、RISC-V/MIPS、hypervisor、eBPF、磁盘/整机取证、越狱、白盒、内核驱动、HarmonyOS、TLS、变体对比）
- **CI 防漂移**（累计 4 条）：原子技能必须声明能力｜路由能力列标签须在注册表内｜路由标称能力须被本行技能声明｜索引须与声明同步（+ 此前的注册表标签不得悬空）
- **反向验证**：故意改错 A 表一行能力 → validate 精确报出 `rerouting.md:15 路由标称能力 'tls-analysis'，但本行技能（re-packer-id / re-anti-analysis）均未声明该能力`；还原后 OK
- **结果**：`npm test` 39 项通过（+2：原子技能必须声明、路由一致性）；`OK: 121 skills validated`
- **遗留（可选）**：网关内部选择树未加能力列——网关内调度仍按输入形态判定树，属网关层设计，未纳入本轮

### 批 3 补充 6：网关选择树能力标注（#43，用户要求，已完成）

- **范围**：11 个有选择树的网关（re-binary-core 与 re-anti-analysis 无独立选择树，走「完整工作流」段）+ 各网关完整工作流段
- **产出**：**336 处链接标注能力**（选择树段 100% 覆盖，11 个网关全部 0 遗漏）；网关内调度可直接读「输入形态 → 技能（能力：`tag`）」
- **约定**：`[[re-xxx]]（能力：`tag1`、`tag2`）`——**显式「能力：」前缀**。标注过程中发现原格式 `（`tag`）` 与「链接 + 反引号代码」不可区分：re-memdump 的 `[[re-x64dbg]]（`minidump` 命令）` 被误判成能力标注（`minidump` 非注册标签），故加前缀消歧；无前缀括号一律视为普通说明
- **CI**：选择树段内技能链接必须带标注；标注的能力须在注册表内且被被标注技能真的声明；非技能链接（references 文档如 [[platform-tips]]）豁免
- **反向验证**：删掉 re-mobile 一处标注 → `FAIL: re-mobile: 选择树内 [[re-apk]] 缺少能力标注（形如 [[re-apk]]（能力：\`能力\`））`；还原后 OK
- **过程中修正的检查器缺陷 2 处**：① 括号嵌套时把内层 `[[子技能]]（能力：…）` 的标签算到外层（改为只取链接括号**开头**的连续标签段）；② references 链接被误要求能力标注（改为只校验技能链接）
- **结果**：`npm test` 40 项通过（+1：选择树标注一致性）；`OK: 121 skills validated`

### 批 3 补充 7：新增 re-sample-acquire（#44，用户要求，已落地）

- **缺口**（用户发现）："只有现象描述、没有样本"时缺一个采集环节——现有零件都以前提"样本已在手"开头（[[re-memdump]] 需已知 PID、[[re-netcap]] 需能抓包、[[re-fileless]] / [[re-loader]] 需已有样本、[[re-triage]] 需已有文件）；入口输入类型表也无"现象描述/无样本"这一档
- **形态**：新增原子技能 `re-sample-acquire`（能力标签 `sample-acquisition`；原子 108→109，总数 121→122）= SKILL.md（141 行）+ 4 份平台分支 `references/platform-{windows,linux,macos,sel4}.md`（共 248 行）
- **核心方法论**（用户提供 + 社区实践核验）：
  - CORE RULE：**不猜进程名、不依赖"用了哪个注入 API"**——找「异常执行内存 + 到达该内存的执行上下文」；先问 provenance（这块可执行内存是谁创建的、经什么路径进来）
  - 两特征 + 一补充：内存被改成可执行（W→X / RWX）；无背书区域在执行；线程起点/RIP/调用栈归属
  - **漏检点**（本轮重点补的）：只查 `MEM_PRIVATE` 会漏 module stomping（`MEM_IMAGE` + COW，需查 Working Set `.Shared` 位）；只看线程起点会漏 trampoline / `SetThreadContext` / `jmp rcx` / Win11 `_beginthreadex` 等绕过（要 PC + 调用栈一起看）；只按 MZ/PE 头找载荷会漏**擦头 implant**（保存整区再分类）；JIT/Wine/浏览器/安全软件本身就产生同类 artifact →**评分制而非二元判定**
  - trigger 与 ground truth 分工：事件源只回答"**何时** dump"，内存扫描回答"**dump 什么**"（直系统调用/共享段/覆盖已有 RX 区都能绕过用户态 hook）
- **四平台观测模型不同（用户要求不得机械翻译）**：
  - **Windows**：VAD/region + 线程 + 模块链；Sysmon 8/10/25、ETW-TI、内核回调三件套
  - **Linux**：VMA（`/proc/<pid>/maps`，perms/pathname 语义；**6.11+ `PROCMAP_QUERY` ioctl**）；tracepoint/kprobe 与 **BPF LSM**（内核 BPF LSM 文档即以 `file_mprotect` 为示例，`SEC("lsm/file_mprotect")`）；`process_vm_readv`/ptrace 读取（受 ptrace access check）
  - **macOS**：Mach task + VM region（`vm_region_recurse_64`/`mach_vm_region*`、`mach_vm_read*`）；**Endpoint Security**（`NOTIFY_MMAP`/`NOTIFY_MPROTECT`/`NOTIFY_REMOTE_THREAD_CREATE`/`NOTIFY_GET_TASK`，`AUTH_*` 可拦截）；**权限现实**——SIP 下 `task_for_pid` 对受保护进程 EPERM、Hardened Runtime 默认吊销内存读取、`get-task-allow` 可恢复（"不是 root 就能读"）
  - **seL4**：capability 制，**不存在"root 全读"模型**；路线是构造期由 monitor 记录 provenance（TCB/frame/VSpace caps → execution provenance graph），TCB debug API 与 fault endpoint 作事件源；提问从"代码藏在哪个进程"改为"**哪个 capability flow 授予了 executable authority**"
- **挂载**：入口输入类型表 + triage 路由行 + rerouting A 表 2 行 + re-malware 网关（子技能清单与选择树）；re-memdump 跨域反向指向（"未定转什么"时先走采集）
- **核验**：各平台事实逐条对上游（内核 `proc.rst` / `bpf_lsm.rst`、Apple ES 与 SIP/Hardened Runtime 文档、seL4 debug API、PE-sieve 选项与 wiki）；`npm test` 40 项通过；`OK: 122 skills validated`；计数五处 + README 导航同步
- **备注**：本技能是新的审查面（监控下一轮会按同样标准核验其 API/命令/判据）；采集动作本身留痕，技能内已写明授权边界与停止条件

### 批 3 补充 8：内核覆盖扩到跨平台（#45，用户要求，已落地）

- **缺口**（用户发现）：内核态载荷覆盖**只有 Windows**——`re-kernel` 标题/触发词写死 Windows，且「何时不用」原文把 Linux 推给零散技能；全库关键词扫描 `LKM` / `System Extension` / `kmod` / `insmod` **0 命中**，`kext` 仅 2 处顺带提及
- **形态**：`re-kernel` 重构为跨平台 = SKILL.md（92 行主干）+ 4 份平台分支（windows-kernel 76 / linux-kernel 74 / macos-kernel 55 / android-kernel 42）；原 Windows 内容**原样迁入** windows-kernel.md；两个纯 Windows 的旧 references 更名（`gotchas.md`→`windows-gotchas.md`、`decision-tree.md`→`windows-decision-tree.md`，`git mv` 保留历史）以免与新范围混淆
- **结构核心**（按用户要求）：**失败模式决策表**——六类症状（struct offset 全错 / 符号解析怪异 / 文件与运行行为不一致 / 模块"消失" / driver IPC 调不通 / 异常 ELF section）→ 优先怀疑项（按顺序）→ 处理方向。要点是"观察与预期冲突时先怀疑什么"，而不是工具清单
- **macOS 按要求拆两代**：KEXT（`Info.plist` 先行 → selector map 优先 → **AuxKC 版本坑** → codeless kext → arm64e PAC）与 System Extension / DriverKit（**用户态进程模型**、激活与 entitlement 排错顺序：activated? → service? → entitlement/Team ID/sandbox → 才轮到 selector）
- **Linux 收录失败模式**：`.ko` 是 ET_REL（relocation 即信息）；四类"看着像坏"的合法形态（签名尾 / BTF 与 split BTF+`.BTF.base` / RANDSTRUCT / livepatch `.klp.rela`）；**5.7 起 `kallsyms_lookup_name()` 不再导出给模块**；rootkit **cross-view**（`lsmod` 干净 ≠ 没有 + hook 落点不止 syscall table）
- **Android**：GKI vs vendor module、protected symbol（KMI 白名单：构建期检查 `check_buildtime_symbol_protection.py` + 运行期拒绝加载）、**KMI 分支不可互换**（`android12-5.10` ≠ `android13-5.10`）、模块位置与 `modules.load` 计划
- **采集侧同步**（[[re-sample-acquire]]）：Linux 分支加"内核态载荷采集"（cross-view、内核 text 与磁盘副本 diff、hook 落点、采集时机、授权边界）；macOS 分支加"KEXT/DEXT 采集"（DEXT 按用户态进程处理、kext 先对齐 AuxKC 运行版本、内核内存读取的 SIP 现实）
- **核验（8 项上游）**：kprobes 文档（"通常由 kernel module 注册"）、5.7 unexport 提交、`CONFIG_DEBUG_INFO_BTF_MODULES` 与 distilled `.BTF.base`（仅外置模块生成）、`TAINT_RANDSTRUCT` 与配置名、livepatch 节格式与 `SHN_LIVEPATCH`、AuxKC 与 LocalPolicy 字段、Android protected symbol/KMI 分支、dext 安装路径与 userclient entitlement。**两处口径修正**：① 5.7 的变化是"停止导出"而非 kallsyms 格式变更；② RANDSTRUCT 的**配置名**是 `CONFIG_GCC_PLUGIN_RANDSTRUCT`（`T` 是 taint 字符）
- **结果**：`npm test` 40 项通过；`OK: 122 skills validated`
- **顺带发现（系统性问题，未修）**：references **同名文件普遍**——`gotchas.md` 33 个、`decision-tree.md` 13 个，导致 `[[gotchas]]` 一类链接在多技能间**歧义**（validate 只检查"存在"不检查"唯一"）。候选规则：references basename 全局唯一，或链接限定技能前缀——待定

### 批 3 补充 9：seL4 分析分支（#46，用户提供，已落地）

- **背景**：用户指出 seL4 的经验更特殊——核心**不是"内核模块怎么逆"，而是"如何不把 capability 系统的行为误判成普通 OS 行为"**；此前 seL4 只落在采集侧（[[re-sample-acquire]] 的 monitor 视角），分析侧无覆盖
- **形态**：`re-kernel` 新增第五个平台分支 `references/sel4-kernel.md`（**201 行，五个分支中最大**，印证"特殊情况密度可能高于 Linux LKM"）；SKILL.md 平台差异表加 seL4 行、失败模式决策表加 3 行（CPtr 本地地址 / MCS 卡住 / IRQ 只来一次）；[[re-sample-acquire]] 的 platform-sel4.md 加"方法侧入口"互链
- **内容**（16 节 + 压缩决策树）：先识别运行模型（root task / 裸 libsel4 app / capDL / CAmkES / MCS / VM）→ **CPtr 是 CSpace 本地地址不是全局 ID**（跨 component 必须按 **kernel object** 对齐）→ capDL-loaded 不照搬 root-task slot 语义 → CAmkES glue 折叠 → badge（身份 vs bit 聚合事件）→ CSpace guard/depth 与 FailedLookup 四分类 → **错误码即诊断**（DeleteFirst=目标非空 / RevokeFirst=有派生 / FailedLookup=index·depth·类型）→ Untyped 非 malloc（2^n 对齐、Revoke 父 untyped 才可重用）→ **device untyped 只能变 Frame** → IRQ 走用户态（未 ack 不再送）→ **DMA 旁路不在 isolation proof 内** → fault 是 IPC（反复同一 fault = handler 没修）→ MCS（SC/budget/passive server/reply object/捐赠链被打断）→ capDL snapshot cross-view → capability 图必须带 rights
- **核验（上游）**：seL4 manual（CSpace 与 CNode guard/depth 语义、错误码定义、**"device untyped 只能 retype 成 frame 或子 untyped"** 及附加限制）；MCS 发布说明与提交（SC = budget/period、passive server 依赖 client 捐赠、reply object 取代 `SaveCaller` 并跟踪捐赠、timeout fault、**链中 reply object 被撤销则 SC 回不到发起者**）；debug API（`seL4_DebugSnapshot` 输出 capDL、`seL4_DebugCapIdentify` 返回 cap 类型号）；capDL loader 与 root task 初始环境（slot 2/3 语义、初始 CNode guard 恰好解析 32 位）
- **核验中的三处精化**：① `seL4_DebugSnapshot` 据 devel 列表是**二进制命令/响应协议**（等命令字 0xa0–0xff、回传二进制），不是人类可读文本转储；② device untyped 的限制**不止**"只能变 Frame"——device frame 还不能作 IPC buffer、不能建 ASID pool、ARM 上不能做可执行 frame，且 device 属性会被子 untyped 继承；③ Linux 侧同批核验中确认 5.7 的变化是 `kallsyms_lookup_name()` 停止导出（非格式变更）
- **结果**：`npm test` 40 项通过；`OK: 122 skills validated`

### 批 3 补充 10：references 同名歧义治理（#47，用户决策，已落地）

- **决策**：`[[gotchas]]` 这类跨技能裸链有歧义（`gotchas.md` 33 个、`decision-tree.md` 13 个）——用户在"basename 全局唯一"与"链接限技能前缀"之间选了**后者**
- **规则**：技能链接 `[[re-xxx]]`；**裸 references 链接 `[[文件名]]` 必须落在本技能 `references/` 内**；跨技能引用必须写 `[[re-xxx/文件名]]`（validate.mjs 强制，**references 文件内同样校验**——此前只查 SKILL.md 正文）
- **迁移**：**471 处**跨技能裸引用加前缀（`platform-tips` 347、`analysis-contract` 104、`anti-dynamic-workflow` 10、`frida-scripts` 8、`rerouting` 1、`sel4-kernel` 1）；**287 处**本技能内引用保持裸链；2 处重命名遗留（re-kernel 的 gotchas/decision-tree）改为指向同技能新名
- **校验器改动**：链接检查重写为三态判别（技能 / 跨技能 references / 本技能 references），并把校验范围从 SKILL.md 正文**扩展到 `references/*.md`**（跨技能引用多在这边）
- **占位符约定**：文档里写示例用尖括号形式 `[[re-<技能名>]]` / `[[<文件名>]]`——不会被解析成真链接（改动过程中 capabilities.md 的格式说明自己触发过一次断链报错，即此问题）
- **反向验证**：在 `re-kernel/references/windows-gotchas.md` 里写裸 `[[platform-tips]]` → `FAIL: re-kernel/references/windows-gotchas.md: broken [[platform-tips]] link（裸 references 链接须在本技能 references/ 内；跨技能请写 [[re-xxx/platform-tips]]）`；还原后 OK
- **结果**：`npm test` **41 项**通过（改 1 条链接规则用例 + 新增 1 条跨技能限定用例）；`OK: 122 skills validated`

### 批 3 补充 11：技能计数同步不完整（#48，用户发现，已修）

- **现象**：新增 `re-sample-acquire` 后，计数只在"记得的 5 处"同步（README/README_EN/AGENTS/package.json/marketplace.json + README 网关行），**漏了 5 处**：`CLAUDE.md` 3 处（技能总数、`OK: 121 skills validated` 示例、架构图"原子技能 108 个"）、README/README_EN 前言"12 大类网关 → **108** 原子技能"
- **根因**：① 同步清单本身是记忆产物，没有"计数出现点"的全量来源；② 自查 grep 用了"旧数+单位"的复合模式，对全角括号与措辞差异过敏 → **首轮扫描报"零命中"的假阴性**（真正的发现来自换用"数词散扫 + 逐文件人工核"）
- **修法**：5 处改为 122/109；历史记录（`TODO.md`、`docs/audit/`、`lib/frontmatter.mjs` 注释里的"104/121"等）保留原值——它们是当时事实
- **固化**：`CLAUDE.md` 的「新增/修改技能的标准流程」第 4 步从"同步 5 处"改为**逐处清单**（README 4 处 / README_EN 4 处 / AGENTS 2 处 / package.json / marketplace.json / CLAUDE.md 3 处），并写明自查方式与"不要用复合模式"的教训
- **核对**：实际结构 **122 = 1 entry + 12 gateway + 109 atomic**，与文档现值一致
- **结果**：`npm test` 41 项通过；`OK: 122 skills validated`

### 批 3 补充 13：macOS 低层分支加深（#49，用户提供，已落地）

- **背景**：用户补充 macOS 低层逆向的失败模式——macOS 的坑在于**三套完全不同的模型混在一起**（KEXT+IOKit 内核态 / DriverKit·DEXT 用户态 / System Extension 框架），且四个事实最容易让整条分析链跑偏：① codeless KEXT 可能根本没代码 ② 磁盘 KEXT 与当前运行的可能不是同一版本（AuxKC）③ arm64e 指针不能当普通 64 位指针（PAC）④ `IOServiceOpen` 失败可能停在 entitlement/activation 层，根本没走到 UserClient
- **形态**：`macos-kernel.md` 从 55 行扩到 **286 行**（现为该技能最大分支）；主干平台表 macOS 行改为「三套模型」，失败模式决策表加 3 行（符号化偏移 / kext 加载不了的完整条件 / UserClient 与 dispatch）
- **新增要点**（相对旧版）：`Info.plist` 的 IOKitPersonalities 匹配键全集与"Info.plist 先行"顺序；**IOKit class graph 优先于 call graph**（OSMetaClass/vtable；unresolved virtual calls 常因缺 kernel/superclass type universe）；dispatch 字段的 **`check` 前缀**与 `kIOReturnBadArgument` 可能是**框架层拒绝**（含 completion 需要有效通知 Mach port）；dext 的停手信号与按用户态调试；System Extension ≠ DriverKit 同义词；Host app 与 dext 两边都要逆；六态生命周期（bundle→registered→approved→activated→matched→started）；**Rosetta 不翻译 kext**（`KMErrorDomain Code=71`）；Kernel Collection；**panic 符号化的 `__TEXT_EXEC.vmaddr` 偏移**与 UUID/KDK build 匹配；UAKL / Reduced Security / AuxKC / SIP 与签名校验的关系；**KIP** 机制；rootkit 的年代差异（10.x Intel → 11+ Apple Silicon）；KEXT 双机调试 vs DEXT 本机调试
- **核验（6 项上游）**：Apple 文档的 dispatch 字段名（确认带 `check` 前缀，与 arguments 字段区分）、`kIOReturnBadArgument` 的端口成因（StackOverflow 实例为 `checkCompletionExists=true` + 错误端口）、panic 符号化 `__TEXT_EXEC`（Apple 开发者论坛 DTS 工程师答复，含 `otool`/`atos` 完整命令）、AuxKC/UAKL/1TR/签名校验（Apple 平台安全指南）、KIP 机制（内核初始化后启用、内存控制器拒写受保护区、MMU 双向限制、使能硬件启动后锁定）、Rosetta 不翻译 kernel extension（官方 Rosetta 文档 + `Incompatible architecture` 报错）
- **结果**：`npm test` 41 项通过；`OK: 122 skills validated`
- **体量备注**：`re-kernel` 现 **1094 行 / 8 文件**（主干 105 + 七份 references），已达"平台分支各自可成技能"的规模——是否拆分由用户判断，本轮未动

### 批 3 补充 14：Windows 驱动分支加深（#50，用户提供，已落地）

- **背景**：用户补充 Windows 驱动分析的失败模式（33 点 + 决策树），核心是"**先识别 driver model，再恢复 callback / 设备栈 / I/O 路径**"，并点名七个最易产生事实性错误的点（把所有 `.sys` 当 WDM / `GsDriverEntry` 当入口 / `MajorFunction` 空当"无 I/O" / 不知道 KMDF·NDIS·minifilter 的 callback registration / 不知道 IRP completion 是异步控制流 / 不知道 IOCTL 的 Method 决定 buffer 语义 / 2026 年仍用旧签名假设）
- **形态**：`windows-kernel.md` 从 76 行扩到 **501 行**（技能内最大文件）；同时**接回两个旧 Windows reference 的链路**（`windows-gotchas` / `windows-decision-tree` 在重写后一度成为孤儿——它们含独占内容：版本差异组与证据分级，故补链而非删除）
- **新增要点**：驱动模型分类（WDM/KMDF/UMDF/minifilter/NDIS/StorPort/PortCls/AVStream）；`GsDriverEntry`；WDM 的 `DRIVER_OBJECT` 赋值图；KMDF 的 Evt* 与 `WDF_*_CONFIG` dataflow（`!drvobj` 指 Wdf01000.sys 属正常）；miniport 架构与 NDIS callback 图（网卡驱动无 READ/WRITE 正常）；device stack 与 **INF 的栈位置**（UpperFilters/LowerFilters/AddFilter）；minifilter 的 altitude 与 pre/post 流水线；`CTL_CODE`/`METHOD_*` 语义与 **NEITHER 用户指针**；**completion edge 与 `STATUS_PENDING`**；`PAGE` section 的 IRQL 语义与偶发 0xD1；**Driver Verifier 的故障注入**与 0xC9 的追链法；PE relocation；PDB public≠private 与 signature+age；`!analyze -v` 只是入口；**UMDF/Wudfhost**（`!wdfkd.wdfumdevstacks`、`%ProgramData%\Microsoft\WDF`）；**2026 驱动签名策略**；**HVCI 兼容要求**与 Test Mode 仍需签名；x64 patching 禁忌；callback-registration graph；IRP flow graph；minifilter unload 四态
- **核验（3 项上游，均带时间点）**：① Microsoft Windows Driver Policy——**2026-04 安全更新后旧 cross-signed 驱动默认不再受信**，默认只认 WHCP 签名（另有 curated allow list）；**先行评估模式**（约 100 小时运行 + 2–3 次启动相关条件才转强制；期间发现不合规驱动则继续评估并重置计数）；企业可用 Application Control for Business 覆盖（须由 Secure Boot PK/KEK 权威签名）；适用 Win11 24H2/25H2/26H1 + Server 2025。② HVCI 官方 checklist（NX 默认、`NonPagedPoolNx`、不用 W+X 段、不直接改可执行系统内存、**内核不用动态代码**、数据不当代码、0x1000 对齐）+ **Test Mode 在 HVCI 下仍要求签名**（失败码 0xC0000428 / CodeIntegrity 219）+ Microsoft 计划 **2026-10-13** 起在符合条件设备默认启用 Memory Integrity。③ UMDF（`!wdfkd.wdfumdevstacks` 的 `!process`→`.process /P`→命令工作流；dump 路径 `%ProgramData%\Microsoft\WDF`，UMDF 2.15/Win10 1507 起；WER 三类事件 WUDFHostProblem/UnhandledException/VerifierFailure；`wdfumtriage`/`wdfldr`/`wdfumirps`/`wdflogdump`）
- **结果**：`npm test` 41 项通过；`OK: 122 skills validated`；re-kernel 全部 references 均可达（孤儿检查通过）
- **体量**：`re-kernel` 现 **1522 行 / 8 文件**（windows-kernel 501 / macos 286 / linux 277 / sel4 201 / android 42 + 主干 108 + 两份 Windows 附录）——拆分与否待用户决定

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

批 1（#1–#16）、批 2（#17–#21）、批 3（#22–#36）共 36 项**已全部修复**，状态 **fixed（待复核）**；#37 为误报未改；工程性问题（历史文档污染）已按上述三层缓解处理。

- 涉及文件 28 个（技能 SKILL.md 21 + references 7），其中 Frida 17 横向迁移覆盖 9 个文件（批 1+2）；批 3 另改 10 个技能文件（含 2 个 references）+ 历史存档 2 处 + `docs/superpowers/README.md` + `CLAUDE.md`
- 校验：`npm test` 通过（`OK: 121 skills validated` + 25 项单测）；grep 复核确认已移除 API 无残留（保留的"旧写法"文字均为迁移说明性注释）
- 复核入口（后续波次）：按状态机 fixed → verified 逐项复核；重点复核两处语义选择——① Frida 迁移中 `find*`（返 null）与 `get*`（抛异常）在各示例语境下是否选得恰当；② re-forensics 转储分流的表述是否与实际 [[re-mem-forensics]] / [[re-memdump]] 边界完全一致

## 后续机制建议（来自同一审查，待评估）

审查提出把验证体系分四层：Syntax → API/CLI validity → Format/spec assertion → behavior fixture，即对 API 名做静态符号表比对、对 CLI 示例跑 `--help`、对格式常量做 spec 断言、对关键结论建最小 fixture（如生成最小 safetensors 验证前 8 字节、起 `-S -s` QEMU 验证 $pc、用脱敏备份验证 fileID 派生）。

可选落点：与 TODO「增量审查机制」合并设计——finding 记录（本文档格式）+ 高风险技能的 fixture 子集，先覆盖 ABI/offset/格式字段/API 名四类断言。

---

## 补充 15：特殊系统深化波次（2026-09-13，QNX / Fuchsia-Zircon / UEFI-PI / VxWorks / Zephyr / RTEMS / FreeBSD / illumos）

来源为外部整理的特殊系统调研（8 个系统的"核心模型 + 最危险误判"），按**每一条具体机制先核验上游、再入库**处理。本波次**不是缺陷修复**（原文无事实性错误），而是**事实补全与边界条件补足**，性质同"补充 1–14"。

### 落地位置（8 → 3 个技能，不新增技能）

| 系统 | 落点 | 形态 |
|---|---|---|
| QNX Neutrino | `re-rtos/references/qnx.md` | 新增分支（该技能原为单文件） |
| VxWorks | `re-rtos/references/vxworks.md` | 新增分支 |
| Zephyr | `re-rtos/references/zephyr.md` | 新增分支 |
| RTEMS | `re-rtos/references/rtems.md` | 新增分支 |
| UEFI / PI / EDK2 | `re-uefi/references/pi-stages.md` | 新增分支（该技能原为单文件） |
| Fuchsia / Zircon | `re-kernel/references/zircon-kernel.md` | 新增分支（与 sel4-kernel 并列为 capability 系统） |
| FreeBSD | `re-kernel/references/freebsd-kernel.md` | 新增分支 |
| illumos / Solaris | `re-kernel/references/illumos-kernel.md` | 新增分支 |

挂载点：`re-rtos` / `re-uefi` / `re-kernel` 的 SKILL.md（运行模型差异表 / 阶段判定表 / 失败模式决策表 / 分支指针）；`re-analyze/references/rerouting.md` A 表新增 9 条"异常信号 → 换路"行。

### 核验中发现并写入的**边界条件修正**（通行说法不完整之处）

| # | 常见说法 | 核验后的准确表述 | 依据 |
|---|---|---|---|
| 1 | FreeBSD linker set 是 `struct linker_set {ls_length, ls_items[]}`，以 NULL 结尾 | 那是 **a.out 时代**的结构；**现代 ELF** 由 `__start_set_<名>` / `__stop_set_<名>` 定界，**列表不再以 NULL 结尾**——按结尾 NULL 扫描会越界；且 2001 年起宏已隐藏实现 | freebsd-src 提交 f10fa038（"gensetdefs past its use-by date"）+ `sys/linker_set.h` 语义 |
| 2 | illumos `attach()` 的命令值包含 `DDI_PM_RESUME` | 现行文档命令值为 **`DDI_ATTACH` / `DDI_RESUME`**；`DDI_PM_RESUME` 属**已废弃的 PM 接口**（配套 `DDI_PM_SUSPEND`），**是年代线索而非标准写法** | `attach(9E)`（illumos/Oracle 现行页）+ `pm(9P)` 声明原 PM 接口过时 |
| 3 | QNX 服务端"继承客户端优先级" | 提升**可发生在发送时刻**（不等 server 收到）；**回复后不自动恢复**（直到被新消息/pulse 改变或显式设置）；另有 **server boost**（无 RECEIVE-blocked 线程时）；`ChannelCreate()` 的 **`_NTO_CHF_FIXED_PRIORITY`** 可关闭继承 | QNX《Priority inheritance and messages》《Server boost》+ `MsgSend()`/`ChannelCreate()` 参考页 |
| 4 | `zx_channel_write` 失败时 handle 归还原主 | **失败也会消费**（handle 被丢弃而非归还）——改动后语义为"始终消费"；另：`channel_write_etc` 的 `ZX_HANDLE_OP_MOVE`/`DUPLICATE`、rights 只能收窄、in-transit handle 随 channel 销毁而关闭 | Zircon `docs/handles.md`、`channel_write`（含 ZX-2204 语义变更）、`channel_write_etc` |
| 5 | `dlopen` 的 `RTLD_LAZY` 会推迟符号解析 | **RTEMS 上两者行为相同**：`dlopen` 返回前**全部重定位已完成**；且**未解析符号不导致失败**（需 `dlinfo(RTLD_DI_UNRESOLVED)` 查）、**重名符号判错**、不支持符号版本 | RTEMS `cpukit/libdl`（`rtl.h`）与 RTEMS C User's Manual 的 runtime link editor 章节 |
| 6 | DXE 侧"不应修改 HOB"是约定 | HOB 构造调用在 DXE 阶段**会断言失败**（PEI HOB 对 DXE 只读）；DXE 跨阶段状态只能走复位调用 | PI Spec Vol.1 §9（PEI to DXE Handoff）+ EDK2 `HobLib.h` 注释 |
| 7 | Zephyr 的 early init"不调用内核服务"是弱约定 | `PRE_KERNEL_1/2` **运行于中断栈的内核初始化上下文**，服务本就不可用——符合设计；反之出现线程/互斥/睡眠应先怀疑阶段判错 | Zephyr `include/zephyr/init.h` 的 level 语义 + 设备/`SYS_INIT` init 基础设施拆分 |
| 8 | VxWorks 模块"链接不完整"即损坏 | DKM（`.out`）**动态链接到内核符号表**，独立观察必然大量 unresolved；`undefined symbol` 的真实成因是 **VIP 未包含该组件**；同版本 ≠ 同 ABI 环境（随 VSB/VIP 变化） | VxWorks 7 SDK Application Developer Guide + VSB/VIP 构建说明 |

其余事实（QNX `dispatch_create`/`resmgr_attach`/`iofunc_*` 序列、io-pkt 的 `devnp-*.so` 与 `devnp-shim.so`、单线程栈上下文与 `nw_pthread_create`；DFv2 的 driver manager/host/index/runtime 与同驻本地通道；PI 阶段与 `DXE_RUNTIME_DRIVER` 生命周期、`EVT_SIGNAL_VIRTUAL_ADDRESS_CHANGE`/`ConvertPointer`；Zephyr iterable sections 与 LLEXT/`llext_add_domain`；RTEMS `confdefs.h`/`CONFIGURE_INIT` 唯一性与 `rtems_driver_address_table` 的 major=表索引；FreeBSD `SYSINIT` 排序键与 `SI_SUB_KLD` 合并时机；illumos `nulldev`/`nodev` 语义差异）均按上游文档或官方头文件核验后写入，逐条依据见各分支文末"工具与验证"。

### 本轮校验

- `node validate.mjs`：`OK: 122 skills validated`（含新分支的链接规则与路由能力校验）
- `npm test`：41 项全过；`node bin/capindex.mjs` 重生成后无差异（本波次未增删能力标签）
- 未做：行为 fixture（LLEXT 装载、io-pkt 加载、OVMF 阶段切换等需真实目标或构建环境）——沿用"后续机制建议"的四层体系，先落在可选层

---

## 补充 16：特殊系统第二批（2026-09-13，分层 hypervisor / 分区 RTOS / 组件 OS，18 类）

来源为同源的外部整编（"再往外一层"两批：10 类 + 8 类）。处理方式同补充 15：**逐条机制先核验上游再入库**，属事实补全与边界条件补足，非缺陷修复。

### 落地位置（18 → 4 个技能，不新增技能）

| 类别 | 系统 | 落点 |
|---|---|---|
| 分区/嵌入式 hypervisor | Xen、QNX Hypervisor、Jailhouse、ACRN、Bao | `re-hypervisor/references/{xen,qnx-hypervisor,jailhouse,acrn,bao}.md` |
| RTOS 家族 | NuttX、eCos、ThreadX Modules、FreeRTOS 上下文、INTEGRITY/ARINC 653/VxWorks 653/PikeOS | `re-rtos/references/{nuttx,ecos,threadx-modules,freertos-context,partitioned-rtos}.md` |
| 通用 OS 内核 | OpenBSD、NetBSD、Genode、MINIX 3、Plan 9·9front | `re-kernel/references/{openbsd-kernel,netbsd-kernel,genode,minix3,plan9}.md` |
| 汽车软件 | AUTOSAR Classic | `re-automotive/references/autosar-classic.md` |

挂载：4 个 SKILL.md（平台差异/运行模型表 + 失败模式决策表 + 分支节 + description），`rerouting.md` A 表新增 15 行。

### 核验中确认的**关键边界条件**（写入时以这些为准）

| # | 主题 | 准确表述 | 依据 |
|---|---|---|---|
| 1 | OpenBSD KARL | **变的是内核内部布局，不是加载基址**（与 KASLR 区分）；启动代码可被 unmap 或"trash"；**手工把内核拷到 `/` 会使重链接脱开**（分析环境≠生产环境） | KARL 原始设计公开讨论 + locore 固定/其余 `.o` 随机重排的实现描述 |
| 2 | OpenBSD pledge | 违规是**不可捕获的 SIGABRT**（非可捕获错误）；promise **只能削减不能恢复**，提升尝试返回 `EPERM`（继承 execpromises 场景下被忽略并返回成功）；**"不调用 pledge" ≠ `pledge("everything")`**；`error` promise 改为返回 `ENOSYS`；线索为 `ps` 状态 `p` 与 `lastcomm` 的 `P` 标志 | `pledge(2)` 手册页与其 ERRORS/承诺表 |
| 3 | NetBSD 模块路径 | `KERNEL_DIR` 是 **2025-04-28 起**（UPDATING 20250427）的**可选**构建选项，**仅 i386/amd64**；旧 `/stand/<arch>/<版本>/modules` 与新 `<内核目录>/modules` 并存；另有 kern/59394（内核仍以文件形式放在 `/netbsd` 时 `kern.module.path` 报错） | NetBSD UPDATING、`wiki.netbsd.org/kernel_dir/`、kern/59394 |
| 4 | Xen grant 撤销 | **映射期间 Xen 不支持撤销**：结束外来访问只阻止后续映射，须等 `GTF_reading`/`GTF_writing` 清零；grant reference = 本域 grant table 条目下标（条目含 flags/domid/frame-MFN） | Xen `docs/misc/grant-tables.txt` + 接口文档 |
| 5 | Xen event port | 端口整数**绑定到每 guest `shared_info` 的位掩码**（32 位 guest 1024 位、64 位 guest 4096 位）；**迁移/重连时稳定的是 remote port**，本地端口重新分配，且解绑后**可被重用** | 相关提交（save remote evtchn port, not local port）+ event channel 文档 |
| 6 | QNX Hypervisor shmem | 工厂页**写 `size` 才触发创建**（首次使用时创建 → **各 guest 启动顺序无关**）；共享区可表现为 MMIO 或 PCI（默认 PCI）；**直通设备同一时刻只允许一个 resident 访问** | QNX 8 文档：shmem vdev、factory/control pages、configuring guests |
| 7 | Jailhouse loadable | `JAILHOUSE_MEM_LOADABLE`（0x20）区域的映射**在 cell 启动时被撤销**；重装走 **Cell Set Loadable**（错误码 `-EPERM`/`-ENOENT`/`-EINVAL`，root cell 不可设为 loadable） | jailhouse `cell-config.h` + `control.c`（`cell_start`/`cell_set_loadable`） |
| 8 | Jailhouse ivshmem | **设备不维护 pending 语义**：MSI-X 的 Pending Bit Array **恒返回 0**，INTx 的 Interrupt Status 位**从不置位**；事件状态应**从共享内存协议推导**；one-shot 模式下中断投递会清 Interrupt Control 的 bit 0；Doorbell 只写、读未定义 | `ivshmem-v2-specification.md` |
| 9 | ACRN ivshmem | **dm-land 与 hv-land 可同时存在但永不互通**；前缀 `dm:/`（早期 `sos:/`）与 `hv:/`；**通知只在 hv-land 支持**（dm-land 无 doorbell）；dm-land 下 guest 重编程 BAR2 会使共享内存不可用 | ACRN ivshmem HLD 与 enable_ivshmem 指南 |
| 10 | Bao 共享 identity | identity 是配置里的 **`shmem_id`**（IPC 的 `base` 只是本 VM 映射地址，**不应据地址相等/不等推断**）；IPC `size ≤ 对应 shmem 大小`；**cache coloring 默认未启用**、随平台可用颜色数截断、代价是**丧失大页**并抬高 TLB 压力 | Bao README/config 结构与 cache coloring 评估材料 |
| 11 | NuttX 双堆 | 两个具体配置项（`CONFIG_MM_MULTIHEAP` + `CONFIG_MM_KERNEL_HEAP`），**`MM_KERNEL_HEAP` 在 flat 构建下默认关闭**；PROTECTED 的用户 API 由 `syscall/syscall.csv` 经 `tools/mksyscalls` 自动生成；驱动 upper half 在 `drivers/`，lower half 在 `arch/` 或 `boards/` | NuttX `mm/Kconfig`、Protected Build 指南、Device Drivers 文档 |
| 12 | FreeRTOS 细节 | `pxHigherPriorityTaskWoken` **自 V7.3.0 起可选（可传 NULL）**，但取舍不同；`portYIELD_FROM_ISR` 通常是 **pend（Cortex-M 走 PendSV），真正切换在中断退出后**；MPU 区域**大小与对齐必须是同一个 2 的幂**；降权到用户模式**不可回退** | FreeRTOS 官方 API 参考（队列/MPU）与端口文档 |
| 13 | ThreadX Modules | preamble **必在模块第一个地址**；properties 位区分特权/用户模式与 MPU/共享内存，并编码编译器 ID；**ARM 上非特权模块经 SVC 陷入**；支持 **XIP**（指令在 Flash、数据在 RAM）；**模块线程栈顶有线程入口信息结构需计入栈用量** | eclipse-threadx/rtos-docs 的 threadx-modules 第 1/2 章 |
| 14 | eCos 三层 | ISR 返回 `CYG_ISR_CALL_DSR` 时调度 DSR；**DSR 会被调度器锁推迟**；**ISR 不允许使用 DSR 级锁**；**DSR 可 signal 条件变量但不能 wait** | eCos 参考手册：同步与驱动接口章节 |
| 15 | ARINC 653 / PikeOS | COLD_START 与 WARM_START 的差别是**是否需要从非易失存储器拷代码到 RAM**；初始化模式（COLD/WARM）下**只有主进程可调度**；**refresh（周期）只对采样模式的接收有意义**；PikeOS 的 **APEX 服务经链接在固定地址的 API table 进入**，POSIX 内核把用户线程映射到**每核一个** system thread，分区支持 256 优先级 | ARINC 653 分区模式状态机材料、SYSGO POSIX/ARINC 653 产品文档 |
| 16 | INTEGRITY | 内核空间**不做动态内存分配**，且**内核内存不用于消息/信号量等由进程请求创建的对象**；启动表定义资源归属、连接静态分配且不可绕过；多核共享资源争用可使 **WCET 增加 8–13 倍** | Green Hills INTEGRITY / INTEGRITY-178 tuMP 产品与安全材料 |
| 17 | AUTOSAR `E_OS_ACCESS` | 确切条件：**对象未在配置时授予访问权**，或**对象属于另一个不处于可访问状态的 OS-Application**；**trusted 与非 trusted 一视同仁**（默认拒绝）；例外是检查类服务（`CheckObjectAccess` 等） | AUTOSAR OS SWS（SWS_Os_00056 / OS448 / OS509）与 RTE SWS |
| 18 | MINIX 3 | 消息载荷**定长 56 字节**，超出部分走 grants；**`EPERM` = grant 无效**（含"页表走查失败也报 EPERM，以免 grantee 探测 granter 地址空间"），**`EFAULT` = 未映射**；live update 的授权方向是**内核（仅）授予新进程对旧进程地址空间的只读访问**，且**可回滚**、**旧/新实例可能同时存在**；活跃 direct grants 会使更新复杂化 | `minix/include/minix/ipc.h` 与 `safecopies.h`、MINIX 3 消息传递 wiki、live update 指南与相关论文 |
| 19 | Genode | **quota 捐赠沿 session 路径被逐级扣减**（"系统还剩内存"与"该 child OOM"不矛盾）；**ROM session 在生命周期内可更新**（配置可动态改变）；服务名只在局部 parent 层级成立、label 可被重写 | Genode 架构文档（Interfaces and Mechanisms）、Foundations 手册 |
| 20 | Plan 9 | **union 只有单层叠加**（查找返回第一个匹配，上层不存在的名字不会落到下层深树）；`bind` 的 `new` **在 bind 时求值**；`/srv` 是服务注册表；9P 的 **fid 是 session 内 client 侧句柄**（walk 绑给 newfid，库层拒绝重用已存在 fid） | `bind(1)`、`9p(2)`/`9p(3)`、`srv(3)` 手册页与 lib9p 文档 |

### 本轮校验

- `node validate.mjs`：`OK: 122 skills validated`；`npm test`：41 项全过
- 分支挂载完整性检查：`re-rtos` 9 / `re-hypervisor` 5 / `re-automotive` 1 个 references 文件均有 SKILL.md 入链（`re-kernel` 的 `windows-gotchas` / `windows-decision-tree` 由同目录 `windows-kernel.md` 互链，非孤儿）
- 未做：行为 fixture（KARL 重链接、Xen 迁移端口、MINIX live update 等需真实环境）

---

## 补充 17：跨系统误判总表 + 第三批特殊系统（2026-09-13）

来源为同源的外部整编"合并后完整版本"：前半部分是**跨系统的总原则**（十类高频误判、共同规律、异常处理树），后半部分是**更多冷门系统**。两类内容分别处理。

### 一、跨系统总原则 → 新的入口级控制文件

新建 **`re-analyze/references/cross-system-models.md`**（跨系统运行模型与误判总表），内容：

- **十类高频误判表**（现象 → 不要直接推断 → 必须先排除）
- **共同规律 A–E**：本地句柄≠全局标识、ready≠有资格运行、无内核入口≠无 I/O、无 CFG 边/syscall≠没发生、磁盘≠运行
- **跨系统异常处理树**（函数无 caller / 地址不一致 / 驱动无内核入口 / 线程不执行 / IPC 无 syscall / 内存访问故障 / binary 存在但不运行 / runtime≠disk）
- **使用方式**：核对手段统一为 cross-view + configuration + runtime verification

挂载：`re-analyze/SKILL.md` 第三步加入「**跨系统误判表（判定前强制前置）**」——**任何要写 hook / dead code / loader bug / 恶意 的时刻，先逐项排除该运行模型允许的正常机制，未排除完不写结论**。

### 二、新增系统（22 类）的落地位置

| 类别 | 系统 | 落点 |
|---|---|---|
| 通用 OS 内核 | HelenOS、Redox、Haiku、z/OS、IBM i、OpenVMS、Unikraft·MirageOS | `re-kernel/references/{helenos,redox,haiku,zos,ibmi,openvms,unikraft-mirageos}.md` |
| RTOS | µC/OS、SYS/BIOS、SAFERTOS、CMSIS-RTX5、T-Kernel、TOPPERS、OSE·OSEck、Nucleus、Deos | `re-rtos/references/{ucos-sysbios,safertos-rtx5,tkernel-toppers,ose-oseck}.md`；Deos 并入 `partitioned-rtos.md`；Nucleus 入 SKILL.md 运行模型表（内容量不足以成篇） |
| Hypervisor | Hyper-V·VMBus、XtratuM、LynxSecure、Quest-V | `re-hypervisor/references/{hyperv-vmbus,xtratum,lynxsecure-questv}.md` |
| 汽车 | AUTOSAR Adaptive | `re-automotive/references/autosar-adaptive.md` |

`rerouting.md` A 表新增 13 行。

### 三、核验后的关键事实（写入依据）

| 主题 | 核验后的表述 |
|---|---|
| HelenOS fibril | fibril 由**用户态库协作调度**，**内核完全不知道其存在**；devman 在用户态按 match id 评分匹配并启动驱动，`driver_ops` 由**通用连接处理器**在来连接时调用 |
| Redox 句柄 | 内核把文件操作转成 **SQE/CQE** 消息；**scheme 侧 handle 描述符与客户端 fd 不是同一个**（内核在 `(进程, fd)` 与 `(进程, handle)` 间映射）；provider 初始化后常进入 **null namespace**（安全设计） |
| Haiku 两层模块 | **driver module（`driver_v1`，绑定节点、认领 I/O 资源）与 device module（`device_v1`，暴露 `/dev` 接口）**；`B_FIND_CHILD_ON_DEMAND` 决定按需搜索；`suspend`/`resume` **从不被调用** |
| Hyper-V GPADL | GPADL 是**描述并映射客户机缓冲区的句柄**；宿主对经 GPADL 共享的内存总量有上限（WS2019+ 约 1280 MB，更早约 384 MB） |
| Hyper-V SR-IOV | **VF 数据面不经过 VMBus 与 hypervisor**，而 **VF 控制面仍走 VMBus** 回到 PF 驱动；拆除时 NetVSC 从 VF 解绑并迁回软件合成路径 |
| SAFERTOS ESM | ACP（限制可调 API）与 OACP（限制可访问对象）**各自独立**；**间接对象 ID + 交叉引用表**取代指针式句柄；per-task 区域**大小须为 32 字节倍数、基址 32 字节对齐**，**每次上下文切换重新编程** |
| CMSIS-RTX5 | Safety Class 的**动机**：RTOS 对象经"以数字 ID 为参数、在 handler 模式执行"的系统调用访问，**单靠 MPU 可被"用别的对象 ID 调 API"绕过**；**中断处理程序绕过 MPU 保护**；**ISR FIFO 溢出时系统状态已不一致**，对策是增大对象尺寸 |
| µC/OS | `OSIntEnter`/`OSIntExit` **必须成对**且前者不得由任务级代码调用；**只有最后一个嵌套 ISR 退出时**才判断切换；Cortex-M 上切换仅触发 **PendSV**；直接递增计数只在"递增时中断已关闭"的架构安全 |
| SYS/BIOS | **`Swi_disable()` 会连带禁用 Task 调度器**；Swi 调度器禁用期间**绝不能调用阻塞 API**（会不可恢复地损坏 Task 调度器状态）；**Hwi 与 Swi 共用系统中断栈**（默认 4096 字节） |
| T-Kernel | 三种上下文（任务/准任务/任务独立）**合法性由规范规定**；设备驱动的六个处理函数**以准任务部分运行、必须可重入、且不保证互斥**；`tk_wai_dev` **只等待调用时刻正在处理的请求**，超时后处理仍在继续 |
| TOPPERS | 四家族（ASP3/HRP3/FMP3/**HRMP3**）规范分开规定；HRMP3 就绪队列**按保护域 + 按处理器**；内核内**不做动态内存管理** |
| AUTOSAR Adaptive | **Modelled Process ≠ OS 进程**，不可 1:1 比较；状态是"键"、清单是"表"、进程集合是"查表结果"；EM 启动后**不再自行发起**状态切换 |
| Deos | 同一系统内**三类调度模型并存**（ARINC 653 APEX / RMS / POSIX），多核用 **BMP + 缓存分区** |
| XtratuM | **Plan 0 保留给初始化、Plan 1 保留作维护**；计划切换在**当前计划剩余槽执行完之后**；**IPVI 每分区最多 8 个**；固定优先级**数值 0 最高** |
| LynxSecure | 官方表述为**静态配置 + 固定资源分配 + 无中央管理内核 + 无共享内存 + 无集中调度**；（"初始化划分的 setup code 被移除"一说**未获公开资料证实，未写入**） |
| Quest-V | **每个 sandbox 一个 monitor**（而非一个中央 hypervisor）；monitor 只在引导、故障恢复、建通道、初始化影子页表时介入；**设备中断直接投递给 sandbox kernel**；**无全局时钟**，跨 sandbox 时间戳不可直接比较 |
| Unikraft | **native（API 兼容，syscall 变廉价函数调用）与 binary-compatible（捕获 Linux ELF 的 syscall）两条路线**；**非 PIE 决定地址布局且限单应用** |
| MirageOS | 同一份源码换目标，**差别只在一个被替换的平台主模块 + 目标包集合** |
| OpenVMS | 完成顺序为 **写 IOSB → 置事件标志 → 触发 AST**；**AST 不中止进行中的系统调用**；进程等待时 AST 投递后**原等待会被重新执行** |
| z/OS | **SRB 不能调用 SVC（除 ABEND）或 WAIT**；**home 地址空间在整个执行期不变，`PSAAOLD` 总指向 home**；跨地址空间使用 TCB 指针是经典 **S0C4-11** 成因 |
| IBM i | 内存与辅存**构成单一 64 位地址空间**；对象**按名字而非硬件地址**访问 |
| OSE / OSEck | LINX **统一核内/处理器间/板间通信**，支持共享内存/DMA/RapidIO/以太网/PCI，**零拷贝共享内存**；（其 **XIP 能力本次未获证实，已在文件中标注"不要断言"**） |
| Nucleus | **MMU（Cortex-A）/MPU（Cortex-M）子系统隔离 + 线性内存映射 + 动态 reload/restart/update 而不停机** |

### 四、本轮校验

- `node validate.mjs`：`OK: 122 skills validated`；`npm test`：41 项全过
- 分支入链检查：`re-kernel` 22 / `re-rtos` 13 / `re-hypervisor` 8 / `re-automotive` 2 个分支文件均有 SKILL.md 入链（`windows-gotchas`/`windows-decision-tree` 由同目录互链）
- **两处未证实内容已明确标注而非照写**：OSE 的 XIP、LynxSecure 的"setup code 被移除"
- 未做：行为 fixture（fibril 调度、SR-IOV 切换、AST 投递等需真实环境）

---

## 补充 18：14 个分支的深度展开 + Nucleus 新增 + 入口速查表（2026-09-13）

来源为同源外部整编的第三份材料：对 14 个系统的**机制级展开**（心智模型 → 特殊情况 → 下一步查什么）与一张汇总速查表。处理方式：**逐条核验后并入对应分支**，不新增技能（Nucleus 内容量已足以成篇，新增 1 个分支文件）。

### 一、落地位置

| 动作 | 对象 |
|---|---|
| **新增分支** | `re-rtos/references/nucleus.md`（线性映射 + entitlement / 固定块内存池 / 动态模块生命周期） |
| **深度展开** | `autosar-adaptive`（清单三件套 / 服务发现 / PHM / UCM / Persistency）、`xen`（通知抑制 / 睡前再检查 / FIFO 事件 ABI / 迁移身份）、`hyperv-vmbus`（GPADL 删除阻塞 / packet 生命周期 / 外部数据待决）、`partitioned-rtos`（Deos 两级调度 / slack / SafeMC / 排错顺序）、`ucos-sysbios`（调度器锁嵌套 / 信号量与互斥量 / 定时器任务上下文 / PendAbort）、`safertos-rtx5`（权限模型 / ESM 拒绝语义）、`xtratum`（两种切换时机 / 采样刷新 / 掩蔽扩展中断）、`acrn`（MSI-X trap 路径三态 / 设备归属迁移）、`lynxsecure-questv`（LynxSecure 官方表述）、`unikraft-mirageos`（启动表 / shim 三层符号 / Lwt / 目标指纹） |
| **入口级扩充** | `re-analyze/references/cross-system-models.md` 新增**异常速查表（约 40 行，按现象直查）** 与**版本/代际提示**节 |

`rerouting.md` A 表新增 7 行。

### 二、本轮核验后的关键事实

| 主题 | 核验后的表述 |
|---|---|
| **AUTOSAR PHM** | 以**进程粒度**监督（不是任务级）；三类监督 Alive（周期内检查点数量）/ Deadline（起止检查点耗时区间）/ Logical（检查点顺序符合监督图，与时间无关）；本地状态含 **EXPIRED（终态）**；**监督模式 = `<machine state, function group state>`**；恢复动作含"请求看门狗驱动复位"；**PHM 自身不启停进程**；**PHM 还监督 EM 守护进程存活，其失败升级为看门狗/机器复位** |
| **AUTOSAR Persistency** | `keepExisting` / `overwrite` / `delete` 三策略 + 清单约束（前两者要求存在初始值，`delete` 要求不存在）；**版本比较：清单版本更低时回滚**（存在有效备份时） |
| **AUTOSAR 服务发现** | `FindService` 允许返回空；可用性变化时重新回调且**实现负责串行化同一 handler**；handle 可指向**远端** service instance |
| **Xen 通知抑制** | 推送宏**只有越过对端设置的 `req_event` 阈值时才通知**；消费侧"无工作 → 设阈值 → 全屏障 → 再查"是**防丢唤醒**的协议核心（并附已知的索引回绕副作用与 NAPI 场景副作用） |
| **Xen FIFO 事件 ABI** | 优先级 **0 最高 / 15 最低（默认 7）**，每 VCPU 16 个队列；事件字含 **PENDING / MASKED / LINKED / BUSY**；**unmask 在 PENDING 时必须投递通知**；**存在 2-level 与 FIFO 两套 ABI，记账布局不同**；**初始化控制块不会重投当前 pending 事件（会丢），应在绑定事件之前完成** |
| **Hyper-V GPADL** | **删除在 GPADL 仍被 server 映射时会阻塞直到解除**；从 buffer 创建时该 buffer 被 probe 并锁定直到 GPADL 销毁 |
| **Hyper-V packet 生命周期** | 完成调用**可立即也可稍后**发起，直到它被调用才清理映射/释放缓冲/（按需）发送完成 packet——**回调返回不是释放边界** |
| **Hyper-V 外部数据** | 需要分页时返回 **STATUS_PENDING**，**必须从回调返回**，之后**可能在不同 IRQL 再次回调**；返回的 MDL **已锁定、不带任何虚拟地址、在完成调用时失效**且由内核库释放 |
| **Nucleus** | **线性内存映射 + 受保护区域 + entitlement**（Cortex-A 用 MMU、Cortex-M 用 MPU）；**`NU_PARTITION_POOL` 是固定大小块分配器**（与"空间隔离域"同名的术语坑）；**分配是 O(1)、不可能碎片化，唯一失败模式是池耗尽**；`NU_SUSPEND` 下池空则任务挂起；非任务线程只能用 `NU_NO_SUSPEND` |
| **µC/OS 定时器** | 回调**在内部定时器任务上下文中执行**（不是中断、不是创建者任务）、**使用定时器任务的栈**、且**绝不能阻塞/等待**（回调串行执行，阻塞会卡住整个定时器子系统） |
| **µC/OS PendAbort** | 中止等待是**让任务就绪**而非正常投递；**只能由任务调用**；被唤醒任务带"等待被中止"的错误码返回 |
| **Deos SafeMC** | **两级调度**：Level 1 是**跨核对齐的执行窗口**，Level 2 为每个核/window 指派 scheduler（ARINC 653 / Deos RMA / POSIX）；**Slack 通过滑动时间窗实现**（窗口可压缩/扩张/滑动）；**cache partitioning 为软件实现、做到应用/分区级、免去分区切换的 cache flush**，与内存池互补 |
| **XtratuM** | 普通 plan 切换**要等当前计划槽跑完**，而**健康监控切维护计划可立即发生**（终止当前槽）；同 MAF 内多次请求可**最后一次生效**；采样端口刷新周期决定新鲜度、旧数据可标无效；**扩展中断在分区启动时默认掩蔽** |
| **ACRN MSI-X** | **三类 VM 的 trap 路径不同**（Service VM → hypervisor handler；post-launched → Device Model handler 再涉及 hypervisor；pre-launched → hypervisor handler）；设备所有权在 Service VM 与 post-launched VM 之间**双向迁移** |
| **Unikraft 启动表** | 三类表（早期 / 构造 / 初始化）+ **七级顺序（构造→早期→平台→库→rootfs→系统→晚期）**、**每级 10 个优先级**、条目在按名字排序的专用链接段中 |
| **MirageOS Lwt** | 协作式轻量线程 + 事件循环；**不让出会饿死整个事件循环**（不需要互斥量或内核死锁）；后台异常交给 async 异常处理器，行为取决于其配置 |

### 三、未证实 / 未直接命中的内容（已按此处理）

| 内容 | 处理 |
|---|---|
| LynxSecure"用于初始配置的特权 setup code 随后被丢弃" | **未证实**——改为写入官方明确表述的部分（不可变 boot 分区、内核功能仅限分区/数据流/状态调解、I/O 全导出到 guest、无管理控制台登录、无动态系统修改），并标注该机制未被证实 |
| TI SYS/BIOS 的"中断禁用期间多次发生、恢复后只服务一次" | **未命中上游**——未写入 |
| Deos 的外部时钟同步 | **未直接命中上游**——以"候选解释之一，需在具体型号文档确认"的措辞写入 |
| Hyper-V `GPADL_READ_ONLY` 非安全措施 | **未命中**——未写入（只写了已证实的删除阻塞与 buffer 锁定语义） |

### 四、版本/代际提示（已写入入口文件）

- 某平台规范公开版本已推进（如 R25-11）而多数细节来自上一完整公开版（R24-11）——**核心模型适用，条目前先做版本指纹**
- 某 hypervisor 最完整公开手册属于特定代际（如 XM-4）——**不要无条件套到其他代际**
- 同一系统的**安全认证产品线与基础产品线不是同一份二进制/内核**，可选机制不同

### 五、本轮校验

- `node validate.mjs`：`OK: 122 skills validated`；`npm test`：41 项全过
- `re-rtos` 分支数 13 → 14，`re-analyze/references/cross-system-models.md` 新增速查表与版本提示节

---

## 补充 19：HIC 入库与"信任边界"通用规则（2026-09-13）

### 一、落地

- **新增分支**：`re-kernel/references/hic.md` —— capability + 物理沙箱 + 多版本驱动系统（`re-kernel` 分支数 22 → 23）
- **入口级规则**：`re-analyze/references/cross-system-models.md` 新增「**共同规律 E：信任边界不能从指令形态推导**」（四条推论表：直接 call / 直接 MMIO / 同特权级 / 整数句柄各自可能是什么），并写明配套要求（内存取证区分 VA/PA/frame/capability/owner domain/mapped domain；共享内存指针带域语义）
- **挂载**：`re-kernel` SKILL.md（平台差异表行 + 4 条决策表行 + 分支指针 + description 触发词）、`rerouting.md` A 表 1 行

### 二、触发条件设计（用户明确要求"不能误触"）

`hic.md` 内专设「触发条件（命中 / 不要命中）」一节：

- **命中**要求**组合证据**：同特权级 + MMU 隔离的模型、模块自描述元数据、入口页 IPC 形态、两种 capability 记账模型并存、旧新实例并行的滚动更新
- **不命中**逐条列出该走哪里的对照表：仅"驱动在用户态"→ 用户态驱动各分支；仅"capability/handle 本地标识"→ seL4/Zircon/Genode 等；仅"共享内存+通知"→ Xen/VMBus；仅"有滚动更新"→ MINIX/NetBSD；**仅"看到直接 MMIO"→ 不足以说明任何事**
- 判据写明：**本分支的标志是那一组组合，而不是其中任何单独一条**

### 三、命名决策（记录在案）

初版按本库红线 2（禁止具体到某个项目/产品，暗示也不行）做了**机制类脱敏**——起因是检索发现公开 OSDev 线程的作者 handle 与本仓库 git 身份一致，点名会同时构成"项目名 + 作者身份"的双重指向。**用户明确要求点名**（该项目为公开项目），遂按用户决定改为具体系统条目。

**先例**：此类"是否点名"的判断**以用户对自身项目公开性的判断为准**；默认仍按红线 2 脱敏，用户明确要求时点名。

### 四、核验

- HIC 的公开信息（OSDev 线程：物理沙箱、1:1 连续物理映射、同特权级直接调用快路径、capability 管控与未授权记录、Privileged-1 官方模块审计/签名模型、大页与页表层数、KPTI-like 跨边界隔离）与用户提供的设计描述一致，**分支内容以用户提供的设计文档为准**（本库对第一方设计文档无需外部转述）
- 跨系统对照表的 11 条来源（Fuchsia DFv2 / crash recovery / bind metadata、seL4-CAmkES、Xen 前后端与 grant table、Genode、QNX、Barrelfish、MINIX live update 与协议静止）中，**除 Barrelfish 外均已在本库其他分支有独立记录**；Barrelfish 仅作为对照经验写入，未单独立分支
- 链接修复：初版 `[[xen]]` / `[[hyperv-vmbus]]` 跨技能裸引用被校验拦下（应为 `[[re-hypervisor/xen]]` 形式），已修正

### 五、本轮校验

- `node validate.mjs`：`OK: 122 skills validated`；`npm test`：41 项全过
- `re-kernel` 分支 23，全部有 SKILL.md 入链

---

## 补充 20：8 个分支的"操作层"补深 + LynxSecure/Quest-V 拆分（2026-09-13）

来源为同源外部整编的**深度审计**：指出部分分支"概念正确且稀有，但宽度只有一根很深的井"，并逐一列出该补的操作层内容。本轮按其给出的优先级处理。

### 一、评估维度（记入审查方法）

该审计提出一个**二维评估**，值得作为后续审查的固定视角：

```
深度（某一机制的资料质量）  ×  平台覆盖度（拿一个真实样本进来能走多远）
```

据此的定位：**OpenVMS / z/OS = A+ 深度、C 覆盖度**（深的是某个异常机制，不是整个平台）；**eCos = 深度集中在一个切面**；**Haiku / Redox = 某一层很深、换一层突然变浅**；**Nucleus 已超出预期**（不再列最高优先级）。

### 二、落地

| 动作 | 对象 |
|---|---|
| **拆分** | `lynxsecure-questv.md` → `lynxsecure.md` + `questv.md`（两者各拆一份） |
| **操作层补深** | `ibmi`、`zos`、`openvms`、`redox`、`haiku`、`ecos`、`ose-oseck` |
| **挂载同步** | `re-kernel` / `re-rtos` / `re-hypervisor` SKILL.md 的分支指针与决策表、`rerouting.md` 新增 6 行、`partitioned-rtos.md` 的同族链接改指两个新分支 |

### 三、补进去的操作层要点

| 分支 | 新增的操作层内容 |
|---|---|
| **IBM i** | **层次边界**（MI / TIMI / SLIC / PASE，PASE 绕过 TIMI）；**程序模型**（OPM/EPM/ILE；`*MOD` 不可执行且绑定后常被丢弃、`*PGM` 是 bind-by-copy、`*SRVPGM` 是 bind-by-reference 且激活时解析签名）；**activation group**（PSSA/PASA/堆 + 覆盖作用域 + 存储模型相容约束）；**两套指针**（系统指针 16 字节 tagged 指向对象 / 空间指针指向偏移）与**两种存储模型**（single-level vs teraspace 的 job 边界、mmap 支持、跨 job 共享方式）；**space addressing violation 的异常数据**（对象系统指针 + 空间偏移 + 空间类别）与 **tagged 指针的 fork/共享内存限制**；**产物识别**（DMPOBJ / DBGVIEW 编译清单 / 压缩态 / 时间戳必然差异） |
| **z/OS** | **可执行材料**（load module / program object / PDS vs PDSE）；**AMODE/RMODE**（程序对象与运行中程序各有属性）；**XPLINK 与非 XPLINK 的栈行为相反**（栈方向、GPR4 带 0x800 偏置、BACKCHAIN vs 展开信息、参数传递方式、转换仅限 31 位）；SVC/PC 表；dump 类型与 IPCS（**XPLINK 下控制块更少 → 依赖 LEDATA 视图**）；EBCDIC 与记录模型 |
| **OpenVMS** | **第二条控制流：条件处理**（处理器的继续/重投递/展开三种去向、**第二次异常跳过已搜索帧**、经异常向量建立的处理器每次都被调用）；**建立处理器的两种方式与语言差异**（栈帧字段 vs 过程描述符/展开信息块；**I64 运行时没有该入口**；C 必须用运行时专有接口，否则与 setjmp/longjmp 同用是未定义行为）；**镜像启动时建立的三个默认处理器**（traceback / catchall / last-chance）；**镜像激活与共享镜像**（逻辑名重定向机制、默认目录、**特权/仅执行镜像只认可信逻辑名且被引用镜像必须安装**）；节（全局/私有/消息）与调用标准；RMS 文件规格解析规则（已知镜像查找忽略版本号） |
| **Redox** | **启动链**（引导器 → 极小 ELF 加载器 bootstrap → initfs 两级启动；内核参数携带硬件描述来源：ACPI vs 设备树）；**syscall ABI 刻意不稳定**，稳定层在用户态运行时；**relibc 与辅助向量**（静态/动态可从 auxv 判断、线程用 fd 承载、可重启语义与 errno 映射）；scheme 的**两种匹配方式**（路径前缀 vs 记住打开时的 scheme）与调度分类；**驱动两遍构建**（initfs 体积优化 + panic-abort vs 主系统标准 release） |
| **Haiku** | **系统侧对象模型**（team/thread/area/port/semaphore + 信号量的扩展标志：可中断、释放全部、仅在等待时递减）；**KDL**（栈回溯/线程/内存/切换 CPU/系统日志）与**调试 API 细节**（消息头含线程与 team ID、team 调试标志含 image 事件与 syscall 前追踪、**64 位下参数缓冲区被扩大**）；**BeOS 兼容是单向的**且调试接口与文件系统 API 属于不兼容部分；用户态服务边界 |
| **eCos** | **CDL 配置系统**（通道/调试/构建目标等选项决定编入项；用 ROM 监视器时通道选项通常失效）；**HAL 与向量表**（位置由内存布局决定、默认异常向量、**ROM 监视器加载的应用异常默认进监视器**）；**虚拟向量**（静态地址表、服务清单、保留字节与间接层代价）；**启动顺序**（复位入口 → 平台设置 → HAL 启动 → 构造函数 → 主启动）；**构造函数被向量表覆盖的真实坑**；调试桩与 GDB 去向 |
| **OSE / OSEck** | **信号号不唯一**（多个端口可共享同一信号号 → 需次级 id 与解析函数）；**先注册后发送否则丢**、一次事件可能关联多个信号要取空；**域/块/段/池的所有权**（只能在**自己的池**里分配、跨域发送会被拷贝）；**进程类型与静态/动态类别**；监督（链路级 + 平台级、DSP 监督信号、看门狗）与错误处理器；**错误检测的能力边界**（结尾标记能检出越界写，检不出不改标记的指针访问/泄漏/未初始化读取）；**系统信息接口**（信号空间、保存的寄存器与栈）；OSE 与 OSEck 的差异与异构边界 |
| **LynxSecure** | **明确区分【官方表述】与【该恢复什么】**：官方表述（不可变 boot 分区、内核功能仅限资源分区/数据流控制/状态变更调解、I/O 全导出到 guest、无管理登录、无动态系统修改、hypervisor 自身也不能访问 guest 资源）用于判断"缺什么算正常"；操作层按方法论给（配置优先于代码、启动阶段是唯一能看到配置生效的窗口、**用三项职责反查内核边界**、跨分区找受控通道而非共享页、用官方约束验证 DMA 隔离、**"8 MB 里哪一段是核心"的定位法**） |
| **Quest-V** | **monitor 的四个介入时机**、EPT 用于内存隔离而非 CPU 虚拟化、中断直接投递与早期解复用、**显式消息 + 共享内存通道（缓存行大小）+ IPI**、**故障路径**（EPT violation → VM-exit；必要时强制触发陷入；抢占超时把检测逻辑放进 monitor）、**本地/远程在线恢复**（换实现靠改 EPT 激活）、以及**"哪一段是 monitor"的四条判据** |

### 四、未获证实 / 未写入

- **LynxSecure 的配置 artifact、启动阶段细节、partition 描述结构**：公开资料缺失（检索无结果）。**未编造**；改用"该恢复什么"的方法论表述，并在文件开头明确标注【官方表述】/【该恢复什么】两类内容的分野
- **OSE 的 XIP**：仍未证实，文件中保留"不要断言"的措辞
- **OSE 的 attach 语义细节、signal pool 监督的内部设计**：本次检索只确认了 hunt/attach 属于信号 API 与池的所有权规则，更细的内部机制未获证实，未写入

### 五、本轮校验

- `node validate.mjs`：`OK: 122 skills validated`；`npm test`：41 项全过
- `re-hypervisor` 分支 8 → 9（拆分后），`re-rtos` 14、`re-kernel` 23；全部有 SKILL.md 入链
- 措辞检查：新写内容经"最 X"筛查并改写（`questv` / `ose-oseck` 各一处）

---

## 补充 21：系统识别指纹表（2026-09-13）

### 一、缺口与落地

**缺口**：库里有"运行模型 + 误判表 + 异常速查表"，但**没有"怎么认出这是哪个系统"**这一层——rerouting A 表要求你已经知道目标是什么。

**落地**：新增入口级控制文件 **`re-analyze/references/system-fingerprints.md`**（199 行），**覆盖本库全部 55 个系统**（脚本自检：按显示名逐个核，55/55 命中）。

### 二、结构：五层流程

```
① 载体与格式（PE / ELF 是否 ET_REL / Mach-O / 无容器镜像 / 配置 / 转储 / 流量）
② 超家族收敛（几条问题归到某一族）
③ 家族内指认（9 张表：UNIX 与 Windows 系内核驱动 / capability 与用户态驱动型 /
   RTOS / 分区与安全 RTOS / Hypervisor / 固件引导 / 主机大型机 / 车载 / unikernel）
④ 易混淆对（15 组专项判据）
⑤ 负判据（"看到 X 就不是 Y"）
```

**判据强度分级**：**[强]**（唯一判据，可单独定案）与 **[弱]**（需组合）——文件里明确写了"弱判据单独使用会把无关系统卷进来"，并给出例子（"有 Kconfig"无法区分 Zephyr 与 NuttX）。

### 三、本轮新核验的事实地基

| 事实 | 核验结果 |
|---|---|
| **ELF note 段标识** | NetBSD：`.note.netbsd.ident`，note 名 `"NetBSD"`，`NT_NETBSD_IDENT` = 1；OpenBSD：`.note.openbsd.ident`，note 名 `"OpenBSD"`，`NT_OPENBSD_IDENT` = 1；FreeBSD：`.note.ABI-tag`，note 名 `"FreeBSD"`，`NT_FREEBSD_ABI_TAG` = 1（GNU ABI 标签里另有 FREEBSD=3、NETBSD=4、SOLARIS=2、LINUX=0、HURD=1） |
| **`EI_OSABI` 现行取值** | NONE=0、HPUX=1、**NETBSD=2**、LINUX=3、HURD=4、86OPEN=5、**SOLARIS=6**、AIX=7、IRIX=8、**FREEBSD=9**、TRU64=10、MODESTO=11、**OPENBSD=12**、**OPENVMS=13**、NSK=14、ARM=97、STANDALONE=255。（**注意**：2000 年曾有 FREEBSD=4/NETBSD=5/OPENBSD=6 的提案，与现行值不同；本表按现行值写） |
| **OpenBSD note 的强制程度** | 讨论中一度写作"通常包含"后改为移除该措辞；无 note 的二进制会执行失败，但最终未写成"必须"——本表据此只把它当**强判据之一**而非唯一依据 |

### 四、处理原则（重要）

- **判据全部取自本库已核验的分支**（各分支文末"工具与验证"节），本文件**不引入新断言**；文中已写明这一来源约定
- **两处检索未命中**（hypervisor 配置产物特征、RTOS 识别串）**未改用外部猜测**，而是改用库内已核验内容（如 ACRN 的 `IVSHMEM_ENABLED`、Jailhouse 的 `.cell` 与控制台串、Bao 的 `struct config`、RTOS 的对象头魔数与 API 前缀）
- **判据薄的两个系统**（LynxSecure / Quest-V）在表中明确标注"不要靠字符串定案"，改为结构性与行为判据
- 新增了**维护约定**：新增系统分支时须同步往本表加一行（载体/强判据/结构线索三列必填）

### 五、挂载

| 位置 | 内容 |
|---|---|
| `re-analyze/SKILL.md` 第二步 | "先认目标"段（含"判不出不要硬判"） |
| `triage.md` 前置 | 认系统先于查表；家族已定系统未定时按家族级分支推进 |
| `cross-system-models.md` | 互为前后置：先定身份、再查该身份允许哪些"正常异常" |
| `CLAUDE.md` 控制文件表 | 新增两行（fingerprints / cross-system-models） |
| 5 个技能 | re-kernel / re-rtos / re-hypervisor / re-uefi / re-automotive 的「何时使用」各加一条前置回链 |

### 六、本轮校验

- `node validate.mjs`：`OK: 122 skills validated`；`npm test`：41 项全过
- 覆盖度自检：按 55 个系统显示名逐个核对，**55/55 命中**（脚本核对方式记于本节，后续加系统时可复用）

---

## 补充 22：对 d4a5348 的抽样审查——2 处事实 + 4 处元规则（2026-09-13）

来源为同源外部审查（针对当前 HEAD 抽样）。审查自身给出的定位值得记下：**"不是内容事实性质量崩了，更像是扩张得很快以后，少量表述过强 + 元规则开始比具体知识更容易制造误判。"** 本轮 6 条全部处理。

### 一、事实性修正（2 条）

| # | 位置 | 原文 | 问题 | 修正 | 核验 |
|---|---|---|---|---|---|
| 1 | `analysis-contract.md` constants 步 | "有语义的 magic number（如 **ELF 头 0x202**）" | ELF 魔数是 `\x7fELF`，`0x202` 与 ELF 无关 | 改为 `ELF 魔数 \x7fELF（小端读作 0x7f454c46）` | 定义级事实 |
| 2 | `system-fingerprints.md` §二 | "`.note.ABI-tag`(FreeBSD)" | **把 note type 与 section name 混了** | 改为 `.note.tag`（note 名 `"FreeBSD"`、`NT_FREEBSD_ABI_TAG`=1），并注明**早年版本曾用 `.note.ABI-tag`**，识别时应两者都看 | FreeBSD `lib/csu/common/crtbrand.S`：`.section .note.tag,"aG",%note,.freebsd.noteG,comdat`；note 名 `NOTE_FREEBSD_VENDOR`；描述符为 `__FreeBSD_version`。**上一次搜索之所以出错**：官方头文件的注释写的是 "Values for FreeBSD **.note.ABI-tag** notes"，而实际生成的 section 是 `.note.tag`——**注释与实现不一致** |

### 二、元规则修正（4 条）

| # | 位置 | 问题 | 修正 |
|---|---|---|---|
| 3 | `system-fingerprints.md` 判据标注 | **[强] 混了两个独立概念**——"对某系统高度特异"与"这个东西通常一定能观察到" | 拆成**二维**：**特异度**（`独有`/`高`/`弱`）× **可观测性**（`稳定`/`视构建`/`仅运行期`），标注形如 `独有·稳定`；并写明典型误用：把 `独有·视构建` 当"一定能看到"，于是对 strip 过的产物得出"不是该系统"的错误结论（举 Haiku `driver_v1`/`device_v1` 为例）。全文 62 处标注完成 |
| 4 | `system-fingerprints.md` §二 | "ELF + ET_REL → **[强]** Linux 内核模块"**过强**——ET_REL 只说明"可重定位 ELF"，后半句"或同类可重定位模块"已自认这一点 | 降为 **[弱·稳定]**：ET_REL 仅指示"可重定位 ELF"；**需再命中 `.modinfo` / `__this_module` / `vermagic` 才升到 Linux 可加载内核模块** |
| 5 | `system-fingerprints.md` 缺**证据归属**维度 | 固件里可能同时有 Linux rootfs、MCU blob、guest 镜像、编译期 sysroot——**找到 `procnto`/ARXML/`seL4_*`/FreeRTOS 特征串中的任何一个，都不能回答"主体是哪个系统"**。指纹表越丰富，这类假命中越多 | 新增**第 ⓪ 层 `evidence_scope`**（`container` / `executable` / `embedded payload` / `guest` / `dependency` / `toolchain artifact` / `documentation`），规则：**先判证据属于谁，再判它是哪个系统**；跨 scope 命中只记"存在性"，不作主体身份依据。同步改流程图（五层 → ⓪+四层）与入口 SKILL.md 的"先认目标"段 |
| 6 | `analysis-contract.md` 两条规则过硬 | ① "每目标**不超过 8 次**工具调用"当全局硬上限——大型固件/内核/协议/混淆程序会被强行截断；② "五步严格顺序、不可跳步、**禁止先反编译再倒推**"与真实 RE 的迭代性质冲突（类型恢复常常要先粗反编译拿 field-use / call-shape / switch / allocation size 才有线索） | ① 改**软预算**：8 次为一档，**到档必须重新评估**（继续 / 换路 / 收束三选一，结论记录在案），评估通过进入下一档；② 改**收敛循环**：`初次反编译 → 四类信息交替恢复 → 重新反编译 → 定点`，并把"decompilation"从终步改为**收敛判据**（四条同时满足才算定点：类型全解析 / 常量有名 / 虚调用目标已识别 / 签名带参数名）。**保留的约束**是"禁止只反编译不复核就交付" |

### 三、审查确认无问题的两处（本轮无需改动）

- **Haiku `driver_v1`/`device_v1` 后缀**：得到官方文档支持（本库此条早已如此写）
- **ThreadX `TX_THREAD_ID` = `0x54485244`('THRD')**：与当前 upstream 一致（本库此前已纠正过旧资料的 TIMR/EVEN 写法）

### 四、本轮校验

- `node validate.mjs`：`OK: 122 skills validated`；`npm test`：41 项全过
- 二维标注落地自检：`独有·` / `高·` / `弱·` 共 62 处

---

## 补充 23：对 22a76dc 的抽样审查——网络隔离 / 工具生命周期 / ABI（2026-09-13）

来源为同源外部审查（第二批，抽查 re-netcap / re-proto-rev / re-android-native / re-angr / re-ai-model / re-malware / re-mem-forensics + validate.mjs 与测试）。10 条全部处理，其中 1 条**核验后与审查意见相反**。

### 一、P0：两处操作级 bug

| # | 位置 | 问题 | 修正 |
|---|---|---|---|
| 1 | `re-netcap` 步骤 5 与坑表 | **沙箱断网验证不成立**——把"断网 / fake DNS / INetSim"并列，并用 `ping 8.8.8.8` 不通作为"无真实外联"的验证。**ICMP 被阻断 ≠ TCP/UDP 被阻断**；**fake DNS 挡不住硬编码 IP 的 C2**；纯断网又抓不到 C2 | 改为**默认拒绝出站（default-deny egress）+ 白名单到分析基础设施**，并给出 iptables 落地示例；验证改为**三条独立验证**（TCP / UDP / 硬编码 IP 直连），明确写"`ping 不通`不构成任何一条"。坑表同步改写 |
| 1b | `re-sandbox` 步骤 1 与 `re-malware` | "VM 快照 > 容器 > firejail"的排序容易被当作"容器是一般恶意样本的后备隔离层"，但**容器与 firejail 都共享宿主内核** | 在层级说明处明确：**中低两档只适用于已知低风险样本**；样本存在内核攻击面（提权/内核漏洞/驱动载荷）时这两档不构成隔离边界；**默认承载未知高威胁样本的是 VM 快照** |
| 2 | `re-netcap` 步骤 5 | **mitmproxy 透明代理规则只重定向了 80**——上下文在处理 HTTPS/TLS，但 PREROUTING/OUTPUT 两条都是 `--dport 80`，目标访问 443 时**根本不会进入 mitmproxy** | 改为 `-m multiport --dports 80,443`，并注明"只写 80 是最常见的失误"；补充非标准 TLS 端口（8443 等）需按实际观测补齐 |

### 二、P1：工具操作层（Volatility 3 三连）

| # | 问题 | 核验与修正 |
|---|---|---|
| 5 | **符号获取机制混了 Windows 与 Linux/macOS** | 核验：**Windows** 按 PDB GUID/age 在 `symbols/windows/` 找 ISF，**找不到时自动从 Microsoft 符号服务器下载 PDB 并转换**；**Linux/macOS 靠 kernel banner 精确匹配**（banner 编码在 ISF 内、文件名不重要），获取途径是社区预构建包或自行构建（`dwarf2json` 需调试内核 / `btf2json` 用 `vmlinuz` BTF + `System.map`）。原文"首次运行从 volatilityfoundation.org 下载、Linux 也是对应内核版本"**两侧都错**，已按上述改写并补"先跑 `banners` 拿 banner"的工作流 |
| 6 | **插件命名漂移** | 核验：`windows.hashdump` / `lsadump` / `cachedump` **确已迁到 `windows.registry.*`**，旧名为弃用别名（v2.27 标记 **2026-09-25** 移除——距今 12 天），已改命令与坑表。**但审查关于 malfind 的部分与核验相反**：malfind 的**源码目录**在 `windows/malware/` 下，**命令行调用名仍是 `windows.malfind`**（`malware` 不进入调用名）——**照"迁到 windows.malware.malfind"改会引入新错误**，故未改；并把这条区别写进了坑表（"源码目录变了 ≠ 调用名变了"） |
| 7 | **凭据来源统一写成"LSASS 内存"不准确** | 核验：三个插件都是 **registry-hive 派生**——hashdump ← SAM + SYSTEM（boot key）、lsadump/cachedump ← SECURITY（cachedump 用 **NL$KM** 解 MS-CACHEv2）。已改为分开记录：**registry-hive-derived** vs **LSASS process-memory** 两条路径，并写明取证报告里 provenance 写错后果较重 |

### 三、P1：ABI 两处

| # | 位置 | 问题 | 修正 |
|---|---|---|---|
| 3 | `re-android-native` | **JNI 字符串语义写反**（`GetStringUTFChars` 写成"C 串→UTF-8"）+ **`JNINativeMethod` 三个字段被硬编码成各 8 字节** | 语义改为 **jstring → Modified UTF-8** / **Modified UTF-8 → Java String**，并补"**是 Modified UTF-8 不是标准 UTF-8**"（空字符 `0xC0 0x80`、增补字符代理对上不同）；字段宽度改为"**各为一个指针**：64 位 8 字节、**32 位（armeabi-v7a/x86）4 字节**，数组步长 12 字节"。两处出现处均已改 |
| 4 | `re-angr` | **recv/read hook 的 ABI 错误**——写成"或 hook 返回符号指针"，而 POSIX `recv`/`read` 的**返回值是 ssize_t 字节数** | 改为：**按调用约定取 buf 参数**（x86-64 SysV：RSI=buf、RDX=len）→ 写符号字节到该地址 → **返回符号长度**；并写明照原文实现会让 `if (recv(...) > 0)` 一类控制流全部建歪 |

### 四、P2：两处内容错误

| # | 位置 | 问题 | 修正 |
|---|---|---|---|
| 8 | `re-ai-model` | **"流式提取"名不副实**——`to_array()` 对 external data 张量会**完整 materialize**，且 `base_dir` 默认空字符串（权重不在 CWD 时直接失败） | 标题改为"**逐 tensor 惰性落地**"，代码里加 `base_dir="."` 与 `del arr`，并注明**不是流式**、峰值取决于最大张量；坑表同步 |
| 9 | `re-proto-rev` | **Ethernet FCS 诊断错**——"帧短 14 字节"归因到 FCS，但 **FCS 是 4 字节、14 字节是典型以太网头部长度** | 重写为"**先量实际少了几字节**"：缺 4 字节查 FCS 剥离，缺 14 字节查以太网头/注入层；并删去"Scapy 不保留尾部"这类笼统断言（帧抽象随版本与配置而异） |

### 五、结构性结论（写入 TODO）

审查指出：**41 项测试与 `validate.mjs` 主要校验 schema 与路由图，不执行 Markdown 里的 shell/Python 示例，也不验证第三方 API/CLI 是否仍存在**——所以"122 skills validated / 41 tests pass"的准确含义是**结构与路由图健康**，而非"技能内容可执行"。本轮 Volatility 的过期命令即典型漏网类型。

**趋势判断（记录）**：**领域知识已比工具操作层稳定**，新的主要缺陷来源转为「**命令/API 生命周期**」与「**示例代码没真正 smoke-test**」——与此前以事实性错误为主不同。

已在 `TODO.md` 新增「工具 CLI/API 生命周期审查」条目，含最小方案（第三方命令/API 清单 + 版本漂移检查 + 示例可执行性 + 与增量审查机制合并设计）。

### 六、本轮校验

- `node validate.mjs`：`OK: 122 skills validated`；`npm test`：41 项全过
- 涉及文件 7 个：`re-netcap` / `re-sandbox` / `re-mem-forensics` / `re-android-native` / `re-angr` / `re-ai-model` / `re-proto-rev`

---

## 补充 24：工具 CLI/API 生命周期机制落地（2026-09-13）

上一节把"命令/API 生命周期"定为新的主要缺陷来源，本节实现其最小骨架。

### 一、交付物

| 文件 | 作用 |
|---|---|
| `docs/audit/tool-register.json` | **登记表**（140 项）：`name` / `kind` / `where`（引用它的技能） / `last_verified` / `source` + 一份 `ignore` 名单 |
| `lib/tool-register.mjs` | 抽取（`extractCommands`）、扫描（`collectFromSkills`）、比对与时效（`checkRegister`）、探测（`smokeProbe`） |
| `bin/toollife.mjs` | CLI：`check` / `candidates` / `stale` / `smoke`（与 `bin/capindex.mjs` 同构：lib 放逻辑、bin 做壳） |
| `tests/toollife.test.mjs` | 10 项：抽取器各类边界 + 死条目/候选/时效/非法日期 + **仓库自身一致性** |

`package.json` 增加 `npm run toollife`；`npm test` 通过 `tests/*.test.mjs` 自动纳入一致性检查。

### 二、设计取舍（记录判断依据）

- **抽取只认显式标注为 shell 的代码块**（```sh / ```bash / ```console / ```shell）。先按"所有代码块"试过一版：去重候选 **717** 个，其中大量是 python 体与结构体字段名（`print` / `import` / `onLoad` / `simgr.*`）；限定标注后降到 **159**，治理成本量级下降
- **不做"每个命令都必须登记"的硬门**——那会把 `ls`/`cat`/`grep` 一类基础工具也拖进来。登记表只管**有生命周期风险的第三方工具**，基础工具在 `BASE_UTILS` 里直接过滤
- **`last_verified: null` 是一等状态**：表示"已登记、尚未核验当前 CLI/API 形态"。当前 140 项里只有 1 项已核验（`vol`，本会话核过插件路径与符号机制），其余 **139 项是明确的待核验积压**——这不是缺陷，而是把真实状态显性化；`check` 三档统计（已核验 / 超期 / 待核验积压）
- **超期与积压分开**：`stale` 只统计**已核验且超过 180 天**的项（避免把"从未核验"混进"该复核了"）；`pending` 单独列，供下一轮审查波分批消化
- **`smoke` 不进 CI**：探测本机是否装某工具，在 CI 机器上必然大量缺失，只作本地报告
- **死条目即失败**：登记为"在用"但技能里已找不到该命令 → `check` 报错。这是**唯一**做成硬门的检查——它无歧义、不会因正常编辑误报

### 三、防漂移闭环

```
新增技能引用新第三方工具
  → check 把该命令列为"未登记候选"
  → 仓库自身一致性测试失败（npm test 红）
  → 登记（或放入 ignore 并写明理由）
  → 绿
```

同理，**删掉某工具的全部引用而不清理登记表**也会红（死条目）。

### 四、未做（保留在 TODO）

- **示例可执行性**：把技能里的 shell/Python 示例抽成最小可跑片段。需要权衡 fixture 与网络/工具依赖，单独评估
- **逐项回填 `last_verified`**：按 `stale` 输出分批核验。当前积压 139 项

### 五、本轮校验

- `npm test`：`OK: 122 skills validated` + **51 项测试全过**（原 41 + 新增 10）
- `npm run toollife`：`登记 140 项｜已核验 1｜超期 0｜待核验积压 139`，无错误、无未登记候选

---

## 补充 25：示例可执行性 + 增量审查机制 + 登记表风险分层（2026-09-13）

上一节遗留的三项，本节一并落地。

### 一、示例可执行性（`lib/skill-examples.mjs` + `bin/examplecheck.mjs`）

**定位**：`validate.mjs` 校验结构、不执行示例；本检查补"**示例至少语法正确**"这一层——抓不到"命令过期"，但能抓到"照抄会立刻报错"。**只做语法检查**：不联网、不装依赖、不运行程序。

首轮测量与规范化（每一步都是必要的，否则误报淹没真错）：

| 阶段 | python 块 | shell 块 | 说明 |
|---|---|---|---|
| 原始 `compile` / `bash -n` | 51 错 | 26 错 | 绝大多数是**假阳**：块缩进在列表项下、`(gdb)` 提示符行、`<pid>` 被 shell 当重定向 |
| 去缩进 + 提示符规范化 | **3 错** | 22 错 | python 的 3 处是真错 |
| 占位符中和 + 会话记录识别 + heredoc 拆分 | **0** | **0** | 剩余 22 处全部是 `<占位符>` |

**抓到的真问题**（已修）：

- **3 处 python 语法错**：`simgr.explore(find=0x4011xx, ...)` —— `0x4011xx` 不是合法 Python（`invalid hexadecimal literal`），照抄即报错。改为合法地址 + `# 示意地址：按目标实际入口/分支替换`
- **2 处语言标错**：`re-fp-runtime` / `re-nim` 把 **Haskell / Nim 源码与构建命令塞在同一个 ```sh 块**里——已拆成 `haskell` / `nim` 代码块 + `sh` 命令块

**两个刻意的设计决定**：

- **调试器会话块不按 shell 检查**：含 `(gdb)`/`(jdb)` 提示符，或"交互式工具启动行 + `> ` 命令"的块是**会话记录**，行内容是喂给调试器的，不是 shell 语句——丢弃提示符行后再检查，避免把 jdb 转录当 shell 脚本报错
- **sh 块里嵌的 python heredoc 单独按 python 检查**（`python3 - <<'PY'` 在技能里很常见）——否则这些代码完全在检查视野之外

**CI 取舍**：需要 python3 / bash，缺失时**跳过而非失败**；接入 `npm test`（有解释器时生效），成本约 8 秒（391 块，每块一次解释器调用）。

### 二、增量审查机制（`lib/review-state.mjs` + `bin/auditstate.mjs`）

```
docs/audit/review-state.json   122 技能 × { hash, last_reviewed, note }
node bin/auditstate.mjs status → changed / unreviewed / ok 三态
node bin/auditstate.mjs update <技能...> → 回填当前 hash + 日期
```

审查波的工作流变为：**`status` 列出"内容在复核之后又变了"的技能 = 工作集 → 只审这些 → `update` 回填**。成本从 O(技能总数) 降到 O(变更数)。

- **hash 口径**：技能目录下全部 `.md`/`.sh` 按相对路径排序后逐个喂入（路径 + 内容），任一文件变化即触发
- **`last_reviewed: null` 是一等状态**：存量技能尚未按本机制复核——当前 122 项中 120 项已复核（本会话审查波覆盖）、2 项（re-ai-triage / re-feedback）从未复核
- **初始播种规则**：本会话被改动过的技能视为已复核（内容正是审查的产物）
- **已删除技能**自动从状态清理并在 `status` 告警；有测试断言状态文件覆盖全部技能

**与增量审查机制原方案的一处偏离**：原计划"扩展 validate.mjs"，实际**改为独立脚本 + 一条测试断言**——审查状态需要写盘与日期，与 validate.mjs 的纯读校验性质不同，混在一起会破坏其单一职责。

### 三、登记表风险分层（`deriveRisk`）

原 `stale` 只按"距上次核验的时长"排序，但 134 项积压里**不同条目的漂移风险差异极大**。新增按**断言类型**分层（不落盘，随内容实时派生）：

```
写死了层级路径（如 windows.registry.hashdump）或版本号 → 高风险（+2 各）
写出命令行开关                                → 中（+1）
只点名工具名                                  → 低
出现面（多少个技能引用）                        → 仅作严重度排序，不计入风险等级
```

> 第一版把"出现次数"也算进分数，结果 `readelf` 得 130 分——那是**频率**不是**具体度**，已改正为按断言类型。

当前：**待核验 134｜高风险 40｜低风险 94**，`npm run toollife` 按影响面给出建议顺序（`lldb` / `tshark` / `rizin` / `adb` / `binwalk` …）。

**首批回填 6 项**（均为本会话审查波中确实核验过 CLI/API 形态的）：`vol`、`frida`、`candump`、`mmls`、`tsk_recover`、`readelf`。

### 四、本轮校验

- `npm test`：`OK: 122 skills validated` + **67 项测试全过**（上轮 51 + 新增 16）
- `npm run examples`：`代码块 913 个｜已检查 391 个`，通过
- `npm run audit:status`：`已复核未变 120｜待复核 0｜从未复核 2`
- `npm run toollife`：`登记 140 项｜已核验 6｜超期 0｜待核验 134（高风险 40）`

---

## 补充 26：把"约定"变成检查——四类收尾（2026-09-14）

前面几轮反复出现同一个模式：**多副本信息 + 无单一事实源**（frontmatter 解析两套、能力声明无消费端、计数散落六处、references 同名、审查历史泄漏）。这一轮把当时还是"人工约定"的四类也收成检查。

### 一、probe.sh 工具清单（登记表 → 生成）

`probe.sh` 硬编码 **19** 个工具，而登记表已有 **137**——`RE_TOOLS` 是 agent 判断"环境里装了什么、优先用什么"的依据，硬编码清单会让**已装的工具不被使用**。

做法与能力索引同构：**登记表是源，probe.sh 里的清单是生成物**（`lib/probe-tools.mjs` + `bin/probelist.mjs`，`--check` 校验新鲜度并入 `npm test`）。

顺带修掉两处真问题：

- **`MEM_GB` 恒为空**：`free` 的输出被本地化（`内存：` 而非 `Mem:`），`awk '/^Mem:/'` 匹配不到——固定 `LC_ALL=C`。**与 readelf 同一类坑**（本轮 fixture 也踩到）
- **`dd` / `hexdump` 混进登记表**：属基础工具，已归入 `BASE_UTILS` 并从登记表移除（否则会被死条目检查打回）

### 二、计数同步（人工清单 → 检查）

`CLAUDE.md` 里的"按清单逐处核对"一直是人工的（历史上漏过 5 处）。`tests/counts.test.mjs` 把 13 处计数点变成断言，另加两条：README 引用的技能必须存在、**每个技能都必须在 README 出现一次**。

后者当场抓到一个真缺口：README 用简写 `re-format-pe/elf/macho`，导致 **`re-format-elf` / `re-format-macho` 从未以全名出现**（简写既不可 grep 也不利于检索）——已改为全名。

### 三、指纹表覆盖（文档约定 → 检查）

`system-fingerprints.md` 写着"新增系统分支须同步加行"，但无检查。`tests/fingerprints.test.mjs` 用 MAPPED / EXEMPT 两张表断言：**新增分支若两处都没登记即失败**，并要求豁免项写明理由、映射表不得残留已删文件。

### 四、复核 = 回归断言（`tests/audit-regressions.test.mjs`）

"fixed → verified"原计划是人工复核一遍。改为**把已修事实写成永久断言**——22 条，覆盖 #1–#21 与补充 22/23。一次完成复核与防回归：日后有人重写技能时，错的说法写回去会直接红。

**复核中发现的新问题**：三条断言失败，查下去全是技能里**刻意保留的迁移对照说明**（"旧写法 `Module.findExportByName(null, n)` 已移除"、"KeyStore 无 getKeyAlias"、"`this` 上没有 returnValue"）——即文档写对了，是断言太粗。据此给 `absent` 加了**否定语境识别**（`已移除/已废弃/弃用/无此/没有/不再/不是/勿用/不携带/不支持/不存在/旧写法/过时`）。这条规则本身值得记：**断言与文档的区别在于，"提到错误"不等于"主张错误"**。

### 五、行为 fixture（四层验证体系的最上层，首次落地）

`tests/format-fixtures.test.mjs`：对**字节布局类断言**用纯代码构造最小样本验证，不依赖网络与外部样本。首个 fixture 覆盖 `re-format-elf/references/layout.md` 的**扩展编号三套规则**——该处原文即注明"建议配 parser fixture 验证这三条路径"。

**这一层立刻证明了价值**：fixture 抓出**当天早些时候由"修复"引入的新错误**——补充 22 里把 ELF 魔数写成"`\x7fELF`（小端读作 0x7f454c46）"，而 `7f 45 4c 46` 按小端读是 **`0x464c457f`**，`0x7f454c46` 是**大端**读法。已改为给出字节序列 + 两种读法（同一文件里另有 `free`/`readelf` 的本地化坑，说明这类"看起来对"的细节最需要 fixture）。

### 六、SKILL.md 预算（re-kernel 拆分问题的结论）

**结论：不拆。** 实测口径错了——技能是**按需加载**的库，常驻成本只有 SKILL.md（re-kernel 177 行，与 re-rtos 197 / re-hypervisor 169 / re-analyze 117 同量级），分支用到才读。拆分反而要新增 5+ 技能（计数同步六处）并割裂最有价值的**失败模式决策表**。

真正要防的是 SKILL.md 膨胀，已加 `tests/skill-budget.test.mjs`（SKILL.md ≤240、单分支 ≤600、**必备章节仍在**——最后一条防的是"为了满足预算而削壳"）。顺带发现 `re-kernel` 用「## 通用主线」代替模板规定的「## 操作步骤」，已对齐。

### 七、本轮校验

- `npm test`：`OK: 122 skills validated` + **103 项测试全过**（上轮 67 + 新增 36）
- 新增测试文件 5 个：`counts` / `fingerprints` / `format-fixtures` / `audit-regressions` / `skill-budget`
- 新增脚本：`bin/probelist.mjs`（`npm test` 已含 `--check`）
