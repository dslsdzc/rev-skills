# JNI 运行探针（Runtime Probes）

易变参数层：槽位索引 / offset / runtime 实现细节——**不写进 SKILL.md 核心流程**（NDK / ART 版本变化可能影响槽位与实现），以运行时探测与校验为准。

## RegisterNatives 槽位探测策略

`RegisterNatives` 是 `JNINativeInterface` 函数表中的一个槽——**槽号随 jni.h 声明序/版本变化**，禁止硬编码进脚本。两种探测策略：

### 策略 A：特征函数锚点定位（推荐）

用函数表中**语义稳定**的槽位作锚点，推导 RegisterNatives 的相对位置：

- 锚点选择：`GetStringUTFChars`（语义稳定、被调频繁）或 `GetJavaVM`（JNINativeInterface 声明序靠后）
- 方法：运行时枚举函数表（前 N 个槽的函数指针），按「锚点槽位 ± 已知相对差」定位 RegisterNatives；相对差来自**当前目标的 jni.h**（NDK 自带，`find / -name jni.h` 后核对声明序），不从记忆取
- 校验：hook 到候选槽后先打桩调用验证（参数形态：`(JNIEnv*, jclass, JNINativeMethod*, jint)`），形态不符即换候选

### 策略 B：ART 内部函数 hook（版本绑定）

`art::JNI::RegisterNatives`（libart.so 导出符号，debuggable 进程可见）——符号名跨版本稳定，但内部结构随 ART 版本变化，仅作交叉验证，不写死偏移。

## Frida 脚本模板（探测版）

```js
// hook JNI_OnLoad 后探测 RegisterNatives（槽位动态定位，不硬编码）
var RegisterNatives = null;
Interceptor.attach(Module.findExportByName(null, "JNI_OnLoad"), {
  onEnter: function () {
    var env = this.context.x0;                    // arm64: JNIEnv* 在 x0（ABI 相关，见下）
    var table = env.readPointer();                // env[0] = JNINativeInterface 函数表
    // 探测：遍历函数表前 230 个槽，找「参数形态像 RegisterNatives」的候选
    // （RegisterNatives 签名: (JNIEnv*, jclass, JNINativeMethod*, jint)）
    for (var i = 0; i < 230; i++) {
      var fn = table.add(i * Process.pointerSize).readPointer();
      if (fn.isNull()) continue;
      // 候选判断：非 null、非重复、地址在 libart.so 或系统库范围内
      if (fn.compare(ptr(0)) > 0) {
        RegisterNatives = fn;
        break;                                     // 首个非空槽仅是示例——实际用锚点策略 A 精确定位
      }
    }
    Interceptor.attach(RegisterNatives, { onEnter: function (a) {
      console.log("RegisterNatives:", a[1], a[2].readPointer());   // clazz + methods 数组
    }});
  }
});
```

**ABI 注记（易变）**：JNIEnv* 传参寄存器随 ABI——arm64 x0、arm32 r0、x86_64 rdi——以 `this.context` 当前架构为准，不写死。

## Runtime 校验清单

hook 生效后逐项校验，防误 hook：

1. **槽位正确性**：hook 到的方法被调用且参数形态符合 `(JNIEnv*, jclass, JNINativeMethod*, jint)`；形态不符 → 槽位错，重探测
2. **锚点校验**：用 `GetJavaVM` 等稳定槽位交叉验证函数表布局未漂移（布局变了说明 jni.h 版本不同，重新按当前头文件推导）
3. **多 ABI**：每个 ABI（arm64-v8a / armeabi-v7a / x86_64）独立探测——槽位可能一致但传参寄存器不同，脚本按 `Process.arch` 分支

## 使用注意

- 本文件内容随 NDK/ART 版本演进——使用前先核对目标环境的 jni.h 声明序与 libart 符号
- 核心流程（SKILL.md 步骤 3）只描述机制与策略，易变数值一律在本文件维护
