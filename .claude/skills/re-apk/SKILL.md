---
name: re-apk
description: >
  APK 静态分析：jadx/apktool、manifest、smali、加固识别。
  触发词：apk、android逆向、jadx、smali、dex
---

# APK 静态分析

## 何时使用 / 何时不用

- 用：拿到 APK / 安卓应用包，需要看清单、Java 代码、资源、权限、组件结构
- 用：需要识别加固 / 混淆（壳、资源混淆），为脱壳或补丁做准备
- 不用：需要运行时 hook / 解密 / 绕过（走 [[re-frida]]）
- 不用：目标是原生库 .so 的逻辑（走 [[re-binary-core]] 的 [[re-format-elf]]）
- 不用：需要从运行时内存提取 DEX（走 [[re-memdump]]）

## 工具准备

纯静态分析（解包 / 反编译）可免沙箱（[[platform-tips]] 最高原则）；涉及动态 / 脱壳转 [[re-frida]] / 脱壳域。所有工具先验证再使用。

### jadx —— Java 反编译主力（含 JADX GUI）

- 官方/GitHub release：`https://github.com/skylot/jadx/releases` 下载 `jadx-<版本>.zip`，解压后运行 `bin/jadx`（Linux/macOS）或 `bin\jadx.bat`（Windows）；GUI 是 `bin/jadx-gui`
- macOS: `brew install jadx`
- 依赖 Java 11+：Linux `apt install openjdk-17-jre` / `dnf install java-17-openjdk` / `pacman -S jre17-openjdk`；macOS `brew install openjdk`
- Windows/WSL: WSL 内用 Linux 版 zip
- 验证: `jadx --version`

### apktool —— 解包 / 回编译（官方/GitHub release）

- 依赖 Java 8+。官方 wrapper：从 `https://github.com/iBotPeaches/Apktool/releases` 下载 `apktool_<版本>.jar` 与 wrapper 脚本（Linux/macOS `apktool`、Windows `apktool.bat`），脚本与 jar 放同目录
- Debian/Ubuntu: `apt install apktool`（仓库版较旧，命令行为兼容即可）
- macOS: `brew install apktool`
- Windows/WSL: WSL 内 Linux 版
- 验证: `apktool --version`

### aapt2 —— 资源转储 / 还原混淆资源

- Android SDK build-tools 自带。安装 cmdline-tools 后：`sdkmanager "build-tools;34.0.0"`，路径 `$ANDROID_HOME/build-tools/34.0.0/aapt2`
- macOS: `brew install --cask android-commandlinetools` 后 `sdkmanager "build-tools;34.0.0"`
- Windows: Android Studio → SDK Manager 勾选 build-tools
- 验证: `aapt2 version`

### dex2jar（可选）—— dex → jar

- GitHub release：`https://github.com/pxb1988/dex2jar/releases` 下载 zip，解压后 `d2j-dex2jar.sh classes.dex` 得 jar，再用 jd-gui 浏览
- 需要 Java
- 验证: `d2j-dex2jar.sh --version`

### apksigner / keytool —— 重打包签名（smali 补丁配套）

- apksigner 在 Android SDK build-tools（同 aapt2 路径）；keytool 随 Java 自带
- 验证: `apksigner --version`；`keytool -help`

## 操作步骤

按顺序执行，每步记下结果（证据路径 + sha256，见 [[re-triage]]）。

1. **解包（apktool d）**：
   ```sh
   apktool d app.apk -o out/
   ```
   解出 `AndroidManifest.xml`、`smali/`（可回编译的字节码）、`res/`、`assets/`、`lib/`。`-s`（`--no-src`）不解码源码（只出资源）、`-r`（`--no-res`）不解码资源（只出 smali），补丁时按需组合。产物比 jadx 更适合改后回编译。

2. **AndroidManifest 入口/权限/组件**：
   ```sh
   grep -E 'application|activity|service|receiver|provider' out/AndroidManifest.xml | head -40
   ```
   记录：主入口（`application` / 首个 `activity` 的 `android:name`）、`uses-permission`（短信 / 通话记录 / 设备管理权限是恶意或敏感信号）、exported 组件、`android:debuggable="true"`（可调试应用可直接 [[re-frida]] attach）。加固后入口常被替换成壳类（见坑 1）。

3. **jadx 反编译 Java**：
   ```sh
   jadx -d java-out app.apk          # 批量反编译全部 dex 类
   jadx app.apk                      # 或 GUI 模式逐类浏览
   ```
   先看入口类（Application / MainActivity）与算法 / 校验类；敏感串（密钥、URL、校验逻辑）按 `grep -rE 'key|secret|sign|license' java-out/` 定位。dex2jar 等价替代：`d2j-dex2jar.sh app.apk` 得 jar 后用 jd-gui。反编译不出业务代码 → 加固识别（步骤 5）。

4. **smali 补丁思路**：
   ```sh
   # 改 smali 后回编译、签名、安装
   apktool b out/ -o patched.apk
   keytool -genkey -v -keystore ks.jks -alias r -keyalg RSA -validity 3650 -storepass 123456
   apksigner sign --ks ks.jks --out signed.apk patched.apk
   adb install signed.apk
   ```
   常用改法：条件跳转取反（`if-eqz` ↔ `if-nez`）、把 `const/4 v0, 0x0` 改成返回常量、把校验方法直接 `return-void`。先 `jadx` 定位逻辑再在对应 smali 里改。目标含签名自校验时补丁可能被拦（见坑 2）。

5. **加固/混淆识别**：
   - 壳特征：jadx 只见壳类（`com.stub.StubApp`＝爱加密、`com.secneo.apkwrapper` / `com.bangcle.*`＝梆梆，乐固等）；`lib/` 多一个壳 so（`libjiagu.so`＝360 加固、`libDexHelper.so`＝爱加密…）；`classes.dex` 体积异常小（真 dex 运行时解密）
   - 资源混淆特征：`res/` 资源路径被随机改名、`resources.arsc` 结构异常
   - 识别为加固 → 转脱壳域（[[re-anti-analysis]]）或动态取内存 DEX（[[re-frida]] / [[re-memdump]]）；资源混淆用 aapt2 还原：
     ```sh
     aapt2 dump badging app.apk      # 包名 / 入口 / 权限速览
     aapt2 dump resources app.apk    # 混淆后的资源映射
     ```

## 跨域联合

- [[re-mobile]]：工作流第 2 步（APK 静态分支）固定调用本技能
- 需要运行时（解密 / hook / 绕过）→ [[re-frida]]；运行时内存取 DEX → [[re-memdump]]
- 加固 / 带壳 → [[re-anti-analysis]]（脱壳域）；原生 .so → [[re-binary-core]]（[[re-format-elf]] / [[re-ghidra]]）
- 本技能被 [[re-analyze]] 的 triage「移动 App 分析」路径调用（re-mobile → re-apk）

## 常见坑与陷阱

- **加固样本 jadx 只看到壳壳**：现象——反编译出来只有 StubApp 之类壳类，业务代码全无；原因——真 dex 加密存放在 assets/ 或运行时才解密；对策——按步骤 5 识别壳，转 [[re-anti-analysis]] 脱壳，或 [[re-frida]] / [[re-memdump]] 运行时取内存 DEX
- **签名校验拦补丁**：现象——重打包安装后闪退或报"签名不一致 / 未签名"；原因——应用内自校验签名（对比 PackageManager 的签名信息）；对策——定位校验点打补丁绕过（smali 改返回值 / 跳转），或 [[re-frida]] hook `PackageManager.getPackageInfo` 调用链
- **资源混淆后无法直接看资源**：现象——`res/` 路径与资源 ID 对不上、strings 定位不到目标资源；原因——资源被混淆随机改名；对策——aapt2 dump 还原映射（步骤 5），必要时结合动态分析对照
- **原生 .so 被当 Java 分析**：现象——Java 层找不到核心逻辑（算法 / 反调试）；原因——敏感逻辑写在 JNI 的 .so 里；对策——`lib/` 下 so 转 [[re-format-elf]] + [[re-ghidra]]（[[re-binary-core]]），用导出表 / `Java_<包名>_<类名>_<方法名>` 风格符号对 JNI 函数
- **apktool 回编译失败**：现象——`apktool b` 报资源编译错误；原因——解包时资源被解码、部分资源格式不兼容回编译；对策——`apktool d -r` 保留原资源不解码，只改 smali 后回编译

- **自写 dex 解析四细节**：opcode 是 **u16 低字节**（高字节是寄存器位，读完整 u16 当 opcode 全错位）；`fill-array-data` 是 **0x24**（0x26 是 goto，凭记忆必错）；string_data_item 有 **uleb128 长度前缀**（不跳过会把长度当字符）；code_item 的 `insns_size` 在 **+12**（+4 是 outs_size）——手写解析器前先对照 dex 规范核对布局
- **jadx 目录只剩启动脚本**：现象——`jadx` 报 ClassNotFound；原因——安装不完整（jar 缺失/被清理）；对策——从 GitHub release 重下完整 zip（codeload.github.com 比 github.com 稳），或直接用 baksmali 等单一工具
- **容器/双开（VirtualApp 类）样本分析**：现象——样本跑在双开容器里行为异常、hook 不到目标进程，或要分析容器本身；原因——VA/Blackbox 容器通过"代理桩 + 动态注册"模拟系统：启动 Activity 走容器内假 AMS（Binder 动态代理拦截，把 VAPP 请求参数还原后再转发真实系统）；IO 重定向把写死的绝对路径转向容器内安装路径；ContentProvider 的 `onCreate` 作为容器初始化入口（`handleBindApplication` 主动调用）；原理同老版 Android（VA 只支持老版本，Blackbox 为现代参考实现）；对策——分析容器内应用时注意进程真实归属（容器进程 vs 宿主进程）、hook 点选在容器框架层（假 AMS/IO 重定向函数）而非应用层；识别双开环境（双开检测）看 `/proc/self/maps` 容器 so、假包名路径特征；这类原理对免安装运行/插件化分析也通用

- **重打包后 `install -r` 不生效（versionCode 陷阱）**：现象——重打包签名安装后行为毫无变化，误判「patch 无效」；原因——`adb install -r` 在 versionCode 未递增时不替换已装应用的原生库等文件（改动恰在 `lib/` 下时尤其明显），apktool 回编译的 build 缓存未清理也可能产出旧产物；对策——每次构建前递增 versionCode（manifest 或 apktool.yml），回编译前清理 build 缓存；装机后做闭环验证：`adb shell pm path <包名>` 取回已装 APK，对 patch 地址做字节级比对，字节确认在位后再排查逻辑层（消费点错误等）（来源：reverse-skills（inliver233），MIT）
- **签名校验跨层链与系统版本漂移**：现象——重打包后仍弹「签名不一致」类提示，或复用旧式签名适配 hook 后在新系统上反而误报篡改；原因——签名校验常是跨层链（Java 层取签名信息 → 摘要计算 → 原生层与硬编码基线比对，任一层不匹配即判失败），只中和单点不够；应用自带 PackageManager 签名适配 hook 可复用（拦截 getPackageInfo 系列、同时替换 signatures 与 signingInfo、只作用于自身包），但其反射构造的内部签名对象（如 SigningDetails）构造器签名随系统版本变化，抛异常返回 null 后触发误判；对策——优先复用应用自带的签名适配 hook，版本漂移时用 Frida 探测活构造器、改走公开构造器重建；带壳目标优先免重打包（运行时签名适配），无壳再考虑重打包；静态侧找原生比对函数中和失败分支（来源：reverse-skills（inliver233），MIT）
