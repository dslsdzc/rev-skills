# DSH（DeepSeek Harness）集成

本文是 rev-skills 与 DSH（DeepSeek Harness）集成的长期参考：DSH 在本库语境里是什么、两条集成路线的差别、DSH 强制执行的兼容规则、安装与卸载命令、预设选择方式、验证方法、排错表，以及维护时必须成对同步的文件。

面向 DSH 侧的使用说明（bundle 的安装细节与预设清单）见 `dsh/README.md`；命令行实现见 `bin/dsh.mjs` 与 `bin/install.mjs`。

## 1. DSH 在本库语境里是什么

DSH 是一个宿主（host），它按 **Agent Skills 风格**扫描技能目录：每个被扫描根目录下识别 `<root>/<name>/SKILL.md` 或 `<root>/<name>.md`。本库的 `.claude/skills/` 就是这样一个目录，因此内容不需要转换即可被 DSH 读取——需要处理的只是「放到哪个根目录」与「用哪个预设看到它」。

两条能力需要分开理解：

- **技能发现**（`@deepseek-ai/dsh-skill-filesystem`）：扫描根目录 → 解析 frontmatter → 把技能注册进当前预设的可用技能列表。
- **预设（agent preset）**：`@deepseek-ai/dsh-agent-preset` 的一行配置，决定该预设挂载哪些插件、看到哪些技能根。预设把「技能目录」和「agent 的工具与提示词」绑定在一起。

DSH 的默认技能根与优先级（数字小者先匹配，同名技能以先命中者为准）：

| 优先级 | 根目录 | 说明 |
|---|---|---|
| 100 | `<projectRoot>/.dsh/skills` | 项目级 DSH 技能 |
| 200 | `<projectRoot>/.agents/skills` | 项目级通用 agent 技能 |
| 300 | `customSkillDirs` | 由预设显式声明的目录（本库预设用这一档） |
| 400 | `<dshHome>/skills` | 全局 DSH 技能（Windows 默认 `C:\Users\<用户>\.dsh\skills`） |
| 500 | `<agentsHome>/skills` | 全局通用 agent 技能 |
| 600 | `bundledSkillDir` | DSH 自带技能 |

本机可用 `$env:DSH_HOME`（Windows）确认第 400 档的实际位置。

## 2. 两条集成路线

两条路线不互斥，取哪条取决于「要不要一个只带逆向技能层的固定 agent 配置」。

### 路线一：装进 DSH 技能根（所有预设可见）

把技能拷到第 100 / 400 档，**任何预设**都能看到这 122 个技能，不需要 bundle：

```bash
npx rev-skills install --target dsh            # 交互式选择 global / project
npx rev-skills install --target dsh --global   # → <dshHome>/skills
npx rev-skills install --target dsh --project  # → .dsh/skills
npx rev-skills install --target dsh --dry-run  # 只看计划
npx rev-skills uninstall --target dsh --global
```

适用场景：只想让技能在任意会话里可用，不需要独立的 agent 配置。代价是技能与预设的工具集、上下文预算混在一起。

### 路线二：独立预设（自带技能层）

`dsh/` 是一个 bundle 包（`rev-skills-dsh-preset`），它插入一行预设 `preset-rev-skills`：

- 预设显示 id（`config.id`）为 `rev-skills`，显示名「逆向工程（rev-skills）」，`order` 为 40；
- 该预设自带的 `skill-filesystem` 实例用 `includeDefaultRoots: false`，即**该实例自身**不声明第 100–600 档的根，技能根完全由 `customSkillDirs` 指定；但 DSH 读取技能时会把这个预设层与全局层合并，所以项目/用户技能仍与会话可见（同名条目以更近的预设层为准），其他预设不受影响；
- bundle 自身不带技能副本，技能始终从仓库的 `.claude/skills/` 读取，因此技能增删改不需要重新发布 bundle。

`customSkillDirs` 的解析顺序（取第一个通过校验的候选；校验 = 目录存在且其中至少有一个 `re-` 开头的条目）：

| 顺序 | 候选 | 说明 |
|---|---|---|
| 1 | `REV_SKILLS_DIR` | 环境变量，优先级最高；取值是仓库根目录时解析为 `<dir>/.claude/skills`，取值是技能目录本身时原样使用 |
| 2 | `<DSH_HOME>/skills` | 默认 `~/.dsh/skills`（Windows `%USERPROFILE%\.dsh\skills`）——即「路线一」装进去的位置 |
| 3 | `<rev-skills 包目录>/.claude/skills` | 按包名解析（作为依赖安装时命中） |
| 4 | `<rev-skills-dsh-preset 包目录>/../.claude/skills` | 直接依赖 `dsh/` 目录时命中 |

候选都不可用时回落到第 2 项；目录暂缺不报错（提供方会持续探测）。

按 DSH `skills` 服务的实际契约，预设作用域的提供方与全局层是**合并**关系而非替换：同名技能以更近的层胜出。因此该预设是把 rev-skills 技能根作为自己的一层加入，用户项目与家目录下的技能仍可见；`includeDefaultRoots: false` 只影响这个预设实例自身的根列表。

```bash
node bin/dsh.mjs check [--dir <skillsRoot>] [--json]
node bin/dsh.mjs preset spec
node bin/dsh.mjs preset status [--profile-dir <dir>] [--json]
node bin/dsh.mjs preset install [--profile-dir <dir>] [--force] [--apply]
node bin/dsh.mjs preset uninstall [--profile-dir <dir>] [--apply]
```

`preset install` / `preset uninstall` 默认是 dry-run，打印将要做的编辑；加 `--apply` 才写文件（写入前备份，卸载时存在备份则从备份还原）。

等价的手工路径（等价于 DSH 的插件管理器操作）：bundle 是一个 npm 包，在 `package.json` 里用 `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }` 声明补丁文件，然后把它加进 profile 的 `package.json`：

```jsonc
{
  "dependencies": { "rev-skills-dsh-preset": "file:../rev-skills/dsh" },
  "dsh": { "profile": { "bundles": [ "...", "rev-skills-dsh-preset" ] } }
}
```

两处必须同时存在：**bundle 行在 `dsh.profile.bundles` 里，且依赖能解析到该包**。profile 的 `package.json` 位于 `$env:DSH_PROFILE_DIR`（Windows 默认 `C:\Users\<用户>\.dsh\profiles\<profile>\package.json`）。

DSH 的插件管理器支持两种安装来源：绝对本地路径，或 `link:` / `file:` 规格；GUI 里可从插件管理器直接安装，无需手改 JSON。

适用场景：需要一个只见得到本库技能、且带固定工具与提示词的独立 agent 预设。

## 3. DSH 强制的兼容规则

本库 122 个技能已全部满足下列规则；新增或修改技能时按此自检。

1. **目录布局（一层）**：`<root>/<name>/SKILL.md` 或 `<root>/<name>.md`。扫描只深入一层——嵌套的 `**/SKILL.md` 不会被发现，例如 `.claude/skills/re-analyze/references/analysis-contract.md` 不构成独立技能。
2. **frontmatter 分界行必须精确**：开头的行就是 `---`（前后无空格、无 BOM），结尾是同样精确的一行 `---`；闭合行之后才有正文。
3. **frontmatter 必须是合法 YAML 且解析为 mapping**：键值映射，块标量与内联 list 都在 YAML 子集内。解析失败时 DSH 记一条告警并**静默跳过该技能**（技能看起来"消失"，不报错中断）。
4. **`name` 语法**：必须匹配 `/^[a-z0-9]+(?:-[a-z0-9]+)*$/`（小写字母、数字、单连字符分段），并且与目录名一致。
5. **`description` 非空**：缺失或空串即不注册。本库另有更严的约束——`description` 必须同时含 CJK 与拉丁字母（`validate.mjs` 强制，保证中英触发词都可命中）。
6. **可选键**：`whenToUse`、`metadata`、`disable-model-invocation`、`user-invocable`；本库技能不需要它们即可被发现。
7. **工具结果裁剪**：标准预设会裁剪超过 **8192 字符**的工具结果。本库有 **32 个** `SKILL.md` 的文件字符数超过该阈值（CRLF 检出下为 34；`node bin/dsh.mjs check` 会逐条列出字符数与正文行数，最长 `re-kernel`，约 19979 字符），这些技能被加载时正文可能被截断——需要完整内容时直接读文件，或把该技能拆分为「正文 + `references/`」。

本机自检 frontmatter 的最短路径：

```bash
node validate.mjs      # 结构校验（frontmatter / 命名 / 能力标签 / 死链 / guard / 章节）
node bin/dsh.mjs check # 按 DSH 发现规则校验技能根（一层布局 / 分界行 / name 文法 / 裁剪阈值）
```

YAML 本身按换行解析，DSH 允许分界行尾带 CR；本库随库脚本（`validate.mjs` / `lib/frontmatter.mjs`）按 LF 解析，因此检出的工作区行尾须与仓库声明一致（`.gitattributes` 与 `core.autocrlf` 的取向见仓库根）。

## 4. 验证

1. `node validate.mjs` 输出 `OK: 122 skills validated`——内容层通过。
2. `node bin/dsh.mjs check`——按 DSH 发现规则校验技能根，通过时输出 `OK: N skills DSH-compatible`；`--dir <skillsRoot>` 换根、`--json` 逐条给出检查项与告警。
3. `node bin/dsh.mjs preset spec`——确认解析到的技能根（`REV_SKILLS_DIR` → `<DSH_HOME>/skills` → 包目录，见第 2 节的顺序表）。
4. 新开会话，在预设列表里选中「逆向工程（rev-skills）」：`skill` 工具目录中应出现入口技能 `re-analyze` 与其余 121 个 `re-*` 技能；加载 `re-analyze` 能返回正文即技能根解析正确。
5. 对照检查：切回 `standard` 预设的会话，`re-*` 技能不再由预设层提供——若该会话仍能看到 `re-*`，说明技能同时装进了被扫描的全局技能根（路线一），那属于预期结果而非故障。

## 5. 排错

| 现象 | 常见原因 | 处理 |
|---|---|---|
| 技能全部看不到 | 装错根目录（`--project` 装到了 `.claude/skills` 而非 `.dsh/skills`） | 重跑 `--target dsh --global` 或 `--project`，用 `node bin/dsh.mjs check` 核对根 |
| 只有个别技能看不到 | frontmatter 首尾不是精确 `---`，或 YAML 不合法 | DSH 日志会有告警并跳过该条；跑 `node validate.mjs` 定位；修正分界行/YAML |
| 技能名不合法 | `name` 含大写、下划线、连续连字符或与目录名不一致 | 改为 `<root>/<name>/SKILL.md` 且 `name` 匹配 `/^[a-z0-9]+(?:-[a-z0-9]+)*$/` |
| 技能列表里没有 `references/` 里的文件 | 扫描只深入一层，嵌套 `**/SKILL.md` 不发现 | 属预期行为；把需要独立触发的内容提升为顶层技能 |
| 预设不出现 | bundle 名不在 profile 的 `dsh.profile.bundles`，或依赖未安装 | 跑 `node bin/dsh.mjs preset status`；补 bundle 行与依赖后重装 profile |
| 预设改完没生效 | profile 未重新安装/未应用 | `node bin/dsh.mjs preset install --apply`，或从 GUI 插件管理器重新安装 bundle |
| 旧会话看不到新预设 | 已存在的会话保留创建时的插件组合 | 新开一个会话（旧会话不会热切预设） |
| 技能根解析到了别处 | `REV_SKILLS_DIR` 或 `<DSH_HOME>/skills` 先命中，且其中存在 `re-` 条目 | 用 `node bin/dsh.mjs preset spec` 看命中项，清掉不该命中的目录或变量 |
| 改了技能正文但会话里没变 | 正文按需加载，编辑正文不需重启 | 重新触发该技能即可 |
| 改了技能 frontmatter 但会话里没变 | frontmatter 在启动/加载时解析并缓存 | 重启 DSH 会话（或重载技能根）后生效 |
| 技能正文被截断 | 正文超过 8192 字符被预设裁剪 | 直接读文件，或把长技能拆分为正文 + `references/` |

## 6. 维护同步点

改 DSH 相关文件时，下列配对必须同时更新，否则出现"命令能跑但预设装不上"这类不一致：

| 项 | 一处 | 另一处 |
|---|---|---|
| 版本号 | 根 `package.json` → `version` | `dsh/package.json` → `version` |
| bundle 名 | `dsh/package.json` → `name` | profile `package.json` → `dsh.profile.bundles` 的对应行 + 同名依赖 |
| 补丁文件 | `dsh/package.json` → `dsh.bundle.patch` | `dsh/cordis.patch.yml` 实际路径 |
| 预设 id | `dsh/cordis.patch.yml` 的 `config.id`（`rev-skills`） | `dsh/README.md` 与本文档的说明 |
| 技能根 | `dsh/cordis.patch.yml` 的 `customSkillDirs` | `REV_SKILLS_DIR` 覆盖逻辑与本文档第 2 节 |

发布流程与其他宿主一致：`npm test` 通过 → git tag → npm publish → 同步 `package.json` 与 `.claude-plugin/marketplace.json` 的版本号。
