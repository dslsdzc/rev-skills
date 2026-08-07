---
name: re-analyze
type: entry
description: >
  逆向分析唯一入口。流程：环境探测(probe.sh) → 偏好询问(分析目标/反编译器/深度/报告/平台) →
  任务识别(triage.md) → 编排调用大类网关。
  触发词：分析、逆向、reverse、RE、帮我看看这个文件、这个样本是干什么的、
  脱壳、找密钥、破解、固件分析、恶意软件分析、analyze this binary。
---

# 逆向分析入口

<HARD-GATE>
按以下四步执行，每步完成后再进下一步。禁止跳过探测直接分析。
</HARD-GATE>

## 第〇步：环境探测

运行 `references/probe.sh`（或本机手动执行等价命令），记录：
- `RE_OS` / `RE_ARCH` / `RE_CORES` / `RE_MEM_GB`（探测失败→询问用户）
- `RE_TOOLS`：HAVE 列表（已装，优先使用）与 MISS 列表（未装，**不中断流程**，用到的技能会引导安装）
- 参考 [[platform-tips]] 中本平台分支的经验

## 第一步：偏好询问

按 `references/preferences.md` 顺序询问（一次完成）：
1. **分析目标**（必答，第一项）——不明确就追问
2. 反编译器：Ghidra(默认) / IDA / radare2
3. 深度：快速结论 / 标准分析 / 深度报告
4. 报告：要 / 不要
5. 平台确认：自动 / 手动

结果存入会话变量（`RE_GOAL`、`RE_DECOMPILER`、`RE_DEPTH`、`RE_REPORT`、`RE_TARGET_PLATFORM`），本次分析全程有效，被调用技能读取。

**安全底线**：目标涉及运行样本 → 提醒默认沙箱原则（见 [[platform-tips]] 最高原则）。

## 第二步：任务识别

按 `references/triage.md` 决策表，把 `RE_GOAL` + 输入文件映射到一条编排路径。复合目标按依赖顺序串联多个大类。

## 第三步：编排分派

调用对应大类网关技能（`[[re-binary-core]]` `[[re-malware]]` `[[re-firmware]]` `[[re-protocol]]` `[[re-mobile]]` `[[re-anti-analysis]]` `[[re-cracking]]` `[[re-vuln]]` `[[re-ctf]]` `[[re-managed]]` `[[re-forensics]]`），网关内部自行选择原子技能。每个环节完成后检查新证据，必要时回退调整路径（见 triage.md 复合任务示例）。

## 何时使用 / 何时不用

- 用：任何逆向/恶意软件/固件/协议/移动/破解/CTF 分析请求
- 不用：已被具体技能触发的精确请求（如"用 Ghidra 分析这段代码"可直接走 [[re-ghidra]]）

## 常见坑与陷阱

- 探测不是摆设：内存 <4GB 却选了 Ghidra → 提示改用 radare2
- 目标是"看逻辑"却直接上沙箱 → 静态优先，动态按需
- 用户没装任何工具是常态——不要因为 MISS 卡住，按「工具准备」引导安装
