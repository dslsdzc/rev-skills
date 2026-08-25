---
name: re-kernel
description: >
  内核逆向：Windows 驱动/内核模块/rootkit。触发词：内核、驱动、.sys、rootkit、内核模块、IRP
---

# 内核逆向（Windows 驱动 / rootkit）

## 何时使用 / 何时不用

- 用：.sys 驱动/内核模块静态逆向（DriverEntry、IRP 分派、设备对象）；rootkit 特征分析（SSDT hook / inline hook / 隐藏进程）；用户态⇄驱动交互（DeviceIoControl）还原
- 用：与 [[re-windbg]] 内核调试配合做运行时验证
- 用：驱动型恶意样本（加载器/反作弊/EDR 对抗）的驱动侧还原
- 不用：只需内核运行时调试/崩溃 dump 定位（`!analyze -v` 直接走 [[re-windbg]]）
- 不用：Linux 内核模块（本技能以 Windows 为对象；Linux 侧走 [[re-format-elf]] + [[re-gdb]]/kprobes 思路另行处理）
- 不用：UEFI/引导阶段（bootkit）——固件侧走 [[re-uefi]]

## 工具准备

参考 [[platform-tips]]——驱动加载/内核调试属动态执行，默认沙箱（调试机 VM）内进行；分析产物静态部分免沙箱。

### 反编译产物（驱动结构插件）

- [[re-ghidra]]（默认）：导入 .sys 后自动分析，Data Type Manager 导入 Windows 内核类型（`ntddk.h` 相关头文件或内置 WDK 类型）——结构字段名直接参与反编译，质量远高于裸偏移
- [[re-ida]]：FLIRT 内核签名 + 类型库；idapython 批量标注
- 验证: 导入 .sys 后 DriverEntry 能反编译出带参数签名的函数（x64: `DriverEntry(PDRIVER_OBJECT, PUNICODE_STRING)`）

### WinDbg 内核调试（[[re-windbg]]）

- 双机/VM 串口（COM Named Pipe）或 KDNET（NET），配置见 [[re-windbg]]「工具准备」
- 验证: 内核会话 `lm` 能看到目标驱动模块，`.reload /f <驱动名>` 加载符号

### 符号

- Microsoft 公共符号: `srv*C:\symbols*https://msdl.microsoft.com/download/symbols`
- 驱动自带 PDB: 与 .sys 同名放符号路径，`.reload /f` 生效
- 验证: `!process 0 0` 输出带 `nt!` 符号前缀函数名

### 测试签名（VM 内加载驱动）

- 目标机（调试 VM）管理员：`bcdedit /set testsigning on` 重启生效（需关闭 Secure Boot）——测试签名驱动才能加载
- 验证: `bcdedit /enum {current}` 里 testsigning 为 Yes；`!drvobj` 能看到加载的驱动
- 注意: 生产机/加固环境不开测试签名；分析只在调试 VM 内做（见 [[gotchas]]）

## 操作步骤

按顺序执行，每步存档（驱动 sha256、IRP 表截图/笔记，[[re-triage]] 存证）。

1. **驱动入口 DriverEntry 定位**：
   - PE 入口（AddressOfEntryPoint）= 链接器入口，.sys 通常即 DriverEntry（或 EP 处 stub 一跳进入，见坑 5）
   - 签名特征: `DriverEntry(PDRIVER_OBJECT DriverObject, PUNICODE_STRING RegistryPath)`（x64 参数 rcx/rdx）；返回 STATUS_SUCCESS 才加载成功，失败路径常含 IoDeleteDevice 清理
   - DriverEntry 还常注册 `DriverUnload`（卸载时清理/撤销 IOCTL）——恶意驱动常留空实现防卸载
   - 从 DriverEntry 追踪: `IoCreateDevice` 调用、注册 MajorFunction 的数组赋值循环——这就是分发表的来源

2. **IRP 分发表（MajorFunction）**：
   - DriverObject->MajorFunction 是 28 项的函数指针数组（IRP_MJ_* 0x00-0x1B；x64 偏移 0x70，用符号字段名即可）——DriverEntry 里逐项赋值或整段 `RtlCopyMemory`
   - 对每项非默认 handler 反编译（签名 `NTSTATUS (*)(PDEVICE_OBJECT, PIRP)`）
   - 关注顺序: `IRP_MJ_DEVICE_CONTROL`（0x0E，用户态交互）、`IRP_MJ_INTERNAL_DEVICE_CONTROL`（0x0F）、`IRP_MJ_CREATE`（0x00）/`IRP_MJ_CLOSE`（0x02）、`IRP_MJ_READ`（0x03）/`IRP_MJ_WRITE`（0x04）
   - 每个 handler 里看: `IoGetCurrentIrpStackLocation(irp)` 取参数 → 分支处理（IOCTL 码分派）
   - handler 内先看参数校验（InputBufferLength/OutputBufferLength 检查）——长度校验缺失是驱动类漏洞常见成因（漏洞面分析转 [[re-vuln]] 思路）

3. **设备对象 / 符号链接**：
   - `IoCreateDevice` 参数: DeviceName（`\Device\MyDriver`）；`IoCreateSymbolicLink` 参数: SymbolicLinkName（`\DosDevices\MyDriver` → 用户态 `\\.\MyDriver`）
   - 由符号链接名字推断用户态入口点；没有符号链接时用户态可用 `DeviceIoControl` 直接打 `\\.\` 名（或无符号名时只能内部引用）
   - 动态核对: `!drvobj <驱动名>` 看设备对象链、`!devobj <设备>` 看设备名与 AttachedDevice——与静态字符串对照，确认设备名没有在运行期被改
   - 多层设备栈（filter 驱动）：`IoAttachDevice`/`IoAttachDeviceToDeviceStack` 挂到既有设备上——看到这两个 API 即为拦截型驱动（文件/键盘过滤等）

4. **服务注册与加载入口**：
   - SCM 注册: `CreateServiceW`（Type=SERVICE_KERNEL_DRIVER 1、Start=2 自动/3 手动/0 引导）或 INF 安装——恶意加载器常用 `Start=3` + 手动启动
   - 注册表: `HKLM\SYSTEM\CurrentControlSet\Services\<驱动名>` 的 ImagePath 指向 .sys
   - 服务启动失败码速查: 577 = 签名错误、1275 = 未签名驱动被拒（x64）——先查测试签名状态再查代码
   - 由用户态样本（[[re-binary-core]]）的创建服务调用反推驱动名，与静态 .sys 对应——确认加载链

5. **rootkit 特征**：
   - **SSDT hook**: 内核调试 `!ssdt` 输出对照正常表（模块归属异常的地址即嫌疑）；静态侧: 搜 `.data` 区对 `KeServiceDescriptorTable` 相关地址的引用与写入（Win8 起该符号不再导出，hook 落点常在按索引改表；且 x64 PatchGuard 检测此类修改，见坑 7）
   - **inline hook（内联钩子）**: 函数头指令被改写（典型 `mov rax, <hook地址>; jmp rax`，或 5 字节 `jmp rel32`）——函数地址本身不变，必须逐字节比函数头（≥16 字节）与原始内核镜像（`lmv m nt` 拿 ntoskrnl.exe 路径 → 从原始镜像文件读取对应字节对照）
   - **隐藏进程/驱动**: 摘链表（DKOM）——内核调试 `!process 0 0` 与任务管理器/`sc query` 枚举结果对比，差集即隐藏项；驱动隐藏看 `!drvobj` 与 SCM 列表差异；对应内存取证插件对照见步骤 8
   - **回调滥用**: `PsSetCreateProcessNotifyRoutine` / `PsSetLoadImageNotifyRoutine` 回调数组里的非常规地址（内核调试 `!pcr` 区段或符号内核对）；注册表回调 `CmRegisterCallbackEx`、句柄回调 `ObRegisterCallbacks` 同理
   - **minifilter（文件系统过滤）**: `FltRegisterFilter` + FLT_REGISTRATION 结构——文件隐藏/篡改的现代手法，静态特征在 `Flt*` 导入与注册表 `\Registry\Machine\System\CurrentControlSet\Services\<名>\Instances` 配置

6. **与用户态交互（DeviceIoControl）**：
   - 用户态: `CreateFile("\\.\MyDriver")` → `DeviceIoControl(h, IOCTL_CODE, inbuf, insize, outbuf, outsize, ...)`
   - 驱动侧 handler: `IoGetCurrentIrpStackLocation(irp)->Parameters.DeviceIoControl` 取 `IoControlCode`/`InputBufferLength`/`OutputBufferLength`；`METHOD_BUFFERED` 用 `irp->AssociatedIrp.SystemBuffer`，`METHOD_NEITHER` 用 `Type3InputBuffer`
   - IOCTL 码解码: bit0-1 方法（0=BUFFERED、1=IN_DIRECT、2=OUT_DIRECT、3=NEITHER）、bit14-15 访问权限、bit2-13 功能号、高 16 位设备类型（`FILE_DEVICE_UNKNOWN`=0x22 常见）——由用户态样本的 DeviceIoControl 参数反推驱动期望的输入结构布局
   - 闭环: 用户态样本拿 IOCTL + 输入结构 → 驱动对应 handler 分析处理逻辑 → 数据结构逐字段对齐（结构体在 Ghidra/IDA 中定义后类型传播复核）

7. **内核调试验证**（沙箱调试 VM）：
   - 断点: `bu nt!<函数>`（未解析模块符号可等加载）、`bp <模块>!<函数>`、`ba e1 <地址>`（硬件断点）；`bd/be` 禁用/启用
   - 验证交互闭环: 用户态触发 DeviceIoControl → 内核断点命中 handler → 看参数与返回
   - 崩溃定位: `!analyze -v`；驱动问题蓝屏后 `!drvobj <名>`/`!devobj` 确认对象状态

8. **内存取证对照**（rootkit 检测复核）：
   - 调试机内存转储 → [[re-mem-forensics]]（Volatility）：`psxview`/`modules`/`driverscan`/`callbacks`/`ssdt` 插件输出与步骤 5 的调试会话观察对照
   - 对照点: 隐藏进程差集、异常回调地址、SSDT/驱动表差异——取证结论与调试证据互相印证

9. **证据核对（收尾）**：驱动 sha256、IRP 表、IOCTL 清单、rootkit 特征证据（hook 点字节对照）、调试日志——全部入档 [[analysis-contract]]，结论写 [[re-malware]] 衔接报告

## 跨域联合

- [[re-windbg]]：内核调试、`!analyze -v`、驱动运行时验证（本技能固定依赖）
- [[re-binary-core]]：驱动静态初勘底座（[[re-format-pe]] 解析 .sys 头、[[re-imports]] 看 ntoskrnl 导出依赖）
- [[re-malware]]：rootkit/驱动型恶意样本深度分析环节引用本技能
- [[re-anti-analysis]]：驱动加壳/混淆对抗（驱动壳先脱壳）
- [[re-sandbox]]：驱动加载测试环境隔离（VM + 快照，[[platform-tips]] 最高原则）
- [[re-emulation]]：摘出的驱动关键函数可模拟执行验证
- [[re-mem-forensics]]：rootkit 取证对照（步骤 8）
- [[re-ebpf]]：eBPF 程序逆向（BPF-64 指令集、progs/maps、xlated）——非 .ko 形态的内核代码走本技能
- 反编译工具选型: [[re-ghidra]] / [[re-ida]] / [[re-binaryninja]] 三选一

## 常见坑与陷阱

- **内核结构随版本变化**：现象——按旧版本文档的偏移（如 EPROCESS/DRIVER_OBJECT 内部字段）读新版系统数据全错；原因——Windows 各版本结构布局不同；对策——有符号用符号字段名（最稳），无符号时按 `ntddk.h` 公开结构手工布局并标注目标版本（Win10/11 差异大），别跨版本复用偏移
- **无符号时靠逆向结构**：现象——驱动无 PDB 且符号服务器不可达，`k`/反编译全裸偏移；原因——符号缺失；对策——头文件导入（Ghidra Data Type Manager 载入 ntddk.h 系结构定义）、按 `Io*` API 调用参数反推类型、与公开符号版本的结构定义对照手工标注
- **inline hook 检测只看函数地址**：现象——`!ssdt` 显示的地址正常但函数行为被改；原因——inline hook 不改表项地址、改写函数头指令（5 字节 jmp 或 `mov rax;jmp rax`）；对策——必须逐字节比对函数开头（≥16 字节）与原始内核镜像文件；指令解码用 capstone（[[re-emulation]] 思路）
- **内核崩溃 = 蓝屏**：现象——驱动加载/触发时目标机蓝屏（bugcheck）；原因——内核态错误无进程隔离，直接宕机；对策——所有加载/触发在调试 VM 内做（宿主 WinDbg 连接），操作前打快照（[[re-sandbox]] + [[platform-tips]] 最高原则），崩溃后 `!analyze -v` 定位再回滚快照重试
- **DriverEntry 不在入口点**：现象——EP 处只有一小段 stub 或壳代码；原因——驱动加壳/EP 重定向；对策——跟踪 EP stub 跳转找真 DriverEntry，壳驱动先走 [[re-anti-analysis]] 脱壳再分析
- **驱动加载失败先查签名与测试模式**：现象——sc start 报错 577（签名）或 1275（未签名被拒）；原因——x64 强制驱动签名；对策——调试 VM 开测试签名（bcdedit，需关 Secure Boot），生产机不加载分析
- **PatchGuard 拦截经典 hook**：现象——SSDT/inline hook 上线后系统随机 bugcheck 0x109（CRITICAL_STRUCTURE_CORRUPTION）；原因——x64 PatchGuard（KPP）校验被保护结构与代码；对策——分析时区分"历史手法"（Win7 时代有效）与"当前可用"：SSDT/关键函数 inline hook 在 x64 新版即触发 PatchGuard，别在真实环境验证此类行为（见 [[gotchas]]）
- 更多边界（测试签名限制、取证对照、VM 环境）见 [[gotchas]] 与 [[decision-tree]]
