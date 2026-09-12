# macOS 平台分支：Mach task / VM region / Endpoint Security

观测对象是 **Mach task + VM region**（不是 `/proc`，也不是 Windows 的 VAD 模型）。核心区别在于**权限**：macOS 上"有权限"取决于 task port 与签名状态，不是 uid。

## 一、静态主线

```
task 端口 → VM regions → RX/RWX/private region 筛 → Mach-O/dyld provenance → 线程 PC/backtrace → dump
```

- 遍历 region：`vm_region_recurse_64()` / `mach_vm_region*()`——返回区域的地址范围、**protection**、sharing、resident/private 等属性
- 读取内容：`mach_vm_read()` / `mach_vm_read_overwrite()`（需目标 task 的 read 权限）
- 归属判断：线程 PC 与回溯是否落在"无 Mach-O/dyld 背书的可执行 region"内
- 相关 API 一族（都需要 task port）：`task_for_pid`、`mach_vm_region`、`mach_vm_read` / `mach_vm_read_overwrite`、`vm_region_recurse_64`、`mach_vm_protect`

## 二、权限边界（本平台最容易误判的地方）

- **SIP**（System Integrity Protection，10.11 起）：对 SIP 保护的进程，`task_for_pid()` / `processor_set_tasks()` 返回 **EPERM**；需要 Apple 内部的特殊 entitlement（不对外提供）。SIP 下 Mach 特殊端口在 `exec` 时被重置、dyld 环境变量被忽略、DTrace 探针不可用
- **Hardened Runtime**（公证要求）：默认**吊销** `task_for_pid` 权限，并拒绝动态库注入、`mprotect(PROT_EXEC)` 标记任意页可执行、`task_set_exception_ports` 等——除非 App 声明了例外 entitlement
- `com.apple.security.get-task-allow`（调试工具 entitlement）：**目标进程**带此 entitlement 时才允许被 attach / 取 task port（发布版不该有，出现即可疑信号）
- 结论：**不是 root 就能读**。采集前先确认目标是否 SIP 保护、是否 Hardened Runtime、是否可 attach——不可读时明确标注"权限不足"，不要当成"内存里没有东西"（禁用 SIP 需进恢复模式，且会削弱多项系统防护，非授权研究场景不建议）

## 三、动态侧（trigger）：Endpoint Security

macOS 上不需要（也不应该）写成"hook `mprotect()`"——系统提供了正规的观测接口 **Endpoint Security（ES）**：

- 与内存/执行相关的**已文档化事件**：
  - `ES_EVENT_TYPE_NOTIFY_MMAP` —— 进程**把文件映射进内存**
  - `ES_EVENT_TYPE_NOTIFY_MPROTECT` —— 进程**改变内存映射页的保护属性**（RWX/可执行化信号）
  - `ES_EVENT_TYPE_NOTIFY_REMOTE_THREAD_CREATE` —— 进程**在别的进程里创建线程**（macOS 11.0+）
  - `ES_EVENT_TYPE_NOTIFY_GET_TASK` —— 进程**获取别的进程的 task 控制端口**（macOS 10.15.4+；另有 `GET_TASK_NAME` / `GET_TASK_READ` / `GET_TASK_INSPECT`，11.0/11.3+）
- **NOTIFY 与 AUTH 两类**：`NOTIFY_*` 只观测；`AUTH_*`（如 `AUTH_MMAP` / `AUTH_MPROTECT` / `AUTH_GET_TASK`）可**允许或拒绝**操作——授权场景下可做阻断式采集（先取证再放行/拒绝）
- 事件订阅通过 `es_subscribe` 注册（常量类型 `es_event_type_t`，可用项随 macOS 版本 gating，按目标 SDK 头文件核对）
- 采集侧的分工，与 Windows/Linux 同构：**ES 负责"何时"触发，Mach VM 负责"是什么"的事实确认**

**高置信组合**（多事件相关，而不是单点告警）：

```
REMOTE_THREAD_CREATE（在他进程建线程）
  + GET_TASK（先取了 task port）
  + MPROTECT（W→X 保护转换）
  + 匿名/私有可执行 VM region（Mach VM 侧确认）
```

## 四、代码完整性对比（发现 patch / 替换）

- **Mach-O `__TEXT` 内存页与磁盘副本比对**（按页/摘要）：代码段被改写（patch、inline hook、模块替换）时两者不一致
- 结合 [[re-format-macho]] 的段/签名解析与 [[re-macos]] 的签名公证视图（CDHash、签名者）判断"内存中的镜像是否仍是签名时那份"

## 五、工具与验证

- `lldb`（[[re-lldb]]）：attach 目标后 `image list`、`memory region`、`process save-core`
- `vmmap` / `otool` / `codesign -d`：region 视图、Mach-O 结构、签名与 entitlement 核对
- ES 客户端：需相应 entitlement 与用户授权（系统设置中批准），验证方式是先订阅 `MPROTECT` 事件看能否收到系统内正常进程的事件

## 该平台的坑

- **以为 root 能读一切**：SIP / Hardened Runtime 下 `task_for_pid` 直接 EPERM——先判断权限，再设计采集方式；读不到不是"没有异常"
- **照搬 hook 思路**：macOS 上有 ES 这类正规接口，优先用事件而不是用户态 hook（hook 在 Hardened Runtime/SIP 下也更容易失效）
- **忽略 AUTH 与 NOTIFY 的区别**：只有 AUTH 类事件能拦；NOTIFY 类只能观测（采集取证通常够用）
- **ES 事件随版本 gating**：新事件常量在旧系统不可用——按目标系统版本与 SDK 头文件核对可用集

## 六、内核态载荷（KEXT / DEXT）的采集

macOS 上"内核态载荷"分两代，采集路径完全不同（分析方法见 [[re-kernel]] 的 macOS 分支）：

- **DEXT（System Extension / DriverKit）——按用户态进程处理**：它跑在用户空间，所以正常走本文件的用户态路径（进程枚举、`mach_vm_read` 等），不需要内核态手段；注意先确认 **activation 状态与 entitlement**（未激活/entitlement 不匹配时进程根本起不来，别误判为"没有载荷"）
- **KEXT（legacy）——先确认运行版本**：macOS 11+ 第三方 kext 并入 **AuxKC 在启动时加载**，更新后重启前**旧版本可能仍在运行**——采集前记录 **disk bundle version / AuxKC version / running version / boot time**，否则会采到/分析到"不是正在跑的那一份"
- **kext 列表的 cross-view**：磁盘 kext 目录 / `kmutil` 视图 / IORegistry 绑定关系 交叉比对（与 Linux 的模块列表交叉同构）
- **内核内存读取的现实**：SIP 与 Hardened Runtime 下 `task_for_pid` 对受保护目标 EPERM（见本文件第二节）——内核内存采集通常需要关闭 SIP 或用具备相应授权的机制，属授权研究场景，先确认权限与合规要求
- 采集产物按 [[re-analyze/analysis-contract]] 入档，并标注"采集自磁盘 / AuxKC / 运行内存"三者中的哪一份
