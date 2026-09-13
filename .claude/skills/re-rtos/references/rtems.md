# RTEMS：单地址空间 / 构建期配置 / 运行时链接器

<CORE RULE>
RTEMS 的三大特殊性：

| 特殊性 | 后果 |
|---|---|
| **单地址空间** | OS、库、应用可视为**一个进程**；没有"每个进程各自一套映射"这回事 |
| **大量结构在构建期由配置宏生成** | 任务数、调度器、驱动、时钟节拍、初始化任务来自 `confdefs.h` 的 `CONFIGURE_*` 宏 |
| **`dlopen()` 不是 Unix 动态库模型** | 运行时链接器更像**把可重定位目标链接进当前系统地址空间**，不是共享库装载 |

第三条尤其容易误导——**看到 `dlopen` 就套 ELF `DT_NEEDED` / 共享库命名空间那套，会得到一整套错误结论**。
</CORE RULE>

## 一、单地址空间意味着什么

- 没有运行期代码共享的余地（"在 RTEMS 上没有东西需要共享"），所以**加载代码更接近静态绝对链接过程**，而不是 Unix 共享库
- 可加载对象按**位置无关代码**编译，装载时**重定位进目标地址空间**，地址在**装载时固定**
- **执行性能与静态链接的同份代码相近**——不要用"动态库调用有 PLT/GOT 开销"这类先验去解释性能观测
- 基镜像（reset 后运行的静态链接可执行文件）包含：基础应用、**全局符号表**、被引用到的 OS/库代码

## 二、`confdefs.h`：配置即生成

`<rtems/confdefs.h>` 是**配置表模板**，由一组 `CONFIGURE_*` 宏实例化：

- **`CONFIGURE_INIT` 必须且只能在唯一一个源文件里定义**（否则配置数据结构被实例化多次 → 链接错误）。这是一条很好用的判据：**找配置实例化点，就是找那个定义 `CONFIGURE_INIT` 的翻译单元**
- 它的工作方式是**估算**每项配置所需内存并求和，用来算出 `work_space_size`——**估算可能偏高也可能偏低**（例如设备驱动的要求与附加库的资源并不计入）
- 设备驱动数量由**设备驱动表的表项数**自动算出：该表**按约定命名为 `Device_drivers`**；应用若要自带驱动表，必须定义 `CONFIGURE_HAS_OWN_DEVICE_DRIVER_TABLE`
- 相关的容量宏：最大驱动数 / 最大设备数；控制台、时钟、定时器、RTC、stub 等驱动通过 `CONFIGURE_APPLICATION_NEEDS_*_DRIVER` 引入
- **网络驱动不配在设备驱动表里**——"驱动表里没有网络驱动"不是缺件

## 三、设备模型：driver address table + major/minor

核心结构是 `rtems_driver_address_table` 数组，每个表项**六个入口**：

```
initialization_entry  open_entry  close_entry  read_entry  write_entry  control_entry
```

- **major 号就是这张表的索引**；**minor 号**标识同一设备类内的具体设备（同一个驱动或不同驱动可以服务 minor 0/1）
- `rtems_io_register_name(name, major, minor)` 把 `(major, minor)` 与文件名关联（例如 `/dev/ttyS0`），通常在 minor 级初始化时调用
- 启动路径：`boot_card` → `rtems_initialize_device_drivers` → `_IO_Initialize_all_drivers` → `rtems_io_initialize` → 各驱动的 `initialization_entry`
- 表中以 `NULL_DRIVER_TABLE_ENTRY` 形式的空项作占位/兜底

**因此要恢复的是**：

```
Device Driver Table → major（表索引）→ 回调函数
```

**而不是** Linux 的 `file_operations`。I/O 管理器按驱动表分派，**major 号是"表下标"这一层语义，在 Linux 侧根本不存在**。

## 四、`dlopen()` 的特殊语义（逐条都有分析后果）

运行时链接器在目标上运行，经 `<dlfcn.h>` 提供 `dlopen` / `dlclose` / `dlsym` / `dlinfo` / `dlerror`，可装载 **ELF 可重定位目标文件**并解析其外部函数/数据符号。但：

- **目标文件可以是独立文件，也可以是静态库（archive）的成员**，用 RTEMS 自己的编码：**`libfoo.a:bar.o`**，成员名后可选 `@offset`（给出对象在 archive 中的绝对偏移）；带偏移可省去在 archive 中查找的开销。**这套编码是 RTEMS 特有的**——按 Unix 共享库的命名习惯无法解释它
- **`RTLD_LAZY` 与 `RTLD_NOW` 行为相同：`dlopen` 返回之前全部重定位已完成**。所以"懒绑定会在首次调用时才解析"的推断在这里不成立
- **未解析符号不会让 `dlopen` 失败**（这样互相依赖的对象可以成对加载）；未解析项可由 `dlinfo(handle, RTLD_DI_UNRESOLVED, ...)` 读出。因此 **`dlopen` 成功 ≠ 该对象的所有符号都已就绪**
- **与基镜像或此前已加载对象重名的符号被视为错误，该对象不会被加载**；**不支持符号版本**
- 重复 `dlopen` 同一对象只增加引用计数，**地址空间中只保留一份副本**（即使路径名不同）
- `dlopen(NULL, ...)` 返回覆盖"基镜像 + 以 `RTLD_GLOBAL` 加载的对象及其依赖"的全局符号表句柄
- `dlclose` 引用计数归零后卸载；**若其提供的符号仍被其他常驻对象引用则无法卸载**；未被显式加载且无人引用的对象会被自动移除。初始化函数按**加载顺序**在 `dlopen` 返回前运行
- **基镜像本身没有符号表**：需用 `rtems-syms` 从基镜像提取全局/弱符号，生成符号表对象，然后**嵌入基镜像（需链接两次）或在运行期先行加载**。**符号表必须与基镜像匹配，且不做校验**——用错符号表是静默错误
- 加载对象必须是**目标架构、与基镜像相同的 ABI 标志**，且**与 RTEMS 版本绑定**；`rtems-execinfo` 可报出构建标志
- **动态加载不被视为实时活动**：应在系统稳定时进行，而不是响应实时事件时；其内存开销高于静态链接，装载地址取决于加载顺序与分配器

## 决策树

```
拿到 RTEMS 目标
├─ 先确认：单地址空间（OS/库/应用同地址空间）
│    └─ 不要按"每进程独立映射"的思路解释地址或可见性
├─ 找配置
│    ├─ 找定义 CONFIGURE_INIT 的那一个翻译单元 → 配置实例化点
│    ├─ 由 CONFIGURE_* 宏还原：任务数、调度器、时钟节拍、初始化任务、驱动容量
│    └─ 驱动表按约定名 Device_drivers（或自定义时定义了 CONFIGURE_HAS_OWN_DEVICE_DRIVER_TABLE）
├─ 找设备
│    ├─ 走 rtems_driver_address_table：major = 表索引 → 六个回调
│    ├─ 文件名关联看 rtems_io_register_name(name, major, minor)
│    └─ 别套 Linux file_operations；网络驱动不在驱动表里
└─ 见到 dlopen
     ├─ 别套 Unix 共享库模型：它是"重定位进当前地址空间"，接近静态绝对链接
     ├─ 对象可能是 archive 成员（libfoo.a:bar.o[@offset]）
     ├─ 懒/立即绑定无区别：返回前重定位已完成
     ├─ dlopen 成功 ≠ 符号就绪（未解析不报错，需 dlinfo 查）
     └─ 基镜像无符号表 → 需 rtems-syms 生成且必须与该镜像匹配（不校验）
```

## 工具与验证

- 配置：`confdefs.h` 及其被实例化的位置（`CONFIGURE_INIT` 所在文件）
- 设备：设备驱动表（`Device_drivers` 约定名）、`major`/`minor` 与 `rtems_io_register_name` 的关联
- 可加载对象：`rtems-syms`（生成与基镜像匹配的符号表）、`rtems-execinfo`（查看 ELF 的构建标志）
- 运行期：`dlinfo` 的未解析重定位报告（`RTLD_DI_UNRESOLVED`）
- 验证：能同时说清「配置来源（哪个宏/哪张表）+ 设备分派路径（major 索引）+ 可加载对象的符号来源与匹配关系」

## 该平台的坑（汇总）

- **把 `dlopen()` 理解成 Unix 动态库装载**：它是把可重定位目标重定位进当前地址空间，更接近静态链接
- **拿共享库命名空间、`DT_NEEDED`、符号版本那套解释行为**：RTEMS 不支持符号版本，重名符号直接判错
- **以为懒绑定会推迟解析**：`RTLD_LAZY` 与 `RTLD_NOW` 行为相同，返回前全部重定位完成
- **把 `dlopen` 成功当作符号全部就绪**：未解析符号不会导致失败，要另行查询
- **看不懂 `libfoo.a:bar.o` 这类对象名**：那是 RTEMS 自己的 archive 成员编码（可带偏移）
- **用 Linux `file_operations` 模型找设备回调**：应恢复设备驱动表与 major（表索引）/minor
- **在设备驱动表里找网络驱动**：网络驱动不配在这张表里
- **忽略 `CONFIGURE_INIT` 唯一性**：它必须只在一个源文件中定义，这也是定位配置实例化点的线索
- **拿配置估算值当精确内存需求**：`confdefs.h` 是估算，且设备驱动与附加库资源不在其计算内
- **以为基镜像自带符号表**：静态链接的基镜像没有，需要 `rtems-syms` 生成并保证匹配（不匹配也不会报错）
