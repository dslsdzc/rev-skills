# Frida 脚本生成决策树与证据分级

## 场景决策树（入口 → 分支）

### 1. 目标类型分支（第一级）

```
目标对象
├─ Java/ART 层（类/方法级逻辑）
│  └─ 模板族：Java hook（Java.use + implementation）
├─ Native 层（JNI / so 内逻辑）
│  ├─ 导出函数 → Interceptor.attach 锚定导出符号
│  └─ 非导出/静态函数 → 调用点 hook 或内存特征扫描
├─ Flutter / React Native 混合（[[re-hybrid-app]]）
│  └─ 先按混合结构定位 JS/Dart 侧逻辑，再决定 hook 面
└─ 横切能力（网络/加密/存储）→ 直接对照模板表（步骤 2）
```

### 2. 目标行为分支（第二级）

```
要做什么
├─ 拦截数据（参数/返回值/明文）
│  ├─ TLS 加密 → SSLKEYLOGFILE 模板
│  ├─ 证书固定挡抓包 → SSL 固定绕过模板
│  └─ 加密算法/密钥 → Cipher 拦截模板（全 overload）
├─ 绕过检测/限制
│  ├─ root/调试器/模拟器检测 → 检测绕过表
│  └─ 证书/签名校验 → 校验绕过（只观察不持久化，红线）
├─ 还原逻辑
│  ├─ JNI 动态注册 → RegisterNatives + 汇聚点双 hook
│  └─ 运行时解密内容 → DEX/SO dump 模板
└─ 追踪调用序列 → 日志型 hook（不中断不改值）
```

### 3. 验证失败排查分支（无输出时）

```
hook 无输出
├─ 脚本控制台有异常 → 修语法/API 版本问题（[[gotchas]] 版本组）
├─ 无报错但无输出
│  ├─ 类未加载 → Java.choose / 类加载点 hook（[[anti-dynamic-workflow]]）
│  ├─ overload 不匹配 → 枚举 overloads 重选
│  ├─ 目标路径未触发 → 操作 app 触发后再观察
│  └─ 多 hook 互相覆盖 → 合并进一个 implementation
└─ 进程未注入/连接失败 → 查设备连接与 frida-server 版本（[[re-frida]]）
```

## 证据分级表

| 级别 | 证据形态 | 示例 | 用途 |
|---|---|---|---|
| A 强 | 动态拦截 + 静态交叉闭合 | 拦截到目标调用，参数/返回值与 jadx 反编译一致 | 可下结论（密钥、调用链、明文格式） |
| B 中 | 动态输出可解析但无静态交叉 | 只有 hook 输出，静态侧对不上或缺失 | 可下「疑似」，标注缺静态侧 |
| C 弱 | 静态推断 | 仅凭反编译推断调用存在，未动态确认 | 只支持「待验证」 |
| 反证 | 良性解释 | 检测到调用但确认属正常功能路径 | 记录并存档 |

- 脚本输出按 [[analysis-contract]] 契约存档：时间戳、进程、hook 点、参数/返回值、原始 hex
- 绕过类结论（检测绕过成功/固定绕过成功）单独标注，与数据类结论分开陈述

## 实现教训（内化）

- 先探后写：类名/方法名/overload 数先枚举再写死，脚本里不猜目标符号
- Java 操作包在 `Java.perform`；回调线程场景注意线程切换（`Java.scheduleOnMainThread`）
- 输出结构化 JSON（ASCII + hex）比打印字符串可消费性好；`try/catch` 包住每个 hook 主体，错误发消息不静默
- hook 最小化：只拦需要的方法——全类 hook 引入性能与稳定性噪声，验证时先小范围
- 版本敏感 API 先查当前 frida 版本：Frida 17 起静态 Module 查找 API 移除（[[gotchas]]）
- 可复现性：占位符模板 + 目标特征清单一起存档，脚本可重放

## 使用注意

- 动态执行在沙箱内（[[re-sandbox]] / [[platform-tips]] 最高原则）
- 绕过类脚本只观察不持久化（红线）；输出按 [[analysis-contract]] 契约存档
