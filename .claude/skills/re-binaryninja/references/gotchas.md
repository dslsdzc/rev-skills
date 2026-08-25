# Binary Ninja 工具特有坑与边界

## 版本差异

- **Python API 与软件版本强绑定**：API 不随软件自动同步——重装软件或升级后必须重跑安装目录 `install_api.py`，否则 `import binaryninja` 指向旧版 API，行为与文档不符（最常见故障源）
- **主版本间 API 变化**：2.x → 3.x（类型 API 重构）→ 4.x 各有破坏性变更——脚本依赖先查 `core_version()` 与对应版本文档；旧插件在新主版本下可能直接加载失败
- **`i` 键是 IL 循环，`m` 不是**：`m` 在官方文档里是「整数应用枚举显示」（类型操作）——网上流传的「m 切 MLIL」说法与现行版本不符，切 IL 用 `i` 或右下角 Options 菜单
- **插件兼容性**：插件按主版本编译/适配——`File > Manage Plugins` 里标记版本要求的插件，跨主版本升级后逐个验证

## 个人版限制

- **无 headless 自动化**：`binaryninja.headless` 与 `binaryninja-headless` CLI 是商业版能力，个人版导入即报错——个人版用 GUI 内 `File > Python` 面板跑脚本
- **自动化频次/规模限制**：个人版对脚本自动化（批量跑、无头操作）有使用限制，license 条款约束个人用途——批量任务先评估是否超限，超限用 [[re-ghidra]] analyzeHeadless（免费）替代
- **商业版功能裁剪**：部分插件要求商业版；`Options > About` 确认 license 类型，别在个人版上排查商业功能故障

## 分析质量坑

- **MLIL 对混淆失真**：花指令/控制流平坦化破坏数据流重建——反编译出现死代码/恒假条件时降 LLIL/汇编核对，或先 [[re-deobfuscate]]
- **大二进制首次分析慢**：100MB+ 样本默认分析 pass 全开可达数分钟——`Options > Analysis` 按需关 pass，或对重点函数用 `f.analysis_skip_override` 思路做局部分析
- **带壳样本直接分析=假结果**：壳区不解密，函数识别乱——先 [[re-packer-id]] / [[re-anti-analysis]] 脱壳再导入
- **无头模式分析不自动跑**：`binaryninja.load()` 后必须 `update_analysis_and_wait()`——GUI 自动分析，无头不自动，忘了这行所有结果都是空的

## 插件与路径坑

- **macOS 插件目录特殊**：`~/Library/Application Support/Binary Ninja/plugins`——不是 `~/.binaryninja/plugins`（Linux 才是），放错位置插件不加载
- **Windows 插件目录**：`%APPDATA%\Binary Ninja\plugins`——不要放安装目录下（权限/升级覆盖问题）
- **cask 安装的 macOS 版**：`brew install --cask binary-ninja` 安装的是 GUI 应用，Python API 仍需在应用目录跑 `install_api.py` 注册到你的 Python 环境

## 使用注意

- 全部在沙箱内执行（[[platform-tips]] 最高原则）；脚本触发动态执行默认沙箱内
- 换栈（Ghidra/IDA ↔ BN）无工程互导格式——标注靠脚本统一命名规范，或按函数手搬
- 版本相关行为以 `Options > About` 与 `core_version()` 实际值为准
