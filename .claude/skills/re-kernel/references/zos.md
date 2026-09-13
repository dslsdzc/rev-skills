# z/OS：TCB·SRB / 三个地址空间 / load module 与 LE / AMODE·RMODE·XPLINK

<CORE RULE>
z/OS **不能直接套 process + thread 模型**。可调度的工作单位有两类，地址空间不止一个，**而且程序自身还有一套"我能在哪种寻址模式下跑、我住在哪里"的属性**：

```
可调度单位：TCB / SRB
地址空间：home / primary / secondary
程序属性：AMODE / RMODE（+ XPLINK 与否）
```

三者叠在一起，才会出现：

```
当前执行地址属于另一个地址空间     → 不能自动判控制流劫持
同一个模块在两种调用约定下栈行为相反 → 不能自动判栈损坏
```
</CORE RULE>

## 一、两种可调度单位

| | TCB | SRB |
|---|---|---|
| 代表 | 在地址空间中执行的任务 | 运行系统服务例程的请求 |
| 典型产生 | 用户程序与支持它们的系统程序 | 一个地址空间检测到影响**另一个**地址空间的事件 |
| 归属 | home 地址空间包含该 TCB | 与 ASCB（局部 SRB）或主调度器（全局 SRB）对齐 |
| 能力 | 常规任务语义 | **总在 supervisor state**；**不能调用 SVC（除 ABEND）或 WAIT**；可跨内存/AR 模式运行、发出 PC、调度另一个 SRB |

- **SRB 提供地址空间间通信的异步机制**（同步对应物是带访问寄存器的 cross-memory services）
- **PC（PROGRAM CALL）指令要求可调度工作单位以 TCB 或 SRB 形式存在**

**所以**：没有传统"线程创建图"的执行代码不一定是异常。

## 二、三个地址空间：home / primary / secondary

- 程序首次被调度时，**home 与 primary 相同**
- **home 是该 TCB/SRB 最初被调度的地址空间，在整个执行期间保持不变**；**`PSAAOLD` 总是指向 home**（硬件不会改它）
- **primary**：取其段表来取指令的地址空间；**secondary** 用于 secondary ASC 模式下的数据访问
- 取指规则：primary/secondary/AR 模式从 **primary** 取指；home 模式从 **home** 取指；real 模式从实存取指

## 三、PC 指令与空间切换

- **PC-SS（空间切换）**：被切到的地址空间成为 **primary**，secondary 通常设为原 primary，**home 不变**
- **PC 例程始终运行在发出 PC 的那个 TCB/SRB 之下**
- 两种链接方式：**basic PC**（手动机保存/恢复调用者环境，用 PT 返回）与 **stacking PC**（系统把环境保存在 linkage stack 上，用 PR 返回）
- PC 通过入口表与链接索引定义；PC 号由链接索引与入口表索引拼接

## 四、AR（访问寄存器）模式

- 每个通用寄存器配一个 AR；放进 AR 的 **ALET 标识目标地址空间**
- **特殊 ALET：0 = primary、1 = secondary、2 = home**
- AR 模式可与最多 16 个地址空间通信，**并且可以调用 SVC**（这是它优于 basic cross-memory 的地方）

## 五、约束与经典故障

- **cross-memory services 需要 APF 授权**；远端地址空间**必须 non-swappable**
- **跨地址空间使用 TCB 指针是经典的 S0C4-11 成因**——TCB 在不同地址空间中**不在同一虚拟地址**
- 在跨内存模式（primary ≠ home）下，工作单位的用户身份取自 **home ASCB 或 TCB/SRB**

## 六、可执行材料：load module / program object

| 形态 | 说明 |
|---|---|
| **load module** | 传统链接编辑产物 |
| **program object** | 更新的形态，可住在 **PDSE** 里；**z/OS UNIX 的 load module 住在 PDS 里** |
| 链接 | 链接编辑 / program binder；链接库列表决定解析来源 |

**AMODE / RMODE（每个程序对象都带）**：

- **AMODE**：程序支持哪种硬件寻址模式——24 / 31 / **ANY** / **64**
- **RMODE**：程序对象**住在哪里**——24（16 MB 以下）/ **ANY**（以下或以上）
- **程序对象与运行中的程序各自都有 AMODE 属性**；语言运行时选项与编译器选项共同影响 AMODE/RMODE 行为与存储位置
- 某些场合下 AMODE 24 执行受限，必须用 31

**XPLINK 与非 XPLINK 的差异（判栈/调用约定时的关键）**：

| | XPLINK | 非 XPLINK |
|---|---|---|
| 栈增长方向 | 向上 | 向下 |
| 栈展开 | **BACKCHAIN** 编译子选项 | backchain 指针 |
| 栈指针 | GPR4，**带 0x800 偏置** | 常规 |
| 参数传递 | 参数在寄存器/调用者的 DSA 中（STOREARGS） | R1 指向参数列表 |

- 运行时会在 XPLINK ↔ 非 XPLINK 之间**自动插入衔接代码**；**两者之间的转换仅支持 31 位**情形
- 转换可用专门的跟踪选项观察（跟踪项类型区分入口/出口）
- **不支持**的路径包括：COBOL 动态调用 XPLINK 函数、某些语言的 FETCH、部分加载服务

**逆向含义**：**同一份代码在两种约定下栈行为相反**——看到"栈向上长"或"栈指针带偏置"不要判损坏，先确认它是不是 XPLINK。

## 七、supervisor services 与 SVC

- 系统服务经 **SVC** 与中断处理程序提供；**SVC 表**是定位系统服务入口的落点
- 与 SVC 相关的是 `SVC` 类型的 dump（与 standalone dump 并列）
- **PC 表**（程序调用入口表）同样是可定位的静态结构

## 八、诊断与 dump

- **dump 类型多种**（含 SVC dump、standalone dump），由 dump 管理机制产生
- **IPCS** 是**离线分析 dump 的工具**：定义/选择 dump、一系列 dump 命令；配合 **SLIP**（自动化的诊断动作）与 **GTF**（跟踪）使用
- **XPLINK 下控制块比 31 位更少**，因此 **IPCS 的 LEDATA 视图尤其重要**：它能给出 traceback 与 DSA 层次（与语言运行时提供的 dump 服务同类）
- 语言运行时另提供 dump/traceback/SNAP 类服务与跟踪表工具
- **跟踪表内容以 EBCDIC 呈现**；运行时也提供 ASCII/EBCDIC 字符模式切换服务

**逆向含义**：拿到一个现场，先确认 **dump 类型**与"是否 XPLINK"——后者决定你该去找哪些控制块、以及 traceback 从哪里取。

## 九、字符与记录模型

- **字符是 EBCDIC**（不是 ASCII）——字符串常量、日志、跟踪表都按此处理
- **记录模型**：数据集结构、记录格式、VSAM 属于 z/OS 数据管理的独立一套概念，**不要套 POSIX 字节流文件**

## 决策树

```
拿到 z/OS 目标
├─ 执行单位是什么
│    ├─ TCB（地址空间内的任务）还是 SRB（系统服务请求）
│    ├─ SRB 不能调 SVC（除 ABEND）、不能 WAIT
│    └─ 没有线程创建图 ≠ 异常
├─ 地址对不上
│    ├─ 区分 home / primary / secondary
│    ├─ PC 之后 primary ≠ home 属正常，home 不变
│    └─ 取指来自 primary（home 模式除外）
├─ 栈行为反常
│    ├─ 先确认是不是 XPLINK（栈向上长、栈指针带 0x800 偏置）
│    ├─ XPLINK ↔ 非 XPLINK 转换仅限 31 位，且需要衔接代码
│    └─ 别把两种约定的差异判成栈损坏
├─ 程序装不进/跑不起来
│    ├─ 查 AMODE（24/31/ANY/64）与 RMODE（24/ANY）
│    └─ 程序对象与运行中程序的属性都要看
├─ 跨地址空间传数据
│    ├─ basic cross-memory（需 APF 授权，远端须 non-swappable）
│    └─ 或 AR 模式（ALET 0/1/2；可调 SVC）
├─ 出现 S0C4-11 一类故障
│    └─ 查是否跨地址空间用了 TCB 指针
├─ 现场诊断
│    ├─ 确认 dump 类型；XPLINK 下控制块更少 → 依赖 LEDATA
│    └─ 字符按 EBCDIC 读
└─ 数据访问
     └─ 记录模型（数据集/记录格式/VSAM）≠ POSIX 字节流
```

## 工具与验证

- 执行单位：TCB 与 SRB 的区分；SRB 的调度路径（局部/全局）
- 地址空间：home / primary / secondary 的当前值与切换点（PC / PR / PT / SSAR）
- 程序属性：load module / program object 的 AMODE、RMODE、是否 XPLINK；所在库类型（PDS vs PDSE）
- 诊断：dump 类型、IPCS 视图（XPLINK 下重点看 LEDATA）、跟踪表
- 验证：能同时说清「工作单位是 TCB 还是 SRB + 当前 primary/secondary/home 各是谁 + 这段代码在哪种寻址模式与调用约定下运行」

## 该平台的坑（汇总）

- **把 TCB/thread 模型直接套上去**：SRB 是另一类可调度单位，约束完全不同
- **以为所有执行都有线程创建图**：SRB 由事件触发
- **把 primary 与 home 混同**：PC 之后它们不同，且 home 永不改变
- **用 primary 的地址解释跨内存模式下的权限**：身份取自 home ASCB 或 TCB/SRB
- **跨地址空间复用 TCB 指针**：经典 S0C4-11 成因
- **忘记 SRB 不能 WAIT/不能调 SVC**
- **把 XPLINK 的栈行为判成损坏**：方向相反、栈指针带偏置、展开机制不同
- **忽略 XPLINK 与非 XPLINK 之间转换只支持 31 位**
- **只看程序对象忽略运行中程序的 AMODE**：两者都有该属性
- **在 XPLINK 下按 31 位的控制块清单找现场**：控制块更少，要看 LEDATA 视图
- **按 ASCII 处理字符串与跟踪表**：这里是 EBCDIC
- **把数据集/记录格式当字节流文件**
