---
name: re-variant
type: atomic
description: >
  二进制变体/补丁对比：函数匹配、N-day 补丁 diff、变体溯源与相似度分析。
  触发词：二进制对比、补丁对比、N-day、变体分析、BinDiff、函数匹配、样本相似。
---

# 二进制变体/补丁对比

## 何时使用 / 何时不用

- 用：补丁前后对比（漏洞定位）、家族变体关联、样本溯源、N-day 分析
- 不用：单样本深度分析（走 [[re-binary-core]] 通用路径）

## 工具准备

### BinDiff / Diaphora（函数匹配插件）

- BinDiff: Windows 商业工具（安装指引，可替换为开源替代）；Diaphora: 多平台开源（`git clone https://github.com/joxeankoret/diaphora`，IDA/Ghidra 插件）
- Ghidra 侧替代: BinDiff 官方 Ghidra 插件或 Diaphora 的 Ghidra 移植
- 验证: 插件在反编译器内可加载

### radiff2 / rz-diff（rizin 命令行对比）

- Linux: `apt install rizin` / `pacman -S rizin`；macOS: `brew install rizin`；Windows: 官方安装包
- 验证: `rz-diff --version`

### readelf（符号对齐辅助）

- 安装与验证见 [[re-cpp-abi]] 工具准备

## 操作步骤

按顺序执行，每步产物存档（路径 + sha256，见 [[re-triage]]）。

1. **函数匹配**：
   ```sh
   # 命令行快速对比（rizin 系）：指令哈希 + 调用图相似度
   rz-diff -ss sample_v1 sample_v2 | head -30
   ```
   - 匹配维度：指令哈希（相同代码）、调用图（子图同构）、导入导出对齐、字符串/常量引用
   - 工具（BinDiff/Diaphora）输出：matched / changed / new / deleted 函数集
   - strip 后符号缺失：靠结构匹配（见坑 2）

2. **补丁 diff（N-day）**：
   - 修复前后对比 → `changed` 函数集 = 漏洞点候选
   - 变更函数深挖：新条件分支/新校验/新增调用（[[re-ghidra]] / [[re-ida]] 反编译）
   - 反推漏洞：旧代码的缺陷模式（缺失校验/越界/释放后使用）
   - 产出：漏洞函数 + 缺陷模式推断（置信度标注）

3. **变体溯源**：
   - 家族内样本两两对比 → 相似度矩阵 → 聚类（共享函数比例阈值）
   - 演进链：按时间线/相似度排序样本（早期 vs 晚期变体）
   - 共享独有函数 = 家族标志（与 [[re-attribution]] 能力证据衔接）

4. **输出差异清单**：
   - 格式：变更函数表（函数名/地址/变更类型/相似度）+ 结论
   - 按 [[analysis-contract]] 数据契约传递（下游消费）

## 跨域联合

- [[re-binary-core]] 网关：本技能归属（选择树「补丁/N-day 对比」分支）
- [[re-ghidra]] / [[re-ida]]：反编译底座（变更函数深挖）
- [[re-attribution]]：变体关联的能力证据衔接
- [[analysis-contract]]：差异清单按数据契约传递

## 常见坑与陷阱

- **编译器差异干扰匹配**：现象——同源码不同编译器编译被判不相似；原因——优化/代码生成差异；对策——用调用图与常量引用加权，降低指令哈希权重
- **strip 后符号缺失**：现象——函数名全无；原因——符号剥离；对策——结构匹配（入口特征/调用模式）、导入表锚定
- **跨架构对比降级**：现象——x86 vs ARM 匹配率低；原因——指令集不同；对策——只比逻辑层（调用图/常量/字符串），标注跨架构局限
- **大量相似导致误关联**：现象——共享库代码导致虚高相似度；原因——公共依赖（libc/框架）；对策——排除共享库符号，只比业务代码
- **补丁 diff 定位偏差**：现象——changed 函数多，漏洞点被淹没；原因——补丁含重构；对策——按变更语义过滤（新增校验/边界处理优先）
