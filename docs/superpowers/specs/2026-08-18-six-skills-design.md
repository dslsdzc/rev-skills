# 6 个单开技能设计（2026-08-18）

## 背景

rev-skills（91 技能）经扩展方向调研，确认 6 个方法论独特、值得单开的技能。用户确认全部新增。

设计约束（沿用全库红线与原则）：
- **红线 1 呈现中性**：禁用「最推荐」「强烈建议」等最高级强推措辞
- **红线 2 隐私脱敏**：内容不指向具体项目/公司/产品（攻击者身份归因只写方法不写真实案例）
- **不绑定具体工具**：方法为核心，工具为可替换示例（工具准备章节保留跨 OS 安装指引）
- 工作区有 4 个未提交文件（re-binary-core / re-mobile / re-protocol 的 SKILL.md、README.md）——各提交不得包含它们；re-binary-core 网关子技能列表挂载时**叠加编辑**该文件需谨慎（该文件有用户未提交改动，挂载行写入会与用户改动共存于工作区，提交时只 add 本任务文件会连同用户改动——**改用 git add 后以 patch 粒度提交或由用户确认**，实施时控制器处理）

## 变更总览

| # | 新技能 | 类型 | 挂载 | 计数 |
|---|---|---|---|---|
| 1 | re-cpp-abi | 原子 | re-binary-core 网关 | 92 |
| 2 | re-macos | 原子 | 独立 | 93 |
| 3 | re-attribution | 原子 | re-forensics 网关 | 94 |
| 4 | re-hw-chip | 原子 | 独立 | 95 |
| 5 | re-ai-attack | 原子 | 独立 | 96 |
| 6 | re-sdr | 原子 | 独立 | 97 |

最终：97 技能 = 1 入口 + 12 网关 + 84 原子。

## ① re-cpp-abi（挂 re-binary-core）

- **定位**：现代 C++ 二进制（异常/RTTI/模板/lambda）反编译混乱时的专门恢复方法
- **frontmatter**：`name: re-cpp-abi`；触发词：C++逆向、RTTI、虚表恢复、异常处理、C++ ABI、mangling
- **章节**（按 docs/skill-template.md 原子技能规范）：
  1. 何时使用 / 何时不用——用：RTTI/异常表密集的二进制、反编译结果混乱的 C++ 目标；不用：C 代码/纯汇编（走 re-binary-core 通用路径）
  2. 工具准备——readelf / llvm-objdump（节表与异常表）、gdb（异常断点）、c++filt / undname（mangling 解码）、Ghidra/IDA 脚本（RTTI 遍历）；跨 OS 安装命令
  3. 操作步骤——
     1. ABI 识别（Itanium vs MSVC：mangling 特征 `_ZN...` / `??_...`）
     2. RTTI 重建（_RTTICompleteObjectLocator / _RTTITypeDescriptor 链 → 类继承图）
     3. 虚表恢复（vtable 定位、类关系反推、调用点定名）
     4. 异常处理表（.pdata/.xdata、SEH/C++ EH 表 → 控制流恢复）
     5. 模板/lambda 识别（符号特征与调用模式）
     6. mangling 解码（c++filt / undname 批量）
  4. 跨域联合——[[re-binary-core]] 网关调用；[[re-ghidra]] / [[re-ida]] 反编译底座；[[re-deobfuscate]] 混淆衔接
  5. 常见坑与陷阱——ABI 误判导致 RTTI 解析失败、异常表版本差异、模板展开导致的符号爆炸、lambda 局部类无 RTTI
- **挂载**：re-binary-core 子技能列表加 re-cpp-abi；rerouting A 表 RTTI 行改 [[re-cpp-abi]]（去「待建」）

## ② re-macos（独立）

- **定位**：macOS 原生应用逆向——App Bundle / 签名公证 / entitlements / 沙箱 / 钥匙串与 Secure Enclave
- **frontmatter**：触发词：macOS逆向、mac app、entitlements、Secure Enclave、钥匙串、TCC、codesign
- **章节**：
  1. 何时使用 / 何时不用——用：macOS 原生/闭源应用、带签名公证与沙箱的目标；不用：iOS 应用（转 [[re-ios]]）
  2. 工具准备——codesign / spctl / otool / lipo（签名与 Mach-O 工具）、Hopper/IDA/Ghidra、lldb；跨 OS（macOS 为主，Linux 可分析 Mach-O 静态）
  3. 操作步骤——
     1. 包结构（App Bundle、Info.plist、签名/公证检查 `codesign -dv` / `spctl -a`）
     2. entitlements 与沙箱（`codesign -d --entitlements`、沙箱 profile、TCC 权限库）
     3. 钥匙串与 Secure Enclave（钥匙串 ACL、可访问性类、硬件密钥——getEncoded 不可用的等效场景）
     4. dyld 加载链（LC_*、注入面、Dylib Hijacking）
     5. 反调试与保护（taskgated、代码签名校验对抗、Gatekeeper 绕过面分析）
  4. 跨域联合——[[re-ios]] 互补（iOS 越狱生态）；[[re-format-macho]] 格式底座；[[re-lldb]] 调试
  5. 常见坑与陷阱——签名校验在多处（加载/运行/更新）、TCC 权限数据在系统库、Secure Enclave 密钥不可提取、公证检查离线不可复现
- **挂载**：独立；re-ios 跨域联合加引用

## ③ re-attribution（挂 re-forensics）

- **定位**：威胁归因方法论——从线索到攻击者身份的推理链（区别于 re-ti 的情报查询）
- **frontmatter**：触发词：归因、APT、attribution、攻击者身份、基础设施图谱、钻石模型
- **章节**：
  1. 何时使用 / 何时不用——用：情报归因请求、基础设施关联分析；不用：单个 IOC 查询（转 [[re-ti]]）
  2. 工具准备——关联查询工具（Passive DNS、证书透明日志、Whois）、MISP、图分析工具；跨 OS 安装
  3. 操作步骤——
     1. 钻石模型（受害者/基础设施/能力/对手四角关系）
     2. 基础设施图谱（域名/IP/证书/Whois 关联聚类）
     3. 能力与样本归因（代码复用、TTP 对比、时间线对齐）
     4. 置信度分级（低/中/高 + 证据链，避免过度归因）
     5. 报告（脱敏、声明边界）
  4. 跨域联合——[[re-ti]] 情报输入；[[re-ioc]] 指标提取；[[re-behavior]] 行为证据
  5. 常见坑与陷阱——基础设施重叠导致的误归因、跳板机≠归属、置信度虚高、脱敏红线
- **挂载**：re-forensics 网关子技能列表加 re-attribution

## ④ re-hw-chip（独立）

- **定位**：物理层硬件逆向——芯片解密、PCB 电路分析、硬件木马检测
- **frontmatter**：触发词：芯片逆向、去封装、decapping、PCB、硬件木马、电路分析、裸片
- **章节**：
  1. 何时使用 / 何时不用——用：物理芯片/板级分析（固件提取失败后的物理层）；不用：固件级分析（转 [[re-fw-extract]] / [[re-hardware-io]]）
  2. 工具准备——显微镜/探针台、decapping 设备与耗材、逻辑分析仪、热成像；耗材类工具给选购指引
  3. 操作步骤——
     1. 去封装（化学/激光 decap，风险控制与防护）
     2. 裸片分析（显微成像、金属层/ROM 提取）
     3. 探针与信号提取（FIB 修改、总线嗅探）
     4. PCB 电路分析（走线还原、IC 标识、JTAG/SWD 引脚定位）
     5. 硬件木马检测（冗余逻辑、触发器特征、功耗/时序异常）
  4. 跨域联合——[[re-hardware-io]] 接口提取衔接；[[re-fw-extract]] 固件侧；[[re-sdr]] 无线侧
  5. 常见坑与陷阱——decap 破坏性不可逆、探针负载改变信号、FIB 高成本、木马误报
- **挂载**：独立；re-hardware-io 跨域引用

## ⑤ re-ai-attack（独立）

- **定位**：AI 模型攻击与取证——提取攻击、指纹/水印、成员推断
- **frontmatter**：触发词：模型提取、模型窃取、水印检测、模型指纹、成员推断、对抗样本
- **章节**：
  1. 何时使用 / 何时不用——用：模型泄露/窃取取证、API 模型攻击评估；不用：模型文件格式解析（转 [[re-ai-model]]）
  2. 工具准备——python3、ML 工具链（torch/tf）、查询接口客户端；跨 OS 安装
  3. 操作步骤——
     1. 模型提取攻击（API 查询蒸馏、输出分布重建、置信度利用）
     2. 模型指纹/水印（嵌入检测、指纹提取、窃取取证）
     3. 成员推断（训练数据泄露判定）
     4. 对抗样本基础（黑盒/白盒扰动）
  4. 跨域联合——[[re-ai-model]] 格式与权重侧；[[re-feedback]] 经验（攻击案例脱敏沉淀）
  5. 常见坑与陷阱——查询预算限制、置信度不可得时降级、水印被抹除、成员推断误报
- **挂载**：独立；re-ai-model 跨域引用

## ⑥ re-sdr（独立）

- **定位**：射频逆向——信号采集、解调、协议帧恢复
- **frontmatter**：触发词：SDR、射频、信号分析、解调、RTL-SDR、HackRF
- **章节**：
  1. 何时使用 / 何时不用——用：无线协议/遥控/遥测信号；不用：有线协议（转 [[re-protocol]]）
  2. 工具准备——RTL-SDR/HackRF、GNU Radio、inspectrum、Universal Radio Hacker (URH)；跨 OS 安装
  3. 操作步骤——
     1. 信号采集与频谱分析（中心频率/带宽/调制识别）
     2. 解调（AM/FM/PSK/QAM/FSK）
     3. 帧同步与协议恢复（preamble、同步字、URH 位流恢复）
     4. 重放与交互（授权测试场景）
  4. 跨域联合——[[re-iot-proto]] 无线 IoT 协议衔接；[[re-feedback]] 经验沉淀
  5. 常见坑与陷阱——频率偏移/采样率错误、调制误判、重放需授权、法律边界
- **挂载**：独立；re-iot-proto 跨域引用

## 同步

- rerouting A 表 RTTI 行：`（re-cpp-abi 待建，先走 [[re-binary-core]]）` → `[[re-cpp-abi]]`
- README：技能导航（91）→（97）、「12 大类网关 → 78 原子技能」→ 84、导航加 6 行
- AGENTS.md：（91 个技能）→（97 个技能）、原子技能（78）→（84）
- marketplace.json：91 个技能 → 97 个技能
- re-binary-core 网关子技能列表加 re-cpp-abi（**该文件有用户未提交改动——提交粒度由控制器处理**）
- re-forensics 网关子技能列表加 re-attribution
- re-ios / re-hardware-io / re-ai-model / re-iot-proto 跨域联合各加一行引用

## 校验与测试

- validate.mjs 自动覆盖 6 个新技能（frontmatter name=目录名 / type=atomic / 工具准备 / 链接）
- `npm test` 全绿（97 skills validated）
- rerouting A 表 RTTI 行改 [[re-cpp-abi]] 后链接可解析
- 不触碰工作区 4 个未提交文件（re-binary-core 网关挂载例外，控制器处理提交粒度）
