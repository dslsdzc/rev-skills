---
name: re-format-pe
description: >
  PE 格式解析：DOS/NT 头、节表、导入导出、TLS 回调、Rich Header、证书表。
  触发词：PE格式、解析exe、section表
---

# PE 格式解析

## 何时使用 / 何时不用

- 用：目标是 Windows PE 文件（.exe/.dll/.sys），需要理解结构、找壳特征、定位入口/TLS 回调、映射 RVA 与文件偏移
- 不用：ELF（走 [[re-format-elf]]）、Mach-O（走 [[re-format-macho]]）；只需函数逻辑（直接反编译技能）
- 不用：只需快速结论（初勘走 [[re-triage]]）

## 工具准备

参考 [[platform-tips]] 平台分支——Windows 目标可静态分析免沙箱，动态执行一律沙箱。

### objdump（binutils）

- Linux: `apt install binutils` / `dnf install binutils` / `pacman -S binutils`
- macOS: `brew install binutils`（`gobjdump`）
- Windows/WSL: WSL 内 Linux 版
- 验证: `objdump -V`
- 注意: 对 PE 用 `objdump -p` / `objdump -x`（readelf 不解析 PE，属非直接工具——只用于对照 ELF 侧知识）

### pefile（Python，推荐主力）

- 全平台: `pip install pefile`（Linux/macOS/Windows/WSL 均可）
- 验证: `python3 -c "import pefile; print(pefile.__version__)"`

### CFF Explorer（Windows GUI）

- Windows: `choco install cff-explorer`（或从 NTCore 官网下载 Explorer Suite）
- 验证: 启动 CFF Explorer 打开样本，能正常显示 Dos Header/Sections 面板

## 操作步骤

1. **e_lfanew 定位 PE 头**：
   ```sh
   objdump -p sample.exe | head -40   # 看 Magic: 0x10b (PE32) / 0x20b (PE32+) 与入口点
   ```
   ```python
   import pefile
   pe = pefile.PE('sample.exe')
   print("e_lfanew offset:", hex(pe.DOS_HEADER.e_lfanew))
   print("PE32" if pe.OPTIONAL_HEADER.Magic == 0x10b else "PE32+")
   print("EntryPoint RVA:", hex(pe.OPTIONAL_HEADER.AddressOfEntryPoint))
   ```

2. **节表与 RVA/文件偏移映射**：
   ```sh
   objdump -h sample.exe        # 节名/VMA/文件偏移/大小
   ```
   ```python
   import pefile
   pe = pefile.PE('sample.exe')
   for s in pe.sections:
       print(s.Name, "VA:", hex(s.VirtualAddress), "raw:", hex(s.PointerToRawData),
             hex(s.SizeOfRawData), "chars:", hex(s.Characteristics))
   print("RVA->offset:", hex(pe.get_offset_from_rva(0x1000)))   # RVA 转文件偏移
   ```
   记住: 节内存中的 VirtualAddress 是 RVA，需加 ImageBase 才是 VA；文件偏移由 PointerToRawData 给出。

3. **导入表（IAT 大小异常 = 壳特征）**：
   ```sh
   objdump -p sample.exe | grep -A3 -i 'DLL Name'
   ```
   ```python
   import pefile
   pe = pefile.PE('sample.exe')
   for entry in pe.DIRECTORY_ENTRY_IMPORT:
       names = [i.name for i in entry.imports if i.name]
       print(entry.dll, "imports:", len(names), names[:5])
   ```
   - 正常程序导入函数较多；仅 1-2 个 DLL、函数极少（如只有 kernel32 的几个）→ 强烈提示加壳/动态解析

4. **TLS 回调检查（比入口点更早执行）**：
   ```python
   import pefile
   pe = pefile.PE('sample.exe')
   if hasattr(pe, 'DIRECTORY_ENTRY_TLS') and pe.DIRECTORY_ENTRY_TLS:
       tlscb = pe.DIRECTORY_ENTRY_TLS.struct.AddressOfCallBacks - pe.OPTIONAL_HEADER.ImageBase
       rva = tlscb - pe.OPTIONAL_HEADER.ImageBase
       off = pe.get_offset_from_rva(rva)
       # 读出回调地址数组直到 0
       pe.parse_data_directories()
       for cb in pe.DIRECTORY_ENTRY_TLS.struct.AddressOfCallBacks or []:
           pass
   ```
   简单方法: `objdump -p sample.exe` 输出中查看 TLS 目录表存在与否；存在则用 pefile 打印回调地址列表，逐条看反汇编。回调在入口点（AddressOfEntryPoint）之前执行——恶意样本常在此放解密/反调试代码。

5. **Rich Header 识别编译器**：
   ```python
   import pefile
   pe = pefile.PE('sample.exe')
   rh = pe.parse_rich_header()
   if rh:
       for cid, count, off in rh['values']:
           # cid 高 16 位是编译器 Product ID（如 0x10b=VS2015）
           print(f"compid={cid>>16:#x} count={count}")
   ```
   Rich Header 位于 DOS stub 之后、e_lfanew 之前，标识编译工具链版本；被移除/伪造本身也是加壳或手工修改特征。

6. **证书表**：SECURITY_DIRECTORY（目录项 4）的 VirtualAddress 是**文件偏移**而非 RVA——直接按 RVA 解析会读错位置：
   ```python
   import pefile
   pe = pefile.PE('sample.exe')
   sec = pe.OPTIONAL_HEADER.DATA_DIRECTORY[4]
   print("cert table file offset:", hex(sec.VirtualAddress), "size:", hex(sec.Size))
   ```

## 跨域联合

- [[re-binary-core]]：工作流第 3 步，PE 目标的格式解析
- [[re-malware]]：PE 恶意样本分析（TLS 回调/证书表是常用藏身处）
- [[re-cracking]]：PE 补丁/注册机类任务定位校验代码
- 与 [[re-imports]] 衔接（解析完结构后看导入）；发现壳特征时转 [[re-anti-analysis]]

## 常见坑与陷阱

- **TLS 回调是恶意软件常见藏身点**：入口点断点会漏掉——先查 TLS 目录并列出全部回调地址
- **节名异常**（UPX0/.aspack/.nsp0 等）：壳的压缩节特征，别当普通代码节反编译
- **导入表极小 → 加壳**：只导入 kernel32 少量函数或导入表为空，说明 IAT 被壳接管，静态拿不到真实导入
- **证书表偏移计算**：SECURITY_DIRECTORY 的指针是文件偏移，当 RVA 解析会读错
- **TLS 目录本身可被覆写/劫持**：现象——样本看似无壳，但在注入的子进程（svchost 等）里出现非预期执行，断在 OEP 的调试器全程"正常"；原因——恶意样本（如 Ursnif 变体）改写被注入进程的 TLS 目录，使执行落在伪造回调而非 AddressOfEntryPoint，通用脱壳器与只断入口点的调试器全被绕过；对策——动态断点设在 `ntdll!LdrpCallInitRoutine`（回调指针经参数传递）观察全部回调，静态核验 TLS 目录/回调数组所在节是否可写——可写即劫持面
- **别用 ELF 思维套 PE**：现象——分析 PE 时找 `.interp`/PT_INTERP、期待 `__libc_start_main` 启动路径、按 RTLD_NOW 语义理解加载；原因——两格式动态链接机制根本不同（PE 无 .interp，启动不经过 __libc_start_main）；对策——PE 启动链只认：系统加载器 → TLS 回调 → 入口点（AddressOfEntryPoint）；导入看 IAT，没有 GOT/PLT 概念
- **PE 代码节内嵌数据 → 线性反汇编误判**：现象——反编译出现大片伪代码或把跳转表当函数；原因——PE 编译器常把跳转表等数据内联进代码节（ELF 则放 `.rodata`），线性反汇编约 1% 误差，函数边界误判率 20%+（尾调用/非标准序言/内联）；对策——反编译结果交叉验证，用工具的数据标注（IDA/ghidra 手工标记数据区）修正，别全信自动函数列表
