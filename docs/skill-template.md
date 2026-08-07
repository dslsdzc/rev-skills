# 技能模板规范

## 原子技能结构
每个技能目录：`SKILL.md`（必含）+ 可选 `references/`（深度知识、gotchas）。

SKILL.md 章节（顺序固定）：
1. frontmatter：`name`（=目录名，re- 前缀）、`type`（原子技能可省略或 `atomic`；入口用 `entry`；网关用 `gateway`）、`description`（中英触发词 + 何时使用）
2. `# 标题`（中文，如 "脱壳：压缩壳（UPX/ASPack/FSG）"）
3. `## 何时使用 / 何时不用` —— 明确边界，防误触发
4. `## 工具准备` —— 必含：每个工具给出 apt / dnf / pacman / brew / pip / cargo / choco 安装命令 + 验证命令 + OS 分支（Linux/macOS/Windows/WSL 替代方案）；引用 [[platform-tips]] 相关分支
5. `## 操作步骤` —— 可执行、具体，沿用 porting-minecraft-mod 的硬性执行风格（不省略、不"类似处理"）
6. `## 跨域联合` —— 本技能在哪些复合任务中被其他大类引用（写 [[技能名]] 链接）
7. `## 常见坑与陷阱` —— 至少 3 条具体经验（来源：platform-tips + Task 15/16 调研产出）

## 网关技能结构
1. frontmatter（同原子技能，description 声明"网关"）
2. `# 标题`
3. `## 完整工作流` —— 该大类从头到尾的流程（步骤编号）
4. `## 何时用哪个原子技能（选择树）` —— 按输入特征/目标列选择分支
5. `## 跨域联合` —— 规格 2.4 的联合场景表（该网关相关行），含 [[链接]]
6. `## 常见坑与陷阱`

## 多工具兼容约束
- 正文纯 Markdown，禁止工具私有语法
- frontmatter 标准 YAML
- 引用统一用 `[[技能名]]`
