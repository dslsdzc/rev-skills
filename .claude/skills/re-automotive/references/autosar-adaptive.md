# AUTOSAR Adaptive：清单驱动的生命周期 / 服务发现 / PHM / 更新

<CORE RULE>
底层通常确实是 POSIX OS，**但应用生命周期、服务发现、更新、健康监控都不是由 ELF 与进程树决定的**：

```
Executable
  ├─ Execution Manifest   → Modelled Process / 启动参数 / 优先级 / 资源组 / FG State 映射
  ├─ Service Instance Manifest → 服务部署 / SOME-IP 或 DDS 绑定 / 安全与 E2E / 实例映射
  └─ Machine Manifest     → 网络 / 服务发现 / Machine State / Function Groups / PHM / 平台配置

State Management → Execution Management → start/stop Processes
ara::com → service discovery / IPC
PHM → supervision → State Management
UCM → software cluster install / update / rollback
```

所以：

```
binary 明明装好了，进程却完全不存在
  → 先查当前 Machine State / Function Group State / Execution Manifest
  → 不要先判 crash 或 loader failure
```

**这个进程按设计当前就不应该运行。**
</CORE RULE>

> 版本提示：公开版本已推进到 R25-11，本节多数细节来自完整公开的 R24-11 规范；核心模型仍适用，**具体条目要按目标版本做指纹**。

## 一、Modelled Process ≠ OS 进程

- 元模型里的 **Process（Modelled Process）**是 ARXML 模型元素："可执行文件在 Machine 上执行的一个被加载的实例"
- 规范用不带前缀的 "process" 指 **POSIX 意义上的运行中进程**，以此区分两者
- 运行期：EM 为**每个 modelled Process 建立一个 OS 进程**；之后 EM 只在状态管理与确定性执行方面与之相关
- 变体：**上报型**（经 ExecutionClient 上报执行状态）、**不上报型**（可用于非 AP 适配的二进制）、**自终止型**（自己退出或被 EM 以信号终止）
- **`identity = Executable + Modelled Process 实例 + Function Group State`**，而不是 ELF 哈希

## 二、同一个 ELF 可以有多个不同行为的进程

规范明确允许**一个 Executable 二进制的每个启动实例分别配置**，且**不同 Machine State / FG State 可以采用不同配置集**。所以：

```
foo
├─ Process A  优先级 20
├─ Process B  优先级 40
└─ Process C  不同 args / resource group
```

可以都是同一 executable 的不同 Modelled Process。**不要假设 1 executable = 1 process configuration。**

## 三、生命周期调用者不在目标进程自身

进程"无故"被终止、另一批进程随即启动，正常路径可以是：

```
外部事件 → State Management → SetState(FunctionGroupState X)
        → Execution Management → terminate A/B → start C/D
```

- FG State 本身定义了"**哪些 Process 此时应该运行、哪些不应该**"
- 状态切换时 EM **先终止正在运行的进程，再按执行依赖顺序启动新状态下活动的进程**，最后才向 SM 确认
- 规范覆盖终止超时、启动超时、重启尝试等失败情形
- 启动时 EM 由 OS 作为初始进程之一拉起（**不一定是第一个进程**），自行把 MachineFG 转到 **Startup**；此后**不再自行发起**状态切换——要由 SM 请求

**动态分析要求**：除了 fork/exec/exit 图，还必须建立 **state transition graph**。

## 四、服务发现：空结果与重复回调都可能正常

- **`FindService()` 明确允许返回空集合**——当前没有匹配的 service instance 可用而已
- **`StartFindService()` 本身就是持续的异步可用性监控**：

```
StartFindService() → callback([]) → 服务出现 → callback([service]) → 服务消失 → callback([])
```

**第一次回调本来就允许是空的**。所以"发现服务返回零"不能立即判网络故障 / 清单损坏 / provider 崩溃，**必须观察 availability 生命周期**。

- 规范要求：**每当匹配 service instance 的可用性变化时重新调用 handler**，且**实现负责串行化同一个 handler**——因此同一个回调被调用多次**不是重复注册 bug**

## 五、handle 可以指向远端实例

拿到 service handle 却在本地找不到 provider 进程**完全正常**：

```
Proxy handle 存在 + 本机没有 provider executable
  → 不能判服务表被伪造
  → 应追：Service Instance Manifest → 网络绑定 → 实例映射 → 远端机器
```

## 六、`ara::com` ≠ 必然 SOME/IP

Adaptive service 可以部署到不同通信技术——公开模型中同时明确描述了 **SOME/IP 与 DDS** 的 service-instance deployment。

```
ara::com API → binding → 可能是 DDS，而不是 UDP/TCP SOME/IP
```

**所以：搜不到 SOME/IP 流量时先查 Service Instance Manifest**；分析器若写死"ara::com → SOME/IP"会直接产生事实性错误。

推论：跨 ECU 建图时把 **logical service interface** 与 **technical binding/deployment** 分开恢复——**接口相同而底层协议不同**可以正常。

## 七、PHM：没有 crash 不等于健康

- PHM 以**进程粒度**监督（不同于 Classic 的 WdgM 任务级 + 硬件看门狗复位）
- 基本单位是 **Supervised Entity（SE）**：可映射到一个进程**或进程的一部分**；应用经 `ReportCheckpoint` 上报进度
- **三类监督**：

| 监督 | 判据 |
|---|---|
| **Alive** | 周期内上报的检查点数量是否在期望范围内（过多/过少都算） |
| **Deadline** | 起止检查点之间的执行时间是否落在配置区间 |
| **Logical** | 检查点上报顺序是否符合预定义监督图（与时间无关） |

- 状态：本地状态 OK / FAILED / **EXPIRED（终态，不能回到 OK）**；全局状态在聚合之外还含 STOPPED（超过容忍期后）
- **监督模式定义为 `<machine state, function group state>`**，由状态管理通知
- **恢复动作**（在清单里定义）：请求 SM 切 FG 状态、请求 EM 重启进程或进入不可恢复状态、**请求看门狗驱动复位**、上报诊断、转发给安全应用做复杂响应
- **PHM 自身不启停进程**——由 EM 代为执行
- PHM 还会监督 EM 守护进程的存活；其失败会升级为看门狗/机器复位（因为经 EM/SM 的常规恢复已不可靠）

**所以**：

```
process wasn't segfaulted  ≠  process was healthy
系统重启了但找不到 reboot 调用者  → 查 PHM 监督状态 / SM 反应 / 看门狗路径
```

## 八、UCM 与 Persistency：装上 ≠ 生效

- UCM 把 **transfer/install、verify、activate** 分开；激活前检查 Software Cluster 依赖，EM 在 Verify 阶段发现执行依赖不满足时可通过 SM/UCM 导致 **rollback**
- 所以"磁盘上有新包"**不能**推出"新版本已生效"；要分别确认：package received? installed? verified? **activated?** rollback?
- **Persistency 的更新策略**（按元素/文件）：

| 策略 | 含义 |
|---|---|
| `keepExisting` | 保留既有数据，忽略清单初始值（用户数据） |
| `overwrite` | 用清单值替换（强制配置同步） |
| `delete` | 删除既有元素（用于废弃配置） |

- 清单约束：`keepExisting`/`overwrite` 要求存在初始值；`delete` 要求不存在
- **版本处理**：清单版本 > 存储版本 → 更新；相等 → 不操作；**更低 → 回滚**（存在有效备份时）
- **部署期设置可以覆盖设计期设置**：逆向量产系统时，**目标部署产物优先于设计仓库里的默认配置**

**所以**：更新后"新程序 + 旧数据"可能是 `keepExisting`，"数据突然消失"可能是 `delete`。**这两种都不是更新失败。**

## 决策树

```
Process 不存在
├─ 当前 Function Group State？
├─ 当前 Machine State？
├─ Execution Manifest 里的 StartupConfiguration？
└─ UCM 是否已 activate？

Service 找不到
├─ FindService 本来可以返回空？
├─ StartFindService 尚未出现 provider（availability 生命周期）？
├─ 是 remote service instance？
├─ 绑定是 SOME/IP 还是 DDS？
└─ Service Instance Manifest 怎么写的？

Process 无 crash 却重启/复位
├─ PHM Alive / Deadline / Logical 哪一类？
├─ SM 的状态迁移？
├─ PHM→看门狗复位路径？
└─ EM 自身是否被监督？

更新行为奇怪
├─ package 是 installed 还是 activated？
├─ 依赖 Verify 是否通过？
├─ 是否 rollback？
└─ Persistency 策略是 keep / overwrite / delete？
```

## 工具与验证

- 清单三件套：Execution Manifest（Modelled Process、启动参数、资源组、FG State 映射）、Service Instance Manifest（部署、绑定、E2E/安全、实例映射）、Machine Manifest（网络、服务发现、Machine State、FG、PHM）
- 状态：当前 Machine State 与 Function Group State；supervision mode = `<machine state, function group state>`
- 健康：SE 的监督类型与本地/全局状态、恢复动作定义
- 更新：UCM 的阶段状态、Persistency 策略与版本比较结果
- 验证：能同时说清「当前状态是什么 + 清单规定哪些进程/服务应活动 + 该行为来自清单还是实现」

## 该平台的坑（汇总）

- **把"bin 存在但进程不存在"当崩溃或加载失败**：先看 Function Group/Machine State
- **把 Modelled Process 与 OS 进程 1:1 比较**：规范明确区分
- **假设 1 个 executable 只有 1 种进程配置**：可按状态给不同配置
- **把生命周期当作目标进程自己的责任**：真正的调用者是 SM→EM
- **用 fork/exec/exit 图代替状态迁移图**
- **把"发现服务返回空"当故障**：空结果是合法值，且首次回调可以为空
- **把重复回调当重复注册**：规范要求可用性变化时回调，且实现负责串行化
- **在本地找不到 provider 就判伪造**：handle 可指向远端实例
- **写死 ara::com = SOME/IP**：也可能是 DDS
- **把没有 crash 当健康**：Logical/Alive/Deadline 监督与崩溃是两回事
- **只搜 reboot 调用者找复位原因**：看门狗路径由 PHM 触发
- **把"包已安装"当"新版本生效"**：install/verify/activate 分开，还可能 rollback
- **把更新后的数据保留或消失当更新失败**：keepExisting / delete 都是策略
- **拿设计期 ARXML 当量产行为的依据**：部署期设置优先
