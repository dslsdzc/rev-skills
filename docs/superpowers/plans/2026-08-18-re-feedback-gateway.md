# re-feedback 经验反馈网关 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增第 12 个网关技能 re-feedback（元网关），实现经验三源收集 → 蒸馏脱敏 → 归域 → 三档处理（发表 issue / 本地入库 / 不入库），并在 re-analyze 末尾挂可选复盘钩子。

**Architecture:** 纯技能库扩展（Markdown 指令集，无新增代码）。新技能目录 `.claude/skills/re-feedback/`（SKILL.md + references/intake.md + references/issue-template.md）；re-analyze/SKILL.md 加「第四步（可选）：经验复盘」；README/AGENTS 同步计数与导航。校验靠现有 validate.mjs（`npm test`）。

**Tech Stack:** Markdown / YAML frontmatter / validate.mjs（Node，现有）

## Global Constraints

- **红线 1 呈现中性**：选项/建议禁用「最推荐」「强烈建议」等最高级强推措辞；选项不带推荐标注，只中性列出与适用场景，用户自决
- **红线 2 隐私脱敏**：蒸馏产物禁止具体到某个项目/公司/产品，暗示也不行（行业+规模+地域组合、专有协议名、内部代号等）；技能库公开发布（npm + 插件市场），本地入库同样受约束；入库/发 issue 前必须脱敏自检
- validate.mjs 规则：frontmatter `name` = 目录名、`description` 非空、`type` ∈ atomic/entry/gateway、正文 `[[链接]]` 必须解析到技能目录或 references/*.md 文件名；gateway 类型豁免「工具准备」
- 工作区现有 3 个未提交修改（`.claude/skills/re-binary-core/SKILL.md`、`re-mobile/SKILL.md`、`re-protocol/SKILL.md`）是用户待处理的入库内容——**各任务 commit 只 `git add` 本任务列出的文件，严禁 `git add -A`**
- 正文纯 Markdown，frontmatter 标准 YAML，技能引用统一 `[[技能名]]`
- 当前分支 `feat/re-skills`

---

### Task 1: 创建 re-feedback 网关主文件

**Files:**
- Create: `.claude/skills/re-feedback/SKILL.md`

**Interfaces:**
- Consumes: 无（新目录）
- Produces: 技能目录 `re-feedback`（validate 的 knownSkills 里新增，供 Task 4 的 `[[re-feedback]]` 链接解析）；引用 `[[intake]]`、`[[issue-template]]`（对应 Task 2/3 的 references 文件名，先建链接后建文件，validate 的 knownRefs 在文件存在后才收录——故本任务验证只检查名称/格式，完整链接校验在 Task 3 后）

- [ ] **Step 1: 创建目录与 SKILL.md**

```bash
mkdir -p .claude/skills/re-feedback/references
```

写入 `.claude/skills/re-feedback/SKILL.md`：

```markdown
---
name: re-feedback
type: gateway
description: >
  经验反馈元网关。三源收集（会话复盘/文章扫描/手动输入）→ 蒸馏脱敏 → 归域 → 三档处理（发表 issue/本地入库/不入库）。
  触发词：反馈经验、经验入库、提交经验、经验复盘、心得沉淀、lessons learned。
---

# 经验反馈

<HARD-GATE>
两条红线，违反即停：
1. 呈现中性：选项/建议禁用「最推荐」「强烈建议」等最高级强推措辞，只中性列出选项与适用场景，由用户自决。
2. 隐私脱敏：蒸馏产物禁止具体到某个项目/公司/产品，暗示也不行（行业+规模+地域组合、专有协议名、内部代号等）。
   本库公开发布（npm + 插件市场），本地入库同样受约束。入库/发 issue 前必须做脱敏自检。
</HARD-GATE>

## 完整工作流

1. 收集（三源归一）：
   - 会话复盘：本次分析会话的踩坑/新方法（[[re-analyze]] 第四步调用时已就绪）
   - 文章扫描：`bin/wxsource.mjs` 抓取看雪/微信文章（`kanxue thread <ID> --md` / `wechat <URL> --md`），逐篇蒸馏
   - 手动输入：用户一句话/一段笔记
2. 蒸馏与脱敏：按 `references/intake.md` —— 坑格式 `**标题**：现象——…；原因——…；对策——…`，同步脱敏
3. 归域分类：`references/intake.md` 决策表 → grep 技能库兜底 → 仍不确定问用户（不猜）
4. 三档处理（中性呈现，不带推荐标注）：
   - ① 发表 issue：`which gh` + `gh auth status` 探测；可用则 `gh issue create --repo DslsDZC/aihk --label 经验`，标题「经验: <技能>: <一句话>」，正文按 `references/issue-template.md`；不可用 → 输出 markdown 草稿供手动提交
   - ② 本地入库：grep 去重 → 追加到该技能 `references/experience.md`（无则创建，条目含来源+日期）→ SKILL.md「常见坑与陷阱」精选同步或追加 experience.md 链接（先建文件再加链接，避免断链）→ `npm test` 校验
   - ③ 不入库：确认后结束
5. （文章扫描路径可选）提交 commit：「经验: 第N轮扫描入库X篇——<篇目>」，message 列出每技能新增条目

## 何时走哪条路（选择树）

- 输入 = 本次分析会话摘要 → 会话复盘源；目标 = 沉淀本次实战
- 输入 = 文章 URL / 帖子 ID / 文章文本 → 文章扫描源；逐篇蒸馏，按 intake.md 标准跳过工具/推广帖
- 输入 = 用户一句话/笔记 → 手动源；直接蒸馏
- 三档选择（中性呈现）：1. 发表 issue（可公开分享、他人可复用）2. 本地入库（本库沉淀、随库发布）3. 不入库（一次性心得）

## 跨域联合

- [[re-analyze]] 第四步（可选）调用本网关做会话复盘
- 归域目标为全部技能（[[re-binary-core]] [[re-malware]] [[re-firmware]] [[re-protocol]] [[re-mobile]] [[re-anti-analysis]] [[re-cracking]] [[re-vuln]] [[re-ctf]] [[re-managed]] [[re-forensics]] 及其原子技能）
- 文章抓取用仓库 `bin/wxsource.mjs`；入库后用 `npm test`（validate.mjs）校验结构

## 常见坑与陷阱

- 蒸馏不脱敏直接入库/发 issue → 泄漏项目身份 —— 红线 2，入库前逐项列专有名词自检
- 呈现带「最推荐」等强推 → 绑架用户判断 —— 红线 1，只中性列选项
- 归域不确定硬猜 → 经验写错技能、下次检索不到 —— 问用户
- 入库后不跑 npm test → 断链/格式错破坏 CI —— 每次入库后必须 `npm test`
- 重复条目重复入库 → 库膨胀 —— 入库前 grep 关键词去重
- 文章扫描不跳过工具/推广帖 → 经验贬值 —— 按 intake.md 跳过标准过滤
```

- [ ] **Step 2: 结构校验**

Run: `npm test`
Expected: `OK: 89 skills validated`（re-feedback 计入；[[]] 链接中的 [[intake]]/[[issue-template]] 此时可能报 broken——属预期，Task 2/3 补齐 references 后复跑解除）

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/re-feedback/SKILL.md
git commit -m "feat: re-feedback 经验反馈网关主文件（三源收集/三档处理/双红线）"
```

---

### Task 2: 创建蒸馏方法论 references/intake.md

**Files:**
- Create: `.claude/skills/re-feedback/references/intake.md`

**Interfaces:**
- Consumes: 无
- Produces: references 文件 `intake`（加入 validate 的 knownRefs，解除 SKILL.md 中 [[intake]] 的 broken 状态）；内容约定：条目格式、脱敏规则、归域决策表（决策表目标链接全部为已存在技能）、去重规则、文章扫描跳过标准

- [ ] **Step 1: 创建 references/intake.md**

写入 `.claude/skills/re-feedback/references/intake.md`：

```markdown
# 蒸馏方法论

经验条目统一格式、脱敏规则、归域决策表、去重规则、文章扫描跳过标准。

## 条目格式

每条一格，格式固定：

**标题（动词短语，10-20 字）**：现象——（可复现的现象描述）；原因——（根因，不重复现象）；对策——（可执行的下一步，含技能/工具名）

示例：

**重打包保持原始格式参数**：现象——重打包/替换资源后的包在真机加载崩溃或解析失败；原因——重打包工具默认输出格式与原格式存在差异（压缩方式/对齐/容器标志）；对策——保留原包的格式参数（压缩标志/对齐方式），产出与原始文件同量级同格式，先本地验证再上真机

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
| 反作弊/内核驱动/虚拟化 | [[re-kernel]] [[re-anti-cheat]] [[re-hypervisor]]（[[re-binary-core]] 系） |

兜底：`grep -rn "关键词" .claude/skills/*/SKILL.md` 找最相关技能；仍不确定 → 问用户，不猜。

## 去重规则

- 入库前 `grep -n "标题关键词" .claude/skills/<技能>/references/experience.md`（文件不存在 = 无重复）
- 同现象已存在 → 跳过并告知用户；内容更完整的新版本可替换旧条目

## 文章扫描跳过标准

- 工具/工作流推广帖（新手教程、工具介绍、无新方法论）
- 正文截断/无法提取正文
- 纯新闻/非逆向内容
```

- [ ] **Step 2: 结构校验**

Run: `npm test`
Expected: `OK: 89 skills validated`（[[intake]] broken 状态解除；[[issue-template]] 仍可能报 broken，属预期）

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/re-feedback/references/intake.md
git commit -m "feat: re-feedback 蒸馏方法论（条目格式/脱敏规则/归域决策表/去重/跳过标准）"
```

---

### Task 3: 创建 issue 模板 references/issue-template.md

**Files:**
- Create: `.claude/skills/re-feedback/references/issue-template.md`

**Interfaces:**
- Consumes: 无
- Produces: references 文件 `issue-template`（解除 SKILL.md 中 [[issue-template]] 的 broken 状态）；约定：gh 提交用 `--body` 传填充后的模板，草稿档直接输出

- [ ] **Step 1: 创建 references/issue-template.md**

写入 `.claude/skills/re-feedback/references/issue-template.md`：

```markdown
# Issue 正文模板

`gh issue create` 用 `--body` 传填充后的模板（占位符全部替换）；草稿档直接输出填充后的模板正文。

**标题**：`经验: <技能名>: <一句话概括>`

**正文**：

## 技能
<技能名，如 re-mobile>

## 现象
<可复现的现象描述>

## 原因
<根因>

## 对策
<可执行的下一步，含技能/工具名>

## 来源
<2026-08 实战会话 / 文章标题 + URL>

## 脱敏声明
- [ ] 已确认：不含具体项目/公司/产品名
- [ ] 已确认：无暗示性细节（行业+规模+地域组合、专有协议名、内部代号）
```

- [ ] **Step 2: 结构校验（全部链接应已解析）**

Run: `npm test`
Expected: `OK: 89 skills validated`，无任何 FAIL 输出

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/re-feedback/references/issue-template.md
git commit -m "feat: re-feedback issue 模板（gh 提交/草稿共用，含脱敏声明）"
```

---

### Task 4: re-analyze 末尾挂经验复盘钩子

**Files:**
- Modify: `.claude/skills/re-analyze/SKILL.md`（在「## 第三步：编排分派」段落末尾、`## 何时使用 / 何时不用` 之前插入「## 第四步（可选）：经验复盘」；第三步段落以"…必要时回退调整路径（见 triage.md 复合任务示例）。"结尾，紧邻其后插入）

**Interfaces:**
- Consumes: Task 1 的技能目录 `re-feedback`（[[re-feedback]] 链接可解析）
- Produces: re-analyze 第四步（可选）——分析后引导用户调用 [[re-feedback]]；triage.md 不改（第四步不属于任务识别路径）

- [ ] **Step 1: 插入第四步段落**

在 `.claude/skills/re-analyze/SKILL.md` 中，`## 何时使用 / 何时不用` 标题之前插入：

```markdown
## 第四步（可选）：经验复盘

分析结论交付后，问用户是否把本次踩坑/新方法反馈给技能库——需要则调用 [[re-feedback]]（三档：发表 issue / 本地入库 / 不入库；蒸馏必须脱敏，见该网关红线）。
```

- [ ] **Step 2: 结构校验**

Run: `npm test`
Expected: `OK: 89 skills validated`，无 FAIL

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/re-analyze/SKILL.md
git commit -m "feat: re-analyze 第四步（可选）经验复盘钩子 → re-feedback"
```

---

### Task 5: README / AGENTS 同步计数与导航

**Files:**
- Modify: `README.md`（第 5 行技能数、第 48 行「技能导航（88）」、第 50 行「入口 → 11 大类网关 → 76 原子技能」、re-forensics 行后追加 re-feedback 行）
- Modify: `AGENTS.md`（第 3 行「88 个技能」、第 8 行「大类网关（11）」）

**Interfaces:**
- Consumes: Task 1 的技能目录（计数 88→89、11→12）
- Produces: 文档一致性（validate.mjs 不校验这两文件，人工 grep 验证）

- [ ] **Step 1: 修改 README.md**

`README.md` 第 5 行：
- `88 个逆向工程技能` → `89 个逆向工程技能`
- `**通用、可发布**` 描述不变

`README.md` 第 48-50 行附近：
- `## 技能导航（88）` → `## 技能导航（89）`
- `入口 → 11 大类网关 → 76 原子技能` → `入口 → 12 大类网关 → 76 原子技能`

re-forensics 行（`- **re-forensics**：...`）之后追加一行：

```markdown
- **re-feedback**：经验反馈元网关——三源收集（会话复盘/文章扫描/手动输入）→ 蒸馏脱敏 → 归域 → 三档处理（发表 issue / 本地入库 / 不入库），re-analyze 第四步挂钩
```

- [ ] **Step 2: 修改 AGENTS.md**

`AGENTS.md` 第 3 行：`（88 个技能）` → `（89 个技能）`

`AGENTS.md` 第 8 行：`大类网关（11）：re-binary-core / re-malware / re-firmware / re-protocol / re-mobile / re-anti-analysis / re-cracking / re-vuln / re-ctf / re-managed / re-forensics` → `大类网关（12）：re-binary-core / re-malware / re-firmware / re-protocol / re-mobile / re-anti-analysis / re-cracking / re-vuln / re-ctf / re-managed / re-forensics / re-feedback（经验反馈元网关）`

- [ ] **Step 3: 校验**

Run: `npm test`
Expected: `OK: 89 skills validated`

Run: `grep -c "re-feedback" README.md AGENTS.md`
Expected: 两个文件各至少 1 处

- [ ] **Step 4: Commit**

```bash
git add README.md AGENTS.md
git commit -m "docs: README/AGENTS 同步 re-feedback（89 技能/12 网关）"
```

---

### Task 6: 端到端走查（三档处理）

**Files:**
- Test: 临时样本经验（不入库样例，仅走查；如需真入库用后删除或保留为演示条目）
- Test: `.claude/skills/re-feedback/references/experience.md`（② 档演练产物，验证后保留——作为该技能自身的经验全集首条）

**Interfaces:**
- Consumes: Task 1-4 全部产物
- Produces: 验证三档路径可用；为 re-feedback 技能自身沉淀一条首条经验

- [ ] **Step 1: 准备脱敏样本**

用以下已脱敏样本（技术内容真实、无项目身份）：

```
**三档选择先问用户再动手**：现象——拿到经验直接按默认档处理（如直接发 issue），用户其实想本地留底；原因——档位是用户的权利，预设处理侵犯自主判断；对策——步骤 4 先用中性句式问「这次经验怎么处理？1. 发表 issue 2. 本地入库 3. 不入库」，等用户选定再执行
```

- [ ] **Step 2: 走查 ① 档（仅验证 gh + 草稿，不真实发 issue）**

Run: `which gh && gh auth status`
- gh 存在且已登录 → 用填充后的模板拼出完整 issue 内容（标题「经验: re-feedback: 三档选择先问用户再动手」+ 技能/现象/原因/对策/来源/脱敏声明 六段），**验证 gh 命令形式**（`gh issue create --help` 确认参数写法），**不执行真实创建**；展示填充后的草稿全文供用户核对
- gh 不存在/未登录 → 确认输出填充后的模板 markdown 草稿（标题 + 技能/现象/原因/对策/来源/脱敏声明 六段），提示用户手动提交
- 无论哪种情况：不调用 `gh issue create` 真实发帖（用户决定：演练零对外影响）

- [ ] **Step 3: 走查 ② 档（本地入库）**

1. 去重：`grep -n "三档选择" .claude/skills/re-feedback/references/experience.md` → 文件不存在（无重复）
2. 创建 `.claude/skills/re-feedback/references/experience.md`：

```markdown
# 经验全集

条目按时间倒序，来源见每条末尾；本文件与 SKILL.md「常见坑与陷阱」精选并存。

## 2026-08

- **三档选择先问用户再动手**：现象——拿到经验直接按默认档处理（如直接发 issue），用户其实想本地留底；原因——档位是用户的权利，预设处理侵犯自主判断；对策——步骤 4 先用中性句式问「这次经验怎么处理？1. 发表 issue 2. 本地入库 3. 不入库」，等用户选定再执行（来源：2026-08 实战会话）
```

3. SKILL.md「常见坑与陷阱」末尾追加链接行：`- 更多经验见本技能 [[experience]]（经验全集）`
4. Run: `npm test` → Expected: `OK: 89 skills validated`（[[experience]] 链接解析成功）
5. Commit:

```bash
git add .claude/skills/re-feedback/references/experience.md .claude/skills/re-feedback/SKILL.md
git commit -m "经验: re-feedback 首条入库（三档选择先问用户再动手）"
```

- [ ] **Step 4: 走查 ③ 档（不入库）**

用另一条样本（如「临时心得」），确认网关在用户选 ③ 后不再写任何文件、只口头确认结束，无残留产物（`git status` 无新增文件）。

- [ ] **Step 5: 全量校验收尾**

Run: `npm test`
Expected: `OK: 89 skills validated`，无 FAIL；`git log --oneline -6` 可见本计划的全部提交（Task 1-6）
