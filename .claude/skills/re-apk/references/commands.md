# APK 静态分析命令速查与操作序列

工具族分三层：jadx（反编译 Java）、apktool（解包/回编译 smali）、aapt2/apksigner/adb（资源转储/签名/安装闭环）。各工具命令与参数以官方文档为准（jadx: skylot/jadx；apktool: iBotPeaches/Apktool）。

## 命令族速查

### jadx（反编译）

- `jadx -d java-out app.apk` 批量反编译全部 dex 类到目录
- `jadx --show-bad-code app.apk` 容错模式（部分反编译失败时仍输出）
- `jadx -j <n> app.apk` 线程数；`-r` 不反编译资源；`--no-imports` 去掉 import 行（diff 友好）
- `jadx-gui` 图形界面（单类浏览、跳转、搜索）；`jadx-gui app.apk` 直接打开
- `jadx --version` 验证；依赖 Java 11+（64 位）

### apktool（解包/回编译）

- `apktool d app.apk -o out/` 解包（资源转成可读 XML + smali）
- `apktool d -r app.apk -o out/` 只出 smali 不解码资源（回编译成功率更高，smali 补丁首选）
- `apktool d -s app.apk -o out/` 只出资源不出 smali
- `apktool b out/ -o patched.apk` 回编译
- `apktool b out/ --use-aapt2` 强制 aapt2 回编译（资源复杂时比默认 aapt 稳）
- `apktool --version` 验证；`apktool d` 默认带 `--force`（覆盖旧输出）

### aapt2 / aapt（资源与清单）

- `aapt2 dump badging app.apk` 包名/版本/入口 activity/权限/目标 SDK 速览
- `aapt2 dump resources app.apk` 资源 ID → 名称映射（资源混淆还原用）
- `aapt2 dump xmltree app.apk --file AndroidManifest.xml` 二进制 XML 直接解码
- `aapt2 version` 验证；build-tools 版本随 SDK 更新，命令接口稳定
- 老 SDK 环境用 `aapt dump badging app.apk`（build-tools 34 前默认）

### apksigner / keytool / zipalign（重打包签名）

- `keytool -genkey -v -keystore ks.jks -alias r -keyalg RSA -validity 3650 -storepass 123456` 生成自签密钥库
- `apksigner sign --ks ks.jks --out signed.apk patched.apk` v1+v2 签名
- `apksigner verify --print-certs signed.apk` 验证签名并打印证书（确认签名生效）
- `apksigner --version` 验证；v2/v3 签名无需 zipalign（v1 JAR 签名才需要）

### adb / 辅助（闭环验证）

- `adb version` 验证；`adb devices` 列设备
- `adb install signed.apk` 安装；`adb install -r signed.apk` 覆盖安装
- `adb shell pm path <包名>` 取回已装 APK 路径，`adb pull` 拉回做字节级补丁验证
- `file app.apk` 确认 zip 格式；`unzip -l app.apk | head` 看包内结构（dex 数量/so 列表）

## 常用操作序列（组合套路）

### 1. 完整静态分析流（入口 → 权限 → 代码 → 敏感点）

```
apktool d app.apk -o out/                         # 清单与 smali
grep -E 'application|activity|uses-permission' out/AndroidManifest.xml
jadx -d java-out app.apk                          # Java 层
grep -rE 'key|secret|sign|license|http' java-out/ # 敏感串定位
# 定位到的校验/算法类 → jadx-gui 单类深读 → 交叉引用上溯调用者
```

### 2. smali 补丁重打包闭环（改 → 回编译 → 签名 → 安装 → 字节验证）

```
apktool d -r app.apk -o out/          # 保留原资源，只改 smali
# 在对应 smali 里改：if-eqz ↔ if-nez、const/4 v0, 0x0、return-void
apktool b out/ --use-aapt2 -o patched.apk
keytool -genkey -v -keystore ks.jks -alias r -keyalg RSA -validity 3650 -storepass 123456
apksigner sign --ks ks.jks --out signed.apk patched.apk
apksigner verify --print-certs signed.apk        # 签名先自证
adb install signed.apk
adb shell pm path <包名> && adb pull <路径>       # 取回已装 APK
# 对 patch 地址做字节级比对，确认修改在位后再排查逻辑层（见 SKILL.md 坑）
```

### 3. 资源混淆还原（aapt2 dump 对照）

```
aapt2 dump badging app.apk            # 包名/入口/权限基线
aapt2 dump resources app.apk > res-map.txt   # 混淆后资源 ID → 名称映射
# 动态侧（[[re-frida]]）取运行时资源 ID，回查 res-map.txt 还原真实资源名
```

### 4. 加固识别与分流

```
jadx -d java-out app.apk 且只见壳类（com.stub.StubApp 等） → 加固
ls out/lib/ 找壳 so（libjiagu.so / libDexHelper.so / libsecneo.so 等）
ls -la out/classes*.dex | 体积异常小 → 真 dex 运行时解密
# 判定加固后：转 [[re-anti-analysis]] 脱壳，或 [[re-frida]]/[[re-memdump]] 运行时取内存 DEX
# 壳名/节区/熵指纹对照 → [[re-packer-id]]
```

## 实现教训（内化）

- jadx 反编译结果与 smali 严格对应：先 jadx 定位方法，再按类名/方法名在 apktool 产物里找对应 smali 改写，比直接读 smali 快一个量级
- 补丁闭环验证分两层：先字节级（pull 已装 APK 比对 patch 地址），后逻辑级（行为变化）——字节在位说明签名/安装链路没破坏
- `apktool d -r` 是 smali 补丁默认形态：资源原样保留，回编译失败面最小；只有需要改资源时才用完整解包
- 加固判定优先看「jadx 输出 vs 包内 dex」两处交叉，单一特征（如只有一个壳 so）可能误判
- 静态结论与动态证据对照：资源混淆目标用 aapt2 dump 映射 + [[re-frida]] 运行时取值，静态侧不硬猜

## 使用注意

- 纯静态可免沙箱（[[platform-tips]] 最高原则）；涉及运行样本（重打包安装、脱壳验证）按 [[platform-tips]] 沙箱分支执行
- 每步产物（解包目录 hash、补丁 APK sha256、签名证书）对照 [[re-triage]] 入档；结论写 [[analysis-contract]]
- 重打包目标含签名自校验时先评估校验链（见 [[gotchas]] 签名坑组），带壳目标优先免重打包方案
