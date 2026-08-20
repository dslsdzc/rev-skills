# zws 收藏库经验吸收实施计划（2026-08-20）

## 总览

- 范围：14 个融合吸收任务（99 候选 → ~40 条入库），技能数 112 不变
- 素材：/home/DslsDZC/rev-refs/extract-zws-*.md（已脱敏，7 文件）
- 设计依据：docs/superpowers/specs/2026-08-20-zws-absorption-design.md
- 流程：读素材+目标技能 → 查重（grep 关键词，同现象跳过/深化合并）→ 改写坑条目（现象/原因/对策）→ 追加进「## 常见坑与陷阱」→ 来源注明（仅 MIT/Apache）→ 脱敏对照 → npm test → commit
- 红线：呈现中性（禁「最推荐/强烈建议」）、隐私脱敏（无具体项目/公司/产品）、不绑定工具、git add 只加任务文件

## 任务表（全部可并行——不同目标文件）

| # | 目标 | 素材文件 | 候选条目 | 目标条数 | 来源注明 |
|---|---|---|---|---|---|
| 1 | re-flutter/SKILL.md | extract-zws-reverse-skills.md | 4,5,6,7,8,10,13,14,17,18 | 6-8 | （来源：reverse-skills（inliver233），MIT） |
| 2 | re-hybrid-app/SKILL.md | extract-zws-hermes.md | 2,3,5,7,11,14,15 | 5-7 | （来源：hermes-decomp（SymbioticSec），MIT） |
| 3 | re-script-deob/SKILL.md | extract-zws-hermes.md | 10,14 | 1-2 | （来源：hermes-decomp（SymbioticSec），MIT） |
| 4 | re-game/SKILL.md | extract-zws-cpp2il.md | 1,2,3,5,6,8 | 4-5 | （来源：Cpp2IL（SamboyCoding），MIT） |
| 5 | re-deobfuscate/SKILL.md | extract-zws-chernobog.md | 1,3,5,8,12,13,14,15 | 4-6（查重最严） | 不注源（无许可蒸馏） |
| 6 | re-python/SKILL.md | extract-zws-pyarmor.md | 1,2,3,5,7,9 | 4-5 | 不注源（无许可蒸馏） |
| 7 | re-patching/SKILL.md | extract-zws-reverse-skills.md | 9,11,12 | 2-3 | （来源：reverse-skills（inliver233），MIT） |
| 8 | re-mobile-pack/SKILL.md | extract-zws-reverse-skills.md | 20,21 | 2 | （来源：reverse-skills（inliver233），MIT） |
| 9 | re-apk/SKILL.md | extract-zws-reverse-skills.md | 19,25 | 2 | （来源：reverse-skills（inliver233），MIT） |
| 10 | re-frida/SKILL.md | extract-zws-reverse-skills.md | 22,23,24 | 2-3 | （来源：reverse-skills（inliver233），MIT） |
| 11 | re-analyze/references/（新增 analysis-tools.md 或入坑） | extract-zws-reva.md | 1,2,3,4,8,10,13 | 3-5 | （来源：ReVa（cyberkaida），Apache-2.0） |
| 12 | re-dotnet/SKILL.md | extract-zws-lazy.md | 1 | 1 | （来源：LazyReverse（a0yami），MIT） |
| 13 | re-ida/SKILL.md | extract-zws-lazy.md | 2 | 1 | （来源：LazyReverse（a0yami），MIT） |
| 14 | re-feedback/SKILL.md | extract-zws-reverse-skills.md | 26,27 | 1-2 | （来源：reverse-skills（inliver233），MIT） |

## 通用执行规则（实现者必读）

1. **读素材条目原文**（/home/DslsDZC/rev-refs/extract-zws-<file>.md 对应条目）→ 按现象/原因/对策改写为坑条目，不逐字复制素材文本
2. **查重**：`grep -n <主题关键词> <目标技能>/SKILL.md`；同现象已存在 → 跳过该条；内容更完整 → 深化合并（改写后覆盖原条）
3. **追加位置**：「## 常见坑与陷阱」列表末尾；有来源注明的素材在追加的坑条目末行加注（多条坑可共用一行注明或每条加，取每条加——与上轮 reverse-skill 吸收一致）
4. **坑格式**：`**标题**：现象——…；原因——…；对策——…`，三要素齐全
5. **脱敏对照**：素材已脱敏；入库时检查无具体项目/公司/产品名、无目标战役细节
6. **Task 11 特殊**：ReVa 方法论偏「编排/工具设计」，与 re-analyze 既有 references（analysis-contract/rerouting）比对——若条目与其思想重合度高且已覆盖，跳过或合并；真正新的（工具粒度/schema 宽容/后台作业轮询/脚本逃逸舱）写为坑条目或简短 references 说明（实现者自定，倾向坑条目）
7. **npm test** 必须全绿（112 不变）；不新增/删除技能
8. 不 git add/commit（控制器统一提交）

## 验收

- 每任务：坑条目数达标、三要素齐全、来源注明正确（有则加无则无）、npm test 绿
- 终审：全波次复核 + 技术事实抽查（VLE 编码/位域头/metadata 版本考古/CFF 证据纪律/PyArmor 窗口/ReVa 轮询）
