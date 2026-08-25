# 任务识别决策表

入口根据「分析目标 + 输入文件」选择编排路径。目标命中多个大类时按依赖顺序串联。

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

| 目标（用户描述） | 编排路径（按顺序） |
|---|---|
| 判定恶意行为 / 会不会回连 | re-malware 网关 → 默认沙箱(re-sandbox) → 行为(re-behavior) → C2(re-protocol: netcap/proto-rev/crypto-*) → IOC/报告(re-ioc) |
| 勒索加密 / 文件被加密 / 勒索信 | re-malware 网关 → 沙箱(re-sandbox) → 勒索分析(re-ransomware) → 加密识别/解密(re-crypto-id/decrypt) → IOC/报告(re-ioc) |
| 无文件样本 / PowerShell 链 / 内存执行 | re-malware 网关 → 无文件分析(re-fileless) → 脚本去混淆(re-script-deob) → 行为(re-behavior) → IOC/报告(re-ioc) |
| 样本带壳 / 脱壳 | re-anti-analysis 网关 → 壳识别(re-packer-id) → 脱壳(re-unpack-simple/advanced) → 验证 |
| 破解 / 授权绕过 / 注册码 | re-cracking 网关 → （若带壳）re-anti-analysis → 授权定位(re-license) → 补丁/注册机(re-patching/re-keygen) |
| 漏洞挖掘 / 崩溃分析 | re-vuln 网关 → fuzzing → crash-triage →（定位）re-binary-core |
| 分析固件 / IoT 设备 | re-firmware 网关 → 提取(re-fw-extract) → rootfs(re-fw-rootfs) → 仿真(re-fw-emulate) →（UEFI/BIOS 固件 → re-uefi）→（MCU 镜像 → re-fw-extract 内 MCU 节；跑 RTOS → re-rtos）→（ARM 架构 → re-arm；RISC-V → re-riscv）→（TEE/可信应用 → re-tee）→（芯片/PCB 物理层 → re-hw-chip）→（若见通信）re-protocol |
| 分析网络流量 / 未知协议 | re-protocol 网关 → 捕获(re-netcap) → 解析(re-proto-rev) → 加密(re-crypto-id/keys/decrypt) |
| 射频 / 无线信号 | re-protocol 网关 → 信号采集与解调(re-sdr) →（协议还原）re-proto-rev / re-iot-proto |
| 移动 App 分析 | re-mobile 网关 → APK(re-apk) / iOS(re-ios) → 动态(re-frida) →（Flutter → re-flutter；鸿蒙 hap → re-harmonyos；RN/混合 → re-hybrid-app；Frida 脚本生成 → re-frida-script-author）→（若含原生库）re-binary-core；加密体系审计（Keystore/Cipher）→ re-android-crypto |
| 一般软件逆向 / 看逻辑 | re-binary-core 网关 → 初勘(re-triage) → 格式(re-format-*) → 反编译(re-ghidra/ida/radare2) → 按需动态 |
| 游戏逆向 / Unity / Unreal / 主机平台 | re-game（专项，底座 re-binary-core）→（现代主机/复古平台 → re-console） |
| shellcode / 位置无关载荷 | re-binary-core 网关 → 初勘(re-triage) → 提取/解码循环(re-shellcode) → 模拟执行(re-emulation) |
| CTF 赛题 | re-ctf 网关 → 题型识别 → re-angr / re-z3 / re-pwn / 反混淆(re-deobfuscate) →（底座）re-binary-core |
| .NET/Java/脚本样本 | re-managed 网关 → dotnet/java/script-deob →（Electron 应用 → re-electron；Java Card/SIM → re-javacard）→（恶意场景）re-malware |
| 智能合约 / 合约漏洞 / EVM 字节码 | re-managed 网关 → 合约逆向(re-blockchain) →（漏洞利用）re-vuln |
| AI 模型 / 权重提取 / 模型水印 | re-managed 网关 → **re-ai-triage 分流**：拿到模型文件（.onnx/.pt/.safetensors 等，文件层）→ re-ai-model；只有 API（行为层评估）→ re-ai-attack；恶意行为（投毒/后门）→ 恶意分析 →（格式混淆）re-binary-core |
| macOS 原生应用 | re-binary-core 网关 → 格式(re-format-macho) → 应用逆向(re-macos) |
| 内存取证/威胁情报 | re-forensics 网关 → mem-forensics → ti →（衔接）re-ioc |

## 复合任务示例

- "脱壳 → 静态 → 动态 → C2 协议 → 报告"：re-anti-analysis → re-binary-core → re-malware(re-sandbox) → re-protocol → re-ioc
- ".NET 样本 → 恶意判定 → 内存取证"：re-managed(dotnet) →（恶意场景）re-malware → re-forensics(mem-forensics → ti) → re-ioc
- "崩溃样本 → 漏洞根因"：re-vuln（fuzzing 复现 → crash-triage 定位）→（定位）re-binary-core
- 每个环节完成后检查是否有新证据改变后续路径（如动态分析发现加壳 → 回退 re-anti-analysis）。中途再路由统一按 [[rerouting]] 双轨执行（证据触发 / 网关完成必查）。
