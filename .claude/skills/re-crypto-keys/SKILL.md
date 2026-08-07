---
name: re-crypto-keys
description: >
  密钥与口令提取：硬编码、内存搜索、资源。
  触发词：找密钥、硬编码、key extraction、口令
---

# 密钥与口令提取

## 何时使用 / 何时不用

- 用：需要解密数据/流量但不知道密钥时（静态优先：硬编码 → 资源 → 导入表；动态：内存转储）
- 用：确认样本是否硬编码了密钥/口令（配置提取）
- 用：密钥是运行时派生的（PBKDF/HKDF）需要还原派生过程
- 不用：算法都还没确认（先 [[re-crypto-id]]）
- 不用：密钥通过外部配置/服务器下发（没有本地密钥可提取——诚实告诉用户，见坑 2）
- 不用：只做静态格式分析（[[re-triage]] / [[re-format-pe]]）

## 工具准备

所有工具先验证再使用。静态搜索可免沙箱；内存转储/动态环节按 [[re-memdump]] 默认转储优先 + [[platform-tips]] 最高原则（运行样本进沙箱）。

### strings —— 可打印串快速扫描（全平台）

- Linux: `apt install binutils` / `dnf install binutils` / `pacman -S binutils`（多数自带）
- macOS: 系统自带 /usr/bin/strings
- Windows/WSL: WSL 内 Linux 版；Windows 本机用 Ghidra 或 `strings.exe`（Sysinternals）
- 验证: `strings --version`（GNU 版有 --version）

### ghidra / rizin —— 反编译与交叉引用搜索（安装见 [[re-ghidra]] / [[re-radare2]]）

- 搜索常量/字符串的交叉引用是找"谁用了这个密钥"的关键
- 验证: `ghidra`（GUI）或 `rz-ghidra` 插件可用；`rizin -v`

### 转储产物 —— 内存搜索原料（[[re-memdump]] 默认转储）

- 按 [[re-memdump]] 步骤 1 用 `gcore -o out <pid>` 转储；脱壳样本等到 OEP 后再 dump（见 [[platform-tips]] 关键经验）
- 验证: `file out` 确认为 ELF core，`eu-stack -e out` 能跑

### python3 —— 熵块/模式扫描脚本

- 安装与验证见 [[re-proto-rev]] 工具准备（python3）

## 操作步骤

按顺序执行，每步记下结果。策略顺序：**先静态后动态**（见坑 3），每步产物（密钥/口令 + 来源证据：偏移、函数名、转储路径）记录供 [[re-crypto-decrypt]] 使用。

1. **静态：strings / 交叉引用找硬编码**：
   ```sh
   strings -n 6 sample.bin | grep -iE 'key|secret|pass|token|crypt|iv' | head -50
   strings -el sample.bin | grep -iE 'key|secret|pass' | head -20     # UTF-16LE（Windows 常见）
   strings -n 8 sample.bin | head -100                                # 全量扫描人工过一遍
   ```
   - 可疑串（看起来像密钥的固定串）用反编译器查交叉引用：[[re-ghidra]] / [[re-ida]] 右键 Find References——看它被哪个函数读、怎么参与运算（直接进加密参数 → 是密钥；参与查表/比较 → 是口令或盐）
   - 反编译器里搜常量（`Search > Memory` / `:> /v 0x...`）：32 字节十六进制串、重复的随机数据段
   - 十六进制侧: 用 [[re-crypto-id]] 步骤 1 的脚本找 AES S-box 等常量表后，表附近的内存数据常是密钥材料

2. **内存：转储后搜密钥模式（16/32 字节熵块、口令可打印串）**：
   ```sh
   gcore -o out <pid>                      # 默认转储（[[re-memdump]]），等 OEP 解密后
   ```
   ```python
   data = open('out','rb').read()
   import collections, math
   # 16/32 字节高熵块（AES-128/256 密钥候选）
   def ent(blk):
       c = collections.Counter(blk); n = len(blk)
       return -sum((v/n)*math.log2(v/n) for v in c.values())
   for base in range(0, len(data)-32, 32):
       blk = data[base:base+32]
       if ent(blk) > 7.0 and 16 <= len(set(blk)) <= 24:
           print(f"0x{base:x}: 32B 高熵块")
   # 口令/可打印串
   import re
   for m in re.finditer(rb'[ -~]{8,64}', data):
       s = m.group()
       if any(k in s.lower() for k in (b'key', b'pass', b'secret', b'pwd')):
           print(f"0x{m.start():x}: {s}")
   ```
   - 高熵块命中太多（整个堆都是）→ 结合 [[re-memdump]] 的 maps/偏移缩小到加密上下文附近，或先用步骤 4 的导入表定位函数再取参数
   - 密钥可能在堆/栈上碎片化或异或混淆（见坑 1）——找到后先在解密脚本里验证一次（[[re-crypto-decrypt]] 步骤 4）

3. **资源文件（.rsrc / 嵌入 blob）**：
   - PE: 用 `llvm-objdump -s -j .rsrc sample.exe` 或 Ghidra 看资源段；`7z x sample.exe` 可解出嵌入的 icon/version/自定义资源
   - ELF: 找 `.rodata` 里的嵌入 blob（`objdump -s -j .rodata`）；结合 [[re-firmware]] 经验——固件里密钥常在配置文件/默认证书里
   - 嵌入 blob 可能是序列化配置（JSON/INI 编码的密钥字段），先按文本解析再按二进制挖；blob 是加密的（高熵）→ 回 [[re-crypto-id]]，外层可能还有一层解密

4. **导入表线索（Crypt* 函数附近）**：
   - `objdump -p sample.exe | grep Crypt` / Ghidra Imports 窗口找 `CryptEncrypt`/`CryptDecrypt`/`BCrypt*`/`RSA*`/`EVP_*`（OpenSSL）
   - 找到后反编译该函数：密钥参数（handle/KEYEXCHANGE 结构）通常来自"前面某处设置的固定值"——从函数上溯数据流：常量赋值、全局变量初始化、`CryptSetKeyParam` 的 `pbKeyData` 参数
   - 设断点观察参数更直接（[[re-gdb]] / [[re-x64dbg]]）: `b CryptSetKeyParam` 后看 `pbKeyData` 指向的内存——但注意 [[platform-tips]] 最高原则：运行进沙箱

5. **密钥派生函数（PBKDF）还原**：
   - 反编译里认出 `PBKDF2`/`scrypt`/`bcrypt`/`EVP_BytesToKey` 调用 → 密钥 = KDF(口令, 盐, 迭代次数)，逐参数提取：口令（硬编码串或用户输入）、盐（固定字节或上下文）、迭代次数（常量）
   - 写还原脚本（`pip install cryptography` / `hashlib` 自带 PBKDF2）：
     ```python
     import hashlib
     key = hashlib.pbkdf2_hmac('sha256', b'passphrase', b'<salt>', 100000, dklen=32)
     print(key.hex())
     ```
   - 验证: 派生的 key 与步骤 2 内存里的高熵块一致（说明 KDF 跑完的密钥就在那），或直接用 [[re-crypto-decrypt]] 试解已知密文
   - 动态补充: Frida hook KDF 函数看返回 buffer（沙箱内，[[re-sandbox]]），比对静态还原结果

## 跨域联合

- [[re-protocol]]：本网关工作流第 3 步（密钥）——加密通信解密链路的中段（crypto-id → crypto-keys → crypto-decrypt）
- [[re-malware]]：C2 配置提取（硬编码 C2 密钥/口令）——re-malware 第 4 步的密钥环节；恶意样本密钥常埋在配置里（[[re-behavior]] 行为确认 + 本技能提取）
- [[re-firmware]]：固件内硬编码口令/密钥挖掘——re-firmware 第 3 步（rootfs 配置/默认证书）
- [[re-memdump]]：默认转储是本技能内存搜索的原料（[[platform-tips]] 直读 vs 转储决策表）
- [[re-crypto-decrypt]]：下游——提取的密钥交给解密脚本验证与使用
- [[re-anti-analysis]]：壳内密钥先脱壳（OEP 后再 dump，见 [[re-memdump]] 转储时机）
- [[re-ioc]]：提取出的硬编码密钥/口令可作 YARA 特征与 IOC

## 常见坑与陷阱

- **密钥分片存储/异或混淆**：现象——提取的单块"密钥"解不出明文，或字符串/内存里找不到完整密钥；原因——样本把密钥拆成多段（分片）或与常量异或后存储，运行时重组；对策——反编译找重组逻辑：密钥字节来自多个偏移/多次异或（见坑 3 的"先查硬编码"流程里，确认硬编码时要看引用处的运算）；还原出候选后在 [[re-crypto-decrypt]] 里逐个试
- **真随机密钥 ≠ 可从静态提取**：现象——静态/内存搜索全无收获，用户仍要密钥；原因——密钥是启动时 `RAND_bytes` 生成或服务器下发，根本不在样本里（白盒攻击之外无解）；对策——诚实报告：本地无可提取密钥，改走密钥派生拦截（hook `RAND_bytes`/KDF 输入）、算法侧攻击（若解密结果可被已知明文验证）或回 [[re-malware]] 看密钥是否由 C2 下发
- **先查是否硬编码再上动态**：现象——样本硬编码了密钥，却先跑沙箱+Frida 折腾半天；原因——没有按静态优先顺序执行；对策——步骤 1 strings/交叉引用是 30 秒检查，静态命中直接跳过动态；动态只在静态无果、且需要运行时材料（KDF 输入、重组逻辑）时上（见 [[platform-tips]] 静态优先思路与最高原则）
- **转储时机过早拿不到运行时密钥**：现象——内存搜索找不到任何高熵块或找到的都对不上；原因——在壳解密/密钥初始化前 dump（拿到的是壳的初始状态，见 [[re-memdump]] 坑 2）；对策——确认进程运行到业务逻辑（OEP 后、执行过加密调用）再 gcore；必要时在加密函数断点触发后再 dump（[[re-gdb]] 配合）
- **内存密钥候选模式漏 AES-192**：现象——高熵块只按 16/32 字节搜，24 字节密钥漏检，解密对不上；原因——AES-128/256 的 16/32 字节是常见假设，AES-192 密钥恰为 24 字节（轮数 12）；对策——高熵块搜索窗口覆盖 16/24/32 三档（配合 [[re-crypto-id]] 的轮数 10/12/14 判断定参数），候选命中后先在 [[re-crypto-decrypt]] 试解验证
- **勒索类样本密钥即用即销，事后 dump 必然为空**：现象——确认样本执行过加密，但任何内存转储里都搜不到密钥材料；原因——勒索软件在加密完成后立即清零密钥（wipe），密钥只在加密执行阶段短暂存在于内存（NotPetya/BadRabbit/Phobos 实验可画出密钥存在时间线）；对策——在加密阶段（业务逻辑运行中）做多次快照 dump 对比构建时间线，或配合 [[re-gdb]] 在加密函数返回前断住抓参数，比单一事后 dump 可靠
- **密钥明文只在特定执行瞬间出现，转储必错过**：现象——转储搜索无果，但动态跟踪能看到密钥出现；原因——部分样本的主密钥在内存里只在极短窗口以明文存在（如浏览器 v20_master_key 只在解密瞬间出现，VoidStealer 即靠硬件断点抓这一点）；对策——先定位密钥使用点（加密函数/派生点），在其上设硬件断点（[[re-gdb]]/[[re-x64dbg]]，不依赖断点指令）实时截获明文，比"转储后大海捞针"高效
