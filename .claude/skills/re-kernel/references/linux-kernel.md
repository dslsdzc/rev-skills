# Linux 内核模块分支（.ko / LKM / 运行态内核）

<CORE RULE>
**三个不要**：
① 不要把 `.ko` 当普通 ELF 程序（它是 ET_REL，relocation 才是主线）；
② 不要把**磁盘上的代码**当运行态绝对真值（relocation、KASLR、alternatives、jump labels、ftrace/livepatch/paravirt patching、init 段释放都会让两者不同）；
③ 怀疑 rootkit 之后，**不要相信由那个内核自己产生的单一枚举结果**。

Linux 比 seL4 更麻烦的地方恰在这里：**大量"看起来像被篡改"的现象其实是内核合法的动态 patching 机制**。不知道 `__ex_table`、jump labels、livepatch、ftrace、BTF、MODVERSIONS、init 释放这些东西，会产生大量事实性误判。
</CORE RULE>

## 一、先判断你拿到的到底是什么

| 目标 | 性质与处理 |
|---|---|
| `vmlinux` | 完整 ELF（最好分析；符号/类型/节齐全） |
| `bzImage` / `Image` / `zImage` | **boot image，不等于可直接分析的 ELF** |
| `*.ko` | 可加载模块，通常 **ET_REL** |
| `*.ko.xz` / `*.ko.zst` | 压缩模块（loader 有解压阶段，不是壳） |
| built-in driver | 根本没有独立运行时 `.ko` |
| livepatch module | 特殊 ELF（专用节，见 §14） |
| eBPF object | 看起来也是 ELF，**模型完全不同** |
| runtime memory image | 运行态（relocation 已应用、init 段已释放） |

- x86 的 **bzImage 本身是压缩 boot image**：拖进 IDA/Ghidra 会看到 boot stub、大量 16-bit code、后面识别不了——**这不是"内核做了混淆"**。正常路径：识别 architecture/boot format → **提取真正的 kernel image** → 得到 vmlinux-style ELF 或 raw Image → 再恢复符号/类型
- 现代内核支持模块解压（`.ko.xz`/`.ko.zst`）：loader 流程里 `kernel_read_file → 模块解压 → ELF 处理` 是**独立阶段**；系统报 `failed_decompress` 先查压缩算法/文件损坏，而不是去查符号依赖

## 二、`.ko` 不是共享库：relocation 优先

- `.ko` 的核心性质是 **ELF ET_REL**（不是 ET_EXEC / ET_DYN）——**relocation 是逆向主线**
- stripped 模块的信息价值排序（不是"没符号只能硬读汇编"）：

```
relocations / imported symbols  →  modinfo  →  BTF/DWARF  →  内核 API 调用模式  →  裸反汇编
```

- 例子：反编译器没恢复出函数名，但 `.rela.text` 里 `offset 0x183 / R_X86_64_PLT32 / symbol = pci_register_driver` ——**这条边实际上已经恢复了**。一个 stripped 驱动只要还剩 `pci_register_driver`、`request_irq`、`dma_alloc_coherent`、`copy_from_user`、`misc_register` 这类导入，功能骨架就出来了

## 三、先吃 `.modinfo`（便宜得离谱，却常被跳过）

- 字段：`license` / `author` / `description` / `alias` / `depends` / `vermagic` / `srcversion` / `parm` / `firmware` / `retpoline` / `intree` / `livepatch`
- **`alias` 直接说明设备匹配**：`alias: pci:v00008086d0000....` → 这是给什么设备用的；大量 `alias: usb:...` → 优先沿 `usb_driver` / `probe` / `disconnect` / `usb_control_msg` / `urb` 方向恢复
- **built-in 也有 modinfo**：`modules.builtin.modinfo`（字段带模块名前缀）；较新的构建还生成 `modules.builtin.ranges`（`CONFIG_BUILTIN_MODULE_RANGES`）——按 ELF 节给出 built-in 模块的地址偏移范围，配合 `System.map` 可把符号关联回模块名

## 四、"找不到这个 .ko" ≠ 没有这个逻辑

- 可能是 `CONFIG_FOO=y`（链进 vmlinux）而不是 `=m`
- 查证：`modules.builtin` / `modules.builtin.modinfo` / kernel config / `System.map` / `vmlinux`
- built-in 驱动甚至可接受 **kernel command line 参数**（`foo.option=value`）

## 五、磁盘有代码、内存里找不到 → 先想 `__init` 释放

- 初始化完成后内核**释放 init-only 内存**（`__init` / `__initdata` / `.init.text` / `.init.data`）；模块 init 成功后同样丢弃相应 initialization memory
- 所以运行态 dump 里找不到 `foo_init` **可能是正常现象**
- 对内存取证尤其重要：rootkit 的关键 setup（`install_hook()` / `patch_table()` / `register_callback()`）若全在 `module_init()` 路径，加载完成后 init code 自身已不存在，**但它制造出的 callback / hook / 改过的指针 / 持久对象仍在**
- 所以运行态逆向要问的不是"恶意 init 函数在哪"，而是"**init 最终留下了什么状态改变**"

## 六、模块加载失败：按阶段诊断，不要乱 patch

loader 自己把失败分成阶段（官方 `CONFIG_MODULE_STATS` 的计数器就是按此划分）：

```
read（kernel_read_file_from_fd）
  → decompress（vmap 解压缓冲）
  → 早期校验：module_sig_check（签名）/ elf_validity_cache_copy（ELF 校验）
              / early_mod_check（blacklist、节头重写、vermagic、livepatch 要求、已加载）
  → layout_and_allocate（最终落位）
  → 符号解析 → init
```

- 对应计数：`failed_kreads` / `failed_decompress`（官方注释：**除非压缩/解压坏了否则不该出现**）/ `failed_becoming`（读过之后、落位之前失败）/ `failed_load_modules`；debugfs 的 `stats` 文件直接给 "Mods failed on kread / decompress / becoming / load"
- 所以 `modprobe foo → Invalid module format` **不要一看到就去改 vermagic**——可能是 ELF 错、签名错、MODVERSIONS 错、架构错、livepatch 格式错；结合 `dmesg` + `modinfo` + `readelf` 判断

## 七、vermagic 相同 ≠ ABI 相同

- `CONFIG_MODVERSIONS=y` 时，内核把导出符号原型压成 **CRC**；CRC 不匹配即使 `uname -r`/vermagic 看起来一致也会拒绝加载
- 要匹配的是：**release + config + build flags + `Module.symvers` + symbol CRC**（`Module.symvers` 记录全部导出符号与 CRC）
- **格式有两代，别死写旧 parser**：
  - basic（`CONFIG_BASIC_MODVERSIONS`）：导入符号的 name+CRC 存在模块的 `__versions` 节，符号名上限 64 字节
  - extended（`CONFIG_EXTENDED_MODVERSIONS`）：名字在 `__version_ext_names`（连续 NUL 结尾字符串），CRC 在 `__version_ext_crcs`，支持长符号名；加载时校验两者**同时存在或同时缺失**，不匹配报 `-ENOEXEC`
- 导出侧：`__ksymtab` / `__ksymtab_gpl`（名字在 `__ksymtab_strings`），CRC 在 `__kcrctab` / `__kcrctab_gpl`

## 八、文件末尾"不是 ELF 的数据"：先查模块签名

- Linux 模块签名**直接附加在 ELF 之后**：`ELF` + signature blob + `~Module signature appended~.`
- 见到"节表已结束但文件还有数据"**不要自动判** overlay / packer / 恶意附加数据——先检查 module signature
- **签完名以后再 strip 会破坏签名**（官方称这种签名为 brittle：整个模块文件都是签名 payload）→ 要分析 signed module：**保留原件 → copy → 只对副本做 strip/解压/patch**

## 九、stripped 但有 `.BTF` / `.BTF.ext` —— 可能反而好逆

- BTF 给：struct / union / enum / typedef / 函数原型 / member offset
- **`.BTF.ext`** 还含 function info、line info 与 **CO-RE relocation**
- 所以 `.symtab` 被 strip 不等于类型信息全没：先查 `.BTF` / `.BTF.ext`，再决定怎么恢复类型

## 十、`.BTF` 里 type ID 全错 → 先查 split BTF

- 模块 BTF 可以是 **split BTF**：`vmlinux BTF` 为 base，模块只存新增类型，type ID 可引用 base
- 单独解析模块 `.BTF` 报"type 38291 不存在"**不是损坏**
- 新版 external module 可能带 **`.BTF.base`**：用于 base BTF 改变后重新定位 split BTF 引用（`btf__relocate()` 的用途）

```
.BTF
├── standalone → 直接解析
└── split → 找对应 vmlinux BTF
        └── 若有 .BTF.base → relocate 后再解析
```

## 十一、struct offset 与源码不符：按顺序排查

① exact kernel build? ② BTF 是否对应? ③ CONFIG 选项是否相同? ④ **结构布局随机化**（`CONFIG_GCC_PLUGIN_RANDSTRUCT`，此类内核带 taint `T`）⑤ vendor patch?

**运行态 kernel 自带 BTF/DWARF 的可信度高于"网上同版本源码"的 offset**——不是 IDA 错，也不是算错。

## 十二、磁盘代码 ≠ 内存指令：先排除**合法动态 patching**（本分支最重要的一条）

以下机制都会让运行态字节与磁盘不一致，**全部合法**：

| 机制 | 行为 |
|---|---|
| **static keys / jump labels** | `nop` ↔ `jmp target` 运行时改写（几乎零成本分支） |
| **alternatives** | 启动时按 CPU 特性/勘误替换指令 |
| **paravirt** | `pv_ops` 启动时 binary patching，用 native/hypervisor 实现替换通用路径 |
| **ftrace** | 函数跟踪本身修改执行路径；function graph tracer 还处理函数返回路径 |
| **livepatch** | 真正把执行流换到修补函数（symbol lookup + relocation + 注册 patched functions） |
| **kprobes / fprobe** | 动态插桩 |

判定链：

```
runtime bytes != disk bytes
   → 先排除 alternatives / static keys / ftrace / livepatch / paravirt / breakpoints
   → 剩余无法解释的修改
   → 才提高 rootkit 嫌疑
```

## 十三、看到 `.klp.*` 不要判 ELF 损坏（livepatch）

- 标志：`modinfo` 里 `livepatch: Y`；节 `.klp.rela.<object>.<section>`；符号 `.klp.sym.<object>.<symbol>,<pos>`
- 特殊之处：livepatch 需要引用 **unexported global / local / 尚未加载模块内**的符号 → 不能在普通模块加载阶段全部解决
- 因此"目标 driver 当前不存在"也**不代表 livepatch broken**：对应 relocation 可以等 target module load 时再应用

## 十四、`.orc_unwind` / `.orc_unwind_ip` 不是垃圾数组

- 它们是 **objtool 生成的 unwind metadata**，描述每条相关指令位置的 stack state，用于内核栈回溯——不是加密数据 / lookup table / 恶意 blob
- 对逆向有价值：**函数边界、stack state、异常控制流、unwindability**，可辅助恢复 stripped 代码

## 十五、`__ex_table` 制造"不可见控制流"

```
faulting instruction → CPU exception → __ex_table lookup → fixup handler
```

- CFG 里没有传统的 `jmp fixup`，但发生 page fault 后控制流确实会转过去（官方文档以 `get_user()` 为例说明 faulting instruction ↔ `__ex_table` entry ↔ fixup code 的对应）
- 逆向 `copy_from_user` / `get_user` / `put_user` / `probe_kernel_read` 附近的低级代码时，**必须把 exception table 当成 CFG 的一部分**
- 否则会看到"这段 fixup code 没有任何 xref" → **误标成 dead code**（它其实是 exception edge）

## 十六、x86 大量 `ENDBR64` 不是混淆

- 启用 kernel IBT（`CONFIG_X86_KERNEL_IBT`）时，`endbr64` 是**合法的 indirect call/jump target 标志**，函数头出现 `endbr64; push rbp; ...` 很正常
- 反过来在做**函数指针目标恢复**时，ENDBR 可作辅助信号

## 十七、函数没有正常 `call` xref，不代表没被调用

- Linux 内核函数指针密度极高：`file_operations`、`net_device_ops`、`proto_ops`、`bus_type`、`device_driver`、irq callbacks、timer、workqueue、notifier、`security_hook_list`、`seq_operations`、`proc_ops`
- 真实控制流常是 `VFS → function pointer → foo_read`，静态反编译器未必给出漂亮的 call graph
- 所以：**恢复 callback-registration graph 往往比恢复普通 call graph 更重要**。优先追注册点：

```
register_*() / *_register() / proc_create() / misc_register() / register_chrdev()
pci_register_driver() / usb_register() / netlink_kernel_create() / register_netdev()
request_irq() / queue_work()
```

然后反推"谁会调用这些 callback"。

## 十八、`kallsyms` 地址全是 0，不一定是 rootkit

- 系统可能开了 `kernel.kptr_restrict`（限制 `/proc` 等接口暴露内核指针）
- 看到 `0000000000000000 T some_kernel_symbol` → 先 `sysctl kernel.kptr_restrict`，再分析权限与 kernel config，**不要立即判"kallsyms 被 hook"**

## 十九、地址和静态 vmlinux 全对不上 → KASLR

- kernel text base 与 module 加载基址都会被随机化
- 所以 `vmlinux: foo = 0xffffffff81012340` / `runtime: foo = 0xffffffff9ac12340` **不能判"不是同一个 kernel"**——先恢复 runtime slide
- 动态调试时可直接用 `nokaslr` 让 GDB 与 vmlinux 地址一一对应

## 二十、`lsmod` 没看到，不代表模块不存在（cross-view 扩大）

- 经典手法：模块从 kernel module linked list **unlink** → `/proc/modules`、`lsmod` 都看不到，但模块仍在工作
- 当年的做法是 `module list` vs `/sys/module` kset 交叉；**现代分析不要只依赖这两个视图**，比较面应扩大为：

```
/proc/modules · /sys/module · module list · module_kset
内核可执行内存区间 · callback owner · 符号区间 · vmalloc/module 地址范围
```

- 核心：**怀疑内核已失陷后，不要信任"由那个内核自己产生的单一枚举结果"**（离线内存/多视图交叉优先）

## 二十一、"syscall table 没 hook" 也不能排除 rootkit

- 落点远不止 `sys_call_table`：`file_operations`、`proc_ops`、`seq_operations`、`net_device`/`proto_ops`、ftrace、kprobe、inline text、**LSM hook**、notifier、timer/workqueue 都被用过（经典案例会同时改 syscall path 与网络信息展示用的 operation 结构）
- 正确判断不是"sys_call_table 干净 → 内核干净"，而是：

```
关键 callback pointer → 是否落入正常 vmlinux/module text 区间
                     → owner 是否合理
                     → runtime bytes 是否可解释
```

## 二十二、kprobe/ftrace 自己也能让你误判 hook

- 动态取证发现"某函数前几字节变了"→ **先确认 tracing**（kprobes / kretprobes / fprobe / ftrace / tracepoints 都是内核正式支持的机制）
- 完整的 inline hook 检测不能只是 `runtime bytes != disk bytes → malware`，而要解释：谁改的？合法 tracing / livepatch / jump label / alternatives / paravirt？还是无法解释？

## 二十三、行为偶发时，不要第一时间猛上 kprobe

- 若问题位于 interrupt / NMI / locking / timing-sensitive race，**instrumentation 本身可能改变时序**
- 更稳的顺序：**已有 tracepoint → ftrace event → fprobe → kprobe → KGDB/QEMU breakpoint**（已有 tracepoint 是静态 typed probe point，本来就是为观测设计的）
- "加 probe 后 bug 消失"**不一定是 bug 没了**——可能只是观察改变了 timing
- 另外 fprobe 与 kprobes 的 recursion 语义并不完全相同；callback 在 interrupt context 中可能出现嵌套

## 总决策树

```
拿到 Linux kernel/module 样本
├─ 先识别 artifact：vmlinux / bzImage(Image) / .ko / 压缩 .ko / built-in / livepatch / runtime dump
├─ 是 module？
│    ├─ modinfo（alias→设备；built-in 也有 modules.builtin.modinfo/.ranges）
│    ├─ ELF sections / relocations / imported+exported symbols
│    ├─ MODVERSIONS（basic __versions / extended __version_ext_*）
│    └─ BTF（standalone 或 split + .BTF.base）
├─ 找不到代码？
│    ├─ built-in？ __init 已释放？ stripped？ split BTF？ runtime relocation？
├─ 地址不一致？
│    ├─ KASLR（kernel text + module base）→ 恢复 slide
├─ runtime bytes != disk bytes？
│    ├─ alternatives / static key jump label / ftrace / livepatch / paravirt → 合法
│    └─ 无法解释的 hook → 提高嫌疑
├─ CFG 很怪？
│    ├─ __ex_table（exception edge）/ ORC unwind metadata / callbacks
│    ├─ IBT ENDBR / 编译器优化与内联
├─ module load 失败？
│    ├─ 按阶段：read → decompress → 签名/ELF/blacklist/vermagic/livepatch → layout → 符号 → init
│    └─ CONFIG_MODULE_STATS 的 failed_kreads/decompress/becoming/load 直接告诉你卡在哪一段
└─ 怀疑 rootkit？
     ├─ 不信任单一 live view（cross-view 扩大到内核可执行内存/callback owner/符号区间）
     ├─ module cross-view · callback ownership · code integrity
     └─ offline memory > 受感染系统的 userspace output
```

## 工具与验证

- 身份与结构：`file` / `readelf -h`（确认 ET_REL 与 artifact 类型）、`readelf -S`（`.modinfo`/`.BTF`/`.BTF.ext`/`.BTF.base`/`.klp.*`/`.orc_unwind*`/`__ex_table`/`__versions`/`__version_ext_*`）、`modinfo`（vermagic/依赖/签名/livepatch/alias）
- 符号与重定位：`nm`、`objdump -r`（stripped 模块的主要线索）、`Module.symvers`（导出与 CRC）
- 类型：`pahole`、`bpftool btf dump file <ko>`（split BTF 需配合 base）
- 运行时：`/proc/kallsyms`（注意 `kptr_restrict`）、`/sys/module/<name>/sections/`、`/sys/module/<name>/`、`bpftrace`/`perf probe`（kprobe）、`ftrace`、debugfs 的 module `stats`
- 加载失败诊断：`dmesg` + `modinfo` + `readelf` 三者对照，配合 `CONFIG_MODULE_STATS` 的计数定位阶段
- 验证：对目标 `.ko` 能同时给出「artifact/构建归属（vermagic/CRC/KMI 无关但 MODVERSIONS 相关）+ 由导入符号推出的功能骨架 + 磁盘与运行态的差异解释」

## 该平台的坑（汇总）

- **把 .ko 当普通 ELF 可执行分析**：ET_REL，relocation 是信息不是噪音
- **把 bzImage 拖进反编译器就判"内核被混淆"**：那是 boot stub + 压缩载荷
- **为"修好"带签名尾的 .ko 去 truncate/strip**：破坏签名（且应只对副本操作）
- **把 `.ko.xz`/`.zst` 当壳**：loader 的正常解压阶段
- **见到 `.BTF` 里 type ID 对不上就判"文件损坏"**：可能是 split BTF（需 base；有 `.BTF.base` 先 relocate）
- **用同版本源码的 offset 硬套**：先排除 RANDSTRUCT（taint `T`）
- **把 livepatch 的 `.klp.rela` 当损坏的 relocation**
- **用 5.7 之前的经验解释符号解析失败**：`kallsyms_lookup_name()` 已不再导出给模块
- **只跑 `lsmod` 就下"没有 rootkit"结论**：必须 cross-view 且不信任单一枚举
- **把合法动态 patching 当篡改**：alternatives / static keys / ftrace / livepatch / paravirt / kprobe 先排除
- **把 `__ex_table` 的 fixup code 标成 dead code**：它是 exception edge，属于 CFG
- **把 ORC unwind 数据当加密 blob / 把 ENDBR64 当混淆**
- **把 kallsyms 全 0 当 hook**：先看 `kptr_restrict`
- **把地址不一致当"不是同一个 kernel"**：先恢复 KASLR slide
- **只等一个漂亮的 call graph**：内核里 callback 注册图更接近真实控制流
- **在偶发路径上先上 kprobe**：tracepoint → ftrace → fprobe 的阶梯，且注意观测会改变时序
