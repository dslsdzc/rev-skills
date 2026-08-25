---
name: re-radare2
description: >
  rizin/radare2 工作流：命令行分析、pdf、V 模式。
  触发词：radare2、rizin、rz、r2
---

# rizin/radare2 命令行分析

## 何时使用 / 何时不用

- 用：命令行/脚本化分析；内存 <4GB 或远程环境（GUI 反编译器跑不动）；快速反汇编与交叉引用；`pdf`/`V` 模式探索；固件/批量样本脚本化分析
- 用：无 GUI 的 SSH/CI 环境（rz 纯终端，`-q -c` 一行批处理）
- 不用：需要成熟 GUI 反编译与类型传播（走 [[re-ghidra]]）
- 不用：只需初勘结论（[[re-triage]]）
- 不用：Windows 用户态调试为主（[[re-x64dbg]] / [[re-windbg]] 更顺手；rz 调试器在 Windows 上能力有限）

## 工具准备

参考 [[platform-tips]]——命令行工具适配远程/低内存环境；平台分支的 Wine/QEMU 用户态仿真经验同样适用。

### rizin（radare2 的活跃分支）

- macOS: `brew install rizin`
- Arch: `pacman -S rizin`
- Fedora 43+/RHEL(EPEL): `dnf install rizin`（EPEL 8/9 也有包；Fedora 42 及更早版本用官方 release 二进制）
- Debian/Ubuntu: 官方 release 二进制（GitHub rizinorg/rizin releases：static tar.xz / Windows zip / macOS pkg）或 `rz-pm` 安装——Debian 仓库无 rizin 包，`apt install rizin` 会失败
- Windows: 官方 release zip 解压即用（`rz-bin.exe`）
- 验证: `rizin -v`、`rz-bin -V`

### radare2 兼容层（旧命令体系）

- Linux: `apt install radare2` / `dnf install radare2` / `pacman -S radare2`
- macOS: `brew install radare2`
- Windows: `choco install radare2`
- 验证: `r2 -v`
- 注意: rz 与 r2 命令基本兼容（`pdf`/`axt`/`V` 相同），但插件名与个别命令有差异（下文标注）

### rz-ghidra 反编译插件

- 全平台: `rz-pm -ci rz-ghidra`（rizin 包管理，需网络与编译工具链）
- 验证: rizin 内 `pdg @ main` 能输出伪 C

## 操作步骤

1. **`rizin -A` 全自动分析**：
   ```sh
   rizin -A sample
   ```
   等待分析完成提示（大文件按 `p` 分页观察）。`-A` 等同 `aaa`（全量自动分析: 函数/交叉引用/字符串引用）。只做浅层时用 `-a x86` 等按需参数。退出: `q`。
   - 无参数直接进交互模式后补分析: `aaa`；轻量版 `aa`（函数+字符串引用，大文件首选）
   - 函数列表: `afl`；单函数信息: `afi @ main`；手工定义函数: `af @ 0x401000`

2. **`pdf` 反汇编函数**：
   ```
   [0x00001040]> pdf @ sym.main
   ```
   - 无符号（stripped）时先找入口: `izz~entry` 或 `af @ 0x401000` 手工定义函数后再 `pdf @ 0x401000`
   - `pdf` = print disassembly function；`pd 20` = 打印 20 条指令；`pdr` 打印带引用
   - 混入分析噪声时用 `pdf @ <addr> | grep call` 过滤调用
   - 重命名: `afn 新名字 @ 地址`；注释: `CCu 注释 @ 地址`

3. **`axt` 交叉引用**：
   ```
   [0x00001040]> axt @ 0x403000     # 谁引用 0x403000
   [0x00001040]> axf @ sym.main     # main 引用了谁
   ```
   字符串引用: `izz` 列出全部字符串，`axt @ str.<名称>` 找引用点（字符串已被自动命名）。
   - 定位链: `izz` 找关键字符串 → `axt @ str.xxx` → 跳到引用函数 `s <地址>` → `pdf`——与 [[re-ida]] 的 Alt+T→x→F5 同思路

4. **可视化 `V` 模式**：
   ```
   [0x00001040]> V
   ```
   - `p` 切换视图（反汇编/十六进制/图形）
   - `s` 后跟地址/符号跳转（`s sym.main`）；`f` 定义函数；`d` 反汇编切换
   - 图形视图（函数流程）: `V` 内按 `p` 到 graph 视图，方向键导航——梳理控制流用
   - 退出 V: `q`；退出 rizin: 再 `q`

5. **脚本与 rz-ghidra 反编译**：
   ```sh
   # 一行命令批处理
   rizin -q -c 'aaa; pdf @ sym.main; axt @ 0x403000; quit' sample
   ```
   ```sh
   # 反编译
   rz-pm -ci rz-ghidra
   rizin -c 'aaa; pdg @ sym.check' sample
   ```
   `pdg` = Ghidra 风格伪 C 输出；无插件时退回 `pdf` + 人工还原。
   - 脚本文件: `rizin -i script.r2 sample`（或交互内 `. script.r2`）；脚本里每条命令一行，`quit` 结尾

6. **调试模式（rz 内置调试器）**：
   ```sh
   rizin -d ./sample            # 以调试模式启动
   rizin -d -p 1234             # attach pid
   ```
   ```
   [0x7f...]> db 0x401000       # 断点（db = debugger breakpoint，与 r2 相同）
   [0x7f...]> dc                # 继续（continue）
   [0x7f...]> ds / dso          # 单步 / 步过
   [0x7f...]> dr eax=0          # 改寄存器（绕过校验常用）
   [0x7f...]> px @ rsp          # 看栈内容
   [0x7f...]> drr               # 全部寄存器
   ```
   - 断点表: `db`（无参数列出）；删断点: `db- 地址`；条件断点: `db 地址:条件`（如 `db 0x401000:eax==1`）
   - 调试与 gdb 的差异见 [[gotchas]]；gdb 系流程见 [[re-gdb]]

7. **搜索与内存操作**：
   ```
   [0x00001040]> /x 5548             # 十六进制搜索
   [0x00001040]> /v 0xdeadbeef       # 32 位值搜索（小端）
   [0x00001040]> /w "password"       # 字符串搜索
   [0x00001040]> /r sym.check        # 引用搜索（找谁引用了符号）
   [0x00001040]> wx 9090 @ 0x401000  # 写字节（NOP 补丁）
   [0x00001040]> px 32 @ 0x401000    # 读 32 字节
   ```
   - 文件信息: `rz-bin -I sample`（架构/入口/段）、`rz-bin -z sample`（字符串）、`rz-bin -i sample`（导入）——等价 r2 的 `rabin2 -I/-z/-i`

8. **项目与导出**：
   ```
   [0x00001040]> Ps project_name     # 保存项目（含分析结果与标注）
   [0x00001040]> Po project_name     # 打开项目
   [0x00001040]> Pj > out.json       # 导出 JSON 项目（供脚本二次处理）
   ```
   - 分析标注（重命名/注释）随项目持久化——下次 `Po` 直接续用

## 跨域联合

- [[re-binary-core]]：工作流第 5 步低内存/命令行替代方案（`RE_DECOMPILER=radare2`）
- [[re-firmware]]：固件 ELF 批量脚本化分析（无 GUI 环境）
- [[re-ctf]]：CTF 题命令行快攻
- 与 [[re-format-elf]] 衔接读结构；需要 GUI 反编译时转 [[re-ghidra]]
- 动态调试场景与 [[re-gdb]] 互补（gdb 生态/插件更全，rz 内置调试器轻量）

## 常见坑与陷阱

- **未 `-A` 前信息少**：不开分析则无函数边界/无交叉引用——先 `-A`（或 `aaa`），再看符号
- **大文件分析慢**：全量 `aaa` 在超大固件上极慢——用 `aa`（轻量）或 `aa~` 限制，或只对目标段 `af @ addr` 手工分析
- **命令体系 r2/rz 差异**：网上教程多为 radare2（r2），rizin（rz）大体兼容但插件安装（`r2pm`→`rz-pm`）、个别命令名不同——先 `rz?` 查帮助再执行
- `pdf` 依赖函数边界——无符号时 `af` 先定义，否则输出为空或错位
- 管道输出带颜色/分页符会污染脚本解析——批处理用 `e scr.color=0` 去色（`-2` 只关 stderr 告警，不去色）
- 版本差异、调试器与 PIE 地址坑见 [[gotchas]]
