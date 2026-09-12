# rev-skills ToDo

待办事项列表。完成一项勾选一项（`- [x]`），保留历史记录。

---

- [ ] **事实性缺陷修复（批 1，16 项）**（2026-09-13 记录，来源：外部 AI 审查 + 本库逐条核验）

  记录与核验结论：`docs/audit/2026-09-13-factual-audit.md`（高 11 / 中 5，误报 0；含每项修正方向、核验依据与来源清单）。

  修复优先级（按「会被 Agent 直接执行错」排序）：re-android-crypto（2）→ re-mobile-forensics（3）→ re-automotive（1）→ re-riscv（1）→ re-dotnet（2）→ re-ai-model（2）→ re-macos（2）→ re-forensics 路由（1）→ 熵表述收敛（2 处）

  - [x] 高严重度 11 项：已修复（2026-09-13）
  - [x] 中严重度 5 项：已随所属技能一并修（2026-09-13）
  - [x] 批 2（监控新增 4 项 + 自查 1 项：Frida 17 迁移 9 文件 / `retval.replace` / scapy `startAddr` / angr 版本线 / `Memory.readCString`）：已修复（2026-09-13）
  - [ ] 复核后回填状态（fixed → verified），本批结果作为「增量审查机制」首批记录

- [ ] **增量审查机制**（2026-08-29 记录，来源：aiskillstore skill-report.json 机制调研）

  > 2026-09-13 更新：批 1 finding 已按本机制的状态机（open → fixed → verified）记录，见 `docs/audit/2026-09-13-factual-audit.md`——可作为首个落地样例参考。

  现状痛点：审查波是全量式——每波把整批技能从头审一遍，已确认部分（如 re-go 断言、re-address-space 归因）被反复重审，浪费 token 和时间。

  目标：审查成本从 O(技能总数) 降到 O(变更数)。

  方案要点（参考 skillstore 的 skill-report.json 设计）：
  - [ ] 每技能一份审计记录（简化版：内容 hash + 结论 + finding 状态），随技能进仓库
  - [ ] 审查波改增量：`git diff` 定位变更技能 + hash 比对跳过未变技能
  - [ ] finding 状态机 open → fixed → verified，后续波次只处理 open 项
  - [ ] validate.mjs 扩展：变更检测 + 报告生成 + 增量审计入口
  - [ ] （可选）审计履历沉淀后可作发布质量背书
