---
name: re-java
description: Java 字节码逆向：CFR/JD-GUI、jar 解包、Java 加固。触发词：Java、jar、字节码、JD-GUI、CFR、class文件
---

# Java 字节码逆向（CFR / JD-GUI / javap）

## 何时使用 / 何时不用

- 用：jar/war/class 样本还原 Java 逻辑；定位注册码/密钥/网络逻辑；处理 ProGuard/Allatori 混淆与 Java 加固
- 用：恶意 Java 样本（[[re-malware]] → [[re-managed]] 路径）静态还原
- 不用：Android DEX 直接分析（[[re-apk]]；转成 jar 后可回本技能）
- 不用：非 Java（.NET 走 [[re-dotnet]]、脚本走 [[re-script-deob]]、native 走 [[re-binary-core]]）
- 注意：动态步骤默认沙箱（[[platform-tips]] 最高原则）；解包产物先备份

## 工具准备

参考 [[platform-tips]]——反编译/解包为静态步骤，免沙箱；动态验证按最高原则进沙箱。

### JDK（javap / jar / java 运行时）

- Debian/Ubuntu: `apt install openjdk-17-jdk`
- Fedora: `dnf install java-17-openjdk`；Arch: `pacman -S jdk17-openjdk`
- macOS: `brew install openjdk`（或 `brew install --cask temurin`）
- Windows: `choco install temurin` 或官方安装器
- 验证: `java -version && javap -version`

### unzip（jar = zip 容器）

- Linux: `apt install unzip` / `dnf install unzip` / `pacman -S unzip`；macOS: `brew install unzip`
- 验证: `unzip -v`

### CFR（jar CLI 反编译器，零依赖）

- 下载（无依赖，只需 JRE）: `curl -L -o cfr.jar https://www.benf.org/other/cfr/cfr-0.152.jar`
- 验证: `java -jar cfr.jar --help`

### JD-GUI（GUI 反编译器）

- GitHub `java-decompiler/jd-gui` release zip → 解压，Linux/macOS: `java -jar jd-gui-1.6.6.jar`（zip 内含各平台可执行）
- 验证: GUI 启动并能 `File > Open` 打开 jar

### procyon（备选反编译器）

- Maven Central: `curl -L -o procyon-decompiler.jar https://repo1.maven.org/maven2/org/bitbucket/mstrobel/procyon-decompiler/0.6.0/procyon-decompiler-0.6.0.jar`
- 验证: `java -jar procyon-decompiler.jar --help`

## 操作步骤

按顺序执行，每步记录证据（路径 + sha256，见 [[re-triage]]）。

1. **jar/war 解包**：
   ```sh
   jar tf app.jar                 # 先看清单（JDK 自带 jar 工具）
   unzip -o app.jar -d unpacked/
   unzip -p app.jar META-INF/MANIFEST.MF   # Main-Class / 加固标记
   ```
   - war: 类在 `WEB-INF/classes/`，依赖在 `WEB-INF/lib/`
   - fat jar（Spring Boot）: 类在 `BOOT-INF/classes/`，嵌套依赖 `BOOT-INF/lib/*.jar` 需逐个解
   - aar（Android）: 内含 `classes.jar`，解出后再按本技能处理

2. **类结构识别**：
   ```sh
   javap -c -p unpacked/com/example/Main.class    # 字节码（-c）+ 私有成员（-p）
   javap -v unpacked/com/example/Main.class       # 常量池/元数据
   ```
   - 找入口：MANIFEST.MF 的 `Main-Class` → `javap -c -p <入口类>` 看 main 逻辑
   - 混淆程序集先看类名是否可读（a/b/c → 步骤 4）

3. **逻辑还原（CFR / JD-GUI）**：
   ```sh
   java -jar cfr.jar app.jar --outputdir cfr_out/           # 整包还原为 Java 源码
   java -jar cfr.jar unpacked/com/example/Main.class        # 单类还原
   java -jar procyon-decompiler.jar -jar app.jar -o procyon_out/   # 备选
   ```
   - JD-GUI: `File > Open` → 左侧树浏览 → `File > Save All Sources` 导出
   - 关键类/方法用两个反编译器交叉验证（CFR 对 lambda/现代字节码还原更好，JD-GUI 对老代码更顺）

4. **混淆识别与字符串解密**：
   - ProGuard: 类/方法名全变 `a/b/c`、`javap -l` 无 LineNumberTable/LocalVariableTable（调试信息被剥）
   - Allatori: 反编译产物出现 `com.allatori.*` 水印类、`StringEncryptor` 调用（字符串加密）
   - ZKM（Zelix KlassMaster）: `com.zelix.*` 类特征
   - 检测: `grep -rn 'StringEncryptor\|decrypt(' cfr_out/ | head`
   - 字符串加密处理：定位解密类与算法（key/变换方式）→ python3 复刻批量还原；或动态取明文（步骤 5，沙箱内）——先静态还原，静态卡住再动态

5. **动态（可选；沙箱内执行 [[re-sandbox]]）**：
   - JDB（桌面 JVM）:
     ```sh
     jdb -classpath app.jar com.example.Main
     > stop in com.example.Main.checkKey     # 下断点
     > print key                             # 取变量
     > eval new com.example.Util().decrypt("密文")   # 直接调用解密方法取明文
     ```
   - Frida（Android Java 应用，转 [[re-mobile]]/[[re-apk]] 域）:
     ```js
     Java.perform(function () {
       var c = Java.use("com.example.Main");
       c.checkKey.implementation = function (k) {
         console.log("key = " + k);
         return this.checkKey(k);
       };
     });
     ```
   - 桌面 JVM 无 Frida Java API → 用 JDB / 自写 Java agent

## 跨域联合

- [[re-managed]]：网关工作流步骤②（反编译）③（去混淆）固定调用本技能
- [[re-malware]]：Java 恶意样本路径（re-malware → re-managed → 本技能静态还原）
- Android 侧：[[re-apk]] / [[re-mobile]]（DEX 转 jar 后可回本技能）；动态 [[re-frida]]（Android）
- 底座 [[re-binary-core]]：初勘（[[re-triage]]）；native/JNI 部分

## 常见坑与陷阱

- **ProGuard 改名后靠字符串交叉引用**：现象——反编译全是 `a/b/c` 类、`a(...)` 方法，无法定位目标逻辑；原因——ProGuard shrink+obfuscate 重命名抹掉语义；对策——从字符串入手：grep 明文 URL/提示语 → 在反编译产物里找引用它的类（`grep -rn "提示语" cfr_out/`）→ 沿调用链恢复语义
- **Allatori/字符串加密需先解密**：现象——反编译只见 `StringEncryptor.decrypt("...")` 调用，看不到任何明文；原因——字符串运行时才解密；对策——静态定位解密算法与 key → python3 复刻批量还原；或动态在解密调用后取明文（JDB `eval` / Frida），沙箱内执行
- **反编译不完全正确**：现象——CFR/JD-GUI 输出语法错误、goto/label 混乱、try-catch 结构诡异、lambda 还原失败；原因——字节码到 Java 不存在无损还原；对策——对照 `javap -c -p` 字节码手工修正，多反编译器交叉验证
- **Java 加固（如 Virbox）类似壳需先脱**：现象——JD-GUI 打开报错/空白、`javap` 输出损坏、文件头非标准；原因——加固器加密 class 字节码、运行时才解密（本质是壳）；对策——先脱加固：运行时 dump class（`-Xbootclasspath`/attach agent 或专用脱壳工具）→ 对脱出的标准 class 再反编译；思路同 [[re-anti-analysis]] 的"先脱壳后分析"
