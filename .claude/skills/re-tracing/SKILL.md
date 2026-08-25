---
name: re-tracing
description: >
  系统调用/函数调用跟踪：strace/ltrace/dtruss。
  触发词：strace、跟踪系统调用、ltrace、API监控
---

# 系统调用/函数调用跟踪

## 何时使用 / 何时不用

- 用：观察程序运行行为（文件/网络/进程操作）；记录系统调用与库调用序列作为证据；定位动态解析的 API（GetProcAddress/dlopen 之后）
- 不用：只需内存内容（走 [[re-memdump]]）；只需静态逻辑（反编译技能）
- 不用：Windows 目标用 APIMonitor/ProcMon（本技能 Linux/macOS 为主）

## 工具准备

参考 [[platform-tips]] 最高原则——跟踪即动态执行，默认在沙箱内进行，网络隔离。

### strace（Linux）

- Debian/Ubuntu: `apt install strace`
- Fedora/RHEL: `dnf install strace`
- Arch: `pacman -S strace`
- WSL: Linux 包直接可用
- 验证: `strace -V`
- 常用选项：`-f` 跟子进程、`-o` 写文件、`-e trace=` 过滤、`-s 200` 放大字符串显示（默认 32 字节）、`-x` 非 ASCII 转十六进制、`-y`/`-yy` 把 fd 解析为路径、`-c` 汇总统计、`-p` attach——速查与组合见 [[commands]]

### ltrace（Linux 库调用）

- Debian/Ubuntu: `apt install ltrace`
- Fedora/RHEL: `dnf install ltrace`
- Arch: `pacman -S ltrace`
- 验证: `ltrace -V`

### dtruss（macOS，DTrace 版 strace）

- macOS 自带（随 Xcode CLT）；需要 root 且部分 SIP 场景受限
- 验证: `sudo dtruss -c ls / 2>&1 | head` 输出去重调用统计

### APIMonitor / ProcMon（Windows）

- APIMonitor: rohitab.com 下载 zip 解压即用
- ProcMon: Microsoft Sysinternals —— `choco install sysinternals`（或官网下载）
- 验证: 打开 APIMonitor/ProcMon 能列出并附加进程

## 操作步骤

1. **strace -f 全进程树跟踪**：
   ```sh
   strace -f -o trace.log ./target args
   ```
   `-f` 必须加：跟随 fork/vfork/clone 子进程——不加会漏掉全部子进程行为。
   `-tt` 加微秒时间戳，`-T` 加每调用耗时（网络等待/慢调用线索）；`-s 200` 放大字符串显示（默认 32 字节，路径/参数看不全时必加）。
   已运行的目标用 attach（看不到 attach 之前的调用）：
   ```sh
   sudo strace -f -p <pid> -o attach.log     # attach 需要与目标同权限
   strace -f -c ./target                      # 退出时打印系统调用计数/耗时汇总（热点定位）
   ```

2. **过滤（-e trace=...）**：
   ```sh
   strace -f -e trace=network,file ./target     # 只看网络与文件
   strace -f -e trace=write,read ./target       # 只看读写
   strace -f -e trace=execve,fork,clone ./target # 只看进程行为
   strace -f -e trace=!futex ./target           # 排除噪声（futex 高频）
   ```
   过滤规则先白名单后黑名单，控制输出体积（见坑 2）。

3. **ltrace 库调用**：
   ```sh
   ltrace -f -o lib.log ./target
   ltrace -e malloc+free ./target        # 只跟踪指定库函数
   ltrace -l /path/libfoo.so ./target    # 跟踪 dlopen 动态加载的库
   ltrace -f -S ./target                 # 库调用 + 系统调用一起跟踪
   ltrace -f -c ./target                 # 退出时库调用汇总
   ```
   动态解析的 API（`dlsym` 拿到的函数）不会出现在静态 IAT 里，但会出现在 ltrace 输出中——与 [[re-imports]] 互补。

4. **输出保存为证据**：
   ```sh
   strace -f -tt -o evidence/trace-$(date +%s).log ./target
   # 或
   ltrace -f -o evidence/libcall.log ./target
   ```
   每条记录带 pid 与时间戳；分析完成后在笔记中引用文件路径与哈希（样本与日志各存 sha256，见 [[re-triage]]）。

5. **Windows 用 APIMonitor/ProcMon**：
   - APIMonitor: 运行（管理员）→ 选中目标进程 → 勾选要监控的 API 类（File/Network/Registry/Process）→ 附加，观察调用参数与返回值
   - ProcMon: 全系统级（文件/注册表/网络/进程事件），先按进程过滤（Process Name 过滤目标名），再按 Operation 过滤
   - 可疑点: 对注入类 API 连续调用序列（OpenProcess→VirtualAllocEx→WriteProcessMemory→CreateRemoteThread）即恶意行为证据

## 指令级追踪

比系统调用级更深一层——指令粒度执行流：

- **QEMU 插件**：`-plugin` 加载指令级 trace 插件（insn 粒度、call/ret 路径、guest 代码块事件）；用途——脱壳后真实路径还原、反混淆（静态混淆无法隐藏实际执行）
- **Intel PT**：硬件 trace（`perf record -e intel_pt`）→ 解码（`perf script` 或第三方解析）→ 分支流还原；用途——无插桩开销的完整执行路径
- **trace 分析**：热点（执行频次排序）、路径还原（调用链重建）、与 [[re-deobfuscate]] 衔接（按真实路径过滤死代码）
- **输出**：指令级执行流摘要（供 [[analysis-contract]] 证据存档）

## 跨域联合

- [[re-binary-core]]：工作流第 6 步（行为跟踪）
- [[re-malware]]：恶意行为观察（回连/持久化/自启动）
- [[re-cracking]]：监控校验/注册相关的 API 调用参数
- 与 [[re-imports]] 互补（动态解析 API）；发现反调试时转 [[re-anti-analysis]]
- [[re-ebpf]]：BPF 观测/跟踪取证还原——strace 覆盖不到的 skb/内核路径由 BPF 观测互补

## 常见坑与陷阱

- **不加 -f 漏子进程**：目标 fork 后父进程退出/exec，未跟踪的子进程行为全部丢失——`-f` 是标配
- **输出巨大**：不过滤时大程序日志可达 GB 级拖垮磁盘——先 `-e trace=` 白名单，必要时 `-o` 写文件而非终端
- **反调试样本检测 trace 环境**：`ptrace` 状态检测/`LD_PRELOAD` 痕迹暴露 strace/ltrace——与 [[re-anti-analysis]] 的反调试绕过组合使用
- ltrace 默认只跟踪 PLT 层调用——`dlopen` 后加载的库函数要加 `-l` 显式指定
- 命令族速查与操作序列见 [[commands]]；工具特有坑与版本差异见 [[gotchas]]
