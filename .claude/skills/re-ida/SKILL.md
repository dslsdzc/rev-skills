---
name: re-ida
description: >
  IDA 工作流：导入→FLIRT→Hex-Rays→idapython。
  触发词：IDA、Hex-Rays、idapython
---

# IDA 逆向工作流

## 何时使用 / 何时不用

- 用：已有 IDA 授权/免费版，目标需要 FLIRT 库识别、Hex-Rays 反编译、idapython 批处理
- 不用：免费版无法处理时（无 Hex-Rays → 用 [[re-ghidra]] 兜底）；只需快速结论（[[re-triage]]）
- 不用：内存受限环境（大二进制卡顿，换 [[re-radare2]]）

## 工具准备

参考 [[platform-tips]]——静态分析免沙箱；用 IDA 调试器做动态调试时按最高原则默认沙箱执行。

### IDA（商业版 / 免费版）

- 下载: hex-rays.com（IDA Freeware 8.x 免费，支持 x86/x64；其他架构与分析器需商业版）
- Windows: 安装程序直接运行；`choco install ida-free`（社区包，或官网手动下载）
- macOS/Linux: 官网 tar 包解压运行 `ida` / `ida64`
- 验证: 启动后成功打开一个样本完成 auto-analysis，函数窗口有内容

### idapython（内置）

- IDA 6.8+ 内置 Python2/3 环境，无需单独安装
- 验证: 菜单 `File > Script command` 执行 `print(idaapi.IDA_SDK_VERSION)` 输出版本

### FLIRT 签名库

- IDA 自带 `sig/` 目录（flair），应用后自动标注库函数
- 验证: 对已知 libc 程序应用签名后，`_init`/`malloc` 等被标注为库函数

## 操作步骤

1. **导入与 auto-analysis**：
   - `File > New` 选择样本 → 等左下角 `AU: analyzing` 结束（无 AU 字样且分析日志停止）
   - 确认 `Options > General > Analysis` 中 Auto-analysis 开启；确认 `segments` 与 `entry point` 已识别
   - 无头批处理（idapython）: `idat64 -A -S"myscript.py" sample`（`-A` 自动模式，结束自动退出）

2. **FLIRT 识别库函数**：
   - `File > Load file > FLIRT signature file...` 选择匹配的 `.sig`（MSVC 选 `mssdk`、`vc64rtf` 等；GNU 选 `libstdc++` 系列）
   - 识别后库函数名自动应用，函数窗口内库函数（浅色）与用户函数分离——直接聚焦非库函数
   - 匹配失败（加壳/混淆库）→ 说明壳或自定义编译，转 [[re-anti-analysis]]

3. **交叉引用与重命名**：
   - 光标在函数/变量上按 `x` 查看交叉引用列表
   - 重命名: `n`（函数/变量）；修改类型: `y`（如 `int __cdecl f(int, char*)`）
   - 注释: `;`（repeatable 注释 `:`）——把分析结论写进 IDB
   - 关键标记: 对可疑 API（`IsDebuggerPresent` 等）逐处 `x` 找调用点

4. **idapython 批处理（解密循环/批量标注）**：
   ```python
   import ida_bytes, idc
   # 批量 patch: 0x401000 起 0x100 字节异或 0x55
   base = 0x401000
   for i in range(0x100):
       ida_bytes.patch_byte(base + i, idc.get_byte(base + i) ^ 0x55)
   ```
   ```python
   # 批量重命名: 给所有未命名导入标注来源
   import ida_funcs, ida_name
   # 遍历函数: ida_funcs.get_func() / idc.get_func_name()
   ```
   无头运行: `idat64 -A -S"script.py log.txt" sample`，脚本末尾 `idc.qexit(0)` 保证退出。

5. **免费版限制处理**：
   - 免费版无 Hex-Rays: 用反汇编 + idapython（按步骤 4 方式人工还原循环/算法），或直接导出给 Ghidra:
     菜单 `File > Produce file > Dump typeinfo` / 用 idb2pat 生成库签名；或换 [[re-ghidra]] 做反编译
   - 免费版功能裁剪：无 Hex-Rays、无调试器、单处理器——按裁剪范围调整流程

## 函数分析上下文清单

分析每个函数前先收集（见 [[analysis-contract]] 上下文清单）：xrefs、目标函数引用的字符串、caller/callee 签名、已命名符号表、已恢复 struct。一次性给足再分析；主动申请额外证据每函数不超过 8 次工具调用。

深分析按 [[analysis-contract]] 的「单函数深分析顺序」五步推进（types → constants → vtables → identity → decompilation）；IDA 下类型用 idapython `get_type`/结构体定义，符号/常量证据可用 readelf / strings / objdump 导出辅助。

## 跨域联合

- [[re-binary-core]]：工作流第 5 步备选反编译器（`RE_DECOMPILER=ida`）
- [[re-cracking]]：注册算法/校验逻辑定位常用 IDA
- [[re-malware]]：恶意样本调试（IDA 调试器）与分析
- 免费版无 Hex-Rays 时对接 [[re-ghidra]]

## 常见坑与陷阱

- **免费版无反编译**：IDA Free 无 Hex-Rays——先确认版本能力，缺反编译直接走 Ghidra，别在反汇编里硬读
- **反调试检测**：样本可用 `IsDebuggerPresent`/`NtQueryInformationProcess` 检测 IDA 调试器（调试器默认标记）——静态分析为主，或用隐藏调试器插件（ScyllaHide 类）
- **大二进制卡顿**：auto-analysis 全开对 100MB+ 二进制极慢——关掉部分分析选项（如 constant propagation）或换 [[re-radare2]]
- FLIRT 匹配的是"去壳后"的真实库——带壳样本先脱壳再跑签名
- **地址型 API 返回值没判 BADADDR**：现象——idapython 脚本在部分样本上拿到 `0xFFFFFFFFFFFFFFFF` 之类的地址，后续寻址/改名全错或崩溃；原因——IDA API 用 `BADADDR`（-1）表示失败（名字不存在、地址非法、函数不存在），脚本没检查返回值就继续用；对策——每个返回地址的 API（`get_name_ea`/`get_func` 等）调用后先判 `== BADADDR`，失败先打印现场再继续；脚本先只读验证再写库（见下条）
- **修改型脚本直接在原库上跑，改坏难回滚**：现象——批处理改名/改字节脚本跑完发现一堆错误标注，撤销费劲甚至不可逆；原因——跳过只读验证直接写库，也没对副本操作；对策——官方推荐先跑只读脚本（打印库路径/架构/函数与字符串统计）确认预期，修改型脚本逐步增量验证（最小脚本→看输出→加功能）；批量改动前先复制一份 .i64/.idb 或在副本上跑

- **Hex-Rays interr（decompiler 内部错误）**：现象——无头反编译跑到某个函数报 `interr: create_stkvar(...) dtype=7` 之类后整个进程崩溃，跳过/重试无效；原因——decompiler 对特定栈布局的内部 bug，与样本/脚本无关；对策——换 Ghidra 完成该目标（互证也更好），别在同一函数上硬刚；批量反编译场景先小样本试跑确认不触发再全量
- **无头批量导出没等 auto-analysis 完成（静默产出 0 个函数）**：现象——`idat64 -A -S"export.py" sample` 批量导出跑完，产物 0 个函数或严重不全，日志无任何报错；原因——`-A` 模式下脚本注入与 auto-analysis 异步并行，脚本在分析完成前就遍历函数列表得到空集，失败被静默吞掉；对策——收集函数前先 `ida_auto.auto_wait()` 阻塞至分析结束；导出循环逐函数 try/except，单个函数失败只记入清单（地址/名字/原因）后继续，结尾汇总 total/exported/failed，不中断全量；只导出非库函数（FUNC_LIB 标志）时无用户代码的小二进制合法产出 0 个，验证用「日志关键字 + 产物计数」双通道并容忍这种合法空产出；调用图（callers/callees）先整体算好缓存再进反编译循环，导出按便宜到贵排序（strings → imports → exports → memory → decompile），每函数一个按地址命名的文件
（来源：LazyReverse（a0yami），MIT）
