# illumos / Solaris：DDI/DKI 驱动骨架 / dev_ops / cb_ops

<CORE RULE>
illumos 的驱动骨架**非常固定**，所以反而好恢复——**关键是别把它当成 load/unload + file_operations 那一套**：

```
_init / _fini / _info
  → modlinkage
  → modldrv
  → dev_ops        （设备级操作：getinfo / probe / attach / detach / power / quiesce …）
  → cb_ops         （字符/块级操作：open / close / read / write / ioctl / mmap/devmap …）
```

第二个关键点是**占位符有语义**：

| 占位 | 含义 |
|---|---|
| **`nulldev`** | 合法 no-op（该入口不需要做事） |
| **`nodev`** | **不支持该操作，返回 `ENXIO`** |

**把两者都归成 "unused" 会直接把"这个驱动支持什么"判断错。**
</CORE RULE>

## 一、模块入口三件套

| 入口 | 职责 |
|---|---|
| **`_init`** | 一次性、模块级初始化（如 soft state 初始化、驱动全局互斥）；随后调用 **`mod_install(&modlinkage)`**；若安装失败必须**回滚已做的初始化，并返回相应错误** |
| **`_fini`** | 调用 **`mod_remove(&modlinkage)`**；**只有成功时**才释放 `_init` 里分配的资源 |
| **`_info`** | 返回模块信息，通常就是把 `modlinkage` 交给 `mod_info()` |

两条容易忽略的约束：

- **每实例初始化属于 `attach()`，不属于 `_init()`**——在 `_init` 里找"某个设备实例的初始化"会扑空
- **`_init` 调用 `mod_install()` 之后不得再改挂在 `modlinkage` 上的数据结构**（系统可能复制或改动它们）
- **`_fini` 可能在仍有硬件实例 attach 的情况下被调用**：此时 `mod_remove()` 失败，**驱动不得释放资源**——"卸载函数里一定会释放"不成立

## 二、modlinkage / modldrv：从入口到 dev_ops 的桥

- **`modldrv`** 里放：模块类型（`&mod_driverops`）、一句描述、以及**指向该驱动 `dev_ops` 的指针**
- **`modlinkage`** 里放：`MODREV_1` 与指向 `modldrv` 的指针（其后为 NULL 结尾）
- 这个 `modlinkage` 正是传给 `mod_install()` / `mod_remove()` / `mod_info()` 的东西

**RE 含义**：`_init` 的第一个参数/locals 会指向 `modlinkage`——**顺着这条静态引用链，可以一次拿到 dev_ops 与 cb_ops 的位置**，比从 `open` 反着找快得多。

## 三、dev_ops：设备级操作（字段在编译期全部设定）

| 字段 | 说明 |
|---|---|
| `devo_rev` | 驱动构建版本，置为 `DEVO_REV` |
| `devo_refcnt` | 引用计数，置 `0` |
| `devo_getinfo` | 取驱动/设备信息 |
| `devo_identify` | **已废弃**，按约定置 `nulldev` |
| `devo_probe` | 探测设备（自识别设备不需要 probe 时置 `nulldev`） |
| `devo_attach` | 附着/恢复：`int (*)(dev_info_t *dip, ddi_attach_cmd_t cmd)` |
| `devo_detach` | 脱离/挂起：`int (*)(dev_info_t *dip, ddi_detach_cmd_t cmd)` |
| `devo_reset` | 本版本不支持，**置 `nodev`** |
| `devo_cb_ops` | 叶驱动指向 `cb_ops` |
| `devo_bus_ops` | nexus（总线）驱动用；叶驱动为 `NULL` |
| `devo_power` | 电源管理 |
| `devo_quiesce` | 静默设备；可置为"无需 quiesce"的实现 |

外加 `devo_getinfo` / `devo_identify` 一类占位：**`nulldev` 与 `nodev` 的选择本身就是"该驱动支持什么"的编码**。

## 四、`attach` / `detach` 的命令值：不是"第一次附着"那么简单

`attach(9E)` 的语义就是**"附着设备，或恢复设备"**，由 `cmd` 区分：

- **`DDI_ATTACH`**（必需）：初始化某个设备实例；**每个实例调用一次**；此时常规内核服务可用；**在 attach 成功之前，驱动能被调用的入口极少**（另有 `getinfo`）
- **`DDI_RESUME`**（可选，支持挂起/恢复才需要）：在 `detach(9E)` 以 **`DDI_SUSPEND`** 成功返回之后被调用；必须**恢复硬件状态**（电源可能已被移除）、让挂起的请求继续、并服务新请求；**不得对硬件当前状态作假设**
- 版本差异：更老的 Solaris 资料里还有 **`DDI_PM_RESUME`**（配套 `DDI_PM_SUSPEND`），属于**已废弃的 PM 接口**（`pm(9P)` 已说明原 PM 接口过时）——**见到它说明代码年代较早**，不要把它当"厂商私有扩展"
- 还有一类 `pm-hardware-state` 属性（`needs-suspend-resume` / `no-suspend-resume` / `parental-suspend-resume`）会**影响 `detach(DDI_SUSPEND)` 与 `attach(DDI_RESUME)` 是否被调用**——"挂了但没走到 resume"可能是配置决定的
- 返回值：**`DDI_SUCCESS` / `DDI_FAILURE`**；遇到保留值必须返回失败

所以下面这种 switch **不是奇怪写法**：

```c
switch (cmd) {
case DDI_ATTACH: ...
case DDI_RESUME: ...
}
```

**把 resume 分支判成 vendor 扩展，是这一域典型误判。**

## 五、cb_ops：字符/块操作，占位符语义同样重要

叶驱动经 `devo_cb_ops` 指向 `cb_ops`，其中包含 open / close / read / write / ioctl / devmap / mmap / segmap / chpoll / prop_op / … 以及 `cb_flag`（如 `D_MP`）与版本字段。

典型填写方式（可直接当"这个驱动到底支持什么"的判据用）：

```
nodev  → 明确不支持该操作（返回 ENXIO）
nulldev → 不需要做事的合法占位
nochpoll / ddi_prop_op 一类 → 专用默认实现
NULL   → 例如不使用 STREAMS 时 cb_stream 为 NULL
```

## 决策树

```
拿到 illumos/Solaris 驱动
├─ 先走骨架：_init → modlinkage → modldrv → dev_ops → cb_ops
│    ├─ _init 里 mod_install 的参数即 modlinkage（静态引用链一次拿全）
│    └─ 每实例初始化在 attach()，不在 _init()
├─ dev_ops 逐字段读"支持什么"
│    ├─ nulldev = 合法 no-op
│    ├─ nodev  = 不支持（ENXIO）
│    ├─ devo_reset = nodev（本版本不支持）
│    └─ devo_identify = nulldev（已废弃）
├─ attach 里的 switch
│    ├─ DDI_ATTACH 必需；DDI_RESUME 配套 detach 的 DDI_SUSPEND
│    ├─ 见到 DDI_PM_RESUME → 已废弃的 PM 接口，不是私有扩展
│    └─ 没走到 resume 也可能是 pm-hardware-state 属性决定的
├─ cb_ops 逐字段读字符/块能力（注意 nodev / nulldev / NULL 的区别）
└─ 卸载路径
     ├─ _fini 调 mod_remove，失败时不得释放资源（可能仍有实例附着）
     └─ _init 在 mod_install 之后不得再改 modlinkage 上的结构
```

## 工具与验证

- 入口与注册：`_init` / `_fini` / `_info` 三件套与 `modlinkage`→`modldrv`→`dev_ops` 的静态引用链
- 能力清单：逐字段读 `dev_ops` 与 `cb_ops`，**把 `nulldev` / `nodev` / 专用默认 / `NULL` 分别记录**（这是"支持什么"的原始编码）
- 附着路径：`attach` / `detach` 的 `cmd` 分支集合（`DDI_ATTACH` / `DDI_RESUME` / `DDI_SUSPEND`，及历史 `DDI_PM_*`）
- 验证：能同时说清「骨架链（谁指向谁）+ 每个占位符的语义 + attach/detach 支持的命令集」

## 该平台的坑（汇总）

- **把 illumos 驱动当"load/unload + file_operations"**：骨架是 `_init/_fini/_info` → `modlinkage` → `modldrv` → `dev_ops` → `cb_ops`
- **把 `nulldev` 与 `nodev` 都恢复成 unused**：前者是合法 no-op，后者表示不支持并返回 `ENXIO`——混同会判错驱动能力
- **把 `attach()` 理解成"只在第一次附着时调用"**：它还承担**恢复**语义（`DDI_RESUME`），命令值决定行为
- **把 `DDI_RESUME` 分支 / `DDI_PM_RESUME` 当厂商私有扩展**：前者是标准命令值，后者是已废弃的 PM 接口（年代线索）
- **在 `_init` 里找设备实例的初始化**：实例初始化属于 `attach()`
- **以为 `_fini` 一定会释放资源**：`mod_remove()` 失败时（仍有实例附着）不得释放
- **在 `mod_install()` 之后继续改 `modlinkage` 上的结构**：违反约定，且系统可能已复制或改动这些数据
- **忽略 `pm-hardware-state` 一类属性**：它决定挂起/恢复路径是否被调用，"没走到"不一定是缺陷
