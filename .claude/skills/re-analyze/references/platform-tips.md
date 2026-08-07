# 平台经验知识库

> 跨大类共享的实战经验。所有技能的工具准备与操作步骤按 OS 分支执行。
> 原则：**先给最轻的可行方案**（Wine 直读 > 用户态仿真 > 全系统虚拟化 > 物理机）。

## 最高原则：默认沙箱

一切动态分析/运行样本默认在沙箱中执行（强制前置）：虚拟机快照 / 容器（Docker、firejail）/ 专用沙箱（Cuckoo/CAPE）；网络隔离（INetSim、fake DNS、断网）。静态分析可免沙箱，一切动态执行默认在沙箱内，分析结束后恢复快照。此原则优先于本文件所有其他条目。

## 平台分支

### 所有平台
- 动态分析默认沙箱（见上）。

### Linux
- 分析 Windows PE 程序：**Wine 直读进程内存**——wine 运行 PE → `gdb attach` 或读 `/proc/<pid>/mem`，无需整机虚拟化；脱壳/读内存直接对 Wine 进程操作。
- 跑非本机架构程序：QEMU 用户态仿真（`qemu-<arch>`）优先，全系统仿真仅必要时用。

### Linux 内存转储极端段
- `[vsyscall]`（固定地址 `0xffffffffff600000`，只执行 `--xp`）、`[vdso]`/`[vvar]`：`/proc/<pid>/mem` 读取失败、gdb 访问报错均属正常。
- 转储前必须按 `/proc/<pid>/maps` 过滤这些段（只 dump `r--p`/`rw-p` 可读映射），否则 dump 含垃圾页、脱壳/分析全被污染。
- 识别特征：`maps` 中 `[vsyscall]`/`[vdso]`/`[vvar]` 名称、地址落在 `0xffffffffff6xxxxx` 高段、无文件路径的匿名 `00:00` 映射。

### Windows
- 读目标进程内存：需装 Sysinternals 套件（`procdump`）/ `DumpIt` 做内存转储 + Volatility 分析；attach 需要管理员权限。
- 常用工具链：x64dbg、Process Explorer（替代 System Informer）、APIMonitor。

### macOS
- attach/调试：SIP 与 TCC 限制，调试工具需授权（Developer Tools 权限），`lldb` attach 前检查。

### WSL
- WSL 无法直接 attach Windows 进程——跨边界分析走 Windows 侧工具，WSL 内只做文件/静态分析。

## 「直读 vs 转储」决策（默认转储优先）

一次转储获得完整内存布局 + 寄存器/线程状态（ELF notes），可导入 Ghidra/IDA、可存档复现；后续所有定向提取（密钥搜索、脱壳段、DEX 挖掘）都从转储产物里做。

| 场景 | 方案 |
|---|---|
| 默认（任何需要读内存的任务） | **转储** `gcore` → ELF core；取证/存档用全量转储 + manifest |
| 需要完整布局 + 寄存器/线程（导入调试器、事后复现） | **转储** `gcore`（含 ELF notes） |
| 进程已死 | 直接分析已有 core（`kernel.core_pattern` / systemd-coredump / 容器 runtime dump） |
| ptrace 被禁 / 沙箱容器 / attach 失败 | 转储兜底（不依赖 `/proc/<pid>/mem` 权限路径） |
| 特例①：进程必须保持运行、实时交互调试 | **直读** `/proc/<pid>/mem`：先读 maps 定址 → SIGSTOP 防竞态 → chunked `pread` 只取目标区段 |
| 特例②：只需极小特定区段且性能敏感 | **直读** 单区段，同上流程 |

**关键经验**：转储时机——脱壳须等进程运行到 OEP 完全解密后再 dump；直读前必须先查 maps；dump 前过滤 `[vsyscall]`/`[vdso]`。
