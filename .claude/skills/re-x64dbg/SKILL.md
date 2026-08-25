---
name: re-x64dbg
description: >
  x64dbg 调试（Windows）：attach、断点、Scylla。
  触发词：x64dbg、Windows调试、Scylla
---

# x64dbg 动态调试（Windows）

## 何时使用 / 何时不用

- 用：Windows 原生目标（PE）动态调试；attach/启动/断点/内存搜索；脱壳后 Scylla 修复 IAT
- 不用：Linux 目标（走 [[re-gdb]]）；macOS 目标（[[re-lldb]]）；WSL 内分析（跨边界不可 attach，见 [[platform-tips]] WSL 分支）
- 不用：只读内存不交互（Windows 侧用 procdump/DumpIt + Volatility，见 [[platform-tips]] Windows 分支）
- 不用：无 UI 的自动化跑批/大量脚本操作（重活交给命令框与脚本，见 [[commands]]）
- 用：需要寄存器/内存级证据链的验证场景（授权校验路径、解密时刻、调用参数），动态结论落 [[analysis-contract]]

## 工具准备

参考 [[platform-tips]] Windows 分支——attach 需要管理员权限；内存转储工具链 procdump/DumpIt。

### x64dbg

- 下载: GitHub `x64dbg/x64dbg` release（zip 解压即用，x64dbg.exe；同包内 x32dbg.exe 管 32 位目标）
- Windows: `choco install x64dbg`
- 验证: 打开 x64dbg.exe，`File > Open` 加载任意 exe 能停在入口
- 版本: 2023 年 v1.0 为唯一正式稳定版；2025.06.30 起改 CalVer 大版本（类型系统重做、AVX-512、脚本引擎重写）；快照版（dev 滚动）比 release 新但有回归风险——正式分析用 release，详见 [[gotchas]]
- 界面三件套: CPU 视图（反汇编/寄存器/内存/栈四窗格）、底部命令框（表达式+命令，见 [[commands]]）、视图切换 Alt+C / Alt+M / Alt+B 等

### Scylla（IAT 修复插件）

- 新版 x64dbg 官方 release 已内置（插件目录 plugins/ 下有 Scylla，Ctrl+I 打开）
- 独立版: GitHub `NtQuery/Scylla` release
- 验证: x64dbg 插件菜单出现 Scylla，能 Attach 到进程并列出模块

### OllyDbg（旧 32 位）

- 下载: 官网 ollydbg.de（仅 32 位，x64dbg 出现前的主力）
- 验证: 打开加载 32 位 exe 正常
- 注意: 插件/脚本/数据库与 x64dbg 不通用（见 [[gotchas]]）

## 操作步骤

1. **附加与启动两种模式（先选对入口方式）**：
   - 启动（`File > Open` / F3 / 拖拽 exe 到窗口）：调试器从进程创建就接管，默认停在系统断点（ntdll）；`Alt+F9` 跑到用户代码
   - 断点时机: `Options > Settings > Events` 标签可勾选 System/Entry Breakpoint、System/User TLS Callbacks、DLL Load/Unload、Thread Create/Exit、Exit Breakpoint——需要断入口前逻辑（TLS 回调、构造函数、DLL 加载）时在这里开对应事件，错过无法重放
   - 附加（`File > Attach` / Alt+A，管理员权限）：进程已在运行，早期初始化已执行完——防调试/防附加逻辑可能已跑过，错过就补不回来；多线程进程附加后先 F12 暂停再下断，避免线程竞态；结束用 `detach`/Alt+F2
   - 无窗口服务/后台进程: attach 后按进程名/pid 过滤
   - 动态前先静态初勘: [[re-triage]] 哈希/壳识别 → [[re-format-pe]] 看节区权限与入口——决定断点下在哪、要不要先处理反调试
   - 附加失败（权限/保护）见坑 1、3

2. **断点族**：
   - `F2` 地址/符号处软断点（INT3）；`Shift+F2` 条件断点，例: `[401000]==0x90`（仅当内存值满足）、`eax==0x1000`；断点窗口 `Alt+B` 管理（Space 启停、Delete 删除、双击改条件/日志）
   - 硬件断点: 选中行右键 > Hardware breakpoint（执行/读/写），或命令 `bph`——走 DR 寄存器，最多 4 个，可断数据访问，不修改代码字节（抗完整性校验）
   - 内存断点: `Alt+M` 内存窗口选中区域右键 > Set Memory BPX（访问/写入触发，GUARD_PAGE 实现）——查密钥解密时刻、脱壳自解密代码常用
   - 日志/命令断点: 断点窗口右键设 log 表达式与命中命令，不中断只记录——批量验证调用参数
   - 断点不命中先查模块加载: `Alt+E` 模块窗口看目标模块是否已加载；跨重载下断点用 `API名` 或 `模块.函数` 形式（如 `bp kernel32.VirtualAlloc`），模块重载后自动生效

3. **运行与跟踪组合**：
   - `F9` 继续运行；`F4` 运行到光标；`Ctrl+F9` 运行到函数返回（配合 `F8` 跳过 call 后快速出函数）；`Alt+F9` 运行到用户代码（从系统断点/库代码回到用户模块）；`F12` 暂停；`Ctrl+F2` 重启会话
   - `F7`/`F8` 单步（步入/步过）；`Shift+F7`/`Shift+F8` 单步但跳过异常（系统 API 内部异常多时用）
   - 条件跟踪: 命令 `ticnd <条件>` / `tocnd <条件>` 连续单步直到条件成立——自动遍历解密循环/搜索特定状态；trace 记录（`opentrace` 命令 + 运行）可回放指令流
   - 命令行组合见 [[commands]]（`bp`/`bph`/`bpm`/`find`/`savedata` 等底部命令框输入）

4. **内存窗口与搜索**：
   - `Alt+M` 打开 Memory Map：看节区权限（RWX 异常=壳/解密段）、模块列表
   - 搜索: `Ctrl+B` 二进制模式（如 `55 8B EC`，支持 `?` 通配），`Ctrl+F` 当前视图查找，`Shift+D` 模块内字符串
   - 定位流程: 字符串/常量 → `Ctrl+R` 找交叉引用 → 引用处断点/上溯调用者——校验比较点、解密函数都从"被谁引用"开始
   - Dump 窗口 `Ctrl+G` 跳地址；`Ctrl+E` 编辑内存（改字节绕校验）
   - 导出: 命令 `savedata <文件> <地址> <大小>` 存内存区段；`minidump <文件>` 生成全内存 dmp 供 [[re-mem-forensics]]

5. **寄存器与调用栈**：
   - 寄存器窗口直接改值（右键改 EAX/EFLAGS 等）——改返回寄存器（`EAX=0`）或标志位是最快的分支改写
   - `Alt+K` 调用栈窗口: 回溯返回地址链，定位"谁调了这里"；栈窗格看局部变量/参数（x64 传参在 RCX/RDX/R8/R9，栈上在 [rsp+0x28] 起）
   - 对调用目标下断点（`bp <API名>`）看参数，是理清加密/校验调用最直接的路径

6. **反调试绕过**：
   - 右键寄存器窗口改 EFlags/ZF 等标志位
   - 断 `IsDebuggerPresent`/`NtQueryInformationProcess` → 改返回寄存器（`EAX=0`）后 `F9`
   - 时间差/执行计数类: 断点比较指令处改比较寄存器
   - 先静态定位检测点（[[re-ida]] / [[re-format-pe]] 找检测 API 引用与特征串），再选绕过方式: 单点改返回值/标志、ScyllaHide 批量隐藏、或直接静态 patch 检测点——顺序是"先点后面"，全家桶开不出针对性结果
   - 反调试插件 ScyllaHide（x64dbg 插件管理器安装）批量隐藏调试痕迹；边界与绕过不了的情况见 [[gotchas]]

7. **Scylla 修复 IAT（脱壳后）**：
   ```
   Plugins > Scylla（Ctrl+I）→ 填 OEP → IAT Autosearch → Get Imports → Dump → Fix Dump
   ```
   - 流程: 壳内运行到 OEP（看堆栈/内存已解密的特征，或对 OEP 下硬件断点）→ `Ctrl+I` 打开 Scylla → OEP 字段填完整 VA（通常自动填充为入口点+ImageBase，手填也填 VA 不是 RVA）→ `IAT Autosearch`（普通/高级两种模式，结果差时都试）→ `Get Imports` 校验导入 → `Dump` 存出进程镜像 → `Fix Dump` 选刚才的 dump 文件，输出修复后的干净 exe（`*_SCY.exe`）
   - 失败形态: 日志出现 `IAT not found at OEP ...` = OEP 填错，回调试器确认真实 OEP 重来；Get Imports 后红色无效项可 Cut thunk 删除；dump 文件直接跑不起来是正常的——没 Fix Dump 就没有 IAT
   - 修复后的文件 sha256 与原始对照存证（见 [[re-triage]]）

8. **补丁与保存（绕校验的持久化）**：
   - `Ctrl+E` 改字节或 `Space` 原地汇编 → `View > Patches`（Ctrl+P）查看修改列表 → `Save file` 写回磁盘成新 exe / `Save patch` 导出 `.1337` 补丁文件（可分发复用）
   - 补丁前先记录原始字节，回滚用 `Undo selection`（Ctrl+Backspace）；补丁定位方法论见 [[re-patching]]

9. **证据核对（收尾）**：断点命中记录/寄存器与内存证据（`Ctrl+E` 查看后存档）、`savedata`/`minidump` 导出产物、Scylla 修复文件 sha256——全部对照 [[re-triage]] 初勘值入档，结论写 [[analysis-contract]]

## 跨域联合

- [[re-binary-core]]：工作流第 6 步（Windows 调试器）
- [[re-anti-analysis]]：脱壳（运行到 OEP + Scylla 修复）核心工具
- [[re-cracking]]：注册码/校验逻辑定位
- [[re-imports]]：Scylla 修复后的 IAT 完整性对照
- [[re-patching]]：调试确认校验点后做持久化补丁
- [[re-triage]]：样本哈希/初勘先行，调试结论与其对照
- 与 [[re-memdump]]（Windows 侧 procdump 兜底）互补，见 [[platform-tips]]

## 常见坑与陷阱

- **需要管理员权限**：attach 高权限进程/服务失败——以管理员启动 x64dbg，仍失败查保护进程
- **反调试/反 attach**：`ThreadHideFromDebugger`/`NtSetInformationThread` 或断网检测——用 ScyllaHide 插件隐藏调试痕迹，或先静态 patch 自检点
- **PPL 进程无法附加**（Protected Process Light，如部分 EDR/系统进程）——x64dbg 无驱动无法附加，换内核调试或放弃该目标
- **位数匹配**：64 位目标必须 x64dbg（x32dbg 只支持 32 位）；混用会加载失败/崩溃
- **attach 失败先区分权限与 PPL/保护进程**：现象——以管理员运行 x64dbg 仍 attach 失败；原因——普通权限限制管理员可解决，PPL（Protected Process Light）取决于 Signer Level 等级（EDR 常见 PPL-Windows TCB/Antimalware），非对应级别无法附加；对策——先确认目标是否 PPL（Process Explorer 的 Protection 列）及其 Signer Level，再按级别准备对应调试能力（同级别驱动/内核调试），见 [[platform-tips]] Windows 分支
- **程序只在 x64dbg 下崩 → 查调试器特征检测**：现象——样本原生环境正常、换其他调试器也正常，唯独 x64dbg 加载/附加后崩溃或行为跳变；原因——样本检测调试器特征（x64dbg 模块/窗口类/DLL 名称/内存特征），识别到 x64dbg 后故意崩溃或切换逻辑；对策——先静态找特征字符串/窗口类名/模块名（[[re-ida]] / [[re-format-pe]]），patch 特征检测点或隐藏 x64dbg 痕迹（ScyllaHide），再重新加载（见 [[re-anti-analysis]] 反调试方法论 AD31）
- **硬件断点被检测（DR 寄存器）**：现象——下硬件断点/内存断点后进程即退出，或断点不触发；原因——样本读取调试寄存器（DR0-DR3/DR6/DR7）检测硬件断点；对策——ScyllaHide 注入方式隐藏（HookLibrary/InjectorCLI），或改用逻辑断点避开 DR 痕迹，必要时先静态 patch DR 检测点再 attach（见 [[re-anti-analysis]] 反调试方法论 AD15）
- **断点设了不命中**：先 `Alt+E` 确认模块已加载、地址落在加载后基址上；代码段被改写（壳解密）会覆盖 INT3——解密完成后重新下断
- **附加模式下的分析盲区**：入口前逻辑（TLS 回调、构造函数、解密初始化）在 attach 时已执行完——查注册/初始化类逻辑必须选启动模式 + Events 事件断点，别在 attach 模式里找不存在的过程
- **Scylla dump 产物"不能运行"别当失败**：未 Fix Dump 的 dump 文件没有 IAT，直接跑必然崩；修复后仍崩再查无效导入项与 OEP 是否正确
- 版本差异、Scylla 细节与反调试绕过边界（含"绕过不了"的情形）见 [[gotchas]]
