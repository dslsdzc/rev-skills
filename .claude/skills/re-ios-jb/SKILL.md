---
name: re-ios-jb
description: >
  iOS 越狱逆向环境：越狱检测识别与绕过、tweak 分析与开发。
  触发词：越狱、jailbreak、tweak、Theos、LLDB 远程
---

# iOS 越狱逆向环境（越狱检测 / tweak）

## 何时使用 / 何时不用

- 用：目标 App 有越狱检测（启动闪退 / 功能受限），需要识别检测点并分析其实现
- 用：已有 tweak / Substrate 插件需要逆向分析其 hook 了什么
- 用：要在越狱设备上做动态分析（[[re-frida]] 插桩、[[re-lldb]] 远程 attach）——越狱环境是前置
- 用：自己开发 tweak（Theos + Logos）辅助逆向（hook 检测函数验证假设）
- 不用：无越狱设备时的 iOS 动态分析（静态先行，见 [[re-ios]] 坑 3）
- 不用：只要 App 静态结构 / 脱壳（走 [[re-ios]]）
- 注意：越狱与动态执行按 [[platform-tips]] 最高原则在受控设备上进行（专用测试设备，不用于日常/生产设备）

## 工具准备

越狱/动态分析属动态执行，受控设备 + 网络隔离（[[platform-tips]] 最高原则）。静态（tweak 二进制分析）免沙箱。所有工具先验证再使用。

### 越狱设备（palera1n 等）

- **palera1n 无发行版包**，官方安装途径（[docs.palera.in](https://docs.palera.in)）：
  ```sh
  # 官方一键脚本（推荐）
  sudo /bin/sh -c "$(curl -fsSL https://static.palera.in/scripts/install.sh)"
  # 或 GitHub releases（palera1n/palera1n）手动下载二进制
  curl -LO https://github.com/palera1n/palera1n/releases/download/v2.0.2/palera1n-linux-x86_64
  chmod +x palera1n-linux-x86_64 && sudo mv palera1n-linux-x86_64 /usr/bin/palera1n
  ```
- 限制：仅支持 checkm8 漏洞设备（A8–A11）及其支持的 iOS 版本（版本匹配见坑 2）；**在虚拟机里跑会段错误**（无 PCI 透传不可用）
- 验证: `palera1n --help`；越狱后设备上出现 Sileo（rootless 包管理器）
- 越狱后安装 OpenSSH：Sileo 搜索 "openssh" 安装

### Theos —— tweak 构建工具链（官方 git 安装，无发行版包）

- 官方安装（[theos.dev/docs/installation](https://theos.dev/docs/installation)，**必须 git 安装，官方明确不要下载 ZIP**）：
  ```sh
  export THEOS=~/theos
  git clone --recursive https://github.com/theos/theos.git $THEOS
  echo "export THEOS=~/theos" >> ~/.zprofile && echo "export PATH=$THEOS/bin:$PATH" >> ~/.zprofile
  ```
- 依赖：macOS `brew install ldid xz`；Linux 需 `sudo apt install dpkg-dev fakeroot`（Debian/Ubuntu）等打包依赖
- iOS SDK：`curl -LO https://github.com/theos/sdks/archive/master.zip` 解出 `*.sdk` 放 `$THEOS/sdks`
- 更新: `$THEOS/bin/update-theos`（滚动发布）
- 验证: `$THEOS/bin/nic.pl` 能列出 New Instance Creator 模板

### frida（[[re-frida]]）—— 插桩与绕过执行

- 越狱设备：Sileo/Cydia 添加源 `https://build.frida.re` 安装 frida；或 `ssh root@<设备IP>` 后安装
- 主机：`pip install frida-tools`
- 验证: `frida-ps -U` 列出设备进程

### lldb 远程（[[re-lldb]]）+ usbmuxd/iproxy

- lldb：macOS `xcode-select --install`（自带）；Linux `apt install lldb` / `dnf install lldb` / `pacman -S lldb`
- usbmuxd/iproxy：macOS `brew install usbmuxd`；Linux `apt install usbmuxd` / `dnf install usbmuxd` / `pacman -S usbmuxd`
- 验证: `lldb --version`；`iproxy 2222 22` 后 `ssh -p 2222 root@127.0.0.1` 能登录设备
- 设备端调试服务 debugserver：越狱工具 / DeveloperDiskImage 提供（见 [[re-ios]] 与 [[re-lldb]]）

## 操作步骤

按顺序执行，每步产物（设备信息、hook 清单、tweak 分析笔记）记录证据路径 + sha256（见 [[re-triage]]），供报告引用。

1. **越狱环境搭建（设备 / 工具链）**：
   ```sh
   # 设备：DFU 模式进入 palera1n
   sudo systemctl stop usbmuxd && sudo usbmuxd -f -p &    # 部分环境需重启 usbmuxd
   sudo palera1n -l                                        # -l = rootless（palera1n 2.x 默认 rootless）
   # 越狱后：Sileo 装 OpenSSH → 转发 → 登录
   iproxy 2222 22 &
   ssh -p 2222 root@127.0.0.1                              # 默认密码 alpine（rootless 后立即改）
   ```
   - 工具链：安装 Theos（工具准备）+ SDK；frida-server 经 Sileo 装好
   - 记录：设备型号、iOS 版本、越狱工具与版本、rootless 挂载前缀（palera1n rootless 为 `/var/jb`）

2. **越狱检测识别与绕过**：
   - 静态识别：App 二进制 strings 找越狱路径特征（`/Applications/Cydia.app`、`/usr/sbin/sshd`、`/var/jb`、`cydia://` 等），[[re-ghidra]]/[[re-ida]] 沿 xref 找检测函数
   - 动态识别（快）——frida 批量 hook 检测常用 API 记录被查路径：
     ```js
     // hook.js —— 记录 App 检查了哪些越狱特征路径
     ['access', 'stat', 'lstat', 'open', 'dlopen'].forEach(function(n) {
       var f = Module.findExportByName(null, n);
       if (f) Interceptor.attach(f, { onEnter: function(a) {
         var p = (n === 'dlopen') ? a[0] : Memory.readCString(a[0]);
         if (p && (p.indexOf('Cydia') >= 0 || p.indexOf('/var/jb') >= 0 || p.indexOf('jb') >= 0))
           console.log(n, '->', p, 'ret_pending');
       }});
     });
     ```
   - 常见检测族：文件/目录存在性、URL scheme（cydia://）、`fork()` 后父进程、沙箱外写测试（`/private/`）、越狱检测库（jailbreak detection SDK）；绕过 = 对每个检测点改返回值（frida 或写 tweak），见坑 3
   - 产物：检测点清单（路径/API/位置 + 绕过方案）

3. **tweak 分析（MobileSubstrate/Substrate hook）**：
   ```sh
   # 已有 tweak 的 deb：解包看动态库 + 过滤 plist
   dpkg-deb -x tweak.deb /tmp/tweak/                      # Linux/macOS 装 dpkg 或用 ar 解
   find /tmp/tweak -name "*.dylib" -o -name "*.plist"
   cat /tmp/tweak/Library/MobileSubstrate/DynamicLibraries/*.plist   # Filter：hook 哪些进程
   ```
   - 逆向动态库：strings 找类名/方法名（Logos 的 `%hook ClassName` 会保留类名字符串）→ [[re-ghidra]]/[[re-ida]] 定位
   - Substrate 原理：`MSHookMessageEx`（OC 方法）改类方法实现指针；`MSHookFunction`（C 函数）改函数头跳转——反编译里找 `MSHookMessageEx`/`MSHookFunction` 调用点，参数（目标类/方法/新实现地址）即 hook 清单
   - Theos 工程里 `%hook`/`%orig` 的 Logos 语法展开后就是上述调用（理解 Logos 利于看懂编译产物）
   - 产物：hook 目标清单（类/方法/新实现做的事）+ 过滤条件

4. **动态调试（lldb 远程 attach）**：
   ```sh
   iproxy 1234 1234 &                                      # 转发调试端口
   # 设备端：目标 App 启动后，root 下运行 debugserver 附加
   # 主机侧：
   lldb
   (lldb) platform select remote-ios
   (lldb) process connect connect://127.0.0.1:1234
   (lldb) process attach --pid <pid>                       # 或按进程名
   (lldb) image lookup -n '-[ViewController viewDidLoad]'  # 符号查找（[[re-lldb]]）
   (lldb) breakpoint set -n ptrace                          # 反调试函数断点（见坑 4）
   ```
   - 越狱设备上也可用 frida 的 `-U -f <bundleID>` spawn 模式补早期逻辑
   - 产物：断点清单 + 关键函数反汇编/寄存器现场

5. **脱壳与分析（[[re-ios]] 联动）**：
   - 目标 App 若为 App Store 加密二进制（`otool -l` 查 cryptid 1）→ 先按 [[re-ios]] 步骤 5 用 frida-ios-dump 脱壳，脱壳后回步骤 2-3 做静态
   - 脱壳/重签名：免费证书 7 天有效期（[[re-ios]] 坑 2），重打包用 adhoc 重签或 frida-ios-dump 直接输出可安装 ipa
   - 产物：脱壳 ipa（cryptid 0 验证）+ sha256

## 跨域联合

- [[re-ios]]：脱壳（frida-ios-dump）、静态分析（class-dump / Mach-O）、签名——本技能的静态底座
- [[re-frida]]：spawn/attach 插桩、hook 检测 API 与 JNI/OC 函数、绕过执行
- [[re-lldb]]：远程 attach、断点、表达式、符号查找（debugserver + iproxy）
- [[re-mobile]]：网关——越狱设备动态分析是 re-mobile 工作流第 3-4 步的环境前提
- [[re-binary-core]]：tweak 动态库 / App 二进制反编译底座（[[re-ghidra]] / [[re-ida]]）
- [[re-analyze]]：被 triage「移动 App 分析」路径调用（re-mobile → iOS 动态 → 本技能）
- [[platform-tips]]：越狱/动态执行受控设备最高原则；[参考 macOS/iOS 分支]

## 常见坑与陷阱

- **越狱后系统完整性仍受限**：现象——越狱成功但部分路径写不进去、tweak 注入不生效、App 还是"沙盒"行为；原因——iOS 系统完整性保护（AMFI / SSV 签名卷）仍在，rootless 越狱（palera1n 2.x 默认）刻意保留系统卷只读，全部越狱改动在 `/var/jb` 前缀下；对策——明确 rootless 与 rootful 的区别：rootless 下依赖、tweak、frida 都在 `/var/jb`，写系统分区内容不生效；需要写系统分区的老工具要确认 rootless 兼容或改用 rootful 模式（旧 iOS 才支持）
- **设备版本匹配（工具链版本）**：现象——palera1n 报 unsupported、Theos 编译的 tweak 装了没反应、frida-server 启动失败；原因——palera1n 只支持 A8–A11 的特定 iOS 版本；Theos SDK 版本与设备 iOS 不符；frida-server 版本与主机 frida 不一致；对策——越狱前查官方支持矩阵（docs.palera.in），按设备/iOS 选工具；SDK 下载对应 iOS 大版本（theos/sdks）；frida-server 与主机 `frida --version` 完全一致（[[re-frida]] 坑 1）；越狱过程先备份，DFU 失败可重来
- **检测对抗（jb 检测库）**：现象——App 一运行就闪退 / 提示"设备不受支持"，frida 都来不及 attach；原因——App 集成越狱检测（文件路径 / URL scheme / fork 测试 / 越狱检测 SDK），检测在启动早期执行；对策——spawn 模式抓早期（`frida -U -f <bundleID>`），按步骤 2 的 hook 清单逐项绕过；检测库的分析用静态先定位（strings + xref），动态只做验证；绕过方案先记录再实施（[[platform-tips]] 受控设备）
- **调试器检测**：现象——lldb attach 成功后 App 立即退出 / 停止响应 / 白屏；原因——App 检测 ptrace（`ptrace(PT_DENY_ATTACH)`）、`sysctl` 的 P_TRACED 标志、getppid 等反调试手段；对策——断点先打在 `ptrace`/`sysctl` 上改返回值（步骤 4 示例），或用 Theos 写 anti-anti-debug tweak 全局绕过；越狱设备上部分检测还针对 debugserver 进程名，必要时改名/隐藏
