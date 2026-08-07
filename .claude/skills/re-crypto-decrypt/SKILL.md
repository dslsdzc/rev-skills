---
name: re-crypto-decrypt
description: >
  加密数据还原：定位解密函数、写解密脚本。
  触发词：解密、decrypt、还原数据、解密流量
---

# 加密数据还原

## 何时使用 / 何时不用

- 用：需要把密文（数据 blob / 流量 / 配置段）还原成明文
- 用：算法与密钥已知（或已由 [[re-crypto-id]] / [[re-crypto-keys]] 得出），需要批量解密
- 用：从样本里还原解密逻辑并重写为独立可复用的脚本
- 不用：算法/密钥都未知（先 [[re-crypto-id]] → [[re-crypto-keys]]）
- 不用：静态可读的明文（[[re-triage]] 熵低直接读）
- 不用：想跑原样本看输出（那是 [[re-behavior]] / [[re-sandbox]] 的活——解密脚本是为了脱离样本复现）

## 工具准备

所有工具先验证再使用。本技能处理的是转储/反编译产物与密文数据，运行样本环节在 [[re-sandbox]] 内（[[platform-tips]] 最高原则）。

### python3 + pycryptodome —— 解密脚本主力

- Linux: `apt install python3 python3-pip` / `dnf install python3 python3-pip` / `pacman -S python python-pip`
- macOS: `brew install python`
- Windows: python.org 安装包（勾选 Add to PATH）；WSL 内 Linux 版
- 加密库: `pip install pycryptodome`（AES/DES/RSA/ChaCha 等标准算法）
- 验证: `python3 -c "from Crypto.Cipher import AES; print('ok')"`；`python3 --version`

### 目标程序转储/反编译产物 —— 还原算法的依据

- 转储: [[re-memdump]] 默认转储（gcore）——定位密文输入点与解密调用现场
- 反编译: [[re-ghidra]] / [[re-ida]] / [[re-radare2]] 的产物（函数反编译视图）
- 验证: `file out` 是 ELF core；反编译器里能找到目标函数（`ghidra` / `rizin` 可启动）

### angr（可选）—— 符号执行补足难还原的逻辑

- 全平台: `pip install angr`（Python 3.8+，依赖多，建议 venv: `python3 -m venv venv && venv/bin/pip install angr`）
- 验证: `venv/bin/python -c "import angr; print(angr.__version__)"`
- 用途: 反编译分支爆炸/混淆严重时，用符号执行求解密函数输出（加载目标二进制 → 设密文输入为符号 → 约束求解）

## 操作步骤

按顺序执行，每步记下结果。前提：算法（[[re-crypto-id]]）与密钥（[[re-crypto-keys]]）已确认或至少有一方候选；脚本与验证结果（明文样本 + sha256）存档供报告引用。

1. **定位解密函数（交叉引用密文输入点）**：
   - 从密文偏移出发：[[re-crypto-id]] 步骤 2 的高熵区偏移 → 反编译器里找读取该偏移/该全局变量的函数 → 沿调用链看谁写入了它（写入方常是解密函数）
   - 从 API 出发：[[re-crypto-keys]] 步骤 4 找到的 `Crypt*`/`EVP_*` 调用点就是候选；观察入参的密文指针是否指向步骤 2 的偏移
   - 动态辅助: [[re-gdb]] / [[re-x64dbg]] 在候选函数下断点（沙箱内），打印入参/返回值，确认它输出可读明文
   - 找不到明确函数 → 密文可能由内联展开的算法处理（无调用边界），回 [[re-crypto-id]] 用数据特征定位（常量表引用处）

2. **反编译还原算法**：
   - 把反编译视图逐段抄译成伪代码，明确：算法（AES-CBC/自定义 XOR…）、密钥与 IV 来源（固定值/派生/上下文）、模式与填充（CBC 的 IV 在哪、PKCS7 还是零填充）
   - 自定义算法: 逐条翻译位运算（XOR/移位/查表），注意字节序（[[re-proto-rev]] 坑 1 同理——长度/密钥字段先试大小端）
   - 还原标准算法时留意细节：AES 用 CBC 还是 ECB、key 长度 16/24/32、IV 是否复用密钥（常见错误实现，见坑 1）
   - 反编译看不清的循环/查表逻辑 → angr 符号执行兜底（构造求解脚本，把函数当黑盒求输出）

3. **重写为独立脚本（python）**：
   ```python
   # decrypt.py —— 按反编译还原的算法重写
   from Crypto.Cipher import AES
   import sys
   key = bytes.fromhex("...")          # 来自 [[re-crypto-keys]] 步骤 1/2/5
   iv  = key[:16]                       # 样本实现: IV = key 前 16 字节
   data = open(sys.argv[1], 'rb').read()
   pt = AES.new(key, AES.MODE_CBC, iv).decrypt(data)
   print(pt)                            # 或写文件 + 后续校验
   ```
   - 脚本参数化（密钥/IV/输入文件走参数或配置），一次写对、反复复用——批量解流量用
   - 关键：脚本逻辑必须与样本一致（填充处理、尾部截断），不一致时回查边界条件（见坑 1）

4. **用已知明文验证**：
   - 已知明文来源：协议头 magic（如 `\xAA\x55`）、文件头（`PK` zip / `\x89PNG`）、报文字段（[[re-proto-rev]] 步骤 2 的固定头）、或 [[re-behavior]] 行为里观察到的明文串
   - 验证方式：解密输出里能找到已知明文片段 → 成功；找不到 → 依次检查：密钥/IV 是否对（[[re-crypto-keys]] 候选逐个试）、字节序、填充处理、是否还有外层加密（见坑 3）
   - 无已知明文时用"可读性"验证：输出可打印率 >70% 或通过 `file -` 识别出格式（PDF/zip/文本）→ 视为成功候选

5. **流量场景：解出明文流量流**：
   - 已按 [[re-crypto-id]] / [[re-crypto-keys]] 确认流量加密算法与密钥后，从 pcap 提取密文载荷（[[re-netcap]] 步骤 3 tshark 导出）：
     ```sh
     tshark -r c2.pcap -Y 'tcp.payload' -T fields -e data.data | sed 's/://g' | xxd -r -p > payloads.bin
     ```
   - 写批量脚本：按流切分（每 TCP 流一段）、逐段调用解密逻辑（同步骤 3 的脚本），输出明文流文件
   - 验证: 明文流里能看到协议结构（会话序号/命令字），再转 [[re-proto-rev]] 做状态机重建
   - 注意会话密钥变化（每次握手重新派生）→ 脚本里为每个会话取对应密钥（[[re-crypto-keys]] 步骤 5 的派生还原）

## 跨域联合

- [[re-protocol]]：本网关工作流第 4 步（解密）——加密通信链路的落地点（crypto-id → crypto-keys → crypto-decrypt → proto-rev）
- [[re-malware]]：C2 流量解密——re-malware 第 4 步；解出的明文（指令/配置）进行为判断与 IOC（[[re-ioc]]）
- [[re-firmware]]：固件加密层/加密通信解密——配合 [[re-fw-extract]] 解包失败时的加密层处理
- [[re-crypto-id]] / [[re-crypto-keys]]：上游——算法与密钥的输入来源
- [[re-memdump]]：密文输入点定位与解密调用现场（转储产物）
- [[re-anti-analysis]]：解密在壳内时先脱壳（见坑 2）；[[re-gdb]] / [[re-x64dbg]] 动态辅助确认函数行为
- 解出的明文转 [[re-proto-rev]] 重建状态机，或按 [[re-firmware]] / [[re-malware]] 流程继续

## 常见坑与陷阱

- **还原脚本与样本行为不一致 → 回查边界条件（长度/填充）**：现象——脚本解出的明文与样本自身输出不一样（多/少字节、尾部乱码）；原因——边界条件没对齐：填充方式（PKCS7/zero）、长度字段是否含填充、IV 是否每包变、密文尾部是否截断；对策——反编译里逐条核对填充与长度处理代码，脚本里显式实现，再回步骤 4 用已知明文验证
- **解密在壳内 → 先脱壳**：现象——在加壳样本里找不到解密函数，或找到的函数只是壳的解压；原因——密文数据/解密逻辑被壳包着，静态看是壳的初始状态（[[re-memdump]] 坑 2 同理）；对策——先 [[re-anti-analysis]] 脱壳（OEP 后再转储/反编译），脱壳产物重新做定位
- **多轮解密链**：现象——解出第一层后仍是乱码/高熵（熵 7.0+）；原因——多层加密（先 XOR 再 AES，或嵌套压缩+加密，见 [[re-crypto-id]] 坑 3）；对策——每层单独验证（解一层测一次熵与可读性），分层还原；可用"熵下降即前进一层"作为停止条件
- **密钥/IV 顺序用错解出乱码**：现象——已知明文验证失败，但算法确定是 AES；原因——key/iv 参数顺序（样本是 key||iv 拼接还是分开传）、密钥字节序、或 IV 复用/固定 IV；对策——把 [[re-crypto-keys]] 的候选（含大小端变体、IV=key 前缀等常见错误实现变体）做成参数组合循环试解，命中即可读性/已知明文判定
