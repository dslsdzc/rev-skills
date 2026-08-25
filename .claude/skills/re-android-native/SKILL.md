---
name: re-android-native
description: >
  Android 原生库 JNI 逆向：so 提取、JNI 注册还原、Native 逻辑分析。
  触发词：JNI、.so、Android native、xhook、IDA so
---

# Android 原生库（JNI/.so）逆向

## 何时使用 / 何时不用

- 用：APK 里的 `lib/*.so` 原生库——JNI 接口还原、注册方式（静态/动态）、native 逻辑分析
- 用：Java 层逻辑清楚但核心算法/反调试在 native（游戏、加固、加密逻辑）
- 用：Java 层只看到 `System.loadLibrary` + `native` 声明，要定位与还原 native 实现
- 不用：只要 APK Java 层静态（走 [[re-apk]]）；只要运行时 hook 不需要理解 .so 结构（走 [[re-frida]]）
- 不用：so 是加固壳壳（先按 [[re-mobile-pack]] / [[re-anti-analysis]] 脱壳，见坑 5）
- 注意：动态插桩按 [[platform-tips]] 最高原则在受控设备 / 模拟器快照内执行

## 工具准备

静态分析（readelf / Ghidra 导入 .so）免沙箱；动态（frida / xhook）按 [[platform-tips]] 最高原则在受控环境执行。所有工具先验证再使用。

### 反编译工作台（so 加载）—— [[re-ghidra]] / [[re-ida]]

- [[re-ghidra]]（默认）：`File > Import File` 直接导入 ELF .so（arm64/arm/x86_64 都支持），Data Type Manager 载入 jni.h 类型（见 [[re-ghidra]] 工具准备）
- [[re-ida]]：加载 so 后 ARM64 反编译；`Option > Load new type` 载入 jni.h
- 验证: 导入 arm64 .so 后能反编译出 `JNI_OnLoad` 或 `Java_*` 导出函数

### jni.h —— JNIEnv 函数表结构理解（Android NDK 自带）

- 无独立发行版包，随 Android NDK 提供。官方途径：Android Studio SDK Manager 安装 NDK，或命令行:
  ```sh
  sdkmanager "ndk;27.2.12479018"     # 先确认 sdkmanager 在 PATH（Android SDK cmdline-tools）
  # 或 GitHub android-ndk 官方仓库下载对应版本 zip
  ```
- 关键文件：`$NDK/toolchains/llvm/prebuilt/linux-x86_64/sysroot/usr/include/jni.h`（macOS 为 darwin-x86_64 路径）
- 验证: 能打开 jni.h，看到 `JNINativeInterface`（函数表）与 `JNIEnv`（函数表指针）定义

### readelf（binutils）—— 导出表/架构识别（[[re-format-elf]] 联动）

- Linux: `apt install binutils` / `dnf install binutils` / `pacman -S binutils`
- macOS: `brew install binutils`（`greadelf`）
- 验证: `readelf --version`

### frida（[[re-frida]]）—— JNI 运行时观察

- 主机 `pip install frida-tools`；设备 frida-server 推送安装见 [[re-frida]] 工具准备
- 验证: `frida-ps -U` 能列出设备进程

### adb —— 从设备提取 so / 安装 APK

- Linux: `apt install adb`（Debian/Ubuntu）/ `dnf install android-tools` / `pacman -S android-tools`
- macOS: `brew install android-platform-tools`；Windows: 官方 platform-tools zip
- 验证: `adb version`

## 操作步骤

按顺序执行，每步产物（so 路径、readelf 输出、Ghidra 工程、frida 脚本）记录证据路径 + sha256（见 [[re-triage]]），供报告引用。

1. **so 提取与架构识别**：
   ```sh
   unzip app.apk -d app/                        # APK 是 zip
   find app -name "*.so"                        # lib/ 下所有原生库
   file app/lib/arm64-v8a/libtarget.so          # 确认架构（ELF 64-bit ARM aarch64）
   readelf -h app/lib/arm64-v8a/libtarget.so    # Machine: AArch64 / x86-64
   readelf -d app/lib/arm64-v8a/libtarget.so    # 依赖库与动态段
   ```
   - ABI 目录：`arm64-v8a`（真机主力）、`armeabi-v7a`（32 位）、`x86_64`/`x86`（模拟器）——多 ABI 差异见坑 4
   - 已安装 App：`adb pull /data/app/.../lib/arm64-v8a /tmp/lib/`（需 root 或 debuggable）
   - 记录：目标 ABI、导出表规模、依赖（`readelf -d` NEEDED）、是否 strip（`readelf -s` 符号数量）

2. **JNI 接口还原（JNIEnv 函数表）**：
   ```sh
   readelf --dyn-syms app/lib/arm64-v8a/libtarget.so | grep -i java    # 静态注册的 Java_* 导出
   readelf --dyn-syms app/lib/arm64-v8a/libtarget.so | grep -i JNI     # JNI_OnLoad / JNI_OnUnload
   ```
   - **JNIEnv 是函数表指针**：`JNIEnv* env` 实际指向 `JNINativeInterface` 函数表（jni.h 定义），函数调用是 `(*env)->GetStringUTFChars(env, ...)` 形式的表槽访问——反编译里看到"从结构体偏移取函数指针再调用"就是 JNI API，见坑 1
   - Ghidra/IDA 载入 jni.h 类型后，按名称还原：`GetStringUTFChars`（C 串→UTF-8）、`NewStringUTF`（返回）、`CallVoidMethod`/`CallBooleanMethod`（回调 Java）、`GetJavaVM`（进程内拿 JavaVM）
   - 还原目标：native 函数签名（`(JNIEnv*, jclass/jobject, 业务参数...)`）——第一个参数是 env、第二个是 jclass（静态）或 jobject（实例），业务参数从第三个起

3. **注册方式（静态 JNI_OnLoad / 动态 RegisterNatives）**：
   - 静态注册：函数名 `Java_包名_类名_方法名`（下划线转义），直接出现在导出表（步骤 2 可看到）
   - 动态注册：`JNI_OnLoad` 里调 `RegisterNatives(env, clazz, methods, count)`，`methods` 是 `JNINativeMethod{name, signature, fnPtr}` 数组——**函数地址不在导出表**（见坑 2），反编译定位 `JNI_OnLoad` 后沿 RegisterNatives 第三参数数组逐项还原
   - frida 观察运行时注册（spawn 目标 App）：
     ```js
     // hook JNI_OnLoad 后 hook JNIEnv 函数表里的 RegisterNatives
     var RegisterNatives = null;
     var JNI_OnLoad = Module.findExportByName(null, "JNI_OnLoad");
     Interceptor.attach(JNI_OnLoad, { onEnter: function() {
       // JNIEnv* 在 x0（arm64），函数表在 env[0]，RegisterNatives 是表内第 215 个槽（0 基，AOSP jni.h
       // JNINativeInterface 声明序：Get*ArrayRegion 族 199-206、Set*ArrayRegion 族 207-214、GetJavaVM=219 可锚点校验）
       var env = this.context.x0;
       var table = env.readPointer();
       RegisterNatives = table.add(215 * 8).readPointer();
       Interceptor.attach(RegisterNatives, { onEnter: function(a) {
         var cls = a[1], methods = a[2], n = a[3].toInt32();
         for (var i = 0; i < n; i++) {
           var m = methods.add(i * 24);   // JNINativeMethod: name + signature + fnPtr
           console.log(m.readPointer().readCString(), m.add(8).readPointer().readCString(),
                       m.add(16).readPointer());
         }
       }});
     }});
     ```
   - 还原产物：`Java 方法名 → 签名 → native 函数地址` 对照表

4. **逻辑分析（[[re-ghidra]] 联动）**：
   - Ghidra 导入 so → 载入 jni.h 类型（步骤 2）→ 对每个 native 函数 F5 反编译
   - 无符号辅助时按 API 调用点反推：JNI API 的参数就是业务数据的入口（如 `GetStringUTFChars` 的返回值是输入字符串）
   - 算法/校验/解密逻辑按 [[re-binary-core]] 方法论深挖；被混淆（OLLVM 变脸/字符串加密）→ 转 [[re-deobfuscate]]（坑 3）
   - 静态注册的 `Java_*` 函数之间常有跨调用（native 内部函数表/回调），追踪函数指针来源（[[re-binary-core]] R6 思路）

5. **与 Java 层交互（native 调用点定位）**：
   - Java 侧（[[re-apk]] / jadx）：`System.loadLibrary("target")` 与 `native` 方法声明所在的类——`Java_包名_类名_*` 命名即从这里来
   - jadx 里对每个 `native` 方法找调用点（谁在什么业务路径上触发它），与步骤 3 的对照表对齐，形成 `Java 调用点 ↔ native 函数` 映射
   - 动态验证：frida `Java.perform` 里直接调用 native 方法（`Java.use("com.x.Cls").method(...)`）观察参数与返回；或用 xhook / PLT hook 思路（[[re-frida]] 的 `Interceptor.attach(Module.findExportByName(...))`）观察 native 内部对外部库（libc / 系统库）的调用链
   - 闭环：Java 触发点 → 参数来源 → native 处理逻辑 → 输出回 Java 层

## 跨域联合

- [[re-mobile]]：本技能是其工作流第 4 步（原生库）的专项子技能——网关识别到含 `.so` 目标后固定调度
- [[re-frida]]：动态观察 RegisterNatives / hook native 函数 / Java↔native 交互验证（spawn 抓 JNI_OnLoad）
- [[re-format-elf]]：导出表 / 动态段 / 符号解析（readelf 三表），动态注册函数定位的前提
- [[re-ghidra]]：so 反编译工作台 + jni.h 类型载入
- [[re-apk]]：Java 侧静态（jadx 找 native 声明与调用点）；加固识别后转脱壳域
- [[re-deobfuscate]]：OLLVM / 字符串加密的 native 代码还原
- [[re-mobile-pack]] / [[re-anti-analysis]]：加固 so 壳壳先脱壳再分析（坑 5）
- [[re-android-crypto]]：加密体系审计（Keystore/Cipher/第三方加密库语义）已独立承接——本技能聚焦 JNI/native 逻辑；.so 内加密库 API 的加密语义转 [[re-android-crypto]]
- [[re-analyze]]：被 triage「移动 App 分析」路径调用（re-mobile → 原生库 → 本技能）
- [[platform-tips]]：动态插桩受控环境最高原则

## 常见坑与陷阱

- **JNIEnv 是函数表指针（不是直接调用）**：现象——反编译里 JNI 函数调用点看起来像"从结构体偏移取出函数指针再调用"，参数对不上，或按普通函数分析 `GetStringUTFChars` 直接当字符串函数用错；原因——`JNIEnv` 指向 `JNINativeInterface` 函数表，所有 JNI API 都是表槽中的函数指针，C 写法 `(*env)->fn(env, ...)`；对策——Ghidra/IDA 载入 jni.h 类型（Data Type Manager 导入），`JNIEnv` 声明为 `JNINativeInterface**`，反编译自动还原成 `env->GetStringUTFChars(env, str)` 形式；没有类型库时手工按 `JNINativeInterface` 槽位索引建结构体
- **动态注册函数地址不在导出表**：现象——`readelf --dyn-syms` / strings 里找不到 `Java_*` 或业务函数名，IDA 里全是地址没名字；原因——动态注册时函数是静态/局部符号，运行时才由 `RegisterNatives` 把地址与 Java 方法绑定；对策——`JNI_OnLoad` 是可选的库加载钩子、非必有导出：存在则反编译看 `RegisterNatives` 第三参数数组逐项还原（name/signature/fnPtr 各 8 字节）；不存在（或导出表无它）时从 `RegisterNatives` 的其他调用点、JNI 函数表 xref、字符串定位，或 frida spawn 后 hook RegisterNatives（步骤 3 脚本）直接拿运行时注册表
- **混淆 native（OLLVM）**：现象——反编译全是控制流平坦化（switch 调度器）、字符串全加密、函数巨大难读；原因——游戏/加固厂商用 OLLVM（变脸、bcf、sub）或商业混淆（VMP 类）保护 native 代码；对策——先确认混淆类型（平坦化 vs 指令虚拟化），平坦化按 [[re-deobfuscate]] 还原（状态变量 + 情况块），字符串加密定位解密函数后脚本批量解密；仍不行就 frida 动态拿运行时明文（hook 解密函数读内存）
- **多 ABI 架构差异**：现象——按 arm64 分析的偏移/指令套到 armeabi-v7a 全错，或模拟器 x86_64 上行为与真机不同；原因——APK 每个 ABI 一份 so，编译优化/指令集/调用约定不同（arm64 用 x0-x7 传参，arm32 有 thumb 指令，x86_64 用 rdi/rsi...），部分 so 还会按 ABI 返回不同实现（如 arm64 真机 vs x86_64 模拟器分支）；对策——`file`/`readelf -h` 先确认目标 ABI，分析以真机 ABI（arm64-v8a）为准，x86_64 结果仅参考；JNI 类型宽度跨 ABI 一致（jlong=64 位、jint=32 位）但 C 层 `long` 宽度不同，注意反编译里的类型标注
- **加固 so（壳壳）**：现象——静态分析 so 只见一小段 stub / 壳代码，`JNI_OnLoad` 反编译是脱壳流程；原因——so 被加固（厂商加壳 / 商用壳），真实逻辑运行时才解密到内存；对策——先识别加固（[[re-apk]] 加固识别 + 熵值），静态脱壳按 [[re-mobile-pack]]，或运行时 [[re-memdump]] 提内存中已解密的 so 再分析；脱壳产物 sha256 存档后回到步骤 1 复跑
