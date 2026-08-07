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

`re-analyze`：唯一分析入口。根据输入（文件路径 / 描述 / 请求）判断任务类型，查 `references/triage.md` 决策表，编排调用大类网关。复合任务（命中多个大类）按依赖顺序串联。

### 2.2 第 2 层 — 大类网关（8 个，独立）

按学科划分，**互不合并**；大类之间的联合通过跨网关引用（`[[链接]]`）实现。

| 网关 | 学科 | 核心职责 |
|---|---|---|
| `re-binary-core` | 软件逆向核心 | 公共底座：格式、反编译、调试器、静态/动态通用技术 |
| `re-malware` | 恶意软件分析 | 沙箱、行为分析、IOC/YARA、报告 |
| `re-firmware` | 固件/嵌入式/硬件 | 固件提取、rootfs、QEMU 仿真、JTAG/UART |
| `re-protocol` | 协议逆向 | 流量捕获、状态机重建、加密识别/密钥/解密 |
| `re-mobile` | 移动应用 | APK、iOS、Frida |
| `re-anti-analysis` | 反分析对抗 | 壳识别、脱壳（简单/高级）、反混淆 |
| `re-cracking` | 软件破解 | 授权逻辑、补丁、注册机 |
| `re-ctf` | CTF 实践 | angr、Z3 |

每个网关 SKILL.md 必含三部分：**该大类完整工作流**、**何时用哪个原子技能（选择树）**、**跨域联合章节**。

### 2.3 第 3 层 — 原子技能（31 个）

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

总数：**1 入口 + 8 网关 + 31 原子 = 40 技能**。

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
                             ← 安装命令 + 验证命令 + 平台备注（Windows 替代方案）
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
├── .claude/skills/                  # 40 个技能（标准结构）
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

- 40 个技能全部通过 validate（合法 frontmatter、无死链、含工具准备）
- `npx re-skills install --target all --dry-run` 输出全部安装计划
- 转换器对每种规则类 target 生成产物成功
- README 完整覆盖三种安装方式与七种工具适配说明
