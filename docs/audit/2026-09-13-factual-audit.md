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
