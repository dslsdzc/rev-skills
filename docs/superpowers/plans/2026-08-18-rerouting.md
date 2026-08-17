# 中途再路由机制 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立「中途再路由」机制——分析中证据特征出现即触发对应技能、网关完成必查、未命中按约束换路，解决「走完入口不再调用技能」的痛点。

**Architecture:** 新建 `re-analyze/references/rerouting.md`（证据→技能触发表，A/B 双表）+ re-analyze 第三步改双轨强制 + 两个引用点（analysis-contract / triage）统一指向。无新技能，91 技能不变。

**Tech Stack:** Markdown / validate.mjs（npm test，现有）

## Global Constraints

- **红线 1 呈现中性**：禁用「最推荐」「强烈建议」等最高级强推措辞
- **红线 2 隐私脱敏**：内容不指向具体项目/公司/产品
- validate.mjs：references/*.md 文件名（去扩展名）为合法 [[链接]] 目标；SKILL.md 正文 [[链接]] 必须可解析
- rerouting.md 的 [[链接]] 全部指向已存在技能（re-cpp-abi 未建——该行用文字标注「（re-cpp-abi 待建，先走 [[re-binary-core]]）」，**不写 [[re-cpp-abi]] 死链**）
- 工作区有 4 个未提交修改（re-binary-core / re-mobile / re-protocol 的 SKILL.md、README.md）——**各任务 commit 只 `git add` 本任务列出的文件，严禁 `git add -A`**；本计划不涉及这 4 个文件
- 当前分支 `main`；`npm test` 预期 `OK: 91 skills validated`

---

### Task 1: 创建 rerouting.md 触发表

**Files:**
- Create: `.claude/skills/re-analyze/references/rerouting.md`

**Interfaces:**
- Consumes: 无（新 references 文件）
- Produces: references 目标 `rerouting`（validate 的 knownRefs 收录，供 Task 2/3 的 [[rerouting]] 链接解析）

- [ ] **Step 1: 创建 rerouting.md**

写入 `.claude/skills/re-analyze/references/rerouting.md`：

````markdown
# 中途再路由触发表

运行时证据触发的唯一事实源（区别于 triage.md 的入口「目标→路径」决策表）。分析过程中按双轨使用：

- **轨 1（网关完成必查）**：每网关完成后对照 A/B 表检查新证据
- **轨 2（证据出现即查）**：每产出新证据类型（字符串/节表/行为/加密特征）立即对照 A 表
- **未命中** → 按 B 表约束行动，禁止自行硬琢磨

## A 表：证据特征 → 触发技能

| 证据特征（分析中看到） | 触发技能 |
|---|---|
| 节表异常（UPX0/.aspack）、熵 >7.0 | [[re-packer-id]] → [[re-anti-analysis]] |
| 未知加密算法、S-box/常量指纹、加密流量 | [[re-crypto-id]] |
| 硬编码密钥/口令、内存中的 key | [[re-crypto-keys]] |
| 解密函数已定位、密文可还原 | [[re-crypto-decrypt]] |
| 反调试/反 VM 特征（ptrace、CPUID、时间检测） | [[re-evasion]] / [[re-anti-analysis]] |
| 动态注册 JNI、so 函数级加密 | [[re-android-native]] |
| 混淆（CFF/花指令/字符串加密） | [[re-deobfuscate]] |
| 网络回连/信标/C2 特征 | [[re-netcap]] → [[re-behavior]] |
| 持久化/注入/进程树异常 | [[re-behavior]] |
| 崩溃/段错误/ASAN 报告 | [[re-crash-triage]] |
| Python 打包特征（PyInstaller/PyArmor） | [[re-python]] |
| Flutter/RN 引擎特征 | [[re-hybrid-app]] |
| 加固商特征（加固壳） | [[re-mobile-pack]] |
| RTTI/异常表（.pdata/.xdata）密集 | （re-cpp-abi 待建，先走 [[re-binary-core]]） |

## B 表：卡住信号 → 换路

| 卡住信号 | 换路 |
|---|---|
| 同参数重复 ≥2 次无新证据 | 对照 A 表重查 / 换工具视角（[[analysis-contract]] 调查预算） |
| 单命令 ≥3 次无进展 | 停下评估，重跑 re-analyze 第二步（任务识别）或换网关 |
| 分析超 30 次工具调用无结论 | 回退到最近有产出的环节，按 [[analysis-contract]] 复核格式交付部分结论 |
| 目标行为与静态结论矛盾 | 动态侧 [[re-sandbox]] / [[re-tracing]] 对照 |

## 使用规则

1. 每产出新证据类型 → 查 A 表，命中即调用对应技能，完成后回到轨 1 继续
2. 每网关完成 → 查 A+B 表
3. 未命中任何表项 → 按 B 表约束行动（换思路/回退/交付部分结论）
````

- [ ] **Step 2: 结构校验**

Run: `npm test`
Expected: `OK: 91 skills validated`（references 文件不校验正文链接，但保持全部链接有效；[[re-netcap]]→[[re-behavior]] 等箭头链接为文字序列，非 [[死链]]）

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/re-analyze/references/rerouting.md
git commit -m "feat: rerouting 中途再路由触发表（A 证据→技能 / B 卡住→换路）"
```

---

### Task 2: re-analyze 第三步改双轨强制 + 常见坑

**Files:**
- Modify: `.claude/skills/re-analyze/SKILL.md`（第三步编排分派段落改双轨；常见坑追加一条）

**Interfaces:**
- Consumes: Task 1 的 `rerouting`（[[rerouting]] 链接可解析）
- Produces: 入口级双轨强制机制（第三步 + 常见坑）

- [ ] **Step 1: 第三步段落改双轨**

`.claude/skills/re-analyze/SKILL.md` 现状（第三步段落）：

```
调用对应大类网关技能（`[[re-binary-core]]` `[[re-malware]]` `[[re-firmware]]` `[[re-protocol]]` `[[re-mobile]]` `[[re-anti-analysis]]` `[[re-cracking]]` `[[re-vuln]]` `[[re-ctf]]` `[[re-managed]]` `[[re-forensics]]`），网关内部自行选择原子技能。每个环节完成后检查新证据，必要时回退调整路径（见 triage.md 复合任务示例）。
```

改为（在原文后追加双轨段，原文保留）：

```
调用对应大类网关技能（`[[re-binary-core]]` `[[re-malware]]` `[[re-firmware]]` `[[re-protocol]]` `[[re-mobile]]` `[[re-anti-analysis]]` `[[re-cracking]]` `[[re-vuln]]` `[[re-ctf]]` `[[re-managed]]` `[[re-forensics]]`），网关内部自行选择原子技能。每个环节完成后检查新证据，必要时回退调整路径（见 triage.md 复合任务示例）。

**双轨再路由（强制，见 [[rerouting]]）**：
- 轨 1（网关完成必查）：每网关完成后，对照 [[rerouting]] 的 A/B 表检查新证据；命中 → 调用对应技能，完成后回到轨 1 继续
- 轨 2（证据出现即查）：分析中每产出新证据类型（字符串/节表/行为/加密特征），立即对照 A 表；命中 → 调用技能
- 未命中任何表项 → 按 B 表约束行动（换思路/回退/交付部分结论），禁止自行硬琢磨
```

- [ ] **Step 2: 常见坑追加一条**

`.claude/skills/re-analyze/SKILL.md` 常见坑末尾（「自挖前先搜社区逆向成果」条之后）追加：

```
- **走完入口不再调用技能**：现象——入口编排后自己硬琢磨，中途发现新特征（壳/加密/反调试）不调对应技能；原因——再路由未执行；对策——按第三步双轨：每网关完成/每新证据对照 [[rerouting]] 触发表，命中即调
```

- [ ] **Step 3: 结构校验**

Run: `npm test`
Expected: `OK: 91 skills validated`（[[rerouting]] 解析成功，无 FAIL）

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/re-analyze/SKILL.md
git commit -m "增强: re-analyze 第三步双轨再路由强制（网关完成必查 + 证据出现即查）"
```

---

### Task 3: 两个引用点统一指向 rerouting

**Files:**
- Modify: `.claude/skills/re-analyze/references/analysis-contract.md`（加引用行）
- Modify: `.claude/skills/re-analyze/references/triage.md`（第 31 行改指向）

**Interfaces:**
- Consumes: Task 1 的 `rerouting`（链接可解析）
- Produces: 触发表唯一事实源的全库指向

- [ ] **Step 1: analysis-contract.md 加引用行**

`.claude/skills/re-analyze/references/analysis-contract.md` 的「分析全流程遵守本契约」段（首段）末尾追加一行：

```markdown
中途再路由：证据触发按 [[rerouting]] 双轨执行（轨 1 网关完成必查 / 轨 2 证据出现即查），命中即调对应技能。
```

- [ ] **Step 2: triage.md 第 31 行改指向**

`.claude/skills/re-analyze/references/triage.md` 现状第 31 行：

```
- 每个环节完成后检查是否有新证据改变后续路径（如动态分析发现加壳 → 回退 re-anti-analysis）。
```

改为：

```
- 每个环节完成后检查是否有新证据改变后续路径（如动态分析发现加壳 → 回退 re-anti-analysis）。中途再路由统一按 [[rerouting]] 双轨执行（证据触发 / 网关完成必查）。
```

- [ ] **Step 3: 结构校验**

Run: `npm test`
Expected: `OK: 91 skills validated`，无 FAIL

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/re-analyze/references/analysis-contract.md .claude/skills/re-analyze/references/triage.md
git commit -m "增强: analysis-contract/triage 统一指向 rerouting 触发表"
```
