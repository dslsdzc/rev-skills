---
name: re-mobile
type: gateway
description: >
  移动应用分析网关。编排：APK 静态 → iOS → 动态 Frida → 原生库。
  子技能：[[re-apk]] [[re-ios]] [[re-frida]] [[re-frida-script-author]] [[re-mobile-pack]] [[re-hybrid-app]]
  [[re-android-native]] [[re-android-crypto]] [[re-ios-jb]] [[re-flutter]] [[re-harmonyos]]。
  触发词：移动App、APK、ipa、Android逆向、iOS逆向、frida、mobile app analysis。
capabilities: [dex-parser, jni-analysis, frida-instrumentation, mobile-forensics]
---

# 移动应用分析

## 完整工作流

1. 初勘：[[re-triage]] —— file/哈希/熵确认输入类型（APK 与 IPA 都是 ZIP 容器，`file` 报 ZIP；纯 `.so` / Framework dylib 直接进第 4 步）；未走 [[re-analyze]] 入口则先补做，读取 `RE_*` 会话变量
2. 静态：
   - Android：[[re-apk]] —— apktool 解包、AndroidManifest 入口/权限/组件、jadx 反编译 Java、smali 补丁思路、加固识别
   - iOS：[[re-ios]] —— ipa 解包与签名检查、class-dump 头文件、加密二进制脱壳
3. 动态：[[re-frida]] —— 需要运行时行为（解密、hook、绕过证书/检测、观察调用链）时 spawn/attach 插桩；iOS 断点调试走 [[re-lldb]]
4. 原生库：移动 App 含原生代码（Android `lib/*.so`、iOS Framework 内 dylib）→ [[re-binary-core]]：[[re-format-elf]]（Android）/ [[re-format-macho]]（iOS）解析格式，[[re-ghidra]] 反编译 JNI/OC 底层逻辑；Android native 深挖（JNI 注册还原、so 逻辑）走 [[re-android-native]]；iOS 越狱环境（越狱检测 / tweak / 动态调试）走 [[re-ios-jb]]
5. 加固/带壳：[[re-apk]] 识别加固后转脱壳域（[[re-anti-analysis]]，Android）；iOS App Store 加密二进制按 [[re-ios]] 脱壳（frida-ios-dump 思路）。脱壳产物回到步骤 2 复跑
6. 产出：结论/报告（按 `RE_REPORT`），哈希与证据存档（见 [[re-triage]]）

每步结果存档（证据路径 + sha256，见 [[re-triage]]），供报告引用；发现恶意样本/回连随时转 [[re-malware]]。

## 何时用哪个原子技能（选择树）

- 输入是 APK / 目标为 Android → [[re-apk]] 静态 → 需要运行时 → [[re-frida]]
- 输入是 IPA / 目标为 iOS → [[re-ios]] 静态 + 脱壳 → 断点调试 [[re-lldb]] / 插桩 [[re-frida]]
- 目标含原生库（.so / dylib）→ [[re-binary-core]]（[[re-format-elf]] / [[re-format-macho]] / [[re-ghidra]]）；Android native 专项（JNI/so）→ [[re-android-native]]
- 目标有越狱检测 / 要 tweak 分析 / 越狱设备动态调试 → [[re-ios-jb]]
- 需要解密 / 绕过证书 / hook 函数 / 观察调用链 → [[re-frida]]
- 加固/带壳：Android → [[re-anti-analysis]]（先经 [[re-apk]] 识别）；iOS 加密 → [[re-ios]] 脱壳
- Android 加固脱壳专项（乐固/360/梆梆/爱加密）→ [[re-mobile-pack]]（识别后运行/静态脱壳 + DEX 修复）
- Flutter / React Native 混合应用 → [[re-hybrid-app]]（引擎识别 → blutter / hermes-dec）
- 提取运行时内存中的 DEX/密钥 → [[re-memdump]]（DEX 提取见该技能）

## 跨域联合

- 移动 App 含原生库：[[re-mobile]] → [[re-binary-core]]（[[re-format-elf]] / [[re-ghidra]] 反编译 JNI/OC 底层逻辑）；Android native 专项 [[re-android-native]]；iOS 越狱环境 [[re-ios-jb]]（越狱检测 / tweak / lldb 远程）
- 移动 App 加固/带壳：[[re-mobile]] → [[re-anti-analysis]]（Android 脱壳）；iOS 加密二进制 [[re-ios]] 脱壳
- 动态分析默认沙箱：模拟器快照 / 受控越狱设备 + 网络隔离（[[platform-tips]] 最高原则）
- 移动恶意样本/回连：[[re-mobile]] → [[re-malware]]（行为分析见 [[re-sandbox]]）
- 本网关被 [[re-analyze]] 的 triage.md「移动 App 分析」路径调用（re-mobile → re-apk / re-ios → re-frida → 若含原生库 re-binary-core）

## 常见坑与陷阱

- 拿到 APK 直接 jadx 出 Java 就下结论 → 加固样本 jadx 只看到壳壳 —— 先 [[re-apk]] 识别加固，再转脱壳域（[[re-anti-analysis]]）或动态取内存 DEX
- iOS 加密二进制当普通静态目标分析 → class-dump/otool 只见壳或密文 —— 先按 [[re-ios]] 查 `cryptid` 并脱壳再继续
- 移动动态分析直接上真机裸跑 → 设备环境不可控、证据难复现 —— 优先模拟器快照 / 受控越狱设备，网络隔离（[[platform-tips]] 最高原则）
- 忽略原生库 → 只分析了 Java/OC 层，核心逻辑（JNI、反调试、敏感算法）全在 .so/dylib —— 见 `lib/` 与 Framework 即转 [[re-binary-core]]
- 选择树跳步 → 静态没做完就 frida，或动态手段全用上还是没进展 —— 按工作流 1→6 顺序推进，每步证据存档后再进下一步

### 移动包重打包与补丁

- **重打包保持原始格式参数**：现象——重打包/替换资源后的包在真机加载崩溃或解析失败；原因——重打包工具默认输出格式与原格式存在差异（压缩方式/对齐/容器标志）；对策——保留原包的格式参数（压缩标志/对齐方式），产出与原始文件同量级同格式，先本地验证再上真机
- **替换内嵌资源前先摸清宿主结构**：现象——替换后目标读取错位；原因——容器内嵌长度/头部字段未知（替换内容长度变化时未同步长度字段）；对策——先脚本解析宿主结构（魔数/长度字段位置），替换后从最终产物反向解出内容比对验证（压缩容器里 strings 搜不到，必须解压验证）
- **补丁注入点选内容完全已知的模块**：现象——想改逻辑复杂的模块，只能字节级 patch 指令流，易碎；原因——没有声明式/可读的宿主；对策——选内容可完整还原、可整体重写的模块（配置类/常量类）作注入宿主，把补丁逻辑附加在宿主尾部
- **补丁绝不阻塞主流程**：现象——补丁代码在宿主框架未就绪时执行，崩溃或卡死；原因——注入时机过早（宿主依赖未初始化）；对策——轮询宿主就绪标志（UI 框架 root/主对象可用）再执行，全部异常保护，超时静默放弃并回退原始行为
- **真机 native 崩溃排障顺序**：现象——tombstone/native 栈只定位到模块层，看不出根因；原因——运行时保护（pcall/异常捕获）救不住 native abort，托管异常日志才是根因；对策——先怀疑"重打包格式差异"（压缩/对齐/容器结构），再怀疑逻辑；根因证据看运行时异常日志（FATAL EXCEPTION / Unhandled Exception），别只看 native 栈
- **渠道包 ≠ 官方包**：第三方渠道重打包版（包名带渠道标识、登录走渠道 SDK）的协议/行为结论不能直接套用官方包——分析前先确认包来源（包名/签名/渠道 SDK 特征）

