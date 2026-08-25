# tcpdump / tshark / mitmproxy 命令速查与操作序列

工具族分工：tcpdump（捕获 + BPF 捕获过滤）→ tshark/capinfos（pcap 分析与导出）→ mitmproxy（TLS 中间人）。字段名一律用 `tshark -G fields | grep <关键字>` 核验；显示过滤语法随版本演进（4.x 变化见 [[gotchas]]）。

## 命令族速查

### tcpdump —— 捕获（BPF 捕获过滤，内核侧生效）

| 用途 | 命令 |
|---|---|
| 列接口 | `tcpdump -D` / `dumpcap -D` |
| 按 IP 抓 | `sudo tcpdump -i eth0 host 1.2.3.4 -w out.pcap` |
| 按端口抓 | `sudo tcpdump -i eth0 port 443 -w out.pcap` |
| 组合 + 排除 | `sudo tcpdump -i eth0 '(host A or host B) and not port 53'`（shell 里括号要引号） |
| 限包数 | `-c 500` |
| 禁反向解析 | `-n`（`-nn` 连端口服务名也不解析） |
| 限捕获长度 | `-s 200`（默认 262144 全包长） |
| 轮转写盘 | `-C 100 -W 10`（100MB×10 文件）；`-G 60 -w out-%H%M%S.pcap`（按秒切） |
| 离线读 | `tcpdump -r out.pcap -n -c 20` |
| 抓回环 | `-i lo`（本机自连流量必经） |
| 抓所有接口 | `-i any`（多网卡排障先用它） |

### tshark —— 分析/导出（显示过滤，用户态生效）

| 用途 | 命令 |
|---|---|
| 字段导出 | `tshark -r f.pcap -T fields -e ip.src -e ip.dst -e tcp.dstport` |
| 显示过滤 | `-Y '<filter>'`（如 `ip.addr == 1.2.3.4`、`tcp.port == 8080`、`dns.qry.name contains "evil"`） |
| 会话统计 | `-q -z conv,tcp`（`conv,ip` 按 IP 对） |
| 协议层级 | `-q -z io,phs` |
| HTTP 请求列表 | `-Y 'http.request' -T fields -e http.host -e http.request.uri` |
| SNI 列表 | `-Y 'tls.handshake.type == 1' -T fields -e tls.handshake.extensions_server_name` |
| DNS 查询名 | `-Y dns -T fields -e dns.qry.name` |
| JSON 输出 | `-T json -e ip.src -e dns.qry.name -Y dns \| jq .`（脚本消费） |
| 导出子集 pcap | `-w sub.pcap -Y '<display filter>'` |
| 字段名查证 | `tshark -G fields \| grep -P '\t<字段名>\t'` |

### capinfos / mergecap / editcap —— pcap 管理（同族）

| 用途 | 命令 |
|---|---|
| pcap 元信息 | `capinfos f.pcap`（包数/时长/时间戳范围/截断标志） |
| 合并 | `mergecap -w all.pcap a.pcap b.pcap` |
| 切分 | `editcap -c 100000 big.pcap split`（每 10 万包一个文件） |
| 改写时间戳 | `editcap -t +2 f.pcap out.pcap`（漂移校正） |

### mitmproxy —— TLS 中间人

| 用途 | 命令 |
|---|---|
| 常规代理 | `mitmproxy --listen-port 8080 --mode regular` |
| 透明代理 | `mitmproxy -p 8080 --mode transparent`（配合 nat REDIRECT 引流） |
| 脚本化 | `mitmdump -s script.py`（Python 插件：记录/改写请求） |
| 无界面面板 | `mitmweb`（浏览器查看实时流） |

### NFQUEUE —— 内核态包截获/转发点

```sh
sudo iptables -I FORWARD -j NFQUEUE --queue-num 1     # 转发链
sudo iptables -I OUTPUT -j NFQUEUE --queue-num 1      # 本机出站（按需）
# 用户态 handler（python NetfilterQueue）逐包 verdict；无 handler 时流量阻塞
# 用完必须同时删除两条规则；TLS 中间人走 nat REDIRECT，不经 NFQUEUE（两套规则会互相干扰）
```

## 常用操作序列

### 1. 沙箱内 C2 回连捕获（隔离 → 抓包 → 验证）

```
[[re-sandbox]] 网络隔离（INetSim / fake DNS / 断网）就绪
→ 抓包点：INetSim 主机或沙箱虚拟网卡，tcpdump -i eth0 -w c2.pcap
→ 运行样本（沙箱内）→ 验证 ping 8.8.8.8 不通、INetSim 有查询日志、pcap 有流量
→ tshark -q -z conv,tcp -z io,phs 出会话与协议分布 → 记入分析笔记
```

### 2. HTTPS 明文解密（mitmproxy CA + 透明引流）

```
mitmproxy -p 8080 --mode transparent（首次生成 ~/.mitmproxy/mitmproxy-ca-cert.pem）
→ 沙箱内把 CA 装入信任库（cp ... && update-ca-certificates）
→ sysctl net.ipv4.ip_forward=1 + iptables -t nat PREROUTING/OUTPUT REDIRECT --to-port 8080
→ 运行目标 → 界面出现明文请求；未出现 = 证书未信任或流量没引过来
→ 分析完清理 nat 规则并还原 ip_forward
```

### 3. 大 pcap 分诊（先统计再子集）

```
capinfos 看规模 → tshark -q -z conv,tcp 会话表 → -q -z io,phs 协议分布
→ 按目标会话导出子集：tshark -w sub.pcap -Y 'ip.addr == X'
→ 子集上 -T fields 提取 URL/SNI/长度 → 喂给 [[re-proto-rev]]
```

### 4. 协议逆向原料导出（字段 → 结构化）

```
tshark -r f.pcap -Y '<协议过滤>' -T fields -e <字段> -E header=y -E separator=, > flows.csv
# 自定义协议逐层确认字段名（-G fields 查证），或 -T json 全量输出给 jq 提取
```

## 实现教训（内化）

- 捕获过滤（-f/BPF）在内核侧丢弃不匹配包，误抓不可逆；显示过滤（-Y）pcap 仍在——宁宽抓窄析
- 字段名是硬约束：写错直接报 "Some fields aren't valid" 或取不到值——用 `-G fields` 查，别凭记忆
- 统计类结论用 `-q -z` 直接输出，别拿 `-T fields` 手工聚合
- 中间人改变流量特征（TLS 指纹/证书/时序），目标有 TLS 指纹校验时会被发现（见 [[re-tls]]）
- 先屏显后写盘：`-w` 之前先不带 `-w` 跑几秒确认过滤命中

## 使用注意

- 全部在沙箱内执行（[[platform-tips]] 最高原则）；抓包前确认网络隔离就绪
- 产物（pcap 路径 + sha256）入档（[[re-triage]] 惯例）；结论写 [[analysis-contract]]
- 版本相关行为（显示过滤语法、字段名）以本机 Wireshark 版本为准（见 [[gotchas]]）
