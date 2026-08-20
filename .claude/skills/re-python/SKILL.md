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

- 多平台: `pip install pyinstxtractor-ng` 或 GitHub 脚本 `python pyinstxtractor.py`
- 验证: `pyinstxtractor-ng <目标.exe>` 运行无报错（无独立 --help 命令）

### PyArmor-Unpacker（PyArmor 加固解包）

- 多平台: `git clone https://github.com/Svenskithesource/PyArmor-Unpacker`，按 README 按 PyArmor 版本选三方法之一
- 验证: 仓库内 python 脚本可运行

### pycdc / pycdas（pyc 反编译）

- Linux/macOS: `git clone https://github.com/zrax/pycdc && cd pycdc && cmake . && make`
- Windows: 预编译二进制或 WSL 编译
- 验证: `./pycdc --help`

### file（打包器识别辅助，通用）

- 各系统自带（Linux binutils / macOS / Windows 需额外装或跳过）
- 验证: `file --version`

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
   - pip 安装用户：`pyinstxtractor-ng sample.exe`；GitHub 脚本用户：`python pyinstxtractor.py sample.exe`
   ```sh
   python pyinstxtractor.py sample.exe
   # 输出 sample.exe_extracted/ 目录，含 PYZ-00.pyz（依赖归档）与主脚本 .pyc
   ```
   - 定位主 .pyc（名字与入口脚本对应）；PYZ 内模块自动解出至 `PYZ-00.pyz_extracted/`；模块清单可用 archive_viewer.py 查看

3. **PyArmor 解包**（步骤 1 检测到 PyArmor 时）：
   - 按 PyArmor 版本选 PyArmor-Unpacker 三方法之一（README 判断版本 → 对应方法）
   - 解包产物仍为 pyc 或源码，继续下一步

4. **pyc 版本识别**：
   ```sh
   python3 -c "import struct,sys; print(struct.unpack('<H', open('main.pyc','rb').read(2))[0])"
   ```
   - magic 对照（小端 2 字节，常见值；以本机 MAGIC_NUMBER 为准）：
     - `0d33`=3.6、`0d42`=3.7、`0d55`=3.8、`0d61`=3.9、`0d6f`=3.10、`0da7`=3.11、`0dcb`=3.12
     - 3.13+：不写死数值，按本机 MAGIC_NUMBER 换算（`python3 -c "import importlib.util; print(hex(int.from_bytes(importlib.util.MAGIC_NUMBER[:2],'little')))"`）
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
- **混淆样本整体是"加密数据 + 引导壳 + 原生解密组件"三件套**：现象——静态看只有一处引导调用和一段加密字节串常量，找不到正常 pyc，函数字节码在内存里也长期保持密文；原因——整份程序以 marshal 流形态加密后作为一个字节串常量整体内嵌进引导调用，解密密钥由随样本交付的原生扩展内部静态数据派生（密钥材料与配方随构建变化），单个函数执行前才原位解密、返回后立即原位重加密，明文存在的窗口被压到极短；函数常量表还被注入负责进入/离开/完整性校验的原生桩对象，文件里只剩标记字符串，真实对象只能运行期生成；对策——把样本拆成三件套分别处理，函数级明文要么静态还原加解密流程、要么在运行期解密窗口内抓取；注意解密后的函数体仍是普通 CPython 字节码，不存在自定义字节码虚拟机——看起来像 VM 的花哨字节只是加密后的标准字节码
- **密钥材料定位用"盐锚点 + 相对偏移"，别硬编码绝对地址**：现象——换一个构建版本的样本，旧的密钥定位脚本全部失效；原因——密钥由多段静态数据拼接后取摘要派生（典型拼段含盐、内嵌公钥、签名许可证描述哈希、一段需先还原的掩码数据），掩码区域靠固定长度区域与重复字节 pad 做 XOR 还原，而文件中的对齐填充同样表现为连续相同字节，全零候选一旦被当 pad 就派生错误密钥；参与拼接的输入还受条件分支控制（外部密钥文件、试用/正式开关）；对策——在原生扩展的原始字节中先搜可见盐锚点字符串，其余密钥材料一律以锚点位置为基准按相对偏移计算，同一套代码可跨多个构建复用；自动找 pad 时排除全零候选；按标志位判断启用哪些输入；静态还原不必让启动期完整性校验（如公钥验签）通过，从分支逻辑复现出密钥派生的输入拼接方式即可
- **解密产物是标准 marshal 流，但重建 CodeType 有格式怪癖**：现象——按常规 .pyc 流程解析解密出的字节流时字段错位、常量错乱，个别 Python 版本上还会直接崩溃且异常不可捕获；原因——序列化时常量元组声明的长度可能小于实际写入个数（多余条目无头部直接跟在后），流里还可能出现私有类型字节区间，代表只能由运行时在内存中生成的原生对象（静态读不到本体，占位符不剔除会导致后续常量索引错位），密文字节码直接进反汇编或 CodeType 构造在部分版本上会崩解释器；对策——用一次性模板代码编译后 .replace() 构造 CodeType 而非直接调构造器（构造器参数顺序随版本变化），本地变量数显式传入；原生对象以占位符表示并在构造前剔除；单条记录解析失败时保留已读字段（字节码与常量靠前、通常已拿到），整体降级为逐个报告完整解析的 code 对象而非全盘失败；解密失败用模板占位字节码顶替，密文仅十六进制展示；3.11 起 code 对象布局变化，从 blob 头读目标版本并自动切到匹配版本解释器，不为每个版本各写一套解析规则
- **动态取明文要卡"进入桩解密后"的窗口，导入方式也有讲究**：现象——运行时 hook 后抓不到明文，或回调内部崩溃；原因——受保护函数每次调用都经进入桩解密、执行、离开桩重加密三步，明文窗口极短（短函数可能立即离开），事后读取拿不到；进入桩对外是 Python 可调用对象（内建函数对象形态），可从模块常量表辨认，真实原生函数指针藏在 C 函数对象的元数据结构里、经内存布局偏移可读出；首轮导入时回调内部再触发同一钩子会嵌套破坏回调链；以 __main__ 方式运行会走另一条运行时路径、绕过发现机制；对策——拦截模块首次解密后执行的那次调用，从传入 code 对象的常量中读出进入桩指针；首轮导入返回空指针中止、重启一轮等内联钩子就位，后续执行用具名模块方式导入；定位导入槽在数据段内扫描已解析的真实函数地址指针，而不是扫调用点（调用点引用的是槽地址，直接扫容易错）
- **混淆器内部格式不是文档化兼容接口，结论必须标注版本**：现象——同一套还原脚本换版本就失效，且说不清坏在哪一步；原因——密钥派生输入、嵌入标记位置、blob 头、函数级描述符、原生入口、marshal 重建行为都可能随版本变化，工具与目标解释器版本也强绑定（code 对象/marshal 布局随版本变）；对策——任何结论标注精确版本，跨版本复用工具不假设可用；对每个新版本逐项重验（密钥配方、标记位置、头部结构、描述符、入口函数、重建行为），未经真实样本验证的分支显式标注未实测；静态重建与动态捕获（运行期真实解密产物）逐字段对照互相验证——动态能暴露静态推断的格式错误（如把原生对象误当普通常量、元组声明长度偏差），静态补足动态够不到的死路径（未调用函数、未触达分支）；试用/正式、有无外部密钥文件等形态差异按标志位与分支逻辑处理，不假设单一形态
