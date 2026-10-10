# DSH 检查夹具

这些目录是 `bin/dsh.mjs check` 的输入，不属于 `.claude/skills`（`validate.mjs` 不扫这里）。

- `check-errors/` 每个子目录只违反一条规则，用来确认每个错误类都能被点名；`re-ok/` 是合法对照。
- `flat-root/` 覆盖平铺形态（`<root>/<name>.md`）与平铺名文法检查。
- `long/` 是一个超过工具结果裁剪阈值的合法技能，用来确认「超阈值只告警不报错」。

放在 `tests/fixtures-dsh/` 而不是 `tests/fixtures/dsh-*/`：`tests/validate.test.mjs` 里
`collectSkills` 断言了 `tests/fixtures/` 一级目录的完整名单，往里加任何目录都会让那条断言变红，
而那个文件不在本任务的改动范围内。

夹具里的 `re-tabs/SKILL.md` 含一个真实的 TAB 字符（YAML 不允许用 TAB 缩进），
测试会先断言该文件确实含 TAB，再断言检查器报 `tab-in-frontmatter`。
