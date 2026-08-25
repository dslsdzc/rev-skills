---
name: re-managed
type: gateway
description: >
  托管代码逆向网关。编排：识别运行时 → 反编译 → 去混淆 → 恶意场景转 [[re-malware]]。
  子技能：[[re-dotnet]] [[re-java]] [[re-script-deob]] [[re-wasm]] [[re-ai-model]] [[re-blockchain]] [[re-python]]、[[re-browser-ext]]、[[re-electron]]、[[re-javacard]]。
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
- **Python 打包样本（.exe 含 PyInstaller/PyArmor 特征 / .pyc / python 打包）** → [[re-python]]（pyinstxtractor 解包、PyArmor-Unpacker、pyc 反编译；纯脚本混淆转 [[re-script-deob]]）
- **.wasm / WebAssembly 模块（网页/Node 侧载荷）** → [[re-wasm]]（WABT 解析 section、wasm-decompile 反编译、DevTools/wasmtime 动态）
- **ONNX / safetensors / PyTorch 模型文件** → [[re-ai-model]]（格式识别、权重提取、水印/窃取判定；未知 pkl 默认隔离）
- **EVM 合约字节码（.bin / hex）** → [[re-blockchain]]（ABI 恢复、panoramix 反编译、漏洞分析）
- **浏览器扩展（crx/xpi/zip 扩展文件）** → [[re-browser-ext]]（权限审计/恶意行为/混淆还原）
- **Android DEX** → 不是本网关——转 [[re-mobile]]（[[re-apk]]），其中含 Java 原生逻辑再回 [[re-java]]
- **仅脚本调用 native 下载的 PE** → 动态侧跟 [[re-malware]]，静态侧回 [[re-binary-core]]

## 跨域联合

- .NET/Java 恶意样本：[[re-malware]] → 本网关（dotnet / java 反编译还原）→ 回 [[re-malware]]（行为验证 + IOC）
- 恶意脚本/宏：[[re-malware]] → [[re-sandbox]]（动态）→ [[re-script-deob]]（静态还原载荷）
- 底座 [[re-binary-core]]：初勘（[[re-triage]]）、混合程序原生部分（格式解析 / [[re-ghidra]] 反编译）、混淆深层还原（[[re-deobfuscate]]）
- 本网关被 [[re-analyze]] 的 triage「.NET/Java/脚本样本」路径调用
- "代码在数据里"分支：AI 模型（[[re-ai-model]]，内嵌代码转 [[re-binary-core]]）、EVM 合约字节码（[[re-blockchain]]，漏洞侧衔接 [[re-vuln]]）

## 常见坑与陷阱

- **凭扩展名/导入猜运行时**：PE 导入 `mscoree.dll` 未必是纯托管（混合模式 / 混淆器伪装），Jar 可能内嵌 native 库——先按工作流第 1 步确认（CLI header / manifest / 魔数）再选技能
- **.NET 自包含单文件 / Java fat jar 不解包直接分析**：单文件把 IL + 运行库捆进 native host，fat jar 的类在 `BOOT-INF/lib`——先解包（[[re-dotnet]] / [[re-java]] 有对应步骤），否则反编译产物空/乱
- **混淆层数估计不足**：还原一层发现还有一层是常态——逐层验证，每层存档，别试图一步到位
- **动态执行不上沙箱**：脚本/宏/VBA 可能下载器、可能持久化——一切动态执行默认沙箱（[[platform-tips]] 最高原则），静态解码可免
- **加固与混淆混淆**：Java 加固（Virbox 等）是"壳"，de4dot 管不了——先判"壳还是混淆"，壳走 [[re-anti-analysis]] 思路（先脱后反）
- **Bytenode 字节码绑定 ABI**：现象——宿主 Node 加载 JSC 失败；原因——Bytenode 字节码绑定特定 V8/Node ABI；对策——用样本自带 Electron 的 RunAsNode 模式（`ELECTRON_RUN_AS_NODE=1`）执行，不启动业务 GUI
- **注册面 ≠ 执行面**：现象——枚举 handler 无法证明数据流；原因——注册存在不等于路径执行；对策——先枚举 IPC/preload 注册面，再对高风险 handler 用 mock fixture 调用并捕获副作用（URL 接收/下载/解压/spawn 参数），形成证据闭环
- **更新链五元组取证**：现象——更新流程证据不全；原因——链路节点分散；对策——按 `source URL → downloader → archive path → extractor → executable` 每个节点保存哈希与时间戳
- **签名状态分四态**：现象——双签名 DLL 判断含糊；原因——各签名状态可能不同；对策——`signtool verify /pa /all /v` 逐签名检查（存在性/有效期/时间戳/信任验证分开报告）
- **静态能力 ≠ 已执行**：现象——native 字符串/导入显示高权限能力；原因——导入是线索不是证据；对策——能力描述结合 xref/调用链，报告分栏「条件性能力」与「已观察行为」
（来源：reverse-skill field-journal，MIT）
