# Windows 驱动分支（模型识别 → callback / 设备栈 / I/O 路径）

<CORE RULE>
**先识别 driver model，再恢复真正的 callback / 设备栈 / I/O 路径。**
看到 `.sys` 就按「DriverEntry → MajorFunction[] → IOCTL」一条线往下走，会漏掉 KMDF、NDIS miniport、StorPort miniport、文件系统 minifilter 等一大批真实驱动——它们的 WDM dispatch 由 framework/port driver 持有，真正的业务入口是**注册给 framework 的 callback**。

七个最容易产生事实性错误的点：① 把所有 `.sys` 都当 WDM；② 把 `GsDriverEntry` 当业务入口；③ 把 `MajorFunction` 为空解释成"无 I/O"；④ 不知道 KMDF/NDIS/minifilter 的 callback registration；⑤ 不知道 **IRP completion 是异步控制流**；⑥ 不知道 **IOCTL 的 Method 决定 buffer 语义**；⑦ 2026 年仍用旧的 Windows 驱动签名假设。
</CORE RULE>

## 一、先确认到底是哪一种 Windows driver

```
.sys
├─ raw WDM / NT driver
├─ KMDF
├─ PnP function driver
├─ upper / lower filter
├─ file-system minifilter
├─ legacy file-system filter
├─ NDIS miniport / filter
├─ StorPort / storage miniport
├─ AVStream / PortCls / 其他 miniport
└─ 特殊安全 / 虚拟化类 driver
```

另外：**UMDF driver 通常不是内核 `.sys` 业务主体**，而是由 `Wudfhost.exe` 装载的**用户态 DLL**。

WDM 直接处理 IRP；KMDF 则由 framework 接住 IRP，再调用驱动注册的 event callback。

> **经验**：`MajorFunction[]` 看起来什么都没有 **≠** 这个 driver 没有 I/O 接口——它可能压根不是 raw WDM。

## 二、DriverEntry 不一定是真正的 DriverEntry

PE header 的 entry point 可能落到 **`GsDriverEntry`**（工具链自动生成的初始化 wrapper），之后才调用开发者写的 `DriverEntry`：

```
AddressOfEntryPoint → GsDriverEntry → security/runtime init → 真实 DriverEntry
```

反编译器把入口函数命名为 `DriverEntry` 也别盲信：看它**有没有再调用一个** `NTSTATUS f(PDRIVER_OBJECT, PUNICODE_STRING)` 并完成 callback 初始化。否则容易把编译器包装层当成业务代码分析。

## 三、WDM：真正重要的是 `DRIVER_OBJECT` 赋值图

传统 WDM 的关键初始化：

```
DriverObject->DriverUnload / DriverObject->DriverExtension->AddDevice
DriverObject->MajorFunction[IRP_MJ_CREATE / _CLOSE / _READ / _WRITE
                            / _DEVICE_CONTROL / _INTERNAL_DEVICE_CONTROL / _PNP ...]
```

`MajorFunction` 是 "IRP major code → dispatch routine" 的函数指针数组。所以 stripped WDM 最有效的逆向方法是**找赋值点**：

```asm
mov [DriverObject + xx], handler
```

然后恢复成映射表：

```
IRP_MJ_DEVICE_CONTROL → sub_140003820
IRP_MJ_CREATE         → sub_140001A00
IRP_MJ_CLOSE          → sub_140001A00
IRP_MJ_PNP            → sub_140004C10
```

这比普通 call graph 有意义得多。逐项看 handler 时的关注点：

- `IRP_MJ_DEVICE_CONTROL`（0x0E，用户态交互）、`_INTERNAL_DEVICE_CONTROL`（0x0F）、`_CREATE`（0x00）/`_CLOSE`（0x02）、`_READ`（0x03）/`_WRITE`（0x04）
- 每个 handler 用 `IoGetCurrentIrpStackLocation(irp)` 取参数 → 分支处理（IOCTL 码分派）
- **参数校验**（InputBufferLength/OutputBufferLength）——长度校验缺失是驱动类漏洞常见成因（漏洞面分析转 [[re-vuln]] 思路）

**设备对象与符号链接**：

- `IoCreateDevice` 的 DeviceName（`\Device\MyDriver`）；`IoCreateSymbolicLink` 的 SymbolicLinkName（`\DosDevices\MyDriver` → 用户态 `\\.\MyDriver`）
- 没符号链接时用户态可直接 `DeviceIoControl` 打 `\\.\` 名（或无符号名只能内部引用）
- 动态核对：`!drvobj <名>` 看设备对象链、`!devobj <设备>` 看设备名与 AttachedDevice——与静态字符串对照，确认运行期没被改
- 多层设备栈（filter 驱动）：看到 `IoAttachDevice` / `IoAttachDeviceToDeviceStack` 即为拦截型驱动（文件/键盘过滤等）

**服务注册与加载入口**：

- SCM 注册：`CreateServiceW`（Type=SERVICE_KERNEL_DRIVER、Start=2 自动/3 手动/0 引导）或 INF 安装；恶意加载器常用 `Start=3` + 手动启动
- 注册表：`HKLM\SYSTEM\CurrentControlSet\Services\<驱动名>` 的 `ImagePath` 指向 `.sys`
- 启动失败码：577 = 签名错误、1275 = 未签名驱动被拒（x64）——先查测试签名状态再看代码
- 从用户态样本（[[re-binary-core]]）的创建服务调用反推驱动名，与静态 `.sys` 对应

## 四、KMDF：千万别按 WDM 找

KMDF 中 **framework 自己注册 WDM dispatch**，再把 IRP 转成 `WDFREQUEST` / `WDFDEVICE` / `WDFQUEUE`，调用驱动注册的：

`EvtDriverDeviceAdd` / `EvtIoRead` / `EvtIoWrite` / `EvtIoDeviceControl` / `EvtIoInternalDeviceControl` / `EvtDevicePrepareHardware` / `EvtDeviceD0Entry` …

典型路径：

```
DriverEntry → WdfDriverCreate → EvtDriverDeviceAdd → WdfDeviceCreate → WdfIoQueueCreate → EvtIoDeviceControl / EvtIoRead / ...
```

> **特殊情况**：`!drvobj` 显示的 MajorFunction **大部分指向 `Wdf01000.sys`** —— 这完全正常。
> **不要得出"驱动逻辑在 Wdf01000.sys"**：真正的业务入口是它交给 WDF 的 callback。

## 五、KMDF stripped 后找不到明显 callback 赋值

WDF 初始化大量使用 `WDF_*_CONFIG` / `WDF_OBJECT_ATTRIBUTES` 结构体：

```c
WDF_IO_QUEUE_CONFIG_INIT_DEFAULT_QUEUE(&cfg, ...);
cfg.EvtIoDeviceControl = Handler;
WdfIoQueueCreate(..., &cfg, ...);
```

优化器可能把这一过程拆得很碎：stack struct 初始化 → 某 offset 写函数地址 → `WdfIoQueueCreate`。

所以**不要只搜 `xref → WdfIoQueueCreate`**，要向前做 dataflow：

```
WDF_IO_QUEUE_CONFIG → 哪个 offset 被写了函数地址 → 对应哪个 EvtIo*
```

否则看到 `sub_140017260` 却不知道它实际是 `EVT_WDF_IO_QUEUE_IO_DEVICE_CONTROL`。

## 六、`.sys` 没有漂亮的 DriverEntry → IRP 路径，可能是 **miniport**

Windows 有大量「**miniport + Microsoft port/framework driver**」结构：

- **NDIS**：`vendor.sys` + `ndis.sys` 共同形成一个驱动层——vendor NDIS miniport 的 AddDevice、部分 IRP dispatch **都是 ndis.sys 提供的**，vendor 通过 miniport callback 参与工作
- 所以 `DriverObject->MajorFunction[]` 几乎都不是 vendor 的，**不等于 vendor driver 没功能**
- 要找的是 `NdisMRegisterMiniportDriver` / `NdisFRegisterFilterDriver` 及注册结构里的 callback
- 同样思路适用于 **StorPort / PortCls / AVStream / 其他 class or port-miniport 架构**

## 七、NDIS：别当普通 IRP 网络驱动

要恢复的是 miniport / filter 的 callback 图：

```
miniport: MiniportInitializeEx / MiniportHaltEx / MiniportPause / MiniportRestart
          MiniportOidRequest / MiniportSendNetBufferLists / MiniportReturnNetBufferLists …
filter:   FilterAttach / FilterDetach / FilterRestart / FilterPause
          FilterSendNetBufferLists / FilterReceiveNetBufferLists / FilterOidRequest …
```

数据主体是 `NET_BUFFER_LIST` / `NET_BUFFER`，且 filter module **堆叠在 miniport 之上**：

```
protocol → NDIS → filter A → filter B → miniport → NIC
```

> 所以**看不到 `IRP_MJ_READ` / `IRP_MJ_WRITE` 对网卡驱动完全不奇怪**；不要强行找 `ReadFile()` 对应的 handler。

## 八、device stack 必须恢复（行为可能来自任何一层）

PnP 世界：`Upper Filter → Function Driver (FDO) → Lower Filter → Bus Driver (PDO)`；I/O Manager 把 IRP 交给**最上面的 device object**，再由驱动继续向下传。

典型误判：

> 应用打开 Device X → 某行为发生 → 一定是 X 的 function driver 做的

**不一定**——行为可能来自 upper filter / lower filter / class filter / bus filter。动态分析真正应恢复：

```
DeviceObject → AttachedDevice chain → DriverObject → image owner
```

而不只是 `\Device\Foo → foo.sys`。

## 九、INF 往往比 `.sys` 更快解释驱动是什么

驱动包通常是 `.sys + .inf + .cat (+ coinstaller/DLL/firmware)`。INF 直接给出：

`Hardware ID` / `Compatible ID` / `service name` / `ServiceBinary` / `StartType` / `class` / `AddService` / **`UpperFilters` / `LowerFilters` / `AddFilter`**

- Win10 1903+ 的设备 filter 可用 `AddFilter` 声明 upper/lower/filter level；更老的驱动大量通过注册表 `UpperFilters` / `LowerFilters` 插入设备栈
- 只有 `foo.sys` 时，你丢失的不只是安装文件——**而是 `foo.sys` 在整个设备栈中的位置**

## 十、文件系统 minifilter：完全是另一套世界

看到 `FltRegisterFilter` 应立即切换模型：

```
FLT_REGISTRATION → FLT_OPERATION_REGISTRATION[]
   IRP_MJ_CREATE → PreCreate / PostCreate
   IRP_MJ_READ   → PreRead / PostRead
   IRP_MJ_WRITE  → PreWrite / PostWrite
   IRP_MJ_SET_INFORMATION → ...
```

**FltMgr 按 altitude 排序 minifilter**：pre-operation 从高 altitude 往低走，post-operation 返回时反向执行。所以：

```
PreRead A → PreRead B → filesystem → PostRead B → PostRead A
```

**不是奇怪的 recursion，而是正常的 Filter Manager pipeline。**

## 十一、Altitude 不是随便写的版本号

minifilter 的 `Altitude = "320000"` 不是 build ID、优先级数值或版本号——它决定该 filter 在 minifilter stack 中的**位置**，且 Microsoft 分配 altitude 范围。

因此分析多 filter 相互作用（"A 抢先看到文件""B 为什么看到的是修改后的请求"）**必须考虑 altitude**。

`CmRegisterCallbackEx`（注册表回调）同样带 altitude，并用于 callback ordering。

## 十二、IOCTL 先解 `CTL_CODE`

一个 IOCTL（如 `0x222004`）不要一直当 magic integer——拆成 `DeviceType` / `Access` / `Function` / **`Method`**：

| Method | 数据在哪 |
|---|---|
| `METHOD_BUFFERED` | `Irp->AssociatedIrp.SystemBuffer` |
| `METHOD_IN_DIRECT` / `METHOD_OUT_DIRECT` | `MdlAddress` 与锁定/映射的页 |
| `METHOD_NEITHER` | **可能直接携带原始用户态虚拟地址** |

Microsoft 明确规定 `DeviceIoControl` 的 transfer method 来自 **IOCTL 自身的 TransferType**。所以最好把 `switch (IoControlCode)` 恢复成带语义的注释再逆 handler：

```
IOCTL_800: Function = 0x800, Method = BUFFERED, Access = ANY
IOCTL_801: Function = 0x801, Method = NEITHER
```

## 十三、"内核直接解引用一个很低的地址"：先确认是不是 `METHOD_NEITHER` 的用户指针

- BUFFERED 关注 `AssociatedIrp.SystemBuffer`；DIRECT 涉及 `MdlAddress`
- **NEITHER 甚至可能直接携带原始用户态虚拟地址**，I/O Manager 不负责替你锁定或验证（Microsoft 明确指出 neither I/O 的用户地址只在合适的调用线程上下文中才能安全访问）

所以反编译看到内核 dereference 一个"很低"的地址：

> **别立即判断"内核指针损坏"** —— 先确认是不是 METHOD_NEITHER 的用户指针。

安全审计时这也应立即提高优先级：`ProbeForRead` / `ProbeForWrite`、`try/except`、`RequestorMode`、thread context 变得关键。

## 十四、IRP 控制流不是普通函数调用图（completion edge）

WDM 最大的坑之一是 **asynchronous completion**：

```
Dispatch → IoCopyCurrentIrpStackLocationToNext → IoSetCompletionRoutine
  → IoCallDriver → STATUS_PENDING → ……下层异步完成 → CompletionRoutine
```

- **`IoCallDriver` 返回了 ≠ 这次 I/O 已结束**
- completion routine 返回 `STATUS_MORE_PROCESSING_REQUIRED` 会**阻止 I/O Manager 继续完成原 IRP**，让当前 driver 接管后续 processing（Microsoft 有明确规定）

逆向 CFG 应增加一类边：**completion edge**——否则很多关键 cleanup / copy-back / retry 代码在普通静态 call graph 中像"没人调用"。

## 十五、`STATUS_PENDING` 不是失败

做驱动协议 RE 时，`status = IoCallDriver(...); if (status == STATUS_PENDING) ...` **不要**按用户态直觉理解成"请求没完成/调用失败"——这是正常 asynchronous I/O。

真正终态在 `IRP->IoStatus.Status` 与 completion path。记录协议时应区分：

- **dispatch return status**
- **final I/O completion status**

## 十六、`PAGE` section 是语义，不只是 section 名

所有以 `PAGE` 开头的 section（`PAGE` / `PAGEABC` / `PAGEDATA` …）都被当作 **pageable section**。

- 函数在 `PAGE` → 设计上它应只在**允许 page fault 的 IRQL** 上运行
- 相反：ISR / DPC / spinlock-held path / `DISPATCH_LEVEL+` 对应的代码**必须 resident**

所以 **section 本身就是调用上下文线索**。

## 十七、偶发 0xD1 不一定是随机内存破坏

`DRIVER_IRQL_NOT_LESS_OR_EQUAL`（0xD1）优先检查：当前 IRQL、fault address、读/写/执行、faulting instruction、**目标代码/数据是否 pageable**（典型原因：DISPATCH_LEVEL 或更高 IRQL 访问 pageable memory / 执行 pageable code，或访问无效、已释放的指针）。

特别阴的一类：

> 99.99% 都没问题，压力测试突然炸

可能只是那个 `PAGE` section 平时一直 resident，**直到内存压力把它真正换出去**。所以「平时运行正常」≠「IRQL/pageability 正确」。

## 十八、Driver Verifier 开着时行为可能**故意"不正常"**

Verifier 可主动做：Special Pool / Force IRQL Checking / Pool Tracking / I/O Verification / Deadlock Detection / DMA Verification / **Low Resources Simulation** / **Force Pending I/O Requests** / IRP Logging / 同步延迟模糊 / Code Integrity checking …

也就是说它会故意让 allocation 失败、强制 pending、改变时序、更激进地驱逐 pageable memory。因此：

- 实验机一开 Verifier 就大量 `STATUS_INSUFFICIENT_RESOURCES` → **不要误判成"malware 正在耗尽资源"**，这可能是 verifier 的 fault injection
- "只有开 Verifier 才 BSOD" 通常反而说明**潜伏的 driver bug 被放大出来了**

## 十九、Verifier 抓到 IRP 错误：别只看 crash 栈顶部

I/O Verification 追踪 IRP 生命周期，检测非法 `IoCallDriver` 参数、重复/错误 complete、IRP 还挂着 cancel routine 却 complete、IRQL 变化错误、已释放的 IRP、stack-lifetime 已结束的 event/IOSB……违反时触发 **0xC9 `DRIVER_VERIFIER_IOMANAGER_VIOLATION`**。

这类 crash 的**最后一个函数可能只是 verifier 发现问题的位置**，真正犯错的地方可能更早几十步。要跟完整条链：

```
allocation → forward → pending → cancel → completion → free
```

## 二十、静态地址 ≠ 运行态地址：先想 PE relocation

`.sys` 仍是 PE image；不能加载到 preferred `ImageBase` 时，loader 按 `.reloc` 应用 base relocation。

所以 `IDA: sub_140012340` vs `runtime: fffff806'72b12340` 是正常的。做 memory-vs-disk 对比前必须先：

```
runtime VA → 减 runtime image base → RVA → 对比对应 section
```

否则会得到大量假 mismatch。

## 二十一、PDB 找到了也可能不是完整符号

Windows RE 的巨大优势是 PDB，但要区分 **public symbols** 与 **private/full symbols**：public 通常不给完整 local variables、static functions、source lines/type universe。

所以 `nt!KeSomething` 有名字、但大量内部 `sub_xxx` 没名字，**不代表符号加载失败**——可能只是你拿到的是 public symbols。

## 二十二、PDB 同名不代表匹配（signature + age）

symbol store 用 **signature + age** 选择版本——文件名相同没有任何意义。遇到：

```
*** WARNING: Unable to verify timestamp / symbols could not be loaded
```

先检查 exact binary/PDB matching；一般直接 `.symfix` → `.reload /f` → `!sym noisy`，比手工硬套一个"看起来版本一样"的 PDB 可靠。

## 二十三、`!analyze -v` 是入口，不是结论

`Probably caused by : foo.sys` **不能直接写成"foo.sys 一定是根因"**——它可能只是：

- 最后解引用坏指针的人（受害者）
- 下层已经把内存写坏
- filter stack 中最后一个可识别模块

pool corruption / UAF / DMA corruption 场景下，**真正写坏内存的 driver 往往早就离开栈了**。继续结合 `lm` / `locks` / `process` / `memory` / bugcheck parameters。

## 二十四、UMDF：看到 DLL + Wudfhost，立刻换思路

UMDF driver 是 DLL，由 **`Wudfhost.exe`** 加载；Wudfhost 负责 I/O dispatch、驱动加载、驱动分层、线程池、与 kernel reflector 通信——**一个 Wudfhost 还可能同时承载多个 UMDF driver/device stack**。

所以 `Wudfhost.exe` 崩了**不能推出"Wudfhost 自己有 bug"**——先确定：哪个 UMDF DLL、哪个 device stack、哪个 callback。

`!wdfkd.wdfumdevstacks` 可直接枚举 UMDF 设备栈（kernel 调试或 attach 到 wudfhost.exe 的用户态调试都可用）：

```
!process 0 0 wudfhost.exe          # 找 host 进程
.process /P <addr>                 # 切到该进程
!wdfkd.wdfumdevstacks              # device stack / PDO 名 / UMDriver image path / transfer mode
```

其他有用命令：`!wdfkd.wdfumtriage`、`!wdfkd.wdfldr`、`!wdfkd.wdfumirps`、`!wdfkd.wdfumfile`、`!wdfkd.wdflogdump <drivername.dll> -m`。

## 二十五、UMDF 崩溃 ≠ kernel 崩溃

UMDF 跑在用户态 host 里，所以 driver access violation **通常先杀 Wudfhost**，而不是立即整个 Windows bugcheck。

- UMDF dump 位于 **`%ProgramData%\Microsoft\WDF`**（UMDF 2.15 / Win10 1507 起；此前在 `%windir%\system32\LogFiles\WUDF`）；用 `WinDbg -z <dmp>` 打开，**`!analyze` 对它同样有效**
- WER 报告有三类事件：`WUDFHostProblem` / `WUDFUnhandledException` / `WUDFVerifierFailure`（含 ExitCode、Operation、Message（编码 IRP 的 Major/MinorFunction）、HardwareId）
- 所以确认是 UMDF 后：**userspace dump / 进程上下文**通常比一上来抓 kernel dump 更直接

## 二十六、"驱动存在但加载不了"：先查签名与策略，不要先怀疑 DriverEntry

Win10 1607 起，新的 release kernel driver 原则上要通过 Microsoft Hardware Dev Center（WHCP）签名路径；PnP package、catalog、boot driver 又各有细节。而**现在（2026 年）还有一条更硬的变化**：

> Microsoft 的 Windows Driver Policy 明确：**2026 年 4 月安全更新后，旧式 cross-signed 驱动默认不再受信任**，内核默认只接受 WHCP 签名的驱动（另有 Microsoft 维护的 allow list）。适用于 Win11 24H2 / 25H2 / 26H1 与 Server 2025 及后续版本。

实施方式是分阶段的：**先进入评估模式**（只审计不拦截；系统需满足约 100 小时运行 + 2–3 次启动相关条件才转入强制执行；期间若发现不合规的 cross-signed 驱动，会继续留在评估模式并重置计数）；企业可用 **Application Control for Business**（原 WDAC）策略覆盖（策略须由 Secure Boot PK/KEK 中的权威签名）。

所以遇到：

> 十年前的 `.sys`、签名看起来完全存在、以前能加载、现在新系统突然 block

**不要直接判断"签名损坏"**——很可能是 **legacy signing policy 已经过期**。

## 二十七、Test Mode 也不是"未签名什么都能跑"

- 即使 `TESTSIGNING ON`，在启用 **HVCI / Memory Integrity** 的环境中，测试驱动**仍要求有数字签名**（只是可以用自建 test certificate）
- 且 HVCI **仍可能否掉** test-signed 驱动（实践中需临时关掉 Memory Integrity 再装/测）
- 另外 Secure Boot 开启时 `bcdedit /set testsigning on` 可能被阻止或失败（多数场景要关 Secure Boot）

所以 `TESTSIGNING=ON + unsigned .sys + 加载失败` **不能说"Test Mode 没生效"**——还要看 HVCI / Memory Integrity、Secure Boot 与签名。加载失败的典型码：**0xC0000428（STATUS_INVALID_IMAGE_HASH）**，CodeIntegrity 日志 **Event ID 219**。

## 二十八、HVCI 下老驱动的奇怪失败：可能是**设计本身不兼容**

HVCI（Memory Integrity）的核心：**内核内存页永远不能同时可写+可执行（W+X）**，可执行代码不能被直接修改，内核内存变可执行只能经由 CI 验证。官方兼容要求：

- 默认 NX、用 NX 分配（`NonPagedPoolNx`）
- **不用既写又可执行的 section**；**不直接修改可执行系统内存**
- **不在内核使用动态代码**（自解密 stub、JIT、运行时生成代码）
- 不把数据文件当可执行加载；section 对齐为 0x1000 的整数倍

因此老驱动里若有：分配 RWX pool / 生成 trampoline / runtime patch kernel text / JIT code——**HVCI off 时也许能跑，on 时可能直接失败**。

> 不要第一时间认为"新 Windows 把 undocumented API 改了"——**可能撞的是 CI/VBS 策略**。

补充时间点：Microsoft 计划自 **2026-10-13** 起在符合条件的 Win11 设备上**默认启用 Memory Integrity**（前提之一正是"没有不兼容的内核驱动"）。

## 二十九、x64 上"老教程的 kernel patching"思维尤其危险

Microsoft 明确要求 x64 driver **不应**修改 kernel code、IDT/GDT、undocumented kernel structures——这类行为可能触发 `CRITICAL_STRUCTURE_CORRUPTION`（历史的 KPP 就是为保护内核代码与关键结构）。

所以分析现代合法驱动时，如果**没看到** SSDT hook / inline ntoskrnl patch / IDT hook，**不是"它功能少"**——现代驱动更应该通过 documented callback、filter model、WFP、minifilter、Ob callbacks、process/thread/image notify、registry callback 实现观察与控制。

## 三十、安全产品不 hook SSDT 也完全可以深度监控进程

Windows 正式提供 `PsSetCreateProcessNotifyRoutineEx*`、`ObRegisterCallbacks` 等；Microsoft 自己的 sample 就演示「进程创建通知 + 进程句柄 access restriction」的组合。

所以看到 EDR/AV driver **没有 SSDT hook，绝对不能得出"它没监控进程"**。应搜 **callback-registration graph**：

```
PsSetCreateProcessNotifyRoutine* / PsSetCreateThreadNotifyRoutine*
PsSetLoadImageNotifyRoutine* / ObRegisterCallbacks / CmRegisterCallbackEx
FltRegisterFilter / Ndis*Register* / StorPort / WDF 注册点 ...
```

这比找 inline hook 更适合现代 Windows。

## 三十一、一个函数没有任何 xref，也可能是 callback

Windows 内核与 Linux 一样高度 callback-driven：DriverObject dispatch、PnP、ISR/DPC、timer、work item、completion routine、KMDF event、NDIS callback、FltMgr callback、Ob callback、registry callback、process notify……

所以反编译器显示 **0 callers 不能自动标 dead code**。先看它的地址是否：

```
写进 registration structure / 传给 registration API
写进 DriverObject / 写进 WDF config
```

Windows driver RE 应同时维护 **call graph 与 callback-registration graph**。

## 三十二、同一个 IRP 被很多 driver 碰过是正常的

```
app → upper filter → function driver → lower filter → bus
```

每层都可能：修改 stack location、设置 completion routine、forward、complete。所以看到「同一个 MajorFunction 在四个 `.sys` 里都有 handler」**不是重复实现**——这正是 Windows layered I/O model。

逆向时最好恢复 **IRP flow graph**，而不只是每个 driver 单独的 CFG。

## 三十三、Minifilter unload 后还有 completion 行为，不一定 UAF

Filter Manager 专门负责 minifilter 生命周期，并能协调 unload 时仍未完全结束的操作（也允许 minifilter 安全动态卸载）。

所以捕获 trace 时看到「开始 unload → 还有旧 I/O completion → 最后才彻底消失」**并不自动意味着"已卸载代码仍被调用"**。需要精确区分四态：

```
unload initiated → instance detach → outstanding operations drain → image actually gone
```

## 决策树

```
拿到 Windows driver
├─ 先确定模型：WDM / KMDF / UMDF / minifilter / NDIS / miniport / filter driver
├─ entry 看起来奇怪
│    ├─ GsDriverEntry? framework wrapper? 真正 DriverEntry 在下一层?
├─ 找不到 IRP handler
│    ├─ KMDF callback? NDIS/miniport callback? minifilter callback? UMDF?
├─ 恢复安装上下文：INF / service / hardware ID / UpperFilters·LowerFilters / AddFilter
├─ 恢复 I/O
│    ├─ DriverObject MajorFunction / IOCTL CTL_CODE / buffering method
│    ├─ IRP stack / pending / completion edge
├─ 文件系统：FltRegisterFilter / FLT_REGISTRATION / pre-post callback / altitude
├─ 地址·符号怪
│    ├─ PE relocation? runtime image base? PDB exact match? public vs private PDB?
├─ 随机 crash
│    ├─ IRQL? PAGE section? UAF/pool? pending/completion lifetime? DMA?
│    └─ 是否开着 Driver Verifier?
├─ driver 加载失败
│    ├─ architecture? signing? 2026 legacy cross-sign policy? Secure Boot? HVCI? INF/PnP 绑定?
└─ 怀疑 rootkit
     ├─ 不要只找 SSDT → callback ownership / filter·device stack / registered notify callbacks
     ├─ loaded image · executable memory · runtime code integrity
     └─ cross-view + dump analysis
```

## 工具准备

参考 [[re-analyze/platform-tips]]——驱动加载/内核调试属动态执行，默认沙箱（调试机 VM）内进行；静态分析部分免沙箱。

- **反编译与驱动类型**：[[re-ghidra]]（默认；Data Type Manager 导入 Windows 内核类型，字段名直接参与反编译）/ [[re-ida]]（FLIRT 内核签名 + 类型库）。验证：导入 `.sys` 后能反编译出带参数签名的函数
- **WinDbg 内核调试**（[[re-windbg]]）：双机/VM 串口或 KDNET。验证：`lm` 看到目标驱动、`.reload /f <驱动名>` 加载符号
- **符号**：Microsoft 公共符号 `srv*C:\symbols*https://msdl.microsoft.com/download/symbols`；驱动自带 PDB 同名放置；遇到匹配问题用 `.symfix` + `!sym noisy`。验证：`!process 0 0` 输出带 `nt!` 前缀
- **测试签名**（仅调试 VM，且注意 HVCI）：`bcdedit /set testsigning on` 重启（多数场景需关 Secure Boot）；验证 `bcdedit /enum {current}` 为 Yes
- **WDF/UMDF 扩展**：`!wdfkd.wdfumdevstacks` / `wdfumtriage` / `wdfldr` / `wdfumirps` / `wdflogdump`；UMDF dump 在 `%ProgramData%\Microsoft\WDF`
- **Verifier**：`verifier`（分析目标 bug 时先确认它开没开，见 §18–19）

## 该平台的坑（汇总）

- **把所有 `.sys` 当 WDM**：KMDF/NDIS/miniport/minifilter 的 WDM dispatch 由 framework 持有
- **把 `GsDriverEntry` 当业务入口**；**把 `MajorFunction` 为空当"无 I/O"**
- **在 KMDF 上找 `IoCallDriver` 链路**：`!drvobj` 指向 Wdf01000.sys 是正常的，去找 Evt* callback（含 `WDF_*_CONFIG` 的 dataflow）
- **在 miniport 上找 IRP handler**：去找 `Ndis*/StorPort/PortCls` 注册 callback；网卡驱动没有 READ/WRITE 也正常
- **把设备行为只归给 function driver**：先恢复 AttachedDevice 链与 image owner
- **漏看 INF**：`UpperFilters`/`LowerFilters`/`AddFilter` 决定它在设备栈中的位置
- **把 minifilter 的 pre/post 流水线当 recursion**；**把 altitude 当版本号**
- **把 IOCTL 当 magic integer**：先解 `CTL_CODE`（尤其 Method）
- **把 `METHOD_NEITHER` 的用户指针当"内核指针损坏"**
- **把 `IoCallDriver` 返回当 I/O 结束**、**把 `STATUS_PENDING` 当失败**
- **忽略 `PAGE` section 的 IRQL 语义**，把偶发 0xD1 当随机破坏
- **把 Driver Verifier 的故障注入当恶意行为**；**只看 0xC9 栈顶**
- **忘了 PE relocation** 就做内存-磁盘对比；**拿文件同名当 PDB 匹配**
- **把 `!analyze -v` 的 "Probably caused by" 当结论**
- **把 Wudfhost 崩溃当它自己的 bug**、**把 UMDF 崩溃按 kernel crash 分析**
- **2026 年仍按旧签名假设判断"加载不了"**（legacy cross-sign 已默认不受信；Test Mode 在 HVCI 下也要签名）
- **把 HVCI 下的失败当"API 变了"**（是 W+X/动态代码等设计不兼容）
- **只找 SSDT hook 判断安全产品有没有监控**；**把 0 xref 当 dead code**

## 附：Windows 专属的两份附录

- [[windows-gotchas]] —— **版本差异组**：结构布局（EPROCESS/DRIVER_OBJECT/_KPCR 偏移随 build 变）、导出符号（`KeServiceDescriptorTable` Win8 起不导出）、签名要求（attestation 等）、PatchGuard 随版本变强——同一条经验在不同 Windows 版本可能给出相反结论
- [[windows-decision-tree]] —— Windows 专属场景决策树与**证据分级**（目标类型 → 静态主线 / 交互闭环 / rootkit 分支）
