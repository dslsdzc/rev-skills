# x64dbg 命令速查与操作序列

x64dbg 的双入口：图形快捷键（主界面）与底部命令框（命令行，支持脚本表达式）。两者可混用——先 `bp` 下断，再 F9 运行。命令框按回车执行，表达式支持寄存器/内存引用（`[地址]` 取值）、算术与字符串格式化。所有命令名与参数以 x64dbg 官方文档（docs/commands/）为准。

## 快捷键速查（按任务分组）

| 任务 | 快捷键 | 说明 |
|---|---|---|
| 打开/附加 | F3 / Alt+A | File > Open / File > Attach（管理员权限） |
| 运行 | F9 | 继续运行 |
| 运行到光标 | F4 | 运行到选中行 |
| 运行到用户代码 | Alt+F9 | 系统断点/库代码处回到用户模块 |
| 运行到返回 | Ctrl+F9 | 当前函数 RET（配合 F8 跳过 call 出函数） |
| 暂停/重启/关闭 | F12 / Ctrl+F2 / Alt+F2 | Pause / Restart / Close session |
| 单步 | F7 / F8 | 步入 / 步过 |
| 单步（跳过异常） | Shift+F7 / Shift+F8 | 系统 API 内部异常频繁时用 |
| 软断点 | F2 / Shift+F2 | 切换断点 / 编辑条件断点 |
| 断点窗口 | Alt+B | 管理：Space 启停、Delete 删除、双击改条件/日志 |
| 内存断点/硬件断点 | 右键菜单 | 内存窗口右键 Set Memory BPX；反汇编右键 Hardware breakpoint |
| 内存图 | Alt+M | 节区权限、模块列表 |
| 二进制搜索 | Ctrl+B | 字节模式，支持 `?` 通配（如 `55 8B EC`、`EB0?90`） |
| 查找 | Ctrl+F | 当前视图（反汇编/内存/栈）查找 |
| 模块字符串 | Shift+D | 找当前模块字符串引用 |
| 跳转地址 | Ctrl+G | 表达式/地址跳转 |
| 编辑内存 | Ctrl+E | 改字节（补丁绕校验） |
| 分析 | Ctrl+A / A | 分析整个模块 / 分析单函数 |
| 交叉引用 | Ctrl+R / X | 选中地址的引用 / 当前指令 xrefs |
| 视图 | Alt+C / Alt+M / Alt+E / Alt+T / Alt+G / Alt+K / Alt+B / Alt+R / Alt+L | CPU / 内存 / 模块 / 线程 / 图 / 调用栈 / 断点 / 引用 / 日志 |
| Scylla | Ctrl+I | 打开 IAT 修复插件 |

## 命令行命令（底部命令框）

### 断点族

- `bp <地址|API名>` 软断点（INT3；可用 `ss`/`ud2`/`long` 改类型，如 `bp 401000,ss` 一次性断点）；API 名直接断：`bp kernel32.VirtualAlloc`
- `bph <地址>[,r|w|x][,1|2|4|8]` 硬件断点（默认执行，x64 下可 8 字节，地址需对齐；DR 寄存器上限 4 个）
- `bpm <地址>[,a|r|w|x]` 内存断点（GUARD_PAGE，整块内存区域触发，默认全类型）
- `bc <地址|名>` 删除；`bpd`/`bpe` 禁用/启用；`bplist` 列全部
- 条件/日志：`SetBreakpointCondition <地址> <条件>`、`SetBreakpointLog <地址> <表达式>`、`SetBreakpointCommand <地址> <命令>`——命中不暂停只打日志/执行命令，批量验证参数常用

### 运行与跟踪

- `run [地址]`（别名 `go`/`r`/`g`）运行；带地址 = 先下一次性断点再跑（等价 F4）
- `sti [n]` 单步 n 次（Trap Flag）；`sto` 步过；`rtr` 运行到返回（等价 Ctrl+F9）；`skip` 跳过当前指令
- `erun`/`esti`/`esto` 带异常处理单步（等价 Shift+F8 系列）
- `ticnd <条件> [,上限步数]` 条件步入跟踪；`tocnd` 条件步过跟踪——自动跑完解密循环/等到特定寄存器值
- `opentrace <文件名>` 开启 trace 记录（配合 ticnd/tocnd 录制指令流，可回放分析）

### 内存与搜索

- `find <起始地址> <字节模式>` 单页搜索，`$result` 返回命中地址（页内搜索，跨页用 findallmem）；模式支持 `?` 通配与字符串格式化
- `findallmem <起始地址> <模式>` 全内存图搜索，`$result` = 命中数（结果进 References 窗口可遍历）
- `savedata <文件名> <地址> <大小>` 导出内存区段；文件名填 `:memdump:` 存为 `memdump_pid_addr_size.bin`
- `minidump <文件名>` 生成全内存 + 句柄信息 dmp
- `alloc`/`free` 目标进程内分配/释放内存（注入/打补丁常用）

### 会话与分析

- `attach <pid|进程名>` / `detach` 附加/脱离；`stop` 终止调试会话
- `analyse` 分析模块（等价 Ctrl+A）；`symload`/`symdownload` 加载/下载符号
- `reffind`/`refstr` 找引用/字符串（等价 Shift+D 系）

## 常用操作序列（组合套路）

### 1. 脱壳：运行到 OEP + Scylla 修复

```
bp VirtualAlloc（或对壳解密写点下内存断点）→ F9 跑 → 观察解壳进程
到 OEP 特征（push ebp; mov ebp,esp 等标准序言）→ Ctrl+I 开 Scylla
OEP 字段核对（完整 VA）→ IAT Autosearch → Get Imports → Dump → Fix Dump
```

### 2. 找注册码/授权校验比较点

```
Shift+D 模块字符串找 "注册成功/Invalid key" 类提示 → Ctrl+R 找字符串引用
引用处向上找比较指令（strcmp/自定义校验 call）→ F2 断点 → 改寄存器/改跳转
```

### 3. 捕获运行时解密数据（密钥/内存解密段）

```
内存窗口找 RWX 段（Alt+M）→ 对该段下内存断点（写触发）→ F9
命中即停在写入点 → Ctrl+G 到写入地址 → Ctrl+E 查看/复制明文
savedata dump 完整解密段，供 [[re-format-pe]] 或 [[re-imports]] 离线分析
```

### 4. 自动跑过解密循环（条件跟踪）

```
ticnd "RAX==0 && [401000]==0x90", 1000000
# 单步直到条件满足或 100 万步上限——解密循环结束时自然停下
```

## 实现教训（内化）

- 命令框支持表达式与 `[内存]` 解引用：`[401000]` 取值、`eip`、`(byte)[eax]`——条件断点/ticnd 条件都直接写表达式，别先算好常量
- `find` 只在单内存页内搜索；全内存搜索用 `findallmem`（结果在 References 视图）
- 条件断点/日志断点不改变执行流，适合"确认参数/确认调用点"场景，比直接改寄存器可逆性好
- 硬件断点（bph）不修改代码字节，抗完整性校验目标优先；但只有 4 个 DR 寄存器名额
- 附加后先 F12 暂停再下断——目标多线程时边跑边下断会错过命中

## 使用注意

- 全部在沙箱内执行（见 [[platform-tips]] 最高原则）；管理员权限是 attach 前置
- Scylla 输出修复 exe 后与原始样本 sha256 对照存证（见 [[re-triage]]）；分析结论写入 [[analysis-contract]] 数据契约
