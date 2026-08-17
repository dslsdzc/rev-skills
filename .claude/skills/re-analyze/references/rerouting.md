# 中途再路由触发表

运行时证据触发的唯一事实源（区别于 triage.md 的入口「目标→路径」决策表）。分析过程中按双轨使用：

- **轨 1（网关完成必查）**：每网关完成后对照 A/B 表检查新证据
- **轨 2（证据出现即查）**：每产出新证据类型（字符串/节表/行为/加密特征）立即对照 A 表
- **未命中** → 按 B 表约束行动，禁止自行硬琢磨

## A 表：证据特征 → 触发技能

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

## B 表：卡住信号 → 换路

| 卡住信号 | 换路 |
|---|---|
| 同参数重复 ≥2 次无新证据 | 对照 A 表重查 / 换工具视角（[[analysis-contract]] 调查预算） |
| 单命令 ≥3 次无进展 | 停下评估，重跑 re-analyze 第二步（任务识别）或换网关 |
| 分析超 30 次工具调用无结论 | 回退到最近有产出的环节，按 [[analysis-contract]] 复核格式交付部分结论 |
| 目标行为与静态结论矛盾 | 动态侧 [[re-sandbox]] / [[re-tracing]] 对照 |

## 使用规则

1. 每产出新证据类型 → 查 A 表，命中即调用对应技能，完成后回到轨 1 继续
2. 每网关完成 → 查 A+B 表
3. 未命中任何表项 → 按 B 表约束行动（换思路/回退/交付部分结论）
