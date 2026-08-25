# Frida 脚本方法论坑与边界

## 版本差异组（最容易踩）

- **Frida 17 移除静态 Module 查找 API**：`Module.getExportByName()` / `Module.findExportByName()` / `Module.enumerateExports()` 等在 Frida 17 起不再是函数——脚本运行报 `TypeError: not a function`；迁移写法：全局符号用 `Module.getGlobalExportByName("open")` / `Module.findGlobalExportByName("open")`，指定模块用 `Process.getModuleByName("libc.so").getExportByName("open")`；动笔前先 `frida --version` 确认版本再选写法
- **frida / frida-tools / frida-server 版本需配套**：设备端 frida-server 与主机端 frida 大版本不一致会连接失败或行为异常；升级任一后先 `frida-ps -U` 验证
- **gadget 与 server 模式差异**：无 root 场景用 frida-gadget（集成进 app），hook 时机比 server 模式早（app 启动早期）；同一脚本两种模式行为可能不同，按运行模式分别验证
- **行为以当前版本为准**：`Interceptor` 回调细节、`Java.perform` 使用时机、`Java.choose` 语义在 16/17 间有变化——异常先查对应版本官方文档，不照旧教程

## Java 层坑组

- **overload 不匹配静默失效**：`.implementation` 的形参数量/类型必须与目标 overload 一致，否则 hook 挂上但不生效——先 `overloads` 枚举再写
- **同类多 hook 缓存覆盖**：同一类多次 `.implementation` 赋值只有最后一次生效——合并进一个 hook 内分支
- **类未加载**：目标类懒加载/加固延迟加载时，脚本启动即 `Java.use` 抛 ClassNotFoundException——用 `Java.choose`（已实例对象）或延迟到类加载后；加固场景先处理脱壳（[[re-mobile-pack]]）
- **混淆后类名漂移**：ProGuard/R8 混淆的 release 包类名/方法名与 debug 包不同——以目标包实际字符串为准（jadx 输出），不照抄其他版本经验值
- **回调线程**：在非 Java 线程直接调 Java 方法可能异常——主线程操作用 `Java.scheduleOnMainThread` 调度

## Native 层坑组

- **导出符号找不到**：目标函数未导出（`static`/strip）时 `getExportByName` 返回 null——改用调用点 hook（从 Java 层 JNI 调用进入）或 `Memory.scan` 内存特征定位
- **多 ABI / 多 so 同名**：同一函数名在多个 so 中存在（多 ABI 或版本化库）——hook 前确认目标模块实例，按模块名锚定
- **字符串编码**：native 返回值常为 UTF-8（Java 侧是 UTF-16）——按调用点语义选解码方式，别统一按一种编码解析
- **参数寄存器按平台**：ARM64 前 8 参在 x0-x7；x86_64 是 rdi/rsi/rdx/rcx/r8/r9——onEnter 里 `this.context` 按目标架构读取，对照目标核实不照搬

## 反例与边界组

- **无输出 ≠ 未 hook**：目标路径未触发（需操作/定时/特定输入）、权限弹窗拦截、进程已崩溃——先确认触发条件再判「hook 失败」
- **绕过成功 ≠ 目标无防护**：绕过只对本次运行有效，重启/更新后可能失效——结论标注版本范围与运行模式
- **只观察不持久化**：绕过类脚本若含写操作会留下测试痕迹——脚本只读/日志，写操作单独评估（红线）
- **全类 hook 的反例**：高频方法全类 hook 会让 app 变慢或崩溃——hook 面最小化，先小范围验证再扩大
- **模板是起点不是终点**：[[frida-scripts]] 模板按目标版本改写，直接套旧模板可能因 API 差异失效

## 使用注意

- 动态执行在沙箱内（[[platform-tips]] 最高原则）；脚本与输出按 [[analysis-contract]] 契约存档
- 结论按 [[decision-tree]] 证据分级标注（A/B/C/反证），绕过类与数据类结论分开陈述
