---
name: re-macos
type: atomic
description: >
  macOS 原生应用逆向：App Bundle/签名公证、entitlements、沙箱与 TCC、钥匙串与 Secure Enclave。
  触发词：macOS逆向、mac app、entitlements、Secure Enclave、钥匙串、TCC、codesign、公证。
---

# macOS 应用逆向

## 何时使用 / 何时不用

- 用：macOS 原生/闭源应用（.app/.dylib/.framework）、带签名公证与沙箱的目标、钥匙串/Secure Enclave 硬件密钥场景
- 不用：iOS 应用（转 [[re-ios]]）；纯 Mach-O 格式解析（转 [[re-format-macho]]）

## 工具准备

### codesign / spctl / otool / lipo（签名与 Mach-O 工具，macOS 内置）

- macOS: 系统自带（Xcode 命令行工具 `xcode-select --install`）
- Linux: 可静态分析 Mach-O（`llvm-otool`，`brew install llvm` 或发行版 llvm 包）
- 验证: `codesign --version`、macOS: `otool --version`；Linux: `llvm-otool --version`

### Hopper / IDA / Ghidra（反编译底座）

- 安装与验证见 [[re-ida]] / [[re-ghidra]]

### lldb（动态调试）

- 安装与验证见 [[re-lldb]]

## 操作步骤

按顺序执行，每步产物存档（路径 + sha256，见 [[re-triage]]）。

1. **包结构与签名检查**：
   ```sh
   file Sample.app/Contents/MacOS/Sample
   codesign -dv Sample.app 2>&1 | head            # 签名者/Team ID（要求需 `-d -r-` 查看）
   spctl -a -vv Sample.app 2>&1                   # 公证状态（Gatekeeper）
   defaults read Sample.app/Contents/Info.plist   # Info.plist 关键键
   ```
   - 关注：签名者（Apple 开发者/分发证书）、Team ID、Hardened Runtime（runtime 标志）、Info.plist 的 CFBundleIdentifier/版本

2. **entitlements 与沙箱**：
   ```sh
   codesign -d --entitlements :- Sample.app 2>&1 | head -30
   ```
   - 关键键：`com.apple.security.app-sandbox`（沙箱开启）、`com.apple.security.network.client/server`、`com.apple.security.files.user-selected.*`、`com.apple.security.device.*`（摄像头/麦克风）
   - 沙箱 profile 决定能力边界——分析授权逻辑时先看 entitlements 清单

3. **TCC 权限库**：
   ```sh
   # 用户级 TCC 库（授权记录）
   ls ~/Library/Application\ Support/com.apple.TCC/
   ```
   - 前置检查：TCC.db 自身受 TCC 保护——无 Full Disk Access 时读取会权限失败，先确认授权再读
   - TCC.db（SQLite）记录各 App 对隐私资源的授权；分析目标对 TCC 的依赖（它请求了什么权限、何时请求）
   - 注意：TCC 数据属系统隐私数据，只读分析不导出内容（红线 2）

4. **钥匙串与 Secure Enclave**：
   - 钥匙串条目类型（通用密码/互联网密码/密钥）与 ACL（`kSecAttrAccessible` 可访问性类：非锁定/首次解锁/此设备）
   - Secure Enclave 密钥：`SecKeyCreateWithData` 带 `kSecAttrTokenIDSecureEnclave` —— 私钥**不可提取**（等价 Android Keystore 硬件背书，见 [[re-android-native]] Keystore 审计）
   - 分析：目标读哪些钥匙串条目（SecItemCopyMatching 调用点）、密钥是否 Secure Enclave 绑定（不可提取 → 记录用途而非字节）

5. **dyld 加载链**：
   ```sh
   otool -L Sample.app/Contents/MacOS/Sample | head    # LC_LOAD_DYLIB 依赖
   otool -l Sample.app/Contents/MacOS/Sample | grep -A4 LC_RPATH
   ```
   - 依赖清单与 RPATH → Dylib Hijacking 面（可写目录 + 缺失依赖）
   - 注入面：DYLD_INSERT_LIBRARIES（受 hardened runtime 限制——有 `com.apple.security.cs.allow-dyld-environment-variables` 才可注入）

6. **反调试与保护**：
   - taskgated/签名校验：改签名或注入触发校验失败的典型点
   - 对抗面分析：代码签名校验（`SecStaticCodeCheckValidity`）、调试器检测（`PT_DENY_ATTACH`）、反注入（`DYLD_INSERT_LIBRARIES` 检查）
   - 动态侧：[[re-lldb]] attach 前先处理 PT_DENY_ATTACH（ptrace 调用点 patch）

## 跨域联合

- [[re-format-macho]]：Mach-O 格式底座（LC_* 解析）
- [[re-ios]]：iOS 侧互补（越狱生态与 entitlements 差异）
- [[re-lldb]]：动态调试
- [[re-frida]]：动态插桩（macOS 桌面支持）
- [[analysis-contract]]：签名/entitlements 信息按数据契约传递

## 常见坑与陷阱

- **签名校验多处触发**：现象——patch 后运行即退；原因——加载/运行/更新多处校验；对策——逐点定位（步骤 6），先处理校验点再过逻辑
- **Secure Enclave 密钥不可提取**：现象——内存搜不到私钥；原因——硬件背书；对策——记录用途与 ACL，不找字节（见步骤 4）
- **TCC 权限导致功能缺失**：现象——目标功能灰掉；原因——TCC 未授权；对策——分析其请求逻辑而非绕过系统权限（红线）
- **公证检查离线不可复现**：现象——离线环境 spctl 结果异常；原因——公证需要网络查询；对策——用 codesign 的本地签名信息替代
- **hardened runtime 限制注入**：现象——DYLD_INSERT_LIBRARIES 无效；原因——runtime 标志未含 allow-dyld 环境变量；对策——静态分析路径（[[re-ghidra]]），不硬注入
