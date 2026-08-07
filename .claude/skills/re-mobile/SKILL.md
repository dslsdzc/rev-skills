---
name: re-mobile
type: gateway
description: >
  移动应用分析网关。编排：APK 静态 → iOS → 动态 Frida → 原生库。
  子技能：[[re-apk]] [[re-ios]] [[re-frida]] [[re-mobile-pack]] [[re-hybrid-app]]。
  触发词：移动App、APK、ipa、Android逆向、iOS逆向、frida、mobile app analysis。
---

# 移动应用分析

## 完整工作流

1. 初勘：[[re-triage]] —— file/哈希/熵确认输入类型（APK 与 IPA 都是 ZIP 容器，`file` 报 ZIP；纯 `.so` / Framework dylib 直接进第 4 步）；未走 [[re-analyze]] 入口则先补做，读取 `RE_*` 会话变量
2. 静态：
   - Android：[[re-apk]] —— apktool 解包、AndroidManifest 入口/权限/组件、jadx 反编译 Java、smali 补丁思路、加固识别
   - iOS：[[re-ios]] —— ipa 解包与签名检查、class-dump 头文件、加密二进制脱壳
3. 动态：[[re-frida]] —— 需要运行时行为（解密、hook、绕过证书/检测、观察调用链）时 spawn/attach 插桩；iOS 断点调试走 [[re-lldb]]
4. 原生库：移动 App 含原生代码（Android `lib/*.so`、iOS Framework 内 dylib）→ [[re-binary-core]]：[[re-format-elf]]（Android）/ [[re-format-macho]]（iOS）解析格式，[[re-ghidra]] 反编译 JNI/OC 底层逻辑
5. 加固/带壳：[[re-apk]] 识别加固后转脱壳域（[[re-anti-analysis]]，Android）；iOS App Store 加密二进制按 [[re-ios]] 脱壳（frida-ios-dump 思路）。脱壳产物回到步骤 2 复跑
6. 产出：结论/报告（按 `RE_REPORT`），哈希与证据存档（见 [[re-triage]]）

每步结果存档（证据路径 + sha256，见 [[re-triage]]），供报告引用；发现恶意样本/回连随时转 [[re-malware]]。

## 何时用哪个原子技能（选择树）

- 输入是 APK / 目标为 Android → [[re-apk]] 静态 → 需要运行时 → [[re-frida]]
- 输入是 IPA / 目标为 iOS → [[re-ios]] 静态 + 脱壳 → 断点调试 [[re-lldb]] / 插桩 [[re-frida]]
- 目标含原生库（.so / dylib）→ [[re-binary-core]]（[[re-format-elf]] / [[re-format-macho]] / [[re-ghidra]]）
- 需要解密 / 绕过证书 / hook 函数 / 观察调用链 → [[re-frida]]
- 加固/带壳：Android → [[re-anti-analysis]]（先经 [[re-apk]] 识别）；iOS 加密 → [[re-ios]] 脱壳
- Android 加固脱壳专项（乐固/360/梆梆/爱加密）→ [[re-mobile-pack]]（识别后运行/静态脱壳 + DEX 修复）
- Flutter / React Native 混合应用 → [[re-hybrid-app]]（引擎识别 → blutter / hermes-dec）
- 提取运行时内存中的 DEX/密钥 → [[re-memdump]]（DEX 提取见该技能）

## 跨域联合

- 移动 App 含原生库：[[re-mobile]] → [[re-binary-core]]（[[re-format-elf]] / [[re-ghidra]] 反编译 JNI/OC 底层逻辑）
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
