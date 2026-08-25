---
name: re-windbg
description: >
  WinDbg 调试（Windows 用户态+内核）。触发词：WinDbg、windbg、内核调试、kd、!analyze
---

# WinDbg 动态调试（Windows 用户态 + 内核）

## 何时使用 / 何时不用

- 用：Windows 用户态进程调试（启动/附加、断点、单步、寄存器）；崩溃/异常分析（`!analyze -v`）；内核调试（双机/VM/本地 kd）；驱动与内核模块分析（配合 [[re-kernel]]）；崩溃 dump（minidump/full dump）分析
- 用：时间旅行调试（TTD）——`ttd.exe` 录制 .run 轨迹后任意回放，适合「复现一次慢慢查」的校验/解密逻辑（见 [[commands]] TTD 节）
- 不用：Linux 目标（走 [[re-gdb]]）；macOS 目标（[[re-lldb]]）；只需轻量 GUI 调试（[[re-x64dbg]] 更快）
- 不用：WSL 内跨边界 attach Windows 进程（[[platform-tips]] WSL 分支：跨边界走 Windows 侧工具）

## 工具准备

参考 [[platform-tips]] Windows 分支——attach 需要管理员权限；调试属动态执行，默认沙箱内进行（[[platform-tips]] 最高原则）。

### WinDbg（微软商店版 / Windows SDK / WDK）

- 商店版（新 UI WinDbg）：`winget install Microsoft.WinDbg`（或 Microsoft Store 搜索 "WinDbg"）
- 经典版：Windows SDK 安装器勾选 "Debugging Tools for Windows"；`choco install windbg`
- WDK（含内核调试工具 kd.exe/kdnet.exe）：`winget install Microsoft.WindowsWDK` 或 Visual Studio 安装器勾选 WDK
- 验证: 打开 WinDbg，`File > Open Executable` 加载任意 exe 能停在初始断点；命令窗口 `ver` 输出版本号
- 版本差异: 商店版（WinDbg 1.x，Chromium UI）与经典版（WinDbg 10.0.x）命令兼容，UI 与附加流程不同；dump 分析两者通用（见 [[gotchas]]）

### Windows 符号（Windows SDK 符号 / 公共符号服务器）

- 符号路径: `.sympath srv*C:\symbols*https://msdl.microsoft.com/download/symbols`（或设环境变量 `_NT_SYMBOL_PATH`）
- 内核模块符号: 内核调试下 `.reload /f nt`（强制从符号服务器拉取）
- 验证: `!analyze -v` 输出中出现函数名而非 `+0x1a` 裸偏移

### 双机/虚拟机内核调试环境

- 目标机（被调试）: `bcdedit /debug on` + `bcdedit /dbgsettings serial debugport:1 baudrate:115200`（串口）或 `bcdedit /dbgsettings net hostip:<宿主机IP> port:50000 key:<kdnet.exe生成的key>`（NET 网卡，Windows 10+ 推荐）
- VM 场景: VMware/Hyper-V 给目标 VM 添加串口设备（Named Pipe `\\.\pipe\com_1` / `-vmconnect`），宿主 WinDbg `File > Kernel Debug > COM` 填管道名
- 本地内核调试（仅测试机，需测试签名）: `bcdedit /set testsigning on` 重启后，WinDbg `File > Kernel Debug > Local`
- 验证: 目标机重启停在 "Waiting to reconnect" 或进入调试等待后，宿主 WinDbg 附加成功、`g` 后 `Ctrl+Break` 能中断、`lm` 列出模块

### TTD（时间旅行调试，Windows 10 1903+）

- 录制: `ttd.exe -out C:\traces target.exe`（或 `-attach <pid>` 附加录制；`-monitor <进程名>` 监控启动）
- 打开: WinDbg `File > Open` 选 `.run` 轨迹文件（或 `Open Trace File`）
- 验证: `!tt` 能跳到任意位置、`g-` 能往回跑（详见 [[commands]] TTD 节）

## 操作步骤

1. **附加/启动用户态目标**：
   - 启动: `File > Open Executable` 选目标 exe，停在初始断点（ntdll 加载完成处）
   - 附加: `File > Attach to Process` 按 PID/进程名选目标（**管理员权限**启动 WinDbg 才能附加高权限进程）
   - 命令行: `windbg -p <pid>` / `windbg 目标.exe`；`-g` 跳过初始断点直接运行

2. **断点 / 单步 / 寄存器**：
   - 符号断点: `bp kernel32!CreateFileW`；地址断点: `bp 0x401000`；`bl` 列表、`bd`/`be` 禁用/启用、`bc *` 清空
   - 未加载模块的符号用 `bu`（unresolved，模块加载后自动绑定）——目标 DLL 按需加载时 `bu` 是正解
   - 命令断点: `bp 地址 "r rax; k; gc"`——命中时打印现场后自动继续，日志式观察不打断流程
   - 单步: `g` 继续、`p` 步过、`t` 步入、`gu` 执行到当前函数返回
   - 寄存器: `r` 全部、`r rax` 查看、`r eax=0` 修改（绕过校验常用）
   - 内存/反汇编: `u 0x401000` 反汇编、`dd`/`db` 读内存、`dps rsp` 看栈内容
   - 搜索: `s -d 0x0 L?10000000 0xdeadbeef`（值）、`s -a 0x0 L?10000000 "text"`（ASCII 串）——找硬编码常量/密钥用
   - 符号搜索: `x 模块!*关键字*`（如 `x kernel32!*Virtual*`）——不确定精确符号名时模糊匹配

3. **异常分析 `!analyze -v`**：
   - 目标崩溃停下后: `!analyze -v` → 读 `EXCEPTION_CODE`、`FAULTING_IP`、`STACK_TEXT`、`PROCESS_NAME`
   - 现场恢复: 从 `STACK_TEXT` 取 `EXCEPTION_RECORD` 地址 `.exr <addr>`（异常记录），再取 `CONTEXT` 地址 `.cxr <addr>` 恢复寄存器现场，之后 `k` 出真实调用栈（栈损坏时唯一可靠的栈回溯方式）
   - dump 现场更简单: 打开 dump 后直接 `.ecxr`（自动用异常上下文设寄存器现场）→ `k`——minidump 分析标准开局
   - dump 分析: `File > Open Crash Dump` 打开 `.dmp`（用户态用 `.dump /ma` 生成；内核蓝屏用 `%SystemRoot%\Minidump\*.dmp` 或完全 dump），同样 `!analyze -v` 出 bugcheck 码与故障模块

4. **内核调试（双机 / VM / 本地 kd）**：
   - 目标机配置见「工具准备」；配置后重启，宿主 `File > Kernel Debug` 按所用传输（COM/NET）连接
   - VM 管道串口流程: 目标 VM 加串口 Named Pipe → 目标机 `bcdedit /dbgsettings serial` → 宿主 `File > Kernel Debug > COM` 填管道名（`\\.\pipe\com_1`）→ 目标机重启等连
   - 连接后: `g` 让目标继续跑；`Ctrl+Break` 随时中断回调试器；`!process 0 0` 确认会话活着
   - 本地调试: `bcdedit /set testsigning on` 重启后 `File > Kernel Debug > Local`（仅测试机，不影响生产机的用法）

5. **扩展命令**：
   - `!process 0 0`（全部进程列表）、`!process <EPROCESS> 1`（单进程详情+线程）；`.process /p <EPROCESS>` 切到目标进程上下文后再 `k`/`!thread`
   - `!teb`（当前线程 TEB）、`!peb`（当前进程 PEB——命令行、加载模块、环境块）
   - `lm`（模块列表，行尾 `(deferred)`=符号未加载、`(no symbols)`=无符号）、`lmv m <模块>`（版本+路径）、`lmi <模块>`（镜像头）
   - `kv`（带符号完整栈回溯，驱动分析常用）、`!analyze -v` 后按 `STACK_TEXT` 逐帧核对
   - 驱动专项: `lmv m 驱动名` 拿基址 → `.reload /f 驱动名` 加载符号 → 深挖转 [[re-kernel]]

6. **TTD 回放（校验/解密逻辑慢查）**：
   ```
   ttd.exe -out C:\traces target.exe     # 录制
   WinDbg 打开 .run → g- / t- / p-       # 往回跑
   !tt 50                                 # 跳到轨迹 50% 处
   !tt 7213:36                            # 跳指定位置（事件序号:步数）
   ```
   - 断点前移/后移: `!tt br` 在某寄存器值变化处停；`!tt bm` 在内存访问处停
   - 查询 API: `dx @$cursession.TTD.Calls("模块!函数")` 统计调用次数/参数（如 `...Calls("ntdll!mem*")`）
   - TTD 限制: 需管理员运行、用户态专用、轨迹文件很大（数 GB）、回放只读不能写内存（见 [[gotchas]]）

7. **伪寄存器与脚本化（简单自动化）**：
   - 伪寄存器: `r $t0 = 0` 起临时变量；`$$ > <文件>` 把命令输出重定向到文件（如 `$$ > c:\log.txt`）
   - 条件执行: `.if (rax==0) { ... } .else { ... }`——配合 `gc` 做断点内逻辑
   - `!runaway` 看线程 CPU 时间（找忙等/死循环线程）；`!locks` 查锁状态（挂起排查）

## 跨域联合

- [[re-binary-core]]：工作流第 6 步 Windows 调试器（用户态+内核）
- [[re-kernel]]：内核调试与驱动/rootkit 运行时验证固定调用本技能
- [[re-anti-analysis]]：反调试对抗（内核级检测点）、脱壳后验证
- [[re-malware]]：恶意样本崩溃 dump 分析与内核组件
- [[re-cracking]]：授权校验崩溃定位（`!analyze -v` 快速找崩溃原因）
- 与 [[re-x64dbg]] 互补：轻量 GUI 断点调试用 x64dbg，内核/异常现场恢复/轨迹回放用 WinDbg

## 常见坑与陷阱

- **符号未配置 → 全是裸偏移无函数名**：现象——`lm` 行尾 `(no symbols)`，`k` 输出 `ntdll!+0x1a`；原因——符号路径为空或没 `_NT_SYMBOL_PATH`；对策——`.sympath srv*C:\symbols*https://msdl.microsoft.com/download/symbols` 后 `.reload /f`，内核模块同理（先确认符号服务器可达）
- **内核调试配置错 → 目标机蓝屏死等或连不上**：现象——目标机重启后停在 debug 等待或直接进系统未中断；原因——bcdedit 传输类型/端口与宿主不一致，或物理机单机本地调试受限（PatchGuard）；对策——用 VM 串口管道最稳（两边都对 `\\.\pipe\com_1`），`bcdedit /dbgsettings` 重查配置，物理机场景优先 KDNET
- **32/64 位命令与寄存器差异**：现象——64 位目标下 `r eax` 改错值、`!teb` 字段对不上；原因——x64 上下文用 `rax/rbx...`（低 32 位是 `eax` 等）、wow64 目标线程栈在 x86 层；对策——先确认目标位数，wow64 场景 `.load wow64exts` + `!wow64exts.sw` 切到 x86 上下文
- **栈损坏时 `k` 是假象**：现象——调用栈乱（地址不像代码）；原因——栈指针被破坏/内存踩踏，常规回溯不可信；对策——用 `.exr` 拿异常记录、`.cxr` 恢复 CONTEXT 后再 `k`，必要时 `!analyze -v` 的 `STACK_TEXT` 里直接取现场
- **蓝屏 dump 打不开**：现象——`Open Crash Dump` 报格式错；原因——minidump 不完整（磁盘满）或用的 32 位 WinDbg 读 64 位 dump；对策——目标机确认内核页交换文件（crash dump 需要 pagefile）足够大，改用同位数 WinDbg
- **RPC 调用统一入口 NdrStubCall3（svchost 功能逆向）**：现象——要拦/分析某个系统功能（如 Toast 通知），不知道它经什么通道进 svchost；原因——功能实现经 RPC 到 svchost 进程，入口难找；对策——Process Monitor 看目标进程加载 rpcrt4.dll + RpcView 确认 RPC 目标进程；**所有 RPC 服务端 stub 统一走 rpcrt4 的 NdrStubCall3**（x64；NdrStubCall2 是旧版 x86，ReactOS/Wine 源码可印证）——在其下断 `kvn` 看调用来源；筛选目标调用：第三参数（r8）指向 RPC_MESSAGE（+0x1C 是 ProcNum 方法编号、+0x28 是接口描述指针 RpcInterfaceInformation → RPC_SERVER_INTERFACE 的 InterfaceId 在 +0x04）；**opnum 由 MIDL 按方法声明顺序从 0 编号**（如 PostNotification3 排第 0x29 位 → opnum=0x29），ObjectStublessClientN 中 rax=N 即 ProcNum；坑：NdrStubCall3 处理 svchost 内所有 RPC 接口，**必须按 InterfaceId + ProcNum 双重筛选**，只拦目标方法（拦错会把 Edge 等其他功能搞挂）
- TTD 限制、版本差异与符号服务器细节见 [[gotchas]]
