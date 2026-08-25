# WinDbg 命令速查与操作序列

WinDbg 命令三类：普通命令（`.exr`/`g`/`r`，点开头）、扩展命令（`!analyze`/`!process`，叹号开头、来自扩展 DLL）、伪寄存器（`$<名>`）。符号语法 `模块!符号`（`nt!KeWaitForSingleObject`）。官方参考: Microsoft Learn 调试器命令参考（debuggercmds）。

## 命令族速查

### 会话与运行

- `windbg -p <pid>` / `windbg <exe>`；`-g` 跳过初始断点；`-z <dump>` 打开 dump；`-k` 内核调试连接
- `g` 继续；`gh`/`gn` 继续（异常交给程序/忽略）；`Ctrl+Break` 中断；`q` 退出
- `.restart` 重启目标；`.detach` 脱离；`.kill` 终止

### 断点

- `bp <模块!符号|地址>`；`bu <符号>` 未解析符号断点（模块加载后自动生效——目标 DLL 未加载时首选）
- `bm <通配>` 批量断点（如 `bm nt!Io*`）；`bl` 列表；`bd`/`be` 禁用/启用；`bc *` 清空
- 条件断点: `bp addr ".if (rax==0) { } .else { gc }"`——不满足条件自动继续
- 命令断点: `bp addr "r; k; gc"` 命中时执行命令后继续（日志式观察）

### 单步与栈

- `p` 步过；`t` 步入；`pa <addr>` 步过到地址；`ta <addr>` 步入到地址；`gu` 执行到返回；`pt` 执行到 call 返回
- `k` / `kb` / `kv` 栈回溯（参数/符号帧）；`kn` 带帧号；`dps rsp` 按指针看栈内容
- `.frame <n>` 切栈帧；`.ecxr` 设异常上下文（dump 分析开局）；`.exr <addr>` 显示异常记录；`.cxr <addr>` 手动设上下文

### 寄存器与内存

- `r` / `r rax` / `r eax=0`；`r $t0=...` 伪寄存器（脚本临时变量）
- `db`/`dd`/`dq`/`du` 读内存（字节/双字/四字/Unicode）；`dps` 按指针解释
- `eb`/`ed` 写内存（`eb 0x401000 90`）；`u <addr>` 反汇编（`u 地址 L数量`）
- 搜索: `s -d 0x0 L?10000000 0xdeadbeef`（值）、`s -a 0x0 L?10000000 "text"`（ASCII 字符串）——在进程虚拟地址空间找常量/串
- 内存映射: `!address <addr>` 区域信息（权限/映射）；`!vad` 用户态 VAD 树

### 符号

- `.sympath srv*C:\symbols*https://msdl.microsoft.com/download/symbols`；`.symfix` 用默认符号服务器
- `.reload /f [模块]` 强制重载符号；`lm`/`lmv m <模块>`/`lmi <模块>` 模块与镜像信息
- `x <模块>!*<关键字>*` 搜索符号（如 `x nt!*ExAlloc*`）

### 扩展命令（常用子集）

- 崩溃: `!analyze -v`（EXCEPTION_CODE/FAULTING_IP/STACK_TEXT/PROCESS_NAME）
- 进程/线程: `!process 0 0`；`!process <EPROCESS> 1`；`!thread`；`!teb`；`!peb`
- 句柄/堆: `!handle <句柄>`；`!heap -a`；`!pool <地址>`（内核池块）
- 内核对象: `!object <地址>`；`!devobj`/`!drvobj`（设备/驱动对象）；`!irp <地址>`；`!stacks 0`（全栈汇总）
- 其他: `!dlls`（进程模块树）、`!runaway`（线程 CPU 时间）、`!locks`（锁）

### dump 与转储

- 用户态全量: `.dump /ma C:\x.dmp`（含句柄/内存，取证标准）；`.dump /f`（full）
- 内核: 目标机 `%SystemRoot%\Minidump\*.dmp`（小转储）；完全 dump 需配置内核 dump 设置
- `.writemem <文件> <起> <止>` 导出内存区段；`.readmem` 读回

### TTD（时间旅行调试，需管理员）

- 录制: `ttd.exe -out C:\traces target.exe args`；`ttd.exe -attach <pid> -out ...`；`-monitor <名>`；`-ring`（环形 2GB 上限）
- 打开: WinDbg `File > Open` 选 `.run`；索引: `!tt.index`（首次慢，之后快）
- 回放: `g-` 往回跑；`t-`/`p-` 往回单步；`!tt 50` 跳百分比；`!tt 位置` 跳 `事件:步数`
- 断点: `!tt br <寄存器> [值]`（值变化处停，`br-` 往回找）；`!tt bm <地址范围>`（内存访问处停）
- 数据模型: `dx @$cursession.TTD.Calls("模块!函数")`；`dx @$cursession.TTD.Memory(起, 止, "rwec")`（内存访问记录）
- `ttd.exe -stop all` 停止所有录制；`-help` 全参数

## 常用操作序列（组合套路）

### 1. 崩溃 dump 分析（minidump 标准开局）

```
windbg -z C:\dump.dmp
.sympath srv*C:\symbols*https://msdl.microsoft.com/download/symbols; .reload /f
.ecxr                    # 异常上下文设现场（WER dump 的当前上下文在 WerpReportFault 里不可信）
k                        # 真实栈回溯
!analyze -v              # 自动化分析：FAULTING_IP / STACK_TEXT 逐帧核对
```

### 2. 校验绕过（断 API → 改返回 → 继续）

```
windbg 目标.exe（-g 可跳过初始断点）
bp kernel32!CreateFileW          # 或目标校验 API
g → 命中后:
r rax=0                          # 改返回值
gu; g                            # 出函数后继续
```

### 3. 驱动/内核模块符号与深度分析

```
!process 0 0 → 找目标进程 EPROCESS
.process /p <EPROCESS>; .reload /f
lmv m <驱动名>                    # 基址/版本/路径
bp <驱动名>!<函数>                # 驱动内符号断点
!analyze -v（内核崩溃时出 bugcheck + 故障驱动）
```

### 4. TTD 录制 → 回放找解密/校验点

```
ttd.exe -out C:\traces target.exe       # 管理员命令行录制
WinDbg 打开 .run → !tt.index
dx @$cursession.TTD.Calls("模块!可疑函数")   # 看调用次数/参数分布
!tt br <寄存器> → 定位值变化点 → 前向/后向单步看上下文
```

### 5. 栈损坏现场恢复（live 会话）

```
命中崩溃 → .exr <EXCEPTION_RECORD 地址>（!analyze -v 的 STACK_TEXT 里取）
.cxr <CONTEXT 地址> → k → kv
```

## 实现教训（内化）

- `!analyze -v` 是起点不是终点——`STACK_TEXT` 后必须 `.ecxr` + `k` 手工核对真实调用链
- 符号未加载时一切输出都是裸偏移——先 `.symfix` + `.reload /f`，断点用 `bu`（未解析也可设）
- 条件断点用 `.if/.else + gc` 语法（不是 gdb 的 `if` 后缀）；命令断点实现日志式观察不中断
- `s` 搜索在用户态可用 `L?<范围>`；内核态地址空间搜索量大，先缩小范围
- TTD 的 `!tt bm`/`br` 是「找内存/寄存器事件」的利器——比反复重跑目标快得多
- 栈损坏场景 `.ecxr`/`.cxr` 是唯一可靠回溯路径，别信 `k` 的直接输出

## 使用注意

- 全部在沙箱内执行（[[platform-tips]] 最高原则）；attach/内核调试需管理员权限
- 结论写 [[analysis-contract]]；dump 产物 sha256 与 [[re-triage]] 初勘值对照；驱动场景配合 [[re-kernel]]
