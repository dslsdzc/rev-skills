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
- `arch-analysis` — 架构相关逆向（ARM/MIPS/RISC-V：调用约定、指令集特性、裸机入口）
- `lang-runtime-analysis` — 语言运行时产物逆向（Go/Rust/Swift/Zig/Nim/Haskell：符号、ABI、运行时结构）
- `disk-forensics` — 磁盘/文件系统取证（删除恢复、时间线、未分配空间）
- `ebpf-analysis` — eBPF 程序逆向（指令集、progs/maps 关联、跟踪与对抗）
- `electron-analysis` — Electron 桌面应用逆向（asar/主渲染进程/CDP）
- `hypervisor-analysis` — 虚拟化逆向（VT-x/SVM、VMCS/VMCB、嵌套与检测）
- `jailbreak-analysis` — iOS 越狱环境与 tweak 分析（检测绕过、Theos/LLDB 远程）
- `hybrid-app-analysis` — 跨平台框架产物逆向（Flutter/Dart AOT、Hermes/RN）
- `exploit-development` — 利用开发（ROP/堆利用/载荷构造）
- `binary-patching` — 二进制补丁（字节级修改、指令重写）
- `plugin-development` — 逆向工具链扩展（Ghidra/IDA 插件工程化）
- `sandbox-setup` — 沙箱与隔离环境搭建（动态分析前置）
- `sample-acquisition` — 现场样本采集（异常执行内存定位、运行时捕获与提取，跨 OS 观测模型）

## 标注规范

- frontmatter 声明 `capabilities: [tag1, tag2]`（YAML list；单值可写 `capabilities: [tag]`）
- 语义：本技能**提供**这些能力（一技能可多能力）
- 网关/入口：声明其聚合能力；不提供分析能力的元技能（如 re-feedback）可省略字段
- 未知标签、非 list 写法 → validate.mjs 报错
- **标签不得悬空**：注册表里的标签必须至少被一个技能声明（validate.mjs 检查）——新增标签与声明它的技能同批提交
- **原子技能必须声明**：未声明即 `npm test` 失败；入口（re-analyze）与不提供分析能力的元网关（re-feedback）可省略

## 能力索引（声明 → 消费的查询表）

- `capability-index.md`：能力 → 技能反查表，**机器生成**（`node bin/capindex.mjs`），含"尚未被声明"清单与覆盖率计数
- 任何 `capabilities` 声明变更后必须重跑生成并提交，否则 `npm test` 报索引过期
- 路由/检索按索引反查（不必按领域名猜）；索引同时是可查的覆盖率看板（标签覆盖 + 技能覆盖两个口径）

## 路由按能力匹配

- `triage.md` 目标表与 `rerouting.md` A 表都带「需要能力」列，技能列由 `capability-index.md` 反查——新增/修改路由行时先定能力标签，不按领域名硬编码
- CI 校验（`npm test`）：路由能力列标签须在注册表内；路由标称能力须被本行技能声明

## 网关选择树的能力标注

- **格式**：`[[re-<技能名>]]（能力：`tag1`、`tag2`）`——必须带显式「能力：」前缀；无前缀的括号是普通说明（如 `[[re-x64dbg]]（`minidump` 命令）`），两者不可混
  - 写作占位符时用 `[[re-<技能名>]]` / `[[<文件名>]]`——尖括号形式不会被解析成真链接，避免文档示例触发断链报错（validate 只校验实际链接）
- **范围**：`## 何时用哪个原子技能（选择树）` 段内**所有技能链接强制标注**；完整工作流段同样格式（非强制）
- **CI 校验**（`npm test`）：选择树内技能链接缺标注 → 失败；标注的能力须在注册表内、且被被标注技能真的声明；非技能链接（references 文档如 [[platform-tips]]）豁免
