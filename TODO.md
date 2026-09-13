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
  - [x] 复核后回填状态（fixed → verified）（2026-09-14）：复核方式改为**回归断言**——`tests/audit-regressions.test.mjs` 把 #1–#21 与补充 22/23 的已修事实写成 22 条永久检查（错的说法不得再作为正确写法出现）。一次完成复核与防回归；复核中发现三处"失败"实为技能里刻意保留的**迁移对照说明**（"旧写法 X 已移除"），据此给断言加了否定语境识别
  - [ ] 待定：是否给全部 27 个历史文档统一加头部横幅（当前只标注了含已知错误的 2 个）

- [ ] **工具 CLI/API 生命周期审查**（2026-09-13 记录，来源：外部抽样审查的结论）

  观察：**领域知识本身已比工具操作层稳定**——新的主要缺陷来源变成「命令/API 生命周期」与「示例代码没真正 smoke-test」。样例：Volatility 3 的插件路径重组（`windows.hashdump` → `windows.registry.hashdump`，旧别名标记 2026-09-25 移除）；同一工具族的**符号获取机制**在 Windows 与 Linux/macOS 完全不同，写成一套即错。

  > 关键区别：**"源码目录变了"不等于"命令行调用名变了"**——malfind 的源码在 `windows/malware/` 下，但调用名仍是 `windows.malfind`。按目录结构改命令会引入新错误。

  - [x] **第三方命令/API 清单**（2026-09-13）：`docs/audit/tool-register.json`（140 项，含工具名 / kind / 引用它的技能 / 上次核验日期 / 核验来源 / ignore 名单）+ `lib/tool-register.mjs`（抽取与比对）+ `bin/toollife.mjs`（check / candidates / stale / smoke）
  - [x] **版本漂移检查**（2026-09-13）：`check` 报"已核验 / 超期 / 待核验积压"三档 + **死条目即失败**（登记为在用但技能里已找不到）；`stale` 按超期排序供下一轮审查波取用；`smoke` 做本机存在性探测（仅报告，不进 CI——CI 机器不必装这些工具）
  - [x] **候选发现**（2026-09-13）：技能里出现但未登记且不在 ignore 名单的命令会被列为候选，仓库自身的那条已作为测试常驻（`tests/toollife.test.mjs`）——**新增第三方工具而不登记会直接让 `npm test` 失败**
  - [x] **示例可执行性**（2026-09-13）：`lib/skill-examples.mjs` + `bin/examplecheck.mjs`（`npm run examples`）——对 python / shell 块做语法检查（**不是执行**：不跑网络、不装依赖），含去缩进、占位符中和、调试器会话识别、sh 块内嵌 python heredoc 的单独检查。首轮抓出 3 处真错（angr 的 `0x4011xx` 不是合法 Python）+ 2 处语言标错（Haskell/Nim 源码写在 ```sh 块里）。有解释器时随 `npm test` 跑，否则跳过
  - [x] **风险分层**（2026-09-13）：`deriveRisk` 按**断言类型**（写死层级路径/版本号 vs 只点名工具）分高/低风险，出现面作严重度——现 134 项积压中**高风险 40、低风险 94**，`npm run toollife` 按影响面给出建议顺序
  - [x] 首批回填（2026-09-13）：6 项（vol / frida / candump / mmls / tsk_recover / readelf）——均为本会话审查波中确实核验过 CLI/API 形态的
  - [x] **probe.sh 工具清单由登记表生成**（2026-09-14）：`lib/probe-tools.mjs` + `bin/probelist.mjs`——此前 probe.sh 硬编码 19 个工具而登记表已有 137，`RE_TOOLS` 反映不出环境实况（装了的可能不被用）。现为生成物 + `--check` 校验，`npm test` 已含。顺带修两处：`free` 输出本地化导致 **MEM_GB 恒为空**（固定 `LC_ALL=C`）；`dd`/`hexdump` 属基础工具，移出登记表
  - [ ] **核验剩余 131 项积压**：按 `npm run toollife` 的高风险顺序分批做（高风险 39 / 低风险 92），每批完成后回填 `last_verified` 与 `source`
  - [ ] 与「增量审查机制」合并设计：两者共用"变更检测 + 记录状态"的骨架——**已合并**：登记表用 `last_verified`，审查状态用 `hash + last_reviewed`，同一套状态模型

- [x] **re-kernel 是否拆分（已决：不拆）**（2026-09-14 评估）

  曾担心 `re-kernel` 合计 3745 行 / 23 分支过大。实测**口径错了**：技能是"按需加载"的库而非单体文档——**每次都会加载的只有 SKILL.md（177 行）**，分支各 200–500 行、用到才读。与同类网关对比：`re-rtos` 197 行、`re-hypervisor` 169 行、`re-analyze` 117 行——**re-kernel 的常驻成本并不突出**。

  拆分反而有代价：新增 5+ 个技能（计数要同步六处）、把**失败模式决策表**（跨平台"症状 → 先怀疑什么"）割裂——那正是该技能最有价值的部分——且不降低常驻成本（每个新技能自己也要前言与工具准备）。

  **真正要防的是 SKILL.md 膨胀成单体**，已加 `tests/skill-budget.test.mjs`（SKILL.md ≤240 行、单分支 ≤600 行、必备章节仍在）。顺带修一处：re-kernel 用「## 通用主线」代替模板规定的「## 操作步骤」，已改为「## 操作步骤（跨平台通用主线）」。

- [ ] **增量审查机制**（2026-08-29 记录，来源：aiskillstore skill-report.json 机制调研）

  > 2026-09-13 更新：批 1 finding 已按本机制的状态机（open → fixed → verified）记录，见 `docs/audit/2026-09-13-factual-audit.md`——可作为首个落地样例参考。

  现状痛点：审查波是全量式——每波把整批技能从头审一遍，已确认部分（如 re-go 断言、re-address-space 归因）被反复重审，浪费 token 和时间。

  目标：审查成本从 O(技能总数) 降到 O(变更数)。

  方案要点（参考 skillstore 的 skill-report.json 设计）：
  - [x] 每技能一份审计记录（简化版：内容 hash + 结论 + finding 状态），随技能进仓库（2026-09-13）：`docs/audit/review-state.json` —— 122 技能，每项 `{ hash, last_reviewed, note }`（用**单一文件**而非 122 个文件：同一份状态要整体比对，分散反而增加维护面）
  - [x] 审查波改增量（2026-09-13）：`node bin/auditstate.mjs status` 直接列出「**内容在复核之后又变了**」的技能——这就是下一轮审查波的工作集；复核完 `update <技能>` 回填。成本从 O(技能总数) 降到 O(变更数)
  - [x] finding 状态机 open → fixed → verified（2026-09-13）：已在 `docs/audit/2026-09-13-factual-audit.md` 落地（open → fixed；verified 为待补的下一步）
  - [x] 报告生成 + 增量审计入口（2026-09-13）：`npm run audit:status` / `npm run audit:update`；另有一条测试断言**状态文件覆盖全部技能**（无缺失、无多余、已删技能会自动清理并告警）
  - [ ] validate.mjs 内联扩展（**未做，改设计**）：不把审查状态塞进结构校验——它需要写盘与日期，与 validate 的纯读校验性质不同；改为独立脚本 + 一条测试断言，保持 validate.mjs 的单一职责
  - [ ] （可选）审计履历沉淀后可作发布质量背书
