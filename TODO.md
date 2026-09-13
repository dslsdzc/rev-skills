# rev-skills ToDo

待办事项列表。完成一项勾选一项（`- [x]`），保留历史记录。

---

- [ ] **事实性缺陷修复（批 1，16 项）**（2026-09-13 记录，来源：外部 AI 审查 + 本库逐条核验）

  记录与核验结论：`docs/audit/2026-09-13-factual-audit.md`（高 11 / 中 5，误报 0；含每项修正方向、核验依据与来源清单）。

  修复优先级（按「会被 Agent 直接执行错」排序）：re-android-crypto（2）→ re-mobile-forensics（3）→ re-automotive（1）→ re-riscv（1）→ re-dotnet（2）→ re-ai-model（2）→ re-macos（2）→ re-forensics 路由（1）→ 熵表述收敛（2 处）

  - [x] 高严重度 11 项：已修复（2026-09-13）
  - [x] 中严重度 5 项：已随所属技能一并修（2026-09-13）
  - [x] 批 2（监控新增 4 项 + 自查 1 项：Frida 17 迁移 9 文件 / `retval.replace` / scapy `startAddr` / angr 版本线 / `Memory.readCString`）：已修复（2026-09-13）
  - [x] 批 3（监控第二轮 16 项：15 确认已修——candump/tsk_recover/mmls gap/Rich Header/TLS 位宽/RELRO/扩展编号/__LINKEDIT/VMCS/KVM nested 等；1 误报未改）：已修复（2026-09-13）
  - [x] 工程性问题：历史文档污染——`docs/superpowers/README.md` 存档声明 + 2 处旧错误就地标注 + CLAUDE.md 加注（2026-09-13）
  - [x] 工具链一致性问题（#38，用户报告）：frontmatter 规范与解析器不一致——validate 不支持块标量致 104/121 个 description 校验空转；已抽 `lib/frontmatter.mjs` 单一实现（validate/convert 共用）+ 6 条回归测试（2026-09-13）
  - [x] 触发词双语校验（#39，用户要求）：description 须同时含 CJK 与拉丁字母，validate 强制 + 规格三处同步（存量 121 技能全量核查无违例）（2026-09-13）
  - [x] 能力层部分闭环（#40，用户报告）：悬空标签清零（标签 52/52 有声明，补 14 个技能）+ 能力索引生成与过期检查（`bin/capindex.mjs`）+ 悬空检查（2026-09-13）
  - [x] 能力层剩余缺口闭环（#42，用户要求）：① 技能覆盖 119/121（原子 108/108 全声明；路由暴露的标签缺口补 12 个，52→64）② triage/rerouting 改为按能力匹配（两表加「需要能力」列 + 索引反查 + 4 条 CI 防漂移检查）（2026-09-13）
  - [x] 网关选择树能力标注（#43，用户要求）：11 个网关选择树 + 完整工作流段共 336 处链接标注（能力：`tag`），选择树 100% 覆盖；约定加显式「能力：」前缀消歧；CI 校验标注与声明一致（2026-09-13）
  - [x] seL4 分析分支（#46，用户提供）：re-kernel 第五平台分支 `sel4-kernel.md`（capability 系统：CPtr 本地地址/capDL·CAmkES/badge 与 rights/错误码即诊断/device untyped/用户态 IRQ 与 DMA 旁路/fault IPC/MCS/capDL snapshot）（2026-09-13）
  - [x] 内核覆盖跨平台化（#45，用户要求）：re-kernel 重构为「失败模式决策表 + 四平台分支」（Windows/Linux LKM/macOS KEXT 与 DEXT/Android GKI）；采集侧同步内核段（2026-09-13）
  - [x] references 同名歧义治理（#47，用户决策「限定技能前缀」）：471 处跨技能裸引用加 `[[re-xxx/文件名]]` 前缀；validate 扩到 references 文件内校验；占位符改用尖括号形式（2026-09-13）
  - [x] 新增 re-sample-acquire（#44，用户要求）：补现场采集环节（只有现象、没有样本）——SKILL.md + 四平台分支（Windows VAD/线程、Linux VMA/BPF LSM、macOS Mach VM/Endpoint Security、seL4 capability provenance）；能力标签 `sample-acquisition`；计数 121→122（2026-09-13）
  - [x] 数据契约去文件域化（#41，用户报告）：analysis-contract 改为「核心字段 + 10 个域扩展字段」两层（SDR/CAN/AI 模型/TEE/取证等域各有字段组），上下文清单按域展开，消费侧 2 处同步（2026-09-13）
  - [ ] 复核后回填状态（fixed → verified），本批结果作为「增量审查机制」首批记录
  - [ ] 待定：是否给全部 27 个历史文档统一加头部横幅（当前只标注了含已知错误的 2 个）

- [ ] **工具 CLI/API 生命周期审查**（2026-09-13 记录，来源：外部抽样审查的结论）

  观察：**领域知识本身已比工具操作层稳定**——新的主要缺陷来源变成「命令/API 生命周期」与「示例代码没真正 smoke-test」。样例：Volatility 3 的插件路径重组（`windows.hashdump` → `windows.registry.hashdump`，旧别名标记 2026-09-25 移除）；同一工具族的**符号获取机制**在 Windows 与 Linux/macOS 完全不同，写成一套即错。

  > 关键区别：**"源码目录变了"不等于"命令行调用名变了"**——malfind 的源码在 `windows/malware/` 下，但调用名仍是 `windows.malfind`。按目录结构改命令会引入新错误。

  - [x] **第三方命令/API 清单**（2026-09-13）：`docs/audit/tool-register.json`（140 项，含工具名 / kind / 引用它的技能 / 上次核验日期 / 核验来源 / ignore 名单）+ `lib/tool-register.mjs`（抽取与比对）+ `bin/toollife.mjs`（check / candidates / stale / smoke）
  - [x] **版本漂移检查**（2026-09-13）：`check` 报"已核验 / 超期 / 待核验积压"三档 + **死条目即失败**（登记为在用但技能里已找不到）；`stale` 按超期排序供下一轮审查波取用；`smoke` 做本机存在性探测（仅报告，不进 CI——CI 机器不必装这些工具）
  - [x] **候选发现**（2026-09-13）：技能里出现但未登记且不在 ignore 名单的命令会被列为候选，仓库自身的那条已作为测试常驻（`tests/toollife.test.mjs`）——**新增第三方工具而不登记会直接让 `npm test` 失败**
  - [ ] **示例可执行性**（未做）：把技能里的 Python/shell 示例抽成最小可跑片段（有 fixture 的优先），至少验证"语法与 API 名仍然存在"——需要 fixture 与网络/工具依赖的取舍，单独评估
  - [ ] 逐项填充 `last_verified`：当前 140 项里只有 1 项已核验（vol），其余是**明确的待核验积压**——按 `stale` 的输出分批核验并回填
  - [ ] 与「增量审查机制」合并设计：两者共用"变更检测 + 记录状态"的骨架（登记表的 `last_verified` + 状态即该骨架的首个落地）

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
