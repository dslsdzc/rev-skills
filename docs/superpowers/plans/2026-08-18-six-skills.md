# 6 个单开技能 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增 6 个原子技能（re-cpp-abi / re-macos / re-attribution / re-hw-chip / re-ai-attack / re-sdr）+ 挂载同步，技能总数 91 → 97。

**Architecture:** 纯技能文档扩展。6 个新技能目录（SKILL.md，按 docs/skill-template.md 原子技能规范）+ 挂载（re-binary-core / re-forensics 网关、rerouting A 表 RTTI 行、4 处跨域引用）+ 计数同步（README / AGENTS / marketplace）。

**Tech Stack:** Markdown / YAML frontmatter / validate.mjs（npm test，现有）

## Global Constraints

- **红线 1 呈现中性**：禁用「最推荐」「强烈建议」等最高级强推措辞
- **红线 2 隐私脱敏**：内容不指向具体项目/公司/产品（归因技能只写方法不写真实案例）
- **不绑定具体工具**：方法为核心，工具为可替换示例；「工具准备」按模板给跨 OS 安装命令（硬件类技能给选购指引）
- validate.mjs：frontmatter `name`=目录名、`description` 非空、`type: atomic` 必含「## 工具准备」、`[[链接]]` 必须解析
- 工作区有 4 个未提交修改（re-binary-core / re-mobile / re-protocol 的 SKILL.md、README.md）——各任务 commit 只 add 本任务列出的文件
- **re-binary-core/SKILL.md 有用户未提交改动**：Task 7 对该文件只做工作区修改、**不 git add 提交该文件**（挂载行与用户改动共存于工作区，由用户一并提交）
- 新技能创建后 `npm test` 预期输出按任务标注（92 → 97 递增）

---

### Task 1: 创建 re-cpp-abi 技能

**Files:**
- Create: `.claude/skills/re-cpp-abi/SKILL.md`

**Interfaces:**
- Consumes: 无（新目录）
- Produces: 技能目录 `re-cpp-abi`（供 Task 7 的 [[re-cpp-abi]] 链接解析；计数 91 → 92）

- [ ] **Step 1: 创建目录与 SKILL.md**

```bash
mkdir -p .claude/skills/re-cpp-abi
```

写入 `.claude/skills/re-cpp-abi/SKILL.md`：

````markdown
---
name: re-cpp-abi
type: atomic
description: >
  现代 C++ 二进制逆向：RTTI/异常/虚表恢复、ABI 识别、mangling 解码。
  触发词：C++逆向、RTTI、虚表恢复、异常处理、C++ ABI、mangling、C++反编译。
---

# 现代 C++ 逆向（RTTI / 异常 / 虚表）

## 何时使用 / 何时不用

- 用：RTTI/异常表密集的二进制、反编译结果混乱的 C++ 目标（类层次/虚调用/异常流无法直接读出）
- 不用：C 代码或纯汇编（走 [[re-binary-core]] 通用路径）；混淆主导的目标（先 [[re-deobfuscate]]）

## 工具准备

### readelf / llvm-objdump（节表与异常表）

- Linux: `apt install binutils llvm` / `dnf install binutils llvm` / `pacman -S binutils llvm`
- macOS: `brew install llvm`（binutils 部分 macOS 自带）
- Windows: WSL 或 llvm 预编译
- 验证: `readelf --version`、`llvm-objdump --version`

### c++filt / undname（mangling 解码）

- Linux/macOS: `c++filt`（binutils 自带）；Windows: `undname`（VS 工具链）
- 验证: `echo '_ZN3foo3barEv' | c++filt`（输出 `foo::bar()`）

### Ghidra / IDA（反编译底座，脚本化 RTTI 遍历）

- 安装与验证见 [[re-ghidra]] / [[re-ida]] 工具准备

### gdb（异常断点，可选）

- 安装与验证见 [[re-gdb]]

## 操作步骤

按顺序执行，每步产物存档（路径 + sha256，见 [[re-triage]]）。

1. **ABI 识别**：
   ```sh
   readelf -s sample | grep -E '_ZN|_ZTV|_ZTI' | head    # Itanium（GCC/Clang）
   strings sample | grep -E '^\?\?_' | head              # MSVC
   ```
   - Itanium 特征：`_ZN`（函数）、`_ZTV`（虚表）、`_ZTI`（RTTI 类型信息）
   - MSVC 特征：`??_7`（vftable）、`??_R`（RTTI）
   - 识别错则后续全部偏——先确认再继续

2. **RTTI 重建（Itanium）**：
   ```sh
   readelf -s sample | grep _ZTI | head
   # _ZTI<类名> 指向 typeinfo；typeinfo+8 处 _ZTVN10__cxxabiv1... 链到 vtable 前缀
   ```
   - 结构：`typeinfo` → `__class_type_info` 派生链 → 每个类的完整继承路径
   - 脚本化：Ghidra/IDA 遍历 _ZTI 引用，重建类继承图（父子关系表）
   - 产出：类名 → 继承链映射（写入会话 symbols_known，见 [[analysis-contract]]）

3. **虚表恢复**：
   ```sh
   readelf -s sample | grep _ZTV | head
   ```
   - `_ZTV<类名>` 指向 vtable 起点（虚函数指针数组）；`offset to top` + `typeinfo ptr` 位于 vtable 前 8 字节（Itanium ABI）
   - 定位 vtable 后：每个槽位的函数地址 → 调用点反推虚方法名（结合步骤 2 的继承图）
   - 虚调用（`call *reg`）无法静态定名 → 用调用点上下文（参数/返回值使用）缩小候选

4. **异常处理表**：
   ```sh
   readelf -S sample | grep -E 'pdata|xdata'    # PE：.pdata/.xdata
   readelf -S sample | grep -E 'eh_frame|gcc_except'   # ELF：.eh_frame
   ```
   - PE：`.pdata` 的 RUNTIME_FUNCTION（Begin/End/UnwindInfo）→ `.xdata` 展开数据 → 异常处理器（__CxxFrameHandler3）
   - ELF：`.eh_frame` 的 FDE/CIE → 展开规则与 LSDA（.gcc_except_table）→ 异常处理函数
   - 用途：恢复被异常路径打断的控制流、定位析构/清理逻辑（catch 块）

5. **模板/lambda 识别**：
   - 模板：符号含 `<...>` 参数（Itanium mangling 中展开为长串）；实例化爆炸时按调用模式聚类
   - lambda：Itanium 中 `_ZZ<作用域>ENK...` 特征、MSVC 中 `<lambda_...>`；lambda 局部类**无 RTTI**（步骤 2 缺失时反推）
   - 输出：疑似模板实例化/lambda 的函数清单 + 调用点

6. **mangling 解码（批量）**：
   ```sh
   readelf -s sample | grep -E '_ZN|_ZTV|_ZTI' | awk '{print $8}' | c++filt | head -20
   ```
   - MSVC: `undname` 或在线等价工具
   - 解码结果写入符号表（供 [[re-ghidra]] / [[re-ida]] 重命名）

## 跨域联合

- [[re-binary-core]] 网关：本技能归属（选择树「现代 C++」分支待加）
- [[re-ghidra]] / [[re-ida]]：反编译底座与脚本化
- [[re-deobfuscate]]：混淆与 ABI 分析衔接
- [[analysis-contract]]：类继承图/符号表按数据契约传递
- [[rerouting]]：RTTI/异常表特征触发本技能（A 表已挂）

## 常见坑与陷阱

- **ABI 误判导致全部解析失败**：现象——用 Itanium 结构解析 MSVC 目标（或反之）全盘错位；原因——识别步骤跳过；对策——先做步骤 1，mangling 特征双查
- **模板展开导致符号爆炸**：现象——readelf 输出几万行 `_Z...`；原因——模板实例化；对策——按调用模式聚类、过滤标准库符号（libstdc++/STL 前缀）
- **lambda 无 RTTI**：现象——类继承图缺节点；原因——lambda 局部类不生成 typeinfo；对策——按 `_ZZ` mangling 特征与调用点识别，不硬找 RTTI
- **异常表版本差异**：现象——.xdata 解析错位；原因——MSVC 异常处理版本（__CxxFrameHandler3 等）不同；对策——按导入函数（__CxxFrameHandler）确认版本再解析
- **虚调用无法静态定名**：现象——`call *reg` 全是间接调用；原因——虚分派；对策——结合 vtable 槽位与调用点证据缩小候选，不猜
````

- [ ] **Step 2: 结构校验**

Run: `npm test`
Expected: `OK: 92 skills validated`（re-cpp-abi 计入；[[链接]] 全部指向已存在技能：re-binary-core/re-deobfuscate/re-ghidra/re-ida/analysis-contract/rerouting/re-triage/re-gdb 均存在）

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/re-cpp-abi/SKILL.md
git commit -m "feat: re-cpp-abi 技能——RTTI/异常/虚表恢复与 ABI 识别"
```

---

### Task 2: 创建 re-macos 技能

**Files:**
- Create: `.claude/skills/re-macos/SKILL.md`

**Interfaces:**
- Consumes: 无（新目录）
- Produces: 技能目录 `re-macos`（供 Task 7 的 [[re-macos]] 链接解析；计数 92 → 93）

- [ ] **Step 1: 创建目录与 SKILL.md**

```bash
mkdir -p .claude/skills/re-macos
```

写入 `.claude/skills/re-macos/SKILL.md`：

````markdown
---
name: re-macos
type: atomic
description: >
  macOS 原生应用逆向：App Bundle/签名公证、entitlements、沙箱与 TCC、钥匙串与 Secure Enclave。
  触发词：macOS逆向、mac app、entitlements、Secure Enclave、钥匙串、TCC、codesign、公证。
---

# macOS 应用逆向

## 何时使用 / 何时不用

- 用：macOS 原生/闭源应用（.app/.dylib/.framework）、带签名公证与沙箱的目标、钥匙串/Secure Enclave 硬件密钥场景
- 不用：iOS 应用（转 [[re-ios]]）；纯 Mach-O 格式解析（转 [[re-format-macho]]）

## 工具准备

### codesign / spctl / otool / lipo（签名与 Mach-O 工具，macOS 内置）

- macOS: 系统自带（Xcode 命令行工具 `xcode-select --install`）
- Linux: 可静态分析 Mach-O（`llvm-otool`，`brew install llvm` 或发行版 llvm 包）
- 验证: `codesign --version`、`otool --version`

### Hopper / IDA / Ghidra（反编译底座）

- 安装与验证见 [[re-ida]] / [[re-ghidra]]

### lldb（动态调试）

- 安装与验证见 [[re-lldb]]

## 操作步骤

按顺序执行，每步产物存档（路径 + sha256，见 [[re-triage]]）。

1. **包结构与签名检查**：
   ```sh
   file Sample.app/Contents/MacOS/Sample
   codesign -dv Sample.app 2>&1 | head            # 签名者/Team ID/要求
   spctl -a -vv Sample.app 2>&1                   # 公证状态（Gatekeeper）
   defaults read Sample.app/Contents/Info.plist   # Info.plist 关键键
   ```
   - 关注：签名者（Apple 开发者/分发证书）、Team ID、Hardened Runtime（runtime 标志）、Info.plist 的 CFBundleIdentifier/版本

2. **entitlements 与沙箱**：
   ```sh
   codesign -d --entitlements :- Sample.app 2>&1 | head -30
   ```
   - 关键键：`com.apple.security.app-sandbox`（沙箱开启）、`com.apple.security.network.client/server`、`com.apple.security.files.user-selected.*`、`com.apple.security.device.*`（摄像头/麦克风）
   - 沙箱 profile 决定能力边界——分析授权逻辑时先看 entitlements 清单

3. **TCC 权限库**：
   ```sh
   # 用户级 TCC 库（授权记录）
   ls ~/Library/Application\ Support/com.apple.TCC/
   ```
   - TCC.db（SQLite）记录各 App 对隐私资源的授权；分析目标对 TCC 的依赖（它请求了什么权限、何时请求）
   - 注意：TCC 数据属系统隐私数据，只读分析不导出内容（红线 2）

4. **钥匙串与 Secure Enclave**：
   - 钥匙串条目类型（通用密码/互联网密码/密钥）与 ACL（`kSecAttrAccess` 可访问性类：非锁定/首次解锁/此设备）
   - Secure Enclave 密钥：`SecKeyCreateWithData` 带 `kSecAttrTokenIDSecureEnclave` —— 私钥**不可提取**（等价 Android Keystore 硬件背书，见 [[re-android-native]] Keystore 审计）
   - 分析：目标读哪些钥匙串条目（SecItemCopyMatching 调用点）、密钥是否 Secure Enclave 绑定（不可提取 → 记录用途而非字节）

5. **dyld 加载链**：
   ```sh
   otool -L Sample.app/Contents/MacOS/Sample | head    # LC_LOAD_DYLIB 依赖
   otool -l Sample.app/Contents/MacOS/Sample | grep -A4 LC_RPATH
   ```
   - 依赖清单与 RPATH → Dylib Hijacking 面（可写目录 + 缺失依赖）
   - 注入面：DYLD_INSERT_LIBRARIES（受 hardened runtime 限制——有 `com.apple.security.cs.allow-dyld-environment-variables` 才可注入）

6. **反调试与保护**：
   - taskgated/签名校验：改签名或注入触发校验失败的典型点
   - 对抗面分析：代码签名校验（`SecStaticCodeCheckValidity`）、调试器检测（`PT_DENY_ATTACH`）、反注入（`DYLD_INSERT_LIBRARIES` 检查）
   - 动态侧：[[re-lldb]] attach 前先处理 PT_DENY_ATTACH（ptrace 调用点 patch）

## 跨域联合

- [[re-format-macho]]：Mach-O 格式底座（LC_* 解析）
- [[re-ios]]：iOS 侧互补（越狱生态与 entitlements 差异）
- [[re-lldb]]：动态调试
- [[re-frida]]：动态插桩（macOS 桌面支持）
- [[analysis-contract]]：签名/entitlements 信息按数据契约传递

## 常见坑与陷阱

- **签名校验多处触发**：现象——patch 后运行即退；原因——加载/运行/更新多处校验；对策——逐点定位（步骤 6），先处理校验点再过逻辑
- **Secure Enclave 密钥不可提取**：现象——内存搜不到私钥；原因——硬件背书；对策——记录用途与 ACL，不找字节（见步骤 4）
- **TCC 权限导致功能缺失**：现象——目标功能灰掉；原因——TCC 未授权；对策——分析其请求逻辑而非绕过系统权限（红线）
- **公证检查离线不可复现**：现象——离线环境 spctl 结果异常；原因——公证需要网络查询；对策——用 codesign 的本地签名信息替代
- **hardened runtime 限制注入**：现象——DYLD_INSERT_LIBRARIES 无效；原因——runtime 标志未含 allow-dyld 环境变量；对策——静态分析路径（[[re-ghidra]]），不硬注入
````

- [ ] **Step 2: 结构校验**

Run: `npm test`
Expected: `OK: 93 skills validated`（[[链接]]：re-ios/re-format-macho/re-lldb/re-frida/re-android-native/analysis-contract/re-triage/re-ida/re-ghidra 均存在）

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/re-macos/SKILL.md
git commit -m "feat: re-macos 技能——签名公证/entitlements/钥匙串与 Secure Enclave"
```

---

### Task 3: 创建 re-attribution 技能

**Files:**
- Create: `.claude/skills/re-attribution/SKILL.md`

**Interfaces:**
- Consumes: 无（新目录）
- Produces: 技能目录 `re-attribution`（供 Task 7 的 [[re-attribution]] 链接解析；计数 93 → 94）

- [ ] **Step 1: 创建目录与 SKILL.md**

```bash
mkdir -p .claude/skills/re-attribution
```

写入 `.claude/skills/re-attribution/SKILL.md`：

````markdown
---
name: re-attribution
type: atomic
description: >
  威胁归因方法论：钻石模型、基础设施图谱、置信度分级与归因报告。
  触发词：归因、APT、attribution、攻击者身份、基础设施图谱、钻石模型、威胁组织。
---

# 威胁归因（APT Attribution）

## 何时使用 / 何时不用

- 用：情报归因请求（「谁干的」）、基础设施关联分析、样本/能力到攻击者的推理
- 不用：单个 IOC 查询（转 [[re-ti]]）；恶意行为判定（转 [[re-behavior]]）

## 工具准备

### 关联查询工具（Passive DNS / 证书透明 / Whois）

- 多平台: 命令行客户端 + 在线服务（查询类工具，给 API 使用指引）
- 验证: 任一查询工具可返回结果

### MISP（情报关联与共享）

- Linux: `apt install misp` 或 Docker 部署；验证: 实例可访问
- 轻量替代: 本地 CSV/图文件 + 脚本分析

### 图分析（基础设施关系）

- 多平台: `pip install networkx`（python 图分析）；验证: `python3 -c "import networkx"`

## 操作步骤

按顺序执行；全部内容脱敏处理（红线 2：不指向具体组织/受害者身份）。

1. **钻石模型定位**：
   - 四角：受害者（已明确）/ 基础设施（C2 域名/IP/证书）/ 能力（工具/样本/漏洞利用）/ 对手（待推断）
   - 产出：四角已知信息表 + 缺失角（归因目标）
   - 规则：只有两角以上才能开始推理；单角（仅样本）不支撑归因声明

2. **基础设施图谱**：
   ```sh
   # 域名/IP/证书关联聚类（示例流程，工具可替换）
   # 1) 收集 C2 域名/IP → Whois 注册信息
   # 2) 证书透明日志查共用证书 → 关联其他域名
   # 3) 图分析（networkx）聚类：共享注册者/证书/NS 的节点合并
   ```
   - 聚类特征：同一注册者/注册邮箱、共用证书、共用 DNS 基础设施、IP 段归属
   - 跳板/托管商共存不能作为归属证据（见坑 1）

3. **能力与样本归因**：
   - 代码复用（样本间相似度：字符串/函数/资源）、TTP 对比（行为模式与已知活动对齐）、时间线（活动窗口对齐）
   - 唯一性特征优先：独特字符串/编译特征/语言习惯（比通用 TTP 更有区分度）
   - 产出：能力证据表（每条证据 → 支持/反对假设）

4. **置信度分级**：
   - 低：单类证据（仅基础设施或仅能力）
   - 中：两类独立证据交叉（如基础设施 + 能力）
   - 高：三类以上 + 时间线一致 + 无矛盾证据
   - 规则：无高置信度证据时声明「关联活动」而非「归属组织」；明确列出未解决的反证

5. **报告**：
   - 结构：结论（分级声明）→ 证据链（每角证据 + 来源）→ 置信度依据 → 反证与未决项 → 方法边界（哪些无法判定）
   - 脱敏：不公开受害者身份/真实组织名（用代号），不发表过度归因声明

## 跨域联合

- [[re-ti]]：情报输入（IOC 查询与背景）
- [[re-ioc]]：指标提取（域名/IP/哈希）
- [[re-behavior]]：行为证据（TTP 对齐）
- [[re-protocol]]：C2 协议分析（基础设施特征）
- [[re-feedback]]：归因案例经验沉淀（脱敏后）

## 常见坑与陷阱

- **基础设施重叠导致误归因**：现象——两活动共享 C2 基础设施被并为一组；原因——共用托管/被劫持基础设施；对策——区分「共享」与「控制」证据（注册信息 vs 仅托管）
- **跳板机 ≠ 归属**：现象——经第三方跳板的活动归到跳板所有者；原因——混淆路径；对策——只把「控制面证据」（注册/配置/唯一特征）算入归属
- **置信度虚高**：现象——单一独特性状（罕见字符串）即高置信度；原因——单证据强但无交叉验证；对策——按步骤 4 分级，单类证据最高「中」
- **脱敏红线**：现象——报告中出现真实受害者/组织身份；原因——复制原始情报未处理；对策——报告前逐项检查（红线 2 强制）
- **时间线证据不足**：现象——活动窗口无法对齐；原因——被动数据缺失；对策——标注时间线缺口，不强行对齐
````

- [ ] **Step 2: 结构校验**

Run: `npm test`
Expected: `OK: 94 skills validated`（[[链接]]：re-ti/re-ioc/re-behavior/re-protocol/re-feedback 均存在）

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/re-attribution/SKILL.md
git commit -m "feat: re-attribution 技能——钻石模型/基础设施图谱/置信度分级"
```

---

### Task 4: 创建 re-hw-chip 技能

**Files:**
- Create: `.claude/skills/re-hw-chip/SKILL.md`

**Interfaces:**
- Consumes: 无（新目录）
- Produces: 技能目录 `re-hw-chip`（供 Task 7 的 [[re-hw-chip]] 链接解析；计数 94 → 95）

- [ ] **Step 1: 创建目录与 SKILL.md**

```bash
mkdir -p .claude/skills/re-hw-chip
```

写入 `.claude/skills/re-hw-chip/SKILL.md`：

````markdown
---
name: re-hw-chip
type: atomic
description: >
  物理层硬件逆向：去封装、裸片分析、探针与 FIB、PCB 电路分析、硬件木马检测。
  触发词：芯片逆向、去封装、decapping、PCB、硬件木马、电路分析、裸片、FIB。
---

# 芯片/PCB 硬件逆向

## 何时使用 / 何时不用

- 用：物理芯片/板级分析（固件提取失败后的物理层）、芯片解密、硬件木马检测
- 不用：固件级分析（转 [[re-fw-extract]]）；接口提取（转 [[re-hardware-io]]）；无线信号（转 [[re-sdr]]）

## 工具准备

### 显微镜/探针台（观察与接触）

- 选购指引：体视显微镜（初检）→ 金相显微镜（裸片）；探针台按预算分级
- 验证: 无软件验证——以成像清晰度验收

### decapping 设备与耗材（去封装）

- 化学 decap：发烟硝酸/硫酸 + 加热台（防护：通风橱/护目镜）；激光 decap：专用激光器（高成本，外包可选）
- 验证: 无软件验证——以裸露程度验收

### 逻辑分析仪（信号提取）

- 多平台: Saleae 类（配套软件各平台可用）或开源方案（sigrok/PulseView：`pip install sigrok` 或发行版包）
- 验证: `pulseview --version`

### 热成像（功耗/时序异常，可选）

- 选购指引：按分辨率与测温范围选型；验证: 成像验收

## 操作步骤

按顺序执行；全程注意防护与破坏性风险（步骤 1 不可逆）。

1. **去封装（decapping）**：
   - 化学法：加热台预加热 → 滴加发烟硝酸溶解环氧 → 清洗（丙酮）→ 显微镜检查
   - 激光法：激光逐层烧蚀（精度高，成本高）
   - 风险控制：通风橱、防酸手套/护目镜、废弃液处理；先练习废片
   - 验收：金属层可见、无过度腐蚀（伤及晶圆）

2. **裸片分析**：
   - 显微成像（金相显微镜/电子显微镜）→ 金属层走线观察
   - ROM/熔丝提取：成像 → 位图还原（金属层/多晶硅层图案 → 二进制）
   - 产出：ROM 位图 → 数据（与 [[re-fw-extract]] 固件对照）

3. **探针与信号提取**：
   - 探针台接触测试点（总线/时钟/数据线）
   - FIB（聚焦离子束）：修改互连/暴露内部节点（高成本，外包）
   - 信号嗅探：逻辑分析仪挂总线（时序对照数据手册）
   - 注意：探针负载可能改变信号（见坑 2）

4. **PCB 电路分析**：
   - 走线还原（万用表导通/成像 → 网络表）
   - IC 标识识别（丝印 → 型号 → 数据手册 → 引脚功能）
   - JTAG/SWD 引脚定位（测试点/走线特征 → 调试接口枚举）

5. **硬件木马检测**：
   - 冗余逻辑特征（无功能路径的触发器/计数器）
   - 功耗/时序异常（热成像 + 电流曲线对照基线）
   - 触发条件分析（特定输入组合/温度/时间条件）

## 跨域联合

- [[re-hardware-io]]：接口提取衔接（JTAG/UART 是软件侧入口）
- [[re-fw-extract]]：固件侧对照（ROM 提取物与固件 dump 比对）
- [[re-sdr]]：无线侧（RF 接口）
- [[re-triage]]：提取物初勘

## 常见坑与陷阱

- **decap 不可逆**：现象——封装破坏后无法恢复；原因——物理破坏；对策——先存档固件（[[re-fw-extract]]）再做物理操作
- **探针负载改变信号**：现象——挂探针后时序异常；原因——容性负载；对策——高阻探针、记录挂载前后基线
- **FIB 高成本易毁**：现象——FIB 修改失败晶圆报废；原因——离子束损伤；对策——先成像规划、外包给专业服务
- **木马误报**：现象——正常冗余逻辑被当木马；原因——厂商设计含测试/修复逻辑；对策——对照数据手册与已知电路模式，低置信度不发布
- **安全防护缺失**：现象——化学 decap 事故；原因——未用通风橱/防护；对策——步骤 1 风险控制强制前置
````

- [ ] **Step 2: 结构校验**

Run: `npm test`
Expected: `OK: 95 skills validated`（[[链接]]：re-fw-extract/re-hardware-io/re-sdr/re-triage 均存在）

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/re-hw-chip/SKILL.md
git commit -m "feat: re-hw-chip 技能——去封装/裸片/探针/PCB/硬件木马"
```

---

### Task 5: 创建 re-ai-attack 技能

**Files:**
- Create: `.claude/skills/re-ai-attack/SKILL.md`

**Interfaces:**
- Consumes: 无（新目录）
- Produces: 技能目录 `re-ai-attack`（供 Task 7 的 [[re-ai-attack]] 链接解析；计数 95 → 96）

- [ ] **Step 1: 创建目录与 SKILL.md**

```bash
mkdir -p .claude/skills/re-ai-attack
```

写入 `.claude/skills/re-ai-attack/SKILL.md`：

````markdown
---
name: re-ai-attack
type: atomic
description: >
  AI 模型攻击与取证：模型提取攻击、指纹/水印检测、成员推断、对抗样本基础。
  触发词：模型提取、模型窃取、水印检测、模型指纹、成员推断、对抗样本、模型攻击。
---

# AI 模型攻击与取证

## 何时使用 / 何时不用

- 用：模型泄露/窃取取证、API 模型攻击评估（提取/指纹）、训练数据泄露判定
- 不用：模型文件格式解析与权重提取（转 [[re-ai-model]]）；模型训练/微调（非逆向）

## 工具准备

### python3（核心运行时）

- 各平台安装见 [[re-python]] 工具准备

### 模型库（torch / tensorflow，按目标格式选）

- 多平台: `pip install torch` / `pip install tensorflow`（按硬件可选 CPU 版）
- 验证: `python3 -c "import torch"`

### 查询接口客户端（API 目标）

- 多平台: `pip install requests`；验证: `python3 -c "import requests"`

## 操作步骤

按顺序执行；仅限授权评估场景（红线：不针对未授权目标）。

1. **模型提取攻击**：
   - 目标：通过 API 查询重建近似模型（蒸馏）
   - 步骤：
     1. 确认接口能力（返回 logits/概率 或仅标签？置信度可得性决定策略）
     2. 查询采样（输入分布覆盖：代表性输入 + 边界扰动）
     3. 蒸馏训练（以 API 输出为教师标签，学生模型拟合）
     4. 评估近似度（同输入集输出对比）
   - 仅标签时：降级为决策边界采样（输出分布重建受限——标注此局限）

2. **模型指纹/水印检测**：
   - 嵌入检测：输入扰动（特定噪声/触发器）→ 输出特征比对（水印触发行为）
   - 指纹提取：模型行为签名（代表性输入集输出向量）→ 与疑似副本比对
   - 窃取取证：嫌疑模型与受害者模型的指纹距离（阈值判定相似）
   - 产出：指纹向量 + 距离报告（置信度）

3. **成员推断**：
   - 目标：判定某样本是否在训练集中
   - 方法：过拟合特征（样本损失/置信度分布对比基线）、影子模型
   - 局限：只能给出统计判定（误报控制：阈值校准）

4. **对抗样本基础**：
   - 白盒：梯度扰动（FGSM/PGD 类方法）
   - 黑盒：查询/迁移扰动
   - 用途：鲁棒性评估与防御验证（非攻击部署）

## 跨域联合

- [[re-ai-model]]：格式/权重侧（提取物分析衔接）
- [[re-python]]：Python 工具链基础
- [[re-feedback]]：攻击案例经验沉淀（脱敏后）

## 常见坑与陷阱

- **查询预算限制**：现象——API 限流/计费中断；原因——高查询量；对策——预算内采样设计（先小批估计）
- **置信度不可得时降级**：现象——接口只返回标签；原因——服务端裁剪输出；对策——决策边界采样 + 标注局限，不硬造概率
- **水印被抹除**：现象——指纹比对失败；原因——嫌疑方做了剪枝/微调；对策——用鲁棒指纹（多触发器）并标注「可能被抹除」
- **成员推断误报**：现象——统计判定错误；原因——阈值偏差；对策——影子模型校准 + 报告置信区间
- **授权边界**：现象——对未授权 API 发起攻击测试；原因——范围未确认；对策——先确认授权（使用边界红线）
````

- [ ] **Step 2: 结构校验**

Run: `npm test`
Expected: `OK: 96 skills validated`（[[链接]]：re-ai-model/re-python/re-feedback 均存在）

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/re-ai-attack/SKILL.md
git commit -m "feat: re-ai-attack 技能——模型提取/指纹水印/成员推断"
```

---

### Task 6: 创建 re-sdr 技能

**Files:**
- Create: `.claude/skills/re-sdr/SKILL.md`

**Interfaces:**
- Consumes: 无（新目录）
- Produces: 技能目录 `re-sdr`（供 Task 7 的 [[re-sdr]] 链接解析；计数 96 → 97）

- [ ] **Step 1: 创建目录与 SKILL.md**

```bash
mkdir -p .claude/skills/re-sdr
```

写入 `.claude/skills/re-sdr/SKILL.md`：

````markdown
---
name: re-sdr
type: atomic
description: >
  射频逆向：信号采集、频谱分析、解调、帧同步与协议恢复、重放。
  触发词：SDR、射频、信号分析、解调、RTL-SDR、HackRF、无线协议、遥测。
---

# 射频信号逆向（SDR）

## 何时使用 / 何时不用

- 用：无线协议/遥控/遥测信号（IoT 无线、遥控器、遥测链路）、信号级协议恢复
- 不用：有线协议（转 [[re-protocol]]）；无线 IoT 协议已封装分析（转 [[re-iot-proto]]）

## 工具准备

### RTL-SDR / HackRF（接收硬件）

- 选购指引：RTL-SDR（接收，低成本入门）/ HackRF（收发，重放需要）
- 验证: 硬件插入后 `rtl_test` 或 `hackrf_info` 有输出

### GNU Radio（信号处理）

- Linux: `apt install gnuradio` / `pacman -S gnuradio`；macOS: `brew install gnuradio`
- Windows: 官方安装包
- 验证: `gnuradio-companion --version` 或 `grcc --version`

### inspectrum（频谱/时序可视化）

- Linux: `apt install inspectrum` 或源码编译；macOS: `brew install inspectrum`
- 验证: `inspectrum --version`

### Universal Radio Hacker (URH)（解调与帧恢复）

- 多平台: `pip install urh`
- 验证: `urh --version`

## 操作步骤

按顺序执行；仅限授权测试（红线：重放/交互需授权）。

1. **信号采集与频谱分析**：
   ```sh
   # 示例（工具可替换）：GNU Radio 或命令行采集
   rtl_sdr -f 433.9M -s 1M capture.iq
   ```
   - 先全频段扫（找活跃信号）→ 定中心频率与带宽 → 采集 IQ
   - 调制识别：频谱形状（FSK 双峰/PSK 平坦/AM 载波）

2. **解调**：
   - URH：加载 IQ → 自动/手动调制识别 → 解调出位流
   - GNU Radio：按识别结果搭解调链（AM/FM/PSK/QAM/FSK）
   - 产出：解调位流（0/1 序列）

3. **帧同步与协议恢复**：
   ```sh
   # URH 位流分析：preamble/同步字识别、编码反转（NRZ/Manchester）
   urh --decode
   ```
   - 找同步字（重复模式/固定前缀）→ 定帧边界 → 字段划分（地址/长度/载荷/CRC）
   - 多帧对照（重复发射）→ 不变字段=固定头、变化字段=数据/序号
   - 产出：帧结构表（字段偏移/长度/语义）

4. **重放与交互**（授权场景）：
   - HackRF 回放捕获帧（重放攻击验证——仅授权目标）
   - 交互式：改字段重发（滚动码/加密需先分析算法——转 [[re-crypto-*]]）

## 跨域联合

- [[re-iot-proto]]：无线 IoT 协议衔接（MQTT/CoAP 等封装层）
- [[re-protocol]]：帧结构状态机重建衔接
- [[re-crypto-id]] / [[re-crypto-decrypt]]：载荷加密分析
- [[re-feedback]]：信号案例经验沉淀（脱敏后）

## 常见坑与陷阱

- **频率偏移/采样率错误**：现象——解调全乱码；原因——中心频率偏、采样率不匹配；对策——先用已知信号（FM 广播）校准
- **调制误判**：现象——FSK 当 PSK 解；原因——频谱特征相似；对策——对照时域波形（inspectrum）再定
- **重放需授权**：现象——未授权重放触发设备动作；原因——越界操作；对策——红线：仅授权目标
- **编码反转漏看**：现象——位流全反；原因——NRZ/Manchester 未识别；对策——试反相与编码模式组合
- **捕获不完整**：现象——帧被截断；原因——带宽不够/触发时机；对策——加宽带宽、延长采集、按同步字触发
````

- [ ] **Step 2: 结构校验**

Run: `npm test`
Expected: `OK: 97 skills validated`（[[链接]]：re-iot-proto/re-protocol/re-crypto-id/re-crypto-decrypt/re-feedback 均存在）

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/re-sdr/SKILL.md
git commit -m "feat: re-sdr 技能——信号采集/解调/帧恢复/重放"
```

---

### Task 7: 挂载与计数同步

**Files:**
- Modify: `.claude/skills/re-analyze/references/rerouting.md`（A 表 RTTI 行）
- Modify: `.claude/skills/re-binary-core/SKILL.md`（子技能列表加 re-cpp-abi——**工作区修改，不提交该文件**）
- Modify: `.claude/skills/re-forensics/SKILL.md`（子技能列表加 re-attribution）
- Modify: `.claude/skills/re-ios/SKILL.md`（跨域联合加 [[re-macos]]）
- Modify: `.claude/skills/re-hardware-io/SKILL.md`（跨域联合加 [[re-hw-chip]]）
- Modify: `.claude/skills/re-ai-model/SKILL.md`（跨域联合加 [[re-ai-attack]]）
- Modify: `.claude/skills/re-iot-proto/SKILL.md`（跨域联合加 [[re-sdr]]）
- Modify: `README.md`（计数 91→97、78→84、导航 6 行——**注意：README 有用户未提交改动（安装方式重排），已在上轮随提交纳入；本任务 README 改动会叠加新计数，提交时含全部 README 改动**）
- Modify: `AGENTS.md`（91→97、78→84）
- Modify: `.claude-plugin/marketplace.json`（91→97）

**Interfaces:**
- Consumes: Task 1-6 的 6 个技能目录（链接可解析）
- Produces: 6 技能全库可达；计数 97 = 1 + 12 + 84

- [ ] **Step 1: rerouting.md RTTI 行更新**

`.claude/skills/re-analyze/references/rerouting.md` A 表 RTTI 行：

```
| RTTI/异常表（.pdata/.xdata）密集 | （re-cpp-abi 待建，先走 [[re-binary-core]]） |
```

改为：

```
| RTTI/异常表（.pdata/.xdata）密集 | [[re-cpp-abi]] |
```

- [ ] **Step 2: 网关与跨域挂载（6 处编辑）**

`.claude/skills/re-binary-core/SKILL.md` 子技能列表（含 re-anti-cheat 的那行）末尾追加 `、[[re-cpp-abi]]`（即 `re-anti-cheat、[[re-cpp-abi]]`——**本文件只做工作区修改，不 git add**）。

`.claude/skills/re-forensics/SKILL.md` 子技能列表末尾追加 `、[[re-attribution]]`。

`.claude/skills/re-ios/SKILL.md` 跨域联合节末尾追加一行：

```markdown
- 桌面 macOS 生态（签名/entitlements/Secure Enclave）→ [[re-macos]]
```

`.claude/skills/re-hardware-io/SKILL.md` 跨域联合节末尾追加一行：

```markdown
- 物理层芯片/PCB 分析（decap/裸片/木马检测）→ [[re-hw-chip]]
```

`.claude/skills/re-ai-model/SKILL.md` 跨域联合节末尾追加一行：

```markdown
- 模型攻击侧（提取/指纹水印/成员推断）→ [[re-ai-attack]]
```

`.claude/skills/re-iot-proto/SKILL.md` 跨域联合节末尾追加一行：

```markdown
- 射频信号级逆向（采集/解调/帧恢复）→ [[re-sdr]]
```

- [ ] **Step 3: 计数同步（3 文件）**

`README.md`：
- `## 技能导航（91）` → `## 技能导航（97）`
- `入口 → 12 大类网关 → 78 原子技能` → `入口 → 12 大类网关 → 84 原子技能`
- 第 5 行 `91 个逆向工程技能` → `97 个逆向工程技能`
- 导航列表：re-binary-core 行末尾加 `、re-cpp-abi`；re-forensics 行加 `、re-attribution`；新增两行：
  - `- **re-macos**：macOS 应用逆向（签名/entitlements/Secure Enclave）`
  - `- **re-hw-chip**：芯片/PCB 物理层（decap/裸片/木马检测）`
  - `- **re-ai-attack**：模型攻击（提取/指纹/成员推断）`
  - `- **re-sdr**：射频逆向（采集/解调/帧恢复）`
- 说明：README 已含用户安装方式重排改动（上轮随提交纳入），本次计数改动叠加后一并提交

`AGENTS.md`：
- `（91 个技能）` → `（97 个技能）`
- `原子技能（78）` → `原子技能（84）`

`.claude-plugin/marketplace.json`：
- `91 个技能` → `97 个技能`

- [ ] **Step 4: 校验**

Run: `npm test`
Expected: `OK: 97 skills validated`

Run: `grep -c "re-cpp-abi\|re-macos\|re-attribution\|re-hw-chip\|re-ai-attack\|re-sdr" README.md`
Expected: ≥ 6

- [ ] **Step 5: Commit（re-binary-core 除外）**

```bash
git add .claude/skills/re-analyze/references/rerouting.md .claude/skills/re-forensics/SKILL.md .claude/skills/re-ios/SKILL.md .claude/skills/re-hardware-io/SKILL.md .claude/skills/re-ai-model/SKILL.md .claude/skills/re-iot-proto/SKILL.md README.md AGENTS.md .claude-plugin/marketplace.json
git commit -m "增强: 6 技能挂载与计数同步 97（rerouting RTTI 行/网关与跨域/README-AGENTS-marketplace）"
```

**注意**：`re-binary-core/SKILL.md` 的工作区修改（re-cpp-abi 挂载）**不 git add、不提交**——与用户的未提交改动共存于工作区，由用户后续一并提交。提交后 `git status` 应显示 re-binary-core/SKILL.md 仍为 M。
