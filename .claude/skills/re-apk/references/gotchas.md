# APK 静态分析工具特有坑与边界

## jadx 坑组

- **反编译不出业务代码 ≠ 工具坏了**：加固样本 jadx 只输出壳类（StubApp/壳 Application），业务 dex 运行时才解密——先按 SKILL.md 步骤 5 识别加固，再走 [[re-anti-analysis]] / [[re-mobile-pack]] 或 [[re-frida]]/[[re-memdump]] 取内存 DEX，别在 jadx 层面反复折腾
- **大样本 OOM / 卡死**：dex 巨大或异常样本（畸形 resources.arsc）会拖垮默认堆——用 `jadx-gui` 单类浏览替代全量反编译，或给 jadx 进程加大堆（JAVA_OPTS 类环境变量按发行版脚本而定）；先用 `unzip -l` 看 dex 数量评估规模
- **反编译质量随 dex 畸形程度下降**：混淆/畸形 code_item 会产生坏代码——`--show-bad-code` 容错输出可读性差但保底；优先交叉 smali 侧（apktool 产物）核对逻辑
- **Java 版本不匹配直接起不来**：jadx 要求 Java 11+（64 位）——ClassNotFound / 启动即退先 `java -version` 确认；多 JDK 环境把 `JAVA_HOME` 指到 11+ 再跑

## apktool 坑组

- **回编译失败先换 `-r` 解包**：完整解包（资源被解码）后 `apktool b` 常报资源编译错误——smali 补丁一律 `apktool d -r`，资源原样保留；必须改资源时再完整解包并 `--use-aapt2` 回编译
- **回编译产物与原始包签名必然不一致**：任何重打包都改变包内容——目标含签名自校验（对比 PackageManager 签名信息）时补丁会被拦，先评估校验链（SKILL.md 坑 2）；带壳目标优先免重打包（运行时 hook 签名适配）
- **`apktool d` 覆盖输出目录**：默认 `--force` 直接覆盖旧目录——多次解包时旧产物被静默替换，补丁对比拿错版本；敏感操作前先 `cp` 存档或换 `-o` 目录
- **仓库版 apktool 较旧**：apt/dnf 包落后官方 release（wrapper jar 机制）——回编译行为差异（aapt 版本、资源处理）以官方 release 为准，异常时先升官方版再排查

## 签名与重打包坑组

- **v1 签名需要 zipalign，v2/v3 不需要**：apksigner 默认 v1+v2；仅 v1（JAR 签名）时未对齐包在部分系统安装失败——`apksigner sign` 用默认即含 v2，老工具链才需要 zipalign 步骤
- **`install -r` 不生效 ≠ patch 无效**：同包名同签名覆盖安装保留数据，行为无变化时先做字节级闭环验证（`pm path` + `adb pull` 比对 patch 地址，见 [[commands]] 序列 2），再排查消费点/构建缓存
- **签名校验是跨层链，单点中和不够**：Java 层取签名 → 摘要 → 原生层与硬编码基线比对，任一层不匹配判失败——优先复用应用自带的签名适配 hook，静态侧找原生比对函数中和失败分支（SKILL.md 坑 2 细节）
- **debuggable 目标可直接 attach**：`android:debuggable="true"` 或可调试构建的 APK 无需重打包，直接 [[re-frida]] attach 绕过校验——重打包前先确认有没有这条捷径

## 加固识别坑组

- **单个特征别下结论**：libjiagu.so 之外还有自研壳/混淆 dex（无壳 so 但 dex 变形）——壳 so + 壳类 + dex 体积三特征交叉，仍不确定走 [[re-packer-id]] 指纹
- **资源混淆 ≠ 加固**：只混淆资源不改代码的样本，jadx 输出正常但资源名随机——用 `aapt2 dump resources` 还原映射（[[commands]] 序列 3），别误送脱壳流程
- **多 dex 拆包误判**：`classes2.dex`/`classes3.dex` 是正常多 dex（方法数超 64K），不是加固——按 dex 总量与入口 Application 类判断，单看文件名会误判

## 版本差异

- **jadx**：1.4.x 起要求 Java 11；1.5.x 主线（本地实测 1.5.6 可用 `--version`）——release zip 与 brew/pacman 包同步，功能差异小；反编译器本身迭代快，老版本对 Kotlin/新 dex 特征支持弱，异常时先升版本
- **apktool**：2.x 系列；apt/dnf 仓库版明显落后官方 release；`--use-aapt2` 是 2.5+ 选项，老版只有默认 aapt
- **aapt2 / build-tools**：34.0.0 示例、新版 SDK 自带更高版本；`aapt2 dump xmltree --file` 等接口稳定；老环境用 `aapt`（34 前默认）
- **apksigner**：build-tools 内置版本随 SDK；v1/v2/v3 签名行为一致，`--version` 输出以实际版本为准

## 使用注意

- 纯静态可免沙箱（[[platform-tips]] 最高原则）；重打包/安装/运行验证样本按沙箱分支执行
- 补丁产物与原始样本 sha256 对照存证（[[re-triage]]）；分析结论写 [[analysis-contract]]
- 版本相关行为（apktool 回编译细节、jadx 反编译质量）以目标版本实际表现为准
