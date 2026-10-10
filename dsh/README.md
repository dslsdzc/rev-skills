# dsh — rev-skills 的 DSH 独立预设

本目录是给 DeepSeek Harness（下称 DSH）用的**独立 agent preset bundle**。它的作用是把本仓库的
`.claude/skills/`（122 个 `re-*` 技能）作为**预设自己的一个技能层**挂进 DSH：新建会话时选中
「逆向工程（rev-skills）」预设，即可用 `skill` 工具按需加载这些技能，不需要装 Claude Code。

技能内容本身**不在本目录内**——bundle 只声明预设与技能根，技能仍从仓库的 `.claude/skills/`
读取，因此技能增删改不需要重新发布本 bundle。

## 文件

| 文件 | 作用 |
|---|---|
| `package.json` | bundle 元数据；`dsh.bundle.patch` 指向补丁文件 |
| `cordis.patch.yml` | Cordis 补丁：插入 `preset-rev-skills`（config id `rev-skills`，order 40） |

## 前置要求

DSH 的基础 bundle 需自带以下两个包（官方发行版默认包含）：

- `@deepseek-ai/dsh-agent-preset` —— 提供 agent preset 声明能力
- `@deepseek-ai/dsh-skill-filesystem` —— 提供本地技能目录发现能力

bundle 自身零依赖，不需要 `npm install`。

## 安装

### 方式一：DSH 图形界面的插件管理器

在插件管理器里以**本目录的绝对路径**作为安装标识添加本 bundle，例如：

```
<仓库路径>\dsh
```

安装后 profile 的 `package.json` 会多出 `rev-skills-dsh-preset` 依赖项与对应的
`dsh.profile.bundles` 条目。手工等价写法（规格也可用 `link:` / `file:`）：

```jsonc
{
  "dependencies": { "rev-skills-dsh-preset": "file:../rev-skills/dsh" },
  "dsh": { "profile": { "bundles": ["...", "rev-skills-dsh-preset"] } }
}
```

### 方式二：仓库自带的 CLI

```
node bin/dsh.mjs preset install --apply
```

该命令把 bundle 行与依赖写入当前 DSH profile 并应用改动；同一命令族的
`preset status` 可查看当前是否已启用，`preset uninstall --apply` 可移除。命令的完整参数与
行为以 `docs/dsh-integration.md` 与 `bin/dsh.mjs` 为准；写入 profile 之后按命令输出的提示
完成一次依赖安装并重启 DSH，预设才会出现在列表里。

### 零配置路线（可选）

最简单的是不走独立预设，直接把技能装进 DSH 的技能根：

```
npx rev-skills install --target dsh --global
```

技能落到 `<DSH_HOME>/skills`（默认 `~/.dsh/skills`）。本预设的技能根解析把该目录作为
第二优先级，因此这种方式装好技能后，即使不设任何环境变量也能命中；两者同时使用也可。

## 选择预设

安装后新开一个会话，在预设列表里选择「逆向工程（rev-skills）」。预设的 `order` 为 40，
排在官方内置预设之后。只有选中该预设的会话才会挂载本预设配置的技能根（rev-skills 一处）。

`skill-filesystem` 行设置了 `includeDefaultRoots: false`，含义是：本预设挂载的技能提供方**不继承**
项目技能根（rank 100 `<projectRoot>/.dsh/skills`、rank 200 `<projectRoot>/.agents/skills`）与用户
技能根（rank 400 `<DSH_HOME>/skills`、rank 500 `<agentsHome>/skills`），也拿不到 rank 600 的
`bundledSkillDir`；它的技能目录只有 `customSkillDirs` 里声明的 rev-skills 技能根（rank 300）。

技能目录的最终结果仍由技能服务把全局层与当前作用域链合并而成，因此调用该预设时，本预设的 rev-skills
技能会与项目、用户技能根里已发现的技能**一起出现**，不是只看得见本库技能。两层出现同名技能时以本预设层
为准，即预置技能优先于项目、用户技能根里的同名条目；其他预设（`standard` 等）的技能目录完全不受本
bundle 影响。各技能根的扫描顺序与同名合并规则以 `@deepseek-ai/dsh-skill-filesystem` 的文档为准。

## 验证

1. 在选中该预设的会话里让模型列出技能：`skill` 工具的目录中应出现入口技能 `re-analyze`
   以及其余 121 个 `re-*` 技能（项目与用户技能根里已有的技能同时可见，属预期）。
2. 让模型加载 `re-analyze`，能返回技能正文即技能根解析正确。
3. 对照检查：切回 `standard` 预设的会话，技能目录应与之前一致（不含 `re-*` 技能）。

命令行侧可用 `node bin/dsh.mjs check` 做技能根解析自检，`node bin/dsh.mjs preset spec`
打印预设配置（含技能根与 `REV_SKILLS_DIR` 覆盖结果）。

## 技能根覆盖：`REV_SKILLS_DIR`

设置环境变量 `REV_SKILLS_DIR` 可覆盖技能根解析，取值可以是：

- 仓库根目录 —— 解析为 `<dir>/.claude/skills`
- 直接存放技能的目录 —— 原样使用

该变量优先级最高。预设的解析顺序（取第一个通过校验的候选，校验方式为目录存在且列目录时
至少出现一个 `re-` 开头的条目）：

1. `REV_SKILLS_DIR`（按上表两种含义）
2. `<DSH_HOME>/skills`（默认 `~/.dsh/skills`）
3. `<rev-skills 包目录>/.claude/skills`
4. `<rev-skills-dsh-preset 包目录>/../.claude/skills`（即同处 `node_modules/` 下的仓库技能根）

候选目录都不存在时回落到第 2 项；目录暂缺不会报错（技能提供方会持续探测）。

## 已知限制

`SKILL.md` 经 `skill` 工具加载后是普通工具结果，而本预设的插件清单与官方 `cordis` 预设保持
一致（`tool-result-pruner` 阈值 8192 字符，保留前 4096 + 后 1024）。当前仓库有 32 个
`SKILL.md` 的文件字符数超过该阈值（CRLF 检出下为 34），因此这些技能正文在加载时可能被裁掉中段；`standard` 等预设下
同样如此，并非本预设引入。需要完整正文时，直接读 `.claude/skills/<技能名>/SKILL.md` 或同目录下的
`references/`。

## 卸载

1. 从 profile 的 `package.json` 移除 `dsh.profile.bundles` 中的 `rev-skills-dsh-preset` 条目
   及其依赖项（或执行 `node bin/dsh.mjs preset uninstall --apply`）。
2. 重启 DSH；已存在的旧会话保留创建时的组合，需新开会话生效。

## 许可

工具代码侧 Apache-2.0，见本目录 `LICENSE`。技能文档内容的许可见仓库根 `LICENSE-docs.md`。
