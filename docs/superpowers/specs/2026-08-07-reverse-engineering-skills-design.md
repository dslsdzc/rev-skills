# 设计：逆向工程技能库（aihk）

日期：2026-08-07
状态：已批准

## 1. 背景与目标

构建一个**通用、可发布**的逆向工程 AI 技能库，存放于 `/home/DslsDZC/aihk` 仓库。

- **场景覆盖**：恶意软件分析、CTF 逆向、固件/嵌入式、软件破解/脱壳、协议逆向、移动应用逆向（全部方向）
- **平台覆盖**：Windows PE、Linux ELF、macOS Mach-O、固件/嵌入式多架构、Android/iOS
- **通用性要求**：技能不能假设用户已安装任何工具——每个技能必须含跨 OS 安装指引
- **发布形式**：GitHub 仓库直发 + npm（`npx` 安装器）+ Claude Code 插件市场（三者兼顾）
- **多工具适配**：Claude Code、Gemini CLI、Cline、Codex CLI（原生 SKILL.md）；Cursor、GitHub Copilot、Windsurf（规则文件转换）

## 2. 架构：三层技能体系

### 2.1 第 1 层 — 入口（1 个）

`re-analyze`：唯一分析入口。流程：**环境探测 → 偏好询问 → 任务识别 → 编排分派**。

**① 环境探测（自动，`references/probe.sh`）**：

- **OS 平台**：Linux / macOS / Windows / WSL（`uname -s` + WSL 检测）——决定后续一切工具选择与平台经验分支
- **硬件**：CPU 架构（`uname -m`）、核心数（`nproc`）、内存总量（`free -g`）——用于评估工具可行性（Ghidra 建议 ≥4GB 可用内存；angr 符号执行吃内存；QEMU 仿真按架构选内核）
- **已装逆向工具**：`which` 探测 ghidra / ida / radare2 / gdb / frida / binwalk / qemu / jadx / angr / z3 等清单——**仅作可选优化**：探测到已装工具则优先使用；**默认假设空白环境（用户机器无任何已装工具）**，未探测到工具时按对应技能的「工具准备」章节引导安装，绝不因"没装"而卡住流程
- 探测失败（如 Windows 无 `uname/free`）→ 退化为向用户询问硬件情况

**② 偏好询问（用户选择，问题集在 `references/preferences.md`）**：

| 问题 | 选项 | 说明 |
|---|---|---|
| **分析目标** | 用户自然语言描述 | **必答、第一项**：想达成什么（判定恶意行为 / 脱壳拿干净样本 / 找密钥或注册码 / 还原算法 / 确认漏洞 / 提取配置……）——决定整个编排路径与产出形态 |
| 反编译器选择 | IDA / Ghidra / radare2 / **自动推荐** | 推荐依据：免费 vs 商业、平台支持、内存可行性——**不是已装哪个**（通用场景默认没装任何工具） |
| 分析深度 | 快速结论 / 标准分析 / 深度报告 | 决定走哪条流程路径与产出规模 |
| 输出报告 | 要 / 不要 | 决定是否走报告流程（IOC/YARA 等） |
| 平台确认 | 自动识别 / 手动指定 | 文件存在时自动识别为主 |

询问顺序：**目标描述优先**（第一问），其后是反编译器、深度、报告、平台确认。目标决定 `triage.md` 决策表选择哪条编排路径；目标不明确时，入口追问直到可执行（如"想确认这个样本会不会回连"→ 编排：沙箱 → 行为 → netcap → 报告）。

**反编译器选择依据**（写入 `references/preferences.md`，不依赖已装工具）：

- **Ghidra**：免费开源、跨平台（Win/Linux/macOS）、Linux 最顺——**通用场景默认推荐**
- **IDA**：商业付费（有 7.x 免费版）、Windows 生态最强、插件丰富——用户明确选或目标为 Windows 闭源软件时推荐
- **radare2/rizin**：命令行轻量、终端友好、脚本化强——内存紧张或 CLI 工作流时推荐
- 内存 <4GB → 提示 Ghidra 可能吃力，建议轻量工具（radare2）或先加内存

偏好询问**一次完成**，结果存入会话变量，贯穿本次分析全程——被调用的子技能读取该状态（如用户选 Ghidra → 所有反编译步骤直接走 `re-ghidra` 工作流；未装该工具 → 先执行其「工具准备」安装步骤）。

**③ 任务识别与编排**：根据输入（文件路径 / 描述 / 请求）判断任务类型，查 `references/triage.md` 决策表，编排调用大类网关。复合任务（命中多个大类）按依赖顺序串联。

### 2.2 第 2 层 — 大类网关（8 个，独立）

按学科划分，**互不合并**；大类之间的联合通过跨网关引用（`[[链接]]`）实现。

| 网关 | 学科 | 核心职责 |
|---|---|---|
| `re-binary-core` | 软件逆向核心 | 公共底座：格式、反编译、调试器、静态/动态通用技术 |
| `re-malware` | 恶意软件分析 | 沙箱、行为分析、IOC/YARA、报告（`re-sandbox` 为动态分析强制前置） |
| `re-firmware` | 固件/嵌入式/硬件 | 固件提取、rootfs、QEMU 仿真、JTAG/UART |
| `re-protocol` | 协议逆向 | 流量捕获、状态机重建、加密识别/密钥/解密 |
| `re-mobile` | 移动应用 | APK、iOS、Frida |
| `re-anti-analysis` | 反分析对抗 | 壳识别、脱壳（简单/高级）、反混淆 |
| `re-cracking` | 软件破解 | 授权逻辑、补丁、注册机 |
| `re-ctf` | CTF 实践 | angr、Z3 |

每个网关 SKILL.md 必含三部分：**该大类完整工作流**、**何时用哪个原子技能（选择树）**、**跨域联合章节**。

### 2.3 第 3 层 — 原子技能（37 个）

| 大类 | 原子技能 |
|---|---|
| `re-binary-core` | `re-triage`、`re-format-pe`、`re-format-elf`、`re-format-macho`、`re-imports`、`re-ghidra`、`re-ida`、`re-radare2`、`re-gdb`、`re-x64dbg`、`re-lldb`、`re-tracing`、`re-memdump` |
| `re-malware` | `re-sandbox`、`re-behavior`、`re-ioc` |
| `re-firmware` | `re-fw-extract`、`re-fw-rootfs`、`re-fw-emulate`、`re-hardware-io` |
| `re-protocol` | `re-netcap`、`re-proto-rev`、`re-crypto-id`、`re-crypto-keys`、`re-crypto-decrypt` |
| `re-mobile` | `re-apk`、`re-ios`、`re-frida` |
| `re-anti-analysis` | `re-packer-id`、`re-unpack-simple`、`re-unpack-advanced`、`re-deobfuscate` |
| `re-cracking` | `re-license`、`re-patching`、`re-keygen` |
| `re-ctf` | `re-angr`、`re-z3` |

总数：**1 入口 + 8 网关 + 37 原子 = 46 技能**。

### 2.4 跨大类引用机制

大类独立、任务联合。已知联合场景（写进各网关的「跨域联合」章节）：

| 联合场景 | 主大类 → 引用 |
|---|---|
| 恶意样本加壳 | `re-malware` → `re-anti-analysis`（packer-id / unpack-*） |
| C2 通信分析 | `re-malware` → `re-protocol`（netcap / proto-rev / crypto-*） |
| 破解先脱壳 | `re-cracking` → `re-anti-analysis` |
| 移动 App 含原生库 | `re-mobile` → `re-binary-core`（format-elf / ghidra） |
| 固件通信协议 | `re-firmware` → `re-protocol` |
| CTF 题 = 核心技能应用 | `re-ctf` → `re-binary-core` |

落地方式：
1. 每个网关 SKILL.md 含「跨域联合」章节，声明引用场景与顺序（引用即 `[[链接]]`，被引用技能按需加载）
2. `re-analyze/references/triage.md` 决策表处理复合任务编排（如"脱壳 → 静态 → 动态 → C2 协议 → 报告"）

## 2.5 平台经验知识库（`re-analyze/references/platform-tips.md`）

每个技能的工具准备与操作步骤按 **OS 分支**给出方案；跨大类共享的平台经验沉淀在入口的 `platform-tips.md`，被所有技能引用。初始内容（实战经验，后续扩充）：

| 平台 | 场景 | 经验方案 |
|---|---|---|
| **所有平台** | **运行任何样本/动态分析** | **默认沙箱，强制前置**：虚拟机快照 / 容器（Docker、firejail）/ 专用沙箱（Cuckoo/CAPE）；网络隔离（INetSim、fake DNS、断网）。样本可能已被污染或含攻击行为——**静态分析可免沙箱，一切动态执行默认在沙箱内**，分析结束后恢复快照。此原则优先于本表所有其他条目 |
| **Linux** | 分析 Windows PE 程序 | **Wine 直读进程内存**：wine 运行 PE → `gdb attach` 或读 `/proc/<pid>/mem`——**无需整机虚拟化**；脱壳/读内存直接对 Wine 进程操作。比 QEMU 全套虚拟化轻一个量级 |
| **Linux** | 跑非本机架构程序 | QEMU 用户态仿真（`qemu-<arch>`）优先，全系统仿真仅必要时用 |
| **Linux** | **内存转储的极端段** | `[vsyscall]`（固定地址 `0xffffffffff600000`，只执行 `--xp`）、`[vdso]`/`[vvar]`：`/proc/<pid>/mem` 读取会失败，gdb 访问报错属正常。**转储前必须按 `/proc/<pid>/maps` 过滤这些段**（只 dump `r--p`/`rw-p` 可读映射），否则 dump 含垃圾页、脱壳/分析全被污染。识别特征：`maps` 中 `[vsyscall]`/`[vdso]`/`[vvar]` 名称、地址落在 `0xffffffffff6xxxxx` 高段、无文件路径的匿名 `00:00` 映射 |
| **Windows** | 读目标进程内存 | 需装 Sysinternals 套件（`procdump`）/ `DumpIt` 做内存转储 + Volatility 分析；attach 需要管理员权限 |
| **macOS** | attach/调试 | SIP 与 TCC 限制：调试工具需授权（Developer Tools 权限），`lldb` attach 前检查 |
| **WSL** | 分析 Windows 侧目标 | WSL 无法直接 attach Windows 进程——跨边界的分析走 Windows 侧工具，WSL 内只做文件/静态分析 |

原则：**先给最轻的可行方案**（Wine 直读 > 用户态仿真 > 全系统虚拟化 > 物理机），按平台经验分支执行。

**「直读 vs 转储」决策**（`re-memdump` 等技能引用，依据实战与社区共识）：

**默认策略：转储优先。** 一次转储获得完整内存布局 + 寄存器/线程状态（ELF notes），可导入 Ghidra/IDA、可存档复现；后续所有定向提取（密钥搜索、脱壳段、DEX 挖掘）都从转储产物里做，进程状态被冻结后反复分析也不受干扰。

| 场景 | 方案 |
|---|---|
| **默认（任何需要读内存的任务）** | **转储** `gcore` → ELF core 文件；取证/存档场景用全量转储 + 映射清单（manifest） |
| 需要完整内存布局 + 寄存器/线程状态（导入 Ghidra/IDA、事后复现分析） | **转储** `gcore` → ELF core 文件（含 ELF notes） |
| 进程已死 | 直接分析已有 core 文件（`kernel.core_pattern` / systemd-coredump / 容器 runtime dump） |
| ptrace 被禁 / 沙箱容器 / attach 失败 | **转储兜底**：core 文件不需要 `/proc/<pid>/mem` 权限路径 |
| 特例①：进程必须保持运行、实时交互调试 | **直读** `/proc/<pid>/mem`：先读 `/proc/<pid>/maps` 确定有效地址范围 → SIGSTOP 暂停进程防竞态 → chunked `pread` 只取目标区段 |
| 特例②：只需极小特定区段且性能敏感（在线检查某地址） | **直读** 单区段，同上流程 |

关键经验：**转储时机**——脱壳须等进程运行到 OEP 完全解密后再 dump，否则转的是壳的初始状态；直读前必须先查 maps（无脑 open `/proc/<pid>/mem` 必然报错）；dump 前过滤 `[vsyscall]`/`[vdso]` 等特殊段（见上表）。

## 3. 技能统一模板

### 3.1 原子技能模板

```markdown
---
name: re-xxx
description: > 中英双语触发词 + 何时使用
---

# 技能名

## 何时使用 / 何时不用      ← 明确边界，避免误触发
## 工具准备                  ← 必含：每工具 apt/dnf/pacman/brew/pip/cargo/choco
                             ← 安装命令 + 验证命令
                             ← 按 OS 分支：Linux/macOS/Windows/WSL 各自的方案与替代工具
                             ← 优先引用 platform-tips.md 的平台经验
## 操作步骤                  ← 可执行、具体（沿用 porting-minecraft-mod 的硬性执行风格）
## 跨域联合                  ← 本技能在哪些复合任务中被其他大类引用
## 常见坑与陷阱
```

### 3.2 多工具兼容约束（保证转换无损）

- 正文纯 Markdown，不依赖任何工具私有语法
- frontmatter 标准 YAML，description 中英双语触发词
- 技能保持原子粒度 → 转换聚合后才有结构

## 4. 发布与安装机制

### 4.1 仓库结构

```
aihk/
├── AGENTS.md                        # 跨工具通用入口（Claude/Codex/Gemini/Cursor/Zed 都读）
├── README.md                        # 三种安装方式 + 多工具适配说明 + 技能目录导航
├── LICENSE                          # MIT
├── package.json                     # npm 包 re-skills，bin: re-skills → bin/install.mjs
├── bin/install.mjs                  # 安装器（--target 多工具）
├── bin/convert.mjs                  # 转换器：SKILL.md → Cursor/Copilot/Windsurf 规则格式
├── .claude-plugin/marketplace.json  # claude plugin add 支持
├── .claude/skills/                  # 46 个技能（标准结构）
│   └── re-analyze/
│       ├── SKILL.md                 # 入口：环境探测 → 偏好询问 → 任务识别 → 编排
│       ├── references/probe.sh      # OS/硬件与工具自动探测脚本
│       ├── references/preferences.md# 偏好问题集与默认值
│       ├── references/platform-tips.md # 平台经验知识库（Wine 直读/内存转储等）
│       └── references/triage.md     # 任务类型判定决策表
└── tests/validate.mjs               # 结构冒烟测试
```

### 4.2 安装器 --target 矩阵

| target | 安装位置 | 方式 |
|---|---|---|
| `claude` | `~/.claude/skills/` 或项目 `.claude/skills/` | 原样复制（原生） |
| `gemini` | `~/.gemini/skills/` | 原样复制（原生） |
| `cline` | 项目 `.claude/skills/` | 原样复制（原生兼容） |
| `codex` | `~/.codex/skills/` | 原样复制（原生） |
| `cursor` | `.cursor/rules/` | 转换 → `.mdc` |
| `copilot` | `.github/copilot-instructions.md` | 转换 → 聚合指令 |
| `windsurf` | `.windsurf/rules/` | 转换 → `.md` |
| `all` | 以上全部 | 混合 |

命令形式：`npx re-skills install`（交互）/ `--global` / `--project` / `--target <x>` / `--dry-run` / `uninstall`

安装器行为：
- 复制优先（符号链接在 Windows 需管理员权限；`--link` 可选）
- 自动跳过同名冲突技能并提示
- 安装后输出验证方法

### 4.3 兼容性边界（写入 README）

- **原生技能类**（Claude Code / Gemini CLI / Cline / Codex CLI / Zed）：完整技能体验，按需动态加载
- **规则文件类**（Cursor / Copilot / Windsurf）：获得"知识 + 流程"聚合，无按需加载
- 转换产物保证每个工具都能用于实际分析

### 4.4 转换器原理

`bin/convert.mjs`：解析 SKILL.md frontmatter + 正文，按目标工具模板生成规则文件——`.mdc` 带 YAML 头（description + globs）；Copilot 聚合为单文件纯 Markdown；Windsurf 每技能一文件。

## 5. 测试与发布验证

`tests/validate.mjs`（`npm test` 运行）校验：
1. 每个技能目录有 `SKILL.md` + 合法 frontmatter（name/description）
2. 所有 `[[链接]]` 指向仓库内真实存在的技能（防死链）
3. 每个技能含「工具准备」章节（通用性硬性检查）
4. 命名规范（`re-` 前缀）

发布流程：`npm test` 通过 → git tag → npm publish → 同步 marketplace.json 版本。

## 6. 成功标准

- 46 个技能全部通过 validate（合法 frontmatter、无死链、含工具准备）
- `probe.sh` 能输出 OS 平台 + CPU/内存/已装工具清单（Linux/macOS），Windows 下降级为询问；空白环境（无任何工具）时输出安装引导而非中断
- `platform-tips.md` 覆盖 5 个平台分支（Linux/macOS/Windows/WSL/跨平台），被至少 10 个技能引用
- `re-analyze` 完整走通"探测 → 偏好 → 识别 → 分派"，偏好状态能被子技能读取
- `npx re-skills install --target all --dry-run` 输出全部安装计划
- 转换器对每种规则类 target 生成产物成功
- README 完整覆盖三种安装方式与七种工具适配说明
