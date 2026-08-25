# 技能库第四轮扩充（覆盖缺口波）设计

日期：2026-08-25
状态：已获用户批准（2026-08-25 逐节确认）

## 1. 总览

**目标**：补齐 8 个未覆盖领域——6 个新原子技能 + 2 处扩章，技能总数 112 → 118。

| # | 领域 | 形态 | 挂载点 |
|---|---|---|---|
| 1 | ARM 架构逆向（非 Android） | 新技能 re-arm | re-binary-core 子技能列表、re-fw-emulate、triage 固件行 |
| 2 | RISC-V 架构逆向 | 新技能 re-riscv | 同 re-arm |
| 3 | 现代主机与复古平台 | 新技能 re-console（含复古小节） | re-game 跨域、re-cracking |
| 4 | Electron 桌面 JS 应用 | 新技能 re-electron | re-managed 网关子技能列表、triage 托管行、re-browser-ext 跨域 |
| 5 | Java Card / SIM applet | 新技能 re-javacard | re-managed（Java 字节码族）、re-iot-proto 智能卡节、re-hardware-io |
| 6 | eBPF 程序逆向与对抗 | 新技能 re-ebpf | re-tracing / re-evasion / re-kernel 跨域、rerouting 表 |
| 7 | VxWorks/QNX/INTEGRITY | 扩 re-rtos（+3 章） | 触发词同步、跨域加 re-automotive |
| 8 | Windows 行为监控工具链 | 扩 re-behavior（+1 节） | 无挂载变更 |

**产出体量**：对标 re-mips 深度——每个新技能 SKILL.md 约 120-180 行，固定五节（何时使用/工具准备/操作步骤/跨域联合/常见坑与陷阱 ≥3），references/ 仅按需。

## 2. 全局约束

- **红线 1 呈现中性**：禁用「最推荐」「强烈建议」等最高级强推措辞
- **红线 2 隐私脱敏**：内容不指向具体项目/公司/产品；硬件类给泛化选购指引
- **不绑定具体工具**：方法为核心，工具为可替换示例；「工具准备」按模板给跨 OS 安装命令（Linux/macOS/Windows/WSL 分支），仅 Windows 工具注明跨 OS 约束
- **validate.mjs**：frontmatter `name`=目录名、`description` 非空（中英触发词）、`type: atomic` 必含「## 工具准备」、`[[链接]]` 必须解析（技能目录或 references/*.md）；新技能先于引用它的同步任务，避免中间态死链
- **commit 纪律**：每任务 commit 只 `git add` 本任务列出的文件，严禁 `git add -A`
- 当前分支 `main`；`npm test` 预期按任务标注递增（112 → 118）

## 3. 新技能设计

### 3.1 re-arm —— ARM 架构逆向

- **何时使用**：非 Android 场景 ARM——嵌入式裸机/固件（Cortex-M0/M3/M4/M7、Cortex-A）、Thumb/ARM 切换、AAPCS 调用约定、M 系向量表、位置相关代码重定位
- **何时不用**：Android `.so` 走 re-android-native；通用 AArch64 Linux 用户态走 re-binary-core
- **工具准备**：Ghidra/IDA（Thumb 支持）、`readelf`/`file`、`qemu-arm`/`qemu-aarch64`（用户态仿真）、`gdb-multiarch`、binwalk（联动 re-fw-extract）
- **操作步骤**：① 架构与字节序确认（`file`/`readelf -h`）② 入口定位（M 系向量表 0x0 起 4B/项、reset handler 在第 2 项；A 系启动代码）③ Thumb 函数边界（BL 目标奇地址、veneer、`bx` 切换点）④ 基址/重定位（flash 加载地址 vs 链接地址偏移修正）⑤ AAPCS 识别（r0-r3 传参、`push {r4-lr}` 栈帧、HFABI 硬浮点变体）⑥ 外设寄存器 xref（0x4000xxxx MMIO 区、`LDR rN,[pc,#imm]` 立即数池）
- **坑（≥3）**：Thumb 奇地址函数起点误判；BL/BLX ±32MB 范围外 veneer 混淆；M 系外设映射区当数据段；R14 双用途反编译失真；HFABI 与软浮点混用时参数解读错误

### 3.2 re-riscv —— RISC-V 架构逆向

- **何时使用**：RV32/RV64、压缩指令（RVC）、嵌入式（ESP32-C3 类）与 Linux 用户态
- **何时不用**：工具链极端定制且无头绪时先走 re-fw-emulate 仿真兜底
- **工具准备**：Ghidra（RISC-V 支持成熟）、`qemu-riscv64`/`qemu-riscv32`、binutils 交叉工具链（`riscv64-unknown-elf-objdump`）、readelf
- **操作步骤**：架构确认（RV32/RV64 + 字节序）→ reset/入口定位 → RVC 压缩指令识别（2/4 字节混合，勿固定宽度切割）→ gp 相对寻址恢复（`lui+addi` 对、.sdata/.sbss）→ ABI 识别（整数/浮点 ABI、a0-a7 约定）→ 系统调用边界（`ecall` + a7 号）→ 生态指纹（工具链/库函数特征）
- **坑（≥3）**：压缩指令流按 4 字节切割全错；gp 全局指针缺失致数据访问散乱；`la`/`li` 伪指令展开形态多变；`ecall` 系统调用号绑定 ABI、无 OS 时为自定义语义；链接器 relax（R_RISCV_RELAX）影响反汇编边界

### 3.3 re-console —— 现代主机与复古平台逆向

- **何时使用**：现代主机（Switch NPDM/NSO/加密分区、PS4/PS5 ORBIS、Xbox 系）与复古平台（NES/GB/SNES/GBA/PSX ROM 头、卡带格式、存档/Cheat 码）
- **何时不用**：PC 端 Unity/Unreal 走 re-game；改机/盗版操作受授权边界约束（「何时不用」显式声明合规边界）
- **工具准备**：Ghidra/IDA + 平台容器工具（hactoolnet 类 NSO/NPDM 解析、ORBIS 解析脚本，实现时核实工具名与可用性）、模拟器调试器（mGBA/no$psx 类）、卡带读取器（泛化选购指引）
- **操作步骤**：容器识别 → 容器解析（分区/加密边界区分）→ 代码段提取进通用反编译 → SDK 库指纹 → 补丁差异（联动 re-variant）→ 复古：存档/Cheat 格式（内存地址+值模式）
- **坑（≥3）**：加密容器当明文解；SDK 指纹误判；ND 头与正文分离；模拟器与真机行为差异；授权边界声明

### 3.4 re-electron —— Electron 桌面应用逆向

- **何时使用**：Electron/asar 应用——asar 解包、主/渲染进程 JS、V8 字节码（`.jsc`）、动态 CDP（`--inspect`）、`ELECTRON_RUN_AS_NODE`
- **何时不用**：纯浏览器扩展走 re-browser-ext；混淆 JS 走 re-script-deob
- **工具准备**：`npx asar extract` 类、Node/Electron 版本识别、CDP 客户端（chrome-remote-interface 类）、strings、通用反编译器（原生模块）
- **操作步骤**：识别 Electron（目录/version 文件）→ asar 提取 → 主进程入口 → 渲染进程混淆 JS（联动 re-script-deob）→ 原生模块 `.node`（联动 re-format-elf）→ 动态 CDP → 反调试对抗（devtools 检测，联动 re-evasion）
- **坑（≥3）**：`.jsc` 是 V8 快照非普通 JS（解析/反编译边界注明限制）；asar 内路径混淆；`ELECTRON_RUN_AS_NODE` 行为差异；contextIsolation/sandbox 影响注入面；fuses 配置改变运行能力

### 3.5 re-javacard —— Java Card / SIM applet 逆向

- **何时使用**：Java Card applet——CAP 文件组件解析（规范 12 组件，tag 1-12：Header/Directory/Applet/Import/ConstantPool/Class/Method/StaticField/ReferenceLocation/Export/Descriptor/Debug；实现时以 Oracle JC VM 规范为准——设计初稿「九组件」遗漏 StaticField/ReferenceLocation，已 errata 见文末）、CAP 字节码（Java 子集+卡片扩展指令，四类 invoke 齐备含 invokevirtual 0x8B——设计初稿「无 invokevirtual 等」断言错误，已 errata）、AID 与安装参数、SIM/USIM/银行卡 applet
- **何时不用**：APDU 协议层与 MIFARE/DESFire 物理层走 re-iot-proto；CAP 获取依赖读卡（re-hardware-io）或固件提取（re-firmware）
- **工具准备**：CAP 解析（开源解析器或自写 Python 脚本）、Ghidra/IDA 无原生 CAP 支持（脚本化解析）、`javap` 类对照（字节码差异说明）、读卡器（泛化选购指引 + 授权边界）
- **操作步骤**：CAP 来源（EEPROM dump/固件/资料）→ Directory 组件偏移表驱动解析 → Method 组件方法体还原 → Import/常量池跨组件引用解析 → Applet `process(APDU)` 入口（CLA/INS 分派表）→ 与 APDU 交互对照（联动 re-iot-proto）
- **坑（≥3）**：组件偏移表错误致全文件错位；Import 外部引用（跨 CAP 依赖）；字节码子集与 JVM 差异（无 invokevirtual 等）；卡片 dump 访问控制；AID/安装参数影响行为分支

### 3.6 re-ebpf —— eBPF 程序逆向与对抗分析

- **何时使用**：BPF-64 指令集、progs/maps 关联、加载链、BCC/libbpf/手工字节码三种来源；用途三分——跟踪取证（bpftrace/bcc 还原）、恶意 eBPF（内核驻留/规避）、EDR 对抗（bpf hook）
- **何时不用**：经典内核模块（.ko 驱动）走 re-kernel
- **工具准备**：`bpftool`（`prog dump xlated`/`feature`）、`llvm-objdump -d bpf`、pyelftools（ELF section 定位）、专用逆向工具（如 bpf-gazelle 类，实现时核实工具名与可用性）、受控环境（联动 re-sandbox）
- **操作步骤**：定位载体（ELF `.text`/`.maps`/`.BTF` 或运行期 dump）→ 反汇编（原始或 `xlated`）→ progs/maps 关系还原 → hook 点识别（kprobe/tracepoint/cgroup 等 attach 类型）→ 语义还原（helper 调用号→内核 API，联动 re-kernel）
- **坑（≥3）**：BTF 缺失类型盲区；verifier 重写后 `xlated` 与源码不对应（bpf2bpf 内联/尾调用）；helper 调用号随内核版本漂移；map 与 prog 分离；无符号库函数匹配

## 4. 扩章设计

### 4.1 re-rtos + VxWorks/QNX/INTEGRITY（+3 章）

每章同构于现有四章（TCB/内核对象关键字段 → 定位方法 → 特征串）：

- **VxWorks**：WIND_TCB（任务名表、栈指针、优先级字段）、VxWorks 7 结构变化、任务名串特征定位
- **QNX**：线程控制块（procnto 微内核）、MsgSend/MsgReceive 消息传递调度链、车机中控场景联动 re-automotive
- **INTEGRITY**：分区（partitions）内存布局、任务/进程表结构、航电/工业场景特征

同步：frontmatter 触发词加 VxWorks/QNX/INTEGRITY；跨域联合加 `[[re-automotive]]`；「何时使用」扩一句商业 RTOS 场景。

### 4.2 re-behavior + 行为监控工具链（+1 节）

- **ProcMon**：过滤/标注/CSV 导出关联（进程→文件→注册表→网络时间线）、过滤语法要点
- **API Monitor**：API 级 hook 链与调用参数记录（与 re-tracing 的 strace/ltrace 形成 Windows 侧对应）
- **ETW**：会话与事件解析（logman/wevtutil 命令；采集侧视角，与 re-evasion 的绕过侧互补）
- **Process Explorer**：进程树/句柄/签名验证视图要点
- 仅 Windows 工具注明跨 OS 约束（Linux 侧对应走 re-tracing）

## 5. 挂载与同步清单

1. `re-analyze/references/triage.md`：路由表补分支——固件行（ARM/RISC-V 分流）、托管行（Electron/Java Card）、游戏行（re-console）；按实际表格逐行核对
2. `re-analyze/references/rerouting.md`：A/B 证据→技能表补行（`.NSO/NPDM`→re-console、BPF ELF section→re-ebpf、CAP 文件头→re-javacard、asar 结构→re-electron、VxWorks/QNX 特征串→re-rtos、MMIO 外设区→re-arm 等）
3. 网关子技能列表：re-binary-core 补 `[[re-arm]]`/`[[re-riscv]]`（对标 `[[re-mips]]` 行）；re-managed 补 `[[re-electron]]`/`[[re-javacard]]`；re-game 补跨域 `[[re-console]]`；re-iot-proto 补跨域 `[[re-javacard]]`
4. 计数同步：README / AGENTS.md / marketplace.json 技能数 112 → 118（逐字段核对，有计数则同步）
5. 新技能创建后 `npm test` 预期输出按任务标注递增

## 6. 任务顺序与验证

- **任务顺序**：新技能（6 个）→ 扩章（2 个）→ 挂载同步 → 计数同步 → 终审修复波；新技能先于引用它的同步任务
- **每任务**：实现 → 技术事实核对 + 红线对照 → `npm test` → commit（只 add 本任务文件）
- **终审波**：全库交叉引用去重、计数一致性、死链清零、技术断言复核
- **最终验证**：`node validate.mjs` 输出 `OK: 118 skills validated`；`npm test` 全绿（22 单测不受影响）

## 8. Errata（2026-08-25 实施期修正）

- **§3.5 CAP 组件数**：初稿「九组件（Header/Directory/Import/ConstantPool/Class/Method/Descriptor/Export/Applet）」有误——Oracle Java Card 3.2 VM 规范为 12 组件（tag 1-12），遗漏 StaticField(8)/ReferenceLocation(9)；正文与 re-javacard SKILL.md 已按规范修正，description 改为「规范 12 组件」。
- **§3.5 字节码断言**：初稿「无 invokevirtual 等」有误——JCVM 四类调用指令齐备（invokevirtual 0x8B/invokespecial 0x8C/invokestatic 0x8D/invokeinterface 0x8E），真实 CAP 实证含 invokevirtual；与 JVM 的差异为无 invokedynamic/multianewarray/monitor 等。正文与 SKILL.md 已修正。
