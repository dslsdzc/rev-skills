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

## 工具准备

参考 [[platform-tips]] Windows 分支——attach 需要管理员权限；内存转储工具链 procdump/DumpIt。

### x64dbg

- 下载: GitHub `x64dbg/x64dbg` release（zip 解压即用，x64dbg.exe）
- Windows: `choco install x64dbg`
- 验证: 打开 x64dbg.exe，`File > Open` 加载任意 exe 能停在入口

### Scylla（IAT 修复插件）

- 新版 x64dbg 官方 release 已内置（插件目录 plugins/ 下有 Scylla）
- 独立版: GitHub `NtQuery/Scylla` release
- 验证: x64dbg 插件菜单出现 Scylla，能 Attach 到进程并列出模块

### OllyDbg（旧 32 位）

- 下载: 官网 ollydbg.de（仅 32 位，x64dbg 出现前的主力）
- 验证: 打开加载 32 位 exe 正常

## 操作步骤

1. **附加/启动目标（管理员权限）**：
   - 附加: `File > Attach`（以管理员运行 x64dbg 才可附加非当前用户进程）；附加后 `F9` 运行到断点
   - 启动: 直接拖目标 exe 到 x64dbg 窗口，停在系统断点/入口
   - 无窗口服务/后台进程: `File > Attach` 后按进程名/pid 过滤
   - 附加失败（权限/保护）见坑 1、3

2. **断点与条件断点**：
   - `F2` 地址/符号处断点
   - 右键 > Conditional Breakpoint（条件断点），例: `[401000]==0x90`（仅当内存值满足）、`eax==0x1000`
   - 断点窗口 `Alt+B` 管理；`F9` 继续，`F7`/`F8` 单步（步入/步过），`Ctrl+F9` 运行到返回
   - 内存断点: 选中内存区域右键 > Breakpoint > Memory（访问/写入触发）——查密钥解密时刻常用

3. **内存窗口与搜索**：
   - `Alt+M` 打开 Memory Map：看节区权限（RWX 异常=壳/解密段）、模块列表
   - 搜索: `Ctrl+B` 二进制模式（如 `55 8B EC`），`Ctrl+F` 字符串/ASCII/Unicode 搜索
   - Dump 窗口 `Ctrl+G` 跳地址；`Ctrl+E` 编辑内存（改字节绕校验）

4. **反调试绕过**：
   - 右键寄存器窗口改 EFlags/ZF 等标志位
   - 断 `IsDebuggerPresent`/`NtQueryInformationProcess` → 改返回寄存器（`EAX=0`）后 `F9`
   - 时间差/执行计数类: 断点比较指令处改比较寄存器
   - 反调试插件 ScyllaHide（x64dbg 插件管理器安装）批量隐藏调试痕迹

5. **Scylla 修复 IAT（脱壳后）**：
   ```
   Plugins > Scylla > IAT Autosearch（对脱壳进程）
   Get Imports → 校验无缺失 → Fix Dump（选择 dump 出的进程镜像文件）
   ```
   流程: 壳内运行到 OEP → `Plugins > Scylla > Attach to process` → 填 OEP 地址 → `IAT Autosearch` → `Get Imports` → `Fix Dump` 输出修复后的干净 exe。
   修复后的文件 sha256 与原始对照存证（见 [[re-triage]]）。

## 跨域联合

- [[re-binary-core]]：工作流第 6 步（Windows 调试器）
- [[re-anti-analysis]]：脱壳（运行到 OEP + Scylla 修复）核心工具
- [[re-cracking]]：注册码/校验逻辑定位
- 与 [[re-memdump]]（Windows 侧 procdump 兜底）互补，见 [[platform-tips]]

## 常见坑与陷阱

- **需要管理员权限**：attach 高权限进程/服务失败——以管理员启动 x64dbg，仍失败查保护进程
- **反调试/反 attach**：`ThreadHideFromDebugger`/`NtSetInformationThread` 或断网检测——用 ScyllaHide 插件隐藏调试痕迹，或先静态 patch 自检点
- **PPL 进程无法附加**（Protected Process Light，如部分 EDR/系统进程）——x64dbg 无驱动无法附加，换内核调试或放弃该目标
- **位数匹配**：64 位目标必须 x64dbg（x32dbg 只支持 32 位）；混用会加载失败/崩溃
- **attach 失败先区分权限与 PPL/保护进程**：现象——以管理员运行 x64dbg 仍 attach 失败；原因——普通权限限制管理员可解决，PPL（Protected Process Light）取决于 Signer Level 等级（EDR 常见 PPL-Windows TCB/Antimalware），非对应级别无法附加；对策——先确认目标是否 PPL（Process Explorer 的 Protection 列）及其 Signer Level，再按级别准备对应调试能力（同级别驱动/内核调试），见 [[platform-tips]] Windows 分支
- **程序只在 x64dbg 下崩 → 查调试器特征检测**：现象——样本原生环境正常、换其他调试器也正常，唯独 x64dbg 加载/附加后崩溃或行为跳变；原因——样本检测调试器特征（x64dbg 模块/窗口类/DLL 名称/内存特征），识别到 x64dbg 后故意崩溃或切换逻辑；对策——先静态找特征字符串/窗口类名/模块名（[[re-ida]] / [[re-format-pe]]），patch 特征检测点或隐藏 x64dbg 痕迹（ScyllaHide），再重新加载（见 [[re-anti-analysis]] 反调试方法论 AD31）
- **硬件断点被检测（DR 寄存器）**：现象——下硬件断点/内存断点后进程即退出，或断点不触发；原因——样本读取调试寄存器（DR0-DR3/DR6/DR7）检测硬件断点；对策——ScyllaHide 注入方式隐藏（HookLibrary/InjectorCLI），或改用逻辑断点避开 DR 痕迹，必要时先静态 patch DR 检测点再 attach（见 [[re-anti-analysis]] 反调试方法论 AD15）
