---
name: re-ios
description: >
  iOS 应用分析：Mach-O、class-dump、越狱环境。
  触发词：ios逆向、ipa、class-dump、越狱
---

# iOS 应用分析

## 何时使用 / 何时不用

- 用：拿到 IPA / 已安装 iOS 应用，需要看 Mach-O 结构、OC 类结构、代码签名、越狱环境动态分析
- 用：App Store 加密二进制需要脱壳
- 不用：目标只是 Mach-O 结构 / load commands（直接走 [[re-format-macho]]）
- 不用：需要运行时 hook / 绕过（走 [[re-frida]]）
- 不用：无越狱、无受管设备时的动态分析场景（静态先行，动态受限说明见坑 3）

## 工具准备

静态分析（解包 / class-dump / otool）可免沙箱；动态（越狱设备 / 模拟器 / 受管设备）按 [[platform-tips]] 最高原则在受控环境执行。

### unzip / zipinfo —— ipa 解包

- Linux: `apt install unzip` / `dnf install unzip` / `pacman -S unzip`
- macOS: 自带 /usr/bin/unzip；Windows/WSL: WSL 内 Linux 版
- 验证: `unzip -v`

### class-dump —— OC 头文件导出

- macOS: 官方仓库 nygard/class-dump 最新 release 3.4 仅源码无预编译二进制——源码构建（xcodebuild）使用；`brew install class-dump` 公式已从 homebrew-core 下架（2026 实测 formulae.brew.sh 无此公式），不再可用
- 替代: class-dump-swift（mxms0/class-dump-swift）同样支持 OC 与 Swift 类/方法导出，源码构建（需 Swift toolchain）——Swift 目标优先用它
- Linux/Windows: 无官方版；用 class-dump-swift 源码编译（Swift toolchain），或在 macOS 虚拟机 / 远程 macOS 上执行
- 验证: `class-dump --help`（输出 usage 即可）

### otool —— Mach-O 结构 / 符号查看（Apple 自带）

- macOS: `xcode-select --install`（Xcode Command Line Tools）
- Linux 替代: `llvm-otool`（`apt install llvm` / `brew install llvm`）
- 验证: `otool -h /bin/ls`

### idevice 工具链（libimobiledevice）—— 设备识别 / 信息

- macOS: `brew install libimobiledevice`（含 idevice_id / ideviceinfo / ideviceinstaller）
- Linux: `apt install libimobiledevice-utils`（Debian/Ubuntu）；Arch: `pacman -S libimobiledevice`
- 验证: `idevice_id -l` 列出已连接设备 UDID；`ideviceinfo` 输出设备型号/iOS 版本/UDID

### 越狱环境（可选）

- 越狱工具：unc0ver / checkra1n / palera1n（按设备型号与 iOS 版本选择），越狱后安装 OpenSSH + 包管理器（Sileo / Cydia）
- 验证: `ssh root@<设备IP>` 能登录
- 未越狱但需真机：Apple 开发者账号签名安装（免费账号签名 7 天有效，见坑 2）；越狱环境专项（tweak 开发/越狱检测）见 [[re-ios-jb]]

### frida-ios-dump —— App Store 加密应用脱壳

- 前置：越狱设备 + frida-server（见 [[re-frida]] 工具准备）+ usbmuxd 转发
- 安装：`git clone https://github.com/AloneMonkey/frida-ios-dump && cd frida-ios-dump && pip install -r requirements.txt`
- macOS: `brew install libusbmuxd`（原 usbmuxd 公式已改名，2026 实测）；Linux: `apt install usbmuxd`（Debian/Ubuntu，含 iproxy）；Arch: `pacman -S libusbmuxd`
- 验证: `python3 dump.py -h`（输出 usage 即可）；`iproxy -h`（转发工具可用性）

## 操作步骤

按顺序执行，每步记下结果（证据路径 + sha256，见 [[re-triage]]）。

1. **ipa 解包与签名检查**：
   ```sh
   unzip app.ipa -d app/
   file app/Payload/*.app/*                   # 确认主二进制是 arm64 Mach-O
   codesign -dv app/Payload/*.app/ 2>&1       # 签名类型（Apple Distribution / Development / adhoc）
   otool -l app/Payload/*.app/ | grep -B1 -A4 LC_ENCRYPTION_INFO   # 查 cryptid
   ```
   `cryptid 1` = App Store 加密，磁盘上代码是密文，先脱壳（步骤 5）再继续。
   - 包结构速览：`Payload/<App>.app/` 是主二进制与资源；`SwiftSupport/` 是系统 Swift 库（模拟器包常见）；`embedded.mobileprovision` 是签名描述文件（macOS 上 `security cms -D -i` 可读 entitlement 与过期时间）
   - `file` 确认主二进制是 arm64/arm64e 真机架构——x86_64 模拟器产物无动态分析价值，直接跳过

2. **class-dump 头文件**：
   ```sh
   class-dump -H app/Payload/*.app/ -o headers/
   ```
   类名 / 方法名 / 属性即大部分业务接口，先看 headers 再进反编译。加密二进制先脱壳（步骤 5）再 dump，否则只得到壳的类。Swift 方法不进 OC 头文件（见坑 4）。

3. **二进制走 [[re-format-macho]]**：
   ```sh
   otool -h app/Payload/*.app/                # 架构 / cputype
   otool -L app/Payload/*.app/                # 依赖 dylib（framework 清单）
   ```
   结构、load commands、入口、段、签名按 [[re-format-macho]] 步骤执行；Swift 二进制用 `strings -n 6` 找符号与错误消息辅助定位。

4. **越狱环境动态调试**：
   ```sh
   iproxy 2222 22 &                           # usbmuxd 转发设备 ssh 到本机 2222
   ssh -p 2222 root@127.0.0.1                 # 登录越狱设备
   ```
   设备上启动目标 App；断点 / 单步调试经 debugserver + lldb（见 [[re-lldb]]）；hook / 绕过优先 [[re-frida]]（frida-server 安装见该技能）。

5. **脱壳（frida-ios-dump 思路）**：
   ```sh
   iproxy 2222 22 &
   cd frida-ios-dump && python3 dump.py <BundleID 或 App 名>   # 从设备拉取并解密，输出 ipa
   file <输出>.ipa
   otool -l <输出>/Payload/*.app/ | grep -A4 LC_ENCRYPTION_INFO # 确认 cryptid 0
   ```
   思路：frida-server 读取已解密内存中的 Mach-O 头与段，重组为解密 ipa。脱壳产物回到步骤 1-3 复跑。

## 跨域联合

- [[re-mobile]]：工作流第 2 步（iOS 分支）固定调用本技能
- 二进制解析 → [[re-format-macho]]；断点调试 → [[re-lldb]]；插桩 / 绕过 / 脱壳执行 → [[re-frida]]
- 本技能被 [[re-analyze]] 的 triage「移动 App 分析」路径调用（re-mobile → re-ios）
- 桌面 macOS 生态（签名/entitlements/Secure Enclave）→ [[re-macos]]
- Swift 层分析（mangling/witness table）→ [[re-swift]]
- 越狱环境专项（tweak 分析与开发、越狱检测识别绕过）→ [[re-ios-jb]]

## 常见坑与陷阱

- **App Store 加密二进制直接分析**：现象——class-dump 无输出 / otool 结构残缺、反编译只见壳；原因——`cryptid 1` 加密，磁盘上的代码是密文；对策——步骤 1 先查 LC_ENCRYPTION_INFO，加密先按步骤 5 脱壳（frida-ios-dump 思路）
- **签名失效无法安装**：现象——重打包 / 修改后真机安装报"无法验证 App"或无法安装；原因——签名与内容不一致，或免费证书 7 天过期；对策——`codesign -f -s -` adhoc 重签（仅自签场景）或重新用开发者证书签名；免费账号到期重新安装
- **无越狱 → 动态分析受限**：现象——没有越狱设备，frida-ios-dump / lldb attach / frida 全不可用；原因——iOS 沙盒与签名强制限制动态调试；对策——静态分析先行（步骤 1-3），动态转模拟器（需不加密应用）或受管设备（Apple Configurator 部署 + 开发证书），实在不行只做静态
- **Swift 方法不进 class-dump 头**：现象——类头文件里找不到业务方法；原因——Swift 不导出 OC 运行时元数据；对策——`strings` / `swift-demangle` 找符号，逻辑分析靠 [[re-format-macho]] + 反编译（[[re-binary-core]]）
- **class-dump 对 arm64e 二进制报错**：现象——class-dump 崩溃或输出为空；原因——arm64e 指针签名（PAC）干扰元数据遍历；对策——换新版 class-dump / class-dump-swift，或先脱壳再 dump
- **拿到模拟器产物当真机分析**：现象——`file` 显示主二进制是 x86_64，动态分析全不可用；原因——分发方给了模拟器包（常带 SwiftSupport/）；对策——步骤 1 用 `file` 确认 arm64/arm64e 真机架构，模拟器产物跳过
- **class-dump 装不上（brew 公式下架）**：现象——`brew install class-dump` 报 No available formula；原因——homebrew-core 已移除该公式（2026 实测）；对策——nygard/class-dump 源码构建，或换 class-dump-swift（见工具准备）
