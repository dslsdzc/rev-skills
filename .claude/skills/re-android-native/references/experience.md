# re-android-native 经验全集

> 条目含来源与日期;入库前 grep 去重。格式: **标题**：现象——…；原因——…；对策——…

## 2026-09-01 · 会话复盘

**JNIEnv 表槽定位法(hook 抓明文/注册表)**：现象——想抓 JNI 层字符串明文或动态注册表,却不知从哪 hook;原因——JNIEnv 是函数表指针(`[env]` = JNINativeInterface 表),各 API 是表槽(偏移 = 槽号×8),关键槽: `NewStringUTF`=0x538(槽167)、`RegisterNatives`=0x6b8(槽215);对策——`memory.pointer([env]).getLong(0)` 拿表基址,读槽值得实现地址,code hook 该地址:NewStringUTF 命中时 x1=明文、LR=调用点;RegisterNatives 命中时读 methods 数组(名称/签名/地址三指针)。调用点静态定位: 全库搜 `ldr xN, [xN, #0x538]`。来源：Android 商业应用 native 层分析实战

**注册表拿不到时的裸调用匹配(重建动态注册函数表)**：现象——动态注册的 native 方法,注册表(方法名+签名+地址)加密存储、strings 搜不到,运行时也不注册(模拟器无 ART);原因——注册表本身被加密,注册依赖真实运行时;对策——绕开注册表: ① 全量扫 `.text` 找函数入口(`stp x29,x30` 序言)② 叶子筛选(函数体内无内部 bl)③ 裸调用 `callFunction(addr, jniEnv, 0)`(每候选独立模拟器防状态污染)④ 按返回特征匹配: 0/1=boolean、小值=long/枚举、指针=String/回调 ⑤ 全局读取特征聚类(adrp 目标页)分组。已验证: 158 个候选零崩溃,14 个 boolean、2 个 long、8 个指针函数确认。来源：Android 商业应用 native 层分析实战

**懒解密/延迟注册的模拟边界**：现象——模拟器里 JNI_OnLoad 全路径执行、注册表槽 hook 零命中,以为漏了逻辑;原因——商业应用把字符串解密/方法注册推迟到 Java 调用链触发(类首次使用),模拟器无 dex 类加载能力,调用链无法构造;对策——先静态验证"启动路径确实不注册"(执行路径追踪+槽 hook),再判断为运行时触发;字符串/注册表的最终获取走真机 frida,模拟器能摸到哪就到哪,不硬啃。来源：Android 商业应用 native 层分析实战
