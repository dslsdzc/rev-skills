---
name: re-python
type: atomic
description: >
  Python 打包/混淆样本分析：PyInstaller/PyArmor/Nuitka/Cython 解包、pyc 版本识别与反编译。
  触发词：Python打包、PyInstaller、PyArmor、pyc、python exe、Python 样本、打包样本。
---

# Python 打包样本分析（PyInstaller / PyArmor / pyc）

## 何时使用 / 何时不用

- 用：PyInstaller 单文件/目录 exe、PyArmor 加固样本、.pyc 文件、Nuitka/Cython 编译产物、Python 恶意软件打包样本
- 不用：纯 .py 源码混淆（base64/编码包装）→ 转 [[re-script-deob]]；Python 模型权重（pkl/onnx）→ [[re-ai-model]]

## 工具准备

### python3（基础运行时，必备）

- Linux: `apt install python3` / `dnf install python3` / `pacman -S python`
- macOS: `brew install python`（系统自带）
- Windows: 官网安装包或 `choco install python`
- 验证: `python3 --version`

### pyinstxtractor（PyInstaller 归档提取）

- 多平台: `pip install pyinstxtractor` 或 GitHub 脚本 `python pyinstxtractor.py`
- 验证: `pyinstxtractor --help`（或 python 脚本方式运行无报错）

### PyArmor-Unpacker（PyArmor 加固解包）

- 多平台: `git clone https://github.com/Svenskithesource/PyArmor-Unpacker`，按 README 按 PyArmor 版本选三方法之一
- 验证: 仓库内 python 脚本可运行

### pycdc / pycdas（pyc 反编译）

- Linux/macOS: `git clone https://github.com/zrax/pycdc && cd pycdc && cmake . && make`
- Windows: 预编译二进制或 WSL 编译
- 验证: `./pycdc --help`

### file（打包器识别辅助，通用）

- 各系统自带（Linux binutils / macOS / Windows 需额外装或跳过）

## 操作步骤

按顺序执行，每步产物存档（路径 + sha256，见 [[re-triage]]）。

1. **识别打包器**：
   ```sh
   file sample.exe
   strings sample.exe | grep -iE 'PyInstaller|_MEIPASS|pyi-|PyArmor|pyarmor' | head
   ```
   - PyInstaller 特征：`PyInstaller` 版本串、`_MEI` 临时目录名、`pyi-` 前缀引导器
   - PyArmor 特征：`pyarmor` runtime 字符串
   - Nuitka/Cython：无 pyc、纯编译产物（`file` 显示普通可执行，无 Python runtime 打包特征）
   - 识别失败但确认 Python 相关 → 按可疑 PyInstaller 处理

2. **PyInstaller 解包**：
   ```sh
   python pyinstxtractor.py sample.exe
   # 输出 sample.exe_extracted/ 目录，含 PYZ-00.pyz（依赖归档）与主脚本 .pyc
   ```
   - 定位主 .pyc（名字与入口脚本对应）；PYZ 内模块用 `python -m pyinstxtractor` 的 `--pylib` 参数或 archive_viewer.py 列出

3. **PyArmor 解包**（步骤 1 检测到 PyArmor 时）：
   - 按 PyArmor 版本选 PyArmor-Unpacker 三方法之一（README 判断版本 → 对应方法）
   - 解包产物仍为 pyc 或源码，继续下一步

4. **pyc 版本识别**：
   ```sh
   python3 -c "import struct,sys; print(struct.unpack('<H', open('main.pyc','rb').read(2))[0])"
   ```
   - magic 对照（小端 2 字节，常见值；以本机 `python3 -c "import importlib.util; print(importlib.util.MAGIC_NUMBER.hex())"` 为准）：
     - `0d0a`=3.6、`420d`=3.7、`550d`=3.8、`610d`=3.9、`6f0d`=3.10、`cb0d`=3.11、`d70d`=3.12
   - 版本匹配目标则用对应版本 python 或 pycdc 反编译；不匹配先装匹配版本再试

5. **反编译与清理**：
   ```sh
   pycdc main.pyc > main_decompiled.py   # 或匹配版本 python 的 dis 模块
   ```
   - 清理 confusion code：删假函数/死代码（PyArmor 常见的无引用包装函数），定位核心逻辑（加密/网络/外泄）
   - 反编译失败（版本不匹配/混淆）→ 用 `dis` 字节码级分析关键函数，或转 [[re-binary-core]] 深度还原

## 跨域联合

- [[re-managed]] 网关：本技能归属（选择树「Python 打包样本」分支）
- [[re-script-deob]]：纯脚本混淆（无打包）场景
- [[re-malware]]：恶意 Python 样本的行为验证与 IOC（解包后转行为分析）
- [[re-binary-core]]：pyc 深度还原 / 混合产物（内嵌 native 模块 [[re-format-elf]]）
- 底座 [[re-triage]]：打包器识别的初勘输入

## 常见坑与陷阱

- **pyc 版本不匹配直接反编译失败**：现象——pycdc 输出乱码或报错；原因——magic 版本与目标不符；对策——先做步骤 4 的 magic 识别，按版本选工具
- **PyArmor 版本差异导致解包器失效**：现象——PyArmor-Unpacker 报不支持；原因——PyArmor 版本过新/过旧；对策——按版本换方法，或手动定位 runtime 的加解密逻辑（转 [[re-binary-core]]）
- **Cython/Nuitka 无 pyc**：现象——找不到 .pyc；原因——编译型产物；对策——直接分析产物（[[re-format-elf]] / [[re-ghidra]]），不找 pyc
- **假函数干扰定位**：现象——解包后源码充斥无引用包装函数；原因——PyArmor 的 confusion code；对策——先按调用关系过滤（无调用者即候选），再定位核心逻辑
- **strings 找打包器特征被加密隐藏**：现象——strings 无 PyInstaller 特征但行为是 Python；原因——字符串加密/壳；对策——按行为线索与扩展名判断，必要时动态侧（[[re-sandbox]]）观察
