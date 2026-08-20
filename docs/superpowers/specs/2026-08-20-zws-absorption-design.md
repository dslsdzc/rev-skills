# zws 收藏库经验吸收设计（2026-08-20）

## 背景

收藏型 GitHub 账号 `123456789zws`（4432 个 fork，全 RE 主题）暴露了中文 RE 圈的高密度工具/技能索引。从中挑选 7 个高价值仓库克隆并深挖（素材挖掘 7 代理完成，产出 99 条候选，存于 /home/DslsDZC/rev-refs/extract-zws-*.md，均已脱敏）。

用户决策：**全吸收**。

## 素材清单与许可分级

| 素材 | 许可 | 候选数 | 吸收规则 |
|---|---|---|---|
| reverse-skills（inliver233） | MIT | 28 | 注明来源吸收 |
| ReVa（cyberkaida） | Apache-2.0 | 15 | 注明来源吸收 |
| hermes-decomp（SymbioticSec） | MIT | 16 | 注明来源吸收 |
| Cpp2IL（SamboyCoding） | MIT | 9 | 注明来源吸收 |
| chernobog（19h） | 无许可 | 16 | 只蒸馏，不注源 |
| pyarmor-research（Fadi002） | 无许可 | 10 | 只蒸馏，不注源 |
| LazyReverse（a0yami） | MIT | 5 | 注明来源吸收 |

## 变更总览（99 候选 → 裁剪 ~40 入库）

| # | 目标技能 | 素材 | 吸收条目（执行时查重裁剪） |
|---|---|---|---|
| 1 | re-flutter | reverse-skills | 对象池 VLE 反序列化（条目4）、字符串双编码（5）、池槽→.text xref 桥（6）、cid 虚拟分派墙（7）、Dart AOT ABI/bool 编码（8）、Dart False≠0 patch 陷阱（10）、弹窗三源分诊（13）、平台通道 stub 陷阱（14）、万级函数分诊（17）、状态链追踪（18）→ 挑 6-8 条 |
| 2 | re-hybrid-app | hermes-decomp | 函数表/边界定位（2）、字符串表解析（3）、版本化指令集（5）、寄存器→变量还原（7）、转译产物去抽象（10）、Metro 模块层（11）、字节码写回补丁（14）、已知限制（15）→ 挑 5-7 条 |
| 3 | re-script-deob | hermes-decomp | 转译去抽象（10 兼）、写回补丁（14 兼）→ 1-2 条 |
| 4 | re-game | Cpp2IL | 双文件结构模型（1）、版本识别考古（2）、注册结构定位（3）、篡改对抗（5）、反编译管线（6）、已知限制（8）→ 挑 4-5 条 |
| 5 | re-deobfuscate | chernobog | dispatcher 识别（1）、Z3 状态机求解（3）、CFG 重构护栏（5）、不透明谓词证据纪律（8）、LLM 编排纪律（12/13）、混合分析（14/15）→ 查重后挑 4-6 条 |
| 6 | re-python | pyarmor-research | 保护模型（1）、载体识别（2）、密钥派生还原（3）、marshal 重建（5）、运行时解密窗口（7）、版本差异（9）→ 挑 4-5 条 |
| 7 | re-patching | reverse-skills | patch 四原语（9）、爆炸半径（11）、safe-NOP（12）→ 2-3 条 |
| 8 | re-mobile-pack | reverse-skills | 加固识别/重打包黑屏（20）、三条交付路径（21）→ 2 条 |
| 9 | re-apk | reverse-skills | repack 闭环（19）、签名校验链（25）→ 2 条 |
| 10 | re-frida | reverse-skills | 测试环境决策树（22）、redroid 搭建（23）、Frida 流程（24）→ 2-3 条 |
| 11 | re-analyze references | ReVa | 工具粒度（1）、schema 宽容（2）、错误重定向（3）、context rot 抑制（4）、后台作业+轮询游标（8）、脚本逃逸舱（13）、证据纪律（10）→ 3-5 条（进 references 或坑） |
| 12 | re-dotnet | LazyReverse | dnSpy 无头批量（1）→ 1 条 |
| 13 | re-ida | LazyReverse | IDA 无头批量（2）→ 1 条 |
| 14 | re-feedback | reverse-skills | 工具前置断言（26）、多代理协作（27）→ 1-2 条 |

## 吸收格式与规则

**坑格式**：`**标题**：现象——…；原因——…；对策——…`（与全库体例一致，追加进「## 常见坑与陷阱」）

**查重规则**：入库前 `grep -n <关键词> <目标技能>/SKILL.md`（含 references/）；同现象已存在 → 跳过；内容更完整的深化版本 → 合并。re-deobfuscate 覆盖已高，执行时最严格。

**来源注明**（仅 MIT/Apache 素材）：
- reverse-skills → `（来源：reverse-skills（inliver233），MIT）`
- ReVa → `（来源：ReVa（cyberkaida），Apache-2.0）`
- hermes-decomp → `（来源：hermes-decomp（SymbioticSec），MIT）`
- Cpp2IL → `（来源：Cpp2IL（SamboyCoding），MIT）`
- LazyReverse → `（来源：LazyReverse（a0yami），MIT）`
- chernobog / pyarmor-research → 不注源（无许可蒸馏）

**改写规则**：不逐字复制——按现象/原因/对策改写；素材已脱敏，入库时再逐条对照红线 2（无具体项目/公司/产品暗示）

## 红线（沿用全库）

- 红线 1 呈现中性：禁「最推荐/强烈建议」，最多「推荐」
- 红线 2 隐私脱敏：素材已脱敏，入库抽查
- 不绑定具体工具：方法为核心；工具名（blutter/capstone/frida/dnSpy/IDA 等公开工具）可保留
- 每条入库后 `npm test` 全绿（112 不变——融合吸收不改技能数）

## 校验

- 每任务：查重 → 追加坑条目（+来源注明）→ 脱敏对照 → npm test → commit
- 终审：全波次复核 + 技术事实抽查（VLE 编码、Hermes 位域头、IL2CPP metadata 版本、CFF dispatcher、PyArmor 运行时、ReVa 工具设计）

## 范围外

- 不新增技能（全部融合进现有技能与 references）
- MCP 服务类仓库（reversing-mcp 等收藏）——本轮只吸收方法论，不引入 MCP 工具绑定
