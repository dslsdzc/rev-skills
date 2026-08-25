---
name: re-tls
description: >
  TLS/加密流量深度：指纹、密钥导出、TLS 1.3。
  触发词：TLS、SSL、ClientHello、指纹、SSLKEYLOG、证书分析
capabilities: [tls-analysis, crypto-identification]
---

# TLS/加密流量深度分析

## 何时使用 / 何时不用

- 用：TLS/HTTPS 流量要"解密看明文"（有 keylog 或中间人）——C2 通信、固件回连、加密应用协议
- 用：只有密文 pcap 也要做深度——ClientHello/证书指纹聚类、异常 TLS 特征判定
- 用：证书链验证/证书内容分析（openssl x509）
- 不用：只抓包不深入（那是 [[re-netcap]]）
- 不用：流量已解密、无 TLS 层（直接 [[re-proto-rev]] 重建状态机）
- 不用：非标准 TLS 的自定义加密（走 [[re-crypto-id]] → [[re-crypto-keys]] → [[re-crypto-decrypt]]）
- 注意：本技能处理流量与密钥文件，不运行样本，默认可免沙箱；抓包环节按 [[re-netcap]] 在隔离环境进行（[[platform-tips]] 最高原则）

## 工具准备

所有工具先验证再使用。

### tshark / wireshark —— 解析、指纹、解密主力（安装见 [[re-netcap]]）

- Linux: `apt install wireshark tshark` / `dnf install wireshark-cli wireshark` / `pacman -S wireshark-cli wireshark-qt`
- macOS: `brew install --cask wireshark`（含 tshark CLI）；Windows: `choco install wireshark`
- 验证: `tshark --version`；`tshark -r out.pcap -Y 'tls.handshake.type == 1' | head -1` 能解析 ClientHello
- JA3 字段（Wireshark 3.6+ 内置）与 JA4 字段（Wireshark 4.2+ 原生，仅客户端）: 验证 `tshark -r out.pcap -T fields -e tls.handshake.ja4 | head -1` 有输出；本机字段存在性以 `tshark -G fields | grep -iE 'ja3|ja4'` 为准

### openssl —— 证书解析与 TLS 交互（跨 OS）

- Linux: `apt install openssl` / `dnf install openssl` / `pacman -S openssl`（多数预装）
- macOS: `brew install openssl`（keg-only，PATH 加 `/opt/homebrew/opt/openssl@3/bin`（Apple Silicon）或 `/usr/local/opt/openssl@3/bin`（Intel））
- Windows: `choco install openssl.light`（PATH 需手动加，见包说明）或 Git for Windows 自带 `openssl.exe`
- 验证: `openssl version`

### python3 —— 指纹聚类/批量分析脚本（可选）

- 安装与验证见 [[re-proto-rev]] 工具准备（python3）

### SSLKEYLOG 环境 —— Chrome/Firefox 密钥导出（非独立工具）

- Chrome: 启动前设置环境变量 `SSLKEYLOGFILE=/tmp/keys.log`（Linux/macOS）或 `set SSLKEYLOGFILE=C:\keys.log`（Windows）
- Firefox: 同样环境变量（设置后需重启浏览器）
- Wireshark: 编辑 → 首选项 → Protocols → TLS → (Pre)-Master-Secret log filename 指向该文件；tshark 侧用 `-o tls.keylog_file:...`
- 验证: 设置后访问 HTTPS 站点，keys.log 出现 `CLIENT_HANDSHAKE_TRAFFIC_SECRET` 等行（TLS 1.3）或 `CLIENT_RANDOM` 行（TLS 1.2）

### mitmproxy —— 中间人解密（可选，安装见 [[re-netcap]]）

- 场景: 无 keylog 权限的第三方程序（自实现 TLS 栈、证书固定见坑 4）
- 验证: `mitmdump --version`

## 操作步骤

按顺序执行，每步产物（指纹表/证书/解密流量）存档 sha256 + 路径（[[re-ioc]] 证据链要求）。

1. **ClientHello 指纹（JA3/JA4）**：
   ```sh
   # JA3（ClientHello 协商参数哈希，Wireshark 3.6+ 内置）
   tshark -r out.pcap -Y 'tls.handshake.type == 1' -T fields \
     -e tls.handshake.ja3 -e ip.src -e tls.handshake.extensions_server_name \
     | sort | uniq -c | sort -rn
   # JA4（Wireshark 4.2+ 原生，客户端侧；含协议/版本/SNI/密码套件数/ALPN 维度）
   tshark -r out.pcap -Y 'tls.handshake.type == 1' -T fields -e tls.handshake.ja4 \
     | sort | uniq -c | sort -rn
   ```
   - 用途: 按"客户端指纹"聚类——同一指纹 = 同一客户端栈（浏览器/库/恶意工具），新簇 = 可疑客户端
   - 对照: 与公开 JA3/JA4 情报源比对命中已知恶意客户端；未命中 = 弱信号，需步骤 5 综合（坑 3）
   - 字段注: SNI（`tls.handshake.extensions_server_name`）与 IP 一起聚类——同一指纹连不同目标也是信号

2. **证书链分析（openssl x509 解析）**：
   ```sh
   # 从 pcap 提取服务器证书（DER 十六进制 → 文件；多证书链时字段逗号分隔、hex 带冒号，tr -d ':' 保险）
   tshark -r out.pcap -Y 'tls.handshake.type == 11' -T fields -e tls.handshake.certificate \
     | head -1 | tr -d ':' | xxd -r -p > server_cert.der
   openssl x509 -in server_cert.der -inform DER -text -noout | head -60
   # 实时抓取（对已知主机）
   openssl s_client -connect <host>:443 -servername <host> -showcerts </dev/null 2>/dev/null \
     | openssl x509 -noout -text
   # 证书链校验结果
   openssl s_client -connect <host>:443 -servername <host> -verify_return_error </dev/null 2>&1 \
     | grep -i 'verify return'
   ```
   - 分析点: 签发者/主题（CN/SAN）、有效期（异常日期/过期）、自签名 vs 受信 CA、SPKI/指纹（`openssl x509 -noout -fingerprint -sha256`）、证书重用（同一证书多个 C2 域 = 批量签发）
   - 注意: TLS 1.3 的 Certificate 消息（type 11）在加密握手内，`-Y 'tls.handshake.type == 11'` 匹配不到——TLS 1.3 流量需先按步骤 3 解密（SSLKEYLOG）或用 openssl s_client 实时抓取
   - 平台注: `</dev/null` 是 POSIX 语法、Windows cmd 不适用——Windows 下用 `echo | openssl s_client ...` 或去掉 `</dev/null` 交互式退出
   - 恶意特征: 自签名 + 新注册域名 + 短有效期（90 天-1 年批量自动化签发常见）

3. **SSLKEYLOG 解密（TLS 1.2/1.3 密钥导出）**：
   ```sh
   # tshark 侧解密（keylog 文件 + 重新解析）
   tshark -r enc.pcapng -o tls.keylog_file:keys.log -Y 'http' \
     -T fields -e http.host -e http.request.uri
   # 或 GUI: 首选项 → Protocols → TLS → (Pre)-Master-Secret log filename
   ```
   - TLS 1.2: keylog 记录 `CLIENT_RANDOM <hex> <master secret>`——主密钥可直接解本会话所有记录
   - TLS 1.3: keylog 记录的是各阶段 traffic secret（`CLIENT_HANDSHAKE_TRAFFIC_SECRET` / `SERVER_HANDSHAKE_TRAFFIC_SECRET` / `CLIENT_TRAFFIC_SECRET_0` / `SERVER_TRAFFIC_SECRET_0` / `EXPORTER_SECRET`）——没有 1.2 的 master secret，手工推导按 HKDF-Expand(-Label) 从各 traffic secret 派生记录密钥（Extract 是更早阶段的运算，见坑 1）；Wireshark/tshark 直接读 keylog 文件可自动处理两代协议
   - 验证解密成功: 解密后能看到明文 HTTP/应用协议字段（步骤 4 语义还原的原料）；解密失败先看 keys.log 里有没有该会话的 CLIENT_RANDOM 或 traffic secret 条目（坑 2）
   - 实时抓取场景: 设置 SSLKEYLOGFILE 后启动 Chrome/Firefox（工具准备），抓包与 keylog 同步产生

4. **加密流量语义还原（应用层协议恢复）**：
   ```sh
   # 解密后按应用层协议还原（TLS 只是载体，语义在 ALPN/上层协议）
   tshark -r decrypted.pcapng -Y 'http' -T fields -e http.request.method -e http.host -e http.request.uri
   tshark -r decrypted.pcapng -Y 'tls.handshake.extensions_alpn_str' -T fields -e tls.handshake.extensions_alpn_str | sort | uniq -c   # ALPN 应用协议：ClientHello 里是候选列表，最终协商结果看 ServerHello 的该字段
   ```
   - 流程: 解密（步骤 3）→ 识别上层协议（ALPN: http/1.1、h2、自定义；或按端口/特征）→ 会话重组 → 语义提取（C2 命令/配置/明文凭据）
   - 自定义协议: 明文还原后转 [[re-proto-rev]] 做状态机重建（[[re-protocol]] 工作流第 5 步）
   - 边界: TLS 解密只解开"标准 TLS 栈"的流量——自实现/魔改 TLS（无 ClientHello 结构、keylog 无对应条目）解密失败，只能走特征分析（步骤 5）

5. **恶意 TLS 特征（指纹聚类/异常证书）**：
   - 特征清单: ① 指纹聚类——JA3/JA4 新簇或命中已知恶意库（curl/python requests 原生栈也是常见信号）② 异常证书——自签名/短有效期/SNI 与 IP 不匹配/证书 CN 是 IP ③ 信标节奏——固定间隔短连接（与 [[re-behavior]] 时间线对齐）④ SNI 异常——随机子域名/高熵 SNI/无 SNI（硬编码 IP 直连，[[re-netcap]] DoH 坑同源）⑤ 混合协议——443 上跑非 TLS
   - 聚类方法: 步骤 1 的指纹表 + 会话统计（连接时长/包大小/方向比）分层；与正常浏览器流量做基线对照（沙箱内先抓一段基线）
   - 结论纪律: 指纹与证书都是"弱信号"，可被伪造（坑 3）——定论要行为侧（进程归属/信标/下载行为）交叉验证，进 IOC 时标注信号类型
   - 产出: 恶意 TLS 会话清单（时间/IP/指纹/证书/SNI）+ 特征进 [[re-ioc]] YARA（证书字节/指纹模式）

## 跨域联合

- [[re-netcap]]：捕获与过滤（本技能输入原料；DoH/加密流量盲区的捕获策略见其坑）
- [[re-proto-rev]]：解密后的明文流量做状态机重建（本技能步骤 4 的下游）
- [[re-protocol]]：本技能是其网关的 TLS 专项——标准 TLS 流量深度分析分支；自定义加密走 crypto 三件套
- [[re-crypto-id]] / [[re-crypto-keys]] / [[re-crypto-decrypt]]：非标准/自实现加密链路（TLS 指纹与解密失败时的转场）
- [[re-malware]]：恶意 C2 的 TLS 特征判定（回连流量分析的第 4 步细化）
- [[re-frida]]：证书固定绕过（坑 4）——hook 校验函数配合 mitmproxy
- [[re-sandbox]]：抓包环境隔离与基线流量采集（[[platform-tips]] 最高原则）
- 引用 [[platform-tips]] 静态优先思路与沙箱网络隔离分支

## 常见坑与陷阱

- **TLS 1.3 密钥导出与 1.2 不同**：现象——用 1.2 的"CLIENT_RANDOM → master secret"思路手工解 1.3 流量解不出，keys.log 里也没有 master secret 条目；原因——TLS 1.3 前向保密 + 每会话独立派生，keylog 记录的是 traffic secret（CLIENT_HANDSHAKE_TRAFFIC_SECRET 等），没有 master secret/RSA premaster；对策——keylog 文件直接交给 Wireshark/tshark（`-o tls.keylog_file:...`）自动处理两代协议；手工推导时按 HKDF-Expand(-Label) 从各 traffic secret 派生各阶段记录密钥（handshake 与 application 阶段密钥不同）
- **前向保密（无 keylog 解不了）**：现象——只有 pcap 没有密钥，怎么都解不出明文；原因——ECDHE 会话密钥只存在于会话两端内存，静态位置没有；对策——承认解不了，转指纹/元数据分析（SNI/证书/长度/时序，步骤 5）；提前准备两条路: 抓包前设 SSLKEYLOGFILE（自控客户端）或 mitmproxy 中间人（第三方程序，配坑 4 证书固定绕过）
- **指纹可伪造**：现象——JA3/JA4 聚类把恶意客户端归到"正常浏览器"簇，或两个无关客户端同指纹；原因——指纹只反映 ClientHello 协商参数，curl/requests/恶意代码可自定义模仿（指纹欺骗是 C2 基础设施常规手法）；对策——指纹当弱信号用于聚类与关联，不做身份判定；命中/未命中都要用证书、SNI、行为侧（进程归属/信标）交叉验证，结论注明证据强度
- **证书固定绕过需中间人配合**：现象——mitmproxy 中间人后目标程序拒绝连接/证书错误，明文拿不到；原因——应用内嵌公钥/SPKI 指纹做 certificate pinning，不信任系统 CA；对策——[[re-frida]] hook 校验函数（SSL_CTX_set_verify / X509_verify_cert / 自实现 pin 校验）返回成功，或 patch 程序跳过校验，再走 mitmproxy 拿明文；沙箱内操作（[[re-sandbox]]），结论注明绕过方式与版本
- **ECH（扩展 65037 加密 ClientHello）与延迟测代理**：现象——JA3/JA4 指纹正常但请求仍被拒，或指纹能仿但代理一挂就被识别；原因——反爬升级：①ECH（Encrypted Client Hello，扩展 65037）把 SNI/扩展加密进 ClientHello，指纹分析拿不到 SNI（2025+ 已出现在反爬检测链 verify=3）；②代理检测不用黑白名单/信誉分/行为分析，直接**测量请求延迟**（服务器往返时间差）识别 VPN/代理（验证 92% 检出率）——因为走代理/隧道必然引入额外延迟，指纹可伪造但延迟无法消除；对策——分析侧：抓包工具/中间人需要支持 ECH 解密（密钥在服务端与浏览器 ECH key 配置）；规避侧：延迟类检测无法靠伪造指纹绕过，只能换直连/低延迟隧道，分析时先确认目标用的是指纹还是延迟检测
