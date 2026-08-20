# 技能库第三轮扩充实施计划（2026-08-20）

## 总览

- 范围：5 新增 + 6 技能融合（8 章）+ 全库同步项（计数/导航/路由）
- 总数：107 → 112
- 设计依据：docs/superpowers/specs/2026-08-20-skill-wave-v3-design.md（归位决策已定案，勿改动）
- 工作流：每任务 = 实现 → 评审（技术事实核对 + 红线对照）→ npm test → commit → 下一任务
- 红线：呈现中性（禁「最推荐/强烈建议」）、隐私脱敏（不指向具体项目/公司/产品）、不绑定具体工具（跨 OS 安装命令/硬件选购指引）、git add 只加任务文件

## 任务顺序（关键：新技能先于引用它的融合任务，避免中间态死链）

1. re-flutter（新增）
2. re-rtos（新增）
3. re-mips（新增）
4. re-tee（新增）
5. re-harmonyos（新增）
6. re-hybrid-app（融合 RN/Hermes + [[re-flutter]] 链接）
7. re-iot-proto（融合 BLE + NFC 两章）
8. re-game（融合 Lua + Shader 两章）
9. re-hw-chip（融合侧信道一章）
10. re-fw-extract（融合 MCU 一章 + [[re-rtos]] 链接）
11. re-format-pe（融合 Delphi/VB6 一章）
12. 同步项（计数/README/triage/re-mobile 网关清单）
13. 最终全分支评审 + 修复波

每个新增技能完成后 npm test 允许有「指向未来任务的死链」？——不允许：validate.mjs 会 FAIL。因此**新增技能内部不允许链接未创建技能**；对未来的引用留到融合任务时再补（如 re-hybrid-app 的 [[re-flutter]] 在 Task 6 才写）。新增技能只链接已存在技能。

## 通用格式要求（所有任务）

- SKILL.md 结构：frontmatter（name=目录名、description 含触发词）→ # 标题 → ## 何时使用 / 何时不用 → ## 工具准备（跨 OS 安装命令 + 验证命令；硬件类给选购指引不绑型号）→ ## 操作步骤（编号、每步命令、存档习惯）→ 章节 → ## 跨域联合（[[链接]]）→ ## 常见坑与陷阱（**标题**：现象——…；原因——…；对策——… 格式）
- 触发词与既有技能不重叠（如 re-flutter 不抢 re-apk 的 smali 触发词）
- 坑条目 ≥3 条，每条含现象/原因/对策三要素

---

## Task 1：re-flutter（新增）

**目标文件**：`.claude/skills/re-flutter/SKILL.md`

**内容结构**：
- 何时用/不用：用 Flutter App（Android `libapp.so` / iOS App.framework、`libflutter.so`、`kernel_blob.bin`、assets 下 snapshot）；不用纯原生 App（[[re-apk]] / [[re-ios]]）、不用 Web 版 Flutter
- 工具准备：python3（blob 结构解析）、strings/binutils、Ghidra（blob 反汇编与字符串交叉引用）、frida（动态侧，见 [[platform-tips]] 沙箱原则）、`--split-debug-info` 符号映射说明
- 操作步骤（编号）：
  1. 识别：`file` + `strings` 定位 libapp.so、检查 assets/flutter_assets 下的 kernel_blob.bin（debug 模式）vs AOT snapshot（release 模式）
  2. snapshot 结构：Dart AOT snapshot 的 blobs 分区（ObjCode/rodata/instructions/strings/…）手动解析与字符串定位——strings blob 里找业务字符串，交叉引用回指令 blob
  3. 符号还原：有 `--split-debug-info` 的 symbol 映射文件 → 名字直接映射；无映射 → 从字符串/`dart:` 库注册调用点反推
  4. 引擎 vs 业务区分：libflutter.so 是引擎不分析（除非引擎层 hook），重点 libapp.so
  5. 动态侧（沙箱）：frida hook Dart VM 入口（`Dart_CreateRootLibrary` / 库注册）观察加载流程；Dart VM Service 可连时直接枚举 isolate/库
- 跨域联合：[[re-apk]]、[[re-ios]]、[[re-mobile]]、[[re-frida]]、[[re-hybrid-app]]
- 坑（至少 3）：
  - release 无 kernel_blob（只有 AOT）——别找 snapshot 文件
  - 混淆后 Dart 名字是短名（tree-shaking/obfuscate）——用 symbol 映射或字符串定位，参考 [[re-go]] garble 思路（不写死链接，可提）
  - 引擎代码混入业务 —— 按 libapp/libflutter 边界过滤
  - frida 版本与设备匹配（沿用 re-frida 工具准备要求）

**验收**：npm test 通过（112 前为 107+1=108）；无死链；触发词不撞 re-apk/re-hybrid-app

## Task 2：re-rtos（新增）

**目标文件**：`.claude/skills/re-rtos/SKILL.md`

**内容结构**：
- 何时用/不用：MCU/IoT 固件跑 FreeRTOS/ThreadX/Zephyr/RT-Thread；不用裸机固件（MCU 镜像基础走 [[re-fw-extract]]）、不用 Linux 内核（[[re-kernel]]）
- 工具准备：Ghidra（结构体定义与任务表还原，ARM/ARM Thumb 处理器模块）、binwalk（镜像提取先行）、python3
- 操作步骤：
  1. 前置：镜像提取与格式识别（链接 [[re-fw-extract]]）
  2. RTOS 识别：启动代码（reset handler → 系统初始化 → 调度器启动）、搜索调度器特征串/符号（`xTaskCreate`/`osKernelStart`/`_tx_thread_create`/`z_thread_entry` 类）、头部字符串
  3. 任务表定位：FreeRTOS 的 `pxCurrentTCB`/任务链表静态区、ThreadX 的 `_tx_thread_created_list` 双向链表、Zephyr 的 `_kernel` 结构 —— 在 Ghidra 中定义结构体逐字段还原（优先级/状态/栈指针/任务名）
  4. 任务栈识别：栈底/栈顶常量定位，按栈归属切分任务边界
  5. 内核对象：队列/信号量/互斥/定时器 结构体定位，看板式从内核 API 调用点反推
  6. 按任务拆分反编译：每个任务一个入口点，独立分析（对应 [[re-analyze]] 的单函数深分析）
- 跨域联合：[[re-fw-extract]]、[[re-fw-emulate]]、[[re-binary-core]]、[[re-mcu]]（Task 10 后才建，Task 2 先不链接！）
- 坑（至少 3）：
  - 调度器启动前代码别当任务分析
  - 任务名是调试符号，stripped 固件里没有——用栈指针/优先级特征定位
  - 不同 RTOS 任务结构差异大（链表 vs 静态表）——先识别再定结构体
  - RTOS 版本文本串可被混淆（新版本去掉字符串）——用结构特征兜底

**注意**：Task 2 不得链接 re-mcu（Task 10 才创建）。re-mcu 的引用由 Task 10 补写。

## Task 3：re-mips（新增）

**目标文件**：`.claude/skills/re-mips/SKILL.md`

**内容结构**：
- 何时用/不用：MIPS 固件/恶意软件（路由器/嵌入式）、MIPS 架构样本；不用 ARM/x86 系（[[re-binary-core]] 通用底座）
- 工具准备：Ghidra/IDA 的 MIPS 处理器模块、binwalk（固件提取）、qemu-user 的 MIPS 模式（动态，沙箱原则）、python3
- 操作步骤：
  1. 前置：固件提取（[[re-fw-extract]]）与架构确认（`file`/`readelf -h`）
  2. 字节序判断：MIPS 大端/小端（`readelf` e_flags、字符串可读性）
  3. 反编译注意：**延迟槽**（branch/jump 后一条指令仍执行——反汇编工具处理但手读代码时容易错位）、`$gp`/`$ra` 调用约定、GP 相对寻址（`.got` 重定位表）、`-mlong-calls` 跳板
  4. 路由器固件专项：web 后端 httpd 定位（认证绕过/命令注入模式）、`/bin/busybox` 集成命令识别、固件配置与密码哈希提取
  5. 动态验证（沙箱）：qemu-user 跑 MIPS 样本或固件内程序，观察行为
- 跨域联合：[[re-fw-extract]]、[[re-fw-rootfs]]、[[re-binary-core]]、[[re-ghidra]]、[[re-vuln]]、[[re-sandbox]]
- 坑（至少 3）：
  - 延迟槽：分支后的指令在跳转前已执行——跟踪执行流时容易错
  - 大小端判断错 → 指令全部乱
  - `$gp` 相对引用没有重定位信息时靠基址猜测
  - 路由器固件常见非标准头/压缩层（多步 binwalk）

## Task 4：re-tee（新增）

**目标文件**：`.claude/skills/re-tee/SKILL.md`

**内容结构**：
- 何时用/不用：TrustZone/OP-TEE/Trusted App/secure storage/设备密钥相关；不用 Windows 内核（[[re-kernel]]）、不用普通 App 层
- 工具准备：Ghidra/IDA（ARM64）、固件提取工具链（[[re-fw-extract]]）、frida/内核侧 hook（[[re-frida]] 沙箱原则）、python3
- 操作步骤：
  1. 架构定位：normal world vs secure world、SMC 指令与监控模式（EL3）、TEE OS 加载入口（bootrom/固件中定位）
  2. OP-TEE 结构：core（可信 OS 内核）与 TA（可信应用）分离；TA 二进制格式（`.ta`：ELF with TA 头/签名）解析
  3. TA 分析：入口（`TA_InvokeCommand`/命令分发表）、命令号枚举、secure storage 对象操作（`TEE_*` API 调用点）
  4. 主机侧调用面：Linux 侧 `TEE_IOC_*` ioctl 结构、client 库调用序列——从两头夹逼 TA 的输入输出格式
  5. 常见厂商差异（泛化表述，不指具体产品）：自定义 TEE 的接口/结构差异处理思路
- 跨域联合：[[re-fw-extract]]、[[re-kernel]]、[[re-mobile]]、[[re-hw-chip]]、[[re-binary-core]]
- 坑（至少 3）：
  - TA 是签名+加密的固件镜像——先解密/验签流程再谈静态分析
  - secure world 代码拿不到时用主机侧 ioctl 调用面反推
  - 反调试：secure world 侧监测/防 dump 机制（泛化）
  - SMC 参数传递寄存器约定（x0-x7 泛化）错误会导致完全误读

## Task 5：re-harmonyos（新增）

**目标文件**：`.claude/skills/re-harmonyos/SKILL.md`

**内容结构**：
- 何时用/不用：鸿蒙 App（hap/hsp/har）、ArkTS 字节码；不用普通 Android（[[re-apk]]）
- 工具准备：hap 解包工具（hap-tools 类，不绑定具体实现——给通用描述与备选）、python3、字符串/资源提取工具、[[re-java]] 思路复用（jadx 类工具针对 abc 的替代——泛化）
- 操作步骤：
  1. 包结构：hap ≈ APK 变体（`module.json`、`resources/`、`ets/` 字节码目录、`.abc` 文件）；解包流程与 APK 同源（zip 容器）
  2. 字节码识别：`.abc`（ArkCompiler 字节码）文件头/段结构特征
  3. 业务逻辑还原：字符串定位 + 反汇编（ArkCompiler 反汇编器思路）、JS/TS 业务资源提取（与 [[re-script-deob]] 方法衔接）
  4. 与 Android 异同：无 dex/smali 层（跳过 [[re-apk]] 的 dex 环节）、资源与 manifest 结构类似（可复用 jadx 思路但目标格式不同）
  5. 动态侧（沙箱）：模拟器/真机运行时观察（[[re-mobile]] 编排）
- 跨域联合：[[re-apk]]、[[re-hybrid-app]]、[[re-java]]、[[re-mobile]]、[[re-script-deob]]
- 坑（至少 3）：
  - 用 Android 工具直接开 hap 会漏 ets 目录——记住是双容器（zip + 内部资源）
  - abc 反汇编器版本敏感（ArkCompiler 演进）——先识别编译版本
  - 混淆后的 ArkTS 名字短名——字符串/资源定位兜底

## Task 6：re-hybrid-app（融合）

**目标文件**：`.claude/skills/re-hybrid-app/SKILL.md`

**内容**：追加「## React Native / Hermes」章节（位置在现有内容之后、跨域联合之前）：
- 识别：`.hbc` 文件头魔数（`c61fbc03` 类）、RN 应用结构（`index.android.bundle` 类）
- Hermes 字节码：反汇编思路（hermesc 类工具）、内存布局/段特征
- JS bundle 提取：Metro 打包结构（`__d` 函数注册表类）、从 bundle 恢复业务 JS
- 原生桥接：NativeModules 定位（`TurboModule`/`NativeModules` 引用点）、桥接方法名与实现映射
- 动态：[[re-frida]] hook JS 运行时（`console.log`/模块加载点）
- 在现有 Flutter 段末尾补一句指向 [[re-flutter]]（「Flutter 专项见 [[re-flutter]]」，不重复内容）
- 更新 frontmatter description 触发词补 Hermes/hbc

**验收**：章节格式与既有章节一致；[[re-flutter]] 链接有效（Task 1 已建）；坑 ≥3 条（Hermes 版本差异、bundle 加密、字节码与明文 JS 混合等）

## Task 7：re-iot-proto（融合两章）

**目标文件**：`.claude/skills/re-iot-proto/SKILL.md`

**内容 A「## BLE 链路层」**：
- 嗅探：nRF 系硬件（泛化给选购指引）与主机软件抓包流程
- 广播/连接：广播包解析（ADV_IND/ADV_SCAN_IND 类）、连接事件时序、信道 37/38/39
- 配对加密：LE Legacy Pairing / LE Secure Connections 协商流程、LTK/STK 定位点、白名单/绑定密钥存储
- GATT：服务/特征枚举、handle 定位、读写通知点
- 与既有 MQTT/CoAP/Zigbee 章节并列

**内容 B「## NFC / 智能卡」**：
- ISO14443 帧结构、防冲突流程（UID/SAK 类）
- APDU 交互（CLA/INS/P1/P2/数据）、卡片应用定位
- MIFARE Classic：Crypto-1 弱点（重放/破解思路，泛化）、扇区密钥处理
- proxmark3 类设备流程（泛化选购）

**验收**：两章不重叠既有章节；坑 ≥3 条/章（或合并 ≥5）；frontmatter 触发词补 BLE 链路/NFC/智能卡

## Task 8：re-game（融合两章）

**目标文件**：`.claude/skills/re-game/SKILL.md`

**内容 A「## 游戏脚本引擎（Lua）」**：
- Lua 字节码：header（签名/版本）、指令结构、常量表/upvalue 表定位
- 反汇编：luac 类工具思路；LuaJIT 字节码差异（不同版本）
- Cocos 系脚本资源提取：`.jsc`/`.luac` 混淆变体（XOR/头截断——参考 [[re-fw-extract]] 的 XOR 章节思路）
- 脚本 hook：[[re-frida]] 或内存侧 hook Lua 函数（`lua_pcall` 类入口）

**内容 B「## 图形与 Shader」**：
- SPIR-V：`spirv-dis` 反汇编、指令集结构
- DXIL/DXBC：dxc 反汇编思路、SM 版本识别
- GLSL 还原：spirv-cross 类工具（泛化）
- 找渲染入口：着色器加载点（文件/内存）、常量表定位

**验收**：两章格式一致；坑 ≥3/章；不抢 re-frida/re-script-deob 触发词

## Task 9：re-hw-chip（融合一章）

**目标文件**：`.claude/skills/re-hw-chip/SKILL.md`

**内容「## 侧信道与故障注入」**：
- SPA/DPA：功耗曲线采集原理、差分分析思路（密钥位相关性）、采集设备（chipwhisperer 类泛化选购指引）
- 故障注入：时钟毛刺/电压毛刺、glitch 宽度/相位定位流程、重放与结果判定（跳过分支/改返回值类）
- 与去封装衔接：已有章节的流程联动
- 安全边界提示：授权范围（沿用技能库使用边界）

**验收**：与现有去封装/裸片章节并列不冲突；坑 ≥3

## Task 10：re-fw-extract（融合一章）

**目标文件**：`.claude/skills/re-fw-extract/SKILL.md`

**内容「## MCU 镜像分析」**：
- 镜像格式：Intel HEX（.hex）/bin 差异、程序内存布局（flash 起始/中断向量表）
- 向量表定位：复位向量 → 启动代码（衔接 [[re-rtos]]：跑 RTOS 的固件）
- ISA 识别与反汇编：8051/AVR/PIC/MSP430 各自特征（Ghidra 处理器模块），熔丝位/配置位概念（泛化）
- 与既有 binwalk/magic 流程衔接（镜像提取后进入本节的判断条件）

**验收**：[[re-rtos]] 链接有效（Task 2 已建）；坑 ≥3

## Task 11：re-format-pe（融合一章）

**目标文件**：`.claude/skills/re-format-pe/SKILL.md`

**内容「## 老运行时识别（Delphi / VB6）」**：
- Delphi VCL：RTTI 结构定位（类名/方法表）、vmt 定位、Borland 资源段（`.rsrc` 内特征）
- VB6：MSVBVM60 运行时特征（导入/资源）、入口定位（`WinMain` 类）
- 老壳注意：PECompact 类轻壳与 [[re-packer-id]] 衔接
- 识别先行：格式解析阶段就判断运行时（Delphi 的 `TApplication` 类串、VB6 的资源脚本特征）

**验收**：不抢 [[re-packer-id]] 触发词；坑 ≥3

## Task 12：同步项

**改动文件**：
1. `package.json` description：107 → 112
2. `.claude-plugin/marketplace.json` description（顶层）：107 → 112（插件条目 description 无计数，不动）
3. `README.md`：首段「107 个逆向工程技能」→ 112；技能导航段：re-mobile 组 + re-flutter、re-harmonyos；re-firmware 组 + re-rtos；re-binary-core 组 + re-mips；re-tee 挂组按 Task 4 实现时定（默认 re-firmware 组）；导航清单里同步各融合技能（不列章节，只保持技能名完整）
4. `.claude/skills/re-analyze/references/triage.md`：移动路径补 re-flutter/re-harmonyos；固件路径补 re-rtos
5. `.claude/skills/re-mobile/SKILL.md`：子技能清单 + [[re-flutter]] + [[re-harmonyos]]
6. `README.md` 安装段不动；marketplace.json 版本保持 0.0.2

**验收**：`grep -c` 全文无残留「107 个」；npm test 112 全绿；claude plugin validate 通过

## Task 13：最终全分支评审

- 全量 diff 复核（结构/红线 2/触发词重叠/坑格式）
- 技术事实抽查（延迟槽、Hermes 魔数、Dart snapshot、RTOS 结构、abc 格式、Crypto-1、SPIR-V 指令）
- npm test + claude plugin validate 双绿
- 台账更新 .superpowers/sdd/progress.md

## 评审清单（每任务）

- [ ] frontmatter name=目录名、description 含触发词、type=atomic
- [ ] 有「## 工具准备」（跨 OS 命令 + 验证）
- [ ] [[链接]] 全部存在（validate.mjs 强制）
- [ ] 红线 1：无最高级强推措辞
- [ ] 红线 2：无具体项目/公司/产品指代
- [ ] 不绑定具体工具（方法为核心，工具可替换）
- [ ] 坑条目含现象/原因/对策三要素
- [ ] 触发词不重叠
- [ ] npm test 全绿
