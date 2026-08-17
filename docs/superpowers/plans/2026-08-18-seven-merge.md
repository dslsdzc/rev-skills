# 7 处融入 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 7 处章节融入现有技能（re-blockchain / re-automotive / re-script-deob / re-forensics / re-exploit / re-tracing / re-disk-forensics），技能总数 97 不变。

**Architecture:** 纯技能文档扩展。每处融入 = 在目标技能「## 跨域联合」标题前插入一个「## 章节」（按 docs/skill-template.md 体例），章节全文在本计划中给出。

**Tech Stack:** Markdown / validate.mjs（npm test，现有）

## Global Constraints

- **红线 1 呈现中性**：禁用「最推荐」「强烈建议」等最高级强推措辞
- **红线 2 隐私脱敏**：内容不指向具体项目/公司/产品
- **不绑定具体工具**：方法为核心，工具为可替换示例
- validate.mjs：SKILL.md 正文 `[[链接]]` 必须可解析（技能目录或 references/*.md）
- 工作区有 3 个未提交修改（re-binary-core / re-mobile / re-protocol 的 SKILL.md）——**各任务 commit 只 `git add` 本任务列出的文件，严禁 `git add -A`**；本计划 7 个融入目标技能均为干净文件
- 当前分支 `main`；`npm test` 预期全程 `OK: 97 skills validated`

---

### Task 1: re-blockchain 融入「非 EVM 链」

**Files:**
- Modify: `.claude/skills/re-blockchain/SKILL.md`（「## 跨域联合」标题前插入章节）

**Interfaces:**
- Consumes: 无
- Produces: re-blockchain 的非 EVM 覆盖（Solana BPF / Move）

- [ ] **Step 1: 插入章节**

在 `.claude/skills/re-blockchain/SKILL.md` 的「## 跨域联合」标题之前插入：

```markdown
## 非 EVM 链（Solana / Move）

流程与 EVM 同构（字节码反编译 → 漏洞分析），指令集与资源模型不同——先识别运行时，再按对应路径走。

- **Solana（BPF 字节码）**：识别特征——ELF 文件 + .text 段为 BPF 指令（eBPF 类指令集）；反编译路径——`llvm-objdump -d`（BPF 反汇编）或专用反编译器；分析重点——程序账户与指令调度（CPI 跨程序调用链）、账户数据布局（结构体偏移）
- **Sui / Aptos（Move 字节码）**：识别特征——模块/资源/函数表结构；反编译——move disassembler（`move disassemble`）；分析重点——资源模型（对象/能力）对漏洞面的影响（转账/所有权逻辑）、模块依赖图
- **DeFi/NFT 场景**：池子合约（AMM 常量积公式）、代币标准变体（SPL 等）、授权与提现逻辑定位
- 漏洞分析承接：逻辑漏洞（重入/权限）沿用 EVM 思路，资源/账户模型差异处单独判断
```

- [ ] **Step 2: 结构校验**

Run: `npm test`
Expected: `OK: 97 skills validated`（章节内 [[链接]] 无；如含需确认指向已存在技能）

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/re-blockchain/SKILL.md
git commit -m "增强: re-blockchain 融入非 EVM 链（Solana BPF / Move 字节码）"
```

---

### Task 2: re-automotive 融入「IVI / T-Box / V2X 路径」

**Files:**
- Modify: `.claude/skills/re-automotive/SKILL.md`（「## 跨域联合」标题前插入章节）

**Interfaces:**
- Consumes: 无
- Produces: re-automotive 的车联网覆盖（IVI / T-Box / V2X 分流）

- [ ] **Step 1: 插入章节**

在 `.claude/skills/re-automotive/SKILL.md` 的「## 跨域联合」标题之前插入：

```markdown
## IVI / T-Box / V2X 路径

按目标形态分流（判定规则）：

- **IVI（车载娱乐系统）**：本质是 Android/Linux 系统——应用层走 [[re-apk]]，系统镜像走 [[re-firmware]]；关注 OEM 定制层（启动器、诊断接口、ADB/调试口）
- **T-Box（远程信息处理箱）**：蜂窝模组（AT 指令接口）、MCU 固件（[[re-fw-extract]] 提取分析）、远程控制协议（车控指令——门锁/空调/启动，走 [[re-protocol]]）
- **V2X（车联网通信）**：DSRC / C-V2X 帧结构 → [[re-protocol]] / [[re-ics]] 路径（协议状态机重建、PC5/Uu 接口区分）
- 判定规则：应用层 → 移动/系统路径（[[re-apk]] / [[re-firmware]]）；通信层 → 协议路径（[[re-protocol]] / [[re-ics]]）；固件层 → 固件路径（[[re-fw-extract]] / [[re-fw-rootfs]]）
```

- [ ] **Step 2: 结构校验**

Run: `npm test`
Expected: `OK: 97 skills validated`（[[re-apk]] / [[re-firmware]] / [[re-fw-extract]] / [[re-protocol]] / [[re-ics]] / [[re-fw-rootfs]] 均存在）

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/re-automotive/SKILL.md
git commit -m "增强: re-automotive 融入 IVI/T-Box/V2X 路径分流"
```

---

### Task 3: re-script-deob 融入「高级混淆对抗」

**Files:**
- Modify: `.claude/skills/re-script-deob/SKILL.md`（「## 跨域联合」标题前插入章节）

**Interfaces:**
- Consumes: 无
- Produces: re-script-deob 的商业混淆器对抗覆盖

- [ ] **Step 1: 插入章节**

在 `.claude/skills/re-script-deob/SKILL.md` 的「## 跨域联合」标题之前插入：

```markdown
## 高级混淆对抗（商业混淆器）

JScrambler 类商业混淆器的手法与对抗：

- **特征识别**：bootstrap 加载器（自执行入口）、字符串表隐藏（数组 + 索引引用）、`_0x` 变量重命名模式、函数体加密（运行时解密）
- **控制流平坦化（CFF）对抗**：dispatcher 识别（switch 分发中心）→ 状态变量追踪 → 分支还原为顺序/条件结构（方法衔接 [[re-deobfuscate]]）
- **字符串加密对抗**：隐藏字符串表定位（解码函数调用点）→ 运行时提取（沙箱内执行解码函数取值，见 [[re-sandbox]]）或静态还原（解码循环脚本化）
- **死代码注入对抗**：无引用函数过滤（按调用关系，无调用者即候选删除）
- 工具链：js-beautify 美化 → 按手法选对抗路径；动态侧沙箱执行取值（默认沙箱原则）
```

- [ ] **Step 2: 结构校验**

Run: `npm test`
Expected: `OK: 97 skills validated`（[[re-deobfuscate]] / [[re-sandbox]] 均存在）

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/re-script-deob/SKILL.md
git commit -m "增强: re-script-deob 融入高级混淆对抗（商业混淆器）"
```

---

### Task 4: re-forensics 融入「容器镜像取证」

**Files:**
- Modify: `.claude/skills/re-forensics/SKILL.md`（「## 跨域联合」标题前插入章节）

**Interfaces:**
- Consumes: 无
- Produces: re-forensics 的云原生覆盖（容器镜像取证）

- [ ] **Step 1: 插入章节**

在 `.claude/skills/re-forensics/SKILL.md` 的「## 跨域联合」标题之前插入：

```markdown
## 容器镜像取证

- **镜像结构**：tar 归档 + 分层（每层 = 文件系统快照差异；`docker save` / `skopeo copy` 导出）
- **层提取**：解包层归档 → 逐层文件系统分析（复用 [[re-disk-forensics]] / [[re-fw-rootfs]] 的方法：文件枚举、删除文件恢复）
- **分析重点**：配置与密钥（环境变量、挂载点、entrypoint/CMD 脚本）、历史层残留（删除的文件在旧层仍可恢复）、恶意镜像判定（启动命令、网络行为、可疑二进制）
- **输出**：镜像内容清单 + 可疑项列表（与 [[re-ioc]] 的指标提取衔接）
```

- [ ] **Step 2: 结构校验**

Run: `npm test`
Expected: `OK: 97 skills validated`（[[re-disk-forensics]] / [[re-fw-rootfs]] / [[re-ioc]] 均存在）

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/re-forensics/SKILL.md
git commit -m "增强: re-forensics 融入容器镜像取证（分层提取与文件系统分析）"
```

---

### Task 5: re-exploit 融入「内核利用」

**Files:**
- Modify: `.claude/skills/re-exploit/SKILL.md`（「## 跨域联合」标题前插入章节）

**Interfaces:**
- Consumes: 无
- Produces: re-exploit 的内核利用覆盖（提权原语 / 堆喷 / UAF 路径）

- [ ] **Step 1: 插入章节**

在 `.claude/skills/re-exploit/SKILL.md` 的「## 跨域联合」标题之前插入：

```markdown
## 内核利用

与用户态同框架：fuzz（[[re-fuzzing]]）→ crash（[[re-crash-triage]]）→ 利用（本路径）。

- **提权原语**：modprobe_path 覆写（触发内核执行任意路径）、cred 结构覆写（uid/gid 置 0）、io_uring / BPF 子系统利用面
- **堆喷与对象布局**：堆喷策略（同尺寸对象占位）、对象重叠（UAF 后伪造对象）、SLUB 分配器行为（per-CPU 缓存）
- **内核 UAF 利用路径**：漏洞触发（悬垂引用）→ 对象重用（占位伪造）→ 控制流劫持（函数指针 / ops 表覆写）
- **环境**：调试内核（KASAN 开、KASLR 关闭或绕过）、gdb/kgdb 断点、模块化测试（只读分析 + 沙箱验证）
```

- [ ] **Step 2: 结构校验**

Run: `npm test`
Expected: `OK: 97 skills validated`（[[re-fuzzing]] / [[re-crash-triage]] 均存在）

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/re-exploit/SKILL.md
git commit -m "增强: re-exploit 融入内核利用（提权原语/堆喷/UAF 路径）"
```

---

### Task 6: re-tracing 融入「指令级追踪」

**Files:**
- Modify: `.claude/skills/re-tracing/SKILL.md`（「## 跨域联合」标题前插入章节）

**Interfaces:**
- Consumes: 无
- Produces: re-tracing 的指令级覆盖（QEMU 插件 / Intel PT）

- [ ] **Step 1: 插入章节**

在 `.claude/skills/re-tracing/SKILL.md` 的「## 跨域联合」标题之前插入：

```markdown
## 指令级追踪

比系统调用级更深一层——指令粒度执行流：

- **QEMU 插件**：`-plugin` 加载指令级 trace 插件（insn 粒度、call/ret 路径、guest 代码块事件）；用途——脱壳后真实路径还原、反混淆（静态混淆无法隐藏实际执行）
- **Intel PT**：硬件 trace（`perf record -e intel_pt`）→ 解码（`perf script` 或第三方解析）→ 分支流还原；用途——无插桩开销的完整执行路径
- **trace 分析**：热点（执行频次排序）、路径还原（调用链重建）、与 [[re-deobfuscate]] 衔接（按真实路径过滤死代码）
- **输出**：指令级执行流摘要（供 [[analysis-contract]] 证据存档）
```

- [ ] **Step 2: 结构校验**

Run: `npm test`
Expected: `OK: 97 skills validated`（[[re-deobfuscate]] / [[analysis-contract]] 均存在）

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/re-tracing/SKILL.md
git commit -m "增强: re-tracing 融入指令级追踪（QEMU 插件/Intel PT）"
```

---

### Task 7: re-disk-forensics 融入「数据库文件格式」

**Files:**
- Modify: `.claude/skills/re-disk-forensics/SKILL.md`（「## 跨域联合」标题前插入章节）

**Interfaces:**
- Consumes: 无
- Produces: re-disk-forensics 的数据库文件覆盖（SQLite 结构 / WAL / 恢复）

- [ ] **Step 1: 插入章节**

在 `.claude/skills/re-disk-forensics/SKILL.md` 的「## 跨域联合」标题之前插入：

```markdown
## 数据库文件格式

- **SQLite 结构**：页头（page header 字段）、btree 页（interior/leaf 类型）、记录格式（varint 长度编码 / 类型码）、溢出页（大字段跨页）
- **WAL 恢复**：WAL 文件帧解析（未 checkpoint 的事务）、checkpoint 边界判定（恢复点）
- **取证应用**：浏览器/App 数据库——删除记录恢复（freelist 页残留）、未提交事务提取（WAL 内）
- **工具**：`sqlite3` CLI 只读模式（`sqlite3 -readonly`）、页级解析脚本（python 按页结构遍历）
```

- [ ] **Step 2: 结构校验**

Run: `npm test`
Expected: `OK: 97 skills validated`（章节内无 [[链接]] 或确认指向已存在技能）

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/re-disk-forensics/SKILL.md
git commit -m "增强: re-disk-forensics 融入数据库文件格式（SQLite 页结构/WAL/恢复）"
```
