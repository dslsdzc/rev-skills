# Linux 内核模块（.ko / LKM）分支

**前提认知**：`.ko` 是 **ET_REL（可重定位目标文件）**，不是普通 ELF 可执行——**relocation 本身是很强的逆向信息**，别把它当噪音。

## 一、正常分析路径（不要上来就丢反编译器）

| 遇到的情况 | 处理方法 |
|---|---|
| 普通未剥离 .ko | 先看 ELF section、`.modinfo`、symbol、**relocation**、imports/exports，再反编译 |
| stripped .ko | 优先从 **relocation + undefined symbol** 恢复语义；其次找 BTF、匹配的 vmlinux、源码 |
| 不知对应哪个 kernel | 查 **vermagic**，再核对 **CONFIG_MODVERSIONS / symbol CRC**——只匹配 `uname -r` 不够 |
| 第三方闭源驱动 | **imports 通常比内部函数名更有价值**：按内核 API 调用关系切分功能 |
| 已加载模块 | 磁盘 `.ko` 与**运行时内存分开分析**——relocation 已应用，init-only 内容可能已消失 |
| 找不到 .ko | 考虑它是 **built-in**（不要默认一定有模块文件）；built-in 的参数甚至可能来自 kernel command line |

功能骨架示例：一个 stripped 驱动只要还剩这些 undefined symbol，功能已经呼之欲出——

```
pci_register_driver / request_irq / dma_alloc_coherent / copy_from_user / misc_register
```

**CONFIG_MODVERSIONS**：内核把导出接口原型压成 CRC；**CRC 不匹配会直接导致模块拒绝加载**（官方定位：ABI consistency check）。所以"内核版本看着一样、模块就是插不进去"时，不能只盯 vermagic，要看 `Module.symvers` / `__versions`。

## 二、四类"看着像坏文件"的合法形态（别误判，别破坏证据）

1. **签名尾附加**：Linux 模块签名**直接附加在 ELF 文件末尾**，不属于标准 ELF container：
   `ELF end` → 模块签名 → `~Module signature appended~.`
   **不要为了"修 ELF"随手 truncate，也不要先 strip**——签过名的模块 strip 会破坏签名。
2. **stripped 得很干净，却出现 `.BTF`**（可能是好事）：BTF 能恢复 struct / union / enum / typedef / 函数原型 / member offset。
   - 分支：**standalone BTF** → 直接恢复类型；**split BTF + `.BTF.base`** → 模块 BTF 不是独立完整的，需要**配套 kernel base BTF** 才能正确解释（`.BTF.base` 只在外置模块构建（`KBUILD_EXTMOD`）时生成，用于把 split BTF 重定位到可能已变化的 base）→ 找对应 vmlinux BTF → relocation → 再导入 RE 工具。
   - **type ID 对不上 ≠ 文件损坏**。
3. **结构体 offset 怎么都对不上源码** → 先怀疑 **`CONFIG_GCC_PLUGIN_RANDSTRUCT`**（刻意随机化部分内核结构布局；此类内核会带 **taint `T`**，在 `/proc/sys/kernel/tainted` 与 Oops 的 Tainted 行可见），而不是先怀疑反编译器。
   处理优先级：**目标 BTF > exact build debug info > exact randstruct seed + config > 动态验证 > 猜 offset**（最后一种最差）。
4. **relocation 完全怪异** → `modinfo <ko> | grep livepatch`，为 `Y` 则是 **livepatch 模块**：使用专用节 `.klp.rela.<object>.<section>` 与符号 `.klp.sym.<object>.<symbol>,<sympos>`（`SHN_LIVEPATCH`），可以引用普通模块**根本无法引用**的 unexported / local 符号，且**某些 relocation 要等目标模块以后加载时才应用**——别判成"损坏的 relocation / unresolved symbol"。

## 三、符号解析：5.7 起的变化

- **Linux 5.7 起**：`kallsyms_lookup_name()` 与 `kallsyms_on_each_symbol()` **不再导出给模块**（内核内部仍存在，`/proc/kallsyms` 仍能看到地址）。依赖它们做符号解析的模块在 5.7+ 会失败——分析时据此解释"为什么这个模块在新内核上起不来"，也需要另找取址路径（kprobe 间接取址、模块参数传地址等）
- 可用观测面：`/proc/kallsyms`（受 `kptr_restrict` 影响）、`/sys/module/<name>/sections/`（各节运行时地址）、`/sys/module/<name>/`（参数、引用计数、taint）、BTF（`pahole` / `bpftool btf dump`）
- **kprobes 通常由 kernel module 注册**（官方文档：模块 init 里 `register_kprobe()`、exit 里注销），可对绝大多数内核 routine 做动态观测——这既是观测手段，也是"恶意模块能挂钩几乎所有内核例程"的证据面；ftrace/kprobe 同样是被滥用的 hook 落点

## 四、rootkit / 已不可信的 kernel：不要相信单一视图

- 经典手法：模块**把自己从 kernel module 链表摘掉**（DKOM 等价物）→ `lsmod` / `/proc/modules` 看不到，**但模块还活着**
- 所以"`lsmod` 什么都没" ≠ "没有 LKM rootkit"。正确做法是 **cross-view 交叉**：

```
用户态视图：/proc/modules、/sys/module、kallsyms 对比
    ↕ 比较
内核真实状态：module list、内核可执行内存区间、已知 vmlinux / 模块 text 区间
```

- Volatility 的 hidden module 检测正是"module list vs sysfs `/sys/module`"的交叉视图；**视图互相矛盾时，优先信任离线内存取证**，而不是受感染系统自己给出的输出
- hook 落点**不止 syscall table**：`file_operations`、`seq_operations`、proc handlers、网络协议回调、ftrace、kprobes、inline text 都被用过（老式样本会同时碰 syscall table 与网络 operation 结构）。因此 **"syscall table 没 hook"绝不意味着内核没被 hook**——Volatility 对 syscall / AF info / module 分别做独立检查，说明不存在"一招检测全部"
- 也别把"`/sys/module` 找不到"当终局证据（现代样本可能连 sysfs 一并隐藏）——最终仍是内存 cross-view
- 在线采集侧方法（如何拿到内存与执行上下文）见 [[re-sample-acquire]] 的 Linux 分支

## 工具与验证

- 身份与结构：`file` / `readelf -h`（确认 **ET_REL**）、`readelf -S`（`.modinfo` / `.BTF` / `.BTF.base` / `.klp.*` / ORC）、`modinfo <ko>`（vermagic / 依赖 / 签名 / livepatch）
- 符号与重定位：`nm`、`objdump -r`（relocation 与 undefined symbol 是 stripped 模块的主要线索）
- 类型：`pahole`、`bpftool btf dump file <ko>`
- 运行时：`/proc/kallsyms`、`/sys/module/<name>/sections/`、`bpftrace` / `perf probe`（kprobe）、`ftrace`
- 验证：对目标 `.ko` 能同时给出「ET_REL 确认 + vermagic/CRC 归属 + 由导入符号推出的功能骨架」

## 该平台的坑

- **把 .ko 当普通 ELF 可执行分析**：ET_REL 的 relocation 是信息不是噪音
- **为"修好"带签名尾的 .ko 去 truncate/strip**：破坏签名，也破坏证据
- **见到 `.BTF` 里 type ID 对不上就判"文件损坏"**：可能是 split BTF，需要 base BTF
- **用同版本源码的 offset 硬套**：先排除 RANDSTRUCT（taint `T`）
- **把 livepatch 的 `.klp.rela` 当损坏的 relocation**
- **用 5.7 之前的经验解释符号解析失败**：`kallsyms_lookup_name` 已不再导出给模块
- **只跑 `lsmod` 就下"没有 rootkit"结论**：必须 cross-view
