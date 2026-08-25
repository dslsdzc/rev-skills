# 能力注册表（Capability Layer）

能力层解决技能边界漂移：技能按**能力**（可执行的分析动作）声明，域技能 = 能力组合。新增技能先声明能力，路由按能力匹配，不依赖领域名。

## 标签清单（validate.mjs 校验值必须在此清单内）

- `triage` — 文件初勘（file/哈希/熵/strings/架构识别）
- `address-translation` — 地址空间换算（PIE/ASLR 基址、RVA/VA、loader offset、跨工具地址对齐）
- `elf-parser` — ELF 格式解析（头/节/动态链接/符号）
- `pe-parser` — PE 格式解析（DOS/NT 头/节表/导入导出）
- `macho-parser` — Mach-O 解析（LC_*/segment/dyld）
- `dex-parser` — DEX 解析（opcode/结构/混淆）
- `bytecode-parser` — 托管字节码解析（Java/.NET/WASM/pyc/CAP 等）
- `binary-diffing` — 二进制变体/补丁对比
- `decompilation` — 反编译（Ghidra/IDA/Binary Ninja 等）
- `debugging` — 交互调试（断点/单步/内存读写）
- `tracing` — 系统调用/函数跟踪
- `memory-dump` — 进程内存转储与定向提取
- `memory-forensics` — 整机内存取证（Volatility）
- `emulation` — 模拟执行（Unicorn/Qiling/QEMU）
- `symbolic-execution` — 符号执行
- `constraint-solving` — 约束求解（Z3）
- `unpack` — 脱壳（压缩壳/强壳/加固 DEX）
- `deobfuscation` — 反混淆（花指令/平坦化/脚本混淆）
- `crypto-identification` — 加密算法识别（常量表/指纹）
- `crypto-decryption` — 加密数据还原（定位解密函数/写解密脚本）
- `key-extraction` — 密钥与口令提取（硬编码/内存/资源）
- `protocol-recovery` — 协议状态机重建
- `network-capture` — 流量捕获与过滤（tcpdump/tshark）
- `tls-analysis` — TLS/加密流量分析（指纹/密钥导出）
- `jni-analysis` — JNI 注册与 native 方法还原
- `frida-instrumentation` — Frida 插桩（hook/脚本生成）
- `firmware-extraction` — 固件提取与解包
- `rtos-analysis` — RTOS 任务表/内核对象还原
- `hardware-interface` — 硬件接口（JTAG/UART/flash/读卡）
- `rf-analysis` — 射频信号采集与解调
- `malware-behavior` — 恶意行为分析（持久化/注入/ATT&CK）
- `threat-intel` — 威胁情报关联与归因
- `license-analysis` — 授权验证逻辑分析（定位校验点/算法还原）
- `fuzzing` — 覆盖率引导模糊测试
- `shellcode-analysis` — Shellcode 提取与解码
- `kernel-analysis` — 内核模块/驱动逆向
- `stego-detection` — 隐写检测与提取
- `document-malware` — 恶意文档分析（PDF/Office）
- `evasion-analysis` — 检测规避对抗分析（AMSI/ETW）
- `game-analysis` — 游戏逆向（Unity/Unreal/脚本引擎）
- `console-analysis` — 主机/复古平台容器与 ROM
- `drm-analysis` — DRM 实现分析
- `automotive-analysis` — 汽车总线（CAN/ECU）
- `ai-model-analysis` — AI 模型逆向与攻击
- `blockchain-analysis` — 链上字节码（EVM 等）
- `web-assembly` — WASM 逆向
- `browser-extension` — 浏览器扩展逆向
- `sdr-analysis` — 软件无线电协议恢复
- `chip-analysis` — 芯片物理层（decap/侧信道）
- `tee-analysis` — TEE/TrustZone 可信应用
- `uefi-analysis` — UEFI/BIOS 固件
- `mobile-forensics` — 移动设备取证（备份/应用数据）

## 标注规范

- frontmatter 声明 `capabilities: [tag1, tag2]`（YAML list；单值可写 `capabilities: [tag]`）
- 语义：本技能**提供**这些能力（一技能可多能力）
- 网关/入口：声明其聚合能力；不提供分析能力的元技能（如 re-feedback）可省略字段
- 未知标签、非 list 写法 → validate.mjs 报错
- 渐进策略：首批标注网关与高频技能（2026-08-25），其余技能随维护逐步补齐——未标注不阻塞

## 路由改造（后续工作）

- triage/rerouting 从「按领域名」逐步改为「输入特征 → 需要能力 → 提供该能力的技能」
- 网关选择树标注能力组合（如 Android = dex-parser + jni-analysis + frida-instrumentation + native-analysis）
- 新技能创建时先声明能力，校验通过后挂载
