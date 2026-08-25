# 技能模板规范

## 原子技能结构
每个技能目录：`SKILL.md`（必含）+ 可选 `references/`（深度知识、gotchas）。

SKILL.md 章节（顺序固定）：
1. frontmatter：`name`（=目录名，re- 前缀）、`type`（原子技能可省略或 `atomic`；入口用 `entry`；网关用 `gateway`）、`description`（中英触发词 + 何时使用）、`capabilities`（可选，见能力注册表 references/capabilities.md）
2. `# 标题`（中文，如 "脱壳：压缩壳（UPX/ASPack/FSG）"）
3. `## 任务分类器（intent → 路径）` —— **可选但推荐**：多分支技能（一个技能含多个子任务族）在「何时使用」前加用户目的 → 路径映射表（如 re-ai-attack：怀疑模型被复制→fingerprint / 判断训练数据泄露→membership / 测试 API 可复制性→extraction / 测试鲁棒性→adversarial），路径指向操作步骤编号；单任务技能可省略
   - 多分支技能**建议同时加「输入资产盘点（INPUT INVENTORY）」**：路径命中后确认已有资产（API/模型/数据集/副本/基线），缺资产先索要或说明局限——不同资产组合决定不同路线
4. `## 何时使用 / 何时不用` —— 明确边界，防误触发
5. `## 工具准备` —— 必含：每个工具给出 apt / dnf / pacman / brew / pip / cargo / choco 安装命令 + 验证命令 + OS 分支（Linux/macOS/Windows/WSL 替代方案）；引用 [[platform-tips]] 相关分支
6. `## 操作步骤` —— 可执行、具体，沿用 porting-minecraft-mod 的硬性执行风格（不省略、不"类似处理"）
7. `## 跨域联合` —— 本技能在哪些复合任务中被其他大类引用（写 [[技能名]] 链接）
8. `## 常见坑与陷阱` —— 至少 3 条具体经验（来源：platform-tips + Task 15/16 调研产出）

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
