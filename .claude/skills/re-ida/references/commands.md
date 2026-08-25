# IDA 快捷键与 idapython 命令速查

IDA 双入口：GUI 快捷键（主界面）与 IDAPython（`File > Script command` / 无头脚本）。两者可混用——脚本能完成的事先脚本验证，GUI 负责交互式确认。命令语义以官方文档（docs.hex-rays.com）与 idapython 模块源码为准。

## 快捷键速查（按任务分组）

| 任务 | 快捷键 | 说明 |
|---|---|---|
| 文本搜索 | Alt+T | 当前 IDB 内搜字符串/关键字（找提示文案、错误串） |
| 二进制搜索 | Alt+B | 字节模式搜索（支持 `?` 通配） |
| 跳转 | G | 地址/符号/表达式跳转 |
| 返回上级 | Esc | 沿导航历史回退 |
| 交叉引用 | x | 选中项被谁引用；双击 xref 列表项跳转 |
| 重命名 | n | 函数/变量/全局改名 |
| 改类型 | y | 调用约定/参数/返回类型 |
| 注释 | ; / : | 普通注释 / repeatable 注释（跟随地址显示） |
| 反编译 | F5 | 打开 Hex-Rays 伪代码 |
| 视图切换 | Tab | 伪代码 ↔ 汇编 |
| 段列表 | Alt+E | segments 窗口 |
| 函数窗口 | Shift+F3 | 函数列表（名称/地址/长度） |
| 调试运行 | F9 / F2 / F8 / F7 | 继续 / 断点切换 / 步过 / 步入 |
| 调试重启 | Ctrl+F2 | 重启调试会话 |
| 脚本命令 | Shift+F2 | 打开 Script command 对话框 |

## 无头批处理命令

- `idat64 -A -S"script.py" sample`：自动模式跑脚本（`-A` 分析完自动退出；不写 `-S` 则只分析）
- `idat64 -A -S"script.py log.txt" sample`：脚本参数 `log.txt` 传给 `sys.argv`（argv[0]=脚本路径，argv[1:]=剩余参数）
- `idat64 -A -S"script.py" -L"ida.log" sample`：IDA 自身日志写文件（排错必需，问题常藏在日志里）
- `idat -A ...`（32 位无头）/ `idat64 -A ...`（64 位无头）；Windows 加 `.exe`
- 无头脚本固定骨架：

```python
import ida_auto, ida_pro, idc
ida_auto.auto_wait()          # 等 auto-analysis 完成，否则函数列表为空
# ... 主体逻辑（逐函数 try/except，失败记清单不中断） ...
idc.qexit(0)                  # = ida_pro.qexit(0)，必须退出否则进程挂住
```

## IDAPython 常用函数（按族）

- 字节/寻址: `idc.get_byte(a)` / `ida_bytes.patch_byte(a, v)`；`idc.get_name_ea(0, "name")`（失败返回 `BADADDR`）
- 函数: `ida_funcs.get_func(ea)`（返回 None 判空）、`idc.get_func_name(ea)`、`ida_funcs.func_size(ea)`
- 交叉引用: `idautils.XrefsTo(ea, 0)` / `idautils.XrefsFrom(ea, 0)`——遍历取 `.frm`/`.to`/`.type`
- 反编译: `ida_hexrays.decompile(ea)`（返回 cfunc，`.body` 是 ctree；失败抛异常先 try/except）
- 类型: `ida_typeinf.tinfo_t` 体系（IDA 9 推荐）；旧 `get_struc`/`get_member` 在 IDA 9 已移除
- 输出: `print()` 进输出窗口；批量结果写文件比刷输出窗口稳

## 常用操作序列（组合套路）

### 1. 定位校验/注册逻辑：字符串 → xref → 函数

```
Alt+T 搜提示文案（"Invalid key"/错误串）→ x 找引用 → 引用处函数 F5
伪代码里沿调用链上溯 → 找比较点（strcmp/校验 call）→ n 重命名 → 结论写注释 ;
```

### 2. 无头批量反编译导出（只读先行）

```
idat64 -A -S"dump.py" -L"ida.log" sample
# dump.py: auto_wait() → 遍历 idautils.Functions() 过滤 FUNC_LIB
# → 每函数 try: decompile(ea) 存 .c 文件；except: 记 (ea, name, reason) 清单
# → 结尾打印 total/exported/failed 双通道验证（配合 ida.log 关键字）
```

### 3. 解密循环批量 patch（写库前先跑只读验证）

```
先跑只读脚本: 打印目标段字节统计（读 0x100 字节 + 熵/首字节分布）确认地址与算法
再跑写库脚本: ida_bytes.patch_byte(base+i, get_byte(base+i) ^ key)
在 .i64 副本上跑；结束后 idc.qexit(0)
```

### 4. FLIRT 识别失败后的库函数对照

```
idb2pat 从某已知库构建 .pat → sigmake 转 .sig → 应用到样本
# 或先用 File > Produce file > Dump typeinfo 导出类型给其他工具
```

## 实现教训（内化）

- 无头脚本与 auto-analysis 异步并行——`auto_wait()` 之前任何函数遍历都是空的
- 返回地址的 API 一律判 `BADADDR`，返回对象的 API 判 None；失败先打印现场再继续
- 写库（patch/rename）不可逆性差——先在副本上跑，脚本先只读验证
- `idc.qexit(0)` 是唯一可靠的批量退出方式；`-L` 日志与 print 输出双通道验证结果
- 批量导出按便宜到贵排序（strings → imports → exports → memory → decompile），失败单条记录不中断

## 使用注意

- 静态分析免沙箱；IDA 调试器动态调试按 [[platform-tips]] 最高原则沙箱内执行
- 动态分析前先 [[re-triage]] 初勘（哈希/壳识别），FLIRT 只对脱壳后库有效
- 结论写入 [[analysis-contract]] 数据契约；带壳目标先 [[re-anti-analysis]]
