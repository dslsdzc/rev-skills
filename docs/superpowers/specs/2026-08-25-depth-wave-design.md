# 技能库深度扩充设计（深度波）

日期：2026-08-25
状态：已获用户批准（2026-08-25 逐节确认）

## 1. 总览

**目标**：给现有全部技能加深度——薄技能正文扩写至基线 + 全部技能按类型配 references/ 深度文件（每技能 2 个）。

**已确认决策**：
1. 形态：两者结合（正文扩写 + references/ 深度文件）
2. 范围：分层滚动（T1/T2/T3，网关正文不动）
3. 粒度：按技能类型多文件（每技能 2 个，主题命名）
4. 流程：样板先行（2 个样板定调后批量）
5. 实现方案：A（类型映射表 + 技能簇任务）

**范围**：112 个现有技能（v4 的 6 新技能 + re-rtos/re-behavior 标注「待 v4 落地后套用」，不在本设计内重复设计）。技能计数不变：112（v4 落地后 118）。深度文件总量约 220 个。

## 2. 分层范围

| 分层 | 判定 | 产出 | 规模 |
|---|---|---|---|
| T1 | 原子技能 SKILL.md <100 行 | 正文扩写至 ~130 行基线 + 2 个深度文件 | 约 18 技能 |
| T2 | 原子技能 100-130 行 | 正文适度补强（补缺章/示例/坑，无硬基线）+ 关键者配深度文件 | 48 技能 |
| T3 | 原子技能 >130 行 | 只补深度文件（尚无者） | 约 33 技能 |
| 网关（12+1） | 编排器设计使然 | 正文不动（re-analyze 已有 references/ 不动） | 13 |

行数按 2026-08-25 实测（`wc -l .claude/skills/*/SKILL.md`，中位 99 行；86-130 行共 62 个）。T1/T3 为约数，精确清单由实施计划首个任务（映射表）产出并确认。

**关键者判定规则**（T2 内）：跨域引用数 ≥ 2，或被网关子技能清单 / triage 路由直接引用，或与 T1 相邻主题（如 re-rtos 与 T1 的 re-tee 同簇）。

## 3. 类型-文件集映射

每技能 2 个 references/ 文件，主题命名对齐 frida-scripts.md 惯例；`[[链接]]` 目标 = 文件名去扩展名（validate 既有支持）。

| 类型 | 文件集 | 内容骨架 | 代表技能（示例） |
|---|---|---|---|
| 工具类 | `commands.md` + `gotchas.md` | 命令速查/常用操作序列/组合套路；工具特有坑/版本差异/边界 | ghidra / ida / radare2 / gdb / lldb / x64dbg / windbg / binaryninja / angr / z3 / netcap / frida / tracing / sandbox / ti / sdr / mem-forensics / emulation / fw-emulate / plugin-dev / apk（jadx/apktool 为主） |
| 格式类 | `layout.md` + `examples.md` | 结构图/字段表/布局与偏移；最小解析示例/字节样例/字段对照 | format-pe / format-elf / format-macho / wasm / cpp-abi / go / rust / nim / zig / swift / fp-runtime / flutter / hybrid-app / harmonyos / python / dotnet / java / rtos / mips / uefi / crypto-id / blockchain / drm / whitebox / mobile-pack |
| 方法论类 | `decision-tree.md` + `gotchas.md` | 场景决策树/分支逻辑/证据分级；方法论坑/边界/反例 | behavior / hunting / attribution / proto-rev / ioc / anti-cheat / evasion / fileless / ransomware / loader / doc-malware / browser-ext / keygen / license / patching / variant / deobfuscate / unpack-simple / unpack-advanced / stego / fuzzing / crash-triage / exploit / pwn / shellcode / kernel / hypervisor |
| 领域混合类 | 取主类型文件集 | 判定规则：按技能主属性归类（场景为主取主类型；工具密集取工具类） | ics / iot-proto / automotive / hardware-io / hw-chip / tee / game / macos / ios / ios-jb / android-native / mobile-forensics / disk-forensics / memdump / triage / fw-extract / fw-rootfs / crypto-decrypt / crypto-keys / a-model / a-attack / stego 等 |

**完整映射表**（112 技能 → 类型 × 分层 → 所属簇任务）由实施计划首个任务产出并确认，本设计定规则与形态。

## 4. 任务结构

任务队列（每任务 = 实现 → 事实核验（必要时 web）→ 红线对照 → `npm test` → commit 只 add 本任务文件）：

1. **映射表任务**：产出 112 技能的类型×分层映射表（设计附录，供后续任务引用）
2. **样板任务**：re-x64dbg（工具类）+ re-format-elf（格式类）完整深度产出 → 提交后用户审阅定调
3. **T1 批次**（约 18 技能 → 4-5 个簇任务）：正文扩写至 ~130 行基线 + 2 个深度文件；簇按「类型 × 主题相邻」划分（如 T1 工具类簇、T1 格式类簇…）
4. **T2 批次**（48 技能 → 10-12 个簇任务）：正文补强 + 关键者（判定规则见第 2 节）配深度文件
5. **T3 批次**（约 33 技能 → 6-7 个簇任务）：只补深度文件
6. **re-rtos / re-behavior**：深度产出放队列末尾（v4 落地后套用）
7. **终审波**：全库 references 死链/计数/事实抽查/红线对照

**样板审阅要点**：正文扩写密度与风格、深度文件骨架与命名、命令/示例颗粒度；定调后批量任务按样板同构执行。

## 5. 质量闸口与验证

- validate.mjs：references/*.md 文件名（去扩展名）为合法 `[[链接]]` 目标；SKILL.md `[[链接]]` 必须解析（深度文件内引用其他技能必须指向存在目标）
- 正文扩写不破坏 frontmatter（`name`=目录名、`description` 非空、`type: atomic` 必含「## 工具准备」）与固定五节结构
- 事实核验：命令/字段/格式断言以官方文档为准（命令必须可执行；字段名以本机输出验证的写法沿用仓库惯例）；抽查机制进终审波
- 红线：呈现中性（禁「最推荐/强烈建议」）/ 隐私脱敏（不指具体项目/公司/产品）/ 不绑定具体工具（跨 OS 安装命令）
- 每任务 `npm test`；深度波不改技能计数（112 → v4 后 118 由 v4 负责）

## 6. 与 v4 并行协调

- 两个计划独立任务队列、独立 commit、独立评审
- 文件集隔离：v4 只碰 6 新技能目录 + re-rtos/re-behavior/triage/rerouting/计数文件；深度波只碰其余约 104 个现有技能的 SKILL.md 与 references/（re-rtos/re-behavior 深度产出在 v4 落地后套用）
- 并行执行方式：两计划均按 subagent-driven-development 思路推进（计划内任务串行、两计划间并行），git 冲突面为零
- 计数同步只由 v4 负责；深度波每任务 `npm test` 输出一致

## 7. 产出物清单

- 约 220 个 references/ 深度文件（commands/gotchas/layout/examples/decision-tree）
- 约 80 个 SKILL.md 正文扩写/补强（T1 全量 + T2 适度）
- 映射表设计附录（112 技能 × 类型 × 分层）
- 技能计数保持 112（v4 后 118）
