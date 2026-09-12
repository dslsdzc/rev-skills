# 任务识别决策表

入口根据「分析目标 + 输入文件」选择编排路径。目标命中多个大类时按依赖顺序串联。

**路由按能力匹配**（能力层，见 [[capabilities]] 与 `capability-index.md`）：先由目标/输入特征确定「需要能力」，再查能力索引取提供该能力的技能——技能名只是索引结果，不按领域名硬编码。改技能的能力声明后索引会重生成，路由随之更新（`npm test` 校验路由与声明一致）。

## 第 0 步：授权上下文（authorization_context）

路由前先判定目标归属，存入会话变量 `RE_AUTH`（影响动态执行、补丁/绕过、密钥提取、脱壳产物扩散）：

| 值 | 含义 |
|---|---|
| `owned` | 自有/自研软件 |
| `ctf` | CTF/研究环境（题目/沙箱样本） |
| `research` | 获得授权的测试与审计 |
| `unknown` | 无法确认（默认向用户询问，用户不明确即保持 unknown） |

**影响**：
- 动态执行（运行样本/断点/内存读写）：`unknown` 与第三方商业软件 → 默认沙箱（[[re-sandbox]]），仅限授权内行为
- 补丁/绕过流程（re-cracking 域：license/patching/keygen/drm）：仅 `owned`/`ctf`/`research` 可进入；`unknown` → 只做静态授权逻辑分析，先询问归属（与 [[re-cracking]] 授权边界一致）
- 密钥提取/解密、脱壳产物扩散：同样受 `RE_AUTH` 约束

## 目标 → 编排路径

| 目标（用户描述） | 需要能力 | 编排路径（按顺序） |
|---|---|---|
| 判定恶意行为 / 会不会回连 | `malware-behavior`、`network-capture` | re-malware 网关 → re-sandbox → re-behavior → re-protocol（re-netcap / re-proto-rev / re-crypto-*）→ re-ioc |
| 只有现象、没有样本（不落盘 / 内存驻留 / 寄生在别的进程） | `sample-acquisition`、`malware-behavior` | re-sample-acquire → re-triage → re-fileless / re-malware → re-ioc |
| 勒索加密 / 文件被加密 / 勒索信 | `malware-behavior`、`crypto-identification`、`crypto-decryption` | re-malware → re-sandbox → re-ransomware → re-crypto-id / re-crypto-decrypt → re-ioc |
| 无文件样本 / PowerShell 链 / 内存执行 | `malware-behavior`、`deobfuscation` | re-malware → re-fileless → re-script-deob → re-behavior → re-ioc |
| 样本带壳 / 脱壳 | `unpack` | re-anti-analysis → re-packer-id → re-unpack-simple / re-unpack-advanced → 验证 |
| 破解 / 授权绕过 / 注册码 | `license-analysis`、`binary-patching` | re-cracking →（若带壳）re-anti-analysis → re-license → re-patching / re-keygen |
| 漏洞挖掘 / 崩溃分析 | `fuzzing`、`debugging` | re-vuln → re-fuzzing → re-crash-triage →（定位）re-binary-core |
| 分析固件 / IoT 设备 | `firmware-extraction`、`emulation`、`hardware-interface` | re-firmware → re-fw-extract → re-fw-rootfs → re-fw-emulate →（UEFI/BIOS → re-uefi）→（RTOS → re-rtos）→（ARM → re-arm；MIPS → re-mips；RISC-V → re-riscv）→（TEE → re-tee）→（芯片/PCB → re-hw-chip）→（JTAG/UART → re-hardware-io）→（若见通信）re-protocol |
| 分析网络流量 / 未知协议 | `network-capture`、`protocol-recovery`、`crypto-identification` | re-protocol → re-netcap → re-proto-rev → re-crypto-id / re-crypto-keys / re-crypto-decrypt |
| 加密流量（TLS）分析 | `tls-analysis`、`crypto-identification` | re-protocol → re-tls → re-crypto-keys |
| 射频 / 无线信号 | `rf-analysis`、`sdr-analysis`、`protocol-recovery` | re-protocol → re-sdr →（协议还原）re-proto-rev / re-iot-proto |
| 移动 App 分析 | `dex-parser`、`jni-analysis`、`frida-instrumentation` | re-mobile → re-apk / re-ios → re-frida →（Flutter/RN → re-hybrid-app / re-flutter；鸿蒙 hap → re-harmonyos；脚本生成 → re-frida-script-author）→（含原生库 → re-android-native）→（加密体系审计 → re-android-crypto） |
| iOS 越狱环境 / tweak 分析 | `jailbreak-analysis` | re-mobile → re-ios-jb →（动态插桩）re-frida |
| 一般软件逆向 / 看逻辑 | `decompilation`、`elf-parser` | re-binary-core → re-triage → re-format-pe / re-format-elf / re-format-macho → re-ghidra / re-ida / re-radare2 → 按需动态 |
| 架构相关目标（ARM/MIPS/RISC-V 裸机） | `arch-analysis` | re-binary-core → re-arm / re-mips / re-riscv →（若 RTOS）re-rtos |
| 语言产物（Go/Rust/Swift/Zig/Nim/函数式） | `lang-runtime-analysis` | re-binary-core → re-go / re-rust / re-swift / re-zig / re-nim / re-fp-runtime |
| 游戏逆向 / 主机与复古平台 | `game-analysis`、`console-analysis` | re-game（底座 re-binary-core）→（现代主机/复古平台 → re-console） |
| shellcode / 位置无关载荷 | `shellcode-analysis`、`emulation` | re-binary-core → re-triage → re-shellcode → re-emulation |
| eBPF / 内核跟踪程序 | `ebpf-analysis` | re-binary-core → re-ebpf →（内核侧）re-kernel |
| hypervisor / 虚拟化目标 | `hypervisor-analysis` | re-binary-core → re-hypervisor →（内核底座）re-kernel |
| 内核驱动 / rootkit | `kernel-analysis` | re-binary-core → re-kernel →（调试）re-windbg / re-gdb |
| CTF 赛题 | `constraint-solving`、`symbolic-execution`、`exploit-development` | re-ctf → 题型识别 → re-angr / re-z3 / re-pwn / re-deobfuscate →（底座）re-binary-core |
| .NET/Java/脚本样本 | `bytecode-parser`、`deobfuscation` | re-managed → re-dotnet / re-java / re-script-deob →（Java Card/SIM → re-javacard）→（恶意场景）re-malware |
| Electron 桌面应用 | `electron-analysis` | re-managed → re-electron →（asar 内 JS 混淆）re-script-deob |
| 智能合约 / EVM 字节码 | `blockchain-analysis` | re-managed → re-blockchain →（漏洞利用）re-vuln |
| AI 模型 / 权重提取 / 模型水印 | `ai-model-analysis` | re-managed → **re-ai-triage 分流**：模型文件（.onnx/.pt/.safetensors 等）→ re-ai-model；仅 API（行为层）→ re-ai-attack；恶意行为（投毒/后门）→ re-malware |
| macOS 原生应用 | `macho-parser` | re-binary-core → re-format-macho → re-macos |
| 内存取证 / 威胁情报 | `memory-forensics`、`threat-intel` | re-forensics → re-mem-forensics → re-ti →（衔接）re-ioc |
| 磁盘 / 镜像取证 | `disk-forensics` | re-forensics → re-disk-forensics →（时间线/情报）re-ti |
| 移动设备取证 | `mobile-forensics` | re-forensics → re-mobile-forensics → re-ti |
| 二进制变体 / 补丁对比 | `binary-diffing` | re-binary-core → re-variant |

## 复合任务示例

- "脱壳 → 静态 → 动态 → C2 协议 → 报告"：re-anti-analysis → re-binary-core → re-malware(re-sandbox) → re-protocol → re-ioc
- ".NET 样本 → 恶意判定 → 内存取证"：re-managed(re-dotnet) →（恶意场景）re-malware → re-forensics(re-mem-forensics → re-ti) → re-ioc
- "崩溃样本 → 漏洞根因"：re-vuln（re-fuzzing 复现 → re-crash-triage 定位）→（定位）re-binary-core
- 每个环节完成后检查是否有新证据改变后续路径（如动态分析发现加壳 → 回退 re-anti-analysis）。中途再路由统一按 [[rerouting]] 双轨执行（证据触发 / 网关完成必查）。
