# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 仓库性质

通用逆向工程 AI 技能库（121 个技能），发布形态有三个：npm 包（`bin/install.mjs` 安装器）、Claude Code 插件市场（`.claude-plugin/marketplace.json`）、以及可被任意 Agent Skills 兼容运行时读取的 `.claude/skills/` 目录。

内容主体是 Markdown 技能文档，工具代码是零依赖 Node.js（>=18，ESM）。**没有构建步骤**——技能即目录，改完跑校验即可。

双许可：技能文档内容 CC BY 4.0，工具代码（`bin/`、`validate.mjs`、`tests/`）Apache-2.0。新增文件注意落在正确一侧。

## 常用命令

```bash
npm test                                        # 全量：结构校验 + 单元测试
node validate.mjs                               # 只跑结构校验，输出 OK: 121 skills validated
node --test tests/validate.test.mjs             # 单跑一个测试文件
node --test --test-name-pattern="good-skill" tests/*.test.mjs   # 按用例名过滤

node bin/capindex.mjs                           # 重新生成能力索引（改 capabilities 声明后必跑）
node bin/capindex.mjs --check                   # 只校验索引是否过期（npm test 已含）

npx rev-skills install --target <claude|gemini|cline|codex|cursor|copilot|windsurf|all> \
  [--global|--project] [--dry-run] [--link] [--force]
node bin/convert.mjs --target <cursor|copilot|windsurf> --out <dir>   # 技能 → 规则文件转换（调试用）

node bin/wxsource.mjs kanxue list [--board re] [--pages 2] [--md]     # 看雪论坛列表（经验采集源）
node bin/wxsource.mjs kanxue thread <帖子ID> [--md]
node bin/wxsource.mjs wechat <文章URL> [--md]
```

`node validate.mjs` 输出的技能数必须等于 `.claude/skills/` 下 `re-` 目录数——计数变了说明有技能目录增删，需同步文档（见下）。

## 架构：三层技能图，按状态机运转

```
re-analyze（entry，唯一入口）
  └─ 12 个大类网关（type: gateway）：re-binary-core / re-malware / re-firmware / re-protocol /
     re-mobile / re-anti-analysis / re-cracking / re-vuln / re-ctf / re-managed / re-forensics / re-feedback
        └─ 原子技能（type: atomic，108 个）
```

**这不是调用链，是状态转移**：`triage → route → skill 执行 → 产出证据 → 再路由（循环）`。每个技能执行后产出新证据，证据决定下一跳。技能之间靠 `[[技能名]]` 链接互引，靠会话变量（`RE_OS`/`RE_TOOLS`/`RE_GOAL`/`RE_DECOMPILER`/`RE_DEPTH`/`RE_REPORT`/`RE_AUTH`/`RE_VISITED`）传状态。

**控制文件是单一事实源**，改路由逻辑只需改这些文件，不要散落到各技能：

| 文件 | 职责 |
|---|---|
| `.claude/skills/re-analyze/SKILL.md` | 入口四步：环境探测 → 偏好分级询问 → 任务识别 → 路由 |
| `re-analyze/references/triage.md` | 入口决策表：目标 + 输入文件 → 编排路径；第 0 步定 `RE_AUTH` |
| `re-analyze/references/rerouting.md` | 中途再路由：A 表「证据特征 → 触发技能」，B 表「卡住信号 → 换路」 |
| `re-analyze/references/preferences.md` | 偏好询问分级（Level 0 用默认值直接开始 / Level 1 完整问 5 项） |
| `re-analyze/references/analysis-contract.md` | 分析契约：上下文清单（按域展开）、数据契约（核心字段 + 域扩展字段两层）、独立复核、调查预算 |
| `re-analyze/references/platform-tips.md` | 平台经验库（最高原则：默认沙箱；内存读取默认转储优先） |
| `re-analyze/references/capabilities.md` | 能力注册表（`capabilities` frontmatter 的合法标签全集） |
| `re-analyze/references/probe.sh` | 环境探测脚本（OS/ARCH/CORES/MEM/工具清单） |

**能力层**：技能用 `capabilities: [tag1, tag2]` 声明「提供哪些可执行分析动作」，标签必须在 `capabilities.md` 注册表内。**原子技能必须声明**（入口/元网关可省略）。声明的消费端是 `re-analyze/references/capability-index.md`（机器生成的「能力 → 技能」反查表：`node bin/capindex.mjs` 生成、`npm test` 校验过期、`--check` 单查）。**路由已按能力匹配**：`triage.md` 与 `rerouting.md` 的表格带「需要能力」列，技能列是索引反查结果——新增/修改路由行时必须先定能力标签再反查技能，不能只写领域名。CI 四条防漂移：标签不得悬空｜原子技能必须声明｜路由能力列须在注册表内｜路由标称能力须被本行技能声明｜索引须与声明同步。**网关选择树**里的技能链接用 `[[re-xxx]]（能力：`tag`）` 标注（选择树段内强制，`npm test` 校验标注与声明一致；无「能力：」前缀的括号视为普通说明，不参与校验）。

**guard 字段**：敏感技能必须带机器可读安全前置声明，JSON 格式 `{"require_authorization": true, "forbidden": ["行为标签"]}`。入参与 `RE_AUTH`（owned / ctf / research / unknown）联动——`require_authorization: true` 时仅 owned/ctf/research 可执行，unknown 只做静态分析并先询问归属。

**技能目录布局**：每技能一个目录，必含 `SKILL.md`，可选 `references/*.md`（深度知识、坑、探针）。`references/*.md` 的文件名（去扩展名）本身是合法的 `[[链接]]` 目标。

## validate.mjs 校验规则（改技能前必读）

frontmatter 解析的唯一实现在 `lib/frontmatter.mjs`（`validate.mjs` 与 `bin/convert.mjs` 共用；支持简单 scalar / 块标量 `>` `|` / 内联 flow list 与 JSON，其余 YAML 特性不支持）。**新增 frontmatter 写法前先扩展该模块并补测试**——历史上校验与转换各写一套解析，104 个技能的 `description` 因此在校验侧被解析成字面量 `>`，非空校验空转。

`validate.mjs` 是结构闸口，以下任一不满足即 `npm test` 失败：

- frontmatter 必须有 `name`（**必须等于目录名**）与非空 `description`；`name` 以 `re-` 前缀
- `description` 必须**同时含 CJK 与拉丁字母**（中英触发词约定——英文环境也要能命中该技能）
- `type` 只认 `atomic` / `entry` / `gateway`（缺省视为 atomic）
- **原子技能且是叶子目录**（无子技能目录）必须含 `## 工具准备` 章节；入口/网关豁免
- 正文所有 `[[xxx]]` 必须解析到已存在的技能名或某个 `references/*.md` 的文件名——**先建文件再加链接**，否则断链
- `capabilities` 必须是非空 YAML 内联 list，且每个标签在 `capabilities.md` 注册表内（新标签要先注册）
- `guard` 必须严格是 `{"require_authorization": <bool>, "forbidden": [<非空字符串>]}`，否则报错

技能正文结构规范见 `docs/skill-template.md`（原子技能固定章节顺序：任务分类器 → 何时使用/何时不用 → 工具准备 → 操作步骤 → 跨域联合 → 常见坑与陷阱；网关另有一套）。

## 新增/修改技能的标准流程

1. 按 `docs/skill-template.md` 建 `.claude/skills/re-xxx/SKILL.md`（知识/操作分离：机制原理留正文，易变参数如槽位索引/offset 放 `references/probes.md` 探针层）
2. **挂载**（缺一即孤儿技能）：网关 SKILL.md 的子技能清单 + `triage.md` 路由表；若是「看到某证据就该触发」的技能，还要挂 `rerouting.md` A 表
3. 声明 `capabilities`（新标签先加进 `capabilities.md` 注册表）；敏感技能加 `guard`
4. **同步计数与导航**（5 处）：`README.md`、`README_EN.md`、`AGENTS.md`、`package.json` 的 description、`.claude-plugin/marketplace.json` 的 description，以及 README 的「技能导航」清单
5. `npm test` 必须输出 `OK: N skills validated` 且 N 与实际目录数一致

## 开发工作流：spec → plan → 波次 → 审查波

本仓库按「波次」推进，历史全在 `docs/superpowers/`：

- `specs/YYYY-MM-DD-*-design.md` —— 设计文档（用户批准后落地）
- `plans/YYYY-MM-DD-*.md` —— 实施计划（任务拆解，带 `- [ ]` 复选框与逐步 commit 点，供 subagent 逐任务执行）
- **这两个目录是历史存档**（冻结于各自日期，不随技能修订同步）——可能保留已修正的过时表述，**不要当现行技术指引检索/引用**；当前事实一律以 `.claude/skills/` 为准，已修正错误与核验依据见 `docs/audit/`
- 每任务一张 Files 清单，**commit 只 `git add` 本任务列出的文件，严禁 `git add -A`**
- 多计划并行时约定「文件集隔离」——不交叉修改对方文件
- 变更后收尾是**审查波**：grep/抽查断言事实性（命令是否可执行、字段值是否与官方文档一致），发现的错误以 `fix:` 提交；TODO.md 记录了「增量审查机制」待办（用内容 hash 跳过未变技能，把审查成本从 O(技能总数) 降到 O(变更数)）

commit message 用中文，前缀：`feat:` / `fix:` / `chore:` / `enhance:` / `docs:` / `经验:`。

发布流程：`npm test` 通过 → git tag → npm publish → 同步 `package.json` 与 `marketplace.json` 的版本号（历史上常见漏同步，需成对检查）。

## 仓库红线（内容与输出）

1. **呈现中性**：选项/建议禁用「最推荐」「强烈建议」等最高级强推措辞，最多用「推荐」，由用户自决
2. **隐私脱敏**：内容禁止具体到某个项目/公司/产品，暗示也不行（行业+规模+地域组合、专有协议名、内部代号）；本库公开发布，本地入库同样受约束
3. **不用 emoji**：文档与输出一律纯文本表达
4. **事实核验**：命令必须可执行、字段/格式断言以官方文档为准——本库多处断言曾因想当然出错（如 dex opcode 值、pclntab 头长度），写断言前先验证
5. **授权边界**：全库面向授权范围内的安全研究；破解/绕过类路径受 `RE_AUTH` 与 `re-cracking` 授权边界约束，不得写成无条件可用的操作指引

## 本地分析产物（勿提交）

`.gitignore` 已排除 `/aaa/`、`/analysis/`、`demo_target.*`、`sandbox.sh`——这些是本地逆向产物与沙箱脚本，不得提交到公开仓库。新增本地工作目录时同步加进 `.gitignore`。

## 经验采集

`bin/wxsource.mjs` 抓取看雪论坛/微信技术文章 → 按 `re-feedback` 网关蒸馏（坑格式：`**标题**：现象——…；原因——…；对策——…`）→ 归域 → 追加到目标技能的 `references/experience.md`（SKILL.md 保留精选条目 + 链接）→ `npm test` 校验 → 提交 `经验: 第N轮扫描入库X篇——<篇目>`。入库前必须脱敏自检与 grep 去重。
