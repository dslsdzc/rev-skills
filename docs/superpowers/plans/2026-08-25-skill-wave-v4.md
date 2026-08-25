# wave-v4（覆盖缺口波）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增 6 个原子技能（re-arm/re-riscv/re-console/re-electron/re-javacard/re-ebpf）+ 2 处扩章（re-rtos +VxWorks/QNX/INTEGRITY、re-behavior +行为监控工具链），技能总数 112 → 118。

**Architecture:** 纯技能文档扩展。6 个新技能目录（SKILL.md 按 docs/skill-template.md 原子技能规范，内容按设计文档 §3 各节）+ 2 处扩章（第 4 节）+ 挂载同步（triage/rerouting/网关子技能列表/跨域引用）+ 计数同步（README/AGENTS/marketplace.json）。

**Tech Stack:** Markdown / YAML frontmatter / validate.mjs（npm test，现有）。

**设计依据：** docs/superpowers/specs/2026-08-25-skill-wave-v4-design.md（已提交 f7e4db9）——每任务的技能内容骨架（边界/工具/步骤/坑）以设计文档对应小节为准，本计划不重复整文。

**并行协调：** 深度波计划（docs/superpowers/plans/2026-08-25-depth-wave.md）同时执行。文件集隔离：本计划只碰 6 新技能目录 + re-rtos/re-behavior/triage/rerouting/网关列表/计数文件；深度波只碰其余现有技能。两计划不得交叉修改对方文件。

## Global Constraints

- **红线 1 呈现中性**：禁用「最推荐」「强烈建议」等最高级强推措辞（最多「推荐」）
- **红线 2 隐私脱敏**：内容不指向具体项目/公司/产品；硬件类给泛化选购指引
- **不绑定具体工具**：方法为核心，工具为可替换示例；「工具准备」按模板给跨 OS 安装命令（Linux/macOS/Windows/WSL 分支）
- validate.mjs：frontmatter `name`=目录名、`description` 非空（中英触发词）、`type: atomic` 必含「## 工具准备」、`[[链接]]` 必须解析；新技能先于引用它的同步任务（避免中间态死链）
- 事实核验：命令必须可执行、格式/字段断言以官方文档为准（必要时 web 核实），技术事实由实现时抽查，终审波复核
- **commit 纪律**：每任务 commit 只 `git add` 本任务列出的文件，严禁 `git add -A`
- 当前分支 `main`；`npm test` 预期按任务标注递增（112 → 118）
- 输出不用 emoji

---

### Task 1: 创建 re-arm 技能

**Files:**
- Create: `.claude/skills/re-arm/SKILL.md`

**Interfaces:**
- Consumes: 设计文档 §3.1（边界/工具/步骤/坑）
- Produces: 技能目录 `re-arm`（供 Task 9 的 [[re-arm]] 链接解析；计数 112 → 113）

- [ ] **Step 1: 撰写 SKILL.md**

按 docs/skill-template.md 五节结构 + 设计文档 §3.1 撰写。frontmatter：
```yaml
---
name: re-arm
description: >
  ARM 架构逆向（非 Android）：Cortex-M/A 向量表、Thumb/ARM 切换、AAPCS 调用约定、位置相关代码重定位、MMIO 外设寄存器交叉。
  触发词：ARM、arm32、Cortex-M、Cortex-A、Thumb、AAPCS、嵌入式逆向、裸机固件、stm32、向量表。
---
```
「工具准备」必含：Ghidra/IDA（架构导入与 Thumb 支持）、`readelf`/`file`、`qemu-arm`/`qemu-aarch64`（用户态仿真）、`gdb-multiarch`、binwalk（联动 re-fw-extract），跨 OS 安装命令 + 验证命令。
「何时使用 / 何时不用」：明确排除 Android so（→ re-android-native）、通用 AArch64 Linux 用户态（→ re-binary-core）。
「操作步骤」6 步按设计 §3.1（架构确认 → 入口定位 → Thumb 边界 → 重定位 → AAPCS → 外设 xref）。
「常见坑与陷阱」≥3 条按设计 §3.1 列表。

- [ ] **Step 2: 验证**

Run: `node validate.mjs`；`npm test`
Expected: `OK: 113 skills validated`；22 单测全绿。

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/re-arm/SKILL.md
git commit -m "feat: 新增 re-arm——ARM 架构逆向（Cortex-M/A、Thumb、AAPCS、MMIO），113/118"
```

### Task 2: 创建 re-riscv 技能

**Files:**
- Create: `.claude/skills/re-riscv/SKILL.md`

**Interfaces:**
- Consumes: 设计文档 §3.2
- Produces: 技能目录 `re-riscv`（供 Task 9 的 [[re-riscv]] 链接解析；计数 113 → 114）

- [ ] **Step 1: 撰写 SKILL.md**

frontmatter：
```yaml
---
name: re-riscv
description: >
  RISC-V 架构逆向：RV32/RV64、压缩指令（RVC）、gp 相对寻址、ABI 与 ecall 系统调用约定、工具链指纹。
  触发词：RISC-V、riscv、RV32、RV64、RVC、压缩指令、ecall、ESP32-C3、GD32V。
---
```
五节按设计 §3.2；「工具准备」含 Ghidra（RISC-V 支持）、`qemu-riscv64/32`、binutils 交叉工具链（`riscv64-unknown-elf-objdump`）、readelf；「操作步骤」7 步；「坑」≥3 条按设计。

- [ ] **Step 2: 验证** — `node validate.mjs` → `OK: 114 skills validated`；`npm test` 全绿
- [ ] **Step 3: Commit** — `feat: 新增 re-riscv——RISC-V 架构逆向（RVC/gp/ABI/ecall），114/118`

### Task 3: 创建 re-console 技能

**Files:**
- Create: `.claude/skills/re-console/SKILL.md`

**Interfaces:**
- Consumes: 设计文档 §3.3
- Produces: 技能目录 `re-console`（供 Task 9 的 [[re-console]] 链接解析；计数 114 → 115）

- [ ] **Step 1: 撰写 SKILL.md**

frontmatter：
```yaml
---
name: re-console
description: >
  现代主机与复古平台逆向：Switch NSO/NPDM 容器与加密分区、PS4/PS5 ORBIS 结构、SDK 库指纹；复古 ROM 头/卡带格式/存档与 Cheat 码。
  触发词：主机逆向、Switch、NSO、NPDM、PS4、PS5、ORBIS、Xbox、复古、ROM、NES、GBA、模拟器、Cheat。
---
```
五节按设计 §3.3；「何时不用」显式声明改机/盗版授权边界；「工具准备」含通用反编译器 + 平台容器工具（hactoolnet 类，**实现时 web 核实工具名与可用性**）+ 模拟器调试器 + 卡带读取器选购指引；「操作步骤」6 步（含复古存档/Cheat 小节）；「坑」≥3 条。

- [ ] **Step 2: 验证** — `node validate.mjs` → `OK: 115 skills validated`；`npm test` 全绿
- [ ] **Step 3: Commit** — `feat: 新增 re-console——现代主机（NSO/NPDM/ORBIS）与复古平台逆向，115/118`

### Task 4: 创建 re-electron 技能

**Files:**
- Create: `.claude/skills/re-electron/SKILL.md`

**Interfaces:**
- Consumes: 设计文档 §3.4
- Produces: 技能目录 `re-electron`（供 Task 9 的 [[re-electron]] 链接解析；计数 115 → 116）

- [ ] **Step 1: 撰写 SKILL.md**

frontmatter：
```yaml
---
name: re-electron
description: >
  Electron 桌面应用逆向：asar 解包、主/渲染进程 JS、V8 字节码（.jsc）边界、CDP 动态调试、反调试对抗。
  触发词：Electron、asar、桌面应用逆向、.jsc、V8 快照、CDP、ELECTRON_RUN_AS_NODE、devtools 检测。
---
```
五节按设计 §3.4；「工具准备」含 `npx asar extract` 类解包、Node/Electron 版本识别、CDP 客户端、strings、通用反编译器；「操作步骤」7 步（静态 → 动态 → 对抗）；「坑」≥3 条按设计（.jsc 边界注明限制）。

- [ ] **Step 2: 验证** — `node validate.mjs` → `OK: 116 skills validated`；`npm test` 全绿
- [ ] **Step 3: Commit** — `feat: 新增 re-electron——Electron 桌面应用逆向（asar/CDP/.jsc），116/118`

### Task 5: 创建 re-javacard 技能

**Files:**
- Create: `.claude/skills/re-javacard/SKILL.md`

**Interfaces:**
- Consumes: 设计文档 §3.5
- Produces: 技能目录 `re-javacard`（供 Task 9 的 [[re-javacard]] 链接解析；计数 116 → 117）

- [ ] **Step 1: 撰写 SKILL.md**

frontmatter：
```yaml
---
name: re-javacard
description: >
  Java Card / SIM 卡 applet 逆向：CAP 文件九组件解析、CAP 字节码（Java 子集）还原、AID 与安装参数、process(APDU) 分派。
  触发词：Java Card、javacard、CAP 文件、SIM 卡、USIM、applet、AID、银行卡、JCVM。
---
```
五节按设计 §3.5；「工具准备」含 CAP 解析（开源解析器或自写 Python 脚本，实现时核实可用解析器）、Ghidra/IDA 无原生 CAP 支持说明、`javap` 对照、读卡器选购指引 + 授权边界；「操作步骤」6 步；「坑」≥3 条。

- [ ] **Step 2: 验证** — `node validate.mjs` → `OK: 117 skills validated`；`npm test` 全绿
- [ ] **Step 3: Commit** — `feat: 新增 re-javacard——Java Card/SIM applet（CAP 组件/字节码还原），117/118`

### Task 6: 创建 re-ebpf 技能

**Files:**
- Create: `.claude/skills/re-ebpf/SKILL.md`

**Interfaces:**
- Consumes: 设计文档 §3.6
- Produces: 技能目录 `re-ebpf`（供 Task 9 的 [[re-ebpf]] 链接解析；计数 117 → 118）

- [ ] **Step 1: 撰写 SKILL.md**

frontmatter：
```yaml
---
name: re-ebpf
description: >
  eBPF 程序逆向与对抗分析：BPF-64 指令集、progs/maps 关联、bpftool 反汇编、跟踪取证/恶意样本/EDR 对抗三用途。
  触发词：eBPF、BPF、bpftool、bcc、libbpf、xlated、BPF 指令、bpf hook、EDR 对抗、tracepoint、kprobe。
---
```
五节按设计 §3.6；「工具准备」含 `bpftool`（`prog dump xlated`/`feature`）、`llvm-objdump -d bpf`、pyelftools、专用逆向工具（实现时核实，如 bpf-gazelle 类）、受控环境（联动 re-sandbox）；「操作步骤」5 步；「坑」≥3 条（helper 调用号版本漂移对策写明按版本查表）。

- [ ] **Step 2: 验证** — `node validate.mjs` → `OK: 118 skills validated`；`npm test` 全绿
- [ ] **Step 3: Commit** — `feat: 新增 re-ebpf——eBPF 程序逆向与对抗（BPF-64/progs-maps/xlated），118/118`

### Task 7: re-rtos 扩章（VxWorks/QNX/INTEGRITY）

**Files:**
- Modify: `.claude/skills/re-rtos/SKILL.md`（frontmatter 触发词、正文 +3 章、跨域联合 +[[re-automotive]]、「何时使用」扩一句商业 RTOS）

**Interfaces:**
- Consumes: 设计文档 §4.1
- Produces: re-rtos 覆盖 7 个 RTOS（计数不变）

- [ ] **Step 1: 扩写 SKILL.md**

- frontmatter description 触发词追加：`VxWorks、QNX、INTEGRITY`
- 正文按现有四章同构追加三章（每章：TCB/内核对象关键字段 → 定位方法 → 特征串）：
  - **VxWorks**：WIND_TCB（任务名表/栈指针/优先级字段）、VxWorks 7 结构变化、任务名串特征定位
  - **QNX**：线程控制块（procnto 微内核）、MsgSend/MsgReceive 消息传递调度链、车机中控场景
  - **INTEGRITY**：分区（partitions）内存布局、任务/进程表结构、航电/工业场景特征
- 跨域联合追加 `[[re-automotive]]`（QNX 车机联动）

- [ ] **Step 2: 验证** — `node validate.mjs` → `OK: 118 skills validated`；`npm test` 全绿
- [ ] **Step 3: Commit** — `enhance: re-rtos 扩章——VxWorks/QNX/INTEGRITY 三章 + 车机联动`

### Task 8: re-behavior 扩章（行为监控工具链）

**Files:**
- Modify: `.claude/skills/re-behavior/SKILL.md`（追加「行为监控工具链」一节）

**Interfaces:**
- Consumes: 设计文档 §4.2
- Produces: re-behavior 覆盖 Windows 行为监控（计数不变）

- [ ] **Step 1: 扩写 SKILL.md**

正文追加一节「行为监控工具链（Windows）」：
- **ProcMon**：过滤/标注/CSV 导出关联（进程→文件→注册表→网络时间线）、过滤语法要点
- **API Monitor**：API 级 hook 链与调用参数记录（与 re-tracing 的 strace/ltrace 对应）
- **ETW**：会话与事件解析（logman/wevtutil 命令；采集侧视角，与 re-evasion 绕过侧互补）
- **Process Explorer**：进程树/句柄/签名验证视图要点
- 仅 Windows 工具在「工具准备」注明跨 OS 约束（Linux 侧对应走 [[re-tracing]]）

- [ ] **Step 2: 验证** — `node validate.mjs` → `OK: 118 skills validated`；`npm test` 全绿
- [ ] **Step 3: Commit** — `enhance: re-behavior 扩章——Windows 行为监控工具链（ProcMon/API Monitor/ETW/PE）`

### Task 9: 挂载同步（triage / rerouting / 网关列表 / 跨域引用）

**Files:**
- Modify: `.claude/skills/re-analyze/references/triage.md`（路由表补分支）
- Modify: `.claude/skills/re-analyze/references/rerouting.md`（A/B 表补行）
- Modify: `.claude/skills/re-binary-core/SKILL.md`（子技能列表补 [[re-arm]]/[[re-riscv]]）
- Modify: `.claude/skills/re-managed/SKILL.md`（子技能列表补 [[re-electron]]/[[re-javacard]]）
- Modify: `.claude/skills/re-game/SKILL.md`（跨域联合补 [[re-console]]）
- Modify: `.claude/skills/re-iot-proto/SKILL.md`（跨域联合补 [[re-javacard]]）
- Modify: `.claude/skills/re-fw-emulate/SKILL.md`（架构识别节补 [[re-arm]]/[[re-riscv]]）

**Interfaces:**
- Consumes: Task 1-6 的技能目录（[[链接]] 解析目标）
- Produces: 新技能可被发现（计数不变）

- [ ] **Step 1: triage.md 补路由**

按现有路由表行式逐行核对，补：
- 固件行：`→（ARM 架构 → re-arm；RISC-V → re-riscv）`
- 托管行：`→（Electron 应用 → re-electron；Java Card/SIM → re-javacard）`
- 游戏行：`→（现代主机/复古 → re-console）`

- [ ] **Step 2: rerouting.md 补证据→技能行**

A/B 表补行（至少 5 行）：`.NSO/NPDM` 结构 → re-console；BPF ELF section（.BTF/.maps）→ re-ebpf；CAP 文件头（`0xDE 0xCA` 类魔数，实现时按 CAP 规范核实）→ re-javacard；asar 结构（`files` 目录 + app.asar）→ re-electron；VxWorks/QNX 特征串 → re-rtos；MMIO 外设区 + Thumb 特征 → re-arm。

- [ ] **Step 3: 网关子技能列表与跨域引用**

re-binary-core 子技能行补 `[[re-arm]]`、`[[re-riscv]]`（对标 `[[re-mips]]` 行）；re-managed 子技能行补 `[[re-electron]]`、`[[re-javacard]]`；re-game 跨域联合补 `[[re-console]]`；re-iot-proto 跨域联合补 `[[re-javacard]]`；re-fw-emulate 架构识别节补 `[[re-arm]]`/`[[re-riscv]]`。

- [ ] **Step 4: 验证** — `node validate.mjs` → `OK: 118 skills validated`（无死链）；`npm test` 全绿
- [ ] **Step 5: Commit** — `enhance: 挂载同步——triage/rerouting 路由补 6 技能 + 网关列表与跨域引用`

### Task 10: 计数同步（README / AGENTS / marketplace.json）

**Files:**
- Modify: `README.md`（技能数 112 → 118，按实际表述核对）
- Modify: `AGENTS.md`（技能数 112 → 118）
- Modify: `marketplace.json`（逐字段核对，有技能数/版本则同步）

**Interfaces:**
- Consumes: Task 1-9 完成
- Produces: 全库计数一致（118）

- [ ] **Step 1: 计数替换**

grep 全库 `112` 相关技能数表述（README/AGENTS/marketplace.json 及他处），逐一更新为 118；不含数字的其他字段不动。

- [ ] **Step 2: 验证** — `node validate.mjs` → `OK: 118 skills validated`；`npm test` 全绿
- [ ] **Step 3: Commit** — `docs: 计数同步 112 → 118（README/AGENTS/marketplace）`

### Task 11: 终审修复波

**Files:** 视修复结果（全库）

**Interfaces:**
- Consumes: Task 1-10 完成
- Produces: 全库一致、无死链、事实与红线达标

- [ ] **Step 1: 全库审查**

- `node validate.mjs` / `npm test` 全绿
- grep 检查：6 新技能触发词与 description 一致性、[[链接]] 全部可解析（validate 已保证）、计数 118 一致
- 技术事实抽查：每个新技能至少 1 条关键断言核对（命令可执行性 / 格式字段官方依据），必要时 web 核实
- 红线对照：新内容无强推措辞、无具体项目/产品指向

- [ ] **Step 2: 修复与提交**

修复发现项（每文件独立 commit：`fix: 终审——<内容>`）；全部完成后最终 `node validate.mjs` → `OK: 118 skills validated` + `npm test` 全绿。

---

**最终验证**：`node validate.mjs` 输出 `OK: 118 skills validated`；`npm test` 22 单测全绿；`git log` 含本计划全部任务 commit。
