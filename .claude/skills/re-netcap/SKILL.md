---
name: re-netcap
description: >
  网络流量捕获：tcpdump/Wireshark/抓包。
  触发词：抓包、tcpdump、wireshark、流量分析、pcap
---

# 网络流量捕获

## 何时使用 / 何时不用

- 用：任何需要拿到网络流量的任务——恶意样本回连观察、固件通信分析、协议逆向的原料获取
- 用：已有 pcap 需要导出/统计/过滤（tshark 环节）
- 用：HTTPS/TLS 通信需要解密看明文（mitmproxy 中间人）
- 不用：流量已解密/无加密且只要协议语义（直接 [[re-proto-rev]]）
- 不用：样本不联网（静态分析先做 [[re-triage]]）
- 不用：只要抓一个包的 quick look（`tcpdump -i any -c N` 一次搞定，不必搭全流程）

## 工具准备

所有工具先验证再使用。运行样本抓包默认在沙箱内（[[re-sandbox]] 网络隔离，[[platform-tips]] 最高原则）——捕获环境与隔离环境要同时就绪。

### tcpdump —— 命令行抓包主力

- Linux: `apt install tcpdump` / `dnf install tcpdump` / `pacman -S tcpdump`
- macOS: `brew install tcpdump`（或系统自带版本）
- Windows/WSL: WSL 内 Linux 版；Windows 本机用 Wireshark 或 Npcap 自带 dumpcap
- 验证: `tcpdump --version`；`tcpdump -D` 列出接口

### wireshark / tshark —— GUI + CLI 分析（tshark 用于导出与统计）

- Linux: `apt install wireshark tshark` / `dnf install wireshark-cli wireshark` / `pacman -S wireshark-cli wireshark`（Debian 安装时选"允许非 root 抓包"，或 `sudo dpkg-reconfigure wireshark-common` 后把用户加入 wireshark 组）
- macOS: `brew install --cask wireshark`（含 tshark CLI；或 `brew install wireshark` 仅 CLI）
- Windows: `choco install wireshark`（或官方安装包）；WSL 内用 Linux 版
- 验证: `tshark --version`；`tshark -D` 列出接口；`dumpcap -D`

### mitmproxy —— HTTPS/TLS 中间人解密

- 全平台: `pip install mitmproxy`（Python 3.10+）
- macOS: `brew install mitmproxy`
- Windows: pip 版即可（或官方安装包）；WSL 内 pip 版
- 验证: `mitmproxy --version`；`mitmdump --version`

### nfqueue —— 内核态流量转发/中间人抓包点（Linux）

- Linux: `apt install iptables libnetfilter-queue1 python3-nfqueue` / `dnf install iptables libnetfilter_queue-devel python3-scapy` / `pacman -S iptables libnetfilter_queue python-nfqueue`
- macOS/Windows: 不支持（用 WSL2 内核或 Linux VM 做转发点）
- 验证: `python3 -c "import nfqueue"`；`iptables -L -n | grep -i NFQUEUE` 能看到规则

## 操作步骤

按顺序执行，每步记下结果。捕获产物（pcap 路径 + sha256）存档供 [[re-proto-rev]] / [[re-crypto-decrypt]] 使用。

1. **选择抓包点（本机 / 网关 / 中间人）**：
   - 本机: 目标程序跑在本机 → `tcpdump -i eth0 host <目标IP>`（或 Wireshark 选接口直接抓）
   - 网关/转发点: 目标在沙箱 VM / 其他主机 → 在网关主机或 VM 虚拟网卡（virbr0 / vboxnet0）抓，`tcpdump -i virbr0`
   - 中间人: 需要看 HTTPS 明文 → nfqueue 或 mitmproxy 透明代理，把目标流量强制引到本机（见步骤 4、5）
   - 沙箱场景: 抓包点在沙箱虚拟网卡 + [[re-sandbox]] 的 INetSim/fake DNS 落点（见步骤 5）
   - 决策记录：写下抓包点与理由（为什么这个点能同时看到请求与响应）

2. **tcpdump 过滤语法（先过滤再存盘）**：
   ```sh
   sudo tcpdump -i eth0 -w out.pcap            # 全量（先别这么干，见坑 4）
   # 常用过滤：
   sudo tcpdump -i eth0 host 1.2.3.4 -w out.pcap          # 按 IP
   sudo tcpdump -i eth0 port 443 -w out.pcap              # 按端口
   sudo tcpdump -i eth0 host 1.2.3.4 and tcp port 8080    # 组合，先屏显验证再存
   sudo tcpdump -i eth0 -c 500 -w out.pcap                # 限包数
   ```
   - BPF 语法要点：`and/or/not`、`host/port/proto`、括号分组；先不带 `-w` 屏显验证过滤命中目标再写盘
   - 组合多个条件用括号: `tcpdump -i eth0 '(host 1.2.3.4 or host 5.6.7.8) and not port 53' -w out.pcap`

3. **tshark 导出与统计（从已有 pcap 提取关键流）**：
   ```sh
   tshark -r out.pcap -T fields -e ip.src -e ip.dst -e tcp.dport | sort | uniq -c | sort -rn   # 会话统计
   tshark -r out.pcap -Y 'http.request' -T fields -e http.host -e http.request.uri             # 只看 HTTP 请求
   tshark -r out.pcap -Y 'tls.handshake.type == 1' -T fields -e tls.handshake.extensions_server_name   # SNI
   tshark -r out.pcap -w filtered.pcap -Y 'host 1.2.3.4'                                       # 按显示过滤导出子集
   ```
   - 统计结论（会话数、协议分布、异常连接）记入分析笔记，是 [[re-proto-rev]] 步骤 1 的输入

4. **HTTPS 解密准备（mitmproxy CA）**：
   ```sh
   mitmproxy -p 8080 --mode transparent        # 透明模式（配合 nfqueue 转发）
   # 或
   mitmproxy --set console_eventlog_verbosity=error --listen-port 8080 --mode regular   # 常规代理模式
   ```
   - 首次运行生成 CA 于 `~/.mitmproxy/mitmproxy-ca-cert.pem`；把该 CA 装进目标系统/进程信任库（沙箱内 `cp mitmproxy-ca-cert.pem /usr/local/share/ca-certificates/ && update-ca-certificates`）
   - 验证: 目标进程访问 HTTPS 站点，mitmproxy 界面出现明文请求（未出现 = 证书未信任或流量没引过来，见坑 2）
   - 目标进程需要代理时: 设置 `HTTP_PROXY`/`HTTPS_PROXY` 环境变量或系统代理；不走代理的进程用透明模式

5. **沙箱内隔离抓包（[[re-sandbox]] 网络隔离）**：
   - 前置：按 [[re-sandbox]] 步骤 2 做网络隔离——断网（Host-only / `--net=none`）/ fake DNS（/etc/hosts 或 dnsmasq 指向本机）/ INetSim（沙箱 DNS 指向 INetSim 主机）
   - 抓包点：INetSim 主机侧抓全量（`tcpdump -i eth0 -w c2.pcap`），同时拿到样本请求与模拟响应——C2 分析标准做法
   - 验证: 沙箱内样本回连被 INetSim 记录且 pcap 有对应流量；`ping 8.8.8.8` 不通确认无真实外联（[[platform-tips]] 最高原则）
   - 需要 nfqueue 重定向时（透明代理）:
     ```sh
     sudo iptables -I FORWARD -j NFQUEUE --queue-num 1      # 转发链
     sudo iptables -I OUTPUT -j NFQUEUE --queue-num 1       # 本机出站（按需）
     ```
     python 侧用 nfqueue 绑定处理或交给 mitmproxy 透明模式消费队列；分析完删规则 `iptables -D FORWARD -j NFQUEUE --queue-num 1`

## 跨域联合

- [[re-protocol]]：本技能是其工作流第 1 步（捕获）——所有协议分析的原料入口
- [[re-malware]]：C2 回连捕获——re-malware 工作流第 4 步的捕获环节，配合 [[re-sandbox]] INetSim/fake DNS 环境
- [[re-firmware]]：固件通信捕获——仿真环境的虚拟网卡抓包（[[re-fw-emulate]] 启动后在本机抓）
- [[re-sandbox]]：网络隔离是捕获的前置（INetSim / fake DNS / 断网），防真外联（[[platform-tips]] 最高原则）
- 捕获产物供 [[re-proto-rev]]（明文）与 [[re-crypto-decrypt]]（密文）消费

## 常见坑与陷阱

- **沙箱网络不隔离 → 真外联**：现象——样本真实访问了外网 C2，行为结果与流量都不可信；原因——跳过 [[re-sandbox]] 网络隔离直接联网跑（NAT 默认允许出站外联）；对策——抓包前先按步骤 5 隔离（断网/fake DNS/INetSim），验证 `ping 8.8.8.8` 不通再跑样本
- **TLS/HTTPS 抓包只见密文**：现象——pcap 里全是 TLS 握手与加密记录，看不到明文协议内容；原因——没有中间人，TLS 会话两端加密；对策——步骤 4 上 mitmproxy 透明/常规代理，目标信任 mitmproxy CA 后再抓，界面应出现明文
- **过滤表达式写错漏关键流**：现象——抓了半天 pcap 里没有目标流量（比如只按了 IP 没按端口，或 `and/or` 优先级用错）；原因——BPF 语法组合错误且没先屏显验证；对策——先不带 `-w` 屏显跑几秒确认命中目标（IP/端口/方向都对）再写盘
- **抓包文件巨大 → 分析卡死**：现象——全量抓包 pcap 几十 GB，tshark 统计/导出长时间无响应；原因——没先过滤就存盘（步骤 2 的正确做法是先过滤再存）；对策——用 BPF 过滤 + `-c` 限包数 + `-s` 限捕获长度，先按会话统计缩小范围再导出子集（步骤 3）
- **DoH/DoT 回连抓不到查询内容**：现象——fake DNS/INetSim 日志零查询，pcap 里只有到 dns.google / cloudflare-dns.com 的 443（DoH）或 853（DoT/DoQ）密文流，样本回连域名线索完全缺失；原因——样本实现自有 DNS 客户端直连加密解析器，不经系统 resolver——DNS 层监控看不到查询，内容又被 TLS 加密；对策——把"已知 DoH 端点 + 无 SNI 的 TLS 握手 + 非浏览器进程直连 DoH 解析器"当 C2 信号捕获（DoT/DoQ 的 853 端口可防火墙直断，DoH 只能重定向端点 IP 或 mitmproxy 中间人 443），配合信标周期分析补内容缺失，单凭"查询内容"定位回连在此场景不成立
