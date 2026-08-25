# Unicorn / Qiling 工具特有坑与边界

## 版本差异

- **Unicorn 2.x 是当前线**（pip 默认；2.1.4 于 2025-09 发布）：钩子回调签名与 1.x 一致（`(uc, address, size, user_data)` / 内存类 `(uc, access, address, size, value, user_data)`），但 2.0 起 C 库 API/内部行为有调整（如部分 hook 类型、PC 保证语义）——旧教程若按 1.x C API 写 python 绑定的罕见写法会失效，Python 绑定层面基本兼容
- **Qiling 版本差异**：快照能力自 1.x 早期即有（1.1.x 起 `ql.save/restore` 已含 snapshot 参数及 reg/mem/fd 开关）；1.2 起参数扩展（新增 os_context/loader 等开关）；rootfs 组织（`examples/rootfs/`）随版本增删 OS profile——以 clone 的官方仓库当前结构为准
- **capstone 5.x**：`pip install capstone` 当前 5.0.x；5.x 对部分指令的助记符输出与 4.x 有差异（`capstone.x86` 命名一致），反汇编对照脚本留意
- **unidbg / Chomper 是独立工具**：unidbg（Java，Android JNI 模拟）与 Chomper（Unicorn 封装，iOS OC 模拟）不依赖 unicorn pip 包版本，走各自仓库 release

## 环境语义坑（模拟 ≠ 真实）

- **系统调用未处理**：Unicorn 不模拟内核，裸跑真实程序在 syscall/`int 2e` 处停或错——换 Qiling（自动转发系统调用），或 hook_intr 按 eax 号假返回
- **环境检测**：CPUID/rdtsc 时序、API 探测（`GetModuleHandleA` 特殊返回、dladdr 查询）可被用于察觉非真实环境——先静态定位检测点（[[re-triage]] / [[re-deobfuscate]]），hook 该路径返回真实环境值；结论必须与真实沙箱执行交叉验证
- **时间/线程/网络语义缺失**：Unicorn 单线程、rdtsc 需 hook 固定、网络栈不存在——依赖这些的任务转 QEMU（[[re-fw-emulate]]）或真实沙箱（[[re-sandbox]]）
- **加载器语义**：Unicorn 不解析 ELF/PE——手动摘段加载；Qiling 有 loader 但动态链接解析与真实 ld.so 有差异，`ql.save` 在 dlopen 之后做状态存档再分支，能避开重复解析开销

## 内存坑

- **页对齐**：mem_map 地址与大小必须 0x1000 对齐（4KB），否则报错；栈页至少 1 页（0x1000），`UC_PROT_READ|UC_PROT_WRITE`
- **只读段写入**：`Invalid memory write` 可能不是没映射而是权限——`mem_protect(addr, size, UC_PROT_ALL)` 后重试
- **未映射访问回调**：`UC_HOOK_MEM_UNMAPPED` 里返回 True + 现场 `mem_map` 可让模拟继续（惰性补页）；但补页是模拟器行为，真实程序可能根本没有该访问——先核对是不是地址算错
- **栈空间不足**：递归/深调用崩在栈区外——栈页多映射几页，`reg_write` 栈指针给到页顶

## 架构与平台坑

- **ARM Thumb**：Thumb 代码要 `UC_MODE_THUMB`（或 AArch32 混 Thumb 用 `UC_MODE_ARM | UC_MODE_THUMB` 组合），模式错了解码全乱
- **字节序**：armeb/mipsel 用 `UC_MODE_BIG_ENDIAN`/架构对应模式，数据端序与指令端序都要对
- **寄存器常数随架构**：x86 用 `UC_X86_REG_*`、arm 用 `UC_ARM_REG_*`——混用常数报错或拿到错寄存器
- **Android .so → unidbg**：Unicorn/Qiling 裸跑缺 JNI 语义跑不动；iOS 加固/签名 so → Chomper（见 SKILL.md 对应坑）
- **Windows 目标**：Qiling 的 `rootfs/x86_windows` 基于 wine 较重量级，启动慢、部分 API 语义不完整——先试 Linux 化目标或摘函数到 Unicorn

## 结果可信度边界

- **模拟结果"正常"不等于正确**：环境可能被检测并返回诱饵——用真实环境/服务器响应验证（JNI 回调类尤其）
- **快照不跨版本**：qsave 与 Qiling 版本强绑定，升级框架后旧快照可能恢复失败——关键阶段同时落盘明文段（mem_read），别只依赖快照
- **性能**：UC_HOOK_CODE 全量追踪会慢一个数量级——追踪段限定地址范围（hook_add 的 begin/end 参数）或改 hook 内条件判断
- **执行流修正**：hook 内改 PC 做跳转后，目标块执行完可能又落回原指令——需要 `hook_del` 或永久改写内存字节

## 使用注意

- 模拟属动态执行：默认沙箱 + 网络隔离（[[platform-tips]] 最高原则）
- 产物（明文段/轨迹/快照）sha256 存档（[[re-triage]]）；结论入 [[analysis-contract]]，与真实执行交叉验证后归档
