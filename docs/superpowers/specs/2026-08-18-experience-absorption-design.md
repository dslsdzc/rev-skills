# reverse-skill 经验吸收设计（2026-08-18）

## 背景

reverse-skill（zhaoxuya520/reverse-skill，MIT 许可）的 field-journal 含 42 个经验 md（18 真实条目 + 17 seed + 3 precedent + 索引/模板）。经评估：24 个跳过（渗透测试类非逆向域、reverse-skill 自身工程类、已覆盖、索引类），12 个逆向域候选值得吸收。机制层（routing.json/scope 门/自动回流 CI 等）用户确认不做。

设计约束（沿用全库红线与原则）：
- **红线 1 呈现中性**：禁用「最推荐」「强烈建议」等最高级强推措辞
- **红线 2 隐私脱敏**：吸收条目按脱敏规范泛化（不指向具体项目/公司/产品）
- **版权**：reverse-skill 为 MIT 许可——吸收条目注明来源（「来源：reverse-skill field-journal（MIT）」）
- **改写**：不逐字复制——按 rev-skills 坑格式（现象/原因/对策）改写
- **查重**：入库前对目标技能 grep 去重（如 SSL 绕过——frida-scripts.md 已有模板则跳过或合并）
- 工作区已干净，无未提交文件冲突
- 当前分支 `main`

## 变更总览（12 个吸收候选 → 归域）

| # | 源条目 | 蒸馏主题 | 归域技能 | 吸收形态 |
|---|---|---|---|---|
| 1 | seed-002 | Go stripped+Garble 对抗（GoReSym/GoResolver/GoStringUngarbler 链、AES 密钥定位） | re-go | 坑 3-4 条 + 工具链方法 |
| 2 | 2026-07-14 | Android ARM64 间接跳转表静态求解、XOR 解密器重放 | re-binary-core | 坑 2-3 条 |
| 3 | 2026-07-05 | 验证码系统 VM 混淆对抗 | re-deobfuscate | 坑 2-3 条 |
| 4 | 2026-08-06 | Cortex-M 固件自旋 XOR 封装（自带掩码旋转） | re-fw-extract | 坑 1-2 条 |
| 5 | seed-001 | ELF 自解压加载器（bzip2 尾部流定位、__ARCHIVE_BELOW__ 自解压脚本） | re-loader | 坑 2 条 |
| 6 | seed-014 | Unity IL2CPP 元数据还原（global-metadata.dat、方法指针） | re-game | 坑 2-3 条 |
| 7 | seed-008 | APK OkHttp SSL Pinning 绕过 | re-frida | 查重（frida-scripts.md 已有 SSL 模板）——命中则跳过 |
| 8 | seed-009 | iOS 越狱检测绕过 + 抓包 | re-ios-jb | 坑 2 条 |
| 9 | seed-011 | PCAP 自定义二进制协议还原 | re-proto-rev | 坑 2 条 |
| 10 | seed-004 | JS 签名逆向（Webpack+AES+时间戳） | re-script-deob / re-crypto-id | 坑 2 条 |
| 11 | 2026-07-22 | Electron Bytenode 特权更新链（字节码+更新校验） | re-managed（re-dotnet 相邻） | 坑 2 条 |
| 12 | 2026-05-15 | Go TLS 分片代理逆向 | re-go / re-tls | 坑 2 条 |

## 吸收格式与规则

**坑格式**（与技能库既有体例一致）：`**标题**：现象——…；原因——…；对策——…`

**改写规则**：
1. seed 的踩坑表（问题/原因/解决方案）直接映射为现象/原因/对策
2. 真实条目的方法链蒸馏成可复用坑（保留技术结论，删目标细节）
3. 每技能吸收 1-4 条（按价值裁量，不硬凑）

**查重规则**：
- 入库前 `grep -n "关键词" <目标技能>/SKILL.md`（含 references/）
- 同现象已存在 → 跳过并记录
- 内容更完整的新版本可合并

**版权注明**：
- 每技能吸收的条目末尾加一行：`（来源：reverse-skill field-journal，MIT）`
- README 不需要额外声明（条目级注明即可）——或按技能库惯例在吸收批次 commit message 注明

**脱敏**：
- 真实条目中的目标特征（名称/域名/指纹）全部泛化
- 工具名/版本号/公开技术特征保留（如 GoReSym、跳转表公式）

## 查重预检（已识别）

- seed-008 SSL Pinning：frida-scripts.md 已有「SSL 固定绕过」模板——**预判命中，吸收时先查重，命中则跳过**
- seed-010 pwn ROP：re-pwn 已有——不在候选（跳过清单已含）
- seed-015 UART：re-hardware-io 已有——不在候选（跳过清单已含）
- seed-011 PCAP：re-proto-rev 已覆盖协议状态机——吸收前查重，可能部分命中

## 校验与测试

- 每处吸收后 `npm test` 全绿（107 skills 不变，无新技能）
- 吸收条目无 [[死链]]（引用技能均存在）
- 红线 2：吸收内容无具体项目/公司/产品指代
- 不触碰工作区其他文件

## 范围外

- reverse-skill 机制层（routing.json/tool-index/自动回流 CI/scope 门/下一步菜单/CTF 编排）——用户确认不做
- 渗透测试类条目（Web/AD/云渗透）——非逆向域
- reverse-skill 自身工程类条目
