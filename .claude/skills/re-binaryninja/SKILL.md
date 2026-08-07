---
name: re-binaryninja
description: >
  Binary Ninja 工作流：MLIL、脚本 API。触发词：Binary Ninja、binaryninja、bn、MLIL
---

# Binary Ninja 逆向工作流

## 何时使用 / 何时不用

- 用：需要 MLIL 中间语言（比裸反汇编可读得多）阅读函数逻辑；Python 脚本自动化标注/批处理；按预算选型（个人版/商业版）
- 用：`RE_DECOMPILER=binaryninja` 场景下作为反编译器
- 不用：已有 Ghidra/IDA 工作流且无选型动机（按 `RE_DECOMPILER` 会话变量，[[re-ghidra]] 默认）
- 不用：纯命令行快速分析（[[re-radare2]] 更轻）；无头批处理最简场景（[[re-ghidra]] analyzeHeadless 生态更成熟）

## 工具准备

参考 [[platform-tips]]——Binary Ninja 静态分析免沙箱；脚本触发动态执行时默认沙箱内。

### Binary Ninja（商业，有个人版）

- 下载/购买: 官网 binary.ninja（Commercial / Personal 个人版；个人版仅限个人用途，自动化与部分功能按版本受限）
- Windows: 安装器直接运行；macOS: `brew install --cask binary-ninja`（社区 cask，需已有 license）；Linux: 官网 tar 包解压运行 `./binaryninja`
- 验证: 打开任意样本完成自动分析，`Functions` 面板有函数列表；`Options > About` 显示 license 类型

### binaryninja Python API

- 安装: Binary Ninja 安装目录下运行 `python install_api.py`（把 API 注册进 Python 环境）；或 `pip install binaryninja`（需要匹配版本的已安装软件与 license）
- 验证: `python3 -c "import binaryninja; print(binaryninja.core_version())"` 输出与软件版本一致的版本号

## 操作步骤

1. **导入与分析**：
   - `File > Open` 选样本 → 自动分析（底部进度条）→ 左侧 `Functions` / `Data` / `References` 视图确认分析结果
   - 确认: 入口函数（entry）被识别、导入表（`Imports` 视图）有内容、字符串（`Strings` 视图）可见
   - 分析异常（函数少/字符串乱）→ 可能带壳，先 [[re-packer-id]] / [[re-anti-analysis]]

2. **MLIL 阅读**：
   - 双击函数进入反编译视图（默认 HLIL 高语言 IL）；菜单 `View > IL > MLIL`（或按键 `m`）切到 MLIL 中语言 IL
   - MLIL 特点: 变量显式化（`rax = rax ^ 0xdeadbeef`）、类型恢复、条件跳转语义化——比裸反汇编可读，重点函数先看 MLIL 再下结论
   - 反编译不清晰时降级: MLIL → LLIL（`View > IL > LLIL`，低语言 IL，保留指令级细节）→ 反汇编（`Space`/汇编视图）逐层核对

3. **重命名 / 类型**：
   - 重命名: 光标在符号/变量上 `n`（或右键 Rename）——函数、变量、全局数据均可
   - 改类型: `y`（如 `void *`、`DWORD`、`int (*)(void *, size_t)`），类型传播自动改善后续反编译质量
   - 定义结构体: `Types` 面板新建 Structure → 应用到变量/指针 → 字段名随类型传播进反编译视图

4. **Python 脚本（自动化标注）**：
   ```python
   import binaryninja
   bv = binaryninja.load("sample.bin")
   bv.update_analysis_and_wait()          # 无头模式：手动触发完整分析
   for f in bv.functions:
       if f.analysis_skip_reason is None and f.medium_level_il:
           n = len(list(f.medium_level_il.instructions))
           if n > 200:
               print(f"big function: {f.name} @ {hex(f.start)} len={n}")
   ```
   - 批量改名: `bv.get_function_at(0x401000).name = "check_license"` 后 `bv.save()` 写回
   - 插件: `File > Manage Plugins` 浏览社区插件；插件目录 `%APPDATA%/binaryninja/plugins`（Windows）/ `~/.binaryninja/plugins`（Linux/macOS）
   - 无头模式: 商业版可用 headless（`binaryninja.headless.main()` 或 CLI `binaryninja-headless`）；个人版受限时用 GUI 内 `File > Python` 面板执行同样代码

5. **对比选型（价格 / 插件生态）**：
   - 价格: Binary Ninja（商业付费，个人版便宜但限个人用途）vs [[re-ida]]（最贵）vs [[re-ghidra]]（免费开源）vs [[re-radare2]]（免费开源 CLI）
   - 生态: Ghidra 社区最大、脚本（Java/Python/无头）最成熟；IDA idapython 插件历史最久；Binary Ninja 插件数较少但 API 设计现代（Python 优先）
   - 决策: 预算敏感 → Ghidra/radare2；要 MLIL 可读性 + Python API → Binary Ninja；已有 IDA 授权 → 保持 IDA，本技能只在换栈时用

## 跨域联合

- [[re-binary-core]]：工作流第 5 步反编译器备选（`RE_DECOMPILER=binaryninja`）
- [[re-ctf]]：逆向题反编译与脚本求解
- [[re-malware]]：恶意样本深度分析（Python 批量标注导出）
- [[re-cracking]]：授权/校验算法还原
- [[re-kernel]]：驱动反编译可选工具（与 [[re-ghidra]] / [[re-ida]] 三选一）
- 与 [[re-ghidra]] / [[re-ida]] 间无直接工程互导格式，换栈时按函数手搬或脚本统一标注

## 常见坑与陷阱

- **MLIL 对混淆代码失真**：现象——花指令/控制流平坦化样本反编译出诡异结构（死代码、恒假条件）；原因——MLIL 基于数据流重建，混淆破坏控制流信息；对策——降到 LLIL/汇编交叉验证，或先 [[re-deobfuscate]] 再导入
- **脚本 API 版本差异**：现象——`import binaryninja` 报版本错/行为与文档不符；原因——pip 包与安装软件主版本不匹配（API 大版本间不兼容）；对策——重跑安装目录 `install_api.py` 对齐版本，`core_version()` 与 About 版本比对
- **无头模式用法**：现象——个人版 `binaryninja.headless` 不存在；原因——headless 自动化是商业版能力，个人版裁剪；对策——个人版用 GUI 内 `File > Python` 面板跑脚本，或脚本里只做 `load` + `update_analysis_and_wait` 的替代路径
- **大二进制首次分析慢/内存高**：现象——100MB+ 样本分析数分钟甚至卡死；原因——默认分析 pass 全开；对策——`Options > Analysis` 关掉多余 pass（如只保留 dataflow 与 decompile 需要的最小集），或只对重点函数做分析（`f.analysis_skip_override` 思路）
