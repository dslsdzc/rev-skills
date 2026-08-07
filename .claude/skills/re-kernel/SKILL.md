---
name: re-kernel
description: >
  内核逆向：Windows 驱动/内核模块/rootkit。触发词：内核、驱动、.sys、rootkit、内核模块、IRP
---

# 内核逆向（Windows 驱动 / rootkit）

## 何时使用 / 何时不用

- 用：.sys 驱动/内核模块静态逆向（DriverEntry、IRP 分派、设备对象）；rootkit 特征分析（SSDT hook / inline hook / 隐藏进程）；用户态⇄驱动交互（DeviceIoControl）还原
- 用：与 [[re-windbg]] 内核调试配合做运行时验证
- 不用：只需内核运行时调试/崩溃 dump 定位（`!analyze -v` 直接走 [[re-windbg]]）
- 不用：Linux 内核模块（本技能以 Windows 为对象；Linux 侧走 [[re-format-elf]] + [[re-gdb]]/kprobes 思路另行处理）

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

## 操作步骤

按顺序执行，每步存档（驱动 sha256、IRP 表截图/笔记，[[re-triage]] 存证）。

1. **驱动入口 DriverEntry 定位**：
   - PE 入口（AddressOfEntryPoint）= 链接器入口，.sys 通常即 DriverEntry（或 EP 处 stub 一跳进入，见坑 4）
   - 签名特征: `DriverEntry(PDRIVER_OBJECT DriverObject, PUNICODE_STRING RegistryPath)`（x64 参数 rcx/rdx）
   - 从 DriverEntry 追踪: `IoCreateDevice` 调用、注册 MajorFunction 的数组赋值循环——这就是分发表的来源

2. **IRP 分发表（MajorFunction）**：
   - DriverObject->MajorFunction 是 28 项的函数指针数组（x64 偏移 0x70，用符号字段名即可）——DriverEntry 里逐项赋值或整段 `RtlCopyMemory`
   - 对每项非默认 handler 反编译（签名 `NTSTATUS (*)(PDEVICE_OBJECT, PIRP)`）
   - 关注顺序: `IRP_MJ_DEVICE_CONTROL`（0x0E，用户态交互）、`IRP_MJ_CREATE`/`IRP_MJ_CLOSE`、`IRP_MJ_READ`/`IRP_MJ_WRITE`
   - 每个 handler 里看: `IoGetCurrentIrpStackLocation(irp)` 取参数 → 分支处理（IOCTL 码分派）

3. **设备对象 / 符号链接**：
   - `IoCreateDevice` 参数: DeviceName（`\Device\MyDriver`）；`IoCreateSymbolicLink` 参数: SymbolicLinkName（`\DosDevices\MyDriver` → 用户态 `\\.\MyDriver`）
   - 由符号链接名字推断用户态入口点；没有符号链接时用户态可用 `DeviceIoControl` 直接打 `\\.\` 名（或无符号名时只能内部引用）

4. **rootkit 特征**：
   - **SSDT hook**: 内核调试 `!ssdt` 输出对照正常表（模块归属异常的地址即嫌疑）；静态侧: 搜 `.data` 区对 `KeServiceDescriptorTable` 相关地址的引用与写入（新版 Windows 导出受限，hook 落点常在按索引改表）
   - **inline hook（内联钩子）**: 函数头指令被改写（典型 `mov rax, <hook地址>; jmp rax`，或 5 字节 `jmp rel32`）——函数地址本身不变，必须逐字节比函数头（≥16 字节）与原始内核镜像（`lmv m nt` 拿 ntoskrnl.exe 路径 → 从原始镜像文件读取对应字节对照）
   - **隐藏进程/驱动**: 摘链表（DKOM）——内核调试 `!process 0 0` 与任务管理器/`sc query` 枚举结果对比，差集即隐藏项；驱动隐藏看 `!drvobj` 与 SCM 列表差异
   - **回调滥用**: `PsSetCreateProcessNotifyRoutine` / `PsSetLoadImageNotifyRoutine` 回调数组里的非常规地址（内核调试 `!pcr` 区段或符号内核对）

5. **与用户态交互（DeviceIoControl）**：
   - 用户态: `CreateFile("\\.\MyDriver")` → `DeviceIoControl(h, IOCTL_CODE, inbuf, insize, outbuf, outsize, ...)`
   - 驱动侧 handler: `IoGetCurrentIrpStackLocation(irp)->Parameters.DeviceIoControl` 取 `IoControlCode`/`InputBufferLength`/`OutputBufferLength`；`METHOD_BUFFERED` 用 `irp->AssociatedIrp.SystemBuffer`，`METHOD_NEITHER` 用 `Type3InputBuffer`
   - IOCTL 码解码: 高 16 位设备类型（`FILE_DEVICE_*`）、bit0-1 方法（0=BUFFERED）、bit14-15 访问权限——由用户态样本（[[re-binary-core]] 分析）的 DeviceIoControl 参数反推驱动期望的输入结构布局
   - 闭环: 用户态样本拿 IOCTL + 输入结构 → 驱动对应 handler 分析处理逻辑 → 数据结构逐字段对齐（结构体在 Ghidra/IDA 中定义后类型传播复核）

## 跨域联合

- [[re-windbg]]：内核调试、`!analyze -v`、驱动运行时验证（本技能固定依赖）
- [[re-binary-core]]：驱动静态初勘底座（[[re-format-pe]] 解析 .sys 头、[[re-imports]] 看 ntoskrnl 导出依赖）
- [[re-malware]]：rootkit/驱动型恶意样本深度分析环节引用本技能
- [[re-anti-analysis]]：驱动加壳/混淆对抗（驱动壳先脱壳）
- [[re-sandbox]]：驱动加载测试环境隔离（VM + 快照，[[platform-tips]] 最高原则）
- [[re-emulation]]：摘出的驱动关键函数可模拟执行验证
- 反编译工具选型: [[re-ghidra]] / [[re-ida]] / [[re-binaryninja]] 三选一

## 常见坑与陷阱

- **内核结构随版本变化**：现象——按旧版本文档的偏移（如 EPROCESS/DRIVER_OBJECT 内部字段）读新版系统数据全错；原因——Windows 各版本结构布局不同；对策——有符号用符号字段名（最稳），无符号时按 `ntddk.h` 公开结构手工布局并标注目标版本（Win10/11 差异大），别跨版本复用偏移
- **无符号时靠逆向结构**：现象——驱动无 PDB 且符号服务器不可达，`k`/反编译全裸偏移；原因——符号缺失；对策——头文件导入（Ghidra Data Type Manager 载入 ntddk.h 系结构定义）、按 `Io*` API 调用参数反推类型、与公开符号版本的结构定义对照手工标注
- **inline hook 检测只看函数地址**：现象——`!ssdt` 显示的地址正常但函数行为被改；原因——inline hook 不改表项地址、改写函数头指令（5 字节 jmp 或 `mov rax;jmp rax`）；对策——必须逐字节比对函数开头（≥16 字节）与原始内核镜像文件；指令解码用 capstone（[[re-emulation]] 思路）
- **内核崩溃 = 蓝屏**：现象——驱动加载/触发时目标机蓝屏（bugcheck）；原因——内核态错误无进程隔离，直接宕机；对策——所有加载/触发在调试 VM 内做（宿主 WinDbg 连接），操作前打快照（[[re-sandbox]] + [[platform-tips]] 最高原则），崩溃后 `!analyze -v` 定位再回滚快照重试
- **DriverEntry 不在入口点**：现象——EP 处只有一小段 stub 或壳代码；原因——驱动加壳/EP 重定向；对策——跟踪 EP stub 跳转找真 DriverEntry，壳驱动先走 [[re-anti-analysis]] 脱壳再分析
