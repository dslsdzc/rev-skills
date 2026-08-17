# 中途再路由机制设计（2026-08-18）

## 背景与问题

rev-skills（91 技能）的入口流程（re-analyze：探测 → 偏好 → 识别 → 编排）是一次性的：执行中遇到**新证据类型**（发现加壳、加密、反调试、行为异常）时，agent 不会回头重跑任务识别再调对应技能，而是自行硬琢磨。现有「检查新证据」只有一句建议性表述（triage.md:31「每个环节完成后检查是否有新证据改变后续路径」、re-analyze:43「每个环节完成后检查新证据」），无强制机制、无触发表、不可执行。

**结果**：技能库存在但分析中途不触发——这是技能库价值闭环的核心缺口。

## 目标

建立「中途再路由」机制：分析过程中，证据特征出现即触发对应技能；网关完成必查；未命中时按约束换路，禁止无限硬琢磨。

## 设计

### ① 新建 `re-analyze/references/rerouting.md`（证据→技能触发表）

**定位**：运行时证据触发的唯一事实源（区别于 triage.md 的入口「目标→路径」决策表）。

**A 表：证据特征 → 触发技能**（分析中看到什么 → 调什么）：

| 证据特征（分析中看到） | 触发技能 |
|---|---|
| 节表异常（UPX0/.aspack）、熵 >7.0 | [[re-packer-id]] → [[re-anti-analysis]] |
| 未知加密算法、S-box/常量指纹、加密流量 | [[re-crypto-id]] |
| 硬编码密钥/口令、内存中的 key | [[re-crypto-keys]] |
| 解密函数已定位、密文可还原 | [[re-crypto-decrypt]] |
| 反调试/反 VM 特征（ptrace、CPUID、时间检测） | [[re-evasion]] / [[re-anti-analysis]] |
| 动态注册 JNI、so 函数级加密 | [[re-android-native]] |
| 混淆（CFF/花指令/字符串加密） | [[re-deobfuscate]] |
| 网络回连/信标/C2 特征 | [[re-netcap]] → [[re-behavior]] |
| 持久化/注入/进程树异常 | [[re-behavior]] |
| 崩溃/段错误/ASAN 报告 | [[re-crash-triage]] |
| Python 打包特征（PyInstaller/PyArmor） | [[re-python]] |
| Flutter/RN 引擎特征 | [[re-hybrid-app]] |
| 加固商特征（加固壳） | [[re-mobile-pack]] |
| RTTI/异常表（.pdata/.xdata）密集 | （re-cpp-abi 待建，先走 [[re-binary-core]]） |

**B 表：卡住信号 → 换路**（防硬琢磨）：

| 卡住信号 | 换路 |
|---|---|
| 同参数重复 ≥2 次无新证据 | 对照 A 表重查 / 换工具视角（[[analysis-contract]] 调查预算） |
| 单命令 ≥3 次无进展 | 停下评估，重跑 re-analyze 第二步（任务识别）或换网关 |
| 分析超 30 次工具调用无结论 | 回退到最近有产出的环节，按复核格式交付部分结论 |
| 目标行为与静态结论矛盾 | 动态侧 [[re-sandbox]] / [[re-tracing]] 对照 |

**使用规则**：每产出新证据类型 → 查 A 表命中即调技能；每网关完成 → 查 A+B 表；未命中 → 按 B 表约束行动，禁止无限硬琢磨。

### ② re-analyze/SKILL.md 第三步改双轨强制

现状（一句建议）改为：

```
第三步编排分派（双轨再路由）：
- 轨 1（网关完成必查）：每网关完成后，对照 rerouting.md 的 A/B 表检查新证据；命中 → 调用对应技能，完成后回到轨 1 继续
- 轨 2（证据出现即查）：分析中每产出新证据类型（字符串/节表/行为/加密特征），立即对照 A 表；命中 → 调用技能
- 未命中任何表项 → 按 B 表约束行动（换思路/回退/交付部分结论），禁止自行硬琢磨
```

### ③ 两个引用点

- `analysis-contract.md`：加一行「中途再路由：证据触发按 [[rerouting]]（双轨），命中即调技能」
- `triage.md:31`：原「每个环节完成后检查是否有新证据改变后续路径」改为指向 [[rerouting]]（统一事实源）

### ④ re-analyze 常见坑加一条

- **走完入口不再调用技能**：现象——入口编排后自己硬琢磨，中途发现新特征（壳/加密/反调试）不调对应技能；原因——再路由未执行；对策——按第三步双轨：每网关完成/每新证据对照 [[rerouting]] 触发表，命中即调

## 校验

- `npm test` 全绿（91 skills 不变，无新增技能）
- rerouting.md 的 [[链接]] 全部指向已存在技能；re-cpp-abi 未建（触发表该行用文字标注待建，不写死链）
- 不触碰工作区未提交文件（re-binary-core / re-mobile / re-protocol SKILL.md、README.md）

## 范围外（后续子项目）

- 6 个单开技能（re-cpp-abi / re-macos / re-attribution / re-hw-chip / re-ai-attack / re-sdr）
- 7 处融入（区块链进阶 / 汽车 IVI-V2X / JS 高级混淆 / 容器镜像 / 内核利用 / 指令级追踪 / 数据库格式）
- 均各自独立 brainstorm → spec → plan
