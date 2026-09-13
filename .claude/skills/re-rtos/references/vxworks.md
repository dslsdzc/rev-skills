# VxWorks：DKM / RTP / 全局符号环境

<CORE RULE>
第一步不是解析 ELF，是**分清两种运行模型**：

| 模型 | 产物 | 执行位置 | 地址空间 |
|---|---|---|---|
| **DKM**（Downloadable Kernel Module） | `.out` | **内核态**（supervisor mode） | 与内核同一地址空间 |
| **RTP**（Real-Time Process） | `.vxe` | **用户态** | 各自独立，MMU 保护 |

**`.out` 不要按 Linux `.ko` 直接解析。** 它最特别的地方不是格式，而是**符号环境**：一个 DKM 是"链接到内核符号表"的，脱离目标镜像与全局符号环境看它，**永远会看到一堆 unresolved symbols**——那不是损坏，是模型。
</CORE RULE>

## 一、DKM：内核态，符号来自运行镜像

- 运行在 supervisor mode，**可被静态链接进内核镜像，也可动态加载**
- **`.out` 与内核符号表动态链接**——它的外部引用指向**目标镜像的全局符号环境**
- 加载方式：目标 shell 里 `ld < my_first_dkm.out`（模块的 `usrAppInit` 随后自动运行），或经调试器 `module load <path>`
- 现场核对手段：`lkup "符号名"` 查符号、`moduleShow` / `taskShow` 看模块与任务
- **典型加载失败是 `undefined symbol`**：DKM 调用了某个组件，而**该组件在构建 VIP 内核时没被包含进去**——对策是把组件加进 VIP 配置并重建 VIP（再重建 DKM），**不是"修 DKM 本身"**
- 为便于事后定位，VIP 里可打开 `INCLUDE_STANDALONE_SYM_TBL`（内建符号表），让崩溃/启动信息给出更有意义的调用栈

## 二、RTP：用户态，标准 ELF 与 `.so` 链接

- 每个 RTP 有独立虚拟地址空间与 MMU 保护，**一个 RTP 崩溃不影响内核与其他 RTP**；内核服务经系统调用进入
- 产物 `.vxe` 是**标准 ELF 可执行文件**；动态链接的 `.vxe` 按 **NEEDED / SONAME / RPATH** 在运行时解析 `.so`
- 可从 ROMFS/NFS/SD 卡等加载，或经调试器；也可用环境变量方式启动，例如 `LD_LIBRARY_PATH=/romfs/lib` 配 `rtp exec ... demo.vxe &`
- 加载失败排查路径与普通 ELF 一致：**库找不到**（`Shared object not found`，查 `LD_LIBRARY_PATH` 与文件系统挂载）→ **名字/版本不匹配**（`readelf -d` 比对 NEEDED/SONAME/RPATH）→ 二级依赖断裂 → 或它本来就是静态构建的
- `shl` / `shl info` 可看当前实际加载了哪些共享库
- 调试提示：**不要在动态链接器完成符号登记之前就把调试器停住**（早期暂停会看到"符号没登记"的假象）

## 三、全局符号环境：独立 ELF "看起来不完整"是常态

这是一个 DKM **必须整体恢复**的最小集合：

```
VxWorks image（目标运行镜像）
 + VSB / VIP 配置
 + global symbol table（全局符号表）
 + DKM 本身
 → 再做 relocation / symbol resolution
```

- **只拿一个 DKM 单独看**：大量 unresolved symbols 是预期结果，不是 malformed
- 反过来也成立：**分析时能"解出来"的调用目标，取决于你把哪份符号环境当成真值**——用错 image 的符号表，函数名会整体错位
- 所以 RE 主线应写成：**先定位目标镜像与配置，再谈模块内的逻辑**

## 四、"同一个 VxWorks 版本"不等于"同一个系统 ABI 环境"

- SDK 本身是**针对具体 VSB/VIP 生成**的；DKM 也基于特定 VIP 编译，以保证与那个内核镜像的 API/ABI 兼容
- 因此遇到"这个 DKM 在另一台**同版本** VxWorks 上为什么不工作"：**优先核对具体的 image configuration**，而不是只比版本字符串
- 同理，**不要把 RTP 的 `.so` 当 DKM 模块加载**（反之亦然）——两类产物走的是两套加载与解析机制，混用是常见错误

## 五、与任务/TCB 分析的接续

DKM 侧任务与内核对象仍走 [[re-rtos]] 主文档的任务表方法（`taskSpawn`/`taskCreate` + `WIND_TCB` 字段从上下文切换现场反推）。本分支补的是**"这份代码能不能加载、符号从哪来、跑在哪一侧"**——**先解决身份与符号环境，再谈任务结构**；顺序颠倒会得到一堆偏移正确但语义全错的结论。

## 决策树

```
拿到 VxWorks 目标
├─ 先分型：.out(DKM) / .vxe(RTP) / 整个 image
│    ├─ .out → 内核态：符号来自目标镜像的全局符号环境
│    ├─ .vxe → 用户态：按普通 ELF 分析；.so 走动态链接器
│    └─ image → 先提取全局符号表与配置，作为其他分析的基准
├─ 看到大量 unresolved symbol
│    ├─ 先问：我是不是只拿到了 DKM、而没拿到它的符号环境？
│    └─ 再问：目标 VIP 是否本就未包含该组件（undefined symbol 的真实成因）
├─ 模块加载不了
│    ├─ DKM → 查 VIP 组件是否包含；查与目标镜像的 ABI 是否匹配
│    └─ RTP → 查库路径/NEEDED/SONAME/RPATH/二级依赖/是否静态构建
├─ 同版本却行为不同
│    └─ 核对 image configuration（VSB/VIP）而不是版本字符串
└─ 确认身份与符号环境之后 → 再进任务表/TCB 分析（[[re-rtos]] 主文档方法）
```

## 工具与验证

- 现场枚举：`lkup`（符号）、`moduleShow`（模块）、`taskShow`（任务）、`shl` / `shl info`（已加载共享库）
- 加载：`ld < module.out`（DKM）、`rtp exec ... demo.vxe`（RTP）
- ELF 侧：`readelf -d`（NEEDED/SONAME/RPATH 比对）、常规符号与重定位工具
- 配置侧：VSB / VIP 配置与 image 构建产物（决定符号环境与组件集合）
- 验证：能同时说清「模型（DKM/RTP）+ 目标 image 与配置 + 符号解析依据 + 加载路径」

## 该平台的坑（汇总）

- **把 DKM `.out` 当 Linux `.ko` 直接解析**：执行模型、符号模型、加载机制都不同
- **只看单个 DKM 就判断"文件不完整/被裁剪"**：它是链接到目标镜像符号环境的，孤立看必然一堆未解析符号
- **`undefined symbol` 时去改 DKM**：真实成因通常是 VIP 未包含该组件，要改的是镜像配置并重建
- **用错 image 的符号表**：函数名会整体错位，比"没有符号"更危险
- **拿版本号当 ABI 兼容性依据**：SDK 与 DKM 都针对具体 VSB/VIP 生成，要核对配置
- **把 RTP 的 `.so` 当 DKM 模块加载**（或反之）：两套加载/解析机制不可混用
- **在动态链接器完成符号登记前就下结论**：早期暂停会看到"符号没登记"的假象
- **跳过身份与符号环境直接做任务/TCB 分析**：会得到偏移正确但语义全错的结论
