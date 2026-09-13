# HelenOS：fibril / 用户态 DDF 驱动 / devman

<CORE RULE>
HelenOS 是 multiserver 微内核，**驱动是用户态 server 任务**。有两层容易看错的东西：

```
kernel 抢占调度的 thread
   └─ 用户态协作调度的 fibril（内核完全不知道它存在）
```

于是：

```
一个 OS thread 内发生大量"线程切换"
  → 可能只是用户态 fibril 调度器在切，内核视角什么都没发生
```

**在 thread 视角找"这个 thread 为什么被抢占"会一无所获。**
</CORE RULE>

## 一、fibril：内核不知道的执行实体

- 每个任务（process）含若干**由内核抢占调度的 thread**；每个 thread 又可含若干**由用户态库协作调度的 fibril**
- **内核不知道 fibril 的存在**——调度、切换、同步全在用户态完成
- 驱动框架大量使用 fibril：`libdrv` 用 fibril 互斥量保护设备表与驱动状态
- devman 也会**在单独的 fibril 里跑驱动初始化**，以避免"驱动初始化期间还需要 devman 服务"造成的死锁

**RE 判据**：看到密集的用户态"上下文切换"痕迹却对不上内核调度，先怀疑 fibril；看到 driver 内的互斥/让出调用，注意它们是 fibril 级而非 thread 级。

## 二、DDF：用户态驱动框架

DDF（generic device driver support）实现在**用户态库**（`uspace/lib/drv`，公共头 `ddf/driver.h`）。关键结构：

| 结构 | 作用 |
|---|---|
| `driver_t` | 驱动本体：二进制路径、设备表、fibril 互斥量、名字、phone、状态，以及 **`driver_ops_t *driver_ops`** |
| **`driver_ops_t`** | 通用驱动操作——**由通用连接处理器在有来连接时调用** |
| `ddf_dev_ops_t` | 设备/功能层的操作 |

生命周期围绕 device / function：创建（`ddf_fun_create`）→ 加 match id（`ddf_fun_add_match_id`）→ 绑定（`ddf_fun_bind`）→ 上线（`ddf_fun_online`）一类调用；软状态用 `ddf_dev_data_alloc` / `ddf_fun_data_alloc` 管理。

入口形态：驱动主函数把 `driver_t` 存好（**"driver_ops 将由通用处理器在有来连接时调用"**），经 `devman_driver_register(name, connection)` 向设备管理器注册，设置中断处理，然后进入异步管理器循环。**devman 发来"添加设备"消息时，通用代码调用 `driver->driver_ops->add_device(dev)`**。

**RE 含义**：驱动内没有"主循环分发"很正常——分发在通用层，业务在 `driver_ops` 的回调里。

## 三、devman：设备树与匹配

devman 是**用户态服务**，维护：

- **设备树**（device node / function node）与驱动列表
- **匹配评分**：按 match id 计算得分并选最优驱动
- 自动启动驱动、设备枚举、热插拔处理

相关动作：注册运行中的驱动、分配驱动、启动驱动任务；**子设备由其父驱动的注册动作加入**，function 可注册进 class 供 device mapper 使用。

**RE 主线**：

```
match id / 评分 → devman 选中驱动 → 启动该驱动任务 → DDF 回调 → 设备功能
```

**不要去找内核侧的 driver dispatch table**——它在用户态服务里。

## 决策树

```
拿到 HelenOS 目标
├─ 找驱动
│    ├─ 用户态 server 任务（不是内核模块）
│    ├─ 匹配与启动在 devman；业务在 driver_ops 回调
│    └─ 不要找内核 dispatch table
├─ "线程切换"异常密集
│    ├─ 先区分：内核抢占的 thread vs 用户态协作的 fibril
│    └─ 内核不知道 fibril，别在内核调度里找证据
├─ 驱动初始化看起来卡住
│    └─ 注意 devman 在单独 fibril 里做初始化（避免重入死锁）
└─ 设备与驱动的归属
     └─ 走设备树（device node / function node）与 match 评分
```

## 工具与验证

- 执行实体：thread 与 fibril 的区分（用户态调度库、fibril 互斥量的使用点）
- 驱动：`driver_ops_t` 回调集合与 `ddf_*` 生命周期调用
- 拓扑：devman 维护的设备树与 match id/评分
- 验证：能同时说清「执行实体在哪一层（kernel thread / user fibril）+ 驱动在用户态如何被匹配与启动 + 业务回调落在哪个 ops」

## 该平台的坑（汇总）

- **把 fibril 当内核线程**：内核不知道 fibril，调度证据对不上
- **在内核调度里找 fibril 切换的证据**：找不到是正常的
- **找内核 driver dispatch table**：驱动是用户态 server，分发在 DDF 通用层
- **以为驱动有自己的分发主循环**：业务在 `driver_ops` 回调里
- **忽略 devman 的匹配评分**：谁绑定谁由 match id 评分决定
- **把驱动初始化的"卡住"当 bug**：devman 在独立 fibril 里初始化以避免重入死锁
