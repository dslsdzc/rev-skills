# Nucleus RTOS：线性内存映射 + 保护域 / 动态模块生命周期

<CORE RULE>
最反直觉的一条：

```
存在 "process isolation"
  ≠ 采用 Linux 那种"每进程一个完全独立的虚拟地址世界"
```

Nucleus 的 Process Model：

- Cortex-A 上可用 **MMU**，Cortex-M 上可用 **MPU**
- 提供 **space-domain partitioning（空间域分区）** 与 **entitlement（授权）**
- **采用线性（flat）内存映射 + 受保护内存区域**
- **application 与 kernel module 可以动态 reload / restart / update，而不需要停掉整个系统**

于是：

```
两个 process 里的地址看起来线性、接近  → 不能判"没有地址空间隔离"
同一地址 A 能访问、B fault             → 可能只是 entitlement 不同
module 被替换而系统从未 reboot          → 可能是正常的模块生命周期
```

**判断隔离要看 MMU/MPU entitlement，而不是比较指针数值。**
</CORE RULE>

## 一、Process Model 与 POSIX 心智模型的区别

要恢复的图是：

```
Nucleus Process
├─ modules
├─ tasks
├─ protected regions
└─ entitlements
```

**而不是** `PID → 页表 → fork 父进程 → exec ELF`。Nucleus 的 "process" 重点是**模块加载、内存访问保护、特权与隔离**，不是复制 Linux process ABI。

- Cortex-M 上**没有完整 MMU**也能有 process 模型——靠 MPU region 重配置、特权级与 entitlement；**"找不到页表"不能推出"没有 Process Model"**
- 一个 process 出错**不应默认全系统一起死**：空间隔离的价值就是让故障恢复可以是"重启出错的 module/process，其他子系统继续"

## 二、术语坑：`partition` 有两种完全不同的含义

| 名称 | 含义 |
|---|---|
| **Process Model 的 space partition** | 进程/子系统的空间隔离域 |
| **`NU_PARTITION_POOL`** | **固定大小内存块的分配器（memory partition pool）** |

```
NU_Create_Partition_Pool(pool, name, start_address, pool_size, partition_size, suspend_type)
NU_Allocate_Partition(pool, &ptr, suspend)
NU_Deallocate_Partition(ptr)
```

这里的 **partition 指的是"固定大小的内存块"**，与隔离域无关。**看到 partition 这个词必须先分清是哪一种。**

## 三、固定块分配器的语义（决定了"卡在分配器里"是否正常）

- 池是**连续内存区 + 固定大小块**（例如 2000 字节、块 40 字节 = 50 块）
- **分配是确定性的 O(1)**：不做搜索；**不可能产生碎片**，唯一的失败模式是**该池真的耗尽**
- suspend 选项：
  - **`NU_NO_SUSPEND`**：无论能否满足都立即返回；**非任务线程（如 `Application_Initialize`）只能用它**
  - **`NU_SUSPEND`**：调用任务**挂起直到有块被归还**
  - **超时值**：挂起到有块或超时
- 多个任务挂起在同一池上时，按池创建时指定的 **FIFO 或优先级**顺序恢复
- 返回值 **`NU_NO_PARTITION`** 表示"无法立即满足"

**所以**：

```
task 卡在分配器里、state = suspended
  → 用 NU_SUSPEND 且池空时，按语义本来就该挂起
  → 不是 heap deadlock

分配失败但系统 RAM 还剩很多
  → 固定池耗尽与通用堆无关，也不是"全局堆碎片"
```

## 四、动态模块生命周期

Nucleus 支持**动态 reload / restart / update** application 与 kernel modules，**不影响其他 module、也不必 shutdown 整个系统**。

于是固件时间线里出现：

```
module A 版本 X → 短暂停止 → module A 版本 Y
且全程没有 boot event
```

**不能单凭这一点判"运行时注入 / rootkit 替换"**——先查该系统的 module lifecycle/update 路径。

这与"单体嵌入式镜像：更新一块 → 整机重启"的传统假设不同。

## 决策树

```
拿到 Nucleus 目标
├─ 看到 "partition"
│    ├─ 是 Process Model 的空间隔离域？
│    └─ 还是 NU_PARTITION_POOL 固定块分配器？
├─ 两个"process"的地址看起来线性/接近
│    ├─ 线性内存映射 + 受保护区域就是该模型
│    └─ 判断隔离要看 entitlement，不是比地址
├─ 同一地址访问权限不同
│    └─ 符合 "同一线性地址 + 不同保护授权"
├─ Cortex-M 上没有页表
│    └─ 仍可有 process 模型（MPU + 特权 + entitlement）
├─ task 挂起在分配器里
│    ├─ 查是否用了 NU_SUSPEND 且池空
│    └─ 查池容量与归还路径，而不是堆死锁
├─ 分配失败但内存充足
│    └─ 固定池耗尽，与通用堆无关
└─ module 在无 reboot 的情况下被替换
     └─ 查官方 module reload/update 生命周期
```

## 工具与验证

- 隔离：MMU/MPU 配置、受保护区域、entitlement 与特权状态
- 内存：partition pool 的块大小与块数、当前占用与等待者；区分它与通用堆
- 生命周期：模块加载/重载/更新的路径与版本变更点
- 验证：能同时说清「隔离靠 MMU 还是 MPU、授权是什么 + 该地址属于哪个域 + 分配失败是池耗尽还是堆问题」

## 该平台的坑（汇总）

- **用 Linux 每进程独立地址空间的模型理解隔离**：这里是线性映射 + 受保护区域 + entitlement
- **比较指针数值判断是否共享内存**：地址相同不代表内存共享
- **在 Cortex-M 上因找不到页表就否定 Process Model**：MPU 也能构建隔离
- **把 `partition` 一律理解为隔离域**：`NU_PARTITION_POOL` 是固定块分配器
- **把 `NU_SUSPEND` 导致的挂起当 heap deadlock**
- **把固定池耗尽诊断为全局堆碎片**：该分配器不产生碎片
- **把无 reboot 的 module 替换当注入**：动态 reload/restart/update 是既有能力
- **在非任务线程里用 `NU_SUSPEND`**：只允许 `NU_NO_SUSPEND`
- **默认 process 出错就是全系统复位**：隔离的意义正是局部恢复
- **期待 fork/exec/mmap 语义**：那不是这个 process 模型的重点
