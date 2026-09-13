# z/OS：TCB·SRB / cross-memory / 三个地址空间

<CORE RULE>
z/OS **不能直接套 process + thread 模型**。可调度的工作单位有两类，而且**地址空间不止一个**：

```
地址空间
├─ TCB（Address Space 内的任务）
└─ SRB（system service 工作单位）—— 不在正常 TCB-RB 链上
```

加上 **home / primary / secondary** 三个地址空间概念，会出现：

```
当前执行地址属于另一个地址空间
  → 不能自动判控制流劫持
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
- 经 SCHEDULE 一类接口调度，**在远端地址空间中运行**，常跟一次 cross-memory POST
- **PC（PROGRAM CALL）指令要求可调度工作单位以 TCB 或 SRB 形式存在**

**所以**：没有传统"线程创建图"的执行代码不一定是异常。

## 二、三个地址空间：home / primary / secondary

- 程序首次被调度时，**home 与 primary 相同**
- **home 是该 TCB/SRB 最初被调度的地址空间，在整个执行期间保持不变**；**`PSAAOLD` 总是指向 home**（硬件不会改它）
- **primary**：取其段表来取指令的地址空间（primary/secondary/AR ASC 模式下的取指都来自 primary）；在 primary ASC 模式下数据也从 primary 取
- **secondary**：在 secondary ASC 模式中用于数据访问；primary/secondary 可经 PC、PR、PT、SSAR 等指令改变

**取指规则**：ESA/370 起——primary/secondary/AR 模式从 **primary** 取指；home 模式从 **home** 取指；real 模式（DAT 关闭）从实存取指。

## 三、PC 指令与空间切换

- 一个地址空间中的程序用 PC 指令**分支到另一个地址空间的入口点**
- **PC-SS（空间切换）**：被切到的地址空间成为 **primary**，secondary 通常设为原 primary，**home 不变**
- **PC 例程始终运行在发出 PC 的那个 TCB/SRB 之下**（无论是否发生空间切换）
  - **PC-cp（无空间切换）**：在用户的 primary 地址空间中执行
  - **PC-SS（有空间切换）**：在服务提供者的地址空间中执行（它成为 primary）
- 两种链接方式：**basic PC**（例程需手动保存/恢复调用者环境，用 PT 返回）与 **stacking PC**（系统把环境保存在 linkage stack 上，用 PR 返回）
- PC 通过入口表与链接索引（LX）定义；PC 号由 LX 与入口表索引拼接

## 四、AR（访问寄存器）模式

- 每个通用寄存器配一个 AR；放进 AR 的 **ALET 标识目标地址空间**
- **特殊 ALET：0 = primary、1 = secondary、2 = home**
- AR 模式可与最多 16 个地址空间通信，**并且可以调用 SVC**（这是它优于 basic cross-memory 的地方）

## 五、约束与经典故障

- **cross-memory services 需要 APF 授权**；且远端地址空间**必须 non-swappable**（对可换出地址空间做跨内存访问违反协议，可能产生 0D5 一类异常终止码）
- **跨地址空间使用 TCB 指针是经典的 S0C4-11 成因**——TCB 在不同地址空间中**不在同一虚拟地址**
- 在跨内存模式（primary ≠ home）下，工作单位的用户身份取自 **home ASCB 或 TCB/SRB**——权限判定的依据不是 primary

## 决策树

```
拿到 z/OS 目标
├─ 看到的执行单位是什么
│    ├─ TCB（地址空间内的任务）还是 SRB（系统服务请求）
│    ├─ SRB 不能调 SVC（除 ABEND）、不能 WAIT → 别按普通线程解释
│    └─ 没有线程创建图 ≠ 异常
├─ 地址对不上
│    ├─ 区分 home / primary / secondary 三个地址空间
│    ├─ PC 之后 primary ≠ home 属正常，home 不变
│    └─ 取指来自 primary（home 模式除外）
├─ 跨地址空间传数据
│    ├─ basic cross-memory（AXSET + SSAR + MVCS/MVCP，需 APF 授权）
│    └─ 或 AR 模式（ALET：0/1/2 特指 primary/secondary/home，可调 SVC）
├─ 出现 S0C4-11 一类故障
│    └─ 查是否跨地址空间用了 TCB 指针（不同地址空间地址不同）
└─ 权限判定异常
     └─ 跨内存模式下身份取自 home ASCB 或 TCB/SRB，不是 primary
```

## 工具与验证

- 执行单位：TCB 与 SRB 的区分；SRB 的调度路径（局部/全局）
- 地址空间：home / primary / secondary 的当前值与切换点（PC / PR / PT / SSAR）
- 数据访问：basic cross-memory 与 AR 模式的使用点、ALET 取值
- 验证：能同时说清「工作单位是 TCB 还是 SRB + 当前 primary/secondary/home 各自是谁 + 数据经哪条机制跨空间访问」

## 该平台的坑（汇总）

- **把 TCB/thread 模型直接套上去**：SRB 是另一类可调度单位，约束完全不同
- **以为所有执行都有线程创建图**：SRB 由事件触发
- **把 primary 与 home 混同**：PC 之后它们不同，且 home 永不改变
- **用 primary 的地址解释跨内存模式下的权限**：身份取自 home ASCB 或 TCB/SRB
- **跨地址空间复用 TCB 指针**：经典 S0C4-11 成因
- **忘记 SRB 不能 WAIT/不能调 SVC**：按普通任务语义分析会处处对不上
- **忽略 APF 授权与 non-swappable 约束**：跨内存访问有硬性前提
- **在 AR 模式下漏看 ALET 的特殊值**：0/1/2 分别指向 primary/secondary/home
