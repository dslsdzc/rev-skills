# Windows 驱动分支（.sys / IRP / rootkit）

观测对象是 **PE 格式的驱动（.sys）**，通过 SCM 注册加载，类型信息来自 PDB 或 WDK 头文件。

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

9. **证据核对（收尾）**：驱动 sha256、IRP 表、IOCTL 清单、rootkit 特征证据（hook 点字节对照）、调试日志——全部入档 [[re-analyze/analysis-contract]]，结论写 [[re-malware]] 衔接报告

## 工具准备

参考 [[re-analyze/platform-tips]]——驱动加载/内核调试属动态执行，默认沙箱（调试机 VM）内进行；分析产物静态部分免沙箱。

- **反编译与驱动类型**：[[re-ghidra]]（默认；Data Type Manager 导入 Windows 内核类型，字段名直接参与反编译）/ [[re-ida]]（FLIRT 内核签名 + 类型库）。验证：导入 .sys 后 DriverEntry 能反编译出带参数签名的函数
- **WinDbg 内核调试**（[[re-windbg]]）：双机/VM 串口或 KDNET。验证：`lm` 看到目标驱动、`.reload /f <驱动名>` 加载符号
- **符号**：Microsoft 公共符号 `srv*C:\symbols*https://msdl.microsoft.com/download/symbols`；驱动自带 PDB 同名放置。验证：`!process 0 0` 输出带 `nt!` 前缀
- **测试签名**（仅调试 VM）：`bcdedit /set testsigning on` 重启（需关 Secure Boot）；验证 `bcdedit /enum {current}` 为 Yes。生产机不开

## 该平台的坑

- **内核结构随版本变化**：按旧版本文档的偏移读新版结构全错——有符号用字段名（最稳），无符号按 `ntddk.h` 公开结构手工布局并标注目标版本
- **无符号时靠逆向结构**：Ghidra 导入头文件类型定义、按 `Io*` API 参数反推类型
- **inline hook 检测只看函数地址**：函数地址正常但行为被改——必须逐字节比对函数开头（≥16 字节）
- **内核崩溃 = 蓝屏**：内核态错误无进程隔离——所有加载/触发在调试 VM 内做，操作前打快照，崩溃后 `!analyze -v` 定位再回滚重试
- **DriverEntry 不在入口点**：EP 处只有 stub 或壳代码——跟踪跳转找真 DriverEntry，壳驱动先 [[re-anti-analysis]]
- **驱动加载失败先查签名与测试模式**：577/1275 先查测试签名状态
- **PatchGuard 拦截经典 hook**：x64 PatchGuard 校验被保护结构与代码，SSDT/inline hook 会随机 bugcheck 0x109——区分"历史手法"与"当前可用"，不在真实环境验证此类行为
- 更多边界（测试签名限制、取证对照、VM 环境）见 [[windows-gotchas]] 与 [[windows-decision-tree]]
