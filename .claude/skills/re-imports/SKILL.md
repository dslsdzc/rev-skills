---
name: re-imports
description: >
  导入导出表与库指纹：IAT/EAT、DLL/so 指纹、FLIRT 思路。
  触发词：导入表、IAT、库指纹、链接了哪些库
---

# 导入导出表与库指纹

## 何时使用 / 何时不用

- 用：判断程序链接了哪些库/API；按导入特征匹配编译器与库版本；定位可疑导入（注入/网络/加密 API）；分析插件与 DLL 的导出接口
- 不用：只需函数内部逻辑（直接反编译技能）
- 不用：壳静态隐藏导入时（动态解析的 API 不在 IAT 里——配合 [[re-tracing]] / [[re-memdump]] 从内存取）

## 工具准备

参考 [[platform-tips]]——导入表分析为静态步骤，免沙箱；涉及运行（验证动态解析 API）按最高原则进沙箱。

### objdump / readelf（binutils）

- Linux: `apt install binutils` / `dnf install binutils` / `pacman -S binutils`
- macOS: `brew install binutils`（`gobjdump`）；Mach-O 用 `otool -L` + `nm -u`
- WSL: Linux 版
- 验证: `objdump -V`

### pefile（Python）

- 全平台: `pip install pefile`
- 验证: `python3 -c "import pefile; print(pefile.__version__)"`

### rizin / rz-bin

- macOS: `brew install rizin`
- Arch: `pacman -S rizin`
- Debian 13+ / Ubuntu 24.04+: `apt install rizin`；旧发行版用 GitHub 官方 release 二进制
- Windows: 官方 release 解压即用；radare2 用户可 `choco install radare2` 作兼容（命令见下）
- 验证: `rz-bin -V`

### Ghidra FLIRT 插件（ghidra_flirt）

- 全平台: `git clone https://github.com/nneonneo/ghidra_flirt && cd ghidra_flirt && make`（需 Ghidra 已装，见 [[re-ghidra]]）
- 验证: Ghidra 内出现 ghidra_flirt 扩展

## 操作步骤

1. **列出导入函数**：
   - PE:
     ```sh
     objdump -p sample.exe | grep 'DLL Name' -A3 | head -30
     ```
     ```python
     import pefile
     pe = pefile.PE('sample.exe')
     for e in pe.DIRECTORY_ENTRY_IMPORT:
         print(e.dll, [i.name for i in e.imports if i.name][:15])
     ```
   - ELF:
     ```sh
     objdump -T sample | grep UND            # 未定义符号 = 导入
     readelf -s sample | grep -i ' UND '
     ```
   - Mach-O:
     ```sh
     otool -L sample      # 依赖 dylib 列表
     nm -u sample         # 未定义符号 = 导入
     ```

2. **按导入特征匹配库/编译器（FLIRT 思路）**：
   - FLIRT 签名: IDA `File > Load file > FLIRT signature file...`（自带 sig 目录）自动标注库函数；Ghidra 用 ghidra_flirt 插件（工具准备）
   - libc 版本指纹: `readelf -s sample | grep -c ''` 配合 `strings sample | grep -E 'GLIBC_[0-9.]+'`（GLIBC 符号版本号）；`strings libc.so.6 | grep -m1 version` 对运行库侧
   - 语言指纹: Go（`runtime.main` / `go1.2x` 串）、Rust（`_ZN`/`__rust_*`）、C++（`_Z` mangled）、Delphi（`@System@`）、.NET（mscoree + metadata）
   - Rich Header（PE）交叉验证编译器版本，见 [[re-format-pe]]

3. **定位可疑导入**：
   - 进程注入类: `OpenProcess` + `VirtualAllocEx` + `WriteProcessMemory` + `CreateRemoteThread`（kernel32）；`NtCreateThreadEx`（ntdll）
   - 网络回连类: `WSAStartup`/`socket`/`connect`/`HttpSendRequestA`/`WinHttpOpen`
   - 加密/窃密类: `CryptEncrypt`/`CryptDecrypt`/`BCryptEncrypt`/`CryptExportKey`（导出密钥）
   - 反调试类: `IsDebuggerPresent`/`NtQueryInformationProcess`/`OutputDebugStringA`（异常触发检测）
   - ELF 侧: `ptrace`/`socket`/`execve`/`dlopen`/`fork`；Mach-O 侧: `task_for_pid`/`_dyld_*`
   - 命中即标注到分析笔记，下一步去反编译技能定位调用点

4. **导出表分析（插件/服务类样本）**：
   - PE:
     ```sh
     objdump -p sample.dll | grep -A30 'Export Table'
     ```
     ```python
     import pefile
     pe = pefile.PE('sample.dll')
     for exp in pe.DIRECTORY_ENTRY_EXPORT.symbols:
         print(hex(exp.address), exp.name)
     ```
   - ELF `.so`: `readelf -s sample.so | grep -v UND | grep FUNC`（导出的全局函数）
   - Mach-O dylib: `nm -gU sample.dylib`
   - 插件类样本导出接口名揭示功能（如 AV/注入器/工具集的内部命令）

5. **对照系统库验证**（判断是否系统 API 混入可疑参数）：
   ```sh
   strings sample.exe | grep -iE '\.dll|\.so|\.dylib'   # 附加库路径线索
   ```

## 跨域联合

- [[re-binary-core]]：工作流第 4 步固定调用
- [[re-malware]]：恶意导入特征（注入/窃密/回连）筛选
- [[re-cracking]]：找校验/注册相关 API 调用点
- 与 [[re-format-pe]] / [[re-format-elf]] / [[re-format-macho]] 衔接；壳隐藏导入时转 [[re-anti-analysis]] + [[re-memdump]]

## 常见坑与陷阱

- **导入表被壳重定向/加密**：静态读到的 IAT 是壳的占位/已加密——真实导入要等运行后从内存取（[[re-memdump]]）
- **动态解析的 API 不在 IAT 里**：`GetProcAddress`/`dlopen`+`dlsym` 运行时才解析，静态导入表查不到——配合 [[re-tracing]] 观察
- **字符串比对库版本更可靠**：符号可被 strip/混淆，但 Go/OpenSSL 的版本串（`go1.21`、`OpenSSL 3.0.x`）在字符串里
- 按序数（ordinal）导入的函数只有序号没有名字——需对照微软序号表或运行库导出表
