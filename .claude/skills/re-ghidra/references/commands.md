# Ghidra 命令速查与操作序列

两条主线：GUI（交互标注/函数级深分析）与 analyzeHeadless（无头批处理/脚本化）。脚本语言二选一：GhidraScript（Java / Jython 2.7，内置解释器）或 ghidra-bridge（外部 Python 3 驱动 GUI）。所有参数名与 API 以目标版本官方文档（help/topics/）与 javadoc 为准。

## analyzeHeadless 参数族（无头批处理）

| 参数 | 作用 |
|---|---|
| `-project <路径>` | 工程所在目录（自动创建） |
| `<工程名>` | 工程名（位置参数） |
| `-import <文件\|目录>+` | 导入并分析（可多个；目录需配 `-recursive`） |
| `-process [<工程内文件>]` | 对已导入文件重跑（与 `-import` 二选一） |
| `-preScript / -postScript <脚本名> [<arg>]*` | 分析前/后执行脚本，可跟参数 |
| `-scriptPath "<路径1>[;<路径2>...]"` | 脚本搜索路径（分号分隔） |
| `-propertiesPath` | 脚本属性文件路径 |
| `-noanalysis` | 跳过自动分析（符号/字符串仍在，秒级导入） |
| `-analysisTimeoutPerFile <秒>` | 单文件自动分析超时 |
| `-processor <languageID> / -cspec <compilerSpecID>` | 强制指定语言/编译器（识别错时用） |
| `-readOnly` | 只读打开工程（不写改动） |
| `-overwrite` | 覆盖已存在文件 |
| `-recursive [<depth>]` | 递归导入子目录 |
| `-deleteProject` | 结束后删除工程 |
| `-log <文件> / -scriptlog <文件>` | 运行日志 / 脚本日志（两个分开看） |

典型组合：`analyzeHeadless /tmp/p name -import a.bin -postScript X.java -scriptPath /s -deleteProject -log l.log`。

## GUI 快捷键族（按任务分组）

| 任务 | 操作 | 说明 |
|---|---|---|
| 导入 | `File > Import File` | 选样本后 `Analyze`，等左下角进度完成 |
| 跳转 | `G` | Go To 地址/符号 |
| 交叉引用 | `R` | 光标在函数/变量上按 R 开 References |
| 反编译 | `Ctrl+E`（默认，随版本/keymap 可能不同） | 打开 Decompiler 窗口，以 Help > Key Bindings 为准 |
| 函数图 | `F` | Function Graph（分支/循环结构） |
| 重命名 | `L` | 函数/变量重命名（Listing 与 Decompiler 中均可用） |
| 设置类型 | `y` | Set Data Type（如 `char *`、`DWORD`） |
| 定义结构体 | `Data Type Manager > 右键 > New > Structure` | 定义后 Decompiler 引用改善反编译 |
| 强制反汇编 | `C` | 选中字节标为 code（混淆段手动展开） |
| 建函数 | `右键 > Create Function` | 修复函数边界 |
| 撤销 | `Ctrl+Z` | 标注/改名可回滚 |
| 导出 | `File > Export Program` | 格式选 C/C++ 导出**反编译结果**（非原始源码——变量名/类型推断可能错误，只作阅读辅助，关键逻辑对照反汇编验证） |

## 脚本 API 族（GhidraScript，Jython 2.7 语法）

```python
# 地址/函数
addr = currentProgram.getAddressFactory().getDefaultAddressSpace().getAddress("0x401000")
fm = currentProgram.getFunctionManager()
f = fm.getFunctionAt(addr)
# 重命名/标注（USER_DEFINED 才进脚本可回滚）
from ghidra.program.model.symbol import SourceType
f.setName("decrypt_buf", SourceType.USER_DEFINED)
listing = currentProgram.getListing()
listing.setComment(addr, listing.PLATE_COMMENT, "decrypt loop start")
# 字节批量读写（比 getByte/setByte 逐字节快）
mem = currentProgram.getMemory()
buf = bytearray(0x100)
mem.getBytes(addr, buf)
mem.setBytes(addr, buf)
# 反编译单函数
from ghidra.app.decompiler import DecompInterface
dec = DecompInterface()
dec.openProgram(currentProgram)
res = dec.decompileFunction(f, 60, monitor)   # 超时给足
print(res.getDecompiledFunction().getC())
# 遍历函数
for g in fm.getFunctions(True):
    print(g.getName(), hex(g.getEntryPoint().getOffset()))
```

## 操作序列（组合套路）

### 1. 无头批量反编译导出流水线（多样本）

```
先写收集脚本 CollectC.java（遍历函数 → decompileFunction → 写 .c 文件）
analyzeHeadless /tmp/p name -import dir/ -recursive \
  -postScript CollectC.java -scriptPath /tmp/s -deleteProject -log l.log
产物按样本名归档，脚本日志看 -scriptlog（与 -log 分开）
```

### 2. 解密循环脚本化（XOR 例程直接出明文）

```
静态定位解密循环（[[re-crypto-decrypt]]）→ 确认异或常量与区间
脚本: mem.getBytes 读出密文 → python 内 xor → 写回或导出新文件
验证: 导出明文 sha256 与沙箱实跑结果对照（[[re-sandbox]]）
```

### 3. 大型二进制分段展开（防自动分析卡死）

```
先 -noanalysis 导入（秒级）→ 脚本拿符号表/字符串/入口点
对关键区段单独跑小范围分析（或 GUI 内关掉 RTTI/间接调用选项）
单函数反编译推进，逐步扩大——见 [[gotchas]] 大文件分析组
```

### 4. ghidra-bridge 远程驱动（Python 3 环境）

```
GUI 内 Script Manager 跑 ghidra_bridge_server.py（打印端口）
外部: b = ghidra_bridge.GhidraBridge(); b.remote_scope(); b(getFunctionManager())
适合 numpy/现代 Python 能力，脚本与 GUI 会话同步（改标注即时可见）
```

## 实现教训（内化）

- 批量字节操作用 `mem.getBytes/setBytes`，别 `getByte/setByte` 逐字节（大段慢一个数量级）
- 内置解释器是 Jython 2.7：用 `xrange`、字符串不用 f-string；要 Python 3 能力就上 ghidra-bridge
- `decompileFunction` 第二个参数是超时秒数，大函数给 60+，返回 `res.decompileCompleted()` 判断失败
- 地址算术用 `addr.add(i)` / `addr.subtract(i)`，不能直接 `addr + i`
- 标注来源用 `SourceType.USER_DEFINED`（可区分于分析器自动标注，回滚安全）
- 脚本异常先看 `-scriptlog`，headless 的 print 只进脚本日志不进 `-log`

## 使用注意

- 静态分析免沙箱（[[platform-tips]] 静态优先）；样本 sha256 与导出产物存档（[[re-triage]]）
- 结论写入 [[analysis-contract]]；脚本与工程按版本锁存（[[gotchas]] 版本组）
