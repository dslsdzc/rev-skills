# MINIX 3：RS 自愈 / endpoint 身份 / grants / live update

<CORE RULE>
MINIX 3 的驱动大多是**用户态服务**，由 **Reincarnation Server（RS）** 监控：检测崩溃/挂起并**重启**它们。于是：

```
driver 进程（PID/endpoint）消失
  → 几乎立刻出现一个新的 driver
  → 设备继续工作
```

**这不是 rootkit 持久化，是系统自愈。**

第二条：**服务由 label 标识、由 endpoint 寻址**——重启后 label 可以不变，但 **endpoint 会变**。把 endpoint 当持久服务身份，会得到一连串假异常。
</CORE RULE>

## 一、RS 与 endpoint 身份

- RS 监控服务/驱动，检测失败并重启；相关框架处理 fresh / restart / live-update 三类初始化
- **重启后 label 保持，endpoint 改变**；需要按 label 重新查询才能拿到新 endpoint
- 因此下面这条时间线是**正常恢复**：

```
以前给 endpoint X 发 IPC → 突然失败
新的 endpoint Y 接管
```

- **推论**：任何按 endpoint 缓存/比对的引用都会在重启后失效；做行为分析时要把"endpoint 变化"当作一等公民来解释

## 二、消息是定长的，大数据走 grants

- **消息载荷固定大小（56 字节）**；每种消息类型有各自格式（定义在 `minix/include/minix/ipc.h`）
- 超过这个尺寸的传输使用 **grants**（`minix/include/minix/safecopies.h`）——**指向 granter 导出的一块已分配数据块**
- 三种典型用法：
  1. **发送超过 56 字节**：grantee 拿到只读 grant，映射后读出，granter 再撤销
  2. **请求超过 56 字节**：读写 grant，grantee 写入后发回，granter 撤销
  3. **双向**：对已分配内存建立 grant

**所以**：

```
消息里出现数字 12
  → 不一定是用户 buffer 指针
  → 可能是 grant ID

真正的关系：(endpoint, grant ID, offset, rights) → 一段外部内存
```

## 三、grant 校验失败 → `EPERM`，不是"权限不足"

grant 校验按固定顺序进行：

1. 解析 granter 的 endpoint
2. grant 表已注册且索引在范围内
3. 从 granter 的地址空间把条目读回来——**页表走查失败会被报成 `EPERM` 而非 `EFAULT`**，这是有意的：**避免 grantee 借错误码探测 granter 的地址空间**
4. 条目的有效/已用标志置位
5. **序列号与 grant id 匹配**
6. **请求的访问权限 ⊆ grant 标志**（这就是 "access invalid" 那类报错的来源）
7. 目标 endpoint 等于**调用方由内核盖戳的 endpoint**（防伪造 / 混淆代理规则）
8. `offset + bytes ≤ len`

**错误语义（驱动开发者依赖的约定）**：

| 错误 | 含义 |
|---|---|
| **`EPERM`** | **grant 无效**（未注册、序号不匹配、权限不足、越界，或页表走查失败） |
| **`EFAULT`** | **缓冲区未映射** |

**所以 `sys_safecopy*` 返回 `EPERM` 时，不要套 Unix 的"进程没有特权"直觉**——先按 grant 的六类失败逐一排除。

- grant 类型区分：**direct**（把内存解析到 granter）与 **magic**（解析到消息发送方，并额外要求 granter 属于受信任的特权服务集合）
- grant id 是**打包**的（例如位移 20 位，内含 id / 索引 / 序列号），因此"同一个数字"未必指向同一 grant

## 四、Live update：更新期间可能真的有两个实例

- 更新前服务必须到达合适的**静态点**：部分状态预定义，**其余要由服务开发者自己定义**；管理员在发起更新时须提供状态号
- 更新是**进程级**的：**内核（仅）授予新进程对旧进程地址空间的只读访问**，借此先迁移元数据（新旧元数据都在本地可用，从而能按版本无关的命名重新映射状态对象），再迁移数据
- **出错可以回滚**：终止新版本、让旧版本继续执行——**类似被中止的原子事务**；这种进程级更新也**阻止新版本的更新期错误传播回旧版本**
- **更新过程中旧、新两个实例确实可能同时存在**

**所以内存取证看到两个几乎一样的 FS/驱动镜像，不一定是进程注入或重复的恶意实例**。

- 相关约束：更新要求服务采用事件循环设计，使**更新时刻栈上没有状态对象**
- **活跃的 direct grants 会让更新更复杂**：grant 里保存的指针可能需随状态重定位而调整；文档建议在这种情形下**阻止更新或做定制化的状态迁移**

## 决策树

```
拿到 MINIX 3 目标
├─ 驱动"消失又出现"
│    ├─ 先按 RS 重启解释（系统自愈），不要判持久化
│    └─ 对齐 label（稳定）与 endpoint（会变）
├─ IPC 发送失败
│    ├─ 对端是否已重启、endpoint 是否已变
│    └─ 按 label 重新查询而不是复用旧 endpoint
├─ 消息里出现可疑整数
│    ├─ 56 字节以内的载荷是定长消息
│    └─ 更大的传输走 grant → 该整数可能是 grant ID 与 offset
├─ sys_safecopy* 返回 EPERM
│    ├─ 按 grant 校验顺序逐项排除（序号/权限/越界/页表走查）
│    └─ 别套 Unix 的权限直觉；EFAULT 才表示未映射
└─ 内存里出现两个相同服务镜像
     ├─ 先考虑 live update 的旧/新实例共存
     └─ 再看是否存在活跃 direct grants 影响更新
```

## 工具与验证

- 服务生命周期：RS 的监控与重启记录、服务 label 与当前 endpoint 的对应关系
- 通信：消息类型定义（定长载荷）与 grant 相关接口；`(endpoint, grant ID, offset, rights)` 的还原
- 更新：服务的静态点定义、更新与回滚轨迹、更新期间实例数量
- 验证：能同时说清「服务身份是 label 还是 endpoint + 数据是走消息还是 grant + 当前的更新/重启阶段」

## 该平台的坑（汇总）

- **把驱动重启当持久化/注入**：RS 会重启失败的服务，这是自愈
- **把 endpoint 当持久服务身份**：重启后 label 不变而 endpoint 变
- **把消息里的小整数当 buffer 指针**：可能是 grant ID（配合 offset 与权限）
- **把 `EPERM` 当"权限不足"**：它表示 grant 无效，含序号不匹配/越界/页表走查失败等多种情形
- **把 `EFAULT` 与 `EPERM` 混同**：前者表示缓冲区未映射
- **忽略 grant id 的打包结构**：同一个数字未必是同一个 grant
- **把 live update 期间的两个实例当异常**：旧/新共存是更新过程的正常状态
- **忽略活跃 direct grants 对更新的影响**：可能需要阻止更新或定制状态迁移
- **在更新期进行依赖栈上状态的推理**：更新要求栈上没有状态对象
