# 动态分析对抗工作流（通用）

适用于任何带反分析/反调试/加固目标的动态分析（移动、桌面、固件均可）。方法为核心，插桩工具可替换（Frida / objection / Xposed / GDB / LLDB）。

## 崩溃迭代法（静态定位 → 定点脚本 → 崩溃日志驱动）

不预置通用 bypass 全家桶，按循环走：

1. **基线崩溃检测**：先跑原样目标（spawn/启动早期，`--pause` 或等价停在早期代码前），抓崩溃日志判四类：
   - Java/托管崩溃（FATAL EXCEPTION + 异常类名）
   - native 崩溃（SIGABRT / SIGSEGV / SIGBUS / SIGFPE / SIGILL）
   - ANR
   - 反分析指示（日志含 security / tamper / root / frida / xposed / magisk / substrate / debug / hook 关键字）
2. **崩溃特征 → 保护机制对照**：

| 崩溃特征 | 指向 | 定位手段 |
|---|---|---|
| System.exit(0) 在栈中 | 反分析自杀 | 搜 System.exit / Process.killProcess |
| SecurityException | 权限或完整性检查 | 搜异常类 |
| SIGABRT（native） | native 反篡改（插桩检测、库完整性） | 看 .so，搜 dlopen / ptrace / frida 字符串 |
| 启动即关闭无崩溃 | finish() 或早期入口内 System.exit | 读入口 Activity/函数的条件分支 |
| root/完整性 SDK 日志（RootBeer/SafetyNet/Play Integrity） | root/完整性 SDK | 搜 SDK 包名 |
| ssl/certificate/pin 日志 | 证书固定挡抓包 | 搜 CertificatePinner / TrustManager |
| frida/xposed/substrate 日志 | 插桩检测 | 搜进程名 / 端口 / 模块检查 |

3. **定点绕过**：
   - 布尔检查方法 → 返回 false
   - native 函数 → `Interceptor.replace` 等价物 + NativeCallback 返回 0
   - 未知检查 → hook 自杀函数（System.exit 等）打印调用栈定位来源
   - 后台线程持续检查 → hook `Thread.start()` 或对应 Runnable
4. 迭代 3-5 层检查是常态；插桩默认端口被探测 → 换端口启动

## 高频检测面清单（检测与绕过共用同一面）

- **文件系统**：插桩 server 路径、su 路径（20+ 常见位置）、`/proc/self/status` 的 TracerPid
- **端口**：插桩默认端口（如 27042-27045）、调试器端口
- **线程名**：插桩运行时线程名特征（GumJSLoop / GumJS-Worker / coordinator 类）
- **内存布局**：`dlopen` 插桩库路径、`mmap` PROT_EXEC、maps 里特征字符串
- **系统属性/环境**：`ro.debuggable`、`ro.kernel.qemu`、`LD_PRELOAD` / `DYLD_INSERT_LIBRARIES`
- **时间**：sleep / GetTickCount / RDTSC（检测沙箱加速执行）
- **ptrace**：PTRACE_TRACEME 自我跟踪检测调试器

## 实现教训（内化）

- 返回值只能在 **onLeave 用 `retval.replace()`** 改，onEnter 改不了
- 同类 hook 多次赋值会**静默覆盖**（缓存问题）——相关 hook 合并进一个
- 保存 original 引用后必须带原 `this` 调用
- 输出优先判可打印 ASCII 再回退 hex；字符串常量缓存；选择性 hook 用完 detach
- 客户端 hook 无法伪造**服务端** attestation 结论（Play Integrity 等）——服务端校验的结论只写「无法绕过」，不写伪成功
