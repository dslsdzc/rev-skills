---
name: re-ghidra
description: >
  Ghidra 工作流：导入→自动分析→反编译→脚本化。
  触发词：Ghidra、反编译、headless
---

# Ghidra 逆向工作流

## 何时使用 / 何时不用

- 用：需要反编译与深度静态分析；headless 批量处理；脚本化自动标注/解密循环；PE/ELF/Mach-O 全支持
- 不用：内存 <4GB（启动即卡顿，换 [[re-radare2]]）；只需快速初勘（走 [[re-triage]]）
- 不用：已有 IDA 工作流且目标明确（按 `RE_DECOMPILER` 会话变量选择）

## 工具准备

参考 [[platform-tips]]——Ghidra 为静态分析主力（免沙箱）；低内存环境按平台经验换 [[re-radare2]]，headless 批处理适合远程环境。

### Ghidra（官方安装，Java 21 要求）

- 下载: GitHub `NationalSecurityAgency/ghidra` releases，解压即用（无需安装）
- JDK 21（Ghidra 11.3+ 要求）:
  - Linux: `apt install openjdk-21-jdk` / `dnf install java-21-openjdk` / `pacman -S jdk21-openjdk`
  - macOS: `brew install openjdk@21` 或 `brew install --cask temurin`
  - Windows: `choco install temurin21`（或 Oracle JDK 21）
- 启动: `./ghidraRun`（GUI）/ `./support/analyzeHeadless`（无头）
- 验证: `java -version`（须 21+）；`./support/analyzeHeadless -help` 正常输出

### ghidra-bridge（Python 远程控制）

- 全平台: `pip install ghidra-bridge`
- 前置: Ghidra GUI 中 Script Manager 运行 `ghidra_bridge_server.py`
- 验证: `python3 -c "import ghidra_bridge; print(ghidra_bridge.__version__)"`

## 操作步骤

1. **analyzeHeadless 无头导入+分析**：
   ```sh
   $GHIDRA/support/analyzeHeadless /tmp/proj sample_proj \
     -import ./sample.bin -deleteProject -log /tmp/ghidra.log
   ```
   只建工程不交互时加 `-overwrite`；批处理多个样本循环调用。日志看 `-log`，分析完成标志: 无异常且工程可重新导入。

2. **GUI：导航/交叉引用/反编译**：
   - `File > Import File` → 选择样本 → `Analyze`（等左下角进度完成）
   - 跳转: `Go To`（G）输入地址；入口点已在 Program Trees 标记 `entry`
   - 交叉引用: 光标在函数/变量上按 `Ctrl+Shift+F`（References to）
   - 反编译: 在 Listing 中按 `F5`（Decompiler 窗口），右键反编译视图可 copy
   - 下划线地址差异: Listing 显示 VA（含 ImageBase），脚本中常用 `getAddressFactory().getDefaultAddressSpace().getAddress("0x401000")`

3. **重命名+类型传播标记**：
   - 函数重命名: Listing 中 `L`；变量重命名: Decompiler 中 `L`
   - 设置类型: 右键变量 > Set Data Type（`y`），如 `char *`、`DWORD`、`int (*)(int)`
   - 定义结构体: Data Type Manager > 新建 Structure，Decompiler 中引用后类型传播自动改善反编译质量
   - 标记已知库函数: 右键 > Set Data Type + `f`（Function signature），提升后续调用点参数语义

4. **Python 脚本（自动标注、解密循环仿真）**：
   ```python
   # @category Analysis  — 放 GhidraScripts 目录，Script Manager 中 Run
   from ghidra.program.model.listing import CodeUnit
   fm = currentProgram.getFunctionManager()
   for f in fm.getFunctions(True):
       body = f.getBody()
       if body.getNumAddresses() > 10000:
           print("large:", f.getName(), hex(body.getMaxAddress().getOffset()))
   ```
   解密循环: 定位 XOR 循环后脚本 patch 或直接计算:
   ```python
   from ghidra.program.model.mem import *
   fm = currentProgram.getFunctionManager()
   f = fm.getFunctionAt(currentAddress)
   # 示例: 从 0x403000 起 0x100 字节异或 0x55
   addr = currentProgram.getAddressFactory().getDefaultAddressSpace().getAddress("0x403000")
   for i in range(0x100):
       b = getByte(addr.add(i)) ^ 0x55
       setByte(addr.add(i), b)
   ```
   无头批量: `analyzeHeadless ... -postScript MyScript.java -scriptPath <dir>`

5. **导出反编译 C**：
   - `File > Export Program` → 格式选 `C/C++`，导出整个反编译树
   - 或 Decompiler 窗口逐函数 `Copy` 到笔记
   - 导出后核对: C 里无符号函数名保留注释（函数地址），对照原 Listing

## 跨域联合

- [[re-binary-core]]：工作流第 5 步默认反编译器
- [[re-malware]]：恶意样本深度分析（混淆脚本标注）
- [[re-ctf]]：逆向题主力
- [[re-firmware]]：固件 ELF 组件反编译
- [[re-mobile]]：App .so 库分析
- 与 [[re-format-pe]] / [[re-format-elf]] / [[re-format-macho]] 配合读结构；低内存环境用 [[re-radare2]]

## 常见坑与陷阱

- **自动分析漏掉混淆代码**：花指令/乱序代码段可能未被反汇编——手动选中段按 `C`（code）强制标记，必要时修复函数边界（右键 > Create Function）
- **Java 版本不匹配启动失败**：报 `UnsupportedClassVersionError` → 确认 `java -version` 为 21+，`JAVA_HOME` 指向正确 JDK
- **内存 <4GB 卡顿**：分析大二进制内存耗尽 → 换 [[re-radare2]] 或减小分析范围（`-analysisTimeoutPerFile`）
- headless 默认分析选项与 GUI 有差异（缺少部分可选项）→ 用 `-postScript` 显式执行分析脚本保证一致
- **大文件自动分析卡死**：现象——导入大二进制后自动分析长时间不结束/界面卡死；原因——大文件卡死诱因=间接调用爆炸/大型 C++ RTTI/混淆控制流/大量数据段；对策——先降低自动分析范围（限制/关闭间接调用与 RTTI 分析选项），优先定位入口/字符串/交叉引用再逐步展开，见 [[platform-tips]] 静态优先原则
