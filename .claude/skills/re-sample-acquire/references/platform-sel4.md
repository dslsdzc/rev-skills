# seL4 平台分支：capability provenance（不是"扫描进程"）

seL4 上**观测模型与前三个平台根本不同**，因此方法不能翻译过来：这里**没有"root 枚举全系统进程、偷看别人内存"这回事**。

## 一、为什么不同

- **无 capability 即无访问权**：一切操作都必须由持有**不可伪造的 capability** 的线程发起。内核对象（TCB、VSpace、CNode、Endpoint、Notification、frame/page）全部是 capability 控制的资源
- 初始 **root task** 在启动时获得系统资源的 caps；此后资源通过 capability 派生/授予分发
- Microkit 的 **protection domain（PD）** 默认只有自己的 ELF/VSpace 与**显式授予**的资源（每个 PD = 自己的 CSpace + VSpace + TCB，入口点 `init`/`notified`/`protected`/`fault`）
- 因此"从一个被注入的 PD 内部往外看"与"从系统外扫面"这两条路都不成立——**能观察什么，完全由你持有的 capability 决定**

## 二、正确路线：构造期记录 provenance

不要做"扫描 → 猜哪个 PD 被注入"，而是**在系统构造期就让 security monitor 掌握 provenance**：

```
root task / system monitor
        ├── TCB caps（线程上下文）
        ├── frame/page caps（物理页来源）
        ├── VSpace 构造记录（谁映射了什么、什么权限）
        ├── 可执行页策略（哪些 frame 允许被映射为可执行）
        ├── fault endpoints（异常事件入口）
        └── loader provenance（ELF loader / 可信组件登记的镜像）
                    ↓
        execution provenance graph（可执行页 ← 来源 frame ← 映射者 ← 授权链）
```

- seL4 的**页映射本身就是显式的 capability invocation**：一个 frame/page 被映射进哪个 VSpace、以什么权限映射，都是系统构造过程的一部分，因此天然可记录
- 由此可回答前三个平台很难回答的问题：**"这个可执行页是谁创建的、来自哪个 untyped/frame、被映射进哪个 VSpace、谁持有映射权限"**
- 检测/采集逻辑（策略驱动，优于定时轮询）：

```
ELF loader / 可信组件登记合法可执行 frames
        ↓
出现任何新的可执行映射
        ↓
校验 frame provenance + capability 路径
        ↓
不合策略 → 阻止 / 触发 fault / 现场快照（snapshot）
```

## 三、提问方式的转变

- 前三个平台问："恶意代码藏在哪个进程里？"（事后从复杂共享系统里**恢复** provenance）
- seL4 上应该问：**"哪个 capability flow 让未授权代码获得了 executable authority？"**（provenance 在设计期就**保留**下来了）
- 这两条路线的对照本身很有价值：前三者是"事后重建"，seL4 是"设计即保留"——同一技能里并列，能覆盖两类系统的采集思路

## 四、可用的内核设施（前提：monitor 持有相应 cap）

- **TCB debug API**（硬件调试能力，需以 `-DHardwareDebugAPI=1` 构建；不支持的平台内核启动即 abort）：
  - `seL4_TCB_SetBreakpoint` / `seL4_TCB_UnsetBreakpoint` / `seL4_TCB_GetBreakpoint` —— 按虚拟地址设置**断点/观察点**（指令或数据、读/写/读写、范围）
  - `seL4_TCB_ConfigureSingleStepping` —— 单步（每 N 条指令中断一次；`num_instructions=0` 关闭），**每次触发都向该线程的 fault endpoint 发消息**，回复 fault 消息即继续执行
  - 这些 invocation 都要**指向目标 TCB 的 capability**——再次说明：能调试谁，取决于你持有什么
- **fault 是一等事件**：VM fault、debug fault 等按配置发送到**fault endpoint**；Microkit 中 PD 的 `fault` 入口由 monitor 的 fault handler 处理
- 监视器可据此把"异常执行"变成**事件驱动**（而不是采样扫描）

## 五、落地清单（按目标系统构造裁剪）

1. 确认系统构造：root task / monitor 结构、各 PD 的资源与通道（Microkit 的 system 描述文件是权威来源）
2. 收集 provenance 来源：loader 记录、VSpace 构造 invocation 记录、可执行页策略、fault endpoint 订阅
3. 定义"合法可执行页"集合（哪些 frame/VSpace/权限组合是构造期认可的）
4. 建立运行时校验：新可执行映射 → 回溯 frame provenance 与 capability 路径 → 判定
5. 处置：阻止（策略拒绝）/ 触发 fault 进入监视器 / 现场快照（保存涉事 frame 与映射记录）——**先取证再处置**
6. 记录输出按 [[re-analyze/analysis-contract]] 的字段（target_id 用系统/PD 标识；evidence 用 capability 路径与映射记录）

## 方法侧入口

本篇是**采集/监视视角**（假定你是有权限的一方，在系统构造期记录 provenance）。若目标是一个**已有的 seL4 系统**（要逆向它、理解它的对象图与 IPC 拓扑），走 [[re-kernel]] 的 [[re-kernel/sel4-kernel]] 分支——那边给的是"capability 系统怎么读、哪些现象不能按普通 OS 判"。

## 该平台的坑

- **套用前三平台的思路**：从"root 扫面"或"注入检测工具"出发在 seL4 上没有对应物——先明确"我持有哪些 capability"
- **把 seL4 当"Linux 的特殊版本"**：观测边界完全不同，方法要从 capability 模型重推
- **忽略构建期配置**：TCB debug API 需显式构建开关；不同平台支持度不同（不支持的平台内核启动即 abort）
- **只做周期性扫描**：capability 路径与 fault endpoint 本来就能给出事件与来源，定时轮询是退化用法
