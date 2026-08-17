# rev-skills — 通用逆向工程 AI 技能库

[![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE) [![License: CC BY 4.0](https://img.shields.io/badge/License-CC_BY_4.0-lightgrey.svg)](LICENSE-docs.md)

101 个逆向工程技能，覆盖恶意软件分析、软件逆向、固件/嵌入式、协议逆向、移动应用、脱壳/反混淆、软件破解、漏洞挖掘、托管代码、取证/情报、CTF。**通用、可发布**：不假设用户已装任何工具，每个技能自带跨 OS 安装指引。

> **使用边界**：本技能库仅用于**安全研究与授权范围内的分析**。使用前须取得目标方授权；禁止用于未经授权的逆向、破解、绕过验证或恶意软件活动。逆向工程的合法性因司法辖区而异（如美国 DMCA 反规避条款、各地软件保护条例），使用者须自行遵守所在地法律，并自行承担违规使用的一切责任。本库内容为通用方法论，不针对任何具体目标。

## 安装（三种方式）

### 方式一：npx（推荐，支持 7 种 AI 工具）

> 方式一自建安装器额外处理 Cursor / Copilot / Windsurf 的规则聚合（.mdc / 说明文件），这是标准 skills CLI 没有的能力；只装 Claude Code 系可用方式二。

```bash
npx rev-skills install                     # 交互式，默认 Claude Code
npx rev-skills install --target all        # 安装到全部 7 种工具
npx rev-skills install --target cursor     # 生成 Cursor 规则
npx rev-skills install --target gemini     # Gemini CLI 原生技能
npx rev-skills install --global            # 全局安装
npx rev-skills install --project           # 仅当前项目
npx rev-skills install --dry-run           # 只看计划不安装
npx rev-skills uninstall                   # 卸载
```

### 方式二：标准 skills CLI（agentskills.io 兼容）

本库遵循 [Agent Skills 规范](https://agentskills.io)，可被任意兼容运行时（Claude Code / Codex / Cursor / Gemini CLI 等 50+ 工具）直接发现与安装：

```bash
npx skills add DslsDZC/rev-skills          # 项目作用域（.claude/skills/）
npx skills add DslsDZC/rev-skills -g       # 全局（~/.claude/skills/）
npx skills add DslsDZC/rev-skills -l       # 先列出技能，不安装
```

### 方式三：手动拷贝

把 `.claude/skills/` 下的技能目录复制到 `~/.claude/skills/`（Claude Code）或对应工具目录。

## 多工具适配

| 工具 | 安装方式 | 体验 |
|---|---|---|
| Claude Code | `--target claude` | 原生技能（按需加载） |
| Gemini CLI | `--target gemini` | 原生技能 |
| Cline | `--target cline` | 原生技能（兼容） |
| Codex CLI | `--target codex` | 原生技能 |
| Cursor | `--target cursor` → `.cursor/rules/*.mdc` | 规则聚合（知识+流程，无按需加载） |
| GitHub Copilot | `--target copilot` → `.github/copilot-instructions.md` | 规则聚合 |
| Windsurf | `--target windsurf` → `.windsurf/rules/*.md` | 规则聚合 |

## 技能导航（101）

入口 → 12 大类网关 → 88 原子技能，详见 `.claude/skills/` 与 `docs/skill-template.md`。快速索引：

- **re-analyze**：入口（探测 → 偏好 → 识别 → 编排）
- **re-binary-core**：re-triage、re-format-pe/elf/macho、re-imports、re-ghidra、re-ida、re-radare2、re-gdb、re-x64dbg、re-lldb、re-tracing、re-memdump、re-windbg、re-binaryninja、re-emulation、re-shellcode、re-kernel、re-game、re-go、re-rust、re-plugin-dev、re-hypervisor、re-anti-cheat、re-cpp-abi、re-swift、re-zig、re-nim、re-fp-runtime
- **re-malware**：re-sandbox、re-behavior、re-ioc、re-ransomware、re-loader、re-fileless
- **re-firmware**：re-fw-extract、re-fw-rootfs、re-fw-emulate、re-hardware-io、re-automotive、re-uefi
- **re-protocol**：re-netcap、re-proto-rev、re-crypto-id、re-crypto-keys、re-crypto-decrypt、re-ics、re-iot-proto、re-whitebox、re-tls
- **re-mobile**：re-apk、re-ios、re-frida、re-frida-script-author、re-mobile-pack、re-hybrid-app、re-android-native、re-ios-jb
- **re-anti-analysis**：re-packer-id、re-unpack-simple、re-unpack-advanced、re-deobfuscate、re-evasion
- **re-cracking**：re-license、re-patching、re-keygen、re-drm
- **re-vuln**：re-fuzzing、re-crash-triage、re-exploit
- **re-ctf**：re-angr、re-z3、re-pwn
- **re-managed**：re-dotnet、re-java、re-script-deob、re-wasm、re-ai-model、re-blockchain、re-python
- **re-forensics**：re-mem-forensics、re-disk-forensics、re-ti、re-attribution
- **re-macos**：macOS 应用逆向（签名/entitlements/Secure Enclave）
- **re-hw-chip**：芯片/PCB 物理层（decap/裸片/木马检测）
- **re-ai-attack**：模型攻击（提取/指纹/成员推断）
- **re-sdr**：射频逆向（采集/解调/帧恢复）
- **re-feedback**：经验反馈元网关——三源收集（会话复盘/文章扫描/手动输入）→ 蒸馏脱敏 → 归域 → 三档处理（发表 issue / 本地入库 / 不入库），re-analyze 第四步挂钩

## 设计原则

- 默认空白环境：工具未装 → 技能内「工具准备」引导安装，不中断
- 默认沙箱：一切动态分析强制前置
- 默认转储优先：内存读取默认 gcore 转储
- 平台经验库：`.claude/skills/re-analyze/references/platform-tips.md`

## 许可证

本仓库双许可：

- **技能文档内容**（`.claude/skills/` 及说明文档）：[CC BY 4.0](LICENSE-docs.md)——允许复制/修改/商业使用，须保留署名
- **工具代码**（`bin/`、`validate.mjs`、`tests/`）：[Apache-2.0](LICENSE)

## 开发

```bash
npm test   # 结构校验（frontmatter/死链/工具准备）
```

发布流程：`npm test` 通过 → git tag → npm publish → 同步 marketplace.json 版本。
