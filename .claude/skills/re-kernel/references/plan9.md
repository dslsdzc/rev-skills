# Plan 9 / 9front：进程私有命名空间 / /srv / 9P

<CORE RULE>
**pathname 在 Plan 9 里不是全局标识。**

每个进程（或 namespace group）可以有自己的文件名空间：

```
Process A: open("/foo")  → 可能是某个 file server 的树
Process B: open("/foo")  → 可能是完全不同的对象
```

**不能只看路径就推断"访问的是同一个对象"**——必须先恢复各自的 namespace 与绑定历史。
</CORE RULE>

## 一、bind / mount：修改的是"当前进程及其 namespace group"的视图

- `bind` 与 `mount` 修改**当前进程及同一 namespace group 内其他进程**的文件名空间
- `bind` 之后，`old` 成为 `new` 所命名对象的**别名**；**`new` 在 bind 时求值**（不是使用时）
- `mount` 的 `servename` 是"**打开后返回一个已存在的到某 file server 的连接**"的文件——**几乎总是 `/srv` 下的文件**；`spec` 参数随 attach 消息传给 server，用于在 server 提供的多棵树中选择
- 目录与文件的绑定类型必须匹配（两边都是目录，或都不是）

## 二、union directory：是**单层**叠加，不是真正的目录树合并

选项决定叠加方式：

| 选项 | 效果 |
|---|---|
| （无） | 用 `new` **替换** `old`；对目录而言，`old` 变成"只含一个目录的 union" |
| **`-b`** | 把新目录加到 union 的**开头** |
| **`-a`** | 把新目录加到 union 的**末尾** |
| **`-c`** | 允许在 union 目录中创建——新文件落在**第一个以 `-c` 绑定**的元素里 |
| `-C`（mount） | 允许内核使用本地缓存，每次 open 校验时效 |
| `-q` | 失败时静默退出 |

**关键限制**：Plan 9 的 union **不是完整的目录树 union**——查找按顺序检查绑定目标并**返回第一个匹配**，只有一层被叠加。例如把 `b` 绑到 `a` 前面时，`b` 中不存在的名字**不会**回落到 `a` 的深层树里——上层目录里"被遮住"的深层项仍然不可见。

**所以**：

```
readdir("/bin") 的结果
  → 不能简单归属到某一个文件系统
```

## 三、`/srv` 不是 socket 目录，而是服务注册表

- `/srv` 是**服务注册设备**，作为可挂载服务的**汇合点**；引导后 `/srv/boot` 里是"到系统加载来源文件系统"的通信端口
- 典型流程（lib9p）：建立管道 → 把 fd **以名字发布到 `/srv/<name>`** → fork 一个子进程运行服务循环 → 需要时把它挂载到某个挂载点

**所以**：

```
一个新文件系统出现
  → 完全不需要内核里有对应的文件系统模块
  → 它可能就是一个用户态 server 发布到 /srv 后被挂载的结果
```

## 四、9P：fid 是 session 内的 client 侧句柄

- 请求-响应模型：client 发 **T-message**，server 回 **R-message**，各有类型与 tag
- 标准操作：`Tversion/Rversion`、`Tattach/Rattach`、**`Twalk/Rwalk`**、`Topen/Ropen`、`Tread/Rread`、`Twrite/Rwrite`、`Tclunk/Rclunk`、`Tstat/Rstat`、`Twstat/Rwstat`
- **`fid` / `newfid` 是当前 9P session 内的 client 侧句柄命名空间**：`Twalk` 从已有 fid 出发遍历路径，并把结果绑定给 `newfid`
- 库层（lib9p）里，请求对象与 fid 与"未完成的请求""活跃的 fid"一一对应；**服务循环会拒绝重用已存在的 fid，或打开一个已经打开的 fid**
- 若服务用"文件树"方式实现，walk 由库内部处理，不回调驱动的 walk

**所以**：

```
连接 A 的 fid 5
连接 B 的 fid 5
  → 没有任何必然关系

即使同一连接，fid 也会随 walk/clunk 生命周期变化
  → 不能当 inode 那样的持久标识
```

恢复 9P 通信应当对齐：**connection/session + fid + walk 历史 + qid**。

## 五、`open`/`read`/`write` 很可能实际是用户态 RPC

lib9p 的服务循环：从输入 fd 读请求 → 分发到函数指针（auth / attach / open / create / read / write / remove / flush / stat / wstat / walk / walk1 / clone / destroyfid / destroyreq / start / end）→ 把响应写到输出 fd；**服务循环是单线程的**。

**所以**：

```
open("/net/tcp/clone"); write(...); read(...)
  → 不能直接套 "syscall → 内核 TCP 栈"
  → 实际路径可能是：namespace → 已挂载的 file server → 9P → 用户态处理程序
```

这是 Plan 9 逆向最根本的心智模型。

## 决策树

```
拿到 Plan 9 / 9front 目标
├─ 两个进程访问同名路径
│    ├─ 先恢复各自的 namespace 与 bind/mount 历史
│    └─ 不能因路径相同就认定同一对象
├─ 目录内容异常
│    ├─ 查是否 union（-b/-a 顺序、-c 创建位置）
│    └─ union 只有单层叠加：上层目录不存在的名字不会落到下层深树
├─ 出现"新的文件系统"
│    ├─ 查 /srv 下是否有对应服务被发布
│    └─ 不需要内核文件系统模块
├─ 分析 9P 流量
│    ├─ 按 connection/session 对齐，而不是裸比较 fid 整数
│    └─ 结合 walk 历史与 qid
└─ 文件操作行为与预期不符
     └─ 先确认它到底 hit 到哪个 server（namespace → 9P → 用户态处理程序）
```

## 工具与验证

- 命名空间：每个进程/namespace group 的绑定与挂载记录、bind 选项与顺序
- 服务发现：`/srv` 下的条目与它们的发布者；挂载点与 `spec` 参数
- 协议：9P 会话（连接、fid、walk 历史、qid）与消息类型
- 验证：能同时说清「路径在谁的 namespace 里解析 + 最终落到哪个 file server + 数据经过哪些用户态处理程序」

## 该平台的坑（汇总）

- **把 pathname 当全系统唯一资源**：命名空间是每进程/每组的
- **因为路径相同就认定同一对象**：必须先恢复各自的绑定历史
- **把 union 目录当真正的树合并**：只有单层叠加，查找返回第一个匹配
- **忽略 `-b` / `-a` 的顺序与 `-c` 的创建位置**：结果差异很大
- **把 `/srv/foo` 当 socket 文件**：它是服务注册表里的一个连接
- **以为新文件系统必须由内核模块提供**：用户态 server 发布后挂载即可
- **把 9P 的 fid 当 inode/全局文件 ID**：它是 session 内的 client 侧句柄
- **跨连接比较 fid 整数**：不同 session 之间没有可比性
- **把文件操作当 syscall → 内核栈**：通常要经过 namespace → file server → 9P → 用户态处理程序
