# iOS 应用分析命令速查与操作序列

工具族分四层：解包与签名检查（unzip/file/codesign/otool）、头文件导出（class-dump / class-dump-swift）、设备通道（usbmuxd 的 iproxy + libimobiledevice 的 idevice_*）、脱壳执行（frida-ios-dump + [[re-frida]]）。命令与参数以官方文档为准（nygard/class-dump、mxms0/class-dump-swift、libimobiledevice、AloneMonkey/frida-ios-dump）。

## 命令族速查

### 解包与签名检查

- `unzip app.ipa -d app/` 解包 ipa（zip 格式）
- `file app/Payload/*.app/*` 确认主二进制架构（arm64 / arm64e 真机；x86_64 为模拟器产物）
- `codesign -dv <App.app> 2>&1` 签名类型（Apple Distribution / Development / adhoc）与 Team ID
- `codesign -d --entitlements - <App.app> 2>&1` 导出 entitlements（调试/绕过前看权限面）
- `security cms -D -i app/Payload/*.app/embedded.mobileprovision` 读描述文件（macOS；含证书过期时间与设备白名单）
- `otool -l <App.app> | grep -B1 -A4 LC_ENCRYPTION_INFO` 查加密标记（cryptid 1 = App Store 加密）

### class-dump / class-dump-swift（OC/Swift 头文件）

- `class-dump -H <App.app> -o headers/` 导出 OC 类头文件（方法/属性/协议）
- `class-dump-swift -H <App.app> -o headers/` Swift + OC 元数据（Swift 目标优先）
- `class-dump --help` 验证；class-dump 3.4 仅源码（xcodebuild 构建），class-dump-swift 需 Swift toolchain

### otool / llvm-otool（Mach-O 结构）

- `otool -h <App.app>` 架构 / cputype；`otool -L <App.app>` 依赖 dylib / framework 清单
- `otool -l <App.app>` 全部 load commands；`otool -ov <App.app>` OC 运行时段（objc_classlist 等）
- Linux 替代: `llvm-otool`（`apt install llvm` / `brew install llvm`），参数与 otool 兼容
- 深解析（段/入口/签名）走 [[re-format-macho]]

### idevice 工具链（设备通道）

- `idevice_id -l` 列出已连接设备 UDID；`ideviceinfo` 设备型号/iOS 版本/序列号类信息
- `iproxy 2222 22 &` 把设备 22 端口（SSH）转发到本机 2222（usbmuxd 提供）
- `ssh -p 2222 root@127.0.0.1` 经转发登录越狱设备（默认密码 alpine）
- `ideviceinstaller -l` 列出设备已装应用（含 Bundle ID，脱壳取 ID 用）

### 脱壳（frida-ios-dump）

- `python3 dump.py <BundleID 或 App 名>` 从设备拉取解密后的 ipa（输出到当前目录）
- `python3 dump.py -h` 验证；`--source` 指定 frida-server 端口等参数按 `-h` 输出
- 前置：越狱设备 + frida-server（见 [[re-frida]]）+ usbmuxd 转发

## 常用操作序列（组合套路）

### 1. IPA 静态分析标准流（解包 → 签名 → 加密判定 → 头文件 → 结构）

```
unzip app.ipa -d app/
file app/Payload/*.app/*                          # arm64 真机架构确认
codesign -dv app/Payload/*.app/ 2>&1              # 签名类型
otool -l app/Payload/*.app/ | grep -B1 -A4 LC_ENCRYPTION_INFO   # cryptid
class-dump -H app/Payload/*.app/ -o headers/      # OC 类先看
otool -L app/Payload/*.app/                       # framework 依赖
# cryptid 1 → 先脱壳（序列 3）再 dump 头文件；结构细节转 [[re-format-macho]]
```

### 2. 越狱设备动态调试（转发 → 登录 → hook/调试）

```
iproxy 2222 22 &
ssh -p 2222 root@127.0.0.1                        # 登录越狱设备
# 设备上启动目标 App
# hook/绕过 → frida（[[re-frida]]，frida-server 同源安装）
# 断点/单步 → debugserver + lldb（[[re-lldb]] 远程）
```

### 3. App Store 加密应用脱壳闭环（dump → 确认 → 复跑静态）

```
iproxy 2222 22 &
cd frida-ios-dump && python3 dump.py <BundleID>   # 拉取并解密
file <输出>.ipa
otool -l <输出>/Payload/*.app/ | grep -A4 LC_ENCRYPTION_INFO   # 确认 cryptid 0
# 脱壳产物回到序列 1 复跑（class-dump / otool / [[re-format-macho]]）
```

### 4. 受管设备/无越狱静态兜底（边界处理）

```
# 无越狱：静态先行（序列 1）
# 需动态：模拟器（仅不加密应用）或受管设备（Apple Configurator 部署 + 开发证书）
# 目标仅 App Store 加密且无越狱 → 动态面放弃，静态面以符号/字符串兜底
strings -n 6 <App.app> | grep -iE 'http|api|key'  # 加密二进制里字符串仍可读（代码区外）
```

## 实现教训（内化）

- 先看 `cryptid` 再决定后续：加密二进制上 class-dump/反编译全是壳，先脱壳省一轮返工
- headers 是业务接口的第一张地图：OC 类名/方法名基本等于功能清单，先扫 headers 再进反编译定位
- iproxy 转发后 ssh 直接连 127.0.0.1，别把设备 IP 当目标地址（转发才是稳定通道）
- 越狱检测类目标：先静态找检测点（[[re-ios-jb]] 越狱检测方法论），再决定 frida 绕过或动态侧对策，别上来就全家桶 hook
- 模拟器产物（x86_64）直接跳过：真机动态面（frida/lldb）全部不适用，浪费时间

## 使用注意

- 静态可免沙箱；越狱设备/模拟器动态分析按 [[platform-tips]] 最高原则在受控环境执行
- 每步产物（解密 ipa、头文件、签名信息）对照 [[re-triage]] 入档；结论写 [[analysis-contract]]
- 免费开发者签名 7 天过期——签名相关结果注明时间戳，避免误判
