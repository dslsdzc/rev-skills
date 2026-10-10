---
name: re-tabs
description: 夹具：frontmatter 里出现 TAB 字符。TAB inside frontmatter.
type: atomic
	这一行的缩进是 TAB，YAML 不允许用 TAB 做缩进
---

## 什么时候用

夹具：frontmatter 块内出现 TAB 即报 `tab-in-frontmatter`（DSH 的 YAML 解析器会拒绝这种缩进）。
