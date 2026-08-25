# iOS 应用分析工具特有坑与边界

## 签名与安装坑组

- **免费签名 7 天失效**：免费 Apple ID 签名应用 7 天过期——长时间分析先确认签名有效期（`security cms -D -i embedded.mobileprovision` 读过期时间），别把「签名过期无法安装」误判成「补丁/重打包失败」
- **重打包后签名与内容不一致**：改过二进制必须重新签名（`codesign -f -s -` adhoc 仅自签场景，或开发者证书），否则真机报「无法验证 App」；adhoc 签名只覆盖本机自装，与原始签名并存场景看安装方式
- **entitlements 影响运行**：重签时丢失原始 entitlements（如 keychain-access-groups、aps-environment）会改变行为——`codesign -d --entitlements -` 先导出原始项，重签带上
- **免费账号签名的限制**：免费账号无 App Group/推送等能力，且签名 7 天——需要完整能力的场景用付费开发者账号或受管设备

## 加密与脱壳坑组

- **cryptid 判定必须看 LC_ENCRYPTION_INFO 段**：`codesign` 结果不能说明加密状态，只有 `otool -l` 里的 LC_ENCRYPTION_INFO（cryptid 0/1）为准——解包后先跑这一步再规划
- **脱壳依赖越狱 + frida 版本匹配**：frida-ios-dump 对 frida-server 版本敏感（14.x/16.x 行为差异），dump 失败先核对 [[re-frida]] 工具准备里的版本对应；A12+ 设备 arm64e 上 frida 需对应架构的 server
- **脱壳产物 cryptid 0 但代码仍怪**：解密后的 Mach-O 可能残留加密 stub 或 section 顺序异常——正常现象，以实际反编译结果为准；个别应用有反 dump 检测（重启后重新加密），一次 dump 不成功多试几次并保持进程存活
- **无越狱拿不到加密应用**：App Store 加密二进制在无越狱/无受管设备上无法脱壳——静态分析（字符串/符号）先行，动态面明确放弃（SKILL.md 坑 3）

## class-dump 工具族坑组

- **arm64e（PAC）干扰元数据遍历**：class-dump 对 arm64e 崩溃/空输出——换新版或 class-dump-swift，或先脱壳；PAC 是设备 A12+ 真机产物，模拟器/老设备无此问题
- **Swift 方法不进 OC 头文件**：Swift 类不导出 OC 运行时元数据——`strings`/`swift-demangle` 找符号，或直接用 class-dump-swift 导 Swift 声明（SKILL.md 坑 4）
- **brew 公式已下架**：`brew install class-dump` 2026 年起报 No available formula（homebrew-core 移除）；nygard/class-dump 最新 release 3.4 只有源码——按工具准备走源码构建或 class-dump-swift，别在 brew 上反复折腾
- **加密二进制上 dump 只得到壳类**：`cryptid 1` 时先脱壳再 dump——顺序反了输出永远是壳的类（SKILL.md 坑 1）

## 越狱环境坑组

- **默认 ssh 密码是 alpine**：OpenSSH 装好后不设置就是 root/alpine；设备侧改掉，但分析环境记录当前凭据
- **usbmuxd 转发失败先看服务**：Linux 上 `systemctl status usbmuxd` / 手动 `usbmuxd -f` 确认守护进程；`iproxy` 报绑定失败换本地端口
- **越狱检测目标行为跳变**：样本检测越狱环境（Cydia 路径、fork 检测、沙盒逃逸探测）后降级/退出——先静态识别检测点（[[re-ios-jb]]），再决定绕过或调整观察方式；越狱环境本身也是证据链一部分，记录设备与越狱工具版本

## 版本差异

- **class-dump（nygard/class-dump）**：最新 3.4（2022 年后未更新），仅源码；`brew install class-dump` 已不可用。替代 class-dump-swift（mxms0/class-dump-swift）维护活跃，支持 Swift
- **usbmuxd → libusbmuxd（homebrew）**：macOS `brew install usbmuxd` 已失效（公式改名），用 `brew install libusbmuxd`；Linux 上 Debian/Ubuntu 包名仍是 `usbmuxd`（含 iproxy），Arch 为 `libusbmuxd`
- **frida-ios-dump**：依赖 frida-server 与 usbmuxd 工具链；frida 主版本升级后 `dump.py` 行为可能有差异，先核对 [[re-frida]] 的 frida-server 安装
- **越狱工具与 iOS 版本**：unc0ver（iOS 14-15 系）、palera1n（checkm8 设备全系）、Dopamine（iOS 15-16 系）——按设备型号与 iOS 版本选择，工具版本不匹配装不上或半越狱

## 使用注意

- 静态分析可免沙箱（[[platform-tips]] 最高原则）；越狱设备动态分析在受控环境执行
- 脱壳产物/头文件/签名信息 sha256 与时间戳存档（[[re-triage]]）；结论写 [[analysis-contract]]
- 版本相关行为（越狱工具、frida、签名规则）以目标版本实际表现为准
