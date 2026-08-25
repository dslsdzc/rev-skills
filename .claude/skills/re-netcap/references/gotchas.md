# tcpdump / tshark / mitmproxy 工具特有坑与边界

## 捕获层：权限、丢包与轮转

- **普通用户抓不到包**：需要 CAP_NET_RAW——加 `sudo`，或 Debian 系把用户加入 wireshark 组（`sudo usermod -aG wireshark $USER` 后重登）；WSL1 不支持原生抓包，WSL2 可用
- **抓包点不在流量必经路径**：交换机端口/无线网卡不保证把流量镜像给本机——本机抓包只能看到本机收发；跨主机目标在网关/虚拟网卡（virbr0/vboxnet0）抓；物理旁路用 tap 或交换机镜像口
- **轮转切文件丢会话**：`-C`/`-G` 轮转只按大小/时间切，不感知会话边界——长抓包后会话可能被腰斩，先 capinfos 核对时长再下结论
- **接口选错静默无流量**：VM 桥接/多网卡宿主常见——先用 `tcpdump -i any` 确认流量在哪个接口出现

## 过滤层：语法与字段名

- **捕获过滤 ≠ 显示过滤**：`host`/`port`/`net` 是 BPF 语法，只能用于 `tcpdump -i` 与 `tshark -f`；`-Y` 与 Wireshark 过滤框用字段语法（`ip.addr == ...`/`tcp.port == ...`）——混用报 filter error 或静默无结果
- **字段名易错三例**：`tcp.dport` 不存在（合法名 `tcp.dstport`/`tcp.srcport`/`tcp.port`，`tshark -e tcp.dport` 直接报错）；`ip.addr` 匹配源或目标任一端，单侧用 `ip.src`/`ip.dst`；Wireshark 3.x 起协议名 `ssl` 全部改 `tls`（`tls.handshake.*` 而非 `ssl.*`）
- **BPF 括号被 shell 吃掉**：`( )` 在 shell 里是子 shell——过滤表达式整体加引号
- **过滤语法版本差异**：4.0 起 AND 优先级高于 OR（旧写法需加括号）；仅空白分隔（如 `ip.addr 10.0.0.1`）为语法错误；集合元素须逗号分隔；`ip.addr==1.2.3.4` 无空格写法在 3.x 同样合法

## 中间人层：TLS 解密边界

- **证书不信任则无明文**：证书固定/自有 CA/内置证书库的客户端，mitmproxy 解不开——先评估目标证书校验强度（[[re-tls]]）；固定证书场景放弃中间人，改抓 SNI 与元数据
- **透明代理只覆盖命中的端口**：REDIRECT 规则按 dport 匹配，漏配端口的流量原样直连；QUIC/HTTP3（UDP 443）不在 TCP REDIRECT 范围内，需要 QUIC 专用中间人或降级目标
- **TLS 1.3 ECH 隐藏 SNI**：加密 ClientHello 场景下 SNI 过滤失效（DoH/DoT 同理，见 SKILL.md 坑）——靠端点 IP 与信标周期补线索
- **NFQUEUE 与透明代理互相干扰**：NFQUEUE 需要用户态 handler 逐包 verdict（无 handler 流量阻塞）；mitmproxy 透明模式走 nat REDIRECT 不消费 NFQUEUE——两套规则并存时行为不可预测，只保留需要的一套

## pcap 分析层：数据质量

- **截断包缺负载**：snaplen 过小时长度字段在但负载缺失，字段导出出现空值——先 capinfos 看 "Capture length" 与包长是否一致
- **时间戳漂移**：抓包机时钟不准则会话时序失真——跨源关联（INetSim/系统日志）时核对各自时间基准
- **巨大 pcap 卡死**：几十 GB 直接开 GUI 必卡——capinfos → 统计 → 子集三步走（见 [[commands]] 序列 3）
- **半路抓包缺握手**：TLS 解密、会话重建都依赖完整握手——抓包点要在客户端同一侧从头抓

## 版本差异

- **Wireshark/tshark 4.x**：显示过滤空白要求收紧（仅空白分隔在 4.0 起为语法错误，3.6 起弃用）；AND 优先级高于 OR（旧写法需加括号）；协议名 `ssl` 已于 3.x 改名 `tls`，4.x 不再兼容旧名；4.2+ 持续新增字段与导出格式
- **tcpdump/libpcap**：默认 snaplen 262144（1.x 起）；`-C` 单位 MB、`-G` 单位秒——单位写错会多写/少写轮转文件
- **mitmproxy**：新版统一 `--mode regular|transparent` 显式指定（旧版 `--transparent` 独立参数形式随版本移除，以本机 `mitmproxy --help` 为准）；CA 在 `~/.mitmproxy/`，旧版本 CA 文件名有差异，信任库导入前先 `ls ~/.mitmproxy/` 核对
- **字段名跨版本漂移**：升级 Wireshark 后旧过滤/导出脚本失效，先 `tshark -G fields` 对一遍再跑

## 使用注意

- 全部在沙箱内执行（[[platform-tips]] 最高原则）
- 捕获产物 sha256 与路径入档；过滤与统计结论记入分析笔记（[[re-triage]] / [[analysis-contract]]）
