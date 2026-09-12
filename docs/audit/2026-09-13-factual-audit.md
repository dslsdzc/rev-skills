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
