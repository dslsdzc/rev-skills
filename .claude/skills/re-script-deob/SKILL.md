---
name: re-script-deob
description: 脚本/宏去混淆：PowerShell、VBA、JavaScript。触发词：PowerShell混淆、VBA宏、JS去混淆、脚本解密、恶意脚本
---

# 脚本/宏去混淆（PowerShell / VBA / JavaScript）

## 何时使用 / 何时不用

- 用：.ps1 / .docm / .xlsm / .js / .jse / .hta 等脚本与宏的混淆还原（编码、字符串拼接、执行链）
- 用：钓鱼附件宏、恶意下载器脚本（[[re-malware]] → [[re-managed]] 路径）
- 不用：编译产物（native 走 [[re-binary-core]]、.NET 走 [[re-dotnet]]、Java 走 [[re-java]]）
- 不用：脚本完全可读（直接读逻辑，无需本技能）
- 注意：**动态执行默认沙箱（[[platform-tips]] 最高原则）**——静态解码不执行可免沙箱，任何"运行脚本取下一层"的步骤必须进 [[re-sandbox]]

## 工具准备

参考 [[platform-tips]]——本技能静态解码为主，免沙箱；执行链跟踪中需要运行时（跑脚本/开宏）的步骤按最高原则进沙箱。

### python3（解码主力）

- Linux: `apt install python3` / `dnf install python3` / `pacman -S python`
- macOS: 自带；Windows: 官方安装器或 `choco install python`
- 验证: `python3 --version`

### oletools（VBA 宏提取/解码，可选但强烈建议）

- `pip install oletools`（依赖 pyparsing 自动装上）
- 验证: `olevba --help`

### xxd / sed（十六进制与文本处理）

- Debian/Ubuntu: `apt install xxd`（新版本独立包，旧版本在 `vim-common`）；Fedora: `dnf install vim-common`（xxd 传统由 vim-common 提供，F38+ 也有独立 `xxd` 子包）；Arch: `pacman -S xxd`
- macOS: 自带（vim 附送）
- Windows: 无自带 xxd——用 WSL 或 PowerShell `Format-Hex`
- sed 全平台自带；验证: `xxd -v && sed --version`

### PowerShell（Windows 内置）/ pwsh（Linux/macOS）

- Windows: 内置 `powershell.exe`（或 PowerShell 7 `pwsh`）
- Linux: `apt install powershell`（Microsoft 源）或 `snap install powershell`；macOS: `brew install --cask powershell`
- 验证: `pwsh --version`

### js-beautify（JS 美化，可选）

- `pip install jsbeautifier`；验证: `js-beautify --version`

## 操作步骤

按顺序执行；每层还原结果存档编号（`layer_01.ps1` → `layer_02.ps1` …），执行链跟踪中"运行脚本拿下一层"的步骤一律在沙箱内。

1. **识别脚本类型与混淆风格**：
   ```sh
   file sample.ps1 && head -c 512 sample.ps1
   grep -oiE 'IEX|Invoke-Expression|-EncodedCommand|FromBase64String|eval\(|unescape|fromCharCode|Chr\(|StrReverse|Document_Open|AutoOpen' sample.ps1
   ```
   - PowerShell 特征: `-EncodedCommand` / `IEX` / `FromBase64String` / `[Convert]::`
   - VBA 特征: `Sub AutoOpen` / `Document_Open` / `Chr(` / `StrReverse` / `Evaluate` / `Shell`
   - JS 特征: `eval(` / `unescape` / `fromCharCode` / `\xHH` 十六进制 / `document.write`
   - 混淆风格分类：纯编码（base64/hex/char-code）、字符串拼接（`'co'+'mmand'`）、执行链（外层 IEX/eval 嵌套内层载荷）、字符反转/替换

2. **逐层还原（先解码，再跟执行链）**：
   - 顺序：从最外层剥——先解纯编码层，再跟踪 IEX/eval 参数直到最内层 payload
   - 每层解完回到步骤 1 重新识别（新层可能是不同混淆手法）
   - 最终目标：得到可读的"真实逻辑"（URL、命令、载荷），存档最终层
   - 执行链中"执行后输出下一层"的步骤 → 沙箱内运行

3. **PowerShell（-enc 解码、IEX 链）**：
   - `-enc` 解码（安全，不执行）:
     ```sh
     pwsh -NoProfile -Command '$d=[Convert]::FromBase64String("BASE64"); [Text.Encoding]::Unicode.GetString($d)'
     ```
   - IEX 链（沙箱内把 IEX 换成输出拿下一层）: `sed 's/IEX(/Write-Host (/g' layer_01.ps1 > layer_02.ps1`
   - 结构化提取字符串字面量（AST，不执行）:
     ```powershell
     $ast = [System.Management.Automation.Language.Parser]::ParseFile('layer_01.ps1', [ref]$null, [ref]$null)
     $ast.FindAll({ $args[0] -is [System.Management.Automation.Language.StringConstantExpressionAst] }, $true) | % { $_.Value }
     ```
   - 常见手法：`-join`/`-split` 字符拼接、`$env:XXX` 变量替换、字符串反转

4. **VBA（olevba 提取宏 + 还原）**：
   ```sh
   olevba -c sample.docm > macro.txt                 # 提取宏源码
   olevba --decode -c sample.docm > macro_decoded.txt  # 自动解常见字符串混淆（--decode 自 oletools 0.24/2015 起就有，无版本门槛）
   ```
   - 手动还原：`Chr(65)` 拼接用 python3 换算 ASCII；`StrReverse(...)` 反转；`Evaluate("...")` 里的执行串
   - 找自动执行入口：`AutoOpen` / `Document_Open` / `Workbook_Open` / `Auto_Open`
   - 动态验证（必须沙箱）：沙箱内 Office/LibreOffice 打开文档（启用宏），观察行为与下一层输出

5. **JS（去混淆/解编码）**：
   - `eval(` → 静态替换为 `console.log(`（或 `print(`）观察载荷
   - char-code 解码: `python3 -c "print(''.join(chr(int(c)) for c in '72,101,108,108,111'.split(',')))"`
   - `\xHH` 十六进制: `python3 -c "print(bytes.fromhex('68656c6c6f').decode())"`（先剥 `\x` 前缀）
   - base64 串: `python3 -c "import base64; print(base64.b64decode('...'))"`
   - 美化: `js-beautify layer_01.js -o pretty.js`
   - 动态（沙箱）：`node payload.js` 或浏览器沙箱执行拿下一层

## 跨域联合

- [[re-managed]]：网关工作流步骤②（反编译）③（去混淆）固定调用本技能
- [[re-malware]]：恶意脚本/钓鱼宏样本路径（docm/ps1/js 附件 → 沙箱行为 + 本技能还原载荷）
- [[re-sandbox]]：一切动态执行（跑脚本、开宏）强制前置，见 [[platform-tips]] 默认沙箱原则
- 配套：[[re-triage]]（初勘）、[[re-ioc]]（提取脚本中的 C2 域名/URL 作为 IOC）、[[re-protocol]]（脚本下载的回连流量）

## 常见坑与陷阱

- **混淆层层嵌套需耐心逐层解**：现象——解了一层又一层、感觉没完；原因——多层混淆叠加（编码+拼接+执行链）是常态；对策——逐层解、每层存档编号、解完重跑识别，别跳层也别想一步到位
- **olevba 提取后仍是混淆的**：现象——`olevba -c` 提取的宏还是满屏 `Chr(65) & Chr(66)` 拼接；原因——olevba 只负责提取不负责还原；对策——用 `--decode` 自动解常见手法，剩余手动还原，最后动态验证还原结果正确
- **恶意脚本必须沙箱内运行**：现象——本地直接 `pwsh sample.ps1` 后系统被改/发生外联；原因——脚本可能是下载器或持久化植入（`platform-tips` 默认沙箱原则的典型违例场景）；对策——一切动态执行进 [[re-sandbox]]（网络隔离 + 快照），静态解码可免沙箱
- **正则盲改易破坏脚本结构**：现象——sed 全局替换后语法错误、下一层解不出来；原因——混淆串内部包含被替换的模式、字符串字面量被误伤；对策——优先 AST/结构化解析（PowerShell AST、JS 括号匹配），每次替换后先做语法检查（`pwsh -NoProfile -Command "[scriptblock]::Create((Get-Content layer.ps1 -Raw))"` / `node --check layer.js`）再进入下一步
