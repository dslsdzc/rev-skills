# 蒸馏方法论

经验条目统一格式、脱敏规则、归域决策表、去重规则、文章扫描跳过标准。

## 条目格式

每条一格，格式固定：

**标题（动词短语，10-20 字）**：现象——（可复现的现象描述）；原因——（根因，不重复现象）；对策——（可执行的下一步，含技能/工具名）

示例：

**重打包保持原始格式参数**：现象——重打包/替换资源后的包在真机加载崩溃或解析失败；原因——重打包工具默认输出格式与原格式存在差异（压缩方式/对齐/容器标志）；对策——用 Apktool 等重打包工具（见 [[re-mobile-pack]]）保留原包的格式参数（压缩标志/对齐方式），产出与原始文件同量级同格式，先本地验证再上真机

- 一条一格：一个现象 + 一个根因 + 一个对策，不把多个坑合并进一条
- 「坑」与「方法」同格式：坑写避坑；方法写「现象——旧做法低效；原因——…；对策——更优路径」

## 脱敏规则（红线）

- 禁止出现：公司/产品/项目名、目标样本名、内部代号、专有协议名、域名/包名/签名指纹
- 禁止暗示：行业+规模+地域组合、独特技术特征组合（可推断身份）
- 泛化写法：目标 → 「某移动应用」「某嵌入式设备」「某通信协议」；只保留技术结论（现象/原因/对策）
- 来源字段：实战会话 → `2026-08 实战会话`（只写时间）；文章 → 文章标题 + URL（公开信息可保留）
- 入库/发 issue 前自检：列出条目中所有专有名词逐项确认已泛化；任一不通过 → 回炉重蒸

## 归域决策表

| 条目主题 | 目标技能 |
|---|---|
| 壳/脱壳/反混淆/花指令/控制流平坦化 | [[re-anti-analysis]] 系（[[re-packer-id]] [[re-unpack-simple]] [[re-unpack-advanced]] [[re-deobfuscate]]） |
| 恶意行为/持久化/注入/C2 | [[re-malware]] 系（[[re-behavior]] [[re-loader]] [[re-fileless]] [[re-ioc]]） |
| 固件/IoT/嵌入式/rootfs | [[re-firmware]] 系（[[re-fw-extract]] [[re-fw-rootfs]] [[re-fw-emulate]]） |
| 协议/流量/抓包/加密通信 | [[re-protocol]] 系（[[re-netcap]] [[re-proto-rev]] [[re-crypto-id]] [[re-crypto-keys]] [[re-crypto-decrypt]] [[re-tls]]） |
| 移动 App/JNI/Frida/加固脱壳 | [[re-mobile]] 系（[[re-apk]] [[re-android-native]] [[re-frida]] [[re-mobile-pack]]） |
| 一般二进制/反编译/调试/格式 | [[re-binary-core]] 系（[[re-triage]] [[re-format-pe]] [[re-ghidra]] [[re-gdb]]） |
| 破解/授权/注册码/补丁 | [[re-cracking]] 系（[[re-license]] [[re-patching]] [[re-keygen]]） |
| fuzz/崩溃/漏洞/利用 | [[re-vuln]] 系（[[re-fuzzing]] [[re-crash-triage]] [[re-exploit]]） |
| CTF/angr/z3 | [[re-ctf]] 系（[[re-angr]] [[re-z3]] [[re-pwn]]） |
| .NET/Java/脚本/WASM/合约/AI 模型 | [[re-managed]] 系（[[re-dotnet]] [[re-java]] [[re-script-deob]] [[re-wasm]] [[re-blockchain]] [[re-ai-model]]） |
| 取证/内存取证/威胁情报 | [[re-forensics]] 系（[[re-mem-forensics]] [[re-disk-forensics]] [[re-ti]]） |
| 反作弊/内核驱动/虚拟化 | [[re-binary-core]] 系（[[re-kernel]] [[re-anti-cheat]] [[re-hypervisor]]） |
| 反调试/检测规避 | [[re-anti-analysis]] 系（[[re-evasion]]） |
| 勒索软件 | [[re-ransomware]] |

兜底：`grep -rn "关键词" .claude/skills/*/SKILL.md` 找最相关技能；仍不确定 → 问用户，不猜。

## 去重规则

- 入库前 `grep -n "标题关键词" .claude/skills/<技能>/references/experience.md`（文件不存在 = 无重复）
- 同现象已存在 → 跳过并告知用户；内容更完整的新版本可替换旧条目

## 文章扫描跳过标准

- 工具/工作流推广帖（新手教程、工具介绍、无新方法论）
- 正文截断/无法提取正文
- 纯新闻/非逆向内容
