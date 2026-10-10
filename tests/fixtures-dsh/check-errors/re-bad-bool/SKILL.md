---
name: re-bad-bool
description: 夹具：布尔字段写了非法值。Invalid boolean spelling.
type: atomic
user-invocable: maybe
---

## 什么时候用

DSH 的布尔文法只接受 true/false、yes/no、on/off、1/0，`maybe` 会让该技能被丢弃。
