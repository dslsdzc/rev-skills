# Genode：组件树 / session / quota 捐赠 / 局部命名

<CORE RULE>
Genode 的核心不是某个固定微内核 API，而是：

```
component tree + parent 中介的服务 + session + capability + quota
```

两条容易误导的规则：

① **服务名只在局部 parent 层级里成立**——两个程序都请求 `"Foo"`，**不能推出它们连到同一个 server**；
② **capability 整数是 protection-domain 局部的**——数值相同不代表同一对象，数值不同也可能是同一对象。

**与 seL4 的 CPtr、Zircon 的 handle 属于同一类坑**（[[sel4-kernel]]、[[zircon-kernel]]）。
</CORE RULE>

## 一、递归的组件树

- 每个程序运行在**自己的 sandbox** 里，并可用自己的资源**创建和管理子 sandbox**——形成严格的层级，策略在每一层生效
- 站在 **parent-child 接口**上看，只有两件事受 parent 策略约束：**child 宣告服务**、**child 请求服务**
- parent 接口的操作：
  - **session**：child 请求连接到一个（parent 所知的）服务；参数里包含**愿意在 session 生命周期内捐给 server 的资源**
  - **close**：child 表示不再需要该 session；parent 应关闭它并**退还捐赠的资源**
  - **announce**：child 把本地实现的服务注册到 parent（从而成为 server）
  - **transfer_quota**：child 扩大它对提供该 session 的 server 的资源捐赠

## 二、路由与"名字重映射"

- child 宣告服务后，parent 用**本地名字**保存 server 的 root capability（放进自己的 root_list）；**root capability 只供 parent 使用与保管**
- parent 调 server child 的 root 接口创建 session，server 返回 session capability，parent 再用本地名字记录（session_list）
- 这一过程**递归**：**服务名不必相同，其含义只延伸到直接 parent，每一层都可以重映射**
- parent 对请求有四种处理：**拒绝**、**委托给自己的 parent**、**本地实现**、**在自己的其他 child 上开 session**
- init 用 XML 的 `<route>` 表描述路由（`<service name=...>` 下可选 `<parent/>` 或 `<child name=.../>`），支持通配（`<any-service>`、`<any-child>`）与 `<default-route>`
- 路由可基于 **session label**：label 在路由途中被逐级加前缀（**最靠近 server 的部分最可信，来自 client 的部分最不可信**）；匹配属性包括 `label`、`label_prefix`、`label_suffix`、`unscoped_label`、`label_last`
- **label 可以被重写**——目标节点里的重写可以**对 server 隐藏客户端身份**

**所以恢复"谁连到谁"必须看路由表与 label 链，而不是看服务名。**

## 三、quota 捐赠：路径上的每一级都要"吃一口"

- session 构造参数携带 client 捐出的资源
- **parent 会从 child 捐赠的 session quota 里扣掉本地记账开销**——于是"**session 请求路径上的每个组件都会从配额里咬一小口**"
- 结果：**到达 server 的配额可能已被消耗**，server 可以返回 `QUOTA_EXCEEDED`；客户端一侧随后会**以逐步增大的配额重试**
- capability 预算同理：每个 `<start>` 节点有 `caps` 属性（建一个组件约需 35 个 cap，100 是常见实用值），cap 预算也可以在 client 与 server 之间转移
- 运行时可动态调整：child 可请求追加资源，也可被要求让出资源

**所以**：

```
全系统还有 100 MB 空闲
某 child 只剩 8 KB quota，创建 session 失败
```

**不矛盾**。排查顺序：全局物理内存 → 当前 PD 的 quota → 该 session 捐出的 quota → capability 预算。

## 四、ROM session：配置可以更新，"ROM 内容变了"不是篡改

- 每个由 init 启动的组件通过向 parent **请求名为 `"config"` 的 ROM module** 获得配置；init 拦截该请求，只交付**与本 child 相关的那部分**配置；这一机制递归成立
- **ROM session 在生命周期内支持动态更新**（client 与 server 之间有专门的更新/通知协议），因此长期运行的组件配置可以被动态改变
- 嵌套配置使一棵组件树可以由单份配置描述

**所以**：ROM dataspace 从版本 A 变成版本 B 是**合法机制**，不是"只读内存被改写"。

## 五、健康与生命周期信号

- 组件在 parent 注册信号处理器（资源可用、yield、session、heartbeat 等）
- **heartbeat**：组件初始化时向 parent 注册心跳处理器，parent 触发信号后由默认处理器回应心跳——init 借此监控子组件健康
- init 支持 state report 与 exit 传播（可把子组件的退出事件转发给自己的 parent）

## 决策树

```
拿到 Genode 目标
├─ 谁连到谁
│    ├─ 看 parent 的路由表（<route>）与 label 链，而不是服务名
│    ├─ 同一服务名在两层 parent 下可能指向不同 server
│    └─ label 可能被重写（对 server 隐藏身份）
├─ capability 相关
│    ├─ 数值只在当前 PD 内有效；相同数值可能无关，不同数值可能是同一对象
│    └─ 按 session/对象对齐，而不是按整数对齐
├─ 资源申请失败
│    ├─ 依次查：全局物理内存 → 当前 PD quota → session 捐赠配额 → cap 预算
│    └─ 路径上的每一级都会扣掉本地开销
├─ ROM 内容变化
│    └─ ROM session 支持更新协议，"内容变了"属合法机制
└─ 组件消失/重启
     └─ 查 heartbeat 监控与 exit 传播链
```

## 工具与验证

- 拓扑：init 的 XML 配置（`<route>` 表、`<start>` 节点、`<report>`、`<exit>`）与 label 匹配/重写规则
- 资源：各节点的 quota 与 caps 配置；session 构造参数中的捐赠额；运行时的资源请求/让出
- 通信：announce（谁是 server）与 session（谁连谁），以及中间的转发层级
- 验证：能同时说清「服务的真实归属（哪一层提供的）+ capability 在哪个 PD 的命名空间里 + 资源是从哪一级配额里出的」

## 该平台的坑（汇总）

- **用服务名判断"连到同一个 server"**：名字只在局部 parent 层级有意义，且每层可重映射
- **把 capability 整数当全局标识**：它是 PD 局部命名；相同数值可能无关，不同数值可能同源
- **忽略 label 重写**：客户端身份可能被有意隐藏
- **把 root capability 当可自由传播的东西**：它只供 parent 使用与保管
- **用"系统还有内存"否定 OOM**：配额是分级的，且路径上每一级都扣过开销
- **忽略 capability 预算**：cap 与 RAM 一样是受限资源
- **把 ROM 内容变化当内存被篡改**：ROM session 本身支持更新
- **忽略 heartbeat/exit 传播**：组件消失/重启有既定的监控与通知路径
