# WinDbg 工具特有坑与边界

## 版本差异（经典版 vs 商店版 vs WDK）

- **经典版（WinDbg 10.0.x）**：随 Windows SDK "Debugging Tools for Windows" 安装；传统 Win32 UI，`windbg.exe`/`kd.exe`/`cdb.exe` 同包
- **商店版（WinDbg 1.x，WinDbg Next）**：`winget install Microsoft.WinDbg` 或 Store；Chromium 新 UI，命令与经典版兼容（同一套调试引擎），附加/断点/内存视图的 UI 入口不同——教程截图对不上时按命令窗口操作，命令是通用的
- **WDK**：装内核调试工具链（kd.exe/kdnet.exe、`bcdedit` 相关脚本、驱动测试工具）——只做用户态调试不需要装整个 WDK
- **32/64 位 WinDbg 分开**：经典版有 x86/x64 两个可执行文件——64 位 dump 用 32 位 WinDbg 打开会报格式错；商店版自动处理
- **命令兼容性**：`!` 扩展命令由扩展 DLL 提供（`ntsdexts`/`ext` 等），版本旧时个别扩展缺失——`!analyze` 等核心命令在所有版本都有

## 符号服务器坑

- **未配置符号 → 全裸偏移**：`lm` 行尾 `(no symbols)`、`k` 输出 `模块!+0x1a`——`.sympath srv*C:\symbols*https://msdl.microsoft.com/download/symbols` 后 `.reload /f`
- **符号服务器不可达/代理**：内网环境拉不到符号会挂起（重试很久）——`.sympath` 指向本地符号缓存优先，配 `_NT_SYMBOL_PATH` 时先确认网络可达
- **私有符号（未公开）**：系统 DLL 的公有符号只到函数粒度，行号/局部变量需要私有符号——分析系统组件逻辑时以反汇编为准，别依赖 `dv` 的局部变量
- **`bu` vs `bp`**：`bu`（unresolved）对尚未加载的模块符号有效（模块加载后自动绑定）——设 DLL 内断点用 `bu`，`bp` 会因符号未解析失败
- **过期符号缓存**：符号缓存陈旧与二进制不匹配（服务包更新后）——`!analyze -v` 出现乱地址时清掉 `C:\symbols` 里对应条目重新拉

## 内核调试坑

- **PatchGuard（内核保护）限制**：本地内核调试（`File > Kernel Debug > Local`）仅测试机可用且能力受限（PatchGuard 干扰断点/单步）；正式内核分析用双机/VM 传输
- **传输配置必须两边一致**：串口参数（debugport/baudrate）或 NET 参数（hostip/port/key）在宿主与目标必须完全匹配——`bcdedit /dbgsettings` 重查配置；VM 管道串口用 `\\.\pipe\com_1` 两边同名
- **kdnet key 有效期**：`kdnet.exe` 生成的 key 与目标网卡绑定，换网卡/重装后需重新生成
- **内核调试不能暂停全部内核线程**：`g` 后系统在跑，断点只在事件时刻停——时序类 bug 用 `!analyze -v` 或 TTD（用户态）思路替代
- **wow64 内核调试**：32 位进程线程栈在 x86 层，`!process` 字段按位数对——跨位数核对时先确认进程位数

## 异常/栈现场坑

- **WER dump 的当前上下文不可信**：Windows Error Reporting 抓的 dump 停在 `WerpReportFault` 报告路径里——直接 `k` 看到的是报告代码的栈；必须 `.ecxr` 恢复异常上下文后再 `k`（`.exr -1` 先看异常记录也行）
- **`.cxr` vs `.ecxr`**：`.cxr <addr>` 手动指定 CONTEXT 地址；`.ecxr` 自动取当前异常上下文——dump 分析用 `.ecxr`，live 现场用 `.exr` 拿地址后 `.cxr`
- **栈损坏时 `k` 假象**：栈指针被踩后 `k` 输出乱地址——`.exr`/`.cxr` 恢复现场是唯一可靠路径；`!analyze -v` 的 `STACK_TEXT` 里直接取现场地址
- **`!analyze -v` 是辅助不是结论**：它按启发式给 FAULTING_IP/STACK_TEXT，混淆/罕见场景会指向错误位置——逐帧核对 `STACK_TEXT`，必要时手工 `.exr`/`k`

## TTD 限制

- **管理员权限必需**：ttd.exe 录制需要管理员；非管理员运行静默失败或录不出轨迹
- **仅用户态**：不能录内核/驱动；PPL 保护进程无法注入录制
- **轨迹文件巨大**：数分钟可到数 GB（无上限）——`-maxfile <MB>` 限制或 `-ring`（2GB 环形覆盖）；索引 `.idx` 约两倍轨迹大小
- **回放只读**：轨迹里不能写内存/改寄存器——「验证假设」在回放中做不了，只能观察；要改就重新录制或转常规调试
- **录制开销高**：录制期间目标明显变慢（数倍）；`-numvcpu` 可调；个别框架（Electron 类）录制时可能死锁/崩溃——录不了就退回常规断点调试
- **`.run` 文件含敏感信息**：轨迹含进程内存/文件路径/寄存器值——分享轨迹等于分享数据，注意脱敏（与 [[re-malware]] 报告同原则）

## 使用注意

- 全部在沙箱内执行（[[platform-tips]] 最高原则）；attach/内核调试需管理员权限
- 版本相关行为（扩展命令集、UI 入口）以实际安装版本为准；命令窗口是跨版本最稳定的界面
