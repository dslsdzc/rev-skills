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
- 用：授权/分发状态判定——签名者、公证、hardened runtime、Team ID 是谁（分发面/信任面分析）
- 用：信任链问题——Dylib Hijacking、注入面、TCC 依赖（哪些隐私能力被请求/使用）
- 不用：iOS 应用（转 [[re-ios]]）；纯 Mach-O 格式解析（转 [[re-format-macho]]）
- 不用：Linux/Windows 目标（各走 [[re-gdb]] / [[re-x64dbg]]）
- 不用：只想抓网络流量/文件行为（无 macOS 特有面时走 [[re-behavior]] / [[re-netcap]] 通用路径）
- 注意：TCC 与钥匙串数据属系统隐私范畴，只读分析不导出内容（红线）

## 工具准备

### codesign / spctl / otool / lipo（签名与 Mach-O 工具，macOS 内置）

- macOS: 系统自带（Xcode 命令行工具 `xcode-select --install`）
- Linux: 可静态分析 Mach-O（`llvm-otool`，`brew install llvm` 或发行版 llvm 包），签名解析受限
- 验证: `codesign --version`、macOS: `otool --version`；Linux: `llvm-otool --version`

### plutil / xattr（Info.plist 与 quarantine 检查，macOS 内置）

- 验证: `plutil -help`、`xattr -h`
- 用途: Info.plist 键解析（`plutil -p`）；`com.apple.quarantine` 扩展属性决定 Gatekeeper 是否拦截

### Hopper / IDA / Ghidra（反编译底座）

- 安装与验证见 [[re-ida]] / [[re-ghidra]]

### lldb（动态调试）

- 安装与验证见 [[re-lldb]]；attach 前先处理 PT_DENY_ATTACH（步骤 6）

## 操作步骤

按顺序执行，每步产物存档（路径 + sha256，见 [[re-triage]]）。签名/entitlements 信息按 [[analysis-contract]] 契约记录。

1. **包结构与签名检查**：
   ```sh
   file Sample.app/Contents/MacOS/Sample
   codesign -dv Sample.app 2>&1 | head            # 签名者/Team ID（要求需 `-d -r-` 查看）
   spctl -a -vv Sample.app 2>&1                   # 公证状态（Gatekeeper）
   defaults read Sample.app/Contents/Info.plist   # Info.plist 关键键
   ```
   - 关注：签名者（Apple 开发者/分发证书）、Team ID、CDHash、Hardened Runtime（runtime 标志）、Info.plist 的 CFBundleIdentifier/版本/最低系统版本
   - 架构确认：`file` 输出/x86_64 与 arm64 通用二进制（`lipo -archs`）——决定反编译与动态环境（Apple Silicon 上 arm64e 有 PAC 差异，见 [[gotchas]]）
   - 公证派生检查：`spctl -a` 通过不保证本地有 staple——`xcrun stapler validate Sample.app` 查票证是否随包
   - 下载来源检查：`xattr -l Sample.app` 看 `com.apple.quarantine`（Gatekeeper 拦不拦、来源 URL）

2. **entitlements 与沙箱**：
   ```sh
   codesign -d --entitlements :- Sample.app 2>&1 | head -30
   ```
   - 关键键分组：`com.apple.security.app-sandbox`（沙箱总开关）、`network.client/server`（网络）、`files.user-selected.*`（用户选文件）、`device.camera/microphone`（设备）、`application-groups`（组共享）、`cs.allow-dyld-environment-variables` / `cs.disable-library-validation`（注入面）、`get-task-allow`（调试权限，发布版不应有）
   - 沙箱 profile 决定能力边界——分析授权逻辑与攻击面时先看 entitlements 清单，动态行为再交叉验证
   - 异常信号：发布版带 `get-task-allow`（本应只用于开发调试）或越权组合（如无 UI 却开 `device.camera`）——记录为可疑项进结论

3. **TCC 权限库**：
   ```sh
   # 用户级 TCC 库（授权记录）
   ls ~/Library/Application\ Support/com.apple.TCC/
   # 系统级 TCC 库
   ls /Library/Application\ Support/com.apple.TCC/
   ```
   - 前置检查：TCC.db 自身受 TCC 保护——无 Full Disk Access 时读取会权限失败，先确认授权再读
   - TCC.db（SQLite）记录各 App 对隐私资源的授权；分析目标对 TCC 的依赖（请求了什么权限、何时请求、失败路径）
   - 注意：TCC 数据属系统隐私数据，只读分析不导出内容（红线）

4. **钥匙串与 Secure Enclave**：
   - 钥匙串条目类型（通用密码/互联网密码/密钥）与 ACL（`kSecAttrAccessible` 可访问性类：非锁定/首次解锁/此设备）
   - Secure Enclave 密钥：`SecKeyCreateWithData` 带 `kSecAttrTokenIDSecureEnclave` —— 私钥**不可提取**（等价 Android Keystore 硬件背书，见 [[re-android-native]] Keystore 审计）
   - 分析：目标读哪些钥匙串条目（SecItemCopyMatching 调用点）、密钥是否 Secure Enclave 绑定（不可提取 → 记录用途与 ACL 而非找字节）

5. **dyld 加载链**：
   ```sh
   otool -L Sample.app/Contents/MacOS/Sample | head    # LC_LOAD_DYLIB 依赖
   otool -l Sample.app/Contents/MacOS/Sample | grep -A4 LC_RPATH
   ```
   - 依赖清单与 RPATH → Dylib Hijacking 面（可写目录 + 缺失依赖组合）
   - 注入面：DYLD_INSERT_LIBRARIES 受 hardened runtime 限制——entitlements 无 `cs.allow-dyld-environment-variables` 时不生效；system 完整性保护下对系统路径注入无效
   - 注入验证：环境变量 + 沙箱内试跑 `DYLD_INSERT_LIBRARIES=/path/to/hook.dylib ./Sample`，无效即回到静态路径（[[re-ghidra]]），不硬注入

6. **反调试与保护**：
   - 调试器检测：`PT_DENY_ATTACH`（ptrace 请求在 attach 时返回拒绝）——先静态定位 ptrace 调用点（[[re-ghidra]] / [[re-ida]]），patch 或绕过后再 attach
   - 签名校验：`SecStaticCodeCheckValidity` / `SecRequirementCheck` 类调用点——改签名或注入触发校验失败的典型点，逐点定位（坑 1）
   - 对抗面记录：代码签名校验、调试器检测、反注入（DYLD_INSERT_LIBRARIES 检查）三类各自调用点与触发条件

7. **证据核对（收尾）**：签名者/Team ID/entitlements 原文、TCC 依赖点、钥匙串条目用途、dyld 依赖清单——按 [[analysis-contract]] 入档；动态结论与静态清单对照（能力边界以动态行为为准，见 [[decision-tree]]）

## 跨域联合

- [[re-format-macho]]：Mach-O 格式底座（LC_* 解析）
- [[re-ios]]：iOS 侧互补（越狱生态与 entitlements 差异）
- [[re-lldb]]：动态调试
- [[re-frida]]：动态插桩（macOS 桌面支持）
- [[re-sandbox]] / [[platform-tips]]：动态执行隔离（签名/行为观察在沙箱内进行）
- [[analysis-contract]]：签名/entitlements 信息按数据契约传递
- [[re-patching]]：PT_DENY_ATTACH 与签名校验点的持久化处理
- Swift 层分析（mangling/witness table）→ [[re-swift]]

## 常见坑与陷阱

- **签名校验多处触发**：现象——patch 后运行即退；原因——加载/运行/更新多处校验；对策——逐点定位（步骤 6），先处理校验点再过逻辑
- **Secure Enclave 密钥不可提取**：现象——内存搜不到私钥；原因——硬件背书；对策——记录用途与 ACL，不找字节（见步骤 4）
- **TCC 权限导致功能缺失**：现象——目标功能灰掉；原因——TCC 未授权；对策——分析其请求逻辑而非绕过系统权限（红线）
- **公证检查离线不可复现**：现象——离线环境 spctl 结果异常；原因——公证需要网络查询（含吊销状态）；对策——用 codesign 本地签名信息替代，标注「公证状态未验证」
- **hardened runtime 限制注入**：现象——DYLD_INSERT_LIBRARIES 无效；原因——runtime 标志未含 allow-dyld 环境变量；对策——静态分析路径（[[re-ghidra]]），不硬注入
- **quarantine 干扰运行**：现象——目标下载来源时崩溃/弹窗；原因——`com.apple.quarantine` 触发 Gatekeeper 检查；对策——`xattr -dr com.apple.quarantine` 去除后重测（仅测试环境）
- **嵌套签名漏处理**：现象——patch 后运行时校验失败；原因——framework/helper/扩展各自独立签名，只重签主程序不够；对策——`codesign --deep` 或逐层重签，核对每层 CDHash
- 决策分支（动态可行性判定/数据目标分级）见 [[decision-tree]]；签名/注入/TCC 边界与反例见 [[gotchas]]；全部在沙箱内执行（[[platform-tips]] 最高原则）
