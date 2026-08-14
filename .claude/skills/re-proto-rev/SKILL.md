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
- **Scapy 内置层绑定劫持自定义载荷**：现象——自定义协议载荷被 Scapy 自动解成 DNS 等其他内置层，字段全乱（如 UDP 53 载荷解出来总是默认值）；原因——`bind_layers()` 的默认绑定（UDP/53→DNS 等）在 `guess_payload_class()` 里先命中；对策——`split_layers()` 解除默认绑定，自定义协议类 override `guess_payload_class()` 显式分发，或解析脚本每包用自定义类强制构造
- **短包/固定长度字段静默降级 Raw**：现象——解析器对某些包无报错输出 Raw / 字段错位，包一多错得隐蔽；原因——包短于字段最小长度时 Scapy 静默把整包当 Raw（无 Wireshark 式 malformed 标记），`StrFixedLenField` 与包缓存交互还会构建不一致；对策——解析前显式检查载荷长度 ≥ 字段和，短包单独记录不硬解；每个自定义类做 round-trip 验证（`bytes(pkt)` 再解回，比对上机字节）后再批量跑
- **以太网尾部（trailer/FCS）不保留**：现象——抓到的短帧重注入后，对端 Wireshark 报 "ETHERNET FRAME CHECK SEQUENCE INCORRECT"、帧短 14 字节；原因——Scapy 不显示也不保留以太网 trailer/FCS；对策——重注入用原始字节而非 round-trip 后的包，或在本机环回（lo）用 L3 注入避开以太网层

- **只读序列化函数，布局单边确认**：现象——按 serialize 推的字段顺序在真实流量里对不上；原因——打包/解包可能不对称（条件字段、版本分支）；对策——**序列化/反序列化函数对读互证**（serialize vs parse），两个方向对上了才是真布局；协议库通常同时含打包/解包函数
- **漏掉协议行为锚点**：现象——特殊命令（心跳/时间校正）走独立组装路径，按通用帧结构解析全乱；原因——协议库内硬编码的特判字符串/命令是行为锚点；对策——grep 原生库与配置里的命令字符串（heartbeat/correcttime 类），先定位特殊路径再按通用结构解析
- **Java 客户端忽略 JNI 契约**：现象——原生库逆向找不到入口；原因——Java 层通过 JNI 调原生，`Java_包名_类名_方法名` 导出就是接口文档（stripped 库也保留）；对策——`nm -D` 列 JNI 导出，函数名直接给契约（encode/parse/setKey 分工），从导出函数开始逆向而非全库扫
- **IRC/文本协议分片在单词中间**：现象——从抓包提取的协议消息里出现"半个词"（如 "giant s"、"undead eye"），按消息边界解析材料/字段错位；原因——IRC 服务器（InspIRCd）按 ~400 字节硬切长消息（不尊重单词边界），客户端收到后**拼接全部分片再按分隔符重分割**；对策——按客户端逻辑处理：拼接相邻消息（`Join(msgs, "")`）→ 再按分隔符（`,` 等）分割，而不是按消息边界独立解析；TSHARK follow 的 ascii 模式有 ~451 字节显示截断，长数据必须用 raw（hex）模式提取
- **消息累积触发机制**：现象——协议客户端对长消息分片处理，只在特定条件下触发完整处理；原因——客户端按"结束标记"累积消息（如以 `.`/`?` 结尾才处理整段），中间分片只是缓存；对策——反编译客户端消息处理器找累积条件（包含自己名字 + 结束字符等），重放时按该格式构造，否则消息被静默丢弃
- **伪服务端重放验证协议**：现象——协议逻辑复杂、静态逆向慢；原因——客户端程序（bot/C2 信标）逻辑在交互中触发；对策——伪造服务端（假 IRC/HTTP + DNS hook 到本地）按 pcap 真实序列重放，观察客户端行为（发送消息/调用链），快速验证协议理解
- **Web 验证码/现代 JS 协议：从 Verify 接口反向推**：现象——直接逆向验证码加密算法无从下手，或还原后校验仍失败；原因——验证码真正提交的数据全部封装在单一字段（如 captchaBody），算法只是最后一步；对策——流水线：抓 Verify 请求 → 定位核心字段 → JS 插桩找 SDK 加密前明文 plain → 逐个分析 plain 字段来源（接口返回免算 / 缺口识别：下载图片+OpenCV 找缺口算拖动距离 / 浏览器环境采集按 SDK 格式生成 / 轨迹坐标）→ 明文完全一致后加密反而是最简单一步（沿 SDK 调用链执行与浏览器一致的加密流程）；核心原则是**输入完全一致而非算法等价**
- **协议化时同步算额外签名层**：现象——核心字段（captchaBody）还原正确 Verify 仍被拒；原因——Verify 之外还有页面 SDK 自动生成的请求保护签名（协议化时漏算）；对策——从页面 SDK 完整调用链确认所有自动生成参数一并纳入；同类场景先列全"请求包含的所有非手工字段"再实现
