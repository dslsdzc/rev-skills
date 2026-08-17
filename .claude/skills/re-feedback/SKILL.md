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
- 更多经验见本技能 [[experience]]（经验全集）
