# FreeBSD 内核：linker sets / SYSINIT / KLD

<CORE RULE>
FreeBSD 表面上和 Linux 很像——**但一个关键差异会让整套"可达性"推理失效**：

```
SYSINIT() 并不是生成 "_start → call init"
而是把一个 struct sysinit 放进 linker set
内核启动 / 模块加载时统一排序后执行
```

所以：

```
foo_init()   ← 没有任何 call 交叉引用
```

**可能完全正常。** 应当恢复的是

```
func 地址 → struct sysinit → linker set
```

而不是把它标成 dead code。**"找不到调用者"在 FreeBSD 上首先是一条关于 linker set 的线索，而不是一条关于死代码的线索。**
</CORE RULE>

## 一、SYSINIT / SYSUNINIT：带序号的注册项

- `SYSINIT()` 创建一个 `struct sysinit` 放进**启动 linker set**；`SYSUNINIT()` 放进**关闭 linker set**
- 结构包含四个字段：**子系统标识（`SI_SUB_*`）、子系统内次序（`SI_ORDER_*`）、函数指针、传给它的数据指针**
- 启动时扫描启动 linker set，**生成排好序的初始化例程表**再依次执行
- 排序键：**`SI_SUB_*` 为主键，`SI_ORDER_*` 为次键**，各自升序
- **同一 sub 且同一 order 的两个例程，相对顺序未定义**——不要从"源码里的先后"推断运行顺序
- `SI_SUB_DUMMY` 一类条目会被跳过；条目执行后会被标记（如 `SI_SUB_DONE`）

## 二、linker set 机制本身：识别它，才谈得上识别"注册"

- linker set 利用链接器把**多个编译单元里静态声明的数据聚成一个连续、可寻址的整体**
- **现代 ELF 实现**用 "magic ld symbols" 定界：**`__start_set_<集合名>` / `__stop_set_<集合名>`**，条目落在形如 **`set_<集合名>`** 的 section 里
- **老实现（a.out 时代）**是 `struct linker_set { int ls_length; void *ls_items[...]; }`，**且条目列表以 NULL 结尾**
- **现代实现里列表不再以 NULL 结尾**——**按"结尾是 NULL"去扫描会直接越界**。范围只能由 `__start_set_*` / `__stop_set_*` 边界算出
- 宏层提供遍历/计数（`SET_BEGIN`/`SET_LIMIT`/`SET_FOREACH`/`SET_COUNT`）——**反编译器一侧看到的是纯数据指针数组，没有这些 API 名**

**通用判据（值得跨系统复用）**：

```
大量连续排布的 pointer / object
 + section 名形如 set_*
 → 优先按 linker-set 语义解释，而不是 jump table / 混淆表
```

而且 linker set 不止 `SYSINIT` 一处在用——FreeBSD 内核里有**很多** `set_...._set` 形式的集合。**看到 `set_` 前缀先想 linker set。**

## 三、KLD：运行期还有一层 kernel linker

- **预加载模块**（随内核由 boot loader 载入）：其启动 linker set 在 **`SI_SUB_KLD`** 子系统初始化时被扫描、排序并**并入内核的启动表**，随后在启动过程中执行
- **由此产生一条反直觉结论**：预加载模块里**排序在 `SI_SUB_KLD` 之前的初始化例程，实际会在 `SI_SUB_KLD` 之后才运行**——"它声明得很早，为什么跑得晚"有确定的机制解释
- **运行期加载的模块**（`kldload`）：加载时扫描其启动 set、排序、执行
- **卸载**：扫描关闭 set、排序、执行，**拆除顺序与初始化顺序相反**
- **内核与已加载模块的拆除例程在系统关机时并不执行**——"关机时应该走某条清理路径"这类推断不成立

## 决策树

```
拿到 FreeBSD 内核 / 模块目标
├─ 某个 init/注册函数没有 call 交叉引用
│    ├─ 查它是否被 SYSINIT/SYSUNINIT 引用（func 地址 → struct sysinit）
│    ├─ 查它落在哪个 linker set（section 名 set_*）
│    └─ 别标 dead code
├─ 一大段连续指针/对象、section 名 set_*
│    └─ 按 linker set 解释（可能有 count 字段、可能没有；现代 ELF 无结尾 NULL）
├─ 顺序问题
│    ├─ 排序键是 SI_SUB_* 主 + SI_ORDER_* 次
│    ├─ 同 sub + 同 order → 相对顺序未定义，别从源码顺序推运行顺序
│    └─ 预加载模块：早于 SI_SUB_KLD 的项实际在 SI_SUB_KLD 之后才跑
├─ 模块相关
│    ├─ 加载：扫描-排序-执行启动 set
│    ├─ 卸载：执行关闭 set，顺序与初始化相反
│    └─ 系统关机不执行内核与已加载模块的拆除例程
└─ 与 Linux 对照的常见误判 → 见下方"坑"
```

## 工具与验证

- 定位注册项：由函数地址回溯到 `struct sysinit`，再由它所在的 section 归属到具体 linker set
- 枚举集合：按 `__start_set_*` / `__stop_set_*` 边界计算范围与条目数（**不要依赖结尾 NULL 或固定 count 字段**）
- 模块生命周期：预加载 vs `kldload` 两条路径分别核对（排序时机不同）
- 验证：能同时说清「注册方式（linker set / 直接调用）+ 所属集合与排序键 + 加载路径（内建/预加载/运行期）」

## 该平台的坑（汇总）

- **找不到 call 交叉引用就判 init 不会运行**：`SYSINIT()` 通过 linker set 注册，源码层面本来就没有调用点
- **按"结尾 NULL"扫描 linker set**：那是 a.out 时代的老结构；现代 ELF 用边界符号定界，**按 NULL 扫会越界**
- **把 `set_*` 的指针数组当 jump table / 混淆表**：它更可能是内核自己的注册集合
- **从源码里的先后推断初始化顺序**：排序由 `SI_SUB_*` + `SI_ORDER_*` 决定，同 sub 同 order 的相对顺序**未定义**
- **以为预加载模块里声明得早的初始化就跑得早**：它们在 `SI_SUB_KLD` 时才被并入内核启动表
- **以为关机时会执行内核/模块的拆除例程**：不会
- **把卸载时的执行顺序当成初始化顺序**：拆除顺序与初始化相反
- **拿 Linux 的 `module_init`/`__initcall` 模型直接套 FreeBSD**：注册机制与排序键都不同（对照见 [[linux-kernel]]）
