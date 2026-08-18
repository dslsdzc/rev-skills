---
name: re-frida
description: >
  Frida 动态插桩（桌面+移动统一）。
  触发词：frida、hook、插桩、绕过、spawn
---

# Frida 动态插桩

## 何时使用 / 何时不用

- 用：需要 hook 函数（拦截 / 改参 / 改返回值）、枚举模块与类、绕过证书校验 / root 检测、观察运行时调用链
- 用：移动端（Android / iOS）与桌面端（Linux / macOS / Windows）统一的插桩需求
- 不用：只需静态分析（Android 走 [[re-apk]]，格式走 [[re-format-elf]] / [[re-format-macho]] 系列）
- 不用：需要系统调用级跟踪（走 [[re-tracing]]）
- 不用：需要完整调试器体验（断点 / 单步 / 内存，走 [[re-gdb]] / [[re-lldb]] / [[re-x64dbg]]）

## 工具准备

动态分析按 [[platform-tips]] 最高原则：移动端在受控设备 / 模拟器快照内执行，桌面端插桩前确认沙箱环境。所有工具先验证再使用。

### frida-tools —— 主机侧命令行工具

- 跨平台（Linux / macOS / Windows）: `pip install frida-tools`（Python 3.8+；建议 venv: `python3 -m venv venv && venv/bin/pip install frida-tools`）
- 验证: `frida --version`（输出 frida 版本号）；`frida-ps -U` / `frida-trace -h` 可用

### frida-server —— 移动端插桩代理

- 下载：GitHub release `https://github.com/frida/frida/releases`，选 `frida-server-<版本>-android-<架构>`（arm64 选 `-arm64`，32 位选 `-arm`，模拟器 x86_64 选 `-x86_64`）
- **版本必须与主机 frida 完全一致**（对照 `frida --version`），架构与设备匹配，否则连接报协议错误（见坑 1）
- Android 推送与启动：
  ```sh
  adb push frida-server-xxx /data/local/tmp/frida-server
  adb shell "chmod 755 /data/local/tmp/frida-server"
  adb shell "su -c /data/local/tmp/frida-server" &   # 或 adb root 后直接运行
  ```
- iOS 越狱设备：Sileo / Cydia 添加源 `https://build.frida.re` 安装 frida deb，或 `ssh root@<设备IP>` 后安装
- 验证: 主机 `frida-ps -U` 能列出设备进程（`-U` = USB 设备，`-R` = 远程 ip:port）

### objection —— 免写 JS 的快速插桩

- 跨平台: `pip install objection`
- 验证: `objection --version`
- 用法: `objection -g <应用> explore`，内置 `android hooking` / `ios hooking` 子命令（如 `android hooking list activities`、`ios sslpinning disable`）

## 操作步骤

按顺序执行，每步记下结果。

1. **spawn vs attach 选择**：
   ```sh
   frida -U -f com.target.app              # spawn：从零启动应用，能抓启动早期逻辑（解密 / 初始化）
   frida -U com.target.app                 # attach：附加到已运行进程（不重启）
   frida-trace -U -f com.target.app -i "Java!*"   # 启动即跟踪 Java 方法调用
   ```
   规则：抓启动逻辑 / 绕过早期检测用 spawn；只是观察现状用 attach。attach 晚于启动，可能错过已执行完的早期逻辑（见坑 2）。

2. **JS hook 编写（拦截 / 改参 / 返回值）**：
   ```js
   // hook.js —— 拦截、改参数、改返回值（Android Java 层）
   Java.perform(function () {
     var cls = Java.use("com.example.Target");
     cls.doLogin.implementation = function (user, pass) {
       console.log("doLogin(" + user + ", " + pass + ")");
       return this.doLogin("hacked", "pass123");   // 改参
     };
     cls.isLicensed.implementation = function () {
       return true;                                // 改返回值
     };
   });
   ```
   ```sh
   frida -U -f com.target.app -l hook.js
   ```
   原生函数用 `Interceptor.attach(Module.findExportByName("libfoo.so", "func"), { onEnter: ..., onLeave: ... })` 拦截（onEnter 改参数、onLeave 改返回值）。桌面端同样本：`frida -p <pid> -l hook.js`。

3. **枚举与调用（enumerateModules / Java.perform）**：
   ```js
   Java.perform(function () {
     Java.enumerateLoadedClasses({
       onMatch: function (c) { if (c.indexOf("target") >= 0) console.log(c); },
       onComplete: function () {}
     });
   });
   ```
   ```js
   // 模块与导出枚举（原生层）
   Process.enumerateModules().forEach(function (m) { console.log(m.name + " " + m.base); });
   Module.enumerateExports("libfoo.so").forEach(function (e) { console.log(e.name); });
   ```
   运行: `frida -U -f com.target.app -l enum.js`。定位到目标后直接主动调用：`Java.use("com.x").method(...)` / 原生导出函数。

4. **绕过证书校验 / 检测（常见模板）**：
   ```js
   // Android SSL 绕过模板（配合抓包工具）
   Java.perform(function () {
     var X509TrustManager = Java.use("javax.net.ssl.X509TrustManager");
     var TrustAll = Java.registerClass({
       name: "com.bypass.TrustAll",
       implements: [X509TrustManager],
       methods: { checkClientTrusted: function () {}, checkServerTrusted: function () {},
                  getAcceptedIssuers: function () { return []; } }
     });
     var SSLContext = Java.use("javax.net.ssl.SSLContext");
     SSLContext.init.implementation = function (km, tm, sr) {
       this.init(km, [TrustAll.$new()], sr);
     };
   });
   ```
   ```js
   // iOS 证书绕过：hook SecTrustEvaluateWithError 返回值
   var SecTrust = Module.findExportByName(null, "SecTrustEvaluateWithError");
   Interceptor.attach(SecTrust, { onLeave: function (r) { this.context.x0 = 0; } }); // arm64 返回寄存器 x0；x86_64 用 rdi 场景先验证
   ```
   现成命令：`objection -g com.target.app explore` → `android sslpinning disable` / `ios sslpinning disable`。

5. **反检测对抗（隐藏 frida-server、改名）**：
   - 常见检测点：frida-server 默认端口 27042、`/data/local/tmp/frida-server` 路径、`gum-js-loop` / `gmain` 线程名、`/proc/self/maps` 中的 frida 特征、`frida` 字符串
   - 对策：
     ```sh
     # 1) 二进制改名后启动（避开路径检测）
     cp frida-server-xxx /data/local/tmp/fridad
     adb shell "su -c 'chmod 755 /data/local/tmp/fridad && /data/local/tmp/fridad' &"
     # 2) 换端口 + adb 端口转发，主机用 -H 连接
     adb shell "su -c '/data/local/tmp/fridad -l 0.0.0.0:27142' &"
     adb forward tcp:27142 tcp:27142
     frida -H 127.0.0.1:27142 -f com.target.app
     ```
   - root 检测对抗：先 hook 检测函数改返回值再插桩目标：`Java.use("com.target.rootcheck").isRooted.implementation = function () { return false; };`
   - 仍被检测 → frida-gadget 注入 App 进程（gadget listen（interactive）模式），配合 [[re-apk]] 的 smali 补丁加载 libgadget.so

7. **脚本模板与对抗方法论**：常用脚本骨架见 [[frida-scripts]]（TLS keylog / DEX/SO dump / JNI 注册还原 / 加密拦截 / 检测绕过表）；崩溃迭代法与检测面对照表见 [[anti-dynamic-workflow]]——先基线跑看裸崩，再定点 hook，不预置绕过全家桶。

## 跨域联合

- [[re-mobile]]：工作流第 3 步动态插桩固定调用本技能
- [[re-apk]] / [[re-ios]]：静态分析后需要运行时行为（解密 / hook / 绕过 / 脱壳执行）时调用本技能
- 系统调用级跟踪互补 → [[re-tracing]]；运行时内存提取 → [[re-memdump]]
- 本技能被 [[re-analyze]] 的 triage「移动 App 分析」路径调用（re-mobile → re-frida）
- 脚本生成：目标特征 → 模板选择 → 改写验证 → [[re-frida-script-author]]（模板素材 [[frida-scripts]]）

## 常见坑与陷阱

- **版本不匹配 → 协议错误**：现象——`frida-ps -U` 报 `unable to communicate with the frida server` / 协议错误；原因——主机 frida 与设备 frida-server 版本号不一致；对策——`frida --version` 对照 GitHub release 下载同版本 frida-server（工具准备），或 `pip install -U frida-tools` 升级主机
- **spawn 时机晚 → 错过早期逻辑**：现象——attach 后 hook 不触发或早期解密已完成；原因——应用启动即解密 / 校验，attach 时已过；对策——用 `-f` spawn 模式起步即插桩；仍错过则 hook `dlopen` / `ClassLoader.loadClass` 这类更早的执行点
- **目标检测 frida（端口 / 特征）**：现象——spawn 后应用闪退 / 卡死 / 行为异常；原因——应用扫描 27042 端口、frida-server 路径、`frida` 线程名或 maps 特征；对策——步骤 5 改名 + 换端口；仍检测用 frida-gadget 注入（隐藏于进程内）
- **root 检测拦插桩**：现象——frida 可连接但 hook 不生效或直接退出；原因——应用先做 root / 越狱检测，检测到环境直接退出；对策——先 hook 检测函数返回值（步骤 5 模板），过了检测再 hook 目标函数
- **JS 脚本静默失败**：现象——脚本加载无报错但 hook 无输出；原因——类名写错、`Java.perform` 外调用 Java API、模块名大小写不符；对策——用步骤 3 的枚举先核对名称，脚本内 `console.log` 打桩定位
- **hook 导出 API 被壳绕过（直 syscall / API 名哈希）**：现象——成功 hook 了 `IsDebuggerPresent`/`NtQueryInformationProcess` 等导出，反调试照样触发、进程退出；原因——加壳/加固目标不走导入表：自实现 `GetProcAddress`、API 名存哈希，或直接 syscall（内联 `Nt*` 直调），hook 点根本没经过；对策——hook 更深一层（ntdll 的 syscall 包装点）、跟踪 `GetProcAddress`/哈希解析处反推真实调用点，反调试与反 VM（`RegOpenKeyExA`/`GetSystemFirmwareTable`）API 一并 hook（Arkana 项目实战模板），先用 `Process.enumerateModules()`/`enumerateExports` 确认实际调用目标再插桩
- **检测点升级（memfd/JIT 池/内存字符串/管道名）**：现象——改名、换端口启动 frida-server 后仍被检测；原因——新版检测不止端口与路径：扫描 `/proc/self/fd` 的 memfd 名称、JIT 缓存池（pool-frida）、`frida_agent.so`/`frida_rpc` 等内存字符串与导出符号、管道/linjector 名称，甚至非标准端口也会被扫（Promon 式扫描）；对策——用 undetected-frida 补丁集（字符串/符号/线程/协议/memfd/JIT 池全量混淆，Magisk/KSU 模块形态），或 frida-gadget + 自编译隐藏版，缩小指纹面
- **强加固（Pairipcore 类）整体对抗 Frida**：现象——常见 hook 脚本（证书绕过/反检测/解密）全部失效，spawn 即闪退或行为异常，社区报告 frida-interception 类脚本无法绕过；原因——商业加固做 C++/Java 双层完整性校验 + 伪 VM 指令 + 自定义 dlopen/dlsym/syscall 动态导入混淆 + prctl/clone/waitpid/ptrace 反调试 + `/proc/self/maps`+`/proc/self/status` 进程监控 + 非标准端口扫描，整体防线而非单点；对策——先处理完整性校验与进程监控（hook 校验函数返回、patch 监控点）再过反调试，hook 落到自定义导入解析处而非导出 API，必要时结合 [[re-apk]] 静态改 smali + Native 层插桩配合
- **hook 出口函数多进程/多实现排查**：现象——hook `SocketOutputStream` 无结果，抓包却看到流量；原因——应用多进程（发流量的逻辑在子进程）或使用 Netty 的 `SocketChannelImpl`（不走 OutputStream 路径）；对策——排查顺序：hook 最外层出口 → 无果 `ps -e` 查子进程分别 hook → 再试 `SocketChannelImpl` 等替代实现；hook 成功后打印堆栈（Netty 的 `MessageToByteEncoder` 链）定位组装/加密代码；从"编解码器链"逐层向上追明文对象与加密产物
- **对称加密密钥传输追踪**：现象——抓到 RC4/AES 密文包，但密钥每次会话都变、静态搜不到；原因——对称加密密钥动态生成且在线传输（明文/加密后携带/协商）；对策——hook 密钥传入处（加密函数参数 `bArr` 类）拿当前密钥，再向上追踪密钥来源与传输路径，配合抓包对照（首包固定头如 `89 04 01 01` 可作协议锚点）
- **多层 TLS 校验栈**：现象——单点 hook 后部分请求仍 SSL 错误；原因——App 同时用 OkHttp/原生 HttpsURLConnection/Conscrypt 多套栈；对策——分层覆盖（OkHttp CertificatePinner + TrustManagerImpl.verifyChain + HostnameVerifier 同时 hook），全栈覆盖才算绕过完成
- **ProGuard 混淆后定位目标类**：现象——类名被改成短名；原因——混淆；对策——jadx 里 Find Usages 反查谁实例化关键 Builder，从实例化点反推原类
（来源：reverse-skill field-journal，MIT）
