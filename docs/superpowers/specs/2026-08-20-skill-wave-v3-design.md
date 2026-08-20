# 技能库第三轮扩充设计（2026-08-20）

## 背景

107 技能覆盖审查后识别 13 个实战缺口（移动端 Flutter/RN、固件 RTOS/MCU/MIPS/TEE、语言运行时 Lua/老运行时、无线 BLE/NFC、图形 Shader、硬件侧信道、新兴 HarmonyOS）。用户定案：**全上**，融合优先——可融合的进现有技能，无自然宿主的独立成技能。

归位决策（用户已确认）：
- 独立 5 个：re-flutter、re-rtos、re-mips、re-tee、re-harmonyos
- 融合 8 项进 6 个技能：re-hybrid-app(+RN/Hermes)、re-iot-proto(+BLE/+NFC)、re-game(+Lua/+Shader)、re-hw-chip(+侧信道)、re-fw-extract(+MCU)、re-format-pe(+Delphi/VB6)

总数 107 → **112**（5 新增 + 107）。

## 变更总览

| # | 类型 | 目标 | 内容 |
|---|---|---|---|
| 1 | 新增 | re-flutter | Flutter/Dart AOT 逆向（libapp.so、AOT snapshot、Dart 符号定位） |
| 2 | 新增 | re-rtos | RTOS 结构分析（FreeRTOS/ThreadX/Zephyr：TCB/任务表/内核对象） |
| 3 | 新增 | re-mips | MIPS ISA + 路由器固件逆向 |
| 4 | 新增 | re-tee | TEE/TrustZone（OP-TEE、Trusted App、SMC 接口） |
| 5 | 新增 | re-harmonyos | HarmonyOS（hap 包、ArkTS 字节码） |
| 6 | 融合 | re-hybrid-app | +React Native/Hermes 字节码章节 |
| 7 | 融合 | re-iot-proto | +BLE 链路层章节 +NFC/智能卡章节 |
| 8 | 融合 | re-game | +Lua/LuaJIT 字节码章节 +Shader 反汇编章节 |
| 9 | 融合 | re-hw-chip | +侧信道/故障注入章节 |
| 10 | 融合 | re-fw-extract | +MCU 镜像分析章节（8051/AVR/PIC） |
| 11 | 融合 | re-format-pe | +Delphi/VB6 老运行时识别章节 |

## 新增技能边界（实现者大纲）

### re-flutter（原子，挂 re-mobile 组）

- 用：Flutter App（Android `libapp.so` / iOS `App.framework`、`libflutter.so`、`kernel_blob.bin`）；不用：纯原生 App（走 re-apk/re-ios）
- 核心内容：Dart AOT snapshot 结构（blobs 分区：ObjCode/rodata/instructions/strings）、字符串定位与交叉引用、Dart 符号还原（`--split-debug-info` 的 symbol 映射文件）、引擎与业务代码区分、Flutter 特有混淆（tree-shaking 后的名字处理）
- 工具：无官方 Dart 反编译器——blob 手动解析、`strings`+IDA/Ghidra 配合、动态侧 frida hook Dart VM 入口（`Dart_CreateRootLibrary`/`dart:...` 库注册点）或 Dart VM Service
- 跨域：[[re-apk]] [[re-ios]] [[re-mobile]] [[re-frida]] [[re-hybrid-app]]

### re-rtos（原子，挂 re-firmware 组）

- 用：MCU/IoT 固件跑 RTOS（FreeRTOS/ThreadX/Zephyr/RT-Thread）；不用：裸机固件（MCU 镜像节，见 re-fw-extract）
- 核心内容：RTOS 识别（启动代码 → 调度器入口 `osKernelStart`/`xTaskCreate` 链）、TCB/任务表结构定位（FreeRTOS `pxCurrentTCB` 静态表、ThreadX 双向链表、Zephyr `_kernel` 结构）、任务栈识别、内核对象（队列/信号量/互斥）定位、按任务拆分反编译
- 跨域：[[re-fw-extract]] [[re-fw-emulate]] [[re-binary-core]] [[re-mcu]]

### re-mips（原子，挂 re-binary-core 组）

- 用：MIPS 固件/恶意软件（路由器、嵌入式）；不用：ARM/x86 系（走 re-binary-core 通用）
- 核心内容：MIPS32/64 调用约定与**延迟槽**（坑）、GP 相对寻址/重定位、反编译注意（伪指令、`$ra` 链）、路由器固件 web 后端分析（httpd 认证/命令注入模式）、busybox 集成命令识别
- 跨域：[[re-fw-extract]] [[re-fw-rootfs]] [[re-binary-core]] [[re-ghidra]] [[re-vuln]]

### re-tee（原子，挂 re-mobile 组或 re-firmware 组，实现时定）

- 用：TrustZone/OP-TEE、Trusted App、secure storage、设备密钥相关逆向；不用：普通内核（re-kernel 是 Windows 侧）
- 核心内容：TEE 架构（normal/secure world 划分、SMC 接口、EL0-EL3）、OP-TEE 结构（core 与 TA 分离、`.ta` 二进制格式）、Trusted App 分析（入口/命令分发/secure storage 对象）、主机侧调用面（ioctl/`TEE_IOC`）、常见厂商 TEE 差异
- 跨域：[[re-fw-extract]] [[re-kernel]] [[re-mobile]] [[re-hw-chip]]

### re-harmonyos（原子，挂 re-mobile 组）

- 用：鸿蒙 App（hap/hsp/har 包）、ArkTS 字节码；不用：普通 Android（re-apk）
- 核心内容：hap 包结构（与 APK 同源：resources/index、ets/ 目录、module.json）、ArkCompiler 字节码（`.abc`）特征与反汇编思路、JS/TS 业务资源提取、与 Android 工具链的复用与差异（jadx 思路可借鉴、dex 层不存在）
- 跨域：[[re-apk]] [[re-hybrid-app]] [[re-java]] [[re-mobile]]

## 融合内容清单（实现者大纲）

### re-hybrid-app +1 章（React Native / Hermes）

- `.hbc` 字节码识别（文件头 `c61fbc03` 类魔数）、Hermes 反汇编（hermesc 系）、JS bundle 提取（Metro 打包结构）、RN 原生桥接（NativeModules）定位
- 既有 Flutter 名义覆盖补一句指向 [[re-flutter]]（不重复内容）

### re-iot-proto +2 章（BLE / NFC）

- BLE：链路层嗅探（nRF 系硬件/软件抓包）、广播包与连接事件解析、配对/加密协商（LE Legacy / Secure Connections）、GATT 服务与特征枚举
- NFC/智能卡：ISO14443 帧、APDU 交互、MIFARE Classic（Crypto-1 弱点）、proxmark3 类设备流程

### re-game +2 章（Lua / Shader）

- Lua：Lua/LuaJIT 字节码识别与反汇编（luac 系）、Cocos 系游戏脚本资源提取（jsc/luac 混淆变体）、脚本函数 hook（[[re-frida]] 或游戏内存侧）
- Shader：SPIR-V（spirv-dis）、DXIL/DXBC 反汇编、GLSL 还原（spirv-cross 类）、找渲染入口与着色器常量

### re-hw-chip +1 章（侧信道/故障注入）

- SPA/DPA 功耗分析基础、采集设备与流程（chipwhisperer 类）、时钟/电压故障注入、glitch 定位与重放、与去封装工序衔接

### re-fw-extract +1 章（MCU 镜像）

- MCU 程序镜像格式（Intel HEX/bin）、向量表与熔丝位识别、8051/AVR/PIC/MSP430 的 Ghidra 处理器模块反汇编、与 RTOS 技能衔接（跑 RTOS 的固件 → [[re-rtos]]）

### re-format-pe +1 章（老运行时识别）

- Delphi VCL：RTTI 结构、类表/vmt 定位、Borland 资源段特征
- VB6：MSVBVM60 运行时特征、资源特征定位入口
- 老壳注意（PECompact 类）与 [[re-packer-id]] 衔接

## 同步项（融合/新增波及）

1. **计数 107 → 112**：package.json description、`.claude-plugin/marketplace.json` 两处 description、README 首段
2. **README 技能导航**：新技能挂组（re-flutter→re-mobile 组、re-rtos→re-firmware 组、re-mips→re-binary-core 组、re-tee→re-firmware 组（实现时定）、re-harmonyos→re-mobile 组）
3. **re-analyze/references/triage.md**：移动 App 路径补 re-flutter/re-harmonyos 引用；固件路径补 re-rtos
4. **re-mobile 网关子技能清单**：+[[re-flutter]] +[[re-harmonyos]]
5. **re-feedback 无关**（不触碰）
6. marketplace.json 版本保持 0.0.2（永久版本策略，内容更新不 bump）

## 规则（沿用全库红线）

- 红线 1 呈现中性：禁用「最推荐」「强烈建议」等最高级强推措辞，最多「推荐」
- 红线 2 隐私脱敏：不指向具体项目/公司/产品
- 不绑定具体工具：方法为核心，工具为可替换示例；「工具准备」按模板给跨 OS 安装命令（硬件类给选购指引）
- 新技能 type=atomic、frontmatter name=目录名、必须有「## 工具准备」、[[链接]] 指向存在的技能或 references 文件名
- 通用方法论进 re-analyze/references（如 MIPS 延迟槽若属通用二进制知识可进 platform-tips 的链接，技能内保留专有内容）

## 校验与测试

- 每任务完成后 `npm test` 全绿（112 skills）
- `claude plugin validate .` 通过（marketplace.json 未动结构，只改 description 文本）
- 无 [[死链]]
- 红线 2 逐条对照（新增内容无具体指代）
- 工作区未提交文件谨慎处理（git add 只加任务文件）

## 范围外

- 不新增网关技能（12 网关结构不变）
- 不触碰 reverse-skill 机制层（沿用上轮结论）
- 游戏机（Switch/PS）等法律灰区不涉
