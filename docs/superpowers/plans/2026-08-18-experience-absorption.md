# reverse-skill 经验吸收 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 从 reverse-skill field-journal（MIT）吸收 12 个条目的经验到 10 个 rev-skills 技能，技能总数 107 不变。

**Architecture:** 纯技能文档扩展。每个任务 = 在目标技能「## 常见坑与陷阱」章节末尾追加改写后的坑条目（现象/原因/对策格式）+ 来源注明（MIT）。吸收素材见 /home/DslsDZC/rev-refs/extract-field-journal.md（59 个踩坑点）。

**Tech Stack:** Markdown / validate.mjs（npm test，现有）

## Global Constraints

- **红线 1 呈现中性**：禁用「最推荐」「强烈建议」等最高级强推措辞
- **红线 2 隐私脱敏**：按提取稿「脱敏注意」泛化（厂商文件指纹/产品名/真实文件名全部泛化）
- **版权**：每条吸收末尾注明「（来源：reverse-skill field-journal，MIT）」
- **改写**：不逐字复制——按现象/原因/对策格式改写
- **查重**：入库前 grep 目标技能（含 references/）；同现象已存在 → 跳过并在报告中记录
- 工作区已干净（无未提交文件）；各任务 commit 只 `git add` 本任务列出的文件
- 当前分支 `main`；`npm test` 全程预期 `OK: 107 skills validated`

---

### Task 1: re-go 吸收（Go Garble 对抗 + TLS 分片代理）

**Files:**
- Modify: `.claude/skills/re-go/SKILL.md`（「## 常见坑与陷阱」末尾追加）

**Interfaces:**
- Consumes: 提取稿第 1、12 节素材
- Produces: re-go 的 Garble 对抗与源码重建经验

- [ ] **Step 1: 查重**

Run: `grep -n "Garble\|GoReSym\|字符串" .claude/skills/re-go/SKILL.md`
- 若已有同现象条目 → 跳过对应条并在报告中记录

- [ ] **Step 2: 追加坑条目**

在 `.claude/skills/re-go/SKILL.md` 的「## 常见坑与陷阱」章节末尾追加：

```markdown
- **Garble 混淆的 Go 二进制**：现象——stripped + 随机函数名 + 字符串全空；原因——Garble 同时混淆函数名与字符串；对策——GoReSym 恢复 pclntab（函数边界不受名字混淆影响）→ GoResolver CFG 签名恢复标准库名 → GoStringUngarbler 批量解密字符串 → 从解密串找 C2/密钥
- **Go 静态链接函数爆炸**：现象——5 万+ 函数看不过来；原因——整个 runtime 静态链接；对策——符号恢复后按包名过滤（只看用户代码包），先分包再筛业务
- **Go 加密密钥定位**：现象——找不到 AES 密钥；原因——密钥运行时从多个常量拼接；对策——跟踪 `crypto/aes.NewCipher`（或 `crypto/cipher.NewGCM`）第一个参数来源，回溯拼接点
- **Go 接口调用看不懂**：现象——反编译的 interface 调用是间接跳转；原因——Go interface 经 itab 分派；对策——定位 itab 表手动标注接口类型
- **符号可用但签名缺失**：现象——函数名有、参数/类型没有；原因——新版本 Go 产物不带完整符号信息；对策——接受函数名可用、签名靠其他证据（配置反序列化类型/调用点）重建
- **字符串噪声大**：现象——恢复的字符串混入大量标准库常量；原因——Go 标准库字符串常量；对策——按包级别过滤后再筛业务字符串
- **源码重建原则**：现象——逐行还原不现实；原因——产物无源码对应；对策——按包重建可读代码、保留逻辑而非逐行一致（逻辑优先）
（来源：reverse-skill field-journal，MIT）
```

- [ ] **Step 3: 结构校验**

Run: `npm test`
Expected: `OK: 107 skills validated`，无 FAIL

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/re-go/SKILL.md
git commit -m "经验: re-go 吸收 reverse-skill field-journal（Garble 对抗链/密钥定位/源码重建，MIT）"
```

---

### Task 2: re-binary-core 吸收（ARM64 跳转表/XOR 解密器）

**Files:**
- Modify: `.claude/skills/re-binary-core/SKILL.md`（「## 常见坑与陷阱」末尾追加）

**Interfaces:**
- Consumes: 提取稿第 2 节素材
- Produces: re-binary-core 的平坦化轻量恢复经验

- [ ] **Step 1: 查重**

Run: `grep -n "跳转表\|控制流平坦\|XOR" .claude/skills/re-binary-core/SKILL.md`

- [ ] **Step 2: 追加坑条目**

在 `.claude/skills/re-binary-core/SKILL.md` 的「## 常见坑与陷阱」末尾追加：

```markdown
- **间接跳转平坦化主函数**：现象——反编译器只识别函数前部 CFG，分发器处中断；原因——间接 BR 跳转表（控制流平坦化）；对策——按跳转表公式 `target = (table_entry + fixed_delta)` 枚举真实基本块，不依赖默认 CFG；符号长度远大于 CFG 识别长度时优先查 BR/BLR 间接表
- **逐函数 XOR 字符串解密器**：现象——字符串扫描只看到少量路径；原因——文本用每字符串独立的循环 XOR；对策——识别「前 N 字节密钥 + 后 M 字节密文」布局，从解密器指令提取 key/output 长度，静态重放算法（对平坦化块局部常量传播即可恢复间接目标与字符串源地址，无需先完整去平坦化）
- **自解压归档安全展开**：现象——解包目标含恶意路径；原因——归档内路径可构造；对策——逐成员校验后写出（拒绝绝对路径、`..`、链接、设备节点），不直接执行、不信任成员路径
- **压缩载荷定位**：现象——只按魔数找压缩流会漏；原因——魔数不唯一/被混淆；对策——对候选偏移做完整解压测试（有效流校验），不只看头部
（来源：reverse-skill field-journal，MIT）
```

- [ ] **Step 3: 结构校验**

Run: `npm test`
Expected: `OK: 107 skills validated`

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/re-binary-core/SKILL.md
git commit -m "经验: re-binary-core 吸收（跳转表枚举/逐函数 XOR 解密器/自解压安全展开，MIT）"
```

---

### Task 3: re-deobfuscate 吸收（验证码 DSL VM）

**Files:**
- Modify: `.claude/skills/re-deobfuscate/SKILL.md`（「## 常见坑与陷阱」末尾追加）

**Interfaces:**
- Consumes: 提取稿第 3 节素材
- Produces: re-deobfuscate 的 DSL VM 对抗经验

- [ ] **Step 1: 查重**

Run: `grep -n "DSL\|VM\|opcode\|虚拟机" .claude/skills/re-deobfuscate/SKILL.md`

- [ ] **Step 2: 追加坑条目**

在 `.claude/skills/re-deobfuscate/SKILL.md` 的「## 常见坑与陷阱」末尾追加：

```markdown
- **自定义 DSL VM（纯 JS 虚拟机）**：现象——大 JS 文件被当 WASM/常规混淆；原因——自定义解释器循环 + 自定义 opcode；对策——DSL VM 五步：case 提取 → opcode 分类 → 常量表分析 → 函数追踪 → 导出提取；先确认是纯 JS 解释器再决定工具链
- **VM 导出函数隐藏**：现象——VM 文件中找不到导出函数名；原因——导出名被指令编码隐藏；对策——从模块注册中心提取真实导出（不通过 VM 文件表面暴露）
- **流程就绪 ≠ 会话建立**：现象——接口返回成功但流程没起来；原因——成功只是会话确认；对策——以特定状态码/阶段标志判断流程真正就绪，别拿会话确认当启动
（来源：reverse-skill field-journal，MIT）
```

- [ ] **Step 3: 结构校验**

Run: `npm test`
Expected: `OK: 107 skills validated`

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/re-deobfuscate/SKILL.md
git commit -m "经验: re-deobfuscate 吸收（DSL VM 五步/导出隐藏/流程就绪判断，MIT）"
```

---

### Task 4: re-fw-extract 吸收（Cortex-M 分块 XOR）

**Files:**
- Modify: `.claude/skills/re-fw-extract/SKILL.md`（「## 常见坑与陷阱」末尾追加）

**Interfaces:**
- Consumes: 提取稿第 4 节素材
- Produces: re-fw-extract 的固件分块变换恢复经验

- [ ] **Step 1: 查重**

Run: `grep -n "XOR\|分块\|掩码" .claude/skills/re-fw-extract/SKILL.md`

- [ ] **Step 2: 追加坑条目**

在 `.claude/skills/re-fw-extract/SKILL.md` 的「## 常见坑与陷阱」末尾追加：

```markdown
- **分块周期变换**：现象——单一全文件 XOR/旋转只在开头有效；原因——变换按块大小（常见 256/512/1024/2048/4096）重置；对策——先按常见 Flash/传输块大小检查变换是否按块重置周期，显式分块解码
- **块首自带掩码混淆**：现象——高熵固件被当强加密；原因——分块自带掩码混淆（如 `mask = block[0]`、`plain[i] = ROR8(packed[i], n) XOR mask`）；对策——先用强 crib（向量表 SRAM 栈指针/Thumb Reset Vector）约束恢复首块，再验证模型
- **众数 crib 不可靠**：现象——文本密集块用众数字节做掩码仍乱码；原因——最常见明文字节不一定是零；对策——改用块首字节模型，验证标准：乱码消失 + 第二份同系列固件复现 + round-trip 逐字节一致
- **CRC 字符串 ≠ CRC 字段**：现象——看到 CRC 名字符串就假设末尾是标准 CRC；原因——字符串只是元数据键；对策——系统排除常见 CRC/硬件 CRC/Adler/累加族后保留为未知字段，不强行命名
（来源：reverse-skill field-journal，MIT）
```

- [ ] **Step 3: 结构校验**

Run: `npm test`
Expected: `OK: 107 skills validated`

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/re-fw-extract/SKILL.md
git commit -m "经验: re-fw-extract 吸收（分块周期/块首掩码/强 crib 验证，MIT）"
```

---

### Task 5: re-loader 吸收（ELF 自解压加载器）

**Files:**
- Modify: `.claude/skills/re-loader/SKILL.md`（「## 常见坑与陷阱」末尾追加）

**Interfaces:**
- Consumes: 提取稿第 5 节素材
- Produces: re-loader 的自解压加载器经验

- [ ] **Step 1: 查重**

Run: `grep -n "自解压\|PHDR\|mmap\|解压" .claude/skills/re-loader/SKILL.md`

- [ ] **Step 2: 追加坑条目**

在 `.claude/skills/re-loader/SKILL.md` 的「## 常见坑与陷阱」末尾追加：

```markdown
- **伪装后缀的自解压加载器**：现象——readelf 报错无法解析；原因——PHDR 被故意填充损坏（干扰解析）；对策——忽略损坏的 PHDR 只看有效 LOAD 段；识别标准模式：入口 → 解压函数 → mmap(RW) → 解压 → mprotect(RX) → 跳转
- **位操作密集代码反编译差**：现象——Hex-Rays 输出不可读；原因——ARM64 位操作密集；对策——切反汇编视图手动分析（位流读取/移位/条件分支场景反编译器不如直接看汇编）
- **自写解压器 bug（carry 语义）**：现象——Python 重写解压器输出错误；原因——refill 路径返回值/进位语义误判；对策——仔细对照汇编核对 carry 语义，用已知明文加断言对比
- **入口偏移不确定**：现象——payload 入口字段含义不明；原因——数据表字段无文档；对策——跟踪 loader 实际跳转目标（`br mmap_base + offset`）确认入口
- **后缀不可信**：现象——按后缀选工具链出错；原因——自解压样本伪装扩展名；对策——`file` 永远是第一步；解析器选容错实现（可处理损坏头）
（来源：reverse-skill field-journal，MIT）
```

- [ ] **Step 3: 结构校验**

Run: `npm test`
Expected: `OK: 107 skills validated`

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/re-loader/SKILL.md
git commit -m "经验: re-loader 吸收（自解压模式/损坏 PHDR/carry 语义，MIT）"
```

---

### Task 6: re-game 吸收（Unity IL2CPP）

**Files:**
- Modify: `.claude/skills/re-game/SKILL.md`（「## 常见坑与陷阱」末尾追加）

**Interfaces:**
- Consumes: 提取稿第 6 节素材
- Produces: re-game 的 IL2CPP 还原经验

- [ ] **Step 1: 查重**

Run: `grep -n "IL2CPP\|Il2Cpp\|metadata" .claude/skills/re-game/SKILL.md`

- [ ] **Step 2: 追加坑条目**

在 `.claude/skills/re-game/SKILL.md` 的「## 常见坑与陷阱」末尾追加：

```markdown
- **IL2CPP 元数据还原**：现象——dump 工具报版本不支持/输出不全；原因——Unity 版本改 metadata 格式；对策——升级 dump 工具（Il2CppDumper 或 Il2CppInspectorRedux），必须用同一次 dump 的产物对（script.json 与 so 匹配，换 IDA 清缓存）
- **加密的 global-metadata.dat**：现象——元数据文件是密文；原因——反作弊/自定义加密；对策——找初始化解密函数（il2cpp_init 周围），Frida 在 mmap/read 后 dump 内存中已解密的元数据再喂给 dump 工具
- **IL2CPP 方法 hook**：现象——Frida 裸 hook 报错；原因——IL2CPP 方法非标准 Java/ObjC，需按 metadata 算偏移；对策——用 frida-il2cpp-bridge 库，不硬写 Interceptor.attach
- **patch 后闪退**：现象——静态修改后启动崩溃；原因——文件 hash 校验/anti-tamper；对策——hook 优先（不改文件）；必须静态 patch 时同步处理校验逻辑；重打包后删 META-INF 重新签名（apksigner）
（来源：reverse-skill field-journal，MIT）
```

- [ ] **Step 3: 结构校验**

Run: `npm test`
Expected: `OK: 107 skills validated`

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/re-game/SKILL.md
git commit -m "经验: re-game 吸收（IL2CPP 元数据/加密 metadata/方法 hook，MIT）"
```

---

### Task 7: re-frida 吸收（OkHttp SSL Pinning，查重优先）

**Files:**
- Modify: `.claude/skills/re-frida/SKILL.md`（「## 常见坑与陷阱」末尾追加）

**Interfaces:**
- Consumes: 提取稿第 7 节素材
- Produces: re-frida 的分层绕过与反检测经验

- [ ] **Step 1: 查重（关键步骤）**

Run: `grep -n "CertificatePinner\|TrustManager\|pinning\|固定" .claude/skills/re-frida/SKILL.md .claude/skills/re-frida/references/frida-scripts.md`
- frida-scripts.md 已有「SSL 固定绕过」模板（TrustManager + CertificatePinner）——**该条跳过**，报告记录
- 其余条（分层 hook 思维/反 Frida 检测/ProGuard 混淆定位）查重后决定

- [ ] **Step 2: 追加坑条目（查重后剩余）**

在 `.claude/skills/re-frida/SKILL.md` 的「## 常见坑与陷阱」末尾追加（按 Step 1 查重结果裁剪，未命中才写入）：

```markdown
- **多层 TLS 校验栈**：现象——单点 hook 后部分请求仍 SSL 错误；原因——App 同时用 OkHttp/原生 HttpsURLConnection/Conscrypt 多套栈；对策——分层覆盖（OkHttp CertificatePinner + TrustManagerImpl.verifyChain + HostnameVerifier 同时 hook），全栈覆盖才算绕过完成
- **ProGuard 混淆后定位目标类**：现象——类名被改成短名；原因——混淆；对策——jadx 里 Find Usages 反查谁实例化关键 Builder，从实例化点反推原类
（来源：reverse-skill field-journal，MIT）
```

- [ ] **Step 3: 结构校验**

Run: `npm test`
Expected: `OK: 107 skills validated`

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/re-frida/SKILL.md
git commit -m "经验: re-frida 吸收（多层 TLS 栈覆盖/混淆定位，MIT）"
```

---

### Task 8: re-ios-jb 吸收（越狱检测绕过）

**Files:**
- Modify: `.claude/skills/re-ios-jb/SKILL.md`（「## 常见坑与陷阱」末尾追加）

**Interfaces:**
- Consumes: 提取稿第 8 节素材
- Produces: re-ios-jb 的检测绕过与抓包经验

- [ ] **Step 1: 查重**

Run: `grep -n "越狱检测\|jailbreak\|spawn\|证书信任" .claude/skills/re-ios-jb/SKILL.md`

- [ ] **Step 2: 追加坑条目**

在 `.claude/skills/re-ios-jb/SKILL.md` 的「## 常见坑与陷阱」末尾追加：

```markdown
- **检测在加载期执行**：现象——hook 来不及，App 启动前已检测；原因——检测在 `+load` / `__attribute__((constructor))` 中执行；对策——spawn 模式在最早时机注入（`-f` + 启动即 hook）
- **双重校验**：现象——绕过越狱检测后仍闪退；原因——越狱检测与 SSL Pinning 叠加；对策——同时禁用两者，不要只处理一个
- **hook 系统函数波及自身**：现象——hook stat 后 App 卡住；原因——系统级 hook 影响正常逻辑；对策——按 caller 过滤，只 hook 应用自身代码触发的调用
- **证书信任开关**：现象——mitmproxy 装证书后仍 SSL 错误；原因——iOS 14+ 需在证书信任设置手动开启；对策——装完证书后到「通用 → 关于本机 → 证书信任设置」勾选
- **越狱检测 hook 模板**：现象——需要快速绕过常见检测；对策——拦截文件存在性检查（越狱路径列表返回不存在）+ fork 返回 -1（越狱机能 fork，非越狱机返回 -1）
（来源：reverse-skill field-journal，MIT）
```

- [ ] **Step 3: 结构校验**

Run: `npm test`
Expected: `OK: 107 skills validated`

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/re-ios-jb/SKILL.md
git commit -m "经验: re-ios-jb 吸收（加载期检测/双重校验/证书信任开关，MIT）"
```

---

### Task 9: re-proto-rev 吸收（PCAP 自定义协议）

**Files:**
- Modify: `.claude/skills/re-proto-rev/SKILL.md`（「## 常见坑与陷阱」末尾追加）

**Interfaces:**
- Consumes: 提取稿第 9 节素材
- Produces: re-proto-rev 的帧界/加密判定/闭环验证经验

- [ ] **Step 1: 查重**

Run: `grep -n "熵\|dissector\|长度字段\|nonce" .claude/skills/re-proto-rev/SKILL.md`

- [ ] **Step 2: 追加坑条目**

在 `.claude/skills/re-proto-rev/SKILL.md` 的「## 常见坑与陷阱」末尾追加：

```markdown
- **私有协议无解析器**：现象——Wireshark 只显示 Data；原因——私有协议无 dissector；对策——写 Lua dissector（<100 行）或 Python 离线分析
- **数据无规律 → 先验加密**：现象——每帧都不同；原因——压缩/加密层；对策——熵分析（>7.5 几乎肯定加密），加密层找 nonce/IV 字段；长度字段解不出时按「长度可能 little/big-endian、含/不含自身」列方程组解语义
- **重放被拒**：现象——数据正确但服务端不响应；原因——协议带递增 seq/nonce；对策——搞清楚 seq 计算方式（前一帧 hash 或递增计数器），复现时正确推进
- **闭环验证**：现象——协议还原是否成立无判据；对策——用还原的帧结构写 client 发一帧，服务端响应一致才算成立
（来源：reverse-skill field-journal，MIT）
```

- [ ] **Step 3: 结构校验**

Run: `npm test`
Expected: `OK: 107 skills validated`

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/re-proto-rev/SKILL.md
git commit -m "经验: re-proto-rev 吸收（私有协议解析/熵判加密/seq 推进，MIT）"
```

---

### Task 10: re-script-deob + re-crypto-id 吸收（JS 签名）

**Files:**
- Modify: `.claude/skills/re-script-deob/SKILL.md`（「## 常见坑与陷阱」末尾追加）
- Modify: `.claude/skills/re-crypto-id/SKILL.md`（「## 常见坑与陷阱」末尾追加）

**Interfaces:**
- Consumes: 提取稿第 10 节素材
- Produces: re-script-deob 的 webpack 定位经验 + re-crypto-id 的签名模式识别经验

- [ ] **Step 1: 查重**

Run: `grep -n "webpack\|签名\|initiator" .claude/skills/re-script-deob/SKILL.md .claude/skills/re-crypto-id/SKILL.md`

- [ ] **Step 2: 追加坑条目（2 文件）**

`.claude/skills/re-script-deob/SKILL.md` 的「## 常见坑与陷阱」末尾追加：

```markdown
- **webpack 打包定位签名函数**：现象——搜 "sign" 结果太多；原因——打包压缩变量名；对策——搜特征串（`sign=`）或用网络面板 initiator 列回溯发起请求的调用栈（比搜源码快）
- **本地复现结果不一致**：现象——签名逻辑对但服务端不认；原因——参数排序/时间戳精度不对；对策——核对源码 sort 逻辑（按 key 字母序 + 特殊字符规则）；时间戳用 `Math.floor(Date.now() / 1000)`（秒级）
- **密钥在另一 chunk**：现象——签名函数里找不到密钥；原因——密钥经 require 从其他 chunk 引入；对策——签名函数断点处 console.log 打印密钥变量
（来源：reverse-skill field-journal，MIT）
```

`.claude/skills/re-crypto-id/SKILL.md` 的「## 常见坑与陷阱」末尾追加：

```markdown
- **常见签名模式速查**：现象——签名算法识别慢；对策——按模式快速对照：HmacSHA256(sorted_params, key) 最常见；MD5(params + salt + timestamp) 较老系统；AES(JSON.stringify(params), key) 是加密而非签名；RSA sign 少见（多为金融类）
（来源：reverse-skill field-journal，MIT）
```

- [ ] **Step 3: 结构校验**

Run: `npm test`
Expected: `OK: 107 skills validated`

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/re-script-deob/SKILL.md .claude/skills/re-crypto-id/SKILL.md
git commit -m "经验: re-script-deob/re-crypto-id 吸收（webpack 定位/签名模式速查，MIT）"
```

---

### Task 11: re-managed 吸收（Electron Bytenode 更新链）

**Files:**
- Modify: `.claude/skills/re-managed/SKILL.md`（「## 常见坑与陷阱」末尾追加）

**Interfaces:**
- Consumes: 提取稿第 11 节素材
- Produces: re-managed 的 Electron/Bytenode 分析经验

- [ ] **Step 1: 查重**

Run: `grep -n "Electron\|Bytenode\|ASAR\|字节码" .claude/skills/re-managed/SKILL.md`

- [ ] **Step 2: 追加坑条目**

在 `.claude/skills/re-managed/SKILL.md` 的「## 常见坑与陷阱」末尾追加：

```markdown
- **Bytenode 字节码绑定 ABI**：现象——宿主 Node 加载 JSC 失败；原因——Bytenode 字节码绑定特定 V8/Node ABI；对策——用样本自带 Electron 的 RunAsNode 模式（`ELECTRON_RUN_AS_NODE=1`）执行，不启动业务 GUI
- **注册面 ≠ 执行面**：现象——枚举 handler 无法证明数据流；原因——注册存在不等于路径执行；对策——先枚举 IPC/preload 注册面，再对高风险 handler 用 mock fixture 调用并捕获副作用（URL 接收/下载/解压/spawn 参数），形成证据闭环
- **更新链五元组取证**：现象——更新流程证据不全；原因——链路节点分散；对策——按 `source URL → downloader → archive path → extractor → executable` 每个节点保存哈希与时间戳
- **签名状态分四态**：现象——双签名 DLL 判断含糊；原因——各签名状态可能不同；对策——`signtool verify /pa /all /v` 逐签名检查（存在性/有效期/时间戳/信任验证分开报告）
- **静态能力 ≠ 已执行**：现象——native 字符串/导入显示高权限能力；原因——导入是线索不是证据；对策——能力描述结合 xref/调用链，报告分栏「条件性能力」与「已观察行为」
（来源：reverse-skill field-journal，MIT）
```

- [ ] **Step 3: 结构校验**

Run: `npm test`
Expected: `OK: 107 skills validated`

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/re-managed/SKILL.md
git commit -m "经验: re-managed 吸收（Bytenode ABI/注册面执行面分离/更新链取证，MIT）"
```
