# JNI 运行探针（Runtime Probes）

易变参数层：ABI 传参寄存器 / libart 内部结构 / runtime 实现细节——**不写进 SKILL.md 核心流程**（NDK / ART 版本变化可能影响实现），以运行时探测与校验为准。`JNIEnv` 函数表的 index 布局属固定 ABI（`RegisterNatives`=215），不在此列。

## RegisterNatives 槽位定位

`RegisterNatives` 位于标准 `JNIEnv` function table index **215**（`UnregisterNatives` 216）——JNI ABI 的固定布局，JDK 8/11/17/27、GraalVM 21、Android NDK 均一致（新增 helper 只追加在尾部，不改动已有 index）。实际 byte offset = index × 目标指针宽度：64 位下 215×8=0x6B8，32 位下 215×4=0x35C。

### 运行时锚点（校验用）

index 固定不代表运行时实现一定符合规范——以下锚点用于**校验**而非推导：

- 从 `JNIEnv*` 取函数表基址，读 index 215 槽值；按签名形态 `(JNIEnv*, jclass, JNINativeMethod*, jint)` 打桩调用确认
- 交叉校验其他固定槽：`NewStringUTF`=167、`GetJavaVM`=219（语义稳定、调用频繁，适合作有效性锚点）
- 槽值异常（为空、指向非 libart/系统库范围、多槽指向同一地址）→ 疑 hook/代理函数表或非标准实现，先还原再继续

### 备选：ART 内部函数 hook（版本绑定）

`art::JNI::RegisterNatives`（libart.so 导出符号，debuggable 进程可见）——符号名跨版本稳定，内部结构随 ART 版本变化，仅作交叉验证，不写死偏移。

## Frida 脚本模板

```js
// hook JNI_OnLoad 后按固定 index 定位 RegisterNatives
var REGISTER_NATIVES_INDEX = 215;                 // JNI ABI 固定槽位
Interceptor.attach(Module.findGlobalExportByName("JNI_OnLoad"), {   // Frida 17+：全局符号静态查找
  onEnter: function () {
    var env = this.context.x0;                    // arm64: JNIEnv* 在 x0（ABI 相关，见下）
    var table = env.readPointer();                // env[0] = JNINativeInterface 函数表
    var RegisterNatives = table.add(REGISTER_NATIVES_INDEX * Process.pointerSize).readPointer();
    if (RegisterNatives.isNull()) { console.log("槽位为空——疑非标准实现或 hook 表"); return; }
    Interceptor.attach(RegisterNatives, { onEnter: function (a) {
      console.log("RegisterNatives:", a[1], a[2].readPointer());   // clazz + methods 数组
    }});
  }
});
```

**ABI 注记（易变）**：JNIEnv* 传参寄存器随 ABI——arm64 x0、arm32 r0、x86_64 rdi——以 `this.context` 当前架构为准，不写死。

## Runtime 校验清单

hook 生效后逐项校验，防误 hook：

1. **参数形态**：hook 到的方法被调用且参数形态符合 `(JNIEnv*, jclass, JNINativeMethod*, jint)`；形态不符 → 疑非标准实现或调用点误判
2. **函数表有效性**：用 `NewStringUTF`(167) / `GetJavaVM`(219) 等固定槽交叉验证表基址正确、无 hook/代理函数表
3. **多 ABI**：每个 ABI（arm64-v8a / armeabi-v7a / x86_64）独立确认——index 一致，但传参寄存器与指针宽度不同（byte offset 随宽度变化），脚本按 `Process.arch` 分支

## 使用注意

- 函数表 index 是固定 ABI，勿再「按 jni.h 声明序重新推导」；真正易变的是 ABI 传参寄存器、libart 内部结构与 runtime 实现细节，以目标环境实测为准
- 核心流程（SKILL.md 步骤 3）只描述机制与策略，易变数值一律在本文件维护
