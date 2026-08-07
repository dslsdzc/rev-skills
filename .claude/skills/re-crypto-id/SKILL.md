---
name: re-crypto-id
description: >
  加密算法识别：常量表指纹、自定义加密模式。
  触发词：加密识别、AES、XOR、算法指纹、custom encryption
---

# 加密算法识别

## 何时使用 / 何时不用

- 用：拿到密文（流量或数据 blob）不确定是什么算法时
- 用：样本里有加密实现，需要在反编译前先锁定算法范围
- 用：怀疑自定义加密（XOR/ROL/ROR 变换）而非标准算法
- 不用：算法已知（直接用 [[re-crypto-keys]] 找密钥、[[re-crypto-decrypt]] 解密）
- 不用：标准库 API 调用清晰可见（`CryptEncrypt`/OpenSSL 符号可直接查——见 [[re-crypto-keys]] 导入表线索）
- 不用：纯静态就能判定是明文（[[re-triage]] 熵低/可读字符串多）

## 工具准备

所有工具先验证再使用。本技能以静态/离线分析为主，可免沙箱；动态确认环节（Frida）只针对已运行样本（默认沙箱，[[platform-tips]] 最高原则）。

### python3 —— 指纹与熵分析脚本

- 安装与验证见 [[re-proto-rev]] 工具准备（python3）

### binutils —— strings/objdump 取常量与反汇编线索

- Linux: `apt install binutils` / `dnf install binutils` / `pacman -S binutils`（多数自带）
- macOS: `brew install binutils`（或系统自带 otool 替代）
- Windows/WSL: WSL 内 Linux 版；Windows 本机用 Ghidra 自带工具
- 验证: `strings --version`；`objdump --version`

### hexdump —— 十六进制查看密文/常量

- 安装与验证见 [[re-fw-extract]] 工具准备（hexdump）

### Detect It Easy（DIE）—— 可选，快速签名识别（Windows 常用）

- Windows: GitHub releases 下载便携版 https://github.com/horsicq/Detect-It-Easy（`diec.exe` CLI / `die.exe` GUI）；`choco install die`（部分镜像有）
- Linux: AUR `yay -S detect-it-easy` 或 releases 的 Linux 版
- macOS: 源码构建（Qt 依赖）或 Wine 跑 Windows 版
- 验证: `diec --help` 输出用法；`diec sample.bin` 能输出签名

## 操作步骤

按顺序执行，每步记下结果。判定产物（算法假设 + 证据）传给 [[re-crypto-keys]] / [[re-crypto-decrypt]]。

1. **常量表指纹（AES S-box / CRC 表 / MD5 IV）**：
   ```sh
   # 静态数据段找常量表候选：连续 256 字节、熵低、无 ASCII
   strings -n 8 sample.bin | head -50
   objdump -s -j .data sample.bin | head -60
   # 搜索 AES S-box 开头（前 16 字节特征）
   python3 - <<'EOF'
   data = open('sample.bin','rb').read()
   aes_sbox = bytes.fromhex('637c777bf26b6fc53001672bfed7ab76')
   crc32_tab_be = bytes.fromhex('0000000077073096ee0e612c990951ba')   # 标准 CRC32 表前 16 字节（poly 0xEDB88320，显示序/BE）
   crc32_tab_le = bytes.fromhex('00000000963007772c610eeeba510999')   # 同一表在 x86/ARM 小端二进制内存中的字节序
   for name, sig in [('AES_SBOX', aes_sbox), ('CRC32_TAB(BE)', crc32_tab_be), ('CRC32_TAB(LE)', crc32_tab_le)]:
       i = data.find(sig)
       while i != -1:
           print(f"{name} @ 0x{i:x}"); i = data.find(sig, i+1)
   EOF
   ```
   - 命中 AES S-box（256 字节表）→ AES 候选；命中 CRC 表 → 有 CRC/校验（可能配合 [[re-proto-rev]] 步骤 3）；命中 MD5 IV → MD5 候选
   - 字节序：上面列出的 hex 均为显示序（BE 阅读序）。小端二进制（x86/ARM）里常量表在内存中的实际字节为 LE 序——CRC 表同时搜 `00000000963007772c610eeeba510999`（脚本已含），MD5 IV 显示序为 `67452301efcdab89...`，LE 序列化为 `0123456789abcdeffedcba9876543210`（两种模式都搜）
   - 没命中 → 不排除动态生成表（见坑 2），继续下一步

2. **熵分析定位密文（区分密文与明文区域）**：
   ```python
   data = open('sample.bin','rb').read()
   import math, collections
   for base in range(0, len(data), 4096):
       blk = data[base:base+4096]
       if not blk: break
       c = collections.Counter(blk); n = len(blk)
       h = -sum((v/n)*math.log2(v/n) for v in c.values())
       if h > 7.0: print(f"0x{base:x}: entropy={h:.2f}  <- 高熵区(密文/压缩候选)")
   ```
   - 高熵区（>7.0）→ 密文或压缩数据候选，记偏移供 [[re-crypto-decrypt]] 定位输入点
   - 低熵区但看起来"乱"（无 ASCII、无结构）→ 可能自定义加密或简单变换（下一步）

3. **XOR / ROL / ROR 单字节模式检测**：
   ```python
   data = open('sample.bin','rb').read()
   for key in range(256):
       dec = bytes(b ^ key for b in data)
       score = sum(1 for b in dec if 32 <= b < 127)
       if score > len(data) * 0.6: print(f"XOR key=0x{key:02x}, printable={score/len(data):.0%}")
   ```
   - 检测结果"可打印率 >60%" → 单字节 XOR；解密交给 [[re-crypto-decrypt]]
   - ROL/ROR：观察密文相邻字节关系（`x ^ rol(x)` 对同一 key 重复出现）；或找 256 轮换表（与 S-box 类似但值呈循环移位特征）
   - 有密码学直觉也行：单字节变换的结果通常保留原分布特征，先试最简单的再升级（见坑 1）

4. **常见算法流程特征（轮数 / 分组）**：
   - 反汇编/反编译里找特征函数形态：AES 有 10/12/14 轮（128/192/256 位）循环结构 + 常数表引用（配合步骤 1）；DES 有 16 轮 + 置换表（64 位分组）；RC4 有 256 字节 KSA/PRGA 循环
   - 数据侧：分组加密 → 密文长度是块大小整数倍（16 字节对齐的常见）；流密码 → 长度与明文一致
   - 长度规律（16/32 字节对齐）+ 常量表指纹 → 分组加密（AES 最可能，先按 AES 试）；长度任意 → 流密码（RC4/XOR/ChaCha）
   - 反编译工具有 auto-detection 时先用它（Ghidra 的 FindCrypt 脚本 / IDA 的 FindCrypt2）交叉确认

5. **动态侧确认（Frida 断在加密函数）**：
   - 静态结论有歧义（多个候选）时，沙箱内（[[re-sandbox]]）运行样本，Frida hook 可疑调用：
     ```sh
     pip install frida-tools
     frida -p <pid> -l hook.js
     ```
     ```js
     // hook.js: 断在疑似加密函数，打印入参（密文/明文）与返回
     Interceptor.attach(Module.findExportByName(null, "crypt_fn"), {
       onEnter(args) { console.log("arg0:", hexdump(args[0])); },
       onLeave(ret)  { console.log("ret:", hexdump(ret)); }
     });
     ```
   - 观察入参是否为高熵密文（对应步骤 2 的偏移）、返回是否变可读 → 确认该函数就是加密/解密点
   - hook 目标名不确定时先 `frida -p <pid> -l /dev/stdin` 里用 `Process.enumerateModules()` 找动态加载的加密库
   - 动态确认结果反哺静态假设：哪个候选函数真的吃到密文，就用哪个（见坑 4 的算法组合：最内层先确认）

## 跨域联合

- [[re-protocol]]：本网关工作流第 2 步（加密识别）——流量是密文时的必经环节
- [[re-malware]]：C2 通信加密识别（re-malware 第 4 步：netcap → crypto-id → crypto-keys → crypto-decrypt）
- [[re-firmware]]：固件内加密通信/加密固件层的算法识别（配合 [[re-fw-extract]] 解包失败时的加密层判断）
- [[re-crypto-keys]] / [[re-crypto-decrypt]]：下游——识别出算法后找密钥、写解密
- [[re-binary-core]]：反编译佐证（[[re-ghidra]] / [[re-ida]] / [[re-radare2]] 的 FindCrypt 类脚本）；动态确认在 [[re-sandbox]] 内
- [[re-anti-analysis]]：加壳样本先脱壳再做常量表指纹（壳层常量会污染指纹）

## 常见坑与陷阱

- **自定义加密先试简单模式（XOR）再升级**：现象——花半天做 AES 指纹，最后发现是单字节 XOR；原因——先入为主假设标准算法，没先做廉价检查；对策——步骤 3 的单字节 XOR/ROL/ROR 检测 30 秒内做完，再上常量表指纹与轮数分析（便宜假设先行）
- **表隐藏（动态生成）→ 指纹失效**：现象——静态数据段找不到 AES S-box/CRC 表，误判"非标准算法"；原因——算法运行时动态生成常量表（常见反分析手法，见 [[re-anti-analysis]] 域）；对策——步骤 5 动态确认：运行后内存（[[re-memdump]]）里搜表特征，或 Frida 断在轮函数看引用
- **算法组合（先 XOR 再 AES）需分层识别**：现象——按 AES 解出"明文"仍是乱码，或 XOR 检测可打印率不足；原因——多层加密叠加，单层假设不全；对策——先剥最内/最外层（观察哪个层次剥掉后熵下降、可读性上升），一层层确认，每层识别结果独立记录再组合（见步骤 5 的最内层优先原则）
- **把压缩当加密**：现象——熵 >7.0 高熵区按加密处理，解密脚本对不上；原因——zlib/LZMA 压缩同样高熵；对策——先看高熵区前 2-4 字节是否有压缩格式 magic（`78 9C` gzip/zlib、`1F 8B` gzip），有则先用 `zlib.decompress`/`binwalk`（见 [[re-fw-extract]]）试解压再谈加密
- **只搜 S-box 会漏掉变体实现**：现象——搜 256 字节 S-box 表没命中，误判"非 AES"，实际是 AES；原因——实现用位切片/即时计算 S-box（不存表），但密钥调度仍常保留 16 字节 Rcon 表，或改用 MixColumns 乘法表（GF(2^8) 乘 2/3/9/11/13/14）；对策——补充搜 Rcon 序列（`01 02 04 08 10 20 40 80 1B 36 ...`，0x1B 是特征值）与乘法表布局，多表交叉确认再定性
- **指纹命中 ≠ 加密函数在用**：现象——搜到 AES S-box/CRC 表就按该算法分析半天，实际业务是别的加密；原因——常量表可能来自未调用的静态库代码或壳层常量（先脱壳再指纹，见 [[re-anti-analysis]]）；对策——指纹命中后必须 xref 确认表被引用（谁引用、是否在加密路径上），与轮数/分组长度（16/24/32 对齐）交叉，动态侧（步骤 5）最终确认
