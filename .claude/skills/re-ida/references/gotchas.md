# IDA 工具特有坑与边界

## 版本差异（7.x / 8.x / 9.x）

- **数据库格式**：IDA 7.5 起统一 `.i64`（32/64 位同一格式）；7.4 及以前 32 位 `.idb`、64 位 `.idb64`——旧库首次打开会走升级流程，升级后不可回退，重要库先备份
- **宿主系统**：IDA 8.x 起仅支持 64 位宿主（不再有 32 位安装包）；Linux 需 Qt 运行库，headless 无头模式不需要图形环境
- **IDA 9.0（2024）**：32/64 位安装合一（不再有独立 IDA32）；新增 FLIRT 签名管理器（在线下载签名）；新增 idalib（在 IDA 外调 C++/Python API 做无头处理）；Python 支持 3.8–3.13，用 `idapyswitch` 切换（9.0 SP1 起支持 3.13）
- **IDAPython 8→9 破坏性变更**：`get_struc`/`get_member`/`ida_typeinf.get_ordinal_qty` 等移除，结构体 API 迁移到 `tinfo_t`/`til_t`；`idautils.StructMembers` 返回值改三元组——旧插件/脚本先对照迁移指南（idapython-porting-guide-ida-9）再跑
- **Hex-Rays 版本**：伪代码输出随版本变化（IDA 9 起 x64 MSVC 异常处理可反编译出 try/catch）——不同版本对同一函数输出不同，跨版本互证时注明版本

## 免费版（IDA Free）边界

- **仅 x86/x64**：分析器不支持 ARM/MIPS 等其他架构；云端反编译同样只覆盖 x86/x64
- **无本地 Hex-Rays**：只有反汇编 + idapython；云端反编译按函数付费额度使用
- **调试器仅限本地 x86/x64 用户态**：不能远程调试、不能内核调试；反调试对抗能力弱于商业版
- **无插件/无 FLIRT 扩展**：不能安装第三方插件（反编译插件类都不可用）；FLIRT 只能用自带 sig
- 结论：免费版定位是「反汇编 + 脚本化」，需要反编译能力直接 [[re-ghidra]]

## 无头批处理坑

- **不写 `auto_wait()` 产出空集**：`-A` 模式下脚本与 auto-analysis 并行，遍历函数列表前必须 `ida_auto.auto_wait()`
- **不写 `qexit` 进程挂住**：脚本跑完不退出，CI/批量场景卡死——`idc.qexit(0)`（别名 `ida_pro.qexit(0)`）
- **日志不落盘难排错**：`-L"ida.log"` 输出 IDA 日志；脚本 print 进输出窗口不进 stdout 文件（重定向无效）
- **修改型脚本不可逆**：先在副本 .i64 上跑，先只读验证再写库（详见 SKILL.md 坑 5/6）
- **`-A` 与 `-c` 区别**：`-c` 强制重新分析（丢弃已有分析结果）；对已有 .i64 再跑脚本时不加 `-c` 会沿用旧分析
- **合法空产出**：只导出非库函数时，无用户代码的小二进制产出 0 个函数是合法的——用「日志关键字 + 产物计数」双通道判断

## 反调试与动态调试边界

- **调试器特征可检测**：IDA 调试器有默认标记（进程名/窗口类/模块特征），样本可枚举检测——静态定位检测点（`IsDebuggerPresent`/`NtQueryInformationProcess` xrefs）后处理，见 [[re-anti-analysis]]
- **PPL/受保护进程无法附加**：Windows 内核保护进程超出 IDA 用户态调试能力，换内核调试（[[re-windbg]]）或放弃
- **TLS 回调/入口前逻辑**：调试启动时停在系统断点，入口前逻辑可能已执行——需要时在调试选项里开事件断点
- **wow64 目标**：32 位样本在 64 位系统上运行，栈/寄存器视图是 x64 上下文——切到 x86 视图或用 [[re-x64dbg]]（x32dbg）更省事

## 大二进制与性能

- auto-analysis 全开对 100MB+ 二进制极慢：`Options > General > Analysis` 关掉 constant propagation 等非必要 pass；只对重点段手工 `MakeCode`/`MakeFunction`
- 无头模式比 GUI 快但资源占用高（多核分析全开）——批量任务排队跑，别一次开多个

## 使用注意

- 全部在沙箱内执行（[[platform-tips]] 最高原则）；动态调试按默认沙箱
- 脚本/插件/数据库与 IDA 版本强绑定——换版本先跑 `File > Script command` 的 `idaapi.IDA_SDK_VERSION` 确认
