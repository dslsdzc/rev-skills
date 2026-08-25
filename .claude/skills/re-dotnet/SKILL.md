---
name: re-dotnet
description: .NET CIL 逆向：dnSpy/ILSpy 反编译、de4dot 去混淆、ConfuserEx。触发词：.NET、dnSpy、ILSpy、de4dot、CIL、ConfuserEx
---

# .NET CIL 逆向（dnSpy / ILSpy / de4dot）

## 何时使用 / 何时不用

- 用：确认是 .NET 程序集（PE CLI header / `file` 输出 "Mono/.Net assembly"）后，还原 CIL 为可读 C#；处理 ConfuserEx/SmartAssembly 等 .NET 混淆；定位注册码/网络/解密逻辑
- 用：恶意 .NET 样本（[[re-malware]] → [[re-managed]] 路径）的静态还原
- 不用：非托管 PE（native 程序直接 [[re-binary-core]]；混合模式程序 native 部分同样转出）
- 不用：Java（[[re-java]]）、脚本（[[re-script-deob]]）
- 注意：动态步骤默认沙箱（[[platform-tips]] 最高原则）；先 `file`/初勘确认再动手

## 工具准备

参考 [[platform-tips]]——反编译/去混淆为静态步骤，免沙箱；动态验证按最高原则进沙箱。

### dotnet SDK（跑 .NET 工具的前提）

- Debian/Ubuntu: `apt install dotnet-sdk-8.0`（官方 Microsoft 源）
- Fedora: `dnf install dotnet-sdk-8.0`；Arch: `pacman -S dotnet-sdk`
- macOS: `brew install --cask dotnet-sdk`
- Windows: `choco install dotnet-sdk` 或官方安装器
- 验证: `dotnet --version`

### ILSpy（跨平台，GUI + CLI）

- CLI（dotnet tool）: `dotnet tool install -g ilspycmd`
- GUI: GitHub `icsharpcode/ILSpy` release zip（linux-x64 / win-x64 / osx-x64 均有）
- 验证: `ilspycmd --help`；GUI 能打开程序集

### dnSpy（Windows 专用，GitHub release）

- GitHub `dnSpyEx/dnSpy` release zip → 解压运行 `dnSpy.exe`
- 仅 Windows（WinForms + .NET Framework）；Linux/WSL 用 ILSpy（或 Wine 跑 dnSpy）
- 验证: GUI 启动并能 `File > Open` 程序集
- 优势: 反编译 + 编辑 + 调试一体

### de4dot（GitHub release，去混淆）

- GitHub `de4dot/de4dot` release `de4dot.exe`；Linux/macOS 需 mono:
  - `apt install mono-devel` / `dnf install mono-devel`；Arch: `yay -S mono-git`（AUR——mono 自 2021 年起不在官方仓库，AUR 亦无稳定 `mono` 包，仅 `mono-git`）；macOS `brew install mono`
  - 运行: `mono de4dot.exe --help`；Windows 直接 `de4dot.exe --help`
- 验证: `--help` 正常输出

### 单文件 bundle 解包（sfextract / ILSpy 内置，可选但常用）

- 零额外工具: ILSpy 7.1+ GUI 直接 `File > Open` 单文件 bundle，7.2+ 右键 `Extract package entry` 导出内嵌程序集
- CLI: `dotnet tool install -g sfextract`（Droppers/SingleFileExtractor，MIT；注意 `dotnet-bundle-extractor`/`dotnet-bundle-extract` 这两个包名在 NuGet 并不存在）
- 用法: `sfextract sample.exe -o extracted/`（不带 `-o` 只列出 bundle 内文件）
- 验证: `sfextract --help`

## 操作步骤

按顺序执行，每步记录证据（路径 + sha256，见 [[re-triage]]）。

1. **识别 .NET 程序集**：
   ```sh
   file sample.exe            # 含 "Mono/.Net assembly" 即 .NET
   strings sample.exe | grep -i mscoree   # mscoree.dll 导入是经典标识
   ```
   CLI header 确认（PE 数据目录第 15 项 = COM Descriptor）：
   ```python
   import pefile
   pe = pefile.PE('sample.exe')
   dd = pe.OPTIONAL_HEADER.DATA_DIRECTORY[14]  # COM Descriptor (CLI header)
   print(hex(dd.VirtualAddress), hex(dd.Size))  # 非 0 → 托管程序集
   ```
   注意混合模式程序集（native + 托管都看得到）与自包含单文件（见坑 4）。
   CLI header 结构速查（实测 .NET 10 产物）：cb=0x48(72)、MajorRuntimeVersion=2、MinorRuntimeVersion=5、MetaData RVA、EntryPoint RVA（0=DLL）、CorFlags（1=ILONLY、2=32BITREQUIRED、0x8=强名签名（COMIMAGE_FLAGS_STRONGNAMESIGNED）、0x20000=32BITPREFERRED）。
   元数据根（MetaData RVA 处）：签名 `BSJB`(0x424A5342) + 版本 1.1 + 保留 + 版本串长 + 版本串（"v4.0.30319"，.NET Framework/.NET Core/.NET 10 产物恒定）+ flags(2) + 流数(2) + 流头（offset + size + 名字，4 字节对齐）。
   流名即内容形态：`#~`（压缩表，Roslyn 默认）/`#-`（未压缩表）、`#Strings`（元数据字符串池）、`#US`（用户字符串：代码里的 C# 字面量）、`#GUID`、`#Blob`（签名/常量 blob）——字符串加密样本的明文不在 `#US` 就是运行时拼的；`#~` 的表内容即 dnSpy/ILSpy 的类型/方法树。

2. **dnSpy/ILSpy 反编译浏览**：
   - ilspycmd 单文件: `ilspycmd sample.exe`（stdout 输出反编译代码）
   - ilspycmd 生成项目: `ilspycmd sample.exe -p -o decompiled/`
   - ILSpy GUI / dnSpy: `File > Open` → 左侧树展开程序集 → 双击类/方法看 C# 视图
   - dnSpy 额外能力: 右键方法 `Edit Method`（改后 `File > Save Module` 重新编译）、断点调试

3. **字符串/API 定位关键逻辑**：
   ```sh
   strings sample.exe | grep -iE 'http|https|api|key|secret|register'
   strings -e l sample.exe | grep -iE 'http|key|secret'   # UTF-16LE：#US 池里 C# 字面量是 UTF-16
   grep -rn 'HttpClient\|WebRequest\|Regex\|Convert' decompiled/   # ilspycmd 产物
   ```
   - GUI 内搜索: ILSpy/dnSpy `Edit > Find`（Ctrl+Shift+F），输入目标串
   - 找引用: dnSpy 右键方法/字段 → `Analyze` → `Used By`（xref 定位调用点）
   - 目标形态：注册码校验（`Main` 里 `if (key == ...)`）、网络 URL、解密 key

4. **de4dot 去混淆（ConfuserEx / SmartAssembly 等）**：
   ```sh
   mono de4dot.exe sample.exe            # 自动检测混淆器 → 输出 sample-cleaned.exe
   mono de4dot.exe -p ce sample.exe      # 显式指定 ConfuserEx (ce) / SmartAssembly (sa)
   ```
   - 先 `-d` 干跑只看检测: `mono de4dot.exe -d sample.exe`（日志显示 `Detected: ConfuserEx`）
   - 去混淆后重新在 dnSpy/ILSpy 打开 `sample-cleaned.exe`：字符串应为明文、控制流恢复
   - 残留混淆（字符串仍密文）→ 坑 2 手动方案

5. **动态侧（可选；沙箱内执行 [[re-sandbox]]）**：
   - Frida（native 层）: `pip install frida-tools`；`frida sample.exe -l hook.js`，用 `Interceptor` hook 底层 native 调用（如 `HttpClient` 背后的 socket 读写/`SSL_read`、解密函数所在 native 库）在运行时 dump 明文/URL——stock frida-tools 无法按方法名直接 hook .NET 托管方法；托管层需 CLR 桥（如 MonarchSolutions/frida-clr）或改走下方 dotnet-dump / dnSpy 调试
   - dotnet-dump（进程内取运行时数据）:
     ```sh
     dotnet tool install -g dotnet-dump
     dotnet-dump collect -p <pid>                  # 收集 dump
     dotnet-dump analyze <dump>                    # clrstack / dumpheap -type System.String
     ```
   - Windows: dnSpy `Debug > Start` 断点调试（直接断方法看变量）

## 跨域联合

- [[re-managed]]：网关工作流步骤②（反编译）④（去混淆）固定调用本技能
- [[re-malware]]：.NET 恶意样本路径（re-malware → re-managed → 本技能静态还原）
- [[re-binary-core]]：底座——初勘（[[re-triage]]）、混合模式 native 部分
- 动态侧：[[re-frida]]、[[re-sandbox]]；深层混淆转 [[re-deobfuscate]]；单文件先解包再回本技能

## 常见坑与陷阱

- **ConfuserEx 字符串加密 + 控制流**：现象——反编译只见 `smethod_0("密文")` 调用、if/while 变 switch 分发；原因——ConfuserEx 默认同时启用字符串加密与控制流混淆；对策——`de4dot -p ce` 自动还原；残留时在解密方法返回处动态读明文（沙箱内），或还原解密循环用脚本批量解
- **de4dot 对旧版本/新混淆器失效**：现象——日志 `Unknown obfuscator` 或产物仍混淆；原因——de4dot 维护停滞，混淆器新版特征未收录；对策——换社区 fork（de4dot-cex / de4dot-modified），或手动：定位字符串解密函数 → 分析算法 → python3 复刻 + 动态验证
- **dnSpy 仅 Windows**：现象——Linux/WSL 双击 dnSpy.exe 报错无法运行；原因——WinForms + .NET Framework 的 GUI 工具；对策——Linux/macOS 用 ILSpy（GUI 或 `ilspycmd`），坚持 dnSpy 可 Wine 跑
- **.NET 自包含发布（单文件）**：现象——`file` 显示普通 PE、工具打开无托管结构/反编译为空；原因——self-contained single-file 把 host + 运行库 + IL 捆成一个 native 可执行；对策——先解包：`sfextract sample.exe -o extracted/`（或 ILSpy 直接打开/导出），对解出的程序集再反编译
- **混合模式程序集**：现象——反编译只见少量托管类，主逻辑找不到；原因——C++/CLI 或 wrapper 把 native 代码与托管混合；对策——托管侧按本技能，native 侧转 [[re-binary-core]]（[[re-ghidra]] / [[re-imports]]）
- **薄壳启动器程序集误判导出失败（dnSpy 无头批量）**：现象——单个程序集反编译产物源码极少（几行到几十行），主逻辑找不到，误以为导出失败；原因——该程序集只是薄壳启动器，主逻辑在伴随程序集/库中（纯托管，区别于上一条的 native 侧）；对策——目录级批量反编译拿整体视图再判断：Windows 侧用 dnSpy 控制台（`dotnet dnSpy.Console.dll`）输出 solution + 每程序集一个 .csproj + 源码树，Linux 对位 `ilspycmd -p`；批量时显式传依赖搜索路径（指向目标所在目录），否则伴随库引用解析不全；成功与否以「产物计数非零 + 退出码 0」双通道确认
- **ReadyToRun（R2R）程序集**：现象——`file` 报 `Unknown processor 0xfd1d`（PE machine 0xfd1d 即 R2R 标记），反编译正常但动态侧行为与 IL 不一致时怀疑有预编译体；原因——R2R 发布在元数据之外预编译了 native 方法体（快速启动），IL 与 CLI header 仍在（实测 .NET 10 R2R 产物 DD[14] 与元数据齐全），实际执行的是 native 体；对策——检测：`file` 的 0xfd1d + 二进制内 `RTR\0`（READYTORUN 头魔数，实测在 .text 区）；分析：IL 侧逻辑一致照常反编译，性能/环境相关差异看 native 方法体（转 [[re-binary-core]]）
- **NativeAOT 无托管结构**：现象——`file` 不显示 Mono/.Net assembly、无 CLI header，但来源声明是 .NET 程序；原因——NativeAOT 把 C# 直接编译为原生可执行（无 CLR、无元数据、无 CIL）；对策——按 native 分析（[[re-format-pe]]/[[re-format-elf]] + [[re-ghidra]]/[[re-imports]]）；特征：静态/动态链接原生二进制 + 无 mscoree 导入，业务字符串仍可 `strings -e l` 提取（.NET 字符串 UTF-16）
- **.NET 字符串是 UTF-16LE，默认 strings 抓不到**：现象——`strings sample.exe | grep 'http'` 无结果但反编译里有明文 URL；原因——C# 字面量在 `#US` 池以 UTF-16LE 存储；对策——`strings -e l`（或 `-el`）再搜；动态侧 [[re-frida]] hook 字符串构造点也可取明文
（来源：LazyReverse（a0yami），MIT）
