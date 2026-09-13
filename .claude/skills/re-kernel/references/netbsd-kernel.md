# NetBSD：按需自动加载模块 / 兼容性约束 / 模块路径布局

<CORE RULE>
NetBSD 的 loader 与 Linux 很像，但模块模型不同：**内核可以在需要时自动加载模块**。

于是现场出现：

```
没有 modload
没有明显的启动脚本
但 xyz.kmod 突然进了内核
```

**不一定存在隐藏 loader**——可能只是：

```
操作请求 → 内核 module 子系统按需加载（依赖模块会被递归带上）
```

这对**时间线逆向**很关键：模块出现的时间点对应的是**某个操作**，而不是某个进程。
</CORE RULE>

## 一、按需加载与自动卸载

- 内核组件用 `module_autoload(name, class)` 定位并加载可选的系统组件（也用于加载其他模块所需的依赖）
- **典型触发**：第一次挂载某类文件系统时，对应模块被自动带入
- **自动卸载**：自动加载的模块会被标记为可自动卸载——一个内核线程在加载后不久（当前实现约 10 秒）尝试卸载，走 `MODULE_CMD_AUTOUNLOAD`，**模块可以返回非零来拒绝**
- 若设置了 `kern.module.autounload_unsafe`，则返回 `ENOTTY`（表示未审计为可安全自动卸载）的模块**也可能被自动卸载**
- **`noautoload` 属性**（同名 `.plist` 里设为 true）使系统**拒绝加载**该模块
- **手工用 modload 加载的模块永远不会被自动卸载**

## 二、兼容性：模块只与特定版本的内核配套

- loader 会检查模块版本与 `__NetBSD_Version__` 的兼容性；不匹配时打印类似
  `module 'X' built for 'N', system 'M'` 的警告
- **不带 force 标志则加载失败**（`EPROGMISMATCH`）
- **`MODCTL_LOAD_FORCE`（`modload -f`）会强制加载**，并记录 `forced load, system may be unstable`——**这是官方明确警告过的路径**，不兼容模块可能造成数据损坏或崩溃
- 同一标志还能强制重新加载**被禁用的内建模块**：卸载内建模块会把它标记为禁用，之后**只有带 force 才能再加载**
- `MODCTL_NO_PROP` 会跳过定位模块的 `.plist` 属性字典（默认会去找同名 `.plist` 并合并属性）

**所以**：

```
模块 ELF 看起来正常、符号也在、load 就失败
  → 先查 exact kernel version/build 与模块兼容性
  → 而不是先怀疑 loader 或文件损坏
```

## 三、模块放在哪：路径不是永久契约

- 传统布局：内核在 `/netbsd`，调试内核 `/netbsd.gdb`，模块在 `/stand/<arch>/<version>/modules/`
- **自 2025-04-28 起（UPDATING 20250427）新增构建选项 `KERNEL_DIR`**：把**内核、其调试内核与内核模块放进同一个以内核命名的目录**——

```
旧: /netbsd（内核）、/netbsd.gdb、/stand/amd64/<版本>/modules
新: /netbsd/kernel、/netbsd/kernel.gdb、/netbsd/modules
```

- 该选项**只针对 i386 与 amd64**，且**完全是可选的**（同一台机器上两种布局都可能有）
- **需要更新过的三级 bootloader**（GPT/EFI 引导需更新 EFI 分区上的引导程序）；bootloader 会按序尝试 `/netbsd/kernel`、`/onetbsd/kernel`、`/netbsd.old/kernel`
- 已知问题：用了 `KERNEL_DIR` 但内核仍以文件形式放在 `/netbsd` 时，`dmesg` 会报出错误的 `kern.module.path`

**RE/取证含义**：**硬编码 `/stand/...` 的工具会开始漏样本**；判断"模块在哪"应当读运行时报告（`kern.module.path`）或按两种布局分别探测。

## 四、其他现场约束

- **MODULAR 内核启动失败的常见原因是模块缺失或 bootloader 无法加载**，症状可能表现为 `Cannot mount root, error 79` 一类——不要先当成磁盘/内核损坏
- **模块加载的分寸**：模块成为内核的一部分；只有 **securelevel ≤ 0** 或内核编译时带 `INSECURE` 才允许加载新模块

## 决策树

```
拿到 NetBSD 目标
├─ 模块"自己出现了"
│    └─ 先按 module 按需自动加载解释（含依赖递归），对齐到触发它的操作
├─ 模块不见了
│    └─ 查是否被自动卸载（约 10 秒后的尝试）或 noautoload/禁用状态
├─ 模块加载失败但文件看着正常
│    ├─ 查 exact kernel version/build 与兼容性
│    └─ 别直接上 -f/强制加载（官方警告可能不稳定/损坏数据）
├─ 找不到模块文件
│    ├─ 读运行时的模块路径报告
│    └─ 按 /stand/<arch>/<ver>/modules 与 <kernel>/modules 两种布局分别探测
└─ 启动失败
     └─ 先查模块缺失/bootloader 能否加载，再谈内核或磁盘
```

## 工具与验证

- 模块子系统：modctl 一族的工具（加载/卸载/查询）与模块的 `.plist` 属性
- 路径与布局：运行时的模块路径报告、两种布局的目录探测、bootloader 的查找顺序
- 兼容性：模块版本与内核版本报告的比对
- 验证：能同时说清「模块为何出现/消失（自动加载或卸载 vs 手工）+ 版本兼容状态 + 实际路径布局」

## 该平台的坑（汇总）

- **找不到显式加载动作就判"模块没加载"**：可能是按需自动加载（含依赖递归）
- **把自动卸载当"模块被恶意移除"**：自动加载的模块会被尝试卸载，且模块自己可以拒绝
- **忽略 `.plist` 的 `noautoload`**：那会让系统拒绝加载，不是文件损坏
- **加载失败就去改 loader/patch 模块**：先核对内核版本与兼容性
- **随手 `-f` 强制加载**：官方明确警告不兼容模块可能损坏数据或崩溃
- **以为卸载内建模块后就干净了**：它只是被标记禁用，仍需 force 才能再加载
- **硬编码 `/stand/<arch>/<version>/modules`**：新布局把模块放到内核目录下，会漏样本
- **把启动失败直接当内核/磁盘损坏**：先查模块缺失与 bootloader 加载能力
