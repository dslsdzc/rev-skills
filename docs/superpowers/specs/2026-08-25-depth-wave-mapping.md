# 深度波映射表：技能 × 类型 × 分层（2026-08-25）

> 设计附录（design: `docs/superpowers/specs/2026-08-25-depth-wave-design.md` §2 分层判定、§3 类型-文件集映射与关键者规则）。本表由深度波实施计划任务 1 产出，是后续每个簇任务的成员与文件集依据。

## 0. 生成依据与方法

- 行数：`wc -l .claude/skills/*/SKILL.md` 实测（2026-08-25，任务执行时基线；中位 99 行，86-130 行 62 个（112 技能基线；re-arm 落地后 86-130 行 63 个）
- 分层判定（设计 §2）：T1 原子技能 <100 行；T2 100-130 行；T3 >130 行；网关 13 个（编排器，正文不动）。设计 §2 中 T1≈18/T3≈33 为约数，精确清单以本表为准
- 类型判定（设计 §3）：工具 / 格式 / 方法论 三类主类型；领域混合技能按主属性取主类型（场景为主取主类型；工具密集取工具类），最终类型直接决定文件集
- 关键者判定（设计 §2，仅 T2 内）：跨域引用数 ≥ 2（grep 全库 `[[链接]]` 引用图按网关子技能域归属计跨域，含网关与 triage 的引用；被网关子技能清单 / triage 路由直接引用的技能均已计入该数）
- v4 并行：任务执行时 v4 新技能 re-arm 已落地，纳入本表并标注「v4 新增」；其余 v4 技能（re-riscv/re-console/re-electron/re-javacard/re-ebpf）生成时未落地，落地后由 v4 接入。当前实测技能总数 113，`node validate.mjs` → `OK: 113 skills validated`
- 队列末尾（设计 §4.6）：re-rtos / re-behavior 深度产出放队列末尾（v4 落地后套用），分层与类型照常判定

## 1. 类型-文件集对照（设计 §3）

| 类型 | 文件集 | 内容骨架 |
|---|---|---|
| 工具 | `references/commands.md` + `references/gotchas.md` | 命令速查/操作序列；工具坑/版本差异 |
| 格式 | `references/layout.md` + `references/examples.md` | 结构图/字段表/布局偏移；解析示例/字节样例 |
| 方法论 | `references/decision-tree.md` + `references/gotchas.md` | 场景决策树/证据分级；方法论坑/边界 |
| 网关 | —（正文不动） | 编排器（re-analyze 已有 references/ 不动） |

## 2. 全量映射表

### 2.1 网关（13）

| 技能 | 行数 | 分层 | 类型 | 文件集 | 备注 |
|---|---|---|---|---|---|
| re-analyze | 84 | 网关 | 网关 | —（正文不动；re-analyze 已有 references/ 不动） |  |
| re-anti-analysis | 200 | 网关 | 网关 | —（正文不动；re-analyze 已有 references/ 不动） |  |
| re-binary-core | 152 | 网关 | 网关 | —（正文不动；re-analyze 已有 references/ 不动） |  |
| re-cracking | 62 | 网关 | 网关 | —（正文不动；re-analyze 已有 references/ 不动） |  |
| re-ctf | 67 | 网关 | 网关 | —（正文不动；re-analyze 已有 references/ 不动） |  |
| re-feedback | 57 | 网关 | 网关 | —（正文不动；re-analyze 已有 references/ 不动） |  |
| re-firmware | 49 | 网关 | 网关 | —（正文不动；re-analyze 已有 references/ 不动） |  |
| re-forensics | 54 | 网关 | 网关 | —（正文不动；re-analyze 已有 references/ 不动） |  |
| re-malware | 49 | 网关 | 网关 | —（正文不动；re-analyze 已有 references/ 不动） |  |
| re-managed | 58 | 网关 | 网关 | —（正文不动；re-analyze 已有 references/ 不动） |  |
| re-mobile | 62 | 网关 | 网关 | —（正文不动；re-analyze 已有 references/ 不动） |  |
| re-protocol | 65 | 网关 | 网关 | —（正文不动；re-analyze 已有 references/ 不动） |  |
| re-vuln | 68 | 网关 | 网关 | —（正文不动；re-analyze 已有 references/ 不动） |  |

### 2.2 T1（28，<100 行）

| 技能 | 行数 | 分层 | 类型 | 文件集 | 备注 |
|---|---|---|---|---|---|
| re-ai-attack | 72 | T1 | 方法论 | decision-tree.md + gotchas.md |  |
| re-attribution | 79 | T1 | 方法论 | decision-tree.md + gotchas.md |  |
| re-binaryninja | 82 | T1 | 工具 | commands.md + gotchas.md |  |
| re-browser-ext | 73 | T1 | 方法论 | decision-tree.md + gotchas.md |  |
| re-doc-malware | 93 | T1 | 方法论 | decision-tree.md + gotchas.md |  |
| re-drm | 92 | T1 | 格式 | layout.md + examples.md |  |
| re-format-macho | 93 | T1 | 格式 | layout.md + examples.md |  |
| re-fp-runtime | 73 | T1 | 格式 | layout.md + examples.md |  |
| re-frida-script-author | 86 | T1 | 方法论 | decision-tree.md + gotchas.md |  |
| re-hunting | 70 | T1 | 方法论 | decision-tree.md + gotchas.md |  |
| re-ida | 99 | T1 | 工具 | commands.md + gotchas.md |  |
| re-kernel | 87 | T1 | 方法论 | decision-tree.md + gotchas.md |  |
| re-keygen | 90 | T1 | 方法论 | decision-tree.md + gotchas.md |  |
| re-license | 98 | T1 | 方法论 | decision-tree.md + gotchas.md |  |
| re-lldb | 96 | T1 | 工具 | commands.md + gotchas.md |  |
| re-macos | 94 | T1 | 方法论 | decision-tree.md + gotchas.md |  |
| re-mobile-forensics | 74 | T1 | 方法论 | decision-tree.md + gotchas.md |  |
| re-nim | 63 | T1 | 格式 | layout.md + examples.md |  |
| re-radare2 | 97 | T1 | 工具 | commands.md + gotchas.md |  |
| re-rtos | 99 | T1 | 格式 | layout.md + examples.md | 深度产出放队列末尾（设计 §4.6，v4 落地后套用） |
| re-sdr | 80 | T1 | 工具 | commands.md + gotchas.md |  |
| re-stego | 80 | T1 | 方法论 | decision-tree.md + gotchas.md |  |
| re-swift | 80 | T1 | 格式 | layout.md + examples.md |  |
| re-tee | 99 | T1 | 方法论 | decision-tree.md + gotchas.md |  |
| re-variant | 74 | T1 | 方法论 | decision-tree.md + gotchas.md |  |
| re-windbg | 86 | T1 | 工具 | commands.md + gotchas.md |  |
| re-x64dbg | 85 | T1 | 工具 | commands.md + gotchas.md |  |
| re-zig | 69 | T1 | 格式 | layout.md + examples.md |  |

### 2.3 T2（49，100-130 行）

| 技能 | 行数 | 分层 | 类型 | 文件集 | 备注 |
|---|---|---|---|---|---|
| re-angr | 122 | T2 | 工具 | commands.md + gotchas.md | 关键者（跨域引用 4：grep 实测） |
| re-anti-cheat | 104 | T2 | 方法论 | decision-tree.md + gotchas.md | 非关键者（跨域引用 0） |
| re-apk | 118 | T2 | 工具 | commands.md + gotchas.md | 关键者（跨域引用 7：grep 实测） |
| re-arm | 129 | T2 | 格式 | layout.md + examples.md | v4 新增；非关键者（跨域引用 0） |
| re-behavior | 119 | T2 | 方法论 | decision-tree.md + gotchas.md | 深度产出放队列末尾（设计 §4.6，v4 落地后套用）；关键者（跨域引用 10：grep 实测） |
| re-cpp-abi | 104 | T2 | 格式 | layout.md + examples.md | 非关键者（跨域引用 1） |
| re-crash-triage | 127 | T2 | 方法论 | decision-tree.md + gotchas.md | 关键者（跨域引用 2：grep 实测） |
| re-crypto-decrypt | 118 | T2 | 方法论 | decision-tree.md + gotchas.md | 关键者（跨域引用 16：grep 实测） |
| re-crypto-keys | 122 | T2 | 方法论 | decision-tree.md + gotchas.md | 关键者（跨域引用 11：grep 实测） |
| re-deobfuscate | 124 | T2 | 方法论 | decision-tree.md + gotchas.md | 关键者（跨域引用 9：grep 实测） |
| re-dotnet | 122 | T2 | 格式 | layout.md + examples.md | 非关键者（跨域引用 1） |
| re-emulation | 106 | T2 | 工具 | commands.md + gotchas.md | 关键者（跨域引用 3：grep 实测） |
| re-evasion | 113 | T2 | 方法论 | decision-tree.md + gotchas.md | 关键者（跨域引用 4：grep 实测） |
| re-exploit | 129 | T2 | 方法论 | decision-tree.md + gotchas.md | 非关键者（跨域引用 1） |
| re-fileless | 116 | T2 | 方法论 | decision-tree.md + gotchas.md | 非关键者（跨域引用 0） |
| re-format-elf | 113 | T2 | 格式 | layout.md + examples.md | 关键者（跨域引用 14：grep 实测） |
| re-fw-emulate | 110 | T2 | 工具 | commands.md + gotchas.md | 关键者（跨域引用 5：grep 实测） |
| re-fw-rootfs | 124 | T2 | 方法论 | decision-tree.md + gotchas.md | 关键者（跨域引用 3：grep 实测） |
| re-gdb | 114 | T2 | 工具 | commands.md + gotchas.md | 关键者（跨域引用 20：grep 实测） |
| re-ghidra | 115 | T2 | 工具 | commands.md + gotchas.md | 关键者（跨域引用 47：grep 实测） |
| re-go | 120 | T2 | 格式 | layout.md + examples.md | 非关键者（跨域引用 0） |
| re-hardware-io | 107 | T2 | 工具 | commands.md + gotchas.md | 关键者（跨域引用 4：grep 实测） |
| re-harmonyos | 102 | T2 | 格式 | layout.md + examples.md | 非关键者（跨域引用 0） |
| re-hw-chip | 118 | T2 | 方法论 | decision-tree.md + gotchas.md | 关键者（跨域引用 2：grep 实测） |
| re-hypervisor | 120 | T2 | 方法论 | decision-tree.md + gotchas.md | 非关键者（跨域引用 0） |
| re-ics | 113 | T2 | 方法论 | decision-tree.md + gotchas.md | 非关键者（跨域引用 1） |
| re-imports | 117 | T2 | 格式 | layout.md + examples.md | 关键者（跨域引用 6：grep 实测） |
| re-ioc | 116 | T2 | 方法论 | decision-tree.md + gotchas.md | 关键者（跨域引用 28：grep 实测） |
| re-ios | 109 | T2 | 工具 | commands.md + gotchas.md | 关键者（跨域引用 4：grep 实测） |
| re-java | 118 | T2 | 格式 | layout.md + examples.md | 非关键者（跨域引用 1） |
| re-loader | 118 | T2 | 方法论 | decision-tree.md + gotchas.md | 非关键者（跨域引用 0） |
| re-mem-forensics | 106 | T2 | 工具 | commands.md + gotchas.md | 非关键者（跨域引用 1） |
| re-memdump | 121 | T2 | 工具 | commands.md + gotchas.md | 关键者（跨域引用 29：grep 实测） |
| re-mips | 115 | T2 | 格式 | layout.md + examples.md | 非关键者（跨域引用 0） |
| re-mobile-pack | 118 | T2 | 格式 | layout.md + examples.md | 非关键者（跨域引用 0） |
| re-netcap | 124 | T2 | 工具 | commands.md + gotchas.md | 关键者（跨域引用 13：grep 实测） |
| re-patching | 110 | T2 | 方法论 | decision-tree.md + gotchas.md | 关键者（跨域引用 5：grep 实测） |
| re-plugin-dev | 103 | T2 | 工具 | commands.md + gotchas.md | 非关键者（跨域引用 0） |
| re-python | 107 | T2 | 格式 | layout.md + examples.md | 关键者（跨域引用 3：grep 实测） |
| re-ransomware | 102 | T2 | 方法论 | decision-tree.md + gotchas.md | 非关键者（跨域引用 0） |
| re-rust | 117 | T2 | 格式 | layout.md + examples.md | 非关键者（跨域引用 0） |
| re-sandbox | 128 | T2 | 工具 | commands.md + gotchas.md | 关键者（跨域引用 48：grep 实测） |
| re-ti | 117 | T2 | 工具 | commands.md + gotchas.md | 关键者（跨域引用 2：grep 实测） |
| re-tracing | 106 | T2 | 工具 | commands.md + gotchas.md | 关键者（跨域引用 14：grep 实测） |
| re-unpack-advanced | 103 | T2 | 方法论 | decision-tree.md + gotchas.md | 关键者（跨域引用 5：grep 实测） |
| re-unpack-simple | 104 | T2 | 方法论 | decision-tree.md + gotchas.md | 关键者（跨域引用 5：grep 实测） |
| re-wasm | 121 | T2 | 格式 | layout.md + examples.md | 非关键者（跨域引用 1） |
| re-whitebox | 111 | T2 | 格式 | layout.md + examples.md | 非关键者（跨域引用 0） |
| re-z3 | 102 | T2 | 工具 | commands.md + gotchas.md | 关键者（跨域引用 4：grep 实测） |

### 2.4 T3（23，>130 行）

| 技能 | 行数 | 分层 | 类型 | 文件集 | 备注 |
|---|---|---|---|---|---|
| re-ai-model | 156 | T3 | 格式 | layout.md + examples.md |  |
| re-android-native | 146 | T3 | 方法论 | decision-tree.md + gotchas.md |  |
| re-automotive | 153 | T3 | 工具 | commands.md + gotchas.md |  |
| re-blockchain | 146 | T3 | 格式 | layout.md + examples.md |  |
| re-crypto-id | 137 | T3 | 格式 | layout.md + examples.md |  |
| re-disk-forensics | 147 | T3 | 方法论 | decision-tree.md + gotchas.md |  |
| re-flutter | 156 | T3 | 格式 | layout.md + examples.md |  |
| re-format-pe | 183 | T3 | 格式 | layout.md + examples.md |  |
| re-frida | 162 | T3 | 工具 | commands.md + gotchas.md |  |
| re-fuzzing | 153 | T3 | 方法论 | decision-tree.md + gotchas.md |  |
| re-fw-extract | 168 | T3 | 工具 | commands.md + gotchas.md |  |
| re-game | 205 | T3 | 工具 | commands.md + gotchas.md |  |
| re-hybrid-app | 183 | T3 | 格式 | layout.md + examples.md |  |
| re-ios-jb | 149 | T3 | 方法论 | decision-tree.md + gotchas.md |  |
| re-iot-proto | 208 | T3 | 格式 | layout.md + examples.md |  |
| re-packer-id | 132 | T3 | 方法论 | decision-tree.md + gotchas.md |  |
| re-proto-rev | 139 | T3 | 方法论 | decision-tree.md + gotchas.md |  |
| re-pwn | 141 | T3 | 方法论 | decision-tree.md + gotchas.md |  |
| re-script-deob | 153 | T3 | 方法论 | decision-tree.md + gotchas.md |  |
| re-shellcode | 184 | T3 | 方法论 | decision-tree.md + gotchas.md |  |
| re-tls | 135 | T3 | 格式 | layout.md + examples.md |  |
| re-triage | 143 | T3 | 工具 | commands.md + gotchas.md |  |
| re-uefi | 133 | T3 | 格式 | layout.md + examples.md |  |

## 3. 闭环核查

- 分层闭环：T1 28 + T2 49 + T3 23 + 网关 13 = 113 = 当前实测技能总数 113
- 类型闭环：工具 28 + 格式 30 + 方法论 42 + 网关 13 = 113 = 技能总数 113
- T2 关键者 29 个（跨域引用 ≥2，grep 实测）：re-angr, re-apk, re-behavior, re-crash-triage, re-crypto-decrypt, re-crypto-keys, re-deobfuscate, re-emulation, re-evasion, re-format-elf, re-fw-emulate, re-fw-rootfs, re-gdb, re-ghidra, re-hardware-io, re-imports, re-ioc, re-ios, re-memdump, re-netcap, re-patching, re-sandbox, re-ti, re-tracing, re-unpack-advanced, re-unpack-simple, re-z3, re-python, re-hw-chip
- T2 非关键者 20 个：re-anti-cheat, re-dotnet, re-exploit, re-fileless, re-go, re-hypervisor, re-ics, re-java, re-loader, re-mem-forensics, re-mobile-pack, re-plugin-dev, re-ransomware, re-rust, re-wasm, re-whitebox, re-cpp-abi, re-mips, re-harmonyos, re-arm
- 覆盖核查：本表行数 = 表内技能数 = 113（脚本从 `ls .claude/skills/` 生成，无遗漏无重复）

## 4. 簇任务提示（供后续任务引用）

- T1 批次：正文扩写至 ~130 行基线 + 2 个深度文件；簇按「类型 × 主题相邻」划分（如 re-rtos 与 re-tee 同固件簇；格式类 T1 有 format-macho/nim/zig/swift/fp-runtime/rtos 等）
- T2 批次：正文适度补强；关键者（29 个）配深度文件，非关键者（20 个）以正文补强为主
- T3 批次：只补深度文件（尚无者）
- 文件集命名对齐 frida-scripts.md 惯例；`[[链接]]` 目标 = 文件名去扩展名（validate 既有支持）
