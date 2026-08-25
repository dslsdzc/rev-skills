---
name: re-tee
description: >
  TEE/TrustZone 逆向：OP-TEE 架构、可信应用（Trusted App）、secure storage、SMC 接口与设备密钥。
  触发词：TEE、TrustZone、OP-TEE、可信应用、Trusted App、secure world、SMC、安全存储、secure storage、设备密钥
---

# TEE / TrustZone 逆向（OP-TEE / Trusted App / secure storage）

## 何时使用 / 何时不用

- 用：TrustZone/OP-TEE 类 TEE 分析——可信应用（Trusted App）逆向、命令分发表还原、secure storage（安全存储/设备密钥）对象与数据流
- 用：设备密钥/信任根方向——DRM 硬件信任根（[[re-drm]] 的 L1 类）、设备密钥提取与保护机制（授权研究）
- 用：TEE 接口面——SMC 调用、主机侧 TEE 驱动 ioctl、client 库调用序列还原
- 用：固件安全评估——评估目标设备 TEE 实现的接口暴露面、存储保护强度与信任根边界
- 不用：普通 App 层（走 [[re-mobile]]）；Windows 内核/驱动（走 [[re-kernel]]，TEE 侧是 Linux/ARM 域）
- 不用：纯固件提取解包（先走 [[re-fw-extract]]，本技能在其后分析 TEE 组件）
- 不用：目标只是普通加密数据（走 [[re-crypto-*]] 系列，无 TEE 组件时不必进本技能）
- 不用：EL2 hypervisor/虚拟化域（走 [[re-hypervisor]]，TEE 是 EL1/EL3 域）
- 注意：**secure world 内动态调试通常不可行**（见坑 3）——默认静态分析 + 主机侧观察；主机侧动态执行按 [[platform-tips]] 最高原则在沙箱内进行

## 工具准备

静态分析（镜像解析/反编译）免沙箱；主机侧动态（跑 client、hook ioctl）按 [[platform-tips]] 最高原则进沙箱；secure world 内动态不做（见坑 3），默认以静态 + 主机侧观察为主。

### 反编译工作台（[[re-ghidra]] / [[re-ida]]，ARM64）

- [[re-ghidra]]（默认）：导入 TEE OS 镜像与 TA（.ta 需先切掉签名头，见步骤 2 与坑 5）
- [[re-ida]]：备选；两者均需 ARM64 支持
- 验证: 能反编译 ARM64 代码，定位 `smc` 指令调用点与 `TA_InvokeCommandEntryPoint` 类分发表

### 固件提取工具链（[[re-fw-extract]]）

- binwalk/unblob、magic 扫描、字节序判断——从 bootrom/启动链/设备固件中定位并提取 TEE OS 与 TA 镜像
- 验证: `binwalk --version`（安装命令见 [[re-fw-extract]]「工具准备」）

### python3（二进制解析/脚本）

- Linux: `apt install python3` / `dnf install python3` / `pacman -S python`；macOS: 自带；Windows: 官方安装器或 `choco install python`
- 验证: `python3 --version`
- 用途: 签名头/ELF 载荷切分解析、结构字段标注、解密还原脚本（衔接 [[re-crypto-decrypt]]）

### 参考实现（OP-TEE 官方开源，理解结构用）

- 官方仓库 optee_os / optee_client / optee_examples（与 qemu 仿真环境）提供 TEE 结构与调用序列的权威参照——分析目标与 OP-TEE 差异时按官方源码核对，不凭经验值
- qemu 仿真环境可跑通 client → TA 全链路调用，用于对照调用序列与参数布局；仿真与真机的差异（真实驱动/中断/存储介质）以真机为准

### frida / 主机侧观察（[[re-frida]]）

- 主机侧动态：hook client 库调用序列与 ioctl 参数（frida 安装与沙箱原则见 [[re-frida]]，动态执行默认沙箱）
- 验证: `frida --version`

## 操作步骤

按顺序执行，每步产物（镜像定位、头结构标注、命令号表）记录证据路径 + sha256（见 [[re-triage]]），供报告引用。

1. **架构定位（world 划分 / SMC / TEE OS 入口）**：
   - TrustZone 划分 normal world（普通世界，NS）与 secure world（安全世界，S）；ARMv8-A 中 TEE OS 通常运行在 secure EL1，可信应用在 secure EL0，EL3 监控层（monitor）承载安全监控固件（如 ATF BL31 类启动固件，泛化）
   - **SMC 指令**是 normal world 进入 secure world 的通道：AArch64 为 `smc #imm`（AArch32 为 `smc`），从 EL1/EL2 执行即陷入 EL3 监控层，监控层再分发给 TEE OS；反编译中搜 `smc` 指令即调用面落点
   - SMC 参数约定（SMCCC）：功能号在 w0（含服务/调用约定标识位），参数在 w1-w7（SMC32）或 x1-x17（SMC64），返回值从 w0 起——标注调用点按约定表读寄存器，不按普通 ABI 猜（见坑 4）
   - 特征侦查：版本字符串、导出 API 字符串表、SMC 功能号常量表先 grep 定位——字符串表往往直接给出 TEE OS 类型与版本，比逐个反编译快
   - 定位 TEE OS 加载入口：bootrom → 启动固件 → TEE OS 镜像（镜像头 magic、加载/验签代码）——沿启动链搜 TEE 镜像特征（镜像头魔数、版本字符串、导出 API 字符串表）；TEE OS 也可内嵌于设备固件分区（[[re-fw-extract]] 提取后定位）
   - 产物：world/EL 划分图 + TEE OS 镜像位置与加载入口

2. **OP-TEE 结构（core 与 TA 分离、.ta 格式）**：
   - core（可信 OS 内核，secure world 侧系统服务）与 TA（可信应用，secure world 用户态）分离；core 向 TA 提供 `TEE_*` 内部 API（密码学、secure storage、时间等），TA 依赖该 API 实现业务逻辑——分析 TA 前先确认 core/TA 边界（谁提供 API、谁调用 API）
   - **.ta 文件格式**（REE 文件系统 TA）：文件 = 签名头 + ELF 载荷。签名头（`struct shdr`，官方 core/include/signed_hdr.h）：magic（`0x4f545348` = "OTSH"）、img_type、img_size、algo、hash_size、sig_size，其后跟 hash 与签名；img_type 取值：0 明文签名 TA / 1 bootstrap TA（带 UUID+版本子头）/ 2 加密 TA / 3 子密钥链式头；加密变体（img_type=2）后跟 `shdr_encrypted_ta` 子头（enc_algo、flags、iv_size、tag_size + iv + tag），密文为 AES-GCM
   - 解析流程：文件头 magic 定位签名头 → 按 img_size 切出 ELF 载荷 → [[re-format-elf]] 解析节表/段 → 标注 `ta_head`（UUID、版本、flags 等；UUID 即 TA 接口标识，与主机侧调用的 UUID 对应）
   - 扩展名不作依据：部分设备以 .tos/.trusted 类扩展名分发 TEE OS/TA——一律按 magic 判断格式，不按扩展名选解析器
   - 产物：签名头字段标注 + 切出的 ELF 载荷 + ta_head/UUID 记录

3. **TA 分析（入口 / 命令分发 / secure storage）**：
   - 入口链：`TA_CreateEntryPoint`（初始化）→ `TA_OpenSessionEntryPoint`（会话建立）→ `TA_InvokeCommandEntryPoint`（命令分发，按 cmd_id switch）——**命令分发表就是 TA 的对外接口目录**，逐分支标注命令号与行为
   - 参数模型：invoke 携带参数类型描述与最多 4 个 `TEE_Param`（value 标量对 / memref 内存引用两类）；memref 指向共享内存，是输入输出主通道——每个命令分支标注参数类型与结构
   - 命令号枚举：switch 分支逐一编号（含非法命令/默认分支）；与主机侧调用面（步骤 4）对照，确认哪些命令真实可达、哪些是内部使用——可达命令是接口面/攻击面主体，标注优先级
   - **secure storage 对象操作**：定位 `TEE_*` 存储 API 调用点（对象创建/打开/读/写/定位/删除类），还原对象 ID（常由 UUID + 对象名/索引派生）与数据流；secure storage 密文最终落盘于普通世界文件系统（经 tee-supplicant）或硬件存储（RPMB 类，硬件侧见 [[re-hw-chip]]）——找到密文文件的解密路径即找到对象数据
   - 落盘形态：REE 文件系统侧通常为索引文件 + 数据块文件组合（对象目录映射）——按索引找对象、按块定位密文，再还原对象内容
   - 产物：命令号→行为表 + 参数结构标注 + secure storage 对象清单

4. **主机侧调用面（ioctl / client 库，两头夹逼）**：
   - Linux 侧 TEE 子系统：`/dev/tee0`（客户端 libteec 使用）上的 `TEE_IOC_*` ioctl（打开会话、invoke、关闭会话、共享内存分配/注册类）；`/dev/teepriv0` 归 tee-supplicant（特权守护进程）使用，不做客户端调用——别把 teepriv0 当「私密会话」通道（见 [[gotchas]]）
   - 用户态 client 库调用序列（GlobalPlatform TEE Client API）：`TEEC_InitializeContext` → `TEEC_OpenSession`（带 UUID 与参数）→ `TEEC_InvokeCommand`（带命令号与 TEEC_Operation）→ `TEEC_CloseSession` → `TEEC_FinalizeContext`
   - **夹逼法**：主机侧读 ioctl 参数（UUID、命令号、参数布局、共享内存内容）→ TA 侧分发表（步骤 3）对号入座——两侧都标注后，TA 输入输出格式即可闭合；一侧缺失时从另一侧反推（见坑 2）
   - 动态观察（沙箱内）：frida hook client 库调用与 ioctl 参数（[[re-frida]]），记录会话打开、命令调用序列与缓冲区内容
   - 日志侧：`dmesg` 中 tee 驱动与 OP-TEE 初始化日志（驱动版本、中断号、supplicant 状态）辅助指纹与版本判定
   - 产物：主机侧调用序列 + TA 接口对照表（UUID/命令号/参数布局一一对应）

5. **厂商差异处理（自定义 TEE，泛化）**：
   - 自定义 TEE 的差异点：SMC 功能号体系、TA 镜像格式（头结构/签名/加密方式）、secure storage 布局、导出 API 命名与语义——均可能与 OP-TEE 不同
   - 思路：先指纹识别 TEE 类型（镜像头特征、字符串/导出 API 特征、SMC 功能号模式）→ 确认是 OP-TEE 系还是自定义实现 → 按通用流程（架构定位 → 格式解析 → 接口枚举 → 调用面夹逼）逐层套用，OP-TEE 细节只作参考模板不当默认值
   - 差异处理：结构对不上的地方先怀疑"自定义扩展"（新增字段/重排/魔数不同），记录差异点而非强行套用；拿不到格式文档时用「字段长度 + 常见值（UUID/版本/尺寸）」反推布局（[[re-proto-rev]] 思路）
   - 反推对照：命令号与行为的对应可用「返回码 + 输出缓冲区内容」逐条比对确认——错误码语义往往暴露参数校验顺序与权限边界
   - 产物：TEE 类型指纹 + 差异点清单

## 跨域联合

- [[re-fw-extract]]：TEE OS/TA 镜像提取与解包前置（bootrom/启动链/固件分区）
- [[re-binary-core]]：镜像反编译底座（[[re-format-elf]] 解析 TA ELF、[[re-ghidra]]/[[re-ida]] 工作台）
- [[re-kernel]]：主机侧 TEE 驱动分析（ioctl 分发、驱动加载，Linux 内核侧）
- [[re-mobile]]：移动端 TEE 集成面（App 内 TEE 调用、DRM 集成，与主机侧调用面衔接）
- [[re-hw-chip]]：secure storage 硬件侧（RPMB 类存储、信任根、物理防护机制）
- [[re-frida]]：主机侧动态观察（client 库/ioctl 插桩，沙箱原则）
- [[re-drm]]：设备密钥/硬件信任根方向（DRM L1 类信任根在 TEE 内）
- [[re-crypto-decrypt]]：加密 TA 载荷/secure storage 密文的解密还原
- [[re-sandbox]] / [[platform-tips]]：主机侧动态执行隔离最高原则

## 常见坑与陷阱

- **TA 是签名（+加密）镜像，直接分析会失败**：现象——拿到 .ta 直接丢进反编译器，导入失败或全是乱码；原因——.ta = 签名头 + ELF 载荷（加密变体还是 AES-GCM 密文），文件头不是 ELF 头；对策——先按签名头 magic（如 "OTSH"）定位并切出载荷（步骤 2），加密变体先还原解密流程（[[re-crypto-decrypt]]）拿到明文 ELF 再分析；验签/解密流程本身也是分析对象（信任根/密钥在 core 侧）
- **secure world 代码拿不到时用主机侧反推**：现象——TEE OS/TA 固件提取不到（SoC 内部 ROM/受保护存储），secure world 动态无从下手；原因——TEE OS 常内置或受保护，不随用户区固件分发；对策——主机侧 ioctl（`TEE_IOC_*`）调用面 + client 库调用序列记录 UUID/命令号/参数布局（步骤 4），结合返回行为反推 TA 接口与内部逻辑，静态证据不足时以调用面证据为主
- **secure world 防 dump/监测机制**：现象——附加调试无效、内存 dump 出不来或内容异常、运行行为与静态分析不符；原因——TEE 侧有反调试与完整性保护（调试口熔断、安全监测、防转储机制，泛化）；对策——不做 secure world 内动态调试，以静态 + 主机侧观察为主；行为差异记录为「TEE 侧监测触发」证据并标注置信度，不强行归因
- **SMC 参数约定错误导致误读**：现象——把 SMC 调用点当普通函数调用，按普通 ABI 猜寄存器参数，反推的接口结构全错；原因——SMC 遵循 SMCCC 约定（功能号 w0，参数 w1-w7 / x1-x17，返回值从 w0 起），与普通 ABI 不同，错位解读整条数据流错乱；对策——先按公开调用约定建表（功能号编码、参数寄存器布局、返回约定），再标注反编译中的 `smc` 调用点，参数含义以约定表为准不靠猜（见 [[gotchas]] 调用约定组）
- **把签名头/ta_head 当 ELF 头解析**：现象——按 ELF 头解析 .ta 失败（e_ident 对不上）、或把 ta_head 的 UUID 当字符串表；原因——.ta 文件头是签名头（ELF 头在载荷内），ta_head 是 ELF 内部首段结构而非文件头；对策——先按签名头字段（magic/img_size）切出 ELF 载荷再走 [[re-format-elf]]；Ghidra/IDA 导入前先用脚本剥离签名头（步骤 2 产物存档）
- **自定义 TEE 套用 OP-TEE 细节**：现象——按 OP-TEE 的头结构/命令模型分析自定义 TEE，字段全错位、接口对不上；原因——自定义 TEE 的格式与约定不同（镜像头、SMC 功能号、存储布局各异）；对策——先做 TEE 类型指纹（步骤 5），确认体系后再选分析模板；差异按「字段长度 + 常见值（UUID/版本/尺寸）反推布局」处理（[[re-proto-rev]] 思路），OP-TEE 结构仅作参考
- **UUID 对不上别硬凑**：现象——主机侧调用的 UUID 在 TA 分发表里找不到；原因——固件包内多个 TA 版本并存、或 TA 镜像版本与系统不匹配（UUID 是接口标识，版本演进会换 UUID）；对策——按固件包内 TA 清单/目录核对版本，逐个候选 TA 匹配 UUID 与命令号
- **secure storage 密文找不到就当没数据**：现象——REE 文件系统侧找不到 secure storage 密文；原因——存储介质在 RPMB/硬件侧，或落盘路径与默认不同（tee-supplicant 配置）；对策——先确认存储介质与 supplicant 配置（REE FS vs RPMB），RPMB 侧转 [[re-hw-chip]] 思路，不以「找不到」下无数据结论
- 决策分支（镜像形态/接口面/证据分级）见 [[decision-tree]]；格式与调用约定边界见 [[gotchas]]
