# Binary Ninja 快捷键与 Python API 速查

Binary Ninja 双入口：GUI（快捷键 + 面板）与 Python API（`File > Python` 面板 / 无头脚本 / 插件）。快捷键以官方文档（docs.binary.ninja）与默认 keybindings 为准；API 以 `binaryninja` 模块帮助为准。

## 快捷键速查（按任务分组）

| 任务 | 快捷键 | 说明 |
|---|---|---|
| 反汇编/反编译切换 | Space | 汇编视图 ↔ 反编译视图 |
| IL 循环 | i | 反汇编 / LLIL / MLIL / HLIL 循环切换 |
| IL 级别菜单 | 右下角 Options | 图形化选 Lifted LLIL/LLIL/MLIL/HLIL |
| 重命名 | n | 函数/变量/全局符号 |
| 改类型 | y | 输入 C 类型字符串，类型传播自动生效 |
| 设指针引用 | o | 当前位置创建指针 |
| 设字符数组 | a | 到下一个 NUL 的字符数组 |
| 整型宽度循环 | d | 循环 1/2/4/8 字节整型（数字键 1/2/4/8 直接设） |
| 建数组 | * | 选中多个同类变量转数组 |
| 有符号/无符号 | - | 整型显示切换 |
| 十六进制/十进制 | 0 | 整型显示进制切换 |
| 注释 | 右键 Comment | 添加注释（无固定默认快捷键，右键菜单可达） |
| 反编译单函数 | 双击函数 | 默认 HLIL 视图 |
| 跳转 | g | 地址/符号跳转 |
| 返回 | Esc | 返回上一个位置 |

## Python API 常用（按族）

- 加载与分析: `binaryninja.load(path)` → `bv`；`bv.update_analysis_and_wait()`（无头必需）；`bv.save()` 写回
- 函数: `bv.functions`；`bv.get_function_at(addr)`；`f.medium_level_il` / `f.high_level_il` / `f.llil`；`f.get_callers()` / `f.callees`；`f.name = "新名"`（直接赋值改名）
- 数据/字符串: `bv.get_strings()`；`bv.get_data_var_at(addr)`；`bv.get_data_refs(addr)`（谁引用该数据）
- 引用: `bv.get_code_refs(addr)`；`bv.get_data_refs(addr)`——定位链脚本化入口
- 类型: `bv.parse_type_string("int (*)(void*, size_t)")`；`Types` 面板定义结构体后 `tinfo_t` 应用
- 注释: `f.set_comment(addr, "text")`；`f.get_comment(addr)`
- 读写内存: `bv.read(addr, n)` / `bv.write(addr, data)`（补丁/解密循环用）；`bv.get_length()` 文件大小
- 日志: `bv.log_info("...")` / `print()`（GUI 控制台）
- 无头: 无 `binaryninja-headless` CLI——`install_api.py` 注册后脚本内 `binaryninja.load(path)` + `update_analysis_and_wait()` 直接跑；headless license 用官方独立下载包（`download_headless.py`）

## 常用操作序列（组合套路）

### 1. 定位校验逻辑（字符串 → 引用 → MLIL）

```
Strings 视图找提示串 → 双击进反汇编 → 右键 Show References
→ 跳到引用函数 → 双击进反编译视图 → i 切 MLIL 阅读数据流
→ n 重命名关键函数/变量 → 结论写注释
```

### 2. 无头批量导出（函数 + HLIL）

```python
import binaryninja, json
bv = binaryninja.load("sample.bin")
bv.update_analysis_and_wait()
out = {}
for f in bv.functions:
    if f.analysis_skip_reason is not None:
        continue
    out[hex(f.start)] = {"name": f.name, "hlil": str(f.high_level_il)[:2000]}
with open("out.json", "w") as fp:
    json.dump(out, fp, indent=1)
```

### 3. 解密循环批量 patch

```python
bv = binaryninja.load("sample.bin")
bv.update_analysis_and_wait()
base, key = 0x401000, 0x55
for i in range(0x100):
    bv.write(base + i, bytes([bv.read(base + i, 1)[0] ^ key]))
bv.save()   # 写回前确认在副本上操作
```

### 4. 批量标注调用点（给所有 call check 的函数加注释）

```python
bv = binaryninja.load("sample.bin")
bv.update_analysis_and_wait()
target = bv.get_symbol("check_license")   # 按符号名取
for ref in bv.get_code_refs(target.address):
    bv.get_function_at(ref.address).set_comment(ref.address, "calls check_license")
bv.save()
```

## 实现教训（内化）

- 无头脚本 `update_analysis_and_wait()` 之前任何遍历都是空结果——先等分析
- 改名/改类型用属性赋值（`f.name = ...`）比 API 调用直观；但所有修改要 `bv.save()` 才落盘
- 写内存前先 `bv.read` 记录原始字节；patch 场景在副本文件上操作
- IL 级别影响结论：HLIL 可读性最好但可能丢细节，MLIL 与反汇编对不上时降 LLIL 核对
- `get_code_refs`/`get_data_refs` 是脚本化定位链的核心——手点 xrefs 的批量替代

## 使用注意

- 全部在沙箱内执行（[[platform-tips]] 最高原则）；脚本触发动态执行默认沙箱内
- 结论写 [[analysis-contract]]；与 [[re-triage]] 初勘值对照入档
