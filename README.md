# re-skills — 通用逆向工程 AI 技能库

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

64 个逆向工程技能，覆盖恶意软件分析、软件逆向、固件/嵌入式、协议逆向、移动应用、脱壳/反混淆、软件破解、漏洞挖掘、托管代码、取证/情报、CTF。**通用、可发布**：不假设用户已装任何工具，每个技能自带跨 OS 安装指引。

> ⚠️ **免责声明**：本技能库仅用于安全研究与授权范围内的分析。请遵守所在司法辖区的法律法规。

## 安装（三种方式）

### 方式一：npx（推荐，支持 7 种 AI 工具）

```bash
npx re-skills install                     # 交互式，默认 Claude Code
npx re-skills install --target all        # 安装到全部 7 种工具
npx re-skills install --target cursor     # 生成 Cursor 规则
npx re-skills install --target gemini     # Gemini CLI 原生技能
npx re-skills install --global            # 全局安装
npx re-skills install --project           # 仅当前项目
npx re-skills install --dry-run           # 只看计划不安装
npx re-skills uninstall                   # 卸载
```

### 方式二：Claude Code 插件市场

```bash
claude plugin add DslsDZC/aihk
```

### 方式三：手动拷贝

把 `.claude/skills/` 下的技能目录复制到 `~/.claude/skills/`（Claude Code）或对应工具目录。

## 多工具适配

| 工具 | 安装方式 | 体验 |
|---|---|---|
| Claude Code | `--target claude` / plugin | 原生技能（按需加载） |
| Gemini CLI | `--target gemini` | 原生技能 |
| Cline | `--target cline` | 原生技能（兼容） |
| Codex CLI | `--target codex` | 原生技能 |
| Cursor | `--target cursor` → `.cursor/rules/*.mdc` | 规则聚合（知识+流程，无按需加载） |
| GitHub Copilot | `--target copilot` → `.github/copilot-instructions.md` | 规则聚合 |
| Windsurf | `--target windsurf` → `.windsurf/rules/*.md` | 规则聚合 |

## 技能导航（64）

入口 → 11 大类网关 → 52 原子技能，详见 `.claude/skills/` 与 `docs/skill-template.md`。快速索引：

- **re-analyze**：入口（探测 → 偏好 → 识别 → 编排）
- **re-binary-core**：re-triage、re-format-pe/elf/macho、re-imports、re-ghidra、re-ida、re-radare2、re-gdb、re-x64dbg、re-lldb、re-tracing、re-memdump、re-windbg、re-binaryninja、re-emulation、re-kernel、re-game
- **re-malware**：re-sandbox、re-behavior、re-ioc
- **re-firmware**：re-fw-extract、re-fw-rootfs、re-fw-emulate、re-hardware-io、re-automotive
- **re-protocol**：re-netcap、re-proto-rev、re-crypto-id、re-crypto-keys、re-crypto-decrypt、re-ics
- **re-mobile**：re-apk、re-ios、re-frida
- **re-anti-analysis**：re-packer-id、re-unpack-simple、re-unpack-advanced、re-deobfuscate
- **re-cracking**：re-license、re-patching、re-keygen
- **re-vuln**：re-fuzzing、re-crash-triage
- **re-ctf**：re-angr、re-z3
- **re-managed**：re-dotnet、re-java、re-script-deob、re-wasm
- **re-forensics**：re-mem-forensics、re-ti

## 设计原则

- 默认空白环境：工具未装 → 技能内「工具准备」引导安装，不中断
- 默认沙箱：一切动态分析强制前置
- 默认转储优先：内存读取默认 gcore 转储
- 平台经验库：`.claude/skills/re-analyze/references/platform-tips.md`

## 开发

```bash
npm test   # 结构校验（frontmatter/死链/工具准备）
```

发布流程：`npm test` 通过 → git tag → npm publish → 同步 marketplace.json 版本。
