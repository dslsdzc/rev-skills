# Windows 平台分支：VAD / 线程 / 事件 / 内核

观测对象是**进程的 VAD（虚拟地址描述符）与 region + 线程 + 模块链**；进程只是容器。

## 一、异常执行区扫描（不猜 PID）

- 遍历：`VirtualQueryEx` / `NtQueryVirtualMemory` 走目标地址空间；全进程扫面用 HollowsHunter（PE-sieve 引擎）
- **优先特征**：
  - `State=MEM_COMMIT` + `Type=MEM_PRIVATE` + 保护含执行位（Volatility `malfind` 的经典判据：private + committed + executable）
  - **保护属性转换**：W→X、RW→RWX→RX——先写后改可执行是最强信号；转换瞬间即最佳捕获时机（步骤三的 hook 点）
  - 保护值参考：`PAGE_EXECUTE_READWRITE`(0x40)、`PAGE_EXECUTE_READ`(0x20)、`PAGE_EXECUTE_WRITECOPY`(0x80)
- **`MEM_IMAGE` 不能判白**：
  - module stomping / DLL hollowing 把 payload 塞进看似合法的 DLL 映射（映射类型仍是 `MEM_IMAGE`）
  - copy-on-write 的 image 页在 `VirtualQueryEx` 里**仍报 `MEM_IMAGE`**——要判断它是否已成本进程私有修改页，需查 **Working Set 的 `.Shared` 位**（`K32QueryWorkingSetEx`）；该位也是发现**内联 hook** 的手段（写钩子触发 COW 私有化）
- **模块链交叉（Missing PEB module）**：用 `VirtualQueryEx` + `NtQueryVirtualMemory` 取 `MEM_IMAGE` 的映射文件路径，与 PEB 加载模块列表比对——"有映射、无 PEB 条目"= 被摘链隐藏的模块（`GetModuleHandle` / `EnumProcessModules` 看不到它，内存视图能看到）

## 二、执行上下文归属

- 线程起点：`NtQueryInformationThread(hThread, 9 /* ThreadQuerySetWin32StartAddress */, &addr, sizeof(addr), NULL)` → `VirtualQueryEx` 查该地址所在 region：`MEM_COMMIT && Type != MEM_IMAGE` 即可疑（Get-InjectedThread 类脚本的判据）
- **只看起点会漏**（已知绕过）：① LoadLibrary/DLL 注入（代码落在 `MEM_IMAGE`）；② `SetThreadContext` 改写 RIP（起点显示在合法模块）；③ `jmp rcx` 类 gadget（借模块内已有跳转指令作入口）；④ Win11 经 `_beginthreadex` 的线程起点落在 msvcrt；⑤ 从合法 DLL 起跳后 trampoline 进 private 可执行区
- **补三层证据**：当前 RIP、**调用栈返回地址**、region ownership——PE-sieve `/threads` 专扫线程调用栈（可抓 shellcode 与 sleeping beacon）

## 三、事件侧（trigger，不是 ground truth）

- **Sysmon**：Event 10（ProcessAccess——谁打开了目标）、Event 8（CreateRemoteThread，带 `StartAddress` / `StartModule` / `StartFunction`）、Event 25（ProcessTampering / image hollowing）
- **ETW**：Threat-Intelligence 提供者可暴露直系统调用、内存分配与线程上下文改写（驱动/EDR 实现侧见 [[re-evasion]]）
- **内核回调**（有驱动条件时）：`PsSetCreateProcessNotifyRoutine` / `PsSetCreateThreadNotifyRoutine` / `PsSetLoadImageNotifyRoutine`——LoadImage 发现"无对应磁盘文件的可执行映射"、线程起点不在任何模块内，都是强证据
- 与内存扫描的分工：事件源回答"**何时** dump"，内存扫描回答"**dump 什么**"；直系统调用 / 共享 section / 覆盖已有 RX 区可绕过用户态 hook

## 四、Dump 与重建

- 工具：`pe-sieve.exe /pid <pid> /shellc /hooks /imp /dmode unmap`（注入 PE 自动解映射重建）、`/minidmp`、`procdump -ma <pid> out.dmp`
- **保存整个可疑 region**，不要只按 `MZ` 筛：载荷可能无 PE 头或故意擦头（经典案例：注入后擦 PE 头 → 靠区域定位 → dump 后按节重建 PE）
- 内容分类：完整 PE / 手工映射 PE / 裸 shellcode / JIT 代码 / 解密后的 code blob
- **模块内存 vs 磁盘差异**：同名模块的磁盘副本与内存副本比对（发现 stomping、patch、擦头）；PE-sieve 的 `/dmode unmap|realign` 与导入表恢复（`/imp`）就是为重建服务

## 五、内核与驱动载体（外挂 / rootkit 常见）

- 内核可执行内存扫描 + **驱动加载前后对比**定位无模块驱动（驱动可把自身从模块链摘除）
- 记录：驱动对象、Device/Io 派遣例程是否被改写（劫持系统驱动指针通信是常见手法）、回调注册（`ObRegisterCallbacks` 等）是否被摘除
- 方法细节与工具见 [[re-kernel]]

## 六、误报与白名单

- 白名单/降权：.NET 与浏览器 JIT、AV/EDR 自身的 hook 与 patch、shim/hotpatch、profiler、overlay
- 评分：private executable + 线程/RIP/栈命中 + 近期 W→X + 高熵/PE 特征 + 无已知来源 → 高置信；单项不足以定性

## 工具与验证

- PE-sieve / HollowsHunter：GitHub releases（`hasherezade/pe-sieve`、`hasherezade/hollows_hunter`），核对 release 页 sha256；验证 `pe-sieve.exe /help`
- System Informer（systeminformer.com）/ Process Explorer（Sysinternals）：region、线程栈、句柄三视图
- 验证采集面：能在目标进程里同时看到「可执行 region 清单 + 每个线程的起点与所在 region + 模块链」

## 该平台的坑

- **只 hook `VirtualProtect`（kernel32）**：样本直调 `NtProtectVirtualMemory` 就绕过了——两处都要挂（或改用内核回调）
- **把 `MEM_PRIVATE + executable` 当结论**：JIT 与安全软件同样产生——先采基线（同类进程干净环境）只报增量
- **无痕 hook**：影子页/硬件断点实现的无痕 hook 让"读到"与"执行到"不是同一份内存——多视图（用户态读取、内核侧读取、PE-sieve）交叉，差异即证据
