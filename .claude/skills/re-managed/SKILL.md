---
name: re-managed
type: gateway
description: >
  托管代码逆向网关。编排：识别运行时 → 反编译 → 去混淆 → 恶意场景转 [[re-malware]]。
  子技能：[[re-dotnet]] [[re-java]] [[re-script-deob]] [[re-wasm]]。
  触发词：.NET、dnSpy、ILSpy、Java、jar、字节码、PowerShell混淆、VBA宏、JS去混淆、托管代码、managed code。
---

# 托管代码逆向（.NET / Java / 脚本）

## 完整工作流

1. 识别运行时（不先判型就反编译是最大浪费）：
   - **PE 文件**：`file` 输出含 "Mono/.Net assembly"、PE 可选头数据目录第 15 项（COM Descriptor / CLI header）非零、导入 `mscoree.dll` → .NET 程序集 → [[re-dotnet]]
   - **jar/war/class**：`unzip -p app.jar META-INF/MANIFEST.MF` 见 `Main-Class`、class 文件魔数 `CAFEBABE` → Java 字节码 → [[re-java]]
   - **脚本/宏**：shebang（`#!/usr/bin/pwsh`）、`-EncodedCommand` / `IEX`（PowerShell）、OLE 文档（`file` 显示 "Composite Document"）内嵌 VBA、`eval(` / `fromCharCode`（JavaScript）→ [[re-script-deob]]
   - 拿不准先 [[re-triage]] 初勘（file/hash/熵/strings），不要凭扩展名猜
2. 反编译：按识别结果走 [[re-dotnet]] / [[re-java]] / [[re-script-deob]]，先把目标逻辑还原成可读代码
3. 去混淆：各原子技能内含对应方案——de4dot（ConfuserEx/SmartAssembly）、混淆识别 + 字符串解密（ProGuard/Allatori）、逐层解码（脚本/宏）；混杂原生组件（native stub / JNI）的反混淆转 [[re-deobfuscate]]
4. 恶意场景（钓鱼宏、下载器脚本、恶意 .NET/Java 样本）：转 [[re-malware]] 网关——默认沙箱 → 行为分析 → C2/协议 → IOC/报告；反编译还原结果作为静态证据回传给 [[re-malware]] 使用

## 何时用哪个原子技能（选择树）

按运行时分支：

- **PE 且确认 .NET 元数据（CLI header / mscoree）** → [[re-dotnet]]（dnSpy/ILSpy 反编译、de4dot 去混淆）
- **jar / war / class（Java 字节码）** → [[re-java]]（CFR/JD-GUI、javap、加固脱壳）
- **.ps1 / .docm / .xlsm / .js / .jse / .hta（脚本或宏）** → [[re-script-deob]]（逐层解码，动态执行默认沙箱）
- **.wasm / WebAssembly 模块（网页/Node 侧载荷）** → [[re-wasm]]（WABT 解析 section、wasm-decompile 反编译、DevTools/wasmtime 动态）
- **Android DEX** → 不是本网关——转 [[re-mobile]]（[[re-apk]]），其中含 Java 原生逻辑再回 [[re-java]]
- **仅脚本调用 native 下载的 PE** → 动态侧跟 [[re-malware]]，静态侧回 [[re-binary-core]]

## 跨域联合

- .NET/Java 恶意样本：[[re-malware]] → 本网关（dotnet / java 反编译还原）→ 回 [[re-malware]]（行为验证 + IOC）
- 恶意脚本/宏：[[re-malware]] → [[re-sandbox]]（动态）→ [[re-script-deob]]（静态还原载荷）
- 底座 [[re-binary-core]]：初勘（[[re-triage]]）、混合程序原生部分（格式解析 / [[re-ghidra]] 反编译）、混淆深层还原（[[re-deobfuscate]]）
- 本网关被 [[re-analyze]] 的 triage「.NET/Java/脚本样本」路径调用

## 常见坑与陷阱

- **凭扩展名/导入猜运行时**：PE 导入 `mscoree.dll` 未必是纯托管（混合模式 / 混淆器伪装），Jar 可能内嵌 native 库——先按工作流第 1 步确认（CLI header / manifest / 魔数）再选技能
- **.NET 自包含单文件 / Java fat jar 不解包直接分析**：单文件把 IL + 运行库捆进 native host，fat jar 的类在 `BOOT-INF/lib`——先解包（[[re-dotnet]] / [[re-java]] 有对应步骤），否则反编译产物空/乱
- **混淆层数估计不足**：还原一层发现还有一层是常态——逐层验证，每层存档，别试图一步到位
- **动态执行不上沙箱**：脚本/宏/VBA 可能下载器、可能持久化——一切动态执行默认沙箱（[[platform-tips]] 最高原则），静态解码可免
- **加固与混淆混淆**：Java 加固（Virbox 等）是"壳"，de4dot 管不了——先判"壳还是混淆"，壳走 [[re-anti-analysis]] 思路（先脱后反）
