---
name: re-ai-triage
type: atomic
description: >
  AI 模型分析第一入口（分流器）：识别输入形态——模型文件走文件层逆向（re-ai-model）、
  仅有 API 走行为层评估（re-ai-attack）、恶意行为走恶意分析。
  触发词：AI模型分析、AI模型安全、模型文件、模型泄露、模型逆向、模型分析入口。
capabilities: [triage]
---

# AI 模型分析入口（分流器）

## 任务分类器（输入形态 → 路径）

拿到 AI 相关目标后先判输入形态，命中即转对应技能：

| 输入形态 | 路径 |
|---|---|
| 拿到模型文件（.onnx / .pt / .pth / .safetensors / .tflite） | → **[[re-ai-model]]**（文件层：格式解析 / 结构还原 / 权重提取 / 文件级水印） |
| 只有 API（无文件，黑盒接口） | → **[[re-ai-attack]]**（行为层：extraction / fingerprint / privacy / robustness 评估；guard 授权前置） |
| 文件 + API 都有 | → 先 [[re-ai-model]]（文件侧取证）→ 再 [[re-ai-attack]]（行为侧验证） |
| 发现恶意行为（投毒 / 后门 / 恶意载荷 / 下载执行） | → 恶意分析（当前：[[re-ai-model]] 安全边界处理 + [[re-behavior]]；未来独立 re-ai-malware 承接） |
| 模型被打包进可执行（PyInstaller/pyarmor 等） | → 先 [[re-binary-core]] 拆包 → 拆出的模型文件回本技能分流 |

## 何时使用 / 何时不用

- 用：用户说「分析这个模型 / AI 模型安全 / 模型泄露」但未指明输入形态——先分流
- 用：不确定目标是文件层还是行为层时——先识别再转
- 不用：输入形态已明确（直接进 [[re-ai-model]] 或 [[re-ai-attack]]，不绕本技能）
- 不用：非 AI 目标（走全局入口 [[re-analyze]]）
- 不用：训练 / 微调 / 部署（非逆向）

## 工具准备

本技能只做识别与分流，工具轻量：

### python3 / file —— 模型文件识别

- python3 安装与验证见 [[re-python]] 工具准备
- `file`：Linux `apt install file` / `dnf install file` / `pacman -S file`（多数预装）；验证 `file --version`
- 验证：`python3 -c "import struct"`（标准库）

### 模型库探测（判断目标依赖，不加载模型）

- `pip list 2>/dev/null | grep -iE 'torch|tensorflow|onnx'`——确认本机可解析目标格式；缺失时由下游技能引导安装

## 操作步骤

1. **输入形态识别**：
   - 用户给了路径/文件 → 先 `file <path>`（onnx：`file` 常报 `data`——以 `xxd` 首字节 protobuf 头（`08 08`）+ `strings` producer 名辅助识别；safetensors：`JSON metadata` 头；pt/pth：`pickle` 或 zip 容器；tflite：`tflite` 标识）→ 转 [[re-ai-model]]
   - 用户只有 API 端点/查询能力 → 转 [[re-ai-attack]]
   - 两者都有 → 按任务分类器先文件后行为
2. **目标归属确认**：文件/API 的持有方与授权（自有 / 授权测试 / CTF·研究）——行为层评估前必须确认（[[re-ai-attack]] guard 前置；授权上下文见 triage 第 0 步 `RE_AUTH`）
3. **转交与记录**：明确转交技能 + 会话变量（`RE_GOAL`、`RE_AUTH`、输入形态标记），不在本技能做深度分析

## 跨域联合

- [[re-managed]]：本技能是其 AI 分支的第一跳（re-managed → re-ai-triage → re-ai-model / re-ai-attack）
- [[re-ai-model]]：文件层下游
- [[re-ai-attack]]：行为层下游（guard 授权前置）
- [[re-binary-core]]：模型打包进可执行时的拆包前置
- [[re-behavior]]：恶意行为侧协作（投毒/后门的行为判定）

## 常见坑与陷阱

- **拿文件名猜格式**：`.pt` 可能是 pickle 也可能是 zip 容器（torch 新格式）、`.bin` 可能是任意权重 dump——以 `file` 输出与魔数为准，不靠扩展名
- **分流过深**：本技能只识别与转交，不展开分析——在分流阶段做深度分析会与下游重复
- **授权前置遗漏**：行为层评估（[[re-ai-attack]]）有 guard 授权要求——转交前先确认 `RE_AUTH`，未知归属时先询问，不直接进入行为层
