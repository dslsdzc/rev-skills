---
name: re-proto-rev
description: >
  协议状态机重建：Scapy 解析、消息结构。
  触发词：协议逆向、状态机、scapy、自定义协议
---

# 协议状态机重建

## 何时使用 / 何时不用

- 用：手上有明文流量（pcap 或实时流）需要搞清"消息长什么样、双方怎么对话"
- 用：自定义协议 / 私有协议 / 未知协议的字段结构推断
- 用：C2 协议、固件通信协议的交互模式推演（握手/心跳/结束）
- 不用：流量是密文（先 [[re-crypto-id]] → [[re-crypto-keys]] → [[re-crypto-decrypt]]，解出明文再回来）
- 不用：标准协议（HTTP/TLS/DNS）——直接 Wireshark 解码器（见 [[re-netcap]] 步骤 3）
- 不用：只需要抓流量（那是 [[re-netcap]]）

## 工具准备

所有工具先验证再使用。本技能只处理数据与解析脚本，不运行样本，可免沙箱（[[platform-tips]] 最高原则）；抓流量环节在 [[re-netcap]] 内进行。

### python3 —— 解析脚本运行环境

- Linux: `apt install python3 python3-pip` / `dnf install python3 python3-pip` / `pacman -S python python-pip`（多数自带）
- macOS: `brew install python`（或 Xcode CLT 自带）
- Windows: python.org 安装包（勾选 Add to PATH）；WSL 内 Linux 版
- 验证: `python3 --version`

### scapy —— pcap 解析与协议构造主力

- 全平台: `pip install scapy`（Python 3，推荐）
- Linux: 部分发行版有包（`apt install python3-scapy`）
- 验证: `python3 -c "import scapy; print(scapy.__version__)"`
- 读 pcap 文件: `rdpcap` 即可，纯 Python 解析（无需 libpcap；libpcap 仅实时抓包 `sniff()` 时需要，强制纯 Python 解析用 `conf.use_pcap = False`）
- 验证（跨平台，写临时 pcap 再读回，不依赖 /dev/null）: `python3 -c "import tempfile,os; from scapy.all import rdpcap, wrpcap, IP, TCP, Raw; f=os.path.join(tempfile.gettempdir(),'t.pcap'); wrpcap(f,[IP()/TCP()/Raw(b'test')]); print(len(rdpcap(f)))"` —— 输出 `1` 即正常

### tshark —— 分组统计与字段初探（安装见 [[re-netcap]]）

- `tshark -r out.pcap -q -z conv,tcp` 会话统计、`-z io,stat,1` 时间序列——步骤 1 聚类用
- 验证: `tshark --version`

### binwalk —— 已知格式线索（pcap 里嵌 blob 时找格式）

- 安装与验证见 [[re-fw-extract]] 工具准备
- 用途: 解析出的字段里疑似嵌了文件/镜像（gzip/zip/PNG 等）时，用 `binwalk blob.bin` 确认格式

## 操作步骤

按顺序执行，每步记下结果。前提：**流量必须是明文**（密文先走 [[re-crypto-decrypt]]）。

1. **分组统计与聚类（长度/方向/时序）**：
   ```sh
   tshark -r out.pcap -T fields -e tcp.len -e ip.src -e ip.dst | awk '{print $1}' | sort -n | uniq -c   # 长度分布
   tshark -r out.pcap -q -z conv,tcp          # 会话列表：谁和谁、包数、字节数
   tshark -r out.pcap -q -z io,stat,1         # 每秒流量：找规律性心跳
   ```
   - 聚类目标：按方向（A→B / B→A）分组看长度分布；长度呈少量固定值 → 固定长度消息（可能无长度字段）；长度连续变化 → 变长消息（必有长度字段）
   - 找规律性间隔包（每 30s 一个固定长度小包）→ 心跳消息（见坑 3）

2. **定位固定头（magic / 长度字段）**：
   ```python
   # 提取一个方向上所有包，统计每包前 8 字节出现频率（找 magic 前缀）
   from scapy.all import rdpcap, TCP, IP
   from collections import Counter
   pkts = rdpcap('out.pcap')
   cnt = Counter()
   for p in pkts:
       if TCP in p:
           load = bytes(p[TCP].payload)
           if len(load) >= 8:
               cnt[load[:8]] += 1
   for k, v in cnt.most_common(10):
       print(v, k.hex())
   ```
   - 高频前缀 → magic（如 `0xAA55`、`\xDE\xAD\xBE\xEF`、ASCII 品牌名）；同一流中第 2-4 字节变化但前缀不变 → 变长消息，变化处是长度字段
   - 手工核对：hexdump 看几个代表包（`tshark -r out.pcap -Y 'tcp.payload' -T fields -e data.data | head`），确认 magic 与长度字段字节序（见坑 1）

3. **字段推断（类型 / 长度 / CRC）**：
   - 长度字段：取固定偏移值 vs 载荷实际长度画散点/排序核对；字节序按值合理性试（大端/小端都试一遍，见坑 1）
   - 类型字段：同长度族中首字节固定集合（如 0x01/0x02/0x03）→ 消息类型；结合时序看类型序列是否像请求-响应配对
   - CRC/校验：包尾 2-4 字节对载荷变化敏感 → 校验和（先识别出来，别当数据解析——见坑 2）；用 `crcmod`（`pip install crcmod`）试 CRC16/CRC32 常见多项式，或与载荷异或检查是否为简单 XOR 校验
   - 结构不确定时用差分法：两个只有单字节不同的包，逐字节异或 → 变化的字节就是"关键字段"位置

4. **Scapy 写解析器（自定义协议类）**：
   ```python
   from scapy.all import Packet, ByteField, ShortField, XByteField, StrFixedLenField
   class C2(Packet):
       name = "C2"
       fields_desc = [
           XShortField("magic", 0xAA55),
           ByteField("type", 0),
           ShortField("len", 0),
           StrFixedLenField("payload", b"", 64),
       ]
   # 测试解析（hex 与 fields_desc 对齐：aa55 | 01 | 000a | 54657374696e672e2e2e，len=0x000a=10 = "Testing..." 的 10 字节）
   pkt = C2(bytes.fromhex("aa5501000a54657374696e672e2e2e0000000000..."))
   pkt.show()
   ```
   - 字段顺序/宽度按步骤 2、3 的推断来；解析器能逐个字段展示（`show()`）即验证字段布局正确
   - 批处理整个 pcap：遍历 `rdpcap` 的包，跳过非目标流（源/目的 IP+端口过滤），逐包 `C2(load)` 并打印摘要，与 Wireshark 原始字节对照

5. **状态机推演（握手 / 心跳 / 结束）**：
   - 按时间顺序画出"谁发什么消息"的序列：客户端 → 服务端第 1 条（连接建立/握手请求）→ 响应 → 后续业务 → 周期心跳 → 断开
   - 对每类消息记录：方向、类型值、字段、触发条件（收到什么才发什么）
   - 验证推演：回到 pcap 里找反例——是否存在没按"状态机"走的包（有则补充状态/转移条件，或说明异常分支）；最终产出状态图（文字或 mermaid）+ 消息格式表，写入报告供 [[re-ioc]] 引用

## 跨域联合

- [[re-protocol]]：本技能是其工作流第 5 步（状态机重建）——明文流量的最终产出环节
- [[re-malware]]：C2 协议重建——re-malware 第 4 步（netcap → proto-rev → crypto-*），重建出的协议语义（握手/心跳/指令）是行为判断与 IOC 依据
- [[re-firmware]]：固件通信协议重建——re-firmware 第 6 步（固件回连 / 自定义协议）
- [[re-netcap]]：原料来源（明文 pcap 与 tshark 统计）
- [[re-crypto-id]] / [[re-crypto-decrypt]]：前置——流量密文时先解密再进本技能
- 产出（消息格式表 / 状态图）回传 [[re-ioc]] 进报告与 YARA 特征

## 常见坑与陷阱

- **长度字段字节序错误 → 解析全错**：现象——解析器按小端读长度，长度值巨大/异常，后续字段全部错位；原因——协议长度字段是大端（网络序），按主机序小端读了；对策——步骤 3 对长度字段大小端都试，用"长度值是否合理（≤ 实际载荷长度）"裁定，解析器里显式 `!H`/`!I` 网络序
- **CRC/校验先识别再解析**：现象——把包尾校验和当业务数据解析，字段错位且消息对不上；原因——未知协议里校验和与数据无法靠名字区分；对策——包尾 2-4 字节对载荷敏感变化即先假设为校验和，用 crcmod/异或验证识别，解析器里跳过或单独字段
- **心跳消息混淆**：现象——把周期心跳当业务消息，状态机出现"多发一条"的假分支，指令序列错乱；原因——心跳与业务消息同结构（同 magic 同类型前缀），只有时序规律；对策——步骤 1 的 `io,stat` 找固定周期小包，标记为心跳单独处理，状态机里作为独立状态转移
- **方向混淆（C2 交互模式）**：现象——把服务端→客户端的方向看反，命令消息被当响应、下发数据被当回包；原因——C2 中客户端主动轮询（请求里带命令）或服务端主动下发（无请求也有流量）混在一起；对策——按 IP:端口归属先明确 A/B 角色，分方向做统计（步骤 1），结合时序确认谁是主动方，状态图里标注每个转移的方向
