---
name: re-emulation
description: >
  模拟执行：Unicorn/Qiling 框架。触发词：Unicorn、Qiling、模拟执行、emulate、无硬件运行
---

# 模拟执行（Unicorn / Qiling）

## 何时使用 / 何时不用

- 用：目标无法在本机运行（架构/OS 不匹配、无硬件、依赖缺失）；脱壳辅助（把壳内解密例程摘出来模拟执行拿明文）；反调试绕过（模拟器无调试器标记，见坑 2 的例外）；单函数/单代码段隔离执行验证
- 用：不需要完整 OS 语义（无进程/线程/网络栈依赖）的确定性任务
- 不用：需要完整 OS 环境（多线程、网络栈、完整 API 语义）→ 用 QEMU 全系统（[[re-fw-emulate]]）或沙箱实跑（[[re-sandbox]]）
- 不用：只需动态调试（[[re-gdb]] / [[re-x64dbg]] / [[re-windbg]]）
- 不用：目标在本机就能跑——沙箱内直接跑更真实（[[platform-tips]] 最高原则），模拟留给出不来环境的场景

## 工具准备

模拟执行属动态执行，默认沙箱 + 网络隔离（[[platform-tips]] 最高原则）；本技能三件套均为 pip 包，Linux/macOS/Windows 通用，WSL 内可直接用（[[platform-tips]] WSL 分支）。

### unicorn

- 安装: `pip install unicorn`（Python 3）
- 验证: `python3 -c "import unicorn; print(unicorn.__version__)"`
- 版本: 2.x 为当前线（2.1.4 于 2025-09）；2.x 钩子回调签名与 1.x 一致（`(uc, address, size, user_data)`），pip 默认装 2.x；1.x→2.x 差异见 [[gotchas]]

### qiling（依赖 unicorn / capstone / pefile，自动装）

- 安装: `pip install qiling`（当前 1.4.x）
- 验证: `python3 -c "import qiling; print(qiling.__version__)"`（纯 import 验证，零依赖；pip wheel 不含 examples/ 与 rootfs，跑示例需 git clone 官方仓库获取）

### capstone（反汇编/解码输出用）

- 安装: `pip install capstone`
- 验证: `python3 -c "import capstone; print(capstone.__version__)"`

## 操作步骤

按顺序执行，每步记下结果；模拟产物（内存快照/明文段）sha256 存档（[[re-triage]] 存证思路）。

1. **场景判断**：
   - 目标是什么、模拟解决什么问题——脱壳辅助（壳的解密例程是单函数，模拟执行该例程即可得明文，不用完整跑壳）？反调试绕过（样本检测调试器但可能不检测模拟器，见坑 2）？无环境运行（架构不匹配/缺 OS）？
   - 选工具: 只跑代码段/单函数 → Unicorn（最小、可控）；要文件/系统调用语义 → Qiling（自动处理系统调用）；要完整 OS → 转 [[re-fw-emulate]]

2. **Unicorn 最小框架**：
   ```python
   from unicorn import *
   from unicorn.x86_const import *
   CODE = bytes.fromhex("b8 2a 00 00 00 c3")      # mov eax, 0x2a; ret
   mu = Uc(UC_ARCH_X86, UC_MODE_32)
   mu.mem_map(0x1000, 0x1000)                    # 先映射一页（地址页对齐）
   mu.mem_write(0x1000, CODE)
   mu.reg_write(UC_X86_REG_ESP, 0x2000)          # 设好栈（不设 ESP 会崩）
   mu.emu_start(0x1000, 0x1000 + len(CODE))      # 执行到结束地址
   print(hex(mu.reg_read(UC_X86_REG_EAX)))       # 0x2a
   ```
   要点: 内存必须 `mem_map`（页对齐）再 `mem_write`；栈寄存器必须设；`emu_start(begin, until)` 的 until 要覆盖代码结束地址，否则跑到非法地址

3. **Qiling 全系统模拟**：
   ```python
   from qiling import Qiling
   ql = Qiling(["rootfs/x8664_linux/bin/x8664_hello"], "rootfs/x8664_linux")   # 文件名以实际 rootfs 为准；examples/ 与 rootfs 需 git clone 官方仓库获取（pip 不含）
   ql.run()
   ```
   - rootfs: pip 不含 examples/ 与 rootfs，需 git clone qiling 官方仓库后取 `qiling/examples/rootfs/`（x8664_linux、arm_linux、x86_windows 等）；自制 rootfs 时拷贝目标程序的 libc/ld-linux 与运行期文件进去
   - 文件/系统调用由 Qiling 接管（open/read/write 映射到 rootfs），比 Unicorn 省心（坑 1 的对策）
   - Windows 程序: `Qiling(["sample.exe"], "rootfs/x86_windows")`（该 rootfs 含 wine 基础环境，较重但可用）

4. **钩子（hook_code / hook_mem）**：
   ```python
   def hook_code(uc, address, size, user_data):
       if address == 0x401234:
           print("hit target", hex(address))
   mu.hook_add(UC_HOOK_CODE, hook_code)          # 每指令回调
   mu.hook_add(UC_HOOK_MEM_WRITE, hook_mem)      # 内存写回调（脱壳记解密落点）
   mu.hook_add(UC_HOOK_MEM_UNMAPPED, hook_bad)   # 未映射访问回调
   ```
   - Qiling 等价物: `ql.hook_address(fn, addr)`（地址断点）、`ql.hook_mem_read/write/unmapped`（内存类）
   - 脱壳常用: hook_mem_write 在目标区段命中时暂停/计数——拿到解密循环的写时机与明文

4.5. **状态保存/恢复与内存落盘**：
   - Qiling（1.1.x+）: `ql.save(snapshot="stage1.qsave")` / `ql.restore(snapshot="stage1.qsave")`——多阶段解密流程分点存档，返回继续模拟
   - Unicorn: 快照需手工 `mem_read` 全部相关段 + 寄存器表落盘（`.json` + `.bin`），恢复时 `mem_map` + `mem_write` + `reg_write`；不想全量保存就用 hook 在关键点把目标区段 `mem_read` 出来存文件（脱壳明文落盘即此思路）
   - 落盘产物 sha256 存档（[[re-triage]] 存证思路）

5. **结合 [[re-anti-analysis]] 的脱壳场景**：
   - 从壳内摘出解密例程（[[re-unpack-simple]] / [[re-unpack-advanced]] 定位）→ Unicorn 加载该例程代码段 + 输入快照 → 执行 → 读输出区域 = 明文数据（字符串/关键段）
   - 或 Qiling 模拟壳程序全流程，hook 到 OEP 处 dump 内存（模拟器内存即快照，转 [[re-memdump]] 思路存档）
   - 反调试绕过: 模拟器无调试器标记，但样本可能有环境检测（坑 2）——先静态确认检测点再决定 hook 哪条路径
   - 验证: 模拟产物 sha256 + 沙箱内复跑核对（[[re-sandbox]]），再回 [[re-anti-analysis]] 流程继续

## 跨域联合

- [[re-anti-analysis]]：脱壳辅助（解密例程模拟执行）固定场景
- [[re-binary-core]]：反编译产物/单函数逻辑的模拟验证
- [[re-fw-emulate]]：需完整 OS/固件启动 → QEMU 全系统；本技能只管单程序/单代码段模拟，不抢该域
- [[re-sandbox]]：模拟属动态执行，默认沙箱内进行（[[platform-tips]] 最高原则）
- [[re-deobfuscate]]：反混淆结果模拟执行验证
- [[re-crypto-decrypt]]：解密算法用模拟执行求值代替手写脚本
- [[re-memdump]]：模拟器内存快照的落盘与后续分析

## 常见坑与陷阱

- **系统调用未处理 → 崩溃**：现象——Unicorn 跑真实程序在 `syscall`/`int 2e` 处停住或报错；原因——Unicorn 不模拟内核，裸执行遇到系统调用即失败；对策——换 Qiling（自动转发系统调用，更省心）；非 Qiling 场景 hook 掉目标 syscall 返回假值（hook_code 判 syscall 指令后改寄存器+跳过）
- **自校验/环境检测样本察觉模拟**：现象——模拟结果与真实运行不符（分支走错、自毁）；原因——样本用 CPUID/rdtsc 时序、API 探测（如 `GetModuleHandleA` 特殊返回）检测非真实环境；对策——先静态定位检测点（[[re-triage]] / [[re-deobfuscate]]），hook 该路径返回真实环境值，或直接 patch 跳过硬校验；结论务必与真实沙箱执行交叉验证
- **内存权限错误**：现象——执行时报 `Invalid memory read/write/fetch`；原因——访问了未映射页或只读页写；对策——按报错地址检查 `mu.mem_map` 覆盖范围与 `mu.mem_protect(addr, size, UC_PROT_ALL)`，栈页补映射并设 `UC_PROT_READ|UC_PROT_WRITE`
- **模拟 ≠ 真实执行**：现象——依赖时间/线程的程序行为异常；原因——Unicorn 单线程、`rdtsc` 时序不可靠需 hook 处理、部分 API 语义不完整；对策——模拟只用于确定性任务（解算法、解密、脱壳摘函数），时序/多线程/网络类任务转 QEMU 或真实沙箱；模拟结论用 [[re-tracing]] 对比真实轨迹

- **Android so 优先 unidbg**：现象——Unicorn/Qiling 裸跑 Android .so 缺 JNI/系统调用语义跑不动；原因——so 依赖 JNI 环境（Java 回调、DVM 对象）；对策——用 unidbg（Java，模拟 Android JNI + syscall），loadLibrary 后调 JNI_OnLoad 起步
- **JNI 回调逐个补的迭代模式**：现象——模拟执行报 `UnsupportedOperationException: 类->方法(签名)`；原因——so 调用了未实现的 Java 回调，这是**正常迭代信号不是死路**；对策——按报错签名逐个实现回调（日志类/配置类/字段读写），一轮一跑，同类项目都有完整回调集可移植；**模拟产出正常结果不等于正确**——环境可能被检测返回诱饵，用真实环境/服务器响应验证
- **iOS so 黑盒调用用 Chomper**：现象——iOS 加固/混淆 so 算法（签名类）静态还原难，想在 PC 上直接调用拿结果；原因——so 依赖 OC 运行时与特定初始化（Token/上下文）；对策——Chomper（Unicorn 封装，模拟 iOS 环境）黑盒调用流程：frida-trace 先摸清初始化函数与算法调用逻辑 → **dlopen 之后做初始化**（hook dlopen 时机，frida-trace 只能看到调用看不到初始化值）→ 构造入参对象（NSMutableURLRequest 等，用 pyobj2nsobj 把 dict 转 OC 对象）→ 主动调用出结果；先初始化 Token/上下文再调算法函数，参数对象按 frida-trace 打印的完整结构构造；目标访问外部文件（如安全配置 `yw_1222.jpg`）报 ENOENT → 从原始包复制文件到样本同目录，加载模块后调用 `forward_path` 把访问映射到指定路径；实例方法先 `+[Class instance]` 取实例再调用
- **设备侧函数 HTTP 服务化（r1rpc 模式）**：现象——能力依赖真机环境（DeviceCheck/App Attest、设备状态、SDK 上下文、反篡改校验），抠不出纯算，模拟执行也难；原因——这些函数本质是"设备侧函数"，脱离环境不工作；对策——工程化黑盒：**HTTP 入口/出口 + WebSocket 设备侧通信 + 真机常驻客户端执行**：后端照常发 HTTP 请求，Server 按分组选在线设备，WebSocket 下发任务，真机执行后回传，调用方拿到的仍是标准 HTTP 响应；适用场景：iOS 设备能力、App 内部签名、必须真机/特定 SDK 的能力——比硬抠算法或硬搬后端成本低得多
- API 速查（Unicorn/Qiling 各族命令与常数）与组合套路见 [[commands]]；版本差异、内存/架构边界见 [[gotchas]]
