# 6 个新技能 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增 6 个原子技能（re-doc-malware / re-variant / re-hunting / re-mobile-forensics / re-stego / re-browser-ext）+ 挂载同步，技能总数 101 → 107。

**Architecture:** 纯技能文档扩展。6 个新技能目录（SKILL.md，按 docs/skill-template.md 原子技能规范）+ 挂载（5 网关子技能/选择树、rerouting 3 行）+ 计数同步（README / AGENTS / marketplace）。

**Tech Stack:** Markdown / YAML frontmatter / validate.mjs（npm test，现有）

## Global Constraints

- **红线 1 呈现中性**：禁用「最推荐」「强烈建议」等最高级强推措辞
- **红线 2 隐私脱敏**：内容不指向具体项目/公司/产品
- **不绑定具体工具**：方法为核心，工具为可替换示例；「工具准备」按模板给跨 OS 安装命令
- validate.mjs：frontmatter `name`=目录名、`description` 非空、`type: atomic` 必含「## 工具准备」、`[[链接]]` 必须解析
- 工作区已干净（无未提交文件）——所有目标文件可正常修改提交；各任务 commit 只 `git add` 本任务列出的文件
- 当前分支 `main`；`npm test` 预期按任务标注递增（102 → 107）

---

### Task 1: 创建 re-doc-malware 技能

**Files:**
- Create: `.claude/skills/re-doc-malware/SKILL.md`

**Interfaces:**
- Consumes: 无（新目录）
- Produces: 技能目录 `re-doc-malware`（供 Task 7 的 [[re-doc-malware]] 链接解析；计数 101 → 102）

- [ ] **Step 1: 创建目录与 SKILL.md**

```bash
mkdir -p .claude/skills/re-doc-malware
```

写入 `.claude/skills/re-doc-malware/SKILL.md`：

````markdown
---
name: re-doc-malware
type: atomic
description: >
  恶意文档分析：PDF/Office 武器化、宏链、文档漏洞利用、载荷提取。
  触发词：恶意文档、钓鱼文档、PDF恶意、宏文档、docm、文档漏洞、恶意附件。
---

# 恶意文档分析

## 何时使用 / 何时不用

- 用：钓鱼附件（PDF/Office/RTF）、文档漏洞利用样本、宏文档、文档型恶意载荷
- 不用：纯脚本宏（转 [[re-script-deob]]）；文档仅是载体（核心逻辑在下载载荷）

## 工具准备

### pdf-parser / peepdf（PDF 结构分析）

- Linux: `apt install pdf-parser` 或 `pip install peepdf`；macOS: `brew install pdf-parser` / pip
- Windows: pip（WSL 亦可）
- 验证: `pdf-parser --version`（无则 `python3 -m pdf_parser --help`）

### olevba / oledump（Office 宏提取）

- 多平台: `pip install oletools`
- 验证: `olevba --help`

### LibreOffice（沙箱打开验证，可选）

- Linux: `apt install libreoffice` / `dnf install libreoffice`；macOS: `brew install --cask libreoffice`；Windows: 官方安装包
- 验证: `libreoffice --version`

### 7z（OLE/OOXML 解包）

- Linux: `apt install p7zip-full`；macOS: `brew install sevenzip`；Windows: 官方安装包
- 验证: `7z --help`

## 操作步骤

按顺序执行；动态打开文档必须沙箱（[[re-sandbox]]，[[platform-tips]] 最高原则）。每步产物存档（路径 + sha256，见 [[re-triage]]）。

1. **文档类型识别**：
   ```sh
   file sample.pdf sample.docm sample.rtf
   ```
   - PDF：`%PDF` 头；Office 旧格式：CFB（OLE 复合文档，`D0 CF 11 E0`）；OOXML：zip（`PK`）；RTF：`{\rtf`
   - 类型决定后续工具链

2. **PDF 恶意分析**：
   ```sh
   pdf-parser -f sample.pdf | head -50        # 对象树遍历（-f 强制，解 FlateDecode）
   pdf-parser -s /JS sample.pdf               # JavaScript 动作
   pdf-parser -s /OpenAction sample.pdf       # 打开即执行动作
   ```
   - 恶意特征：`/JS`（JavaScript 动作）、`/OpenAction`（打开触发）、`/AA`（自动动作）、`/Launch`（外部程序）、嵌入文件（`/EmbeddedFile`）
   - 漏洞文档：`/JBIG2Decode`（JBIG2 漏洞）、`/RichMedia`（Flash 遗留）等 CVE 对应结构——按结构特征对照已知利用模式
   - JS 载荷 → [[re-script-deob]] 还原

3. **Office 分析**：
   ```sh
   olevba -c sample.docm > macro.txt          # 提取宏源码
   olevba --decode -c sample.docm > macro_decoded.txt
   strings sample.docm | grep -iE 'DDEAUTO|http|powershell' | head
   ```
   - 宏链：AutoOpen / Workbook_Open / Document_Open / Auto_Open
   - 其他向量：DDE 域（`DDEAUTO`）、外部链接（`/hyperlink`）、OLE 嵌入对象（7z 解包后逐个分析）、模板注入（`/word/_rels`）
   - 宏载荷 → [[re-script-deob]] 去混淆链

4. **载荷提取**：
   - 提取项：脚本/URL/二进制/多级载荷（每层存档编号）
   - 指标提取 → [[re-ioc]]（URL/域名/哈希）
   - 提取物初勘 → [[re-triage]]

5. **动态验证**（沙箱）：
   - [[re-sandbox]] 内用 LibreOffice/阅读器打开，网络隔离（INetSim/fake DNS）
   - 观察：文件释放、进程链、网络回连（[[re-behavior]] 衔接）

## 跨域联合

- [[re-malware]] 网关：本技能归属（选择树「钓鱼附件」分支）
- [[re-script-deob]]：宏/JS 去混淆还原
- [[re-sandbox]]：动态打开强制前置
- [[re-ioc]]：提取指标
- [[re-behavior]]：行为验证衔接

## 常见坑与陷阱

- **PDF 对象流压缩未解**：现象——pdf-parser 输出无 `/JS`；原因——对象在 FlateDecode 压缩流内；对策——`-f` 强制解压再查
- **宏被混淆**：现象——olevba 提取后满屏拼接/编码；原因——宏混淆；对策——[[re-script-deob]] 去混淆链逐层解
- **文档漏洞版本特征**：现象——结构特征与已知 CVE 不符；原因——利用代码针对特定版本；对策——按结构特征（非版本号）对照利用模式，标注版本假设
- **沙箱检测文档（延迟执行）**：现象——沙箱内无行为；原因——文档检测环境后不触发；对策——延长观察窗口、模拟用户交互（滚动/点击）
- **模板注入易漏**：现象——宏正常但仍有外联；原因——`/word/_rels` 远程模板；对策——解包后检查全部 rels 文件
````

- [ ] **Step 2: 结构校验**

Run: `npm test`
Expected: `OK: 102 skills validated`（[[链接]]：re-script-deob/re-sandbox/re-triage/re-ioc/re-behavior/re-malware/platform-tips 均存在）

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/re-doc-malware/SKILL.md
git commit -m "feat: re-doc-malware 技能——PDF/Office 武器化分析与载荷提取"
```

---

### Task 2: 创建 re-variant 技能

**Files:**
- Create: `.claude/skills/re-variant/SKILL.md`

**Interfaces:**
- Consumes: 无（新目录）
- Produces: 技能目录 `re-variant`（供 Task 7 的 [[re-variant]] 链接解析；计数 102 → 103）

- [ ] **Step 1: 创建目录与 SKILL.md**

```bash
mkdir -p .claude/skills/re-variant
```

写入 `.claude/skills/re-variant/SKILL.md`：

````markdown
---
name: re-variant
type: atomic
description: >
  二进制变体/补丁对比：函数匹配、N-day 补丁 diff、变体溯源与相似度分析。
  触发词：二进制对比、补丁对比、N-day、变体分析、BinDiff、函数匹配、样本相似。
---

# 二进制变体/补丁对比

## 何时使用 / 何时不用

- 用：补丁前后对比（漏洞定位）、家族变体关联、样本溯源、N-day 分析
- 不用：单样本深度分析（走 [[re-binary-core]] 通用路径）

## 工具准备

### BinDiff / Diaphora（函数匹配插件）

- BinDiff: Windows 商业工具（安装指引，可替换为开源替代）；Diaphora: 多平台开源（`git clone https://github.com/joxeankoret/diaphora`，IDA/Ghidra 插件）
- Ghidra 侧替代: BinDiff 官方 Ghidra 插件或 Diaphora 的 Ghidra 移植
- 验证: 插件在反编译器内可加载

### radiff2 / rz-diff（rizin 命令行对比）

- Linux: `apt install rizin` / `pacman -S rizin`；macOS: `brew install rizin`；Windows: 官方安装包
- 验证: `rz-diff --version`

### readelf（符号对齐辅助）

- 安装与验证见 [[re-cpp-abi]] 工具准备

## 操作步骤

按顺序执行，每步产物存档（路径 + sha256，见 [[re-triage]]）。

1. **函数匹配**：
   ```sh
   # 命令行快速对比（rizin 系）：指令哈希 + 调用图相似度
   rz-diff -ss sample_v1 sample_v2 | head -30
   ```
   - 匹配维度：指令哈希（相同代码）、调用图（子图同构）、导入导出对齐、字符串/常量引用
   - 工具（BinDiff/Diaphora）输出：matched / changed / new / deleted 函数集
   - strip 后符号缺失：靠结构匹配（见坑 2）

2. **补丁 diff（N-day）**：
   - 修复前后对比 → `changed` 函数集 = 漏洞点候选
   - 变更函数深挖：新条件分支/新校验/新增调用（[[re-ghidra]] / [[re-ida]] 反编译）
   - 反推漏洞：旧代码的缺陷模式（缺失校验/越界/释放后使用）
   - 产出：漏洞函数 + 缺陷模式推断（置信度标注）

3. **变体溯源**：
   - 家族内样本两两对比 → 相似度矩阵 → 聚类（共享函数比例阈值）
   - 演进链：按时间线/相似度排序样本（早期 vs 晚期变体）
   - 共享独有函数 = 家族标志（与 [[re-attribution]] 能力证据衔接）

4. **输出差异清单**：
   - 格式：变更函数表（函数名/地址/变更类型/相似度）+ 结论
   - 按 [[analysis-contract]] 数据契约传递（下游消费）

## 跨域联合

- [[re-binary-core]] 网关：本技能归属（选择树「补丁/N-day 对比」分支）
- [[re-ghidra]] / [[re-ida]]：反编译底座（变更函数深挖）
- [[re-attribution]]：变体关联的能力证据衔接
- [[analysis-contract]]：差异清单按数据契约传递

## 常见坑与陷阱

- **编译器差异干扰匹配**：现象——同源码不同编译器编译被判不相似；原因——优化/代码生成差异；对策——用调用图与常量引用加权，降低指令哈希权重
- **strip 后符号缺失**：现象——函数名全无；原因——符号剥离；对策——结构匹配（入口特征/调用模式）、导入表锚定
- **跨架构对比降级**：现象——x86 vs ARM 匹配率低；原因——指令集不同；对策——只比逻辑层（调用图/常量/字符串），标注跨架构局限
- **大量相似导致误关联**：现象——共享库代码导致虚高相似度；原因——公共依赖（libc/框架）；对策——排除共享库符号，只比业务代码
- **补丁 diff 定位偏差**：现象——changed 函数多，漏洞点被淹没；原因——补丁含重构；对策——按变更语义过滤（新增校验/边界处理优先）
````

- [ ] **Step 2: 结构校验**

Run: `npm test`
Expected: `OK: 103 skills validated`（[[链接]]：re-binary-core/re-ghidra/re-ida/re-attribution/analysis-contract/re-triage/re-cpp-abi 均存在）

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/re-variant/SKILL.md
git commit -m "feat: re-variant 技能——函数匹配/补丁 diff/变体溯源"
```

---

### Task 3: 创建 re-hunting 技能

**Files:**
- Create: `.claude/skills/re-hunting/SKILL.md`

**Interfaces:**
- Consumes: 无（新目录）
- Produces: 技能目录 `re-hunting`（供 Task 7 的 [[re-hunting]] 链接解析；计数 103 → 104）

- [ ] **Step 1: 创建目录与 SKILL.md**

```bash
mkdir -p .claude/skills/re-hunting
```

写入 `.claude/skills/re-hunting/SKILL.md`：

````markdown
---
name: re-hunting
type: atomic
description: >
  威胁狩猎方法论：假设驱动、遥测源选择、基线对比与验证闭环。
  触发词：威胁狩猎、狩猎、hunting、假设驱动、遥测分析、异常检测。
---

# 威胁狩猎

## 何时使用 / 何时不用

- 用：主动狩猎请求（「环境里有没有 X 的活动」）、假设驱动的环境排查
- 不用：已知样本分析（[[re-behavior]]）；IOC 查询（[[re-ti]]）；单点证据深挖（各域技能）

## 工具准备

### 日志分析工具（通用）

- 多平台: jq / grep / awk（各发行版自带或 `apt install jq` / `brew install jq`）
- 验证: `jq --version`

### 遥测查询（按环境）

- SIEM/EDR 查询接口（按部署环境给查询指引，工具不绑定）
- 本地日志: journalctl / Windows 事件日志工具（按平台）

### ATT&CK 导航（假设对齐参考）

- 网页工具（公开访问）；本地可下载 Navigator 层文件

## 操作步骤

按顺序执行；假设明确再动手（坑 5）。每步产物存档（路径 + sha256，见 [[re-triage]]）。

1. **狩猎假设生成**：
   - 输入：威胁情报（[[re-ti]]）、已知攻击模式（[[re-behavior]] 经验）、环境特征
   - 假设句式：「攻击者可能通过 X 技术在环境内做了 Y」——X 对齐 ATT&CK 技术
   - 产出：假设列表（每个假设 = 可证伪的搜索目标）

2. **遥测源选择**：
   - 按假设选数据源：进程行为 → EDR/进程日志；网络 → 流量/防火墙日志；登录 → 认证日志；文件 → 文件系统监控
   - 数据源缺失 → 标注盲区（结论的有效性边界）

3. **基线 vs 异常**：
   - 基线：正常窗口的统计分布（频率/来源/目标特征）
   - 异常检测：偏离基线的行为（新进程链、非常规时段、异常目标）、规则匹配（已知模式）
   - 聚类：异常条目按特征聚类（减少人工逐个审查）

4. **验证闭环**：
   - 命中确认：异常 → 深挖（[[re-behavior]] 行为分析、[[re-variant]] 样本关联）
   - 误报排除：白名单核对、环境解释（合法变更/维护窗口）
   - 证据存档：按 [[analysis-contract]] 复核格式（结论/证据/置信度）
   - 闭环输出：确认命中 → 事件报告；未命中 → 假设归档（可复跑）

## 跨域联合

- [[re-forensics]] 网关：本技能归属
- [[re-ti]]：情报输入（假设来源）
- [[re-behavior]]：命中深挖
- [[re-variant]]：样本关联
- [[analysis-contract]]：结论按复核格式交付

## 常见坑与陷阱

- **基线污染**：现象——异常被视为正常；原因——环境本身已被攻陷（基线含恶意活动）；对策——基线窗口选择在已知干净时段，标注基线假设
- **遥测缺失盲区**：现象——无异常结论但环境有活动；原因——关键数据源未采集；对策——步骤 2 显式标注盲区，结论限定「在已采集遥测内」
- **误报疲劳**：现象——大量命中无人深挖；原因——规则过宽/阈值过低；对策——先聚类再审查，阈值按基线校准
- **假设过窄**：现象——只查了一个技术；原因——假设单一；对策——按 ATT&CK 技术族生成多假设（覆盖率声明）
- **结论过强**：现象——「环境干净」声明；原因——未标注盲区与假设边界；对策——结论带限定（见坑 2）
````

- [ ] **Step 2: 结构校验**

Run: `npm test`
Expected: `OK: 104 skills validated`（[[链接]]：re-behavior/re-ti/re-variant/re-forensics/analysis-contract/re-triage 均存在）

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/re-hunting/SKILL.md
git commit -m "feat: re-hunting 技能——假设驱动狩猎/遥测选择/验证闭环"
```

---

### Task 4: 创建 re-mobile-forensics 技能

**Files:**
- Create: `.claude/skills/re-mobile-forensics/SKILL.md`

**Interfaces:**
- Consumes: 无（新目录）
- Produces: 技能目录 `re-mobile-forensics`（供 Task 7 的 [[re-mobile-forensics]] 链接解析；计数 104 → 105）

- [ ] **Step 1: 创建目录与 SKILL.md**

```bash
mkdir -p .claude/skills/re-mobile-forensics
```

写入 `.claude/skills/re-mobile-forensics/SKILL.md`：

````markdown
---
name: re-mobile-forensics
type: atomic
description: >
  移动设备取证：Android/iOS 备份解析、应用数据提取、删除恢复与时间线。
  触发词：移动取证、手机取证、ADB备份、iTunes备份、手机数据提取。
---

# 移动设备取证

## 何时使用 / 何时不用

- 用：设备备份/镜像的数据提取、应用数据取证、删除恢复
- 不用：App 逆向分析（[[re-mobile]]）；通用文件系统分析（[[re-disk-forensics]]）

## 工具准备

### adb（Android 设备接口）

- Linux: `apt install adb` / `dnf install android-tools`；macOS: `brew install android-platform-tools`；Windows: 官方平台工具
- 验证: `adb --version`

### libimobiledevice（iOS 设备接口）

- Linux: `apt install libimobiledevice-utils`；macOS: `brew install libimobiledevice`；Windows: 官方构建
- 验证: `idevice_id -l`（列出设备）

### 备份解析工具

- Android: `ab` 备份格式解析（python 脚本或工具）；iOS: `libimobiledevice` 的 `idevicebackup2` + manifest 解析
- sqlite3（数据库读取，见 [[re-disk-forensics]] 工具准备）

## 操作步骤

按顺序执行；设备操作遵循授权边界（红线：仅授权设备）。每步产物存档（路径 + sha256，见 [[re-triage]]）。

1. **Android 提取**：
   ```sh
   adb backup -f backup.ab -all        # 全量备份（应用需允许备份）
   # ab 格式：头（ANDROID BACKUP）+ 可选 AES 加密 + tar 负载
   adb shell run-as com.target.app ls data   # 应用沙箱（debuggable 应用）
   ```
   - 备份解析：ab 头 → 解包 tar（加密备份需密码）
   - 应用沙箱：`run-as`（debuggable）/ root 设备直接读
   - 数据库提取 → sqlite3（[[re-disk-forensics]] 的 SQLite 页结构方法）

2. **iOS 提取**：
   ```sh
   idevicebackup2 backup --full ./backup_dir
   # 备份结构：manifest.plist + 按哈希路径组织的文件
   ```
   - 备份解析：manifest.plist（文件映射）、加密备份需密码（无密码则标注不可提取）
   - Keychain 条目（需提取工具，权限边界）
   - 应用数据：Library/Preferences、Documents、Caches（按应用沙箱路径）

3. **删除恢复与时间线**：
   - SQLite 删除记录（freelist 残留——[[re-disk-forensics]] 数据库文件格式方法）
   - 时间线重建：文件时间戳 + 数据库记录时间（注意时区——见坑 5）
   - 产出：时间线表（时间/动作/来源）+ 恢复数据

## 跨域联合

- [[re-forensics]] 网关：本技能归属
- [[re-disk-forensics]]：SQLite 结构/WAL/删除恢复方法
- [[re-mobile]]：App 结构理解（沙箱路径/数据结构）

## 常见坑与陷阱

- **加密备份无密钥**：现象——备份无法解析；原因——AES 加密；对策——无密码则标注不可提取，不硬破解（授权边界）
- **ADB backup 权限限制**：现象——备份为空；原因——应用未声明 `allowBackup`；对策——换 root/镜像提取，标注路径局限
- **iOS 哈希路径混淆**：现象——文件找不到；原因——备份文件按内容哈希组织（非原名）；对策——manifest.plist 映射解析
- **时间线时区**：现象——时间错位；原因——设备时区与取证时区不一致；对策——统一 UTC 记录，标注设备时区
- **沙箱边界**：现象——拿不到目标数据；原因——无 root/未越狱；对策——按可提取范围交付（限定结论），不越授权
````

- [ ] **Step 2: 结构校验**

Run: `npm test`
Expected: `OK: 105 skills validated`（[[链接]]：re-mobile/re-disk-forensics/re-forensics/re-triage 均存在）

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/re-mobile-forensics/SKILL.md
git commit -m "feat: re-mobile-forensics 技能——Android/iOS 备份解析与删除恢复"
```

---

### Task 5: 创建 re-stego 技能

**Files:**
- Create: `.claude/skills/re-stego/SKILL.md`

**Interfaces:**
- Consumes: 无（新目录）
- Produces: 技能目录 `re-stego`（供 Task 7 的 [[re-stego]] 链接解析；计数 105 → 106）

- [ ] **Step 1: 创建目录与 SKILL.md**

```bash
mkdir -p .claude/skills/re-stego
```

写入 `.claude/skills/re-stego/SKILL.md`：

````markdown
---
name: re-stego
type: atomic
description: >
  隐写术检测与提取：文件尾附加、图片 LSB、音频与其他载体、提取验证。
  触发词：隐写、stego、LSB、文件尾附加、隐写提取、图片隐写。
---

# 隐写术检测与提取

## 何时使用 / 何时不用

- 用：隐写怀疑（CTF 题/取证对象）、文件尾异常、图片/音频异常
- 不用：正常文件分析（各归各域技能）

## 工具准备

### zsteg（图片 LSB 扫描）

- 多平台: `gem install zsteg` 或源码（GitHub）
- 验证: `zsteg -v`

### steghide（图片/音频隐写）

- Linux: `apt install steghide` / `dnf install steghide`；macOS: `brew install steghide`
- 验证: `steghide info --help`

### binwalk（尾部扫描）

- 安装与验证见 [[re-fw-extract]] 工具准备

### python3（位操作/验证脚本）

- 安装与验证见 [[re-python]] 工具准备

## 操作步骤

按顺序执行，每步产物存档（路径 + sha256，见 [[re-triage]]）。

1. **文件尾附加检测**：
   ```sh
   binwalk sample.png | tail -20       # 附加数据扫描
   hexdump -C sample.png | tail -10    # 尾部目检
   ```
   - 尾部附加：文件正常但尾部有多余数据（衔接 [[re-patching]] 尾部附加经验）
   - 提取：binwalk 自动分割或 dd 按偏移提取 → magic 检查（[[re-triage]]）

2. **图片 LSB**：
   ```sh
   zsteg sample.png                    # 全通道 LSB 扫描
   zsteg -E 'b1,rgb,lsb,xy' sample.png # 指定通道/位平面提取
   ```
   - 通道：RGB/alpha 各通道最低位；位平面：b1/b2（低 2 位）
   - 顺序：行序/位序影响提取结果（见坑 1）
   - 无工具时的脚本路径：python3 按像素遍历提取位序列

3. **其他载体**：
   - 音频：频谱隐写（音频可视化工具查频域图案）、相位/回声隐写
   - 文件冗余区：EXIF、文件头保留区、压缩文件未用空间
   - 多载体组合（题目常用）

4. **提取验证**：
   - magic 检查（提取物头部特征）
   - 可读性验证（strings/file）
   - 隐写前压缩：先解压再提（见坑 3）

## 跨域联合

- [[re-ctf]] 网关：本技能归属
- [[re-fw-extract]]：binwalk 复用
- [[re-patching]]：尾部附加经验衔接
- [[re-triage]]：提取物初勘

## 常见坑与陷阱

- **LSB 顺序**：现象——提取乱码；原因——行序（从上到下/从下到上）/位序（LSB 优先/MSB 优先）；对策——工具自动尝试或脚本枚举组合
- **多载体误判**：现象——一个文件中多个隐写层；原因——嵌套隐写；对策——分层提取，每层验证
- **隐写前压缩**：现象——提取物乱码；原因——明文先压缩再嵌入；对策——先查压缩特征（zlib 头）再解压
- **工具输出噪声**：现象——大量候选；原因——扫描输出含误报；对策——按 magic/可读性过滤
- **载体本身异常**：现象——文件损坏；原因——隐写写入破坏结构；对策——先修复/容忍损坏（按位提取不依赖结构）
````

- [ ] **Step 2: 结构校验**

Run: `npm test`
Expected: `OK: 106 skills validated`（[[链接]]：re-ctf/re-fw-extract/re-patching/re-triage/re-python 均存在）

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/re-stego/SKILL.md
git commit -m "feat: re-stego 技能——文件尾/LSB/多载体隐写检测与提取"
```

---

### Task 6: 创建 re-browser-ext 技能

**Files:**
- Create: `.claude/skills/re-browser-ext/SKILL.md`

**Interfaces:**
- Consumes: 无（新目录）
- Produces: 技能目录 `re-browser-ext`（供 Task 7 的 [[re-browser-ext]] 链接解析；计数 106 → 107）

- [ ] **Step 1: 创建目录与 SKILL.md**

```bash
mkdir -p .claude/skills/re-browser-ext
```

写入 `.claude/skills/re-browser-ext/SKILL.md`：

````markdown
---
name: re-browser-ext
type: atomic
description: >
  浏览器扩展逆向：权限清单、恶意行为定位、混淆还原、上架审查绕过面。
  触发词：浏览器扩展、Chrome扩展、Firefox扩展、恶意扩展、extension。
---

# 浏览器扩展逆向

## 何时使用 / 何时不用

- 用：扩展文件（crx/xpi/zip）、恶意扩展行为分析、扩展权限审计
- 不用：网页 JS 混淆（[[re-script-deob]] 覆盖纯脚本）

## 工具准备

### unzip / 7z（解包）

- 安装与验证见 [[re-doc-malware]] 工具准备（7z）

### jq（manifest 解析）

- Linux: `apt install jq`；macOS: `brew install jq`；Windows: 官方构建
- 验证: `jq --version`

### node（扩展脚本运行/验证，可选）

- 各平台安装见 [[re-python]] 工具准备模式（node 官方安装包）
- 验证: `node --version`

## 操作步骤

按顺序执行，每步产物存档（路径 + sha256，见 [[re-triage]]）。

1. **解包与结构**：
   ```sh
   unzip sample.crx -d ext/          # crx/xpi = zip 容器
   jq '.permissions, .host_permissions' ext/manifest.json
   ```
   - 结构：manifest.json + 背景脚本（background/service_worker）+ 内容脚本（content_scripts）+ 页面
   - 权限清单：`permissions`（API 权限）、`host_permissions`（站点访问）——权限决定能力边界

2. **恶意行为定位**：
   - 数据外泄：fetch/XHR/beacon（[[re-netcap]] 衔接）、`navigator.sendBeacon`、图片像素外传
   - 权限滥用：tabs（读取页面）、storage（数据收集）、webRequest（流量篡改/监控）、clipboard（剪贴板窃取）
   - 注入面：content_scripts 匹配站点、动态注入（`chrome.scripting.executeScript`）
   - 后台脚本是核心（MV3 的 service worker / MV2 的 background page）

3. **混淆还原**：
   - 衔接 [[re-script-deob]] 高级混淆对抗（bootstrap/字符串表/CFF）
   - 远程代码：MV2 允许远程 JS（`eval`/动态加载）；MV3 禁止远程 JS（远程代码是审查绕过信号）

4. **上架审查绕过面分析**：
   - 动态加载（运行时拉取代码——MV2 特征）
   - obfuscation 检测规避（代码混淆超过阈值触发审查）
   - 多阶段（无害首版 + 更新后恶意——版本对比 [[re-variant]] 思路）

## 跨域联合

- [[re-managed]] 网关：本技能归属（选择树「浏览器扩展」分支）
- [[re-script-deob]]：混淆还原
- [[re-netcap]]：网络行为衔接
- [[re-variant]]：扩展版本对比（更新后恶意检测）

## 常见坑与陷阱

- **manifest 版本差异**：现象——MV2 分析思路套 MV3 失效；原因——权限模型不同（MV3 禁远程代码/后台改 service worker）；对策——先确认 manifest_version
- **远程代码策略**：现象——静态找不到恶意逻辑；原因——代码远程拉取（MV2）；对策——网络侧抓取（[[re-netcap]]）后还原
- **动态注入绕过静态分析**：现象——content_scripts 无恶意但行为异常；原因——运行时注入；对策——hook 注入 API（scripting.executeScript）
- **沙箱与页面隔离**：现象——扩展 API 调用点难定位；原因——扩展上下文与页面上下文隔离；对策——分上下文分析（background/content/page）
- **更新后恶意**：现象——首版干净；原因——版本更新注入恶意；对策——版本 diff（[[re-variant]]）
````

- [ ] **Step 2: 结构校验**

Run: `npm test`
Expected: `OK: 107 skills validated`（[[链接]]：re-script-deob/re-netcap/re-variant/re-managed/re-triage/re-doc-malware 均存在——re-variant 由 Task 2 创建，re-doc-malware 由 Task 1 创建）

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/re-browser-ext/SKILL.md
git commit -m "feat: re-browser-ext 技能——扩展权限审计/恶意行为/混淆还原"
```

---

### Task 7: 挂载与计数同步

**Files:**
- Modify: `.claude/skills/re-malware/SKILL.md`（子技能列表 + 选择树分支）
- Modify: `.claude/skills/re-binary-core/SKILL.md`（子技能列表 + 选择树分支）
- Modify: `.claude/skills/re-forensics/SKILL.md`（子技能列表加 2 个）
- Modify: `.claude/skills/re-ctf/SKILL.md`（子技能列表加 1 个）
- Modify: `.claude/skills/re-managed/SKILL.md`（子技能列表 + 选择树分支）
- Modify: `.claude/skills/re-analyze/references/rerouting.md`（A 表加 3 行）
- Modify: `README.md`（计数 101→107、88→94、导航加 6 行）
- Modify: `AGENTS.md`（101→107、88→94）
- Modify: `.claude-plugin/marketplace.json`（101→107）

**Interfaces:**
- Consumes: Task 1-6 的 6 个技能目录（链接可解析）
- Produces: 6 技能全库可达；计数 107 = 1 + 12 + 94

- [ ] **Step 1: 网关挂载（5 文件，7 处编辑）**

`.claude/skills/re-malware/SKILL.md` 子技能列表（description 行，末尾 `[[re-fileless]]`）追加 `、[[re-doc-malware]]`；选择树（「**无文件样本**…」分支后）插入：

```markdown
- **钓鱼附件（PDF/Office/RTF 文档）** → [[re-doc-malware]]（文档武器化/宏链/载荷提取）
```

`.claude/skills/re-binary-core/SKILL.md` 子技能列表（description 行，末尾 `[[re-fp-runtime]]`）追加 `、[[re-variant]]`；选择树（「**目标是 Haskell/OCaml 产物**…」分支后）插入：

```markdown
- **补丁/N-day 对比（修复前后/变体关联）** → [[re-variant]]（函数匹配/补丁 diff）
```

`.claude/skills/re-forensics/SKILL.md` 子技能列表（description 行，末尾 `[[re-attribution]]`）追加 `、[[re-hunting]]、[[re-mobile-forensics]]`

`.claude/skills/re-ctf/SKILL.md` 子技能列表（description 行，末尾 `[[re-pwn]]`）追加 `、[[re-stego]]`

`.claude/skills/re-managed/SKILL.md` 子技能列表（description 行，末尾 `[[re-blockchain]]`）追加 `、[[re-browser-ext]]`；选择树（「**EVM 合约字节码**…」分支后）插入：

```markdown
- **浏览器扩展（crx/xpi/zip 扩展文件）** → [[re-browser-ext]]（权限审计/恶意行为/混淆还原）
```

- [ ] **Step 2: rerouting A 表加 3 行**

`.claude/skills/re-analyze/references/rerouting.md` A 表末尾（RTTI 行之后）追加：

```markdown
| PDF/Office 宏/钓鱼文档特征 | [[re-doc-malware]] |
| 补丁/N-day 对比需求（修复前后/变体） | [[re-variant]] |
| 文件尾附加/图片异常（隐写怀疑） | [[re-stego]] |
```

- [ ] **Step 3: 计数同步（3 文件）**

`README.md`：
- `## 技能导航（101）` → `## 技能导航（107）`
- `入口 → 12 大类网关 → 88 原子技能` → `入口 → 12 大类网关 → 94 原子技能`
- 第 5 行 `101 个逆向工程技能` → `107 个逆向工程技能`
- 导航行：re-malware 行加 `、re-doc-malware`；re-binary-core 行加 `、re-variant`；re-forensics 行加 `、re-hunting、re-mobile-forensics`；re-ctf 行加 `、re-stego`；re-managed 行加 `、re-browser-ext`

`AGENTS.md`：
- `（101 个技能）` → `（107 个技能）`
- `原子技能（88）` → `原子技能（94）`

`.claude-plugin/marketplace.json`：
- `101 个技能` → `107 个技能`

- [ ] **Step 4: 校验**

Run: `npm test`
Expected: `OK: 107 skills validated`

Run: `grep -c "re-doc-malware\|re-variant\|re-hunting\|re-mobile-forensics\|re-stego\|re-browser-ext" README.md`
Expected: ≥ 5（各技能名在导航行各出现 1 次，grep -c 按行计，5 个网关行各含 1+ 名）

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/re-malware/SKILL.md .claude/skills/re-binary-core/SKILL.md .claude/skills/re-forensics/SKILL.md .claude/skills/re-ctf/SKILL.md .claude/skills/re-managed/SKILL.md .claude/skills/re-analyze/references/rerouting.md README.md AGENTS.md .claude-plugin/marketplace.json
git commit -m "增强: 6 技能挂载与计数同步 107（5 网关/rerouting 3 行/README-AGENTS-marketplace）"
```
