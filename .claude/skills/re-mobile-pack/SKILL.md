---
name: re-mobile-pack
description: >
  Android 加固脱壳专项：乐固/360/梆梆/爱加密、DEX 恢复。
  触发词：脱壳、Android加固、DEX脱壳、乐固、梆梆、360加固、爱加密
---

# Android 加固脱壳（DEX 恢复）

## 何时使用 / 何时不用

- 用：拿到 Android 加固（乐固/360/梆梆/爱加密等）App，需要还原真实 DEX 继续静态分析
- 用：[[re-apk]] 已识别出加固，需要选脱壳路径
- 用：脱壳产物方法体空壳 / 指令抽取，需要修复
- 不用：未确认加固——先 [[re-apk]] 静态确认；普通 App 直接 jadx 即可
- 不用：VMP 虚拟化为主的强壳——转 [[re-anti-analysis]]（[[re-unpack-advanced]] 思路）
- 不用：需要运行时 hook / 绕过检测（那是 [[re-frida]]）

## 工具准备

动态脱壳默认在受控设备 / 模拟器快照内执行（[[platform-tips]] 最高原则——默认沙箱）。所有工具先验证再使用。

### frida + frida-dexdump —— 运行脱壳主力

- frida-tools: 全平台 `pip install frida-tools`（Python 3.8+；建议 venv）；frida-server 版本必须与主机一致并推送设备（安装与反检测完整流程见 [[re-frida]] 工具准备）
- frida-dexdump: 全平台 `pip install frida-dexdump`（Python 3）——运行时搜索内存中的 DEX 魔数并 dump
- 验证: `frida --version`；`frida-dexdump -h`（能看到 `-U`/`-f`/`-d` 参数）
- 用法: `frida-dexdump -U -f <包名>`（spawn 起步脱壳）、`frida-dexdump -U <pid>`（attach）、`frida-dexdump -U -f <包名> -d`（深度搜索，覆盖多 DEX / 部分抽取）

### BlackDex —— 静态脱壳机（免 frida，普通加固首选替代）

- 安装: GitHub release 下载 APK——`https://github.com/CodingGay/BlackDex/releases`；32 位与 64 位是两个独立 APK（目标 App 不出现在列表就换另一个架构版本）
- 环境: 普通 Android 手机或模拟器，Android 5.0~12，无需 root / 定制环境
- 能力: 覆盖落地加载 / 内存加载 / 指令抽取三类壳；深度模式回填指令抽取的方法体（实验性，可能耗时数分钟或失败）
- 产物: `hook_*.dex`（hook 系统 API 得到）与 `cookie_*.dex`（DexFile cookie 技术）
- 验证: 安装后能列出目标 App 并完成脱壳

### Youpk —— 主动调用脱壳机（抽取加固最强路径）

- 源码/ROM: `https://github.com/Youlor/Youpk`——基于 Android 7.1.2_r33 二次开发，**仅支持 Google Pixel 1**：Android Studio 构建后 `flash-all.sh` 刷入定制 ROM
- 用法: `adb shell "echo <包名> >> /data/local/tmp/unpacker.config"` → 启动目标 App 自动主动调用脱壳（日志见 "unpack end"）→ `adb pull /data/data/<包名>/unpacker`
- 修复: `java -jar dexfixer.jar ./unpacker ./out`（配套 DEX 修复，回填方法指令）
- 验证: `adb shell ls /data/data/<包名>/unpacker` 能看到 dex/method 产物

### jadx —— 脱壳后反编译（复用 [[re-apk]]）

- 跨 OS 安装与验证见 [[re-apk]] 工具准备；jadx 支持多 DEX 直接分析，避免手工合并

### adb —— 设备交互

- Android SDK platform-tools 自带；验证 `adb --version`；模拟器场景 `adb shell` 即可

### 内存转储（[[re-memdump]] 思路）

- frida/objection `memory dump` 或按 [[re-memdump]] 从转储 grep DEX 魔数 `dex\n0xx` 提取——frida-dexdump 不可用时的兜底路径

## 操作步骤

按顺序执行，每步产物（DEX 路径 + sha256）存档（见 [[re-triage]]）。

1. **加固识别（先确认再动手）**：
   - 类名特征: jadx 反编译只见壳类——`com.stub.StubApp`（爱加密）、`com.secneo.apkwrapper` / `com.bangcle.*`（梆梆）等；入口 Application 被替换成壳类
   - 壳 so 特征: `ls out/lib/`——`libjiagu.so` / `libprotectClass.so`（360 加固）、`libDexHelper.so` / `libexec.so`（爱加密）、`libsecexe.so` / `libsecmain.so`（梆梆）
   - DEX 体积: `ls -la out/classes*.dex`——真实 DEX 加密存放（assets/ 或运行时解密），壳内 classes.dex 体积异常小
   - 记录识别出的壳名决定路径: 常规整体/抽取加固 → 本技能；虚拟化为主 → [[re-anti-analysis]]

2. **运行脱壳（frida-dexdump，默认路径）**：
   ```sh
   adb shell monkey -p <包名> 1            # 先启动 App，让壳把真 dex 加载进内存
   frida-dexdump -U -f <包名>              # 或 spawn 起步
   frida-dexdump -U <pid>                  # 已运行 attach
   frida-dexdump -U -f <包名> -d           # 深度搜索（多 DEX / 部分抽取场景）
   ```
   产物在当前目录 `<包名>/<时间戳>/*.dex`。**时机**：等 App 进到业务页面再 dump（[[platform-tips]] 关键经验——转储时机），一启动就 dump 拿到的是壳初始状态。

3. **静态脱壳（BlackDex / Youpk，frida 被检测时的替代路径）**：
   - BlackDex: 安装对应架构 APK → 选择目标 App → 脱壳（普通壳几秒；抽取壳开深度模式，数分钟且有失败风险）→ 导出产物
   - Youpk（抽取加固优先）: 刷 Pixel 1 ROM → 写包名配置 → 启动 App 等待自动脱壳 → pull `unpacker/` 目录 → `java -jar dexfixer.jar ./unpacker ./out`
   - 交叉验证: 两条路径产物对比（同一方法体应一致），不一致取完整者

4. **DEX 修复与完整性检查**：
   ```sh
   file out/*.dex                          # 应见 "Dalvik dex file version 035"（magic: dex\n035\0）
   dexdump out/classes.dex 2>/dev/null | head -30
   jadx -d java-out out/                   # 反编译验证：业务类是否齐全
   ```
   - 方法体空壳（CodeItem 全 nop / 直接 throw）→ 指令抽取壳未回填：用 dexfixer（Youpk 产物配套）或 BlackDex 深度模式重脱；仍不行 → 主动调用触发方法执行后再转储（[[re-memdump]] 思路）
   - 多 DEX: 检查 classes.dex / classes2.dex / ... 是否齐全；frida-dexdump `-d` 深度搜索兜底；jadx 多 DEX 直接分析
   - 修复后必须反编译抽检再进业务分析（见坑 3）

5. **脱壳后分析（走 [[re-apk]] 全流程）**：
   - manifest 入口/权限 → jadx 反编译业务代码 → 定位目标逻辑（密钥/协议/校验）
   - 需要改行为 → smali 补丁 + 重打包签名（[[re-apk]] 步骤 4）
   - 原生 so（壳 so / JNI 业务 so）→ [[re-binary-core]]（[[re-format-elf]] + [[re-ghidra]]）；壳自身反调试/校验对抗 → [[re-anti-analysis]]

## 跨域联合

- [[re-mobile]]: 工作流第 5 步加固分支固定调用本技能（[[re-apk]] 识别后转入）
- [[re-apk]]: 加固识别（步骤 5）与脱壳后静态分析（manifest / jadx / smali）
- [[re-frida]]: 运行脱壳执行环境 + 反 frida 检测对抗（改名 / 换端口 / gadget）
- [[re-memdump]]: 内存 DEX 提取思路（dump 时机、magic 扫描、多 DEX 兜底）
- [[re-anti-analysis]]: VMP / 虚拟化加固对抗（抽取+虚拟化组合壳转强壳流程）
- [[re-binary-core]]: 壳 so / JNI 原生逻辑分析（[[re-format-elf]] / [[re-ghidra]]）
- [[platform-tips]]: 默认沙箱（模拟器快照）、转储时机关键经验
- 本技能被 [[re-analyze]] 的 triage「移动 App 分析」路径引用（re-mobile → re-apk 识别加固 → re-mobile-pack）

## 常见坑与陷阱

- **VMP 级加固（抽取+指令虚拟化）脱壳难度大**：现象——frida-dexdump / BlackDex 出 DEX 后方法体大量 nop / 空壳，部分方法逻辑在 dex 里永远找不到；原因——壳除抽取指令外把关键方法虚拟化进 so（自定义 VM 解释执行），DEX 层还原不出这部分；对策——识别为抽取+虚拟化组合时：抽取部分用 Youpk 主动调用修复，虚拟化部分放弃 DEX 还原、改为动态 [[re-frida]] hook 观察输入输出，或还原 VM 解释器（成本高，标注范围并转 [[re-anti-analysis]] 强壳思路）
- **反 frida 检测**：现象——spawn 即闪退、frida-dexdump 连不上或 dump 出空结果；原因——壳检测 frida-server 端口 27042 / 路径 / 特征线程（gum-js-loop）等指纹；对策——按 [[re-frida]] 反检测章节改名 + 换端口；仍被检测 → 换 BlackDex / Youpk（不依赖 frida）或 frida-gadget 注入
- **DEX 修复不完整（方法体空壳）**：现象——jadx 打开脱壳 DEX，半数方法无反编译内容或直接 throw；原因——指令抽取壳的 CodeItem 未回填（dump 时机早于方法执行 / 修复器未处理）；对策——dexfixer 修复（Youpk 产物配套）或 BlackDex 深度模式重脱；主动调用触发方法执行后再 [[re-memdump]] 转储；修复后 dexdump 抽查 + jadx 反编译验证再进分析
- **多 DEX 合并/丢失**：现象——只 dump 到单个 classes.dex，jadx 报类缺失 / 引用不存在；原因——加固后多 DEX 由壳运行时加载，frida-dexdump 默认搜索可能漏；对策——`-d` 深度搜索、hook ClassLoader 枚举已加载 dex（[[re-frida]] 枚举）、内存转储全部提取；jadx 直接加载全部 dex 分析
- **转储时机过早**：现象——dump 出的 DEX 解不开 / 是壳初始数据；原因——真 dex 尚未解密加载；对策——等 App 进入业务页面再 dump（[[platform-tips]] 转储时机关键经验，与"解密数据看到立刻保存"相反的另一端）
