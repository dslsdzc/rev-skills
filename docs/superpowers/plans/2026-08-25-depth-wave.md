# 深度波（现有技能加深度）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给现有全部技能加深度——T1 薄技能正文扩写至 ~130 行基线 + 全部技能按类型配 references/ 深度文件（每技能 2 个），技能计数不变（112，v4 落地后 118）。

**Architecture:** 纯技能文档扩展。映射表任务先产出 112 技能 × 类型 × 分层清单 → 样板任务（re-x64dbg/re-format-elf）用户定调 → T1/T2/T3 分层滚动（簇任务，每簇 3-5 技能）→ re-rtos/re-behavior 深度（v4 落地后）→ 终审波。深度文件主题命名（commands/gotchas/layout/examples/decision-tree），`[[链接]]` 目标 = 文件名去扩展名。

**Tech Stack:** Markdown / YAML frontmatter / validate.mjs（npm test，现有）。

**设计依据：** docs/superpowers/specs/2026-08-25-depth-wave-design.md（已提交 1c71097）——分层定义（§2）、类型-文件集映射（§3）、质量闸口（§5）以设计文档为准。

**并行协调：** wave-v4 计划（docs/superpowers/plans/2026-08-25-skill-wave-v4.md）同时执行。文件集隔离：本计划只碰现有技能（v4 的 6 新技能目录 + re-rtos/re-behavior/triage/rerouting/计数文件**不碰**）；re-rtos/re-behavior 的深度产出放队列末尾（v4 落地后套用）。两计划不得交叉修改对方文件。

## Global Constraints

- **红线 1 呈现中性**：禁用「最推荐」「强烈建议」等最高级强推措辞（最多「推荐」）
- **红线 2 隐私脱敏**：内容不指向具体项目/公司/产品；硬件类给泛化选购指引
- **不绑定具体工具**：方法为核心，工具为可替换示例；「工具准备」按模板给跨 OS 安装命令
- validate.mjs：references/*.md 文件名（去扩展名）为合法 `[[链接]]` 目标；SKILL.md 的 `[[链接]]` 必须解析（深度文件内引用其他技能必须指向存在目标）；正文扩写不破坏 frontmatter（`name`=目录名、`description` 非空、`type: atomic` 必含「## 工具准备」）与固定五节结构
- 事实核验：命令必须可执行、字段/格式断言以官方文档为准；抽查机制进终审波
- **commit 纪律**：每任务 commit 只 `git add` 本任务列出的文件，严禁 `git add -A`
- 当前分支 `main`；每任务 `npm test` 输出 `OK: 112 skills validated`（v4 落地后为 118）——深度波不改计数
- 输出不用 emoji

---

### Task 1: 映射表任务（112 技能 × 类型 × 分层）

**Files:**
- Create: `docs/superpowers/specs/2026-08-25-depth-wave-mapping.md`（映射表设计附录）

**Interfaces:**
- Consumes: 设计文档 §2（分层判定）§3（类型规则与代表技能）
- Produces: 映射表（后续每个簇任务据此确定成员与文件集）

- [ ] **Step 1: 生成映射表**

逐技能判定：分层（T1 <100 行 / T2 100-130 / T3 >130 / 网关）按 2026-08-25 实测行数；类型（工具/格式/方法论/领域混合→取主类型）按设计 §3 规则。每行：`技能 | 行数 | 分层 | 类型 | 文件集`。产出 `docs/superpowers/specs/2026-08-25-depth-wave-mapping.md`。
核查：112 行全量覆盖、T1+T2+T3+网关 = 112 闭环。

- [ ] **Step 2: 验证** — `node validate.mjs` → `OK: 112 skills validated`（映射表是 docs/ 文件，不影响计数）
- [ ] **Step 3: Commit** — `docs: 深度波映射表——112 技能 × 类型 × 分层`

### Task 2: 样板任务（re-x64dbg 工具类 + re-format-elf 格式类）

**Files:**
- Modify: `.claude/skills/re-x64dbg/SKILL.md`（正文扩写至 ~130 行）
- Create: `.claude/skills/re-x64dbg/references/commands.md`
- Create: `.claude/skills/re-x64dbg/references/gotchas.md`
- Modify: `.claude/skills/re-format-elf/SKILL.md`（正文适度补强）
- Create: `.claude/skills/re-format-elf/references/layout.md`
- Create: `.claude/skills/re-format-elf/references/examples.md`

**Interfaces:**
- Consumes: 设计文档 §4（样板审阅要点）
- Produces: 两个完整样板（正文 + 深度文件），供用户定调与后续批量任务同构参照

- [ ] **Step 1: re-x64dbg 深度产出**

正文扩写至 ~130 行基线（补：常用断点/跟踪命令组合、Scylla 插件流程、附加与启动两种模式差异）；`references/commands.md`（命令速查/常用操作序列/组合套路，含断点命令族、内存读写、补丁导出）；`references/gotchas.md`（工具特有坑 ≥3：x64dbg 与 olly 兼容差异、Scylla 使用注意、反调试检测绕过边界、版本差异）。

- [ ] **Step 2: re-format-elf 深度产出**

正文补强（补：section 头/程序头典型布局示例、动态链接结构解析要点）；`references/layout.md`（ELF ehdr/phdr/shdr 字段表与偏移、常见 section 布局图）；`references/examples.md`（最小解析示例：readelf 输出对照 + Python struct 解析 ehdr 示例 + 字节样例）。

- [ ] **Step 3: 验证** — `node validate.mjs` → `OK: 112 skills validated`（新增 references 文件为合法 [[链接]] 目标）；`npm test` 全绿
- [ ] **Step 4: Commit** — `enhance: 深度样板——re-x64dbg（commands/gotchas）+ re-format-elf（layout/examples）`
- [ ] **Step 5: 用户审阅定调（评审闸口）**

向用户提交样板审阅：正文扩写密度与风格、深度文件骨架与命名、命令/示例颗粒度。用户确认或提出修改；定调后批量任务按样板同构执行。**未获确认前不得进入 Task 3。**

### Task 3-7: T1 批次（<100 行原子技能，约 18 个 → 4-5 簇任务）

**Files（每簇）:**
- Modify: 簇内每个技能 `.claude/skills/<技能>/SKILL.md`（正文扩写至 ~130 行基线）
- Create: 簇内每个技能 2 个深度文件（按映射表类型：`references/commands.md`+`gotchas.md` / `layout.md`+`examples.md` / `decision-tree.md`+`gotchas.md`）

**Interfaces:**
- Consumes: Task 1 映射表（簇成员）、Task 2 样板（同构参照）
- Produces: T1 全部技能达标（正文基线 + 深度文件）

- [ ] **Step 1: 簇内技能逐一深度产出**

每个技能：正文扩写至 ~130 行基线——保持五节结构，补缺章节（工具类补命令组合与验证、格式类补布局与示例、方法论类补决策树与反例），正文内新增 `[[链接]]` 必须指向存在目标；按映射表类型创建 2 个 references/ 深度文件（骨架按样板同构）。

- [ ] **Step 2: 验证** — `node validate.mjs` → `OK: 112 skills validated`；`npm test` 全绿
- [ ] **Step 3: Commit** — `enhance: 深度 T1 簇<编号>——<技能名列表>（正文基线 + 深度文件）`

（簇划分由 Task 1 映射表确定；预估 4-5 簇，每簇 3-5 技能，主题相邻优先：如工具类簇、格式类簇、方法论类簇、领域混合簇。）

### Task 8-19: T2 批次（100-130 行，48 个 → 10-12 簇任务）

**Files（每簇）:**
- Modify: 簇内技能 `.claude/skills/<技能>/SKILL.md`（正文适度补强：补缺章/示例/坑，无硬基线）
- Create: 关键者（判定规则见设计 §2）2 个深度文件；非关键者本批次不建

**Interfaces:**
- Consumes: Task 1 映射表、Task 2 样板
- Produces: T2 全部技能正文补强、关键者配深度文件

- [ ] **Step 1: 簇内技能逐一补强**

正文补强：对照五节模板找出缺口（工具类缺验证命令/版本差异、格式类缺布局说明、方法论类缺边界/反例），补至内容自洽；关键者（跨域引用 ≥2 或网关/triage 直接引用）创建深度文件，骨架按样板同构。

- [ ] **Step 2: 验证** — `node validate.mjs` → `OK: 112 skills validated`；`npm test` 全绿
- [ ] **Step 3: Commit** — `enhance: 深度 T2 簇<编号>——<技能名列表>（正文补强 + 关键者深度文件）`

### Task 20-26: T3 批次（>130 行，约 33 个 → 6-7 簇任务）

**Files（每簇）:**
- Create: 簇内每个技能 2 个深度文件（按映射表类型）

**Interfaces:**
- Consumes: Task 1 映射表、Task 2 样板
- Produces: T3 技能深度文件（正文不动）

- [ ] **Step 1: 簇内技能逐一创建深度文件**

正文不动；按映射表类型创建 2 个 references/ 深度文件（内容从现有正文提炼 + 扩展：命令组合/布局图/决策树 + 新坑），骨架按样板同构；深度文件内 `[[链接]]` 指向存在目标。

- [ ] **Step 2: 验证** — `node validate.mjs` → `OK: 112 skills validated`；`npm test` 全绿
- [ ] **Step 3: Commit** — `enhance: 深度 T3 簇<编号>——<技能名列表>（深度文件）`

### Task 27: re-rtos / re-behavior 深度产出（v4 落地后）

**Files:**
- Modify: `.claude/skills/re-rtos/SKILL.md`（按 v4 扩章后的最终形态补强，如需要）
- Create: `.claude/skills/re-rtos/references/decision-tree.md` + `gotchas.md`（方法论类文件集）
- Create: `.claude/skills/re-behavior/references/decision-tree.md` + `gotchas.md`

**Interfaces:**
- Consumes: v4 计划 Task 7/8 完成（两技能扩章落地）、Task 1 映射表、Task 2 样板
- Produces: 两技能深度文件（与 v4 扩章内容衔接）

- [ ] **Step 1: 确认 v4 扩章已落地**

`git log` 确认 re-rtos/re-behavior 的 v4 扩章 commit 存在；若未落地，本任务挂起（不得与 v4 并发修改同一文件）。

- [ ] **Step 2: 创建深度文件**

按方法论类文件集创建 4 个文件；内容覆盖 v4 新增章节（re-rtos 的 VxWorks/QNX/INTEGRITY 决策要点、re-behavior 的行为监控工具链使用决策）。

- [ ] **Step 3: 验证** — `node validate.mjs` → `OK: 118 skills validated`（v4 已落地）；`npm test` 全绿
- [ ] **Step 4: Commit** — `enhance: 深度 re-rtos/re-behavior——v4 扩章配套深度文件`

### Task 28: 终审修复波

**Files:** 视修复结果（全库）

**Interfaces:**
- Consumes: Task 2-27 完成
- Produces: 全库深度达标、无死链、事实与红线复核通过

- [ ] **Step 1: 全库审查**

- `node validate.mjs` / `npm test` 全绿
- grep 检查：新增 references/ 文件名均为合法链接目标（validate 已保证）；SKILL.md 结构未被破坏（抽查五节顺序）
- 事实抽查：每簇至少 1 条关键断言核对（命令可执行性 / 格式字段官方依据），必要时 web 核实
- 红线对照：无强推措辞、无具体项目/产品指向
- 深度文件与正文重复度抽查（避免 references 与 SKILL.md 大段重复）

- [ ] **Step 2: 修复与提交**

修复发现项（每文件独立 commit：`fix: 深度终审——<内容>`）；全部完成后最终 `node validate.mjs` → `OK: 112 skills validated`（v4 落地后 118）+ `npm test` 全绿。

---

**最终验证**：`node validate.mjs` 输出 `OK: 112 skills validated`（v4 落地后 `OK: 118 skills validated`）；`npm test` 22 单测全绿；`git log` 含本计划全部任务 commit。
