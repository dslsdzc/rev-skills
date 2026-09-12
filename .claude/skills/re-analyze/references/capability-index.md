# 能力索引（机器生成，勿手改）

> 生成：`node bin/capindex.mjs`｜校验：`npm test`（过期即失败）
> 用途：路由与检索按能力反查技能——能力层的查询表（声明侧见 capabilities.md）

## 已声明能力（标签 64/64｜技能 119/121）

| 能力 | 说明 | 提供技能 |
|---|---|---|
| `address-translation` | 地址空间换算（PIE/ASLR 基址、RVA/VA、loader offset、跨工具地址对齐） | re-address-space |
| `ai-model-analysis` | AI 模型逆向与攻击 | re-ai-attack, re-ai-model |
| `arch-analysis` | 架构相关逆向（ARM/MIPS/RISC-V：调用约定、指令集特性、裸机入口） | re-arm, re-mips, re-riscv |
| `automotive-analysis` | 汽车总线（CAN/ECU） | re-automotive |
| `binary-diffing` | 二进制变体/补丁对比 | re-variant |
| `binary-patching` | 二进制补丁（字节级修改、指令重写） | re-patching |
| `blockchain-analysis` | 链上字节码（EVM 等） | re-blockchain |
| `browser-extension` | 浏览器扩展逆向 | re-browser-ext |
| `bytecode-parser` | 托管字节码解析（Java/.NET/WASM/pyc/CAP 等） | re-dotnet, re-harmonyos, re-java, re-javacard, re-managed, re-python |
| `chip-analysis` | 芯片物理层（decap/侧信道） | re-hw-chip |
| `console-analysis` | 主机/复古平台容器与 ROM | re-console |
| `constraint-solving` | 约束求解（Z3） | re-ctf, re-vuln, re-z3 |
| `crypto-decryption` | 加密数据还原（定位解密函数/写解密脚本） | re-crypto-decrypt, re-protocol |
| `crypto-identification` | 加密算法识别（常量表/指纹） | re-android-crypto, re-crypto-id, re-protocol, re-ransomware, re-tls, re-whitebox |
| `debugging` | 交互调试（断点/单步/内存读写） | re-binary-core, re-crash-triage, re-gdb, re-ghidra, re-ida, re-lldb, re-windbg, re-x64dbg |
| `decompilation` | 反编译（Ghidra/IDA/Binary Ninja 等） | re-binary-core, re-binaryninja, re-cpp-abi, re-ghidra, re-ida, re-radare2 |
| `deobfuscation` | 反混淆（花指令/平坦化/脚本混淆） | re-anti-analysis, re-deobfuscate, re-managed, re-script-deob |
| `dex-parser` | DEX 解析（opcode/结构/混淆） | re-apk, re-mobile |
| `disk-forensics` | 磁盘/文件系统取证（删除恢复、时间线、未分配空间） | re-disk-forensics |
| `document-malware` | 恶意文档分析（PDF/Office） | re-doc-malware, re-malware |
| `drm-analysis` | DRM 实现分析 | re-drm |
| `ebpf-analysis` | eBPF 程序逆向（指令集、progs/maps 关联、跟踪与对抗） | re-ebpf |
| `electron-analysis` | Electron 桌面应用逆向（asar/主渲染进程/CDP） | re-electron |
| `elf-parser` | ELF 格式解析（头/节/动态链接/符号） | re-address-space, re-binary-core, re-format-elf, re-imports |
| `emulation` | 模拟执行（Unicorn/Qiling/QEMU） | re-emulation, re-firmware, re-fw-emulate |
| `evasion-analysis` | 检测规避对抗分析（AMSI/ETW） | re-anti-analysis, re-evasion, re-malware |
| `exploit-development` | 利用开发（ROP/堆利用/载荷构造） | re-exploit, re-pwn |
| `firmware-extraction` | 固件提取与解包 | re-firmware, re-fw-extract, re-fw-rootfs |
| `frida-instrumentation` | Frida 插桩（hook/脚本生成） | re-frida, re-frida-script-author, re-mobile |
| `fuzzing` | 覆盖率引导模糊测试 | re-fuzzing, re-vuln |
| `game-analysis` | 游戏逆向（Unity/Unreal/脚本引擎） | re-game |
| `hardware-interface` | 硬件接口（JTAG/UART/flash/读卡） | re-firmware, re-hardware-io |
| `hybrid-app-analysis` | 跨平台框架产物逆向（Flutter/Dart AOT、Hermes/RN） | re-flutter, re-hybrid-app |
| `hypervisor-analysis` | 虚拟化逆向（VT-x/SVM、VMCS/VMCB、嵌套与检测） | re-hypervisor |
| `jailbreak-analysis` | iOS 越狱环境与 tweak 分析（检测绕过、Theos/LLDB 远程） | re-ios-jb |
| `jni-analysis` | JNI 注册与 native 方法还原 | re-android-native, re-mobile |
| `kernel-analysis` | 内核模块/驱动逆向 | re-anti-cheat, re-kernel |
| `key-extraction` | 密钥与口令提取（硬编码/内存/资源） | re-android-crypto, re-crypto-keys, re-malware, re-protocol, re-whitebox |
| `lang-runtime-analysis` | 语言运行时产物逆向（Go/Rust/Swift/Zig/Nim/Haskell：符号、ABI、运行时结构） | re-fp-runtime, re-go, re-nim, re-rust, re-swift, re-zig |
| `license-analysis` | 授权验证逻辑分析（定位校验点/算法还原） | re-cracking, re-keygen, re-license |
| `macho-parser` | Mach-O 解析（LC_*/segment/dyld） | re-binary-core, re-format-macho, re-ios, re-macos |
| `malware-behavior` | 恶意行为分析（持久化/注入/ATT&CK） | re-behavior, re-fileless, re-loader, re-malware, re-ransomware |
| `memory-dump` | 进程内存转储与定向提取 | re-binary-core, re-memdump |
| `memory-forensics` | 整机内存取证（Volatility） | re-forensics, re-mem-forensics |
| `mobile-forensics` | 移动设备取证（备份/应用数据） | re-forensics, re-mobile, re-mobile-forensics |
| `network-capture` | 流量捕获与过滤（tcpdump/tshark） | re-netcap, re-protocol |
| `pe-parser` | PE 格式解析（DOS/NT 头/节表/导入导出） | re-binary-core, re-format-pe, re-imports |
| `plugin-development` | 逆向工具链扩展（Ghidra/IDA 插件工程化） | re-plugin-dev |
| `protocol-recovery` | 协议状态机重建 | re-ics, re-iot-proto, re-proto-rev, re-protocol |
| `rf-analysis` | 射频信号采集与解调 | re-sdr |
| `rtos-analysis` | RTOS 任务表/内核对象还原 | re-firmware, re-rtos |
| `sandbox-setup` | 沙箱与隔离环境搭建（动态分析前置） | re-sandbox |
| `sdr-analysis` | 软件无线电协议恢复 | re-sdr |
| `shellcode-analysis` | Shellcode 提取与解码 | re-ctf, re-shellcode |
| `stego-detection` | 隐写检测与提取 | re-ctf, re-stego |
| `symbolic-execution` | 符号执行 | re-angr, re-vuln |
| `tee-analysis` | TEE/TrustZone 可信应用 | re-tee |
| `threat-intel` | 威胁情报关联与归因 | re-attribution, re-forensics, re-hunting, re-ioc, re-malware, re-ti |
| `tls-analysis` | TLS/加密流量分析（指纹/密钥导出） | re-protocol, re-tls |
| `tracing` | 系统调用/函数跟踪 | re-tracing |
| `triage` | 文件初勘（file/哈希/熵/strings/架构识别） | re-ai-triage, re-triage |
| `uefi-analysis` | UEFI/BIOS 固件 | re-firmware, re-uefi |
| `unpack` | 脱壳（压缩壳/强壳/加固 DEX） | re-anti-analysis, re-mobile-pack, re-packer-id, re-unpack-advanced, re-unpack-simple |
| `web-assembly` | WASM 逆向 | re-wasm |

## 尚未被声明（0）

（无——注册表标签全部有技能声明）
