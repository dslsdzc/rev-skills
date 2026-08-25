# angr 工具特有坑与边界

## 版本与安装坑

- **Python 版本线**：angr 9.2.x 支持 Python 3.8–3.11；**9.3.0 起要求 Python 3.12+**（PyPI `requires-python` 实测）——9.3 装到 3.11 会直接拒绝或编译失败，9.2 装到 3.13 也可能无 wheel；装前 `pip index versions angr` 确认主版本线
- **主版本间 API 变更**：angr 9.1（迁移文档有专页）改过 `SimState`/`state.posix` 等细节；网上旧教程（8.x 时代）的 `state.mem`、`simprocedures` 写法可能失效——以目标版本 docs 的 "Migrating to angr X" 为准
- **binutils 依赖**：angr 处理/重写二进制（`angr.Project` 的 back-end 或 `angr.SimProcedure` 无关但 binary rewriting 相关操作）会调 `objcopy`——Linux 装 `binutils`，缺了报 `objcopy: command not found` 类错误
- **Windows 支持边界**：Windows 下 pip 装 win32 wheel 可用，但部分 cle/ELF 后端与 fork 类操作受限；需要 ELF/arm 目标分析时优先 WSL 内装 Linux 版
- **多环境共存**：angr 依赖树大（pyvex/unicorn/claripy 等），别往系统解释器塞——venv 隔离，升级先看依赖是否连带升

## 装载与地址坑

- **PIE 基址**：angr 默认按 0x400000 装载，Ghidra 按 0x100000 显示——find/avoid 地址必须换算（`p.loader.main_object.mapped_base` 核对实际基址）
- **auto_load_libs 默认值**：新版本默认 `auto_load_libs=False` 而旧版本为 True——行为差异导致同一脚本结果不同；显式写参数，别依赖默认
- **壳/静态链接目标**：带壳目标先脱壳（[[re-unpack-simple]]）；静态链接大二进制装载后状态数爆炸——hook 掉无关库函数入口
- **架构/字节序**：arm/armeb/mips 目标 angr 支持但要注意字节序（`archinfo` 按 ELF header 自动选）；`file target` 先确认再建 Project

## 求解语义坑

- **除零约束缺失**：Z3 对 `a/b` 分母为 0 求值为全 1（4294967295）——涉除法表达式显式加"分母非零"约束
- **未初始化寄存器/内存被自动符号化**：`entry_state` 对未初始化值生成无约束符号，求解空间虚胖、结果含垃圾——`ZERO_FILL_UNCONSTRAINED_MEMORY`/`ZERO_FILL_UNCONSTRAINED_REGISTERS` 或显式设已知初值
- **float/NaN**：浮点路径 Z3 与实机可能不一致（FP 舍入/NaN 语义）——浮点校验题优先人工还原或换 [[re-z3]] 单独建模
- **eval 返回值的陷阱**：`eval(expr, cast_to=bytes)` 对非整字节宽符号（如 6 字节长度符号）按位宽对齐返回，多解时 `n=` 取多个逐一重放验证
- **求解超时**：复杂约束集 eval 可能分钟级无回——`timeout=` 设上限，配合 `solver.min/max` 缩小搜索
- **约束集合 ≠ 路径语义**：angr 求解器拿的是该状态累积路径约束，不是"程序全部行为"——求解出的输入必须沙箱内原样重放验证（[[platform-tips]] 最高原则）

## SimProcedure 与 hook 坑

- **摘要不准**：strlen/malloc 等 SimProcedure 替代实现有 bug 或不完整，结果反直觉（错误返回值/绕过校验）——异常先怀疑摘要：禁用对应 hook 或 `project.hook` 自定义
- **hook 未卸掉**：hook 分发器后执行跳回再次进 hook 死循环——跳到目标块后立即 unhook
- **hook_symbol 与库调用路径**：`hook_symbol` 只影响按符号解析的调用；地址间接调用要 `project.hook(addr, ...)` 按地址挂
- **cmovxx 不分裂分支**：angr 对 cmov 通过积累约束实现而非分裂两个状态——需要后继关系时手动 `state.copy()` 分裂并跳过 cmov 指令

## 性能与路径爆炸坑

- **符号化范围**：整段程序符号化是爆炸主因——只符号化校验真正读取的字节，入口尽量后移（blank_state）
- **veritesting 双刃**：合并路径省状态但可能丢失分支精度（结果与不合并不同）——两个都跑对照
- **stash 无上限**：默认 stash 不限制状态数——主动 `simgr.step()` 循环内检查 `len(active)` 或限制步数
- **lazy_solves 与 prune**：路径多了先 `simgr.prune()` 剪无解路径，或开 `lazy_solves` 延后求解

## 使用注意

- 求解在进程内仿真器完成（免沙箱）；**用求解结果运行目标时默认沙箱**
- 地址/约束/脚本/flag 全量存档（[[re-triage]] 证据链），结论入 [[analysis-contract]]
- 与 [[re-z3]] 的分工：需要精确约束集合而非一条路径时 z3 更轻；angr 求解慢时对约束子集转 z3
