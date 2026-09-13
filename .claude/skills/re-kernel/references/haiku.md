# Haiku：device_node 树 / driver module 与 device module / 按需发现

<CORE RULE>
Haiku 同时保留 legacy BeOS 驱动架构与较新的 **Device Manager** 模型。新模型有两条容易看错的地方：

① **驱动是按需发现的**——初始设备树只探索最少的驱动：

```
boot 时某个驱动没出现
  → 后来访问 /dev/disk 时才出现
  → 可能只是 on-demand exploration
```

② **driver module 与 device module 是两层**：前者绑定设备节点，后者暴露 `/dev` 接口。
</CORE RULE>

## 一、device_node 树

- 设备管理器围绕 **device_node** 构建：每个驱动发布一个或多个节点，构成一棵**动态表示系统硬件的树**
- 一个 device_node 由 **module + attributes + resources** 加父/子指针组成；**module 是唯一必需的部分**
- 启动时只有**根节点**；主要总线（x86 上的 PCI、ISA）向它注册；**智能总线（如 PCI）会为自己发现的每个设备创建子节点**
- 驱动可以把设备发布到 `/dev` 供用户态使用；**所有驱动与设备都是内核模块**

## 二、按需探索：这是"驱动消失/出现"的正解

- 需要某功能时（例如磁盘访问），系统扫描 devfs（如 `/dev/disk/`），设备管理器**按内建规则把设备路径翻译成 device node**：智能总线上的节点带 PCI 式类型信息，于是 `disk` 映射到海量存储类型，管理器只完整探索该类型的节点
- 它**只查询匹配的模块目录**（如 `busses/scsi`、`busses/ide`、`drivers/disk`），从而减少需要加载的驱动数量
- 对无类型的普通总线，搜索限于上下文子目录（`disk`、`ports`、`bus` 例外，还会搜 `busses`）
- **`B_FIND_CHILD_ON_DEMAND`** 标志让某驱动**只在系统要求时才被搜索**

**所以"boot 时没有该驱动"不是缺失**——按需发现是设计。

## 三、两层模块：谁绑定节点，谁暴露 /dev

**driver module**（名字必须以 `driver_v1` 结尾）需实现：

```
supports_device()        register_device()      init_driver() / uninit_driver()
register_child_devices() rescan_child_devices() device_removed()
suspend() / resume()      ← 从不被调用（Haiku 无电源管理）
```

- `register_device()` 注册节点，并可**认领 I/O 资源**（I/O 端口或内存范围）——**同一资源只能被一个节点认领**

**device module**（经 `publish_device(node, path, deviceModuleName)` 发布，名字必须以 `device_v1` 结尾）导出面向用户态的接口：

```
init_device() / uninit_device() / device_removed()
open() / close() / free() / read() / write() / io() / control() / select() / deselect()
```

**RE 判定**：在 driver module 里找不到 `read`/`write` **很正常**——那是 device module 的接口。

## 四、资源与属性

- 节点属性可携带：显示名、唯一 ID（会出现在已发布设备的文件系统属性中）、**固定子节点**、厂商 ID、设备 ID、类型、子类型、接口、标志
- **固定子节点与动态子节点不能混用**：固定子节点在 `register_child_devices()` **之前**注册，动态的在之后
- 较新的版本还给节点加了"路径/驱动名"属性，用于在设备管理界面里显示某设备由哪个驱动、走哪条 `/dev` 路径

## 决策树

```
拿到 Haiku 目标
├─ 驱动"不存在"
│    ├─ 按需发现：只有被请求时才会搜索/加载
│    └─ 查 B_FIND_CHILD_ON_DEMAND 与总线类型规则（disk → 海量存储类型）
├─ 在 driver module 里找不到 read/write
│    └─ 那是 device module 的接口（device_v1），两层分工不同
├─ 设备路径 → 驱动
│    └─ 经 device_node 树与总线类型规则翻译，不是查注册表
├─ 资源冲突
│    └─ 同一 I/O 资源只能被一个节点认领
└─ 子节点数量异常
     └─ 固定子节点与动态子节点不可混用，注册时机也不同
```

## 工具与验证

- 拓扑：device_node 树（module / attributes / resources / 父子关系）与总线类型规则
- 驱动：driver module 的必需接口集合与 `driver_v1`/`device_v1` 命名约束
- 资源：资源认领的唯一性；属性中的类型/厂商/设备信息
- 验证：能同时说清「这个设备节点由哪个 driver module 绑定、由哪个 device module 暴露 /dev 接口、它是被按需发现还是启动时就有」

## 该平台的坑（汇总）

- **把按需发现当驱动缺失或加载失败**：初始树只探索最小集合
- **以为所有驱动都在启动时加载**：`B_FIND_CHILD_ON_DEMAND` 明确是延迟搜索
- **在 driver module 里找 `read`/`write`**：那是 device module 的接口
- **忽略 `driver_v1` / `device_v1` 命名约束**：它们是模块分类的依据
- **期待 `suspend`/`resume` 被调用**：当前实现不调用它们
- **把设备路径直接当驱动标识**：路径要先经类型规则翻译成 device node
- **以为多个节点可以共享同一 I/O 资源**：每个资源只能被一个节点认领
- **混用固定子节点与动态子节点**：不允许，且注册时机不同
