# 6 个新技能设计 v2（2026-08-18）

## 背景

rev-skills（101 技能）生态对标盘点后的第二批缺口：恶意文档 / 变体对比 / 威胁狩猎 / 移动取证 / 隐写 / 浏览器扩展。用户确认全部新增。

设计约束（沿用全库红线与原则）：
- **红线 1 呈现中性**：禁用「最推荐」「强烈建议」等最高级强推措辞
- **红线 2 隐私脱敏**：内容不指向具体项目/公司/产品
- **不绑定具体工具**：方法为核心，工具为可替换示例（工具准备保留跨 OS 安装指引）
- 工作区已干净，无未提交文件冲突
- 当前分支 `main`

## 变更总览

| # | 新技能 | 类型 | 挂载 | 计数 |
|---|---|---|---|---|
| 1 | re-doc-malware | 原子 | re-malware | 102 |
| 2 | re-variant | 原子 | re-binary-core | 103 |
| 3 | re-hunting | 原子 | re-forensics | 104 |
| 4 | re-mobile-forensics | 原子 | re-forensics | 105 |
| 5 | re-stego | 原子 | re-ctf | 106 |
| 6 | re-browser-ext | 原子 | re-managed | 107 |

最终：107 技能 = 1 入口 + 12 网关 + 94 原子。

## ① re-doc-malware（挂 re-malware）

- **定位**：恶意文档分析——PDF/Office 武器化、宏链、文档漏洞利用
- **frontmatter**：触发词：恶意文档、钓鱼文档、PDF恶意、宏文档、docm、文档漏洞、恶意附件
- **章节**：
  1. 何时使用 / 何时不用——用：钓鱼附件（PDF/Office/RTF）、文档漏洞利用样本、宏文档；不用：纯脚本宏（转 [[re-script-deob]]）
  2. 工具准备——pdf-parser / peepdf（PDF 结构）、olevba / oledump（Office 宏，已有）、LibreOffice（沙箱打开验证）、7z（OLE 解包）；跨 OS 安装
  3. 操作步骤——
     1. 文档类型识别（`file`：PDF/CFB OLE/RTF/OOXML zip）
     2. PDF 恶意分析（对象树、JS 动作流 openAction/AA、嵌入文件、漏洞特征——CVE 对应结构）
     3. Office 分析（宏链 AutoOpen/Workbook_Open、DDE 域、外部链接、OLE 嵌入对象）
     4. 载荷提取（脚本/URL/二进制 → [[re-script-deob]] / [[re-ioc]]）
     5. 动态验证（[[re-sandbox]] 内打开文档，网络隔离）
  4. 跨域联合——[[re-malware]] 网关；[[re-script-deob]]；[[re-sandbox]]；[[re-ioc]]
  5. 常见坑与陷阱——PDF 对象流压缩（FlateDecode 未解）、Office 宏被混淆（衔接去混淆链）、文档漏洞版本特征、沙箱检测文档（延迟执行）
- **挂载**：re-malware 子技能列表 + 选择树分支（钓鱼附件 → [[re-doc-malware]]）

## ② re-variant（挂 re-binary-core）

- **定位**：二进制变体/补丁对比——函数匹配、N-day 补丁 diff、变体溯源
- **frontmatter**：触发词：二进制对比、补丁对比、N-day、变体分析、BinDiff、函数匹配、样本相似
- **章节**：
  1. 何时使用 / 何时不用——用：补丁前后对比（漏洞定位）、家族变体关联、样本溯源；不用：单样本深度分析（走 re-binary-core 通用）
  2. 工具准备——BinDiff / Diaphora（IDA/Ghidra 插件，安装指引）、radiff2/rz-diff（rizin）、readelf；跨 OS 安装
  3. 操作步骤——
     1. 函数匹配（指令哈希、调用图相似度、导入导出对齐——BinDiff/Diaphora 思路）
     2. 补丁 diff（修复前后 → 变更函数定位 → 漏洞点推断）
     3. 变体溯源（家族内样本关联：相似度聚类、演进链）
     4. 输出差异清单（变更函数表 + 相似度，[[analysis-contract]] 衔接）
  4. 跨域联合——[[re-binary-core]] 网关；[[re-ghidra]] / [[re-ida]] 反编译底座
  5. 常见坑与陷阱——编译器差异干扰匹配、strip 后符号缺失、架构差异（跨架构对比降级）、大量相似导致误关联
- **挂载**：re-binary-core 子技能列表 + 选择树分支（补丁/N-day 对比 → [[re-variant]]）

## ③ re-hunting（挂 re-forensics）

- **定位**：威胁狩猎方法论——假设驱动、遥测选择、验证闭环
- **frontmatter**：触发词：威胁狩猎、狩猎、hunting、假设驱动、遥测分析、异常检测
- **章节**：
  1. 何时使用 / 何时不用——用：主动狩猎请求（"环境里有没有 X"）；不用：已知样本分析（[[re-behavior]]）、IOC 查询（[[re-ti]]）
  2. 工具准备——日志分析工具（jq/grep/awk 通用）、SIEM 查询（按环境）、ATT&CK 导航；跨 OS 说明
  3. 操作步骤——
     1. 狩猎假设生成（ATT&CK 技术对齐基线、威胁情报输入 [[re-ti]]）
     2. 遥测源选择（端点/网络/日志——按假设选数据源）
     3. 基线 vs 异常（统计基线、规则匹配、异常聚类）
     4. 验证闭环（命中确认——误报排除、[[re-behavior]] 深挖、证据存档 [[analysis-contract]]）
  4. 跨域联合——[[re-forensics]] 网关；[[re-ti]]；[[re-behavior]]；[[re-ioc]]
  5. 常见坑与陷阱——基线污染（环境本身被攻陷）、遥测缺失导致盲区、误报疲劳、假设过窄
- **挂载**：re-forensics 子技能列表

## ④ re-mobile-forensics（挂 re-forensics）

- **定位**：移动设备取证——Android/iOS 数据提取、备份解析、删除恢复
- **frontmatter**：触发词：移动取证、手机取证、ADB备份、iTunes备份、手机数据提取
- **章节**：
  1. 何时使用 / 何时不用——用：设备备份/镜像数据提取、应用数据取证；不用：App 逆向（[[re-mobile]]）、通用文件系统（[[re-disk-forensics]]）
  2. 工具准备——adb（Android）、libimobiledevice（iOS）、备份解析工具、sqlite3（[[re-disk-forensics]] 衔接）；跨 OS 安装
  3. 操作步骤——
     1. Android 提取（ADB backup 解析（ab 格式）、应用沙箱（run-as/root）、SQLite 数据库）
     2. iOS 提取（iTunes 备份解析（manifest.db）、加密备份、Keychain 条目）
     3. 删除恢复与时间线（SQLite 删除记录——[[re-disk-forensics]] 方法、应用时间线重建）
  4. 跨域联合——[[re-forensics]] 网关；[[re-disk-forensics]]；[[re-mobile]] 衔接
  5. 常见坑与陷阱——加密备份无密钥、ADB backup 权限限制（应用未启用 backup）、iOS 备份字段混淆（manifest 哈希路径）、时间线时区
- **挂载**：re-forensics 子技能列表

## ⑤ re-stego（挂 re-ctf）

- **定位**：隐写术检测与提取——LSB、文件尾附加、隐写工具链
- **frontmatter**：触发词：隐写、stego、LSB、文件尾附加、隐写提取、图片隐写
- **章节**：
  1. 何时使用 / 何时不用——用：隐写怀疑（CTF 题/取证对象）、文件尾异常；不用：正常文件分析（走各域技能）
  2. 工具准备——zsteg / steghide / binwalk（尾部扫描已有）/ strings / python3；跨 OS 安装
  3. 操作步骤——
     1. 文件尾附加检测（binwalk/hexdump 尾部 → 附加数据提取——衔接 [[re-patching]] 尾部附加经验）
     2. 图片 LSB（zsteg 扫描、逐位提取、通道分析）
     3. 其他载体（音频相位/频谱、文件冗余区）
     4. 提取验证（magic 检查、可读性验证）
  4. 跨域联合——[[re-ctf]] 网关；[[re-fw-extract]] 的 binwalk 复用；[[re-triage]] 初勘
  5. 常见坑与陷阱——LSB 顺序（行序/位序）、多载体误判、隐写前压缩（先提取再解压——提取物查压缩头：zlib `78 9C` / gzip `1F 8B`）、工具输出噪声
- **挂载**：re-ctf 子技能列表

## ⑥ re-browser-ext（挂 re-managed）

- **定位**：浏览器扩展逆向——权限清单、恶意行为、混淆还原
- **frontmatter**：触发词：浏览器扩展、Chrome扩展、Firefox扩展、恶意扩展、extension
- **章节**：
  1. 何时使用 / 何时不用——用：扩展文件（crx/xpi/zip）、恶意扩展行为分析；不用：网页 JS（[[re-script-deob]] 覆盖纯脚本）
  2. 工具准备——unzip/7z（解包）、jq（manifest 解析）、node（扩展脚本运行）、浏览器（加载验证）；跨 OS 安装
  3. 操作步骤——
     1. 解包与结构（crx/xpi = zip + manifest.json，权限清单解析）
     2. 恶意行为定位（CSP 绕过、数据外泄（fetch/beacon）、权限滥用（tabs/storage/webRequest）、后台脚本）
     3. 混淆还原（衔接 [[re-script-deob]] 高级混淆对抗）
     4. 上架审查绕过面分析（动态加载、远程代码、obfuscation 检测规避）
  4. 跨域联合——[[re-managed]] 网关；[[re-script-deob]]；[[re-netcap]] 网络行为衔接
  5. 常见坑与陷阱——manifest 版本差异（MV2/MV3 权限模型）、远程代码策略（MV3 禁远程 JS）、动态注入绕过静态分析、扩展沙箱与页面上下文隔离
- **挂载**：re-managed 子技能列表 + 选择树分支（浏览器扩展 → [[re-browser-ext]]）

## 同步

- 5 个网关子技能列表挂载（re-malware +1 / re-binary-core +1 / re-forensics +2 / re-ctf +1 / re-managed +1）
- re-malware / re-binary-core / re-managed 选择树各加分支
- rerouting A 表加 3 行：PDF/Office 宏特征 → [[re-doc-malware]]；补丁/N-day 对比需求 → [[re-variant]]；文件尾附加/图片异常 → [[re-stego]]
- README：技能导航（101）→（107）、「12 大类网关 → 88 原子技能」→ 94、导航加 6 行
- AGENTS.md：（101 个技能）→（107 个技能）、原子技能（88）→（94）
- marketplace.json：101 个技能 → 107 个技能

## 校验与测试

- validate.mjs 自动覆盖 6 个新技能（frontmatter name=目录名 / type=atomic / 工具准备 / 链接）
- `npm test` 全绿（107 skills validated）
- rerouting 新增行的 [[链接]] 指向已存在技能
- 工作区干净，无未提交文件冲突
