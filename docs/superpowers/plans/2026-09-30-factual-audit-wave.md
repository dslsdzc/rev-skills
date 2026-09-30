# 事实核查波（监控报告对账后修复）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 处理 2026-09-12 至 2026-09-29 ChatGPT 监控对话中的 121 条报告项——30 条已修不动，91 条未修项经实测判定后，对确证成立者修正内容、补回归断言、回填审查状态。

**Architecture:** 先出判定表（逐条给出实测证据与结论：采纳/驳回/部分采纳），再按**技能文件集**分组串行修复（每个技能只归一个任务，避免同文件并发修改）。两条「安装矩阵收敛」任务（rizin / binwalk）先落地源侧单一事实源，其余任务改写各自的副本指回源侧。终审波统一补断言与审查记录。

**Tech Stack:** Markdown / YAML frontmatter / Node ESM 工具链（`validate.mjs`、`bin/capindex.mjs`、`bin/auditstate.mjs`）/ node:test。

**设计依据：** 本次对账的三份本地产物（`/analysis/` 下，gitignore 已排除，不进公开仓库）：
- `analysis/chatgpt-share-6abc3084.txt` —— 对话全文（238 条消息）
- `analysis/unfixed-report.md` —— 121 条修复状态对账（含 A/B/C 三类判定与文件:行证据）
- `analysis/findings.json` —— 报告项结构化数据（F001–F121）

已确立的前提：**「未修」不等于「是缺陷」**。

**判定已完成（2026-09-30）**：95 条逐条判定——采纳 70、部分成立 9、**驳回 11**、已修 5。判定表见
`docs/audit/2026-09-30-adjudication.md`（提交 f532491），依据与改法以该表为准。

**驳回的 11 条（F022 / F034 / F035 / F036 / F047 / F052 / F069 / F072 / F080 / F110 / F111）
严禁出现在任何 `fix:` 提交里**——改动它们等于把正确内容改错。Task 5 Step 1 与 Task 6 Step 1
已按此改写作废步骤。各任务的「Consumes」栏引用的判定结论，以判定表中该条目的「改法」列为准；
标「不改」的即跳过。

**并行协调：** 本计划任务**串行执行**（后一任务依赖前一任务 commit）；执行期间不得与其他计划交叉修改同一技能目录。文件集隔离见各任务 Files 清单。

## Global Constraints

- **红线 1 呈现中性**：禁用「最推荐」「强烈建议」等最高级强推措辞（最多「推荐」）
- **红线 2 隐私脱敏**：内容不指向具体项目/公司/产品；本波源自一份对话记录，**改写时只保留技术结论，不得把对话里的措辞、引用标记（`filecite`/`cite` 残留）、模型署名带进技能**
- **红线 3 不用 emoji**：文档与提交信息一律纯文本
- **红线 4 事实核验**：每条改动必须附实测证据（PyPI/官方文档/源码/本地实跑命令与输出），禁止「按报告照改」。仓库历史上多处断言因想当然出错，本波尤其要求先证后改
- **红线 5 授权边界**：内容边界不变，不因修 bug 引入新的绕过/破解类操作指引
- **内容边界**：`.claude/skills/` 只写「是什么/怎么做」——**不写审查历史**（日期戳、finding 编号、progress 标记、`docs/audit/` 引用）。判定过程与编号一律留在 `docs/audit/`
- **validate 约束**：frontmatter 的 `name`=目录名、`description` 非空且含 CJK+拉丁、`capabilities` 标签须在注册表内、正文 `[[链接]]` 必须解析（**先建文件再加链接**）
- **commit 纪律**：每任务 commit 只 `git add` 本任务列出的文件，**严禁 `git add -A`**
- 每任务收尾 `npm test` 必须输出 `OK: 122 skills validated` 且全绿；改动 `capabilities` 时先跑 `node bin/capindex.mjs`
- 当前分支 `main`；本波**不改技能总数**（122）

---

### Task 1: 判定表（91 条未修项逐条实测）

**Files:**
- Create: `docs/audit/2026-09-30-adjudication.md`（判定表）
- Modify: `docs/audit/2026-09-13-factual-audit.md`（追加「补充 33：监控报告对账波——判定表」小节，指向判定表）

**Interfaces:**
- Consumes: `analysis/unfixed-report.md`（A/B/C 三类清单）、`analysis/findings.json`（F001–F121 原文）
- Produces: 判定表——后续每个修复任务的输入；每条给出 `F 编号 | 目标文件:行 | 报告主张 | 实测证据 | 结论（采纳/驳回/部分采纳）| 改法`

- [ ] **Step 1: 逐条实测**

对 A 类（约 53 项）与 B 类（14 条）逐条取证。取证手段按类型：
- 版本/依赖类 → 查官方元数据（`curl -sS https://pypi.org/pypi/<pkg>/json` 的 `info.version` 与 `requires_python`）；GitHub 发行用 `https://github.com/<owner>/<repo>/releases.atom`（API 有未认证限流）
- 格式/常量类 → 官方规范、头文件（如 Apple `loader.h`、Linux `elf.h`）、工具源码，必要时本地编译/构造样本实跑
- 命令/API 类 → 能用则本地实跑（`--help`、最小样例），不能实跑则注明依据来源
- 判定规则同仓库既有做法：**报告主张逐条列出，逐条给反证或佐证**；证不成立即驳回，并写明「驳回也要有证据链」

- [ ] **Step 2: 落表并标注排序**

按目标技能聚合写入判定表；标注每条的结论与依赖（如「依赖 Task 2 的源侧结论」）。**C 类 3 条单列一节**，写明报告错在哪、仓库写法为何正确，供日后防止「照报告把正确内容改错」。

- [ ] **Step 3: 验证** — `node validate.mjs` → `OK: 122 skills validated`（判定表在 `docs/`，不影响技能结构）
- [ ] **Step 4: Commit** — `docs: 监控报告对账判定表——91 条未修项逐条实测`
- [ ] **Step 5: 用户确认（评审闸口）**

提交判定表摘要：采纳/驳回/部分采纳各多少条，其中拟驳回的条目与理由。**未获确认前不得进入 Task 2。**

### Task 2: rizin 安装矩阵收敛（源侧）

**Files:**
- Modify: `.claude/skills/re-radare2/SKILL.md`（定为 rizin 安装的**单一事实源**）
- Modify: `.claude/skills/re-radare2/references/gotchas.md`（radare2 版本代际）

**Interfaces:**
- Consumes: Task 1 判定表中 rizin Debian 包状态与 r2 当前版本的实测结论
- Produces: rizin 安装矩阵（Debian/Ubuntu、Kali、Arch、Fedora/RHEL 分列）+ r2 版本基线；Task 13 据此改写六个副本

- [ ] **Step 1: 定矩阵**

按判定表结论重写安装段：Debian/Ubuntu 用官方 release 二进制或 `rz-pm`（**删除无条件的 `apt install rizin`**）；Kali 可 apt；Arch `pacman -S`；Fedora/RHEL 按当前仓库实际情况；每类给出 `rizin -v` 验证。**不保留未经核实的版本门槛猜测**（如「Debian 13+」）。同处修正被报告指为过时的 Fedora 行。
- [ ] **Step 2: 版本代际** — `references/gotchas.md` 的 r2 版本基线按实测更新，不写死 patch 号则改为「以官方 Releases Latest 为准」
- [ ] **Step 3: 验证** — `node validate.mjs`；`npm test` 全绿
- [ ] **Step 4: 回填** — `node bin/auditstate.mjs update re-radare2`
- [ ] **Step 5: Commit** — `fix: re-radare2 定为 rizin 安装单一事实源 + r2 版本基线更新`

### Task 3: binwalk 安装矩阵收敛（源侧）

**Files:**
- Modify: `.claude/skills/re-fw-extract/SKILL.md`（定为 binwalk 安装的**单一事实源**）

**Interfaces:**
- Consumes: Task 1 判定表中 binwalk 上游当前形态（v2 Python 包 vs v3 Rust 端口）的实测结论
- Produces: binwalk 安装段（含版本形态与验证命令）；Task 8 / Task 9 / Task 14 据此改写副本

- [ ] **Step 1: 定矩阵** — 按实测结论重写安装段，删除「pip 版版本新、跨平台（推荐）」这类未经核实的比较，写明当前推荐形态与 `binwalk --version` 验证方式
- [ ] **Step 2: 验证** — `node validate.mjs`；`npm test` 全绿
- [ ] **Step 3: 回填** — `node bin/auditstate.mjs update re-fw-extract`
- [ ] **Step 4: Commit** — `fix: re-fw-extract 定为 binwalk 安装单一事实源`

### Task 4: 版本基线组（re-ghidra / re-angr / re-ai-model）

**Files:**
- Modify: `.claude/skills/re-ghidra/SKILL.md`
- Modify: `.claude/skills/re-angr/SKILL.md` + `.claude/skills/re-angr/references/gotchas.md`
- Modify: `.claude/skills/re-ai-model/SKILL.md`

**Interfaces:**
- Consumes: Task 1 判定表（Ghidra 12.1.4 已发布、angr 10.0.0 / `>=3.12`、onnx 1.23）
- Produces: 三处版本基线更新；re-angr 同时是 angr Python 矩阵的全库单一事实源

- [ ] **Step 1: re-ghidra** — 版本行改为按官方 Releases Latest 表述，不写死 patch 号（若确需 patch 号再写）；JDK 要求按判定表结论（12.2 未进入正式 Releases 前不改）
- [ ] **Step 2: re-angr** — 主线版本与 Python 下限按实测更新；**同步检查**引用方 `re-crypto-decrypt` / `re-exploit` 是否已指向本技能（已指向，勿再复制矩阵）
- [ ] **Step 3: re-ai-model** — onnx 版本与 Python 下限
- [ ] **Step 4: 验证** — `node validate.mjs`；`npm test` 全绿
- [ ] **Step 5: 回填** — `node bin/auditstate.mjs update re-ghidra re-angr re-ai-model`
- [ ] **Step 6: Commit** — `fix: 版本基线——Ghidra / angr / onnx 三处按实测更新`

### Task 5: re-format-elf（字段语义组）

**Files:**
- Modify: `.claude/skills/re-format-elf/SKILL.md`
- Modify: `.claude/skills/re-format-elf/references/layout.md`

**Interfaces:**
- Consumes: Task 1 判定表（ELF gABI 字段定义、glibc `dlopen` 对缺 `PT_GNU_STACK` 的实际行为、`DT_SYMENT` 的 ELF32/64 差异）
- Produces: 修正后的字段表与步骤；**消除本技能内部的两处自相矛盾**

- [ ] **Step 1: `e_entry` 语义 — 已作废，不改**（判定表 F036/F047/F069/F110 驳回）

  报告称「DYN 下为相对基址的偏移」是事实错误。实测反证：gABI ch5 定义 base address = 内存地址与文件
  虚拟地址之差，对 executable/shared object 是同一常量；Linux `fs/binfmt_elf.c:1245` 即
  `e_entry = elf_ex->e_entry + load_bias;`——DYN 下 `e_entry` 本就是相对 base 的值，仓库措辞与该模型
  一致，且从未称其为文件偏移/RVA。`p_vaddr` 行同理。**本步骤不执行任何修改**，仅保留此记录防止
  后续有人照报告把正确措辞改错。
- [ ] **Step 2: `DT_SYMENT`** — 删除固定 24 字节的写法，按 ELFCLASS 分别给出（或写明以 `DT_SYMENT` 实际值为准）
- [ ] **Step 3: `.fini_array` 定位** — `SKILL.md` 步骤 3 标题不再把 `.fini_array` 与 `.init_array` 并列为「main 之前执行」；与同文件坑项（fini 在退出清理阶段）对齐
- [ ] **Step 4: Canary 判定** — 删除「符号表出现 `__stack_chk_fail` ⇒ 有 Canary」的等价关系，改为「存在引用 ⇒ 有带该保护的编译单元」，并说明与"该二进制启用了栈保护"的区别
- [ ] **Step 5: `PT_GNU_STACK` 缺失** — `SKILL.md` 与 `references/layout.md` 两条表述统一到同一结论（缺失时的实际行为依 ABI/glibc 版本而异，不写成必然 `EINVAL`，也不写成必然可执行栈），按判定表实测结论落笔
- [ ] **Step 6: 验证** — `node validate.mjs`；`npm test` 全绿
- [ ] **Step 7: 回填** — `node bin/auditstate.mjs update re-format-elf`
- [ ] **Step 8: Commit** — `fix: ELF 字段语义 4 项——DT_SYMENT / fini_array / Canary / PT_GNU_STACK`

### Task 6: re-format-macho（load command 组）

**Files:**
- Modify: `.claude/skills/re-format-macho/SKILL.md`
- Modify: `.claude/skills/re-format-macho/references/layout.md` + `references/examples.md`

**Interfaces:**
- Consumes: Task 1 判定表（`LC_DYLD_INFO(_ONLY)` 的信息流条数、`cmdsize` 对齐规则）。注意 `LC_MAIN.entryoff` 一条已驳回，不在本任务范围
- Produces: 修正后的入口定位与 dyld 信息表描述

- [ ] **Step 1: `LC_MAIN.entryoff` — 已作废，不改**（判定表 F034 驳回）

  报告称语义与入口 VA 公式写错。实测反证：Apple `loader.h` 注释 `file (__TEXT) offset of main()`；
  dyld `common/MachOAnalyzer.cpp:627` 为 `startAddress = preferredLoadAddress() + mainCmd->entryoff`；
  本机用 `ld64.lld` 造 Mach-O 实测 `__TEXT.vmaddr=0x100000000`、`entryoff=0x330`、`_main=0x100000330`
  精确命中。仓库公式与 Apple 实现一致。**本步骤不执行任何修改**。
- [ ] **Step 2: LC 最小长度** — 修正「64 位下 LC 最小 16 字节」的说法（按结构体实际对齐规则）
- [ ] **Step 3: `LC_DYLD_INFO(_ONLY)`** — 补 `weak_bind`，删除「四张表」的计数表述；同步 `references/layout.md` 的三处
- [ ] **Step 4: 验证** — `node validate.mjs`；`npm test` 全绿
- [ ] **Step 5: 回填** — `node bin/auditstate.mjs update re-format-macho`
- [ ] **Step 6: Commit** — `fix: Mach-O load command 2 项——LC 最小长度 / LC_DYLD_INFO 信息流`

### Task 7: 格式判定组（re-format-pe / re-cpp-abi / re-unpack-simple / re-triage）

**Files:**
- Modify: `.claude/skills/re-format-pe/SKILL.md`
- Modify: `.claude/skills/re-cpp-abi/SKILL.md`
- Modify: `.claude/skills/re-unpack-simple/SKILL.md`
- Modify: `.claude/skills/re-triage/SKILL.md`

**Interfaces:**
- Consumes: Task 1 判定表（Delphi VMT 布局版本差异、Itanium RTTI 布局、PE `CheckSum` 的加载期作用、`DF_1_PIE` 判据）
- Produces: 四技能的判定规则修正

- [ ] **Step 1: re-format-pe** — Delphi VMT 负偏移表按版本分开（经典 vs XE2+），或改为「以自指指针双向校验为主、偏移仅作候选」；「死导入检测」不再由「IAT 项未被 `.text` 直接引用」单向推导动态解析，改为列出多因并给出区分判据
- [ ] **Step 2: re-cpp-abi** — `std::type_info` 布局不写死位宽；lambda closure type 的 RTTI 表述改为「按需发射」，明确「缺 `_ZTI` 不能排除 lambda」，并与步骤 5、坑项两处对齐
- [ ] **Step 3: re-unpack-simple** — 把 `CheckSum` 从「与 `SizeOfImage`/`NumberOfSections` 并列的加载失败原因」中拆出，写明各自的实际作用域
- [ ] **Step 4: re-triage** — PIE 判定补 `DF_1_PIE`（`readelf -d`）判据，删除「`ET_DYN` = PIE」的直接映射
- [ ] **Step 5: 验证** — `node validate.mjs`；`npm test` 全绿
- [ ] **Step 6: 回填** — `node bin/auditstate.mjs update re-format-pe re-cpp-abi re-unpack-simple re-triage`
- [ ] **Step 7: Commit** — `fix: 格式判定 4 技能——Delphi VMT / RTTI 与 lambda / PE CheckSum / PIE 判据`

### Task 8: CPU/ISA 组（re-arm / re-mips / re-riscv / re-console / re-tee）

**Files:**
- Modify: `.claude/skills/re-arm/SKILL.md`
- Modify: `.claude/skills/re-mips/SKILL.md`
- Modify: `.claude/skills/re-riscv/SKILL.md`
- Modify: `.claude/skills/re-console/SKILL.md`
- Modify: `.claude/skills/re-tee/references/gotchas.md`

**Interfaces:**
- Consumes: Task 1 判定表（Armv6-M 实际指令集、AAPCS32/64 的 Thumb 位规则、MIPS Branch Likely 的 annul 语义、RISC-V binutils 包名、SM83 ISA、SMCCC 调用约定）。**RISC-V 入口定位一条已驳回，不在本任务范围**、Task 3 的 binwalk 源侧结论
- Produces: 五处 ISA/ABI 判定修正；re-arm / re-mips / re-console 的 binwalk 副本指回 `[[re-fw-extract]]`

- [ ] **Step 1: re-arm** — 删除「Cortex-M0/M0+ 只有 16 位 Thumb」及「32 位指令是反汇编幻觉」的表述，按 Armv6-M 实际指令集改写（三处：变体说明、BL 距离、坑项）；虚表函数指针的 Thumb 位规则限定到 AArch32 并写明 AAPCS64 下的差异（两处）
- [ ] **Step 2: re-mips** — 延迟槽不再写成「无条件执行」，补 Branch Likely 的 annul/nullify 语义（步骤 + 坑项两处）
- [ ] **Step 3: re-riscv** — 只改一处：binutils 安装与验证命令一一对应（装 `binutils-riscv64-linux-gnu` 就验 `riscv64-linux-gnu-objdump`；需要裸机 triplet 则单列 `binutils-riscv64-unknown-elf`）。**入口定位那句不改**——判定表 F052 驳回：该句本身已写「动态链接程序先经 ld.so（PT_INTERP）」，`gdb starti /bin/ls` 实测首条指令确在 ld.so
- [ ] **Step 4: re-console** — SM83 不再描述成 Z80 变体，删除「用 Z80 近似」的默认路径，改为专用 SM83 language/loader 或明确标注近似；与同文件坑项对齐
- [ ] **Step 5: re-tee** — `HVC`/`SMC` 不再简化成「EL2 用 HVC、EL3 用 SMC」，按调用者 EL 与目标 EL 拆开（并检查 x1–x17 的 SMCCC 版本限定）
- [ ] **Step 6: binwalk 副本** — re-arm / re-mips / re-console 三处改写为引用 `[[re-fw-extract]]` 的安装矩阵，删除各自复制的 `pip install binwalk` 比较性描述
- [ ] **Step 7: 验证** — `node validate.mjs`；`npm test` 全绿
- [ ] **Step 8: 回填** — `node bin/auditstate.mjs update re-arm re-mips re-riscv re-console re-tee`
- [ ] **Step 9: Commit** — `fix: CPU/ISA 判定 5 技能——Armv6-M / Thumb 位 / MIPS 延迟槽 / RISC-V binutils / SM83 / SMCCC`

### Task 9: 调用约定组（re-shellcode / re-pwn）

**Files:**
- Modify: `.claude/skills/re-shellcode/SKILL.md`
- Modify: `.claude/skills/re-pwn/SKILL.md`

**Interfaces:**
- Consumes: Task 1 判定表（x86-64 SysV 栈对齐的准确条件、`%N$` 参数槽语义、Windows x86 调用约定现状）、Task 3 的 binwalk 源侧结论
- Produces: 三处调用约定/栈布局修正

- [ ] **Step 1: re-shellcode** — 删除「Win32 默认 stdcall」的概括，按实际（编译器/调用约定声明）改写；binwalk 副本指回 `[[re-fw-extract]]`
- [ ] **Step 2: re-exploit — 栈对齐不改**（判定表 F111 驳回）。仓库「`call` 时 `$rsp % 16 == 0`」与 psABI 原文 "immediately before the call instruction is executed" 逐字对应；探针实测 `call printf` 前 `rsp%16==0` 正常、`==8` 触发 `movaps` SIGSEGV，`ret` 转移场景同样成立。本技能本波**无改动项**
- [ ] **Step 3: re-pwn** — `%N$...` 的参数槽描述改为「第 N 个位置参数（前若干走寄存器）」，删除自相矛盾的注释；**pwntools 版本保持现状**（判定表已驳回，勿改）
- [ ] **Step 4: 验证** — `node validate.mjs`；`npm test` 全绿
- [ ] **Step 5: 回填** — `node bin/auditstate.mjs update re-shellcode re-pwn`
- [ ] **Step 6: Commit** — `fix: 调用约定 2 技能——stdcall / printf 参数槽`

### Task 10: Frida 组（re-frida / re-frida-script-author）

**Files:**
- Modify: `.claude/skills/re-frida/SKILL.md`
- Modify: `.claude/skills/re-frida/references/frida-scripts.md`（如涉及）
- Modify: `.claude/skills/re-frida-script-author/SKILL.md`

**Interfaces:**
- Consumes: Task 1 判定表（Objection 当前 CLI 形态、Frida host 与 frida-server 的实际兼容规则、Frida 17 Java bridge 的实际情况）
- Produces: Frida 工具链用法与版本兼容表述修正

- [ ] **Step 1: Objection** — 启动命令按当前版本更新（两处）；安装说明补 Python 下限或指向官方要求
- [ ] **Step 2: 版本兼容** — 删除「host 与 frida-server 版本必须完全一致」，按实际的兼容规则（major 一致 + 官方兼容矩阵）改写，协议错误不再单一归因版本号
- [ ] **Step 3: Java bridge** — 修正 Frida 17 后 Java bridge 的获取方式描述
- [ ] **Step 4: re-frida-script-author** — 删除/限定发行版包管理器作为 Frida CLI 等价安装方式的表述（注明非 upstream 渠道）
- [ ] **Step 5: 验证** — `node validate.mjs`；`npm test` 全绿
- [ ] **Step 6: 回填** — `node bin/auditstate.mjs update re-frida re-frida-script-author`
- [ ] **Step 7: Commit** — `fix: Frida 工具链 2 技能——Objection / 版本兼容 / Java bridge / 安装渠道`

### Task 11: iOS 组（re-ios / re-ios-jb）

**Files:**
- Modify: `.claude/skills/re-ios/SKILL.md`
- Modify: `.claude/skills/re-ios/references/gotchas.md` + `references/commands.md`
- Modify: `.claude/skills/re-ios-jb/SKILL.md`（引用点同步）

**Interfaces:**
- Consumes: Task 1 判定表（FairPlay 解密方案的当前实践、越狱工具与 iOS 版本对应关系）
- Produces: 脱壳路径改写 + 越狱矩阵更新

- [ ] **Step 1: 脱壳路径** — 原版 `frida-ios-dump` 从默认工具准备路径降级为 legacy/参考实现（写明所需 Frida 世代），默认流程改为按目标 iOS/jailbreak 选择当前适配的维护实现；删除「clone → pip install → 直接运行」的当前安装路径。**与 Task 10 的 Frida 版本结论保持一致**
- [ ] **Step 2: 越狱矩阵** — `references/gotchas.md` 的 unc0ver 版本范围按当前实际更新
- [ ] **Step 3: 引用点同步** — `re-ios-jb/SKILL.md` 中指向脱壳步骤的三处同步；`references/commands.md` 的工具族说明同步
- [ ] **Step 4: 验证** — `node validate.mjs`；`npm test` 全绿
- [ ] **Step 5: 回填** — `node bin/auditstate.mjs update re-ios re-ios-jb`
- [ ] **Step 6: Commit** — `fix: iOS 脱壳路径与越狱矩阵 2 技能`

### Task 12: 工具用法组（re-ida / re-gdb / re-patching / re-binaryninja）

**Files:**
- Modify: `.claude/skills/re-ida/SKILL.md` + `references/commands.md`
- Modify: `.claude/skills/re-gdb/SKILL.md`
- Modify: `.claude/skills/re-patching/SKILL.md`
- Modify: `.claude/skills/re-binaryninja/SKILL.md` + `references/gotchas.md`

**Interfaces:**
- Consumes: Task 1 判定表（IDA 无头可执行文件名、Pwndbg 当前安装方式、`pesign` 的删除签名用法、Binary Ninja 当前主版本与其 Python/扩展系统变化）
- Produces: 四处工具用法修正；re-ida 的传播面（`re-plugin-dev` / `re-deobfuscate` / `re-license`）以引用方式收敛

- [ ] **Step 1: re-ida** — 无头模式命令按实际可执行文件名与参数改写；**传播面**：`re-plugin-dev`、`re-deobfuscate`、`re-license` 三处不再各自复制命令，改为引用 `[[re-ida]]`
- [ ] **Step 2: re-gdb** — Pwndbg 安装方式按当前官方推荐更新；`re-pwn` 的引用说明同步（**注意与 Task 9 的文件集边界：`re-pwn/SKILL.md` 归 Task 9，本任务只改 `re-gdb`**，如需改 re-pwn 则在 Task 9 完成后再单独提一条修正）
- [ ] **Step 3: re-patching** — `pesign` 删除签名的正确用法
- [ ] **Step 4: re-binaryninja** — 版本说明按当前主版本与其 Python/扩展系统变化更新
- [ ] **Step 5: 验证** — `node validate.mjs`；`npm test` 全绿
- [ ] **Step 6: 回填** — `node bin/auditstate.mjs update re-ida re-gdb re-patching re-binaryninja`
- [ ] **Step 7: Commit** — `fix: 工具用法 4 技能——IDA 无头 / Pwndbg / pesign / Binary Ninja`

### Task 13: rizin 副本同步组（re-deobfuscate / re-unpack-advanced / re-variant / re-license / re-imports）

**Files:**
- Modify: `.claude/skills/re-deobfuscate/SKILL.md`
- Modify: `.claude/skills/re-unpack-advanced/SKILL.md`
- Modify: `.claude/skills/re-variant/SKILL.md`
- Modify: `.claude/skills/re-license/SKILL.md`
- Modify: `.claude/skills/re-imports/SKILL.md`

**Interfaces:**
- Consumes: **Task 2 的 rizin 安装矩阵**（本任务不得自行发明发行版结论）
- Produces: 五个副本收敛为引用 `[[re-radare2]]`；同仓库对 rizin 安装的结论归一

- [ ] **Step 1: 逐个改写** — 删除本地复制的 `apt install rizin` 矩阵，改为引用 `[[re-radare2]]` 的安装矩阵；`re-license` 作为替代工具入口的说明同步
- [ ] **Step 2: re-deobfuscate 的绑定** — 同一文件内 Rizin 自动化驱动改用 Rizin 侧绑定（`rzpipe`），删除 `r2pipe` 作为 Rizin 驱动方式的表述（三处）
- [ ] **Step 3: 验证** — `grep -rn "apt install rizin" .claude/skills/` 应只剩 `re-radare2` 内的说明性提及；`npm test` 全绿
- [ ] **Step 4: 回填** — `node bin/auditstate.mjs update re-deobfuscate re-unpack-advanced re-variant re-license re-imports`
- [ ] **Step 5: Commit** — `fix: rizin 安装五处副本收敛到 re-radare2 单一事实源`

### Task 14: 取证与固件组（re-rtos / re-packer-id / re-memdump / re-mem-forensics / re-fw-emulate / re-dotnet）

**Files:**
- Modify: `.claude/skills/re-rtos/SKILL.md`
- Modify: `.claude/skills/re-packer-id/SKILL.md`
- Modify: `.claude/skills/re-memdump/SKILL.md`
- Modify: `.claude/skills/re-mem-forensics/SKILL.md`
- Modify: `.claude/skills/re-fw-rootfs/SKILL.md`（同源 p7zip 行）
- Modify: `.claude/skills/re-fw-emulate/references/gotchas.md`
- Modify: `.claude/skills/re-dotnet/SKILL.md`

**Interfaces:**
- Consumes: Task 1 判定表（gcore 的适用边界、Volatility 2 的归档状态、qemu-system 的默认网络行为、Arch 包名现状）、Task 3 的 binwalk 源侧结论
- Produces: 六处取证/仿真类修正

- [ ] **Step 1: re-rtos / re-packer-id** — binwalk 副本指回 `[[re-fw-extract]]`
- [ ] **Step 2: re-memdump** — 默认转储方式改为符合平台经验的方案（gcore 的适用边界写明），传播面（`re-analyze/references/platform-tips.md`、`re-forensics`、`re-loader`）一并核对；Volatility 2 标注为已归档的兼容分支而非等价「按需」选项
- [ ] **Step 3: re-mem-forensics / re-fw-rootfs** — 7-Zip 包名按当前发行版现状（两处同源行一并处理）
- [ ] **Step 4: re-fw-emulate** — 删除「qemu-system 默认 `-net none`」的前提，改为按实际默认行为给隔离建议
- [ ] **Step 5: re-dotnet** — Arch 的 Mono 安装说明按当前官方仓库状态
- [ ] **Step 6: 验证** — `node validate.mjs`；`npm test` 全绿
- [ ] **Step 7: 回填** — `node bin/auditstate.mjs update re-rtos re-packer-id re-memdump re-mem-forensics re-fw-emulate re-dotnet`
- [ ] **Step 8: Commit** — `fix: 取证与仿真 6 技能——转储方式 / Volatility 2 / 包名 / qemu 网络 / Mono`

### Task 15: 协议与加密组（re-tls / re-proto-rev / re-crypto-decrypt / re-crypto-id / re-apk）

**Files:**
- Modify: `.claude/skills/re-tls/SKILL.md`
- Modify: `.claude/skills/re-proto-rev/SKILL.md`
- Modify: `.claude/skills/re-crypto-decrypt/SKILL.md`
- Modify: `.claude/skills/re-crypto-id/SKILL.md`
- Modify: `.claude/skills/re-apk/references/gotchas.md` + `references/commands.md`

**Interfaces:**
- Consumes: Task 1 判定表（TLS 1.3 的 ALPN 落点、TCP 字节流与应用层消息的边界、JPEG/PNG 结束标记的实际行为、分组/流密码的可区分特征、zipalign 与签名方案的当前关系）
- Produces: 五处协议/加密判定修正

- [ ] **Step 1: re-tls** — ALPN 最终协商结果的落点按 RFC 改写（TLS 1.3 与 1.2 分开表述）
- [ ] **Step 2: re-proto-rev** — 流程中补 TCP 流重组与应用层 framing 阶段，不再把 segment payload 当 message（步骤与示例同步）
- [ ] **Step 3: re-crypto-decrypt** — 结束标记的取法改为按格式规范（JPEG 需处理嵌入缩略图等情形），删除「第一个 vs 最后一个」的简化断言；`re-fw-extract` 内的同源表述一并核对（**注意文件集：如需改 `re-fw-extract` 则在 Task 3 已完成的基础上追加，勿与其他任务并发**）
- [ ] **Step 4: re-crypto-id** — 删除「按分组对齐区分分组/流密码」的决策规则，改为多判据并列（并说明反例）
- [ ] **Step 5: re-apk** — zipalign 与 v1/v2/v3 的关系按当前构建工具链实际行为改写（两处）
- [ ] **Step 6: 验证** — `node validate.mjs`；`npm test` 全绿
- [ ] **Step 7: 回填** — `node bin/auditstate.mjs update re-tls re-proto-rev re-crypto-decrypt re-crypto-id re-apk`
- [ ] **Step 8: Commit** — `fix: 协议与加密 5 技能——ALPN / TCP 重组 / 结束标记 / 密码分组 / zipalign`

### Task 16: 杂项组（re-go / re-android-native / re-ebpf / re-automotive / re-emulation）

**Files:**
- Modify: `.claude/skills/re-go/SKILL.md`
- Modify: `.claude/skills/re-android-native/SKILL.md` + `references/probes.md`
- Modify: `.claude/skills/re-ebpf/SKILL.md`
- Modify: `.claude/skills/re-automotive/SKILL.md`
- Modify: `.claude/skills/re-emulation/references/gotchas.md`

**Interfaces:**
- Consumes: Task 1 判定表（`LD_PRELOAD` 对 Go 程序的实际边界、`crypto/cipher.NewGCM` 的参数语义、JNI 函数表的规范布局、eBPF helper 号的稳定性、UDS 下载流程的实际状态机形态、Capstone 当前版本形态）
- Produces: 五处修正；**消除 re-android-native 的槽位自相矛盾**

- [ ] **Step 1: re-go** — `LD_PRELOAD` 条目按实际边界改写（Go 静态链接与否、`cgo` 参与时的差异），不再绝对化；加密密钥定位不再把 `NewGCM` 的第一个参数当 AES 密钥
- [ ] **Step 2: re-android-native** — `RegisterNatives` 等槽位按 JNI 规范的固定布局表述（写明 index 与「byte offset = index × 指针宽度」的换算），删除「槽号随 jni.h/NDK/ART 漂移」的建模；`references/probes.md` 的探测策略相应改为「确认 `JNIEnv*` 有效性 / hook 表检测 / 非标准实现」，与 `references/experience.md` 已写死的槽位值对齐
- [ ] **Step 3: re-ebpf** — helper 号的稳定性按规范改写（枚举为追加式，不以"漂移"描述），保留「以内核源码为准」的核对建议
- [ ] **Step 4: re-automotive** — UDS 下载流程不再写成固定四步序列，按实际可选路径（含 `0x31`/`0x37` 的变体）表述。**udsoncan 示例保持现状**（判定表已驳回，勿改）
- [ ] **Step 5: re-emulation — 不改**（判定表 F080 驳回）。PyPI 稳定版仍是 5.0.9，6.x 仅有 `6.0.0a1–a11` 预发行，仓库「当前 5.0.x」准确。6.0.0 正式发行后再复核
- [ ] **Step 6: 验证** — `node validate.mjs`；`npm test` 全绿
- [ ] **Step 7: 回填** — `node bin/auditstate.mjs update re-go re-android-native re-ebpf re-automotive re-emulation`
- [ ] **Step 8: Commit** — `fix: 杂项 4 技能——LD_PRELOAD / JNI 槽位 / eBPF helper / UDS 流程`

### Task 17: 运行时基线（Node）

**Files:**
- Modify: `package.json`（`engines.node`）
- Modify: `CLAUDE.md`
- Modify: `bin/wxsource.mjs`（注释中的版本表述）
- Modify: 其余 `>=18` 表述所在文件（先 `grep -rn ">=18" --include="*.md" --include="*.json" --include="*.mjs" .` 确认全集；`docs/superpowers/`、`analysis/` 为存档/本地产物，不改）

**Interfaces:**
- Consumes: Task 1 判定表（当前受支持 LTS 与 EOL 版本表）
- Produces: 全库运行时基线统一

- [ ] **Step 1: 定基线** — 按判定表结论提升 `engines.node`；同步文档表述与安装器/CI 的前置检查（如存在）
- [ ] **Step 2: 一致性** — `grep` 确认无残留旧基线；确认无代码依赖新基线以下版本才有的特性说明
- [ ] **Step 3: 验证** — `npm test` 全绿（本机 Node 版本需满足新基线）
- [ ] **Step 4: Commit** — `chore: 运行时基线提升——engines.node 与文档同步`

### Task 18: 终审波（断言 + 回填 + 审查记录）

**Files:**
- Modify: `tests/audit-regressions.test.mjs`（新增本波回归断言）
- Modify: `docs/audit/review-state.json`（Task 2-17 未回填项补齐）
- Modify: `docs/audit/2026-09-13-factual-audit.md`（追加「补充 34：监控报告对账波——落地与固化」）
- Modify: `docs/audit/tool-register.json`（如本波涉及工具的使用点/核验状态变化，跑 `node bin/toollife.mjs check` 后同步）

**Interfaces:**
- Consumes: Task 2-17 全部完成
- Produces: 回归断言、审查记录、状态回填闭环

- [ ] **Step 1: 补回归断言**

按仓库既有 `absent` / `present` 助手（注意 `NEGATION` 词表——迁移说明会刻意写出旧写法）为本波每条采纳项加断言：错的说法不得写回、修正后的表述必须在位。**每条断言注释里写明对应的判定表条目**（不含日期戳进技能内容，注释在测试文件内不受「技能不写审查历史」约束）。
- [ ] **Step 2: 变异测试** — 抽查 3-5 条：把技能写回旧表述，断言应精准失败；还原后全过（仓库既有做法，防止断言空转）
- [ ] **Step 3: 全库审查** — `node validate.mjs` → `OK: 122 skills validated`；`node bin/capindex.mjs --check`；`node bin/toollife.mjs check`；`node bin/probelist.mjs --check`；`npm test` 全绿

  顺带修正一处既有计数漂移：`CLAUDE.md:45` 写「`npm test` = validate + **103** 项测试」，实际为 132 项（`tests/counts.test.mjs` 覆盖了技能计数但未覆盖测试计数）。改为实际值，并按仓库「把约定变成检查」的做法把该计数纳入 `counts.test.mjs`。
- [ ] **Step 4: 红线对照** — 抽查本波改动文件：无强推措辞、无对话残留（`filecite`、模型署名、日期戳、finding 编号）、无 emoji
- [ ] **Step 5: 回填与记录** — `node bin/auditstate.mjs status` 确认无遗漏；审查记录追加到 `docs/audit/`
- [ ] **Step 6: Commit** — `fix: 审查修复波——监控报告对账落地（回归断言 + 记录固化）`

---

**最终验证**：`node validate.mjs` → `OK: 122 skills validated`；`npm test` 全绿（现有 103 项 + 本波新增断言）；`git log` 含本计划全部任务 commit；`node bin/auditstate.mjs status` 显示本波技能均为「已复核未变」。

**收尾提醒**：C 类 3 条（udsoncan `ClientConfig`、pwntools 4.15.0、Capstone 6）**不得**出现在任何 `fix:` 提交里——判定表已给出驳回证据，改动它们属于把正确内容改错。回归断言中应包含「这些正确表述不得被改错」的守护项（参照既有补充 30 的做法）。
