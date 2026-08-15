---
name: re-hybrid-app
description: >
  Flutter/React Native 混合应用逆向。
  触发词：Flutter、React Native、混合应用、dart、libapp.so
---

# 混合应用逆向（Flutter / React Native）

## 何时使用 / 何时不用

- 用：App 内发现 libflutter.so / libapp.so（Flutter）或 assets/index.android.bundle（React Native）
- 用：需要还原混合框架的业务逻辑（dart 快照 / JS bundle）
- 用：需要定位 JS↔原生桥接（MethodChannel / NativeModules）交换的敏感数据
- 不用：纯 Java/Kotlin 原生 App（走 [[re-apk]]）
- 不用：纯原生 so 逻辑（走 [[re-binary-core]]）
- 不用：需要运行时 hook——先静态定位再 [[re-frida]]

## 工具准备

静态分析可免沙箱（[[platform-tips]] 最高原则）；动态（reFlutter 重打包 / 运行）在受控设备 / 模拟器快照内。所有工具先验证再使用。

### 引擎识别 —— jadx / unzip（复用 [[re-apk]]）

- `unzip -l app.apk` 看 assets/ 与 lib/ 结构即可判引擎，跨 OS 安装见 [[re-apk]] 工具准备

### blutter —— Flutter AOT 快照静态还原（libapp.so）

- 安装: `git clone https://github.com/worawit/blutter && cd blutter`——C++20 项目，需较新编译器（g++>=13 / Clang>=16）+ cmake/ninja/pkg-config/libicu/libcapstone + pyelftools/requests
  - Debian/Ubuntu: `apt install python3-pyelftools python3-requests git cmake ninja-build build-essential pkg-config libicu-dev libcapstone-dev`
  - Fedora: `dnf install gcc-c++ clang cmake ninja-build pkgconf-pkg-config libicu-devel capstone-devel python3-pyelftools python3-requests git`
  - Arch: `pacman -S gcc cmake ninja pkgconf icu capstone python-pyelftools python-requests git`
  - macOS: `brew install cmake ninja pkg-config icu4c capstone` + `pip3 install pyelftools requests`
- 用法: `python3 blutter.py libapp.so <输出目录>`（自动检测 Dart 版本，必要时自动下载 Dart 源码编译引擎）——目前支持 Android arm64 libapp.so 与较新 Dart 版本
- 产物: `asm/`（带符号反汇编）、`objs.txt`（对象池对象完整 dump）、`pp.txt`（对象池中所有 Dart 对象）、`blutter_frida.js`（Frida 脚本模板）
- 验证: 输出目录出现 `pp.txt` 且包含目标 App 类名

### reFlutter —— Flutter 动态（重打包 + 流量截获）

- 安装: `pip3 install reflutter`（Python 3，依赖 frida-tools）
- 用法: `reflutter main.apk` → 输入 Burp 代理 IP → 产出 `release.RE.apk` → uber-apk-signer 重签（`java -jar uber-apk-signer.jar --allowResign -a release.RE.apk`）→ 安装运行
- 产物: 运行后 `adb -d shell "cat /data/data/<包名>/dump.dart" > dump.dart`（类/函数清单 + 代码偏移）
- 验证: `reflutter -h` 输出版本与用法；重打包后能安装运行并产出 dump.dart
- 注意: Flutter >= 3.24 需手动在设备上设置代理（`adb shell settings put global http_proxy <ip:port>`）

### dart 工具链（理解快照结构，可选）

- Arch: `pacman -S dart`（extra 官方仓库）
- Debian/Ubuntu / Fedora: 官方仓库无 dart 包 → 用 Flutter SDK 自带（`snap install flutter` 或官网 SDK）
- macOS: `brew install dart`（或 `brew install --cask flutter`）；Windows: Flutter SDK zip
- 验证: `dart --version`

### RN bundle 还原 —— hermes-dec（Hermes 字节码）

- 安装: `pip3 install hermes-dec`（Python 3，纯标准库）；Ubuntu 另有 `snap install hermes-dec`（snap 版命令带 `hermes-dec.` 前缀，如 `hermes-dec.hbc-disassembler`，pip 版无前缀）；Arch AUR `yay -S hermes-dec`
- 命令: `hbc-file-parser`（解析 HBC 头 / 版本 / 函数表）、`hbc-disassembler`（字节码 → .hasm 汇编）、`hbc-decompiler`（→ 伪 JS）
- 验证: `hbc-decompiler --help` 可用；对样本文件能跑通三步
- 明文 JS bundle 美化: `pip install jsbeautifier`（Python 3，`js-beautify bundle.js`）

## 操作步骤

按顺序执行，每步产物（so / bundle / hasm / 反编译输出 + sha256）存档。

1. **引擎识别**：
   ```sh
   unzip -l app.apk | grep -E 'libapp|libflutter|assets/|bundle'
   file lib/arm64-v8a/libapp.so
   file assets/index.android.bundle    # Hermes: "Hermes JavaScript bytecode, version XX"
   ```
   - Flutter: `lib/<abi>/libapp.so`（AOT 快照）+ `libflutter.so`（引擎）+ `assets/flutter_assets/`
   - RN: `assets/index.android.bundle`（明文 JS 或 Hermes HBC）；RN 0.70+ 默认 Hermes
   - 其他: WebView 壳（assets/*.html）/ Cordova / uni-app——按 webview 路径处理
   - 识别结论决定分支: Flutter → 步骤 2；RN → 步骤 3

2. **Flutter：libapp.so 快照分析（blutter）**：
   ```sh
   python3 blutter.py lib/arm64-v8a/libapp.so ./flutter_out
   grep -r "目标类名" ./flutter_out/pp.txt             # 类/函数名在快照字符串表里
   grep -rn "https://\|api\|token\|secret" ./flutter_out/asm/ | head
   ```
   - blutter 产物给出 Dart 类/函数与对象池结构——业务逻辑按类名追踪（release AOT 保留 dart 层名称，见坑 1）
   - 动态补充: reFlutter 重打包 → dump.dart 拿运行期类/函数与偏移 → `frida -U -f <包名> -l frida.js` 结合 `_kDartIsolateSnapshotInstructions`（`readelf -Ws libapp.so`）定位 hook 点

3. **RN：bundle.js 提取与还原**：
   ```sh
   # 明文 JS
   unzip -p app.apk assets/index.android.bundle > bundle.js
   js-beautify bundle.js > bundle.pretty.js
   # Hermes 字节码
   hbc-file-parser index.android.bundle > meta.txt
   hbc-disassembler index.android.bundle out.hasm
   hbc-decompiler index.android.bundle out.js
   # 线索提取
   grep -aoE 'https?://[^"'"'"' ]+' out.js | sort -u     # 端点半程
   grep -aoE '"[A-Za-z0-9_/+=]{16,}"' out.js | sort -u   # 疑似密钥 / base64
   ```
   - hasm 层面看函数调用关系（`LoadConstString` 与 `CallN` 配对）；伪 JS 循环/条件不全时以 hasm + 字符串表为准（见坑 2）

4. **原生部分走 [[re-binary-core]]**：
   - `libflutter.so` / `libapp.so`（ELF）→ [[re-format-elf]] 解析 → [[re-ghidra]] 反编译引擎层 C++（dart:: VM、通道注册、Skia）与 JNI 桥接（FlutterEngine / PlatformChannel）
   - RN: `libhermes.so`（引擎，可选）、JNI 桥（`com.facebook.react` 包）→ 原生模块逻辑
   - 反调试 / 加密 / 证书校验常在此层（如 BoringSSL verify 函数在 libflutter.so）——hook 点见步骤 2

5. **逻辑定位（桥接边界）**：
   - Flutter: 全局 grep MethodChannel 通道名（`flutter_` 前缀常见）；PlatformChannel 收发处即敏感数据（token / 配置）交换点
   - RN: NativeModules 注册表与 `requireNativeComponent` / `NativeModules.xxx`——JS 侧找不到的加解密在原生模块里（转步骤 4）
   - 从 UI 文案 / 网络字符串反查: 字符串表（Flutter 快照 / JS bundle）→ 对应函数 → 逻辑

## 跨域联合

- [[re-mobile]]: 混合应用分支固定调用本技能（引擎识别后按框架分流）
- [[re-apk]] / [[re-ios]]: 容器侧静态（manifest、签名、iOS 等价物）
- [[re-binary-core]]: 原生部分——[[re-format-elf]] + [[re-ghidra]] 反编译 libapp.so / libflutter.so 与 RN JNI 桥
- [[re-frida]]: 运行时 hook（桥接层、证书校验、反检测）
- [[platform-tips]]: 默认沙箱、工具解析 ≠ 加载器视图（快照偏移 / 工具版本差异）
- 本技能被 [[re-analyze]] 的 triage「移动 App 分析」路径引用（re-mobile → re-hybrid-app）

## 常见坑与陷阱

- **Flutter AOT 快照无源码级符号**：现象——IDA/Ghidra 直接看 libapp.so 只见 dart:: 内部函数与裸偏移，业务函数名不可见；原因——AOT 快照没有 DWARF 符号，但 Dart 类/函数名实际保留在快照字符串表；对策——blutter 还原（pp.txt / asm/），字符串表 grep 定位类名再对照 asm 分析；不要在 ELF 符号表里找业务符号
- **RN Hermes 字节码难还原**：现象——hbc-decompiler 出的伪 JS 循环/条件全缺失、变量名成寄存器号，逻辑读不通；原因——HBC 是 VM 指令，反编译到源码级不完整；对策——hbc-disassembler 的 hasm 看调用关系（LoadConstString + CallN 定位字符串使用点），字符串表 / bundle 内明文（URL、错误提示）反查语义，必要时动态抓明文流量对照
- **引擎版本差异**：现象——blutter 报不支持该 Dart 版本 / hermes-dec 解析失败或错位；原因——工具只支持特定版本区间，App 用新引擎（Dart 3.x 新快照格式、Hermes 新 bytecode 版本）；对策——先取版本（libflutter.so 内版本字符串 / `file` 输出 HBC version / 构建时间），更新工具（blutter 会按需下载对应 Dart 源码重编）或换支持该版本的专用工具
- **JS 与原生桥接边界**：现象——JS/bundle 里找不到加解密与密钥逻辑；原因——敏感逻辑在原生模块（RN NativeModules / Flutter MethodChannel 原生端）；对策——按步骤 5 找桥接注册（通道名 / 原生模块表）→ 转 [[re-binary-core]] 分析对应 so；别在 JS 层死磕
- **混淆构建**：现象——函数名全是 a/b/c 或 hash；原因——Flutter `--obfuscate` / RN Hermes + 混淆选项构建；对策——仍可用的字符串（报错文案 / API 路径）与行为观察驱动，配合动态 [[re-frida]] hook 桥接层定位
- **Flutter SSL 校验抓不到包**：现象——抓包工具看不到 Flutter 应用流量或报证书错误；原因——Flutter 自带 SSL 校验（不走系统代理/证书信任链），通杀方案在 github 有开源代码；对策——先用通杀 Flutter SSL 校验方案或 frida 绕过抓包；blutter 还原后 libapp.so 符号可见，可直接基于地址 hook 目标函数（如签名函数 generateMD5 的入参/返回值拿盐值与明文）——不需要完整还原算法
- **Dart 字符串内存布局（frida 读串关键）**：现象——hook libapp.so 函数拿到指针却读不出字符串；原因——Dart 字符串不是 C 字符串：**指针 +7 偏移处 4 字节 Smi 编码长度（右移 1 位为真实长度），+15 偏移处为 UTF-8 数据**；对策——按此布局写 readDartStringExact 工具函数（加长度上限防误读），hook 入参/返回值都能还原明文
