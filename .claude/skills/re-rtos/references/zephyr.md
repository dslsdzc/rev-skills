# Zephyr：编译期设备图 / iterable sections / LLEXT

<CORE RULE>
**Zephyr 里大量"运行时对象"其实在编译期就由 Kconfig + devicetree + linker 生成好了。**

```
driver_init()   ← 0 个直接 xref
```

**这不是 dead function。** 它可能是被 `DEVICE_DEFINE` / `SYS_INIT` / iterable section 注册进系统的——**引用关系在链接期成立，不在源码里成立**。

所以第一条判断是：**先看它是不是被"注册"进去的，再谈它是否可达。**
</CORE RULE>

## 一、设备不是"被注册的"，是"被链接进来的"

- `DEVICE_DEFINE`（基础）/ `DEVICE_DT_DEFINE`（devicetree 感知，单实例）/ `DEVICE_DT_INST_DEFINE`（实例化驱动，配 `DT_DRV_COMPAT`）会把设备元数据放进**专门的 linker section**，内核启动时**统一遍历**
- 历史上设备与 `SYS_INIT` 共用一套 init 基础设施，**后来被拆开**：设备进入自己的 section，但沿用同一套 init level
- 同一 level 内，**先初始化设备，再执行 `SYS_INIT` 调用**；顺序由 linker 排序保证
- 内核按 section 迭代的顺序是**确定的**——所以"init 顺序"在 Zephyr 里是可推导的，不是运行期偶然

**RE 含义**：看到一个 `struct device` 实例没有任何代码引用它，**先去找它落在哪个 section**，而不是标 dead data。

## 二、`SYS_INIT`：注册式入口，且**返回值有后果**

- 形态：`SYS_INIT(func, level, prio)`，函数签名 `int (*)(const struct device *dev)`
- level：**`PRE_KERNEL_1` → `PRE_KERNEL_2` → `POST_KERNEL` → `APPLICATION`**（SMP 下另有对应层级）；`prio` 决定**同一 level 内**的先后（数值小的先跑）
- **`PRE_KERNEL_1` / `PRE_KERNEL_2` 跑在内核初始化上下文中（中断栈）**，其余 level 跑在内核主任务中
- **返回非零（错误码）可能导致启动失败**——分析"为什么起不来"时，这是一条应逐一核对的路径，而不是先怀疑硬件

## 三、iterable sections：别把注册表当混淆表

Zephyr 的 iterable sections 把**相同结构体的实例放进连续的 linker section**，运行时统一遍历；**条目甚至按名称排序**。

所以看到下面这些，**不要轻率判定为 vtable / jump table / 混淆表**：

- 一整段**规则排列**的函数指针或结构体
- 条目**按名字有序**、字段布局完全一致
- 数量正好等于某个配置项（Kconfig）能算出来的值

**先假设它是 linker 生成的注册表**，到构建产物（map 文件、section 名）里核对，再下结论。

## 四、init level 的语义约束：early init 的"缺省行为"是设计

`PRE_KERNEL_1` / `PRE_KERNEL_2` 阶段，**内核服务尚不可正常使用**。因此：

```
early init 里：不调用 mutex / thread / sleep，只配 IRQ / MMIO
```

**这符合设计**，不是"代码被裁剪"或"缺少同步所以是漏洞"。

**反过来才是异常**：如果 early init 里出现了创建线程、取互斥、睡眠这类调用，**优先怀疑阶段判断错了**（它可能不是 early init），而不是先判"违反约定"。

## 五、恢复 devicetree 时：`/chosen` 与 `/aliases` 不是硬件

- `/chosen` 与 `/aliases`**本身不是硬件节点**，只是**对其他节点的引用/选择**（以及启动参数类信息）
- 因此逆向恢复 DT 时**不能创建一个假设备节点 "chosen"**——那会把"引用"变成"实体"，后续所有依赖它的推断跟着错
- 同样，`status = "disabled"` 的节点**仍然存在于 DT 里**：**"DT 里有"不等于"被编译进设备图"**，要结合该节点的实际引用与构建配置判断

## 六、map 文件是这一域的"交叉引用替代品"

**验证设备/init 归属，最直接的证据是构建产物**：

- 在 `build/zephyr/zephyr.map` 里搜 `__init_PRE_KERNEL` / `__init_POST_KERNEL` 一类的 section 名，可以直接看到**谁落在哪个 init 段**
- 同理可核对设备 section、iterable section 的成员与顺序

**RE 主线因此是**：源码符号只当线索，**归属问题一律回到 linker section / map 文件裁决**。

## 七、LLEXT：运行期装载的 ELF 扩展，但不是 Linux `.ko`

现代 Zephyr 支持运行期装载 ELF 扩展（**Linkable Loadable EXtensions**）：

- 扩展是**经预编译的 ELF 可执行文件**，可被校验、装载、与主镜像链接，之后卸载
- 有**独立的导出符号表**；架构相关支持有限（并非所有架构都可用）
- 装载：`llext_load(loader, name, &ext, ldr_parm)` 返回 `struct llext` 或负错误码；loader 可为缓冲区实现等
- 初始化：`llext_bringup`（调用 `.preinit_array` / `.init_array`）、`llext_teardown`（清理）、`llext_bootstrap`（两者兼具，可配 `k_thread_create`）
- **`llext_unload` 之后，先前取得的所有符号指针全部失效**——"卸载后指针还能用"是错的
- 两张符号表要分清：**`sym_tab`**（扩展内全部全局符号，供内部链接）与 **`exp_tab`**（扩展**导出**的符号，供主镜像查找，宏为 `LL_EXTENSION_SYMBOL`）；查找用 `llext_find_sym(表, 名)`，**传 NULL 表表示查主镜像的符号表**
- 主镜像侧有一张专门的 LLEXT 符号表（每个导出符号一条 名字→地址）。开启 **SLID**（把名字换成指针宽度的哈希）可加快查找并缩小表，但**主镜像与扩展必须用同一设置**——不一致会表现为"符号找不到"

**最值得记住的特殊情况**：

```
扩展装载成功、内核能调用它
但用户线程一访问就 fault
```

若启用了 **User Mode**，先查是不是**没有把扩展加入相应的内存域**——扩展**默认不属于任何用户内存域**，需要显式调用 `llext_add_domain(ext, domain)` 把扩展的内存区加进 `k_mem_domain`；未启用 User Mode 时该函数返回 `-ENOSYS`。

## 决策树

```
拿到 Zephyr 目标
├─ 某个 init/设备函数没有直接 xref
│    ├─ 查它是否被 DEVICE_DEFINE / DEVICE_DT_DEFINE / SYS_INIT 注册
│    ├─ 查它落在哪个 linker section（map 文件 / __init_* section 名）
│    └─ 别标 dead code
├─ 一整段规则排列的结构体/函数指针
│    ├─ 先按 iterable section / 注册表理解
│    └─ 到 map 与 section 名核对，再考虑 vtable / jump table / 混淆
├─ early init 里没调用内核服务
│    └─ 符合 PRE_KERNEL_* 的设计约束，不是被裁剪
│    （反之：early init 里出现线程/互斥/睡眠 → 先怀疑阶段判断错了）
├─ 恢复 devicetree
│    ├─ /chosen 与 /aliases 是引用，不建假设备节点
│    └─ disabled 节点仍在 DT 里：DT 里有 ≠ 进了设备图
└─ LLEXT 相关
     ├─ 装载/链接失败 → 符号表（sym_tab/exp_tab）、SLID 设置是否与主镜像一致、架构是否支持
     ├─ 内核能调、用户线程 fault → 查是否调用 llext_add_domain 加入内存域
     └─ 卸载之后指针失效属预期，不是 UAF
```

## 工具与验证

- 归属与顺序：构建产物 `zephyr.map` 中搜 `__init_PRE_KERNEL*` / `__init_POST_KERNEL*` 与设备 section 名
- 配置：Kconfig（决定哪些对象会被生成）+ devicetree（决定节点与实例是否存在）
- 调试：LLEXT 侧提高日志等级；用符号文件配合正确的加载偏移（通常取 `.text` 起始）做符号化
- 验证：能同时说清「对象来源（源码 / linker 生成 / 运行期扩展）+ 所属 section 或 init level + 是否进入设备图」

## 该平台的坑（汇总）

- **把无 xref 的 init/设备对象当 dead code**：它们由 linker section 注册，引用关系在链接期成立
- **把规则排列的注册表当 vtable / jump table / 混淆表**：iterable section 的条目本就连续且按名排序
- **把 early init 的"不调用内核服务"当裁剪或缺陷**：`PRE_KERNEL_1`/`PRE_KERNEL_2` 阶段服务尚不可用，这符合设计
- **反过来漏判**：early init 里出现线程/互斥/睡眠，先怀疑"这根本不是 early init"
- **给 `/chosen`、`/aliases` 造硬件设备节点**：它们只是引用，不是实体
- **以为 DT 里有的节点就一定生效**：`status = "disabled"` 的节点仍在 DT 中，是否进入设备图要看构建与引用
- **用源码调用图替代 linker 归属判断**：顺序与成员应当到 section / map 文件里裁决
- **把 LLEXT 当 Linux `.ko`**：它是 ELF 扩展，有独立的导出符号表、架构限制与初始化数组语义
- **LLEXT 装载成功就以为用户态可用**：扩展默认不属于任何用户内存域，需 `llext_add_domain`
- **卸载扩展后继续使用旧符号指针**：`llext_unload` 后这些指针全部失效
- **主镜像与扩展的符号查找设置不一致（如 SLID）**：会表现为莫名其妙的"符号找不到"
