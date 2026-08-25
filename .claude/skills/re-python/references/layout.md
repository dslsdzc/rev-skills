# Python 打包产物布局：pyc / PyInstaller / PyArmor

三类产物的分析入口不同：`.pyc` 直接按头 + marshal 解析；PyInstaller 先按 CArchive/PYZ 解出 pyc 再走前一条；PyArmor 是「外壳 pyc + native runtime」组合，结构与版本强绑定。本文件字段值以本机实测（Python 3.14.7 / PyInstaller 6.22.2）为准，版本差异单独标注。

## 1. pyc 文件布局

pyc = 16 字节头 + 一个 marshal 序列化的 code 对象（3.7+ 统一；3.7 前头为 12 字节）。

### 头字段（16 字节，3.7+）

| 偏移 | 名称 | 长度 | 说明 |
|---|---|---|---|
| 0x00 | magic | 4 | `2b 0e 0d 0a`（3.14 实测）或小端 u16 读取（0x0e2b）；版本判定依据 |
| 0x04 | flags | 4 | 0=timestamp 校验；低 1 位=1 为 hash-based（PEP 552，mtime/size 无意义） |
| 0x08 | mtime | 4 | 源文件 mtime；PyInstaller 写 PYZ 时清零（非损坏） |
| 0x0c | size | 4 | 源文件字节数；同被 PyInstaller 清零 |
| 0x10 | code 对象 | — | marshal 流从此开始 |

### magic 版本对照（小端 u16）

| 值 | 版本 | 值 | 版本 |
|---|---|---|---|
| 0x0d33 | 3.6 | 0x0d6f | 3.10 |
| 0x0d42 | 3.7 | 0x0da7 | 3.11 |
| 0x0d55 | 3.8 | 0x0dcb | 3.12 |
| 0x0d61 | 3.9 | 0x0e2b | 3.14（本机实测） |

3.13 及以后：不写死数值，按目标机器换算——`python3 -c "import importlib.util; print(hex(int.from_bytes(importlib.util.MAGIC_NUMBER[:2],'little')))"`。

### marshal code 对象概览

- code 对象 marshal 类型字节 = `0x63`（'c'）；带引用标志 `FLAG_REF`(0x80) 时为 `0xe3`——`py_compile` 产物顶层为 `0xe3`，PyInstaller 解出条目标 `0x63`，两种都合法
- 3.14 起 marshal 版本为 5（`marshal.version`），code 对象内部字段布局与旧版不同——手写 marshal 解析必须按 magic 版本分派，别假设字段偏移
- 反编译兜底一律用匹配版本的官方 `marshal.loads` + `dis`，而不是手写解析器

## 2. PyInstaller 布局

### 产物形态

```
onefile:  [bootloader(ELF/PE/Mach-O)] [CArchive 数据] [cookie]
onedir :  程序目录 = bootloader 可执行文件 + 同目录 _internal/（内含 PKG 归档或散文件 + PYZ + 依赖）
```

- 两种形态都含一个 PYZ（模块字节码归档）与一个 PKG/CArchive（其余资源）
- onefile 运行时把 CArchive 解到 `_MEIxxxxxx` 临时目录再执行（`strings` 里的 `_MEI` 特征即此）

### CArchive cookie（归档尾，88 字节，大端）

格式 `!8sIIII64s`（实测 PyInstaller 6.22.2 源码 `_COOKIE_FORMAT`）：

| 偏移 | 名称 | 长度 | 说明 |
|---|---|---|---|
| 0x00 | MAGIC | 8 | `MEI\x0c\x0b\x0a\x0b\x0e` |
| 0x08 | archive_length | 4 | 归档总长（= toc_offset + toc_len + 88） |
| 0x0c | toc_offset | 4 | TOC 起始偏移（相对归档起始） |
| 0x10 | toc_length | 4 | TOC 字节数 |
| 0x14 | pyvers | 4 | `major*100+minor`（314 = Python 3.14，实测） |
| 0x18 | pylib_name | 64 | Python 动态库名（`libpython3.14.so.1.0`，实测） |

定位：在文件中扫描 MAGIC，取最后一次出现（cookie 在归档末尾）；onefile 下归档前是 bootloader，**归档起点 = cookie 位置 + 88 − archive_length**（cookie 自身不算进归档，少加 88 会整体偏移）。

### CArchive TOC 条目（变长，对齐 16）

条目 = 18 字节头（`!IIIIBc`，大端）+ UTF-8 名字（含 NUL），整条目补齐到 16 字节：

| 偏移 | 名称 | 长度 | 说明 |
|---|---|---|---|
| 0x00 | entry_length | 4 | 本条目总长（含名字与补齐） |
| 0x04 | data_offset | 4 | 数据相对归档起始的偏移 |
| 0x08 | compressed_length | 4 | 压缩后长度 |
| 0x0c | data_length | 4 | 原始长度 |
| 0x10 | compress | 1 | 0=不压缩，1=zlib |
| 0x11 | typecode | 1 | 实测：'m'=内嵌引导模块（zlib 压缩 pyc）、's'=脚本类（入口/启动钩子）、'b'=二进制数据、'z'=PYZ 类条目（含 base_library.zip 与 PYZ.pyz） |
| 0x12 | name | 变长 | UTF-8 + NUL 结尾（名字无扩展名），条目 16 对齐 |

### PYZ（模块字节码归档）

头 16 字节 + 模块数据 + 尾部 TOC（marshal list）：

| 偏移 | 名称 | 说明 |
|---|---|---|
| 0x00 | MAGIC | `PYZ\0`（4 字节） |
| 0x04 | pyc magic | 与 pyc 相同的字节码 magic（实测 `2b 0e 0d 0a`） |
| 0x08 | toc_offset | 大端 i32，TOC 相对 PYZ 起始的偏移 |
| 0x0c | 保留 | 4 字节 |

- 模块条目：`zlib.compress(marshal.dumps(code_object))` 顺序写，无独立头
- TOC：marshal 序列化的 `(name, (typecode, offset, length))` 列表，位于文件尾部；typecode 有模块（PYMODULE）/包（PKG，`__init__`）/命名空间包（NSPKG，0 长度）
- pyinstxtractor-ng 解包 PYZ 后为 `PYZ.pyz_extracted/` 目录，每个模块重建 16 字节 pyc 头（mtime/size 为 0）

### 解包产物结构（pyinstxtractor-ng，实测）

```
sample_app_extracted/
├── sample_app.pyc        # 入口脚本（code 对象从 0x10 开始）
├── PYZ.pyz               # 模块归档
├── PYZ.pyz_extracted/    # 解出的模块 pyc
├── python3.14/           # 版本目录
│   └── lib-dynload/      # 扩展模块 .so
├── base_library.zip      # 标准库 zip
└── lib*.so.1.0           # 运行时依赖
```

## 3. PyArmor 布局（版本强绑定）

PyArmor 产物形态随版本变化（外壳结构/密钥派生/加密算法都变过），以下为通用骨架，细节按版本核实：

- 加固后的 pyc 是「外壳」：真实字节码加密，运行期由 `pyarmor_runtime`（随样本交付的 native 扩展）解密执行
- 产物含大量无引用的包装函数（confusion code）干扰静态分析
- 常见三件套形态：加密数据（字节串常量）+ 引导调用 + native 解密组件；函数级加解密窗口极短（进入桩解密、执行、离开桩重加密）
- 解包思路与工具见 SKILL.md：按版本选 PyArmor-Unpacker 三方法之一；还原结论必须标注精确 PyArmor 版本

## 实现教训（内化）

- 一切解析先读 magic 定版本：pyc 头、marshal 格式、PyInstaller cookie 的 pyvers 三处各自判版本
- PyInstaller 归档偏移是「相对归档起始」不是文件起始（onefile 前有 bootloader）；cookie 里 archive_length 是换算基准
- TOC 条目是变长的（名字补齐 16 字节），按 entry_length 跳，别按定长扫
- pyc 头 mtime/size 为 0 是 PyInstaller 正常行为，不是解包失败

## 使用注意

- 静态解包/反编译免沙箱；动态取明文（[[re-sandbox]]）按最高原则
- 与 [[re-managed]]（本技能归属网关）、[[re-triage]]（初勘输入）、[[re-script-deob]]（纯脚本混淆）配合
- Cython/Nuitka 产物无 pyc，直接转 [[re-format-elf]]/[[re-ghidra]] 分析 native
