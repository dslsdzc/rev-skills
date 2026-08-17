# AGENTS.md — 逆向工程技能库

本仓库是通用逆向工程 AI 技能库（91 个技能）。任何支持 AGENTS.md 的工具（Claude Code、Codex、Gemini CLI、Cursor、Zed、Qwen Code 等）都可读取本文件。

## 技能索引（三层结构）

- 入口：`re-analyze`（.claude/skills/re-analyze/）——环境探测 → 偏好询问 → 任务识别 → 编排
- 大类网关（12）：re-binary-core / re-malware / re-firmware / re-protocol / re-mobile / re-anti-analysis / re-cracking / re-vuln / re-ctf / re-managed / re-forensics / re-feedback（经验反馈元网关）
- 原子技能（78）：见各网关 SKILL.md 的子技能清单与选择树

## 使用方式

- 本机为 Claude Code/Gemini CLI/Cline/Codex：克隆仓库后 `npx rev-skills install --target <工具名>` 或直接引用 .claude/skills/ 目录
- Cursor/Copilot/Windsurf：`npx rev-skills install --target cursor` 等生成规则文件
- 完整安装说明见 README.md

## 关键约定

- 技能 frontmatter：name 以 re- 前缀，description 含中英触发词
- 原子技能必含「工具准备」章节（跨 OS 安装指引）
- 动态分析默认沙箱；内存读取默认转储优先（见 re-analyze/references/platform-tips.md）
- 分析流程入口：先读 .claude/skills/re-analyze/SKILL.md 与 references/triage.md
