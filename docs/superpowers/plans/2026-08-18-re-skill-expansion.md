# rev-skills 能力新增 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增 2 个原子技能（re-python / re-frida-script-author）+ 3 处并入（Keystore 审计 / Flutter channel / svc 检测），技能总数 89 → 91。

**Architecture:** 纯技能文档扩展。2 个新技能目录（SKILL.md，按 docs/skill-template.md 原子技能规范）+ 3 处现有技能/契约文件补章节 + 计数同步（README/AGENTS/marketplace.json）。校验靠 validate.mjs（npm test）。

**Tech Stack:** Markdown / YAML frontmatter / validate.mjs（Node，现有）

## Global Constraints

- **红线 1 呈现中性**：禁用「最推荐」「强烈建议」等最高级强推措辞
- **红线 2 隐私脱敏**：内容不指向具体项目/公司/产品；示例泛化（「某移动应用」等）
- **不绑定具体工具**：方法为核心，工具为可替换示例；「工具准备」按模板给跨 OS 安装命令
- validate.mjs：frontmatter `name`=目录名、`description` 非空、`type: atomic` 必含「## 工具准备」、`[[链接]]` 必须解析（技能目录或 references/*.md）
- 工作区有 3 个未提交修改（re-binary-core / re-mobile / re-protocol 的 SKILL.md）——**各任务 commit 只 `git add` 本任务列出的文件，严禁 `git add -A`**；本计划不涉及这 3 个文件
- 当前分支 `main`；提交信息按仓库惯例（feat:/增强:/docs:）
- 新技能创建后 `npm test` 预期输出 `OK: 91 skills validated`

---

### Task 1: 创建 re-python 技能

**Files:**
- Create: `.claude/skills/re-python/SKILL.md`

**Interfaces:**
- Consumes: 无（新目录）
- Produces: 技能目录 `re-python`（validate 的 knownSkills 新增，供 Task 3 的 [[re-python]] 链接解析；计数 89 → 90）

- [ ] **Step 1: 创建目录与 SKILL.md**

```bash
mkdir -p .claude/skills/re-python
```

写入 `.claude/skills/re-python/SKILL.md`：

````markdown
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
````

- [ ] **Step 2: 结构校验**

Run: `npm test`
Expected: `OK: 91 skills validated`（re-python 计入；[[链接]] 全部指向已存在技能）

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/re-python/SKILL.md
git commit -m "feat: re-python 技能——PyInstaller/PyArmor 解包与 pyc 识别"
```

---

### Task 2: 创建 re-frida-script-author 技能

**Files:**
- Create: `.claude/skills/re-frida-script-author/SKILL.md`

**Interfaces:**
- Consumes: 无（新目录）
- Produces: 技能目录 `re-frida-script-author`（供 Task 3 的 [[re-frida-script-author]] 链接解析；计数 90 → 91）；引用 [[frida-scripts]]（re-frida 的 references，已存在）

- [ ] **Step 1: 创建目录与 SKILL.md**

```bash
mkdir -p .claude/skills/re-frida-script-author
```

写入 `.claude/skills/re-frida-script-author/SKILL.md`：

````markdown
---
name: re-frida-script-author
type: atomic
description: >
  Frida 脚本生成方法论：目标特征 → 模板选择 → 改写 → 验证。独立于执行插桩（re-frida）。
  触发词：生成Frida脚本、写hook脚本、frida脚本怎么写、写个hook、脚本生成。
---

# Frida 脚本生成

## 何时使用 / 何时不用

- 用：需要新脚本时——拦截（加密/网络/文件）、绕过（检测/固定）、追踪（JNI/方法调用）
- 不用：执行现成脚本 → 转 [[re-frida]]；反检测对抗面分析 → [[anti-dynamic-workflow]]

## 工具准备

### frida-tools（脚本编写与运行验证）

- Linux: `pip install frida-tools`（或 `apt install frida-tools` / `pacman -S frida`）
- macOS: `pip install frida-tools` / `brew install frida`
- Windows: `pip install frida-tools` / `choco install frida`
- 验证: `frida --version`、`frida-ps -U`（连设备后）

### python3（配合脚本调试）

- 各平台同 [[re-python]] 工具准备

### 目标设备/模拟器

- Android 真机/模拟器 + frida-server（安装见 [[re-frida]] 工具准备）；桌面目标直接本机

## 操作步骤

按「探 → 选 → 改 → 验」四步，先探后写，不猜：

1. **目标侦察**：
   - 静态：目标包名/类名/关键 API（[[re-apk]] jadx 输出）、加固商特征（[[re-mobile-pack]]）、Flutter/RN 混合结构（[[re-hybrid-app]]）
   - 动态基线：原样跑一次抓崩溃（崩溃特征 → 保护机制对照，见 [[anti-dynamic-workflow]]）
   - 产出：目标特征清单（检测点/目标 API/输入输出形态）

2. **模板选择**：按特征清单对照 [[frida-scripts]] 模板表：

| 目标特征 | 模板 |
|---|---|
| HTTPS 抓包被 TLS 加密（BoringSSL） | TLS 密钥日志（SSLKEYLOGFILE） |
| 证书固定挡抓包 | SSL 固定绕过（TrustManager/CertificatePinner） |
| 加密算法/密钥要提取 | 加密拦截（Cipher/SecretKeySpec 全 overload） |
| 加固/运行时解密 | DEX dump（类加载点）/ SO dump |
| 双向 TLS 客户端证书 | keystore p12 导出 |
| JNI 动态注册要还原 | RegisterNatives + 汇聚点双 hook |
| 反调试/检测拦截 | 检测绕过表（root/属性/文件/命令） |

3. **改写**：
   - 替换占位符：包名/类名/方法名（精确匹配，Java 全限定名）
   - overload 精确匹配：目标方法多 overload 时逐一定义或按参数类型选
   - 保存 original 引用、带原 `this` 调用；输出 JSON（可打印 ASCII + hex 双格式）
   - 同一类多 hook 合并进一个 `.implementation`（缓存静默覆盖）

4. **验证**：
   ```sh
   frida -U -f <pkg> -l script.js --pause   # spawn + 停在早期代码前
   ```
   - 输出 JSON 可解析、目标行为符合预期（拦截到目标调用/绕过生效）
   - 失败 → 回步骤 2 重选模板或细化特征；崩溃 → 按 [[anti-dynamic-workflow]] 崩溃对照表定位

## 跨域联合

- [[re-frida]]：脚本执行（本技能产出 → re-frida 运行）
- [[re-mobile]] / [[re-android-native]]：移动目标场景衔接
- [[anti-dynamic-workflow]]：检测面与崩溃迭代法
- [[frida-scripts]]：模板素材库（re-frida references）
- [[analysis-contract]]：脚本输出按数据契约消费（证据存档）

## 常见坑与陷阱

- **overload 不匹配静默失效**：现象——hook 无输出；原因——目标方法 overload 签名与定义不符；对策——先 `Java.use(...).<method>.overloads` 列出全部重载再选
- **Java.use 缓存覆盖**：现象——多个 hook 只生效最后一个；原因——同类多次 `.implementation` 赋值静默覆盖；对策——合并进一个 hook
- **参数索引版本相关**：现象——native 参数读错；原因——目标版本字段/参数位次变化；对策——对照目标符号核实，不照搬经验值
- **不侦察就写脚本**：现象——脚本对不上目标；原因——跳过步骤 1；对策——先探后写
- **绕过类脚本只观察不持久化**：现象——测试后目标状态被改；原因——脚本含写操作；对策——脚本只做读取/日志，绕过仅用于观察

## 使用注意

- 全部在沙箱内执行（[[platform-tips]] 最高原则）
- 输出 JSON 供 [[analysis-contract]] 数据契约消费
````

- [ ] **Step 2: 结构校验**

Run: `npm test`
Expected: `OK: 91 skills validated`（[[frida-scripts]] / [[anti-dynamic-workflow]] 等链接全部解析）

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/re-frida-script-author/SKILL.md
git commit -m "feat: re-frida-script-author 技能——目标特征到 Frida 脚本的生成方法论"
```

---

### Task 3: 网关挂载（re-managed / re-frida）

**Files:**
- Modify: `.claude/skills/re-managed/SKILL.md`（选择树加 re-python 分支）
- Modify: `.claude/skills/re-frida/SKILL.md`（跨域联合加 re-frida-script-author 引用）

**Interfaces:**
- Consumes: Task 1 的 `re-python`、Task 2 的 `re-frida-script-author`（链接可解析）
- Produces: 两个新技能在网关层的可达性

- [ ] **Step 1: re-managed 选择树加分支**

在 `.claude/skills/re-managed/SKILL.md` 的 `.ps1 / .docm ...（脚本或宏）` 分支行之后插入：

```markdown
- **Python 打包样本（.exe 含 PyInstaller/PyArmor 特征 / .pyc / python 打包）** → [[re-python]]（pyinstxtractor 解包、PyArmor-Unpacker、pyc 反编译；纯脚本混淆转 [[re-script-deob]]）
```

- [ ] **Step 2: re-frida 跨域联合加引用**

在 `.claude/skills/re-frida/SKILL.md` 的「## 跨域联合」节追加一行：

```markdown
- 脚本生成：目标特征 → 模板选择 → 改写验证 → [[re-frida-script-author]]（模板素材 [[frida-scripts]]）
```

- [ ] **Step 3: 结构校验**

Run: `npm test`
Expected: `OK: 91 skills validated`，无 FAIL

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/re-managed/SKILL.md .claude/skills/re-frida/SKILL.md
git commit -m "增强: re-managed/re-frida 挂载 re-python 与 re-frida-script-author"
```

---

### Task 4: Keystore 审计 + Flutter channel 并入

**Files:**
- Modify: `.claude/skills/re-android-native/SKILL.md`（加「## Keystore 审计」章节）
- Modify: `.claude/skills/re-hybrid-app/SKILL.md`（加「## Flutter MethodChannel 动态拦截」章节）

**Interfaces:**
- Consumes: 无（纯章节新增）
- Produces: 两技能的动态分析能力补全；引用 [[re-frida]] / [[anti-dynamic-workflow]] / [[analysis-contract]]（均已存在）

- [ ] **Step 1: re-android-native 加 Keystore 审计章节**

在 `.claude/skills/re-android-native/SKILL.md` 的「## 跨域联合」标题之前插入：

```markdown
## Keystore 审计

Android 密钥体系分析——目标密钥来自 AndroidKeyStore 时 `getEncoded()` 不可用（硬件背书），须走审计：

- **遍历**：`KeyStore.getInstance("AndroidKeyStore")` → `aliases()` 枚举全部条目
- **条目属性**：算法（AES/RSA/EC）、用途（encrypt/decrypt/sign/verify）、来源（`KeyInfo.isInsideSecureHardware`——TEE 与 StrongBox 区分）
- **生物绑定**：`setUserAuthenticationRequired` 的密钥在认证失败时不可用（绕过与检测见 [[anti-dynamic-workflow]]）
- **与 hook 衔接**：加密拦截（[[re-frida]] 的 [[frida-scripts]]）时密钥来自 Keystore → 记录别名与用途，不记录密钥字节
```

- [ ] **Step 2: re-hybrid-app 加 Flutter channel 章节**

在 `.claude/skills/re-hybrid-app/SKILL.md` 的「## 跨域联合」标题之前插入：

```markdown
## Flutter MethodChannel 动态拦截

Flutter 平台通道（PlatformChannel）是 Dart ↔ native 通信主干，拦截可观察全部原生能力调用：

- **Java/Kotlin 侧**：hook `io.flutter.plugin.common.MethodChannel` 的 MethodCallHandler——记录 channel 名 / 方法名 / 参数 JSON
- **engine messenger 层**：`io.flutter.embedding.engine.FlutterEngine` 的 messenger 消息（低层兜底）
- **与 Dart 侧静态观察互补**：静态找 channel 名与调用点（字符串字面量），动态确认实际流量
- **输出**：结构化 JSON（channel / method / args），供 [[analysis-contract]] 数据契约消费（证据存档）
```

- [ ] **Step 3: 结构校验**

Run: `npm test`
Expected: `OK: 91 skills validated`，无 FAIL

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/re-android-native/SKILL.md .claude/skills/re-hybrid-app/SKILL.md
git commit -m "增强: Keystore 审计（re-android-native）+ Flutter MethodChannel 拦截（re-hybrid-app）"
```

---

### Task 5: svc 裸系统调用检测并入 anti-dynamic-workflow

**Files:**
- Modify: `.claude/skills/re-analyze/references/anti-dynamic-workflow.md`（追加「### 裸系统调用检测」节）

**Interfaces:**
- Consumes: 无
- Produces: 通用对抗工作流的检测面补全（[[anti-dynamic-workflow]] 已是全库引用目标）

- [ ] **Step 1: 追加章节**

在 `.claude/skills/re-analyze/references/anti-dynamic-workflow.md` 的「## 高频检测面清单」节之后、`## 实现教训` 节之前插入：

```markdown
## 裸系统调用检测

目标自实现系统调用（绕过 libc）时，基于 libc 符号的 hook 与检测全部失效——svc 指令级捕获：

- **架构分支**：arm64 SYS_OPEN=56、svc 机器码 `01 00 00 D4`；arm SYS_OPEN=5、`00 00 00 EF`
- **手法**：遍历可执行段（r-x）过滤 .so → 特征码扫描命中 → 回读 svc 前一条指令取系统调用号（arm64 读 `mov x8` 立即数位、arm 读 r7）→ 系统调用号等于目标（如 SYS_OPEN）才 attach → 打印文件名与返回值
- **注意**：arm64 参数索引按系统调用约定核对（open 路径参数在 x0，不照搬经验值）；系统调用号表按目标内核/Android 版本核对
```

- [ ] **Step 2: 结构校验**

Run: `npm test`
Expected: `OK: 91 skills validated`，无 FAIL

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/re-analyze/references/anti-dynamic-workflow.md
git commit -m "增强: 裸系统调用检测（svc 指令级）并入通用动态对抗工作流"
```

---

### Task 6: 计数同步（README / AGENTS / marketplace）

**Files:**
- Modify: `README.md`（技能导航 89→91、「12 大类网关 → 76 原子技能」→78、re-managed 行加 re-python、re-mobile 行加 re-frida-script-author）
- Modify: `AGENTS.md`（「（89 个技能）」→「（91 个技能）」）
- Modify: `.claude-plugin/marketplace.json`（description「89 个技能」→「91 个技能」）

**Interfaces:**
- Consumes: Task 1/2 的技能目录（计数 89 → 91）
- Produces: 文档一致性（validate.mjs 不校验这三文件，人工 grep 验证）

- [ ] **Step 1: README.md 三处修改**

`README.md`：
- `## 技能导航（89）` → `## 技能导航（91）`
- `入口 → 12 大类网关 → 76 原子技能` → `入口 → 12 大类网关 → 78 原子技能`
- `- **re-managed**：re-dotnet、re-java、re-script-deob、re-wasm、re-ai-model、re-blockchain` → `- **re-managed**：re-dotnet、re-java、re-script-deob、re-wasm、re-ai-model、re-blockchain、re-python`
- `- **re-mobile**：re-apk、re-ios、re-frida、re-mobile-pack、re-hybrid-app、re-android-native、re-ios-jb` → `- **re-mobile**：re-apk、re-ios、re-frida、re-frida-script-author、re-mobile-pack、re-hybrid-app、re-android-native、re-ios-jb`

- [ ] **Step 2: AGENTS.md / marketplace.json 修改**

`AGENTS.md` 第 3 行：`（89 个技能）` → `（91 个技能）`

`.claude-plugin/marketplace.json` 第 6 行：`"description": "通用逆向工程技能库：89 个技能（...）"` 中 `89` → `91`

- [ ] **Step 3: 校验**

Run: `npm test`
Expected: `OK: 91 skills validated`

Run: `grep -c "re-python\|re-frida-script-author" README.md`
Expected: ≥ 2

- [ ] **Step 4: Commit**

```bash
git add README.md AGENTS.md .claude-plugin/marketplace.json
git commit -m "docs: 计数同步 89→91（re-python / re-frida-script-author 入导航）"
```
