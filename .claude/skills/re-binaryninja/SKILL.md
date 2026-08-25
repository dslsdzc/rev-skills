---
name: re-binaryninja
description: >
  Binary Ninja 工作流：MLIL、脚本 API。触发词：Binary Ninja、binaryninja、bn、MLIL
---

# Binary Ninja 逆向工作流

## 何时使用 / 何时不用

- 用：需要 MLIL 中间语言（比裸反汇编可读得多）阅读函数逻辑；Python 脚本自动化标注/批处理；按预算选型（个人版/商业版）
- 用：需要 DFG 数据流图（寄存器/常量传播路径可视化）追踪单条数据的流向（密钥、标志位）
- 用：多架构目标（x86/ARM/MIPS/RISC-V/PowerPC 等常见架构均支持，移动/嵌入式目标可直接分析）
- 用：`RE_DECOMPILER=binaryninja` 场景下作为反编译器
- 不用：已有 Ghidra/IDA 工作流且无选型动机（按 `RE_DECOMPILER` 会话变量，[[re-ghidra]] 默认）
- 不用：纯命令行快速分析（[[re-radare2]] 更轻）；无头批处理最简场景（[[re-ghidra]] analyzeHeadless 生态更成熟）
- 不用：动态调试为主的目标（BN 内置调试器处于实验阶段——调试走 [[re-gdb]] / [[re-x64dbg]] / [[re-lldb]]）
- 不用：个人版做大规模无头自动化（headless 是商业版能力，见 [[gotchas]]）

## 工具准备

参考 [[platform-tips]]——Binary Ninja 静态分析免沙箱；脚本触发动态执行时默认沙箱内。

### Binary Ninja（商业，有个人版）

- 下载/购买: 官网 binary.ninja（Commercial / Personal 个人版；个人版仅限个人用途，自动化与部分功能按版本受限）
- Windows: 安装器直接运行；macOS: `brew install --cask binary-ninja`（社区 cask，需已有 license）；Linux: 官网 tar 包解压运行 `./binaryninja`
- 容器格式: 直接导入 PE/ELF/Mach-O/Dalvik/固件 ROM 等（不需要单独解包步骤）；带壳目标例外（壳段未解密，先脱壳）
- 验证: 打开任意样本完成自动分析，`Functions` 面板有函数列表；`Options > About` 显示 license 类型
- Linux 无图形环境: GUI 版需要 X 显示（`xvfb-run ./binaryninja` 可临时跑）；批量任务直接走 headless（商业版），headless 不需要显示器
- 版本差异: 3.x/4.x 间 Python API 大体兼容但个别函数签名变化——脚本依赖先看 `core_version()` 与发行说明（见 [[gotchas]]）

### binaryninja Python API

- 安装: Binary Ninja 安装目录下运行 `python install_api.py`（把 API 注册进 Python 环境；PyPI 无 binaryninja 包，`pip install binaryninja` 会失败）
- 安装脚本会检测/提示匹配的 Python 版本——版本不匹配时脚本报错或注册失败，按提示换 Python 版本
- 验证: `python3 -c "import binaryninja; print(binaryninja.core_version())"` 输出与软件版本一致的版本号
- 无头 CLI（商业版）: `binaryninja-headless --help` 有输出；脚本化入口 `python -c "from binaryninja import headless; ..."`

## 操作步骤

1. **导入与分析**：
   - `File > Open` 选样本 → 自动分析（底部进度条）→ 左侧 `Functions` / `Data` / `References` 视图确认分析结果
   - 确认: 入口函数（entry）被识别、导入表（`Imports` 视图）有内容、字符串（`Strings` 视图）可见
   - 分析异常（函数少/字符串乱）→ 可能带壳，先 [[re-packer-id]] / [[re-anti-analysis]]
   - 分析选项: `Options > Analysis` 勾选/关闭 pass——首次导入大文件或带混淆样本时先看这里，默认全开会慢

2. **MLIL 阅读（IL 视图切换）**：
   - 双击函数进入反编译视图（默认 HLIL 高语言 IL）；`i` 在反汇编/LLIL/MLIL/HLIL 间循环，或右下角 `Options` 菜单选 IL 级别
   - MLIL 特点: 变量显式化（`rax = rax ^ 0xdeadbeef`）、类型恢复、条件跳转语义化——比裸反汇编可读，重点函数先看 MLIL 再下结论
   - MLIL 示例（反汇编 vs MLIL）：`cmp eax, 0x1337 / jne L1 / mov byte [rdi], 1 / jmp L2 / L1: mov byte [rdi], 0 / L2: ...` → MLIL 直接呈现 `if (rax == 0x1337) *(uint8_t*)rdi = 1; else *(uint8_t*)rdi = 0;`——读逻辑不用逐条跟跳转
   - 反编译不清晰时降级: MLIL → LLIL（`View > IL > LLIL`，低语言 IL，保留指令级细节）→ 反汇编（`Space`/汇编视图）逐层核对
   - 注意: `m` 键在 Binary Ninja 里是「整数应用枚举显示」，不是 MLIL 切换——切 IL 用 `i`

3. **重命名 / 类型**：
   - 重命名: 光标在符号/变量上 `n`（或右键 Rename）——函数、变量、全局数据均可
   - 改类型: `y`（如 `void *`、`DWORD`、`int (*)(void *, size_t)`），类型传播自动改善后续反编译质量
   - 定义结构体: `Types` 面板新建 Structure → 应用到变量/指针 → 字段名随类型传播进反编译视图
   - 其他类型快捷键: `o` 设指针引用、`a` 设字符数组、`d` 循环整型宽度、`*` 建数组（见 [[commands]] 快捷键表）

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
   - 导出反编译文本: `str(f.high_level_il)` 直接拿 HLIL 伪代码字符串——批量导出函数逻辑的最快方式
   - 插件: `File > Manage Plugins` 浏览社区插件；插件目录按平台：Windows `%APPDATA%\Binary Ninja\plugins`、Linux `~/.binaryninja/plugins`、macOS `~/Library/Application Support/Binary Ninja/plugins`（macOS 非 `~/.binaryninja`，放错不会被加载）
   - 自写脚本先 `File > Python` 面板试跑（能看到 `print` 输出与异常），稳定后再转插件或无头脚本——调试脚本比跑完看结果快得多
   - 无头模式: 商业版可用 headless（`binaryninja.headless.main()` 或 CLI `binaryninja-headless`，参数以 `--help` 为准——脚本路径 + 样本路径）；个人版受限时用 GUI 内 `File > Python` 面板执行同样代码
   - 无头脚本出错不会弹窗——异常直接打到 stderr/日志文件，排错看输出尾部与 `bv.log_info` 痕迹

5. **字符串/引用定位链**：
   - `Strings` 视图（S）找提示串 → 双击进反汇编 → 右键 `Show References`（或 `xrefs` 面板）→ 跳到引用函数 → MLIL 阅读
   - 字符串多时按引用数/长度排序（点列头）优先处理被多处引用的串——通常是错误提示/格式串等关键节点
   - 与 [[re-ida]] 的 Alt+T→x→F5、[[re-radare2]] 的 izz→axt→pdf 同思路；批量标注用 `bv.get_strings()` + `f.get_callers()` 脚本化（见 [[commands]] 序列 2）

6. **DFG 数据流图（单值流向追踪）**：
   - 在 MLIL/HLIL 视图中右键某条指令 → `Show DFG`——从该指令出发的变量/常量传播路径图
   - 场景: 追踪密钥/标志位从加载到比较的完整路径；DFG 比逐条读 MLIL 快，适合「这个值从哪来/去哪了」问题
   - 配合 `x`/右键 `Show References` 交叉验证调用边界；DFG 视图 `Esc` 退出返回原视图

7. **证据核对（收尾）**：重命名/类型/注释随 `bv.save()` 落盘存档；无头导出产物（函数清单/HLIL 文本）与 [[re-triage]] 初勘值对照；关键结论写 [[analysis-contract]]——标注要能还原成报告，别只留在项目里

8. **交叉验证（多反编译器互证）**：同一函数用 [[re-ghidra]] / [[re-ida]]（若有）反编译对比——MLIL 与 Ghidra 伪代码结构一致时结论可信度提升；差异大时回 LLIL/汇编核对，优先相信汇编层证据

6. **对比选型（价格 / 插件生态）**：
   - 价格: Binary Ninja（商业付费，个人版便宜但限个人用途）vs [[re-ida]]（最贵）vs [[re-ghidra]]（免费开源）vs [[re-radare2]]（免费开源 CLI）
   - 生态: Ghidra 社区最大、脚本（Java/Python/无头）最成熟；IDA idapython 插件历史最久；Binary Ninja 插件数较少但 API 设计现代（Python 优先）
   - 决策: 预算敏感 → Ghidra/radare2；要 MLIL 可读性 + Python API → Binary Ninja；已有 IDA 授权 → 保持 IDA，本技能只在换栈时用

## 跨域联合

- [[re-binary-core]]：工作流第 5 步反编译器备选（`RE_DECOMPILER=binaryninja`）
- [[re-ctf]]：逆向题反编译与脚本求解
- [[re-malware]]：恶意样本深度分析（Python 批量标注导出）
- [[re-cracking]]：授权/校验算法还原
- [[re-kernel]]：驱动反编译可选工具（与 [[re-ghidra]] / [[re-ida]] 三选一）
- [[re-android-native]] / [[re-ios]]：移动原生库（ARM64 指令 + 符号少）分析时 MLIL 可读性价值明显
- [[re-game]]：游戏二进制（反编译 + 脚本批量标注）可选工具
- 与 [[re-ghidra]] / [[re-ida]] 间无直接工程互导格式，换栈时按函数手搬或脚本统一标注

## 常见坑与陷阱

- **MLIL 对混淆代码失真**：现象——花指令/控制流平坦化样本反编译出诡异结构（死代码、恒假条件）；原因——MLIL 基于数据流重建，混淆破坏控制流信息；对策——降到 LLIL/汇编交叉验证，或先 [[re-deobfuscate]] 再导入
- **脚本 API 版本差异**：现象——`import binaryninja` 报版本错/行为与文档不符；原因——pip 包与安装软件主版本不匹配（API 大版本间不兼容）；对策——重跑安装目录 `install_api.py` 对齐版本，`core_version()` 与 About 版本比对
- **无头模式用法**：现象——个人版 `binaryninja.headless` 不存在；原因——headless 自动化是商业版能力，个人版裁剪；对策——个人版用 GUI 内 `File > Python` 面板跑脚本，或脚本里只做 `load` + `update_analysis_and_wait` 的替代路径
- **大二进制首次分析慢/内存高**：现象——100MB+ 样本分析数分钟甚至卡死；原因——默认分析 pass 全开；对策——`Options > Analysis` 关掉多余 pass（如只保留 dataflow 与 decompile 需要的最小集），或只对重点函数做分析（`f.analysis_skip_override` 思路）
- **patch 后结果没变（忘了重分析）**：现象——`bv.write` 改了字节，反编译输出还是旧的；原因——分析结果缓存未失效；对策——改完调用 `bv.update_analysis_and_wait()` 强制重分析，或重新加载
- **项目库与样本分离**：`.bndb` 项目库保存全部标注，样本本身不变——分发标注时传 .bndb（注意版本兼容），别指望样本里带上标注；写回样本字节是另一回事（脚本里 `bv.write` + 保存按官方 patch 流程走）
- **宽字符/UTF-16 字符串乱码**：现象——`Strings` 视图中文/宽字符串显示乱码或分裂；原因——数据变量宽度判定错误；对策——选中数据后右键设 2 字节宽（或脚本 `bv.get_data_var_at` 后改类型），再触发分析
- 版本差异、插件/无头细节与快捷键对照见 [[gotchas]] / [[commands]]
