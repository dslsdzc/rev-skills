---
name: re-hyphen-keys
description: 夹具：带连字符的可选键。Hyphenated optional keys, valid for DSH.
type: atomic
disable-model-invocation: false
user-invocable: true
---

## 什么时候用

夹具：`disable-model-invocation` 与 `user-invocable` 是 DSH 的合法可选键（都是合法 YAML）。
仓库的 `lib/frontmatter.mjs` 键文法只认 `\w+`，会把它们判成游离行——本夹具就是那条误报的回归。
