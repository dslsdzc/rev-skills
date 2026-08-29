# rev-skills ToDo

待办事项列表。完成一项勾选一项（`- [x]`），保留历史记录。

---

- [ ] **增量审查机制**（2026-08-29 记录，来源：aiskillstore skill-report.json 机制调研）

  现状痛点：审查波是全量式——每波把整批技能从头审一遍，已确认部分（如 re-go 断言、re-address-space 归因）被反复重审，浪费 token 和时间。

  目标：审查成本从 O(技能总数) 降到 O(变更数)。

  方案要点（参考 skillstore 的 skill-report.json 设计）：
  - [ ] 每技能一份审计记录（简化版：内容 hash + 结论 + finding 状态），随技能进仓库
  - [ ] 审查波改增量：`git diff` 定位变更技能 + hash 比对跳过未变技能
  - [ ] finding 状态机 open → fixed → verified，后续波次只处理 open 项
  - [ ] validate.mjs 扩展：变更检测 + 报告生成 + 增量审计入口
  - [ ] （可选）审计履历沉淀后可作发布质量背书
