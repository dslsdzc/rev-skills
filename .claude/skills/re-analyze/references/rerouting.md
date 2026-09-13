# 中途再路由触发表

运行时证据触发的唯一事实源（区别于 triage.md 的入口「目标→路径」决策表）。分析过程中按双轨使用：

- **轨 1（网关完成必查）**：每网关完成后对照 A/B 表检查新证据
- **轨 2（证据出现即查）**：每产出新证据类型（字符串/节表/行为/加密特征）立即对照 A 表
- **未命中** → 按 B 表约束行动，禁止自行硬琢磨

**A 表按能力匹配**：证据特征先映射到「需要能力」，再经 `capability-index.md` 反查提供该能力的技能——技能列是索引结果，不是领域名硬编码；`npm test` 校验「能力列标签在注册表内」且「本行技能确实声明了该能力」。

## A 表：证据特征 → 需要能力 → 触发技能

| 证据特征（分析中看到） | 需要能力 | 触发技能（索引反查） |
|---|---|---|
| 节表异常（UPX0/.aspack）、熵 >7.0 | `unpack` | [[re-packer-id]] → [[re-anti-analysis]] |
| 未知加密算法、S-box/常量指纹、加密流量 | `crypto-identification` | [[re-crypto-id]] |
| 硬编码密钥/口令、内存中的 key | `key-extraction` | [[re-crypto-keys]] |
| 解密函数已定位、密文可还原 | `crypto-decryption` | [[re-crypto-decrypt]] |
| 反调试/反 VM 特征（ptrace、CPUID、时间检测） | `evasion-analysis` | [[re-anti-analysis]] / [[re-evasion]] |
| 动态注册 JNI、so 函数级加密 | `jni-analysis` | [[re-android-native]] |
| 混淆（CFF/花指令/字符串加密） | `deobfuscation` | [[re-deobfuscate]] |
| 网络回连/信标/C2 特征 | `network-capture` | [[re-netcap]] → [[re-behavior]] |
| 持久化/注入/进程树异常 | `malware-behavior` | [[re-behavior]] |
| 崩溃/段错误/ASAN 报告 | `debugging` | [[re-crash-triage]] |
| Python 打包特征（PyInstaller/PyArmor） | `bytecode-parser` | [[re-python]] |
| 加固商特征（Android 加固壳） | `unpack` | [[re-mobile-pack]] |
| RTTI/异常表（.pdata/.xdata）密集 | `decompilation` | [[re-cpp-abi]] |
| PDF/Office 宏/钓鱼文档特征 | `document-malware` | [[re-doc-malware]] |
| 补丁/N-day 对比需求（修复前后/变体） | `binary-diffing` | [[re-variant]] |
| 文件尾附加/图片异常（隐写怀疑） | `stego-detection` | [[re-stego]] |
| 白盒加密特征（大查表 + 编码网络） | `crypto-identification` | [[re-whitebox]] |
| 内核驱动/rootkit 结构 | `kernel-analysis` | [[re-kernel]] |
| 内存区被改成可执行（W→X / RWX）、无背书区域在执行 | `sample-acquisition` | [[re-sample-acquire]] |
| 服务端动态注册的组件无对应类文件（内存马特征） | `sample-acquisition` | [[re-sample-acquire]] → [[re-java]] |
| 整机内存镜像（LiME/崩溃转储） | `memory-forensics` | [[re-mem-forensics]] |
| 磁盘镜像/未分配空间/分区表异常 | `disk-forensics` | [[re-disk-forensics]] |
| 越狱检测/tweak（dylib 注入）特征 | `jailbreak-analysis` | [[re-ios-jb]] |
| Flutter/RN 引擎特征 | `hybrid-app-analysis` | [[re-hybrid-app]] / [[re-flutter]] |
| Go buildinfo/pclntab 特征 | `lang-runtime-analysis` | [[re-go]] |
| Rust/Swift/Zig/Nim 产物特征 | `lang-runtime-analysis` | [[re-rust]] / [[re-swift]] / [[re-zig]] / [[re-nim]] |
| MMIO 外设区 + Thumb 特征（嵌入式裸机固件） | `arch-analysis` | [[re-arm]] |
| RISC-V 压缩指令/MIPS 延迟槽特征 | `arch-analysis` | [[re-riscv]] / [[re-mips]] |
| VT-x/SVM 指令（VMXON/VMREAD）或 VMCS 结构 | `hypervisor-analysis` | [[re-hypervisor]] |
| BPF ELF section（.maps/.BTF/.rel*，kprobe/tracepoint 命名节） | `ebpf-analysis` | [[re-ebpf]] |
| VxWorks/QNX 特征串（任务表符号/内核对象命名） | `rtos-analysis` | [[re-rtos]] |
| 进程注册了 pathname 并循环收消息、无内核模块却控制硬件 | `rtos-analysis` | [[re-rtos]]（QNX 资源管理器模型） |
| 驱动既不是独立进程也不是内核模块（在网络栈进程内加载） | `rtos-analysis` | [[re-rtos]] → [[re-rtos/qnx]] |
| init/设备对象没有直接 xref、一段规则排列的结构体（链接期注册） | `rtos-analysis` | [[re-rtos/zephyr]] |
| 独立模块大量 unresolved symbols、同版本系统之间行为不一致 | `rtos-analysis` | [[re-rtos/vxworks]] |
| dlopen 语义不像 Unix 共享库、设备分派看不到 file_operations | `rtos-analysis` | [[re-rtos/rtems]] |
| 跨阶段数据结构找不到 producer、runtime 地址与固件地址对不上 | `uefi-analysis` | [[re-uefi/pi-stages]] |
| handle 数值跨进程比对无效、传送后原值失效、同驻驱动有 IPC 无系统调用 | `kernel-analysis` | [[re-kernel/zircon-kernel]] |
| init 函数没有调用者、一段指针数组所在 section 名为 set_* | `kernel-analysis` | [[re-kernel/freebsd-kernel]] |
| 驱动入口为 _init/_fini/_info + modlinkage/dev_ops/cb_ops 骨架 | `kernel-analysis` | [[re-kernel/illumos-kernel]] |
| .NSO/.NPDM 容器结构（Switch 加密分区） | `console-analysis` | [[re-console]] |
| asar 结构（resources/app.asar + 内部 files 树） | `electron-analysis` | [[re-electron]] |
| CAP 内 Header 组件魔数（DE CA FF ED，文件整体为 ZIP，Java Card 12 组件） | `bytecode-parser` | [[re-javacard]] |
| HarmonyOS hap/hsp 包结构、ArkTS .abc 字节码 | `bytecode-parser` | [[re-harmonyos]] |

## B 表：卡住信号 → 换路

| 卡住信号 | 换路 |
|---|---|
| 同参数重复 ≥2 次无新证据 | 对照 A 表重查 / 换工具视角（[[analysis-contract]] 调查预算） |
| 单命令 ≥3 次无进展 | 停下评估，重跑 re-analyze 第二步（任务识别）或换网关 |
| 分析跨目标累计超 30 次工具调用无结论 | 回退到最近有产出的环节，按 [[analysis-contract]] 复核格式交付部分结论 |
| 目标行为与静态结论矛盾 | 动态侧 [[re-sandbox]] / [[re-tracing]] 对照 |
| A 表命中的技能不适用（如目标形态不符） | 查 `capability-index.md` 同一能力下的其他技能（能力相同、形态不同） |

## 使用规则

1. 每产出新证据类型 → 查 A 表，命中即调用对应技能，完成后回到轨 1 继续
2. 每网关完成 → 查 A+B 表
3. 未命中任何表项 → 按 B 表约束行动（换思路/回退/交付部分结论）
4. 新增 A 表行时：先定「需要能力」（注册表标签），再用 `capability-index.md` 反查技能填入——**不要只写领域名技能**（`npm test` 会校验能力与技能声明是否对得上）
