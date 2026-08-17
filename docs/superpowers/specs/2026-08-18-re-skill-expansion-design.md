# rev-skills 能力新增设计（2026-08-18）

## 背景

rev-skills（89 技能 = 1 入口 + 12 网关 + 76 原子）经四库拆解与技能级对标调研（ctf-skills / headless-ghidra / Android-Pentesting-Skill / android-reverse-engineering-skill 等），识别出 5 项生态已有、本库缺失的能力。用户确认全部新增。

设计约束（沿用全库红线与原则）：
- **红线 1 呈现中性**：禁用「最推荐」等强推措辞
- **红线 2 隐私脱敏**：内容不指向具体项目/公司/产品
- **不绑定具体工具**：方法为核心，工具为可替换示例（工具准备章节保留跨 OS 安装指引）
- 工作区有 3 个未提交文件（re-binary-core / re-mobile / re-protocol 的 SKILL.md）——各提交不得包含它们

## 变更总览

| # | 项 | 类型 | 计数影响 |
|---|---|---|---|
| 1 | re-python | 新原子技能（挂 re-managed） | 90 |
| 2 | re-frida-script-author | 新原子技能 | 91 |
| 3 | Keystore 审计 | 并入 re-android-native | — |
| 4 | Flutter MethodChannel 拦截 | 并入 re-hybrid-app | — |
| 5 | svc 裸系统调用检测 | 并入 anti-dynamic-workflow.md | — |

最终：91 技能 = 1 入口 + 12 网关 + 78 原子。

## ① re-python（新原子技能）

- **定位**：Python 打包/混淆样本分析——PyInstaller / PyArmor / Nuitka / Cython / pyc
- **frontmatter**：`name: re-python`，description 含触发词：Python打包、PyInstaller、PyArmor、pyc、python exe、Python 样本
- **章节**（按 docs/skill-template.md 原子技能规范）：
  1. 何时使用 / 何时不用——用：PyInstaller 单文件/目录 exe、PyArmor 加固、.pyc 样本、Nuitka/Cython 编译产物；不用：纯 .py 源码混淆（转 [[re-script-deob]]）
  2. 工具准备——pyinstxtractor（pip 或脚本）、PyArmor-Unpacker（按版本选法）、pycdc / pycdas、python3、file；各工具跨 OS 安装命令
  3. 操作步骤——
     1. 识别打包器：`file` + strings 特征（PyInstaller 的 `PyInstaller`/`_MEI` 字符串、PyArmor runtime 特征）
     2. PyInstaller 解包：pyinstxtractor 提取归档，定位主 .pyc
     3. PyArmor 解包：按 PyArmor 版本选 PyArmor-Unpacker 三方法之一
     4. pyc 版本识别：magic 号对照表（按 struct.unpack 读头 4 字节，对照 Python 版本）
     5. 清理 confusion code：删假函数/死代码，定位核心加密/外泄逻辑
  4. 跨域联合——[[re-managed]] 网关调用；纯脚本混淆转 [[re-script-deob]]；恶意场景转 [[re-malware]]；pyc 深度还原转 [[re-binary-core]]
  5. 常见坑与陷阱——pyc 版本不匹配、PyArmor 版本差异、Cython 产物无 pyc、假函数干扰定位
- **挂载**：re-managed 选择树加分支「.exe 且含 PyInstaller/PyArmor 特征 → [[re-python]]」

## ② re-frida-script-author（新原子技能）

- **定位**：目标特征 → Frida 脚本生成方法论（探 → 选 → 改 → 验）；独立于 re-frida 的执行操作（用户确认独立技能）
- **frontmatter**：`name: re-frida-script-author`，description 含触发词：生成Frida脚本、写hook脚本、frida脚本怎么写、写个hook
- **章节**：
  1. 何时使用 / 何时不用——用：需要新脚本时（拦截/绕过/追踪）；不用：执行现成脚本（转 [[re-frida]]）
  2. 工具准备——frida-tools、python3、目标设备/模拟器；模板素材 [[frida-scripts]]
  3. 操作步骤——
     1. 目标侦察：静态特征（目标 API/类名/加固商）+ 基线行为（崩溃迭代法，见 [[anti-dynamic-workflow]]）
     2. 检测点/目标 API 识别：加密 → 拦截模板；证书固定 → SSL 模板；双向 TLS → keystore 模板；反调试 → 检测绕过模板
     3. 模板选择：按 [[frida-scripts]] 模板表选骨架
     4. 改写：包名/类名/方法名/overload 精确匹配（保存 original、带 this 调用）
     5. 验证：spawn + `--pause` 跑通，输出 JSON 可解析，失败回退步骤 2
  4. 跨域联合——[[re-frida]] 执行；[[re-mobile]] / [[re-android-native]] 场景衔接；[[anti-dynamic-workflow]] 对抗面
  5. 常见坑与陷阱——overload 不匹配静默失效、Java.use 缓存覆盖、参数索引版本相关、先探后写不猜
- **挂载**：re-frida 跨域联合加「脚本生成 → [[re-frida-script-author]]」

## ③ Keystore 审计（并入 re-android-native）

re-android-native 加「Keystore 审计」章节：
- AndroidKeyStore 遍历：`KeyStore.getInstance("AndroidKeyStore")` → `aliases()` 枚举
- 条目属性：算法/用途/来源（KeyInfo 的 isInsideSecureHardware——TEE vs StrongBox 区分）
- 用途判断：签名密钥 / 加密密钥 / 生物绑定（setUserAuthenticationRequired）
- 与 hook 的衔接：加密拦截时若密钥来自 Keystore，`getEncoded()` 不可用——记录别名与用途而非密钥字节

## ④ Flutter MethodChannel 拦截（并入 re-hybrid-app）

re-hybrid-app 加「Flutter MethodChannel 动态拦截」章节：
- hook `io.flutter.plugin.common.MethodChannel` 的 MethodCallHandler（channel 名/方法名/参数 JSON 记录）
- engine messenger 层拦截（平台通道消息）
- 与 Dart 侧静态观察互补（channel 名与调用点）

## ⑤ svc 裸系统调用检测（并入 anti-dynamic-workflow.md）

anti-dynamic-workflow.md 加「裸系统调用检测」节：
- 原理：目标自实现系统调用绕过 libc，基于 libc 符号的 hook 与检测失效
- 手法：按架构分支特征码（arm64 SYS_OPEN=56、svc 机器码 `01 00 00 D4`；arm SYS_OPEN=5、`00 00 00 EF`）
- 可执行段扫描（r-x）过滤 .so 段 → Memory.scan 特征码 → 回读 svc 前一条指令取系统调用号 → 命中 SYS_OPEN 才 attach → 打印文件名与返回值
- 注意：arm64 分支参数索引按系统调用约定核对

## 计数同步

- README：技能导航（89）→（91）；「12 大类网关 → 76 原子技能」→ 78；导航列表加 re-python / re-frida-script-author 两行
- AGENTS.md：（89 个技能）→（91 个技能）
- marketplace.json：description「89 个技能」→「91 个技能」
- re-managed / re-frida 挂载（见 ①②）

## 校验与测试

- validate.mjs 自动覆盖两个新技能（frontmatter name=目录名 / type=atomic / 工具准备章节 / [[链接]] 完整性）
- `npm test` 全绿（91 skills validated）
- 手工验证：新技能 frontmatter 触发词有效、挂载链接可解析
- 不触碰工作区 3 个未提交文件；提交按文件粒度
