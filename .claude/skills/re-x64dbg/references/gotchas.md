# x64dbg 工具特有坑与边界

## x64dbg 与 OllyDbg 的兼容差异

- **插件/脚本不通用**：OllyDbg 的插件（.dll/.opa）与 OllyScript 脚本不能直接用于 x64dbg——x64dbg 有独立插件 API 与脚本引擎（Script 视图，命令见 [[commands]]）；移植需按新 API 重写
- **条件断点语法近似但不等价**：x64dbg 表达式体系更完整（寄存器/`[内存]`/位运算/字符串格式化），OllyDbg 的 `cond` 条件不能照抄，按 x64dbg 表达式重写
- **调试数据库格式不同**：OllyDbg 的 .udd vs x64dbg 的 .dd64/.dd32，不通用；x64dbg 数据库按模块保存在同名 `.dd*` 文件
- **位数**：OllyDbg 仅 32 位；x64dbg 同一包内 x64dbg.exe（64 位目标）+ x32dbg.exe（32 位目标），别开错进程（见 [[platform-tips]] Windows 分支）

## Scylla 使用注意

- **OEP 字段是完整虚拟地址（VA），不是 RVA**：Scylla 自动填充为 入口点+ImageBase；手填也填 VA——填 RVA 会搜错位置
- **必须暂停在 OEP 时操作**：运行中的进程内存持续变化，dump 出来的镜像可能是坏的；先让目标停在 OEP 再 Dump/Fix Dump
- **OEP 填错 → "IAT not found at OEP ..." 日志**：IAT Autosearch 直接失败或扫出一堆 garbage 导入——回到调试器确认真实 OEP（标准函数序言特征），重新填值再搜
- **普通/高级两种 Autosearch 结果可能不同**：普通快、误报低；高级慢、适合混淆/非标准结构——结果差异大时都试，取有效导入多的一次；重试前先 Clear 清空上次结果
- **Get Imports 后有红色无效项**：Show Invalid 查看，右键 Cut thunk 删除无效项；少量无效项删掉后 Fix Dump 仍可能得到可运行文件（个别 DLL 的延迟加载导入除外）
- **Fix Dump 指向 dump 出的文件**：先 Dump 存出进程镜像，再 Fix Dump 选该文件，输出 `*_SCY.exe`——直接对原始 exe 修没有任何意义
- **内置版本 vs 独立版**：x64dbg release 内置的 Scylla 是随版本更新的打包版；独立 NtQuery/Scylla 更新更勤，功能差异以各自 About 为准

## 反调试检测绕过边界

- **ScyllaHide 覆盖有限**：它隐藏的是常见 API 检测（IsDebuggerPresent、NtQueryInformationProcess 部分变体等）——不在其清单内的检测（自定义时序、性能计数器、特定 syscall 组合、内核态验证）照样命中；插件列表固定，别假设"开了 ScyllaHide 就隐形"
- **硬件断点可被 DR 寄存器读取暴露**：下硬件/内存断点后目标可读 DR0-DR3/DR6/DR7 发现——ScyllaHide 注入模式可隐藏一部分，但被针对性检测时只剩逻辑断点或先 patch 检测点
- **调试器自身特征可被指纹化**：x64dbg 模块名/窗口类/DLL 名/内存特征都可被枚举——目标只在 x64dbg 下崩溃时按特征检测处理（见 SKILL.md 坑 6）
- **TLS 回调/入口前逻辑**：启动模式下默认停在系统断点，TLS 回调可能已执行——要断入口前逻辑需勾选 Options > Events 的事件断点（TLS callbacks/entry breakpoint），错过就无法重放
- **时序类检测绕过不了就静态 patch**：时间差/执行计数类检测在调试器里改比较点只能一次一次来，高频校验目标直接静态 patch 更省事（见 [[re-patching]]）
- **内核态检测（驱动层）不在调试器能力内**：x64dbg 是用户态调试器，PPL 进程与驱动层校验无法附加/绕过——按 [[platform-tips]] Windows 分支准备内核调试能力或放弃

## 版本差异

- **v1.0（2023 年唯一正式稳定版）→ 2025.06.30 起改 CalVer 大版本**（"Type System and Modernization"）：类型系统重做（位域/枚举/匿名类型、ManyTypes 插件）、AVX-512 与半精度浮点支持、构建迁移 VS2022+CMake、Windows XP 不再支持（Win7/8.1 有弃用警告）
- **2025.08.19 起脚本引擎重写**：脚本命令改为事件循环上确定性执行；命令行新增 `-c <命令>`/`-cf <脚本文件>`/`-pid`/`-tid` 等参数——旧脚本行为可能变化，脚本化调试先核对新语法
- **快照版（snapshot）仍在滚动发布**：dev 分支产物比正式 release 新但可能有回归；正式分析优先用 release 版
- **x32dbg 与 x64dbg 快捷键/插件配置独立**：两边各自保存设置与数据库，别假设配置互通

## 使用注意

- 全部在沙箱内执行（见 [[platform-tips]] 最高原则）；attach 需管理员权限
- 版本相关行为（内置 Scylla 版本、脚本语法）以目标版本实际表现为准
