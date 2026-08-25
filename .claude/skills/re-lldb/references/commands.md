# lldb 命令速查与操作序列

lldb 是命令行调试器（macOS 自带 / Linux 发行版仓库 / llvm.org 独立构建）。命令分族记忆：`target`（会话）→ `process`（运行）→ `breakpoint`（断点）→ `thread`（线程/步进）→ `frame`（栈帧）→ `memory`/`register`（内存/寄存器）→ `image`（符号/镜像）。`image` 是 `target modules` 的别名。官方参考: lldb.llvm.org（GDB to LLDB 映射页 + 命令参考）。

## 命令族速查

### 会话与运行

- `target create <文件>` 加载目标；`target list` / `target delete`
- `process launch [--stop-at-entry] [-- args]` 启动（停入口）；`run [args]` 等价简写
- `process attach --pid <pid>` / `--name <名>` 附加；`process detach` 脱离；`process kill` 终止
- `continue` / `c` 继续；`process interrupt` 中断（Ctrl+C）；`process status` 当前状态
- `lldb -p <pid>` 命令行直接附加；`lldb -s script.lldb <文件>` 批处理执行脚本文件

### 断点

- `breakpoint set -n <符号>` 符号断点（模块加载后自动生效）；`-a <地址>` 地址断点；`-r <正则>` 正则断点
- `breakpoint set -n func -s <模块>` 限定模块；`-c <条件>` 条件断点
- `breakpoint list` / `delete` / `disable <id>` / `enable <id>` / `clear`
- `breakpoint command add <id>` 批量执行命令（`> ... > DONE` 结束）；`breakpoint command delete <id>` 移除

### 步进与栈

- `thread step-over` / `step-into` / `step-out`（别名 `next` / `step` / `finish`）
- `thread step-inst` 单指令步进；`thread until <地址>` 运行到地址（循环内用）
- `thread backtrace`（`bt`）；`thread list`；`thread select <n>` 切线程
- `frame select <n>` 切栈帧；`frame variable` 局部变量；`frame info` 当前帧信息

### 寄存器与表达式

- `register read`（全部）/ `register read rax`；`register write rax 0` 写寄存器
- `expr <表达式>` 求值；`expr $rax = 0` 写；`expr (char*)0x...` 类型化读地址
- `expr -O -- <objc表达式>` Objective-C 求值（需 objc 运行时在目标进程）
- `expr -l objc++ -- ...` 切语言（C++ 目标用 c++）

### 内存

- `memory read [-c 数量] [-s 宽度] [-f 格式] <地址>`（格式冲突报错时显式给 `-f x`）
- `memory write -s <宽度> <地址> <值>` 写字节
- `memory find <起> <止> [-e 表达式|-s 字符串]` 区间搜索字节/字符串
- `memory region <地址>` 区域权限/边界（看 RWX 异常段）
- `memory read --force -o <文件> <地址> <地址+长度>` 导出到文件（大段转储）

### 符号与镜像

- `image list` 已加载镜像基址；`image list -o` 加偏移（ASLR 换算）
- `image lookup -n <名>` / `-a <地址>` / `-rn <正则>` 查符号归属
- `image dump symtab [<模块>]` 符号表全量；`target symbols add <文件>` 手动加载符号文件
- `image lookup -t <类型名>` 查类型定义（调试版目标）

### Python 脚本

- `script` 进 Python 交互；`script import lldb` 用 `lldb.debugger` 句柄
- `command script import <模块>` 注册 Python 命令；`lldb -s script.lldb` 批处理
- 常用: `lldb.debugger.GetSelectedTarget().FindFunctions("main")` 系列

## 常用操作序列（组合套路）

### 1. 附加 → 断点 → 验证调用参数

```
lldb -p <pid>
(lldb) breakpoint set -n objc_msgSend -s <目标模块>
(lldb) breakpoint command add 1
> register read rdi rsi          # x64 ABI 前两个参数
> thread backtrace
> continue
> DONE
(lldb) continue
```

### 2. 定位校验/授权逻辑（符号 → 断点 → 改值绕过）

```
(lldb) target create ./sample
(lldb) run --args <参数>
(lldb) breakpoint set -n strcmp                 # 或 -n 目标校验函数
(lldb) continue → 命中后:
(lldb) register write rax 0                     # 改返回值（相等）
(lldb) continue                                  # 观察是否绕过
```

### 3. 内存搜索找密钥/常量

```
(lldb) memory find -s "flag{" 0x100000000 0x101000000
(lldb) memory find 0x100000000 0x101000000 -e 0xdeadbeef
# 命中地址 → 断写入点或 memory region 看归属模块 → 上溯调用者
```

### 4. 解密循环自动跑完（条件断点 + until）

```
(lldb) breakpoint set -a <循环尾地址> -c '*(int*)($rdi) == 0xABCD'
(lldb) continue                     # 条件满足才停
(lldb) memory read -c 16 -s 1 -f x <输出地址>
```

## 实现教训（内化）

- 断点尽量符号名（`-n`），别用硬编码地址——ASLR 下每次运行基址漂移
- `memory read` 不指定格式时报格式冲突——`-f x`（十六进制）是调试常规选项
- `expr` 有副作用（执行代码）：验证场景先用 `frame variable` 只读，确认需要再求值
- 条件断点条件写错不会报错，只是永远不命中——先无条件断确认能停，再加条件
- 批处理 `lldb -s` 脚本里每条命令一行；出错不中断，注意末尾输出

## 使用注意

- 全部在沙箱内执行（[[platform-tips]] 最高原则）；attach 需 Developer Tools 授权
- 结论写 [[analysis-contract]]；与 [[re-triage]] 初勘值对照；iOS 目标权限/证书问题走 [[re-mobile]]
