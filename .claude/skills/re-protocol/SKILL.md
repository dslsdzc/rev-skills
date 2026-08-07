---
name: re-protocol
type: gateway
description: >
  协议逆向网关。编排：捕获 → 加密识别 → 密钥 → 解密 → 状态机重建。
  子技能：[[re-netcap]] [[re-crypto-id]] [[re-crypto-keys]] [[re-crypto-decrypt]] [[re-proto-rev]] [[re-ics]] [[re-iot-proto]] [[re-whitebox]]。
  触发词：协议逆向、抓包、流量分析、解密流量、C2协议、自定义协议、protocol analysis。
---

# 协议逆向

## 完整工作流

按顺序执行；每步产物（pcap/密钥/解密脚本/解析脚本）记录证据路径 + sha256，供报告引用（见 [[re-ioc]]）。

1. **捕获：[[re-netcap]]** —— 先定抓包点（本机/网关/中间人），沙箱内捕获优先（[[re-sandbox]] 网络隔离：INetSim / fake DNS / 断网，防真外联，见 [[platform-tips]] 最高原则）；tcpdump 过滤只留目标流再存盘，HTTPS/TLS 提前用 mitmproxy CA 做准备
2. **加密识别：[[re-crypto-id]]** —— 判断流量是明文还是密文：熵 >7.0 / 无结构 / 无 ASCII → 密文；再做常量表指纹（AES S-box / CRC 表）、XOR/ROL/ROR 单字节模式、常见算法流程特征
3. **密钥：[[re-crypto-keys]]** —— 静态优先（strings / 交叉引用找硬编码、资源文件、导入表 Crypt* 附近），静态没有再上动态（[[re-memdump]] 默认转储后搜 16/32 字节熵块与可打印口令），PBKDF 类按派生函数还原
4. **解密：[[re-crypto-decrypt]]** —— 定位解密函数（交叉引用密文输入点）→ 反编译还原算法 → 重写为独立 python 脚本 → 用已知明文/已知头部验证 → 把捕获的密文流解成明文流量流
5. **状态机重建：[[re-proto-rev]]** —— 明文流量才做这一步：分组统计与聚类（长度/方向/时序）→ 定位固定头（magic/长度字段）→ 字段推断（类型/长度/CRC）→ Scapy 写解析器 → 状态机推演（握手/心跳/结束）

**前置检查**：密文未解密不要进入状态机重建（会拿乱码当结构）；明文流量跳过步骤 2-4。

## 何时用哪个原子技能（选择树）

按输入特征/目标分支：

- **有流量（pcap / 实时抓包）** → [[re-netcap]]（捕获）→ 看是否密文：
  - 密文（熵高/无结构）→ [[re-crypto-id]] → [[re-crypto-keys]] → [[re-crypto-decrypt]] → 明文后再 [[re-proto-rev]]
  - 明文 → [[re-proto-rev]] 直接重建状态机
- **工控/SCADA 协议（Modbus/DNP3/OPC UA，端口 502/20000/4840）** → [[re-ics]]（工控流量解析与点表；安全测试边界见 [[re-sandbox]]）
- **物联网设备协议（MQTT/CoAP/BLE/Zigbee，1883/5683/2.4GHz 频段）** → [[re-iot-proto]]（设备语义解析 + 固件联动 [[re-firmware]]）
- **只有二进制样本没有流量**（"协议实现逻辑是什么"）→ 从静态找加密实现 [[re-crypto-id]] → [[re-crypto-keys]] → [[re-crypto-decrypt]]；逻辑深挖转 [[re-binary-core]]（[[re-ghidra]] / [[re-ida]] / [[re-radare2]]）
- **要理解交互语义**（"客户端和服务端怎么对话""握手过程"）→ [[re-proto-rev]]
- **只要解密一个已知算法的 blob**（算法/密钥已知）→ 直接 [[re-crypto-decrypt]]
- **只要找密钥**（"样本里有没有硬编码密钥"）→ [[re-crypto-keys]]（静态优先，见 [[platform-tips]] 最高原则的静态优先思路）
- **白盒加密**（大段查表代码、无标准库调用、密钥藏在表里）→ [[re-whitebox]]（识别 → 表提取 → 密钥恢复，衔接加密三件套）
- **流量捕获环境未就绪** → 先 [[re-sandbox]] 网络隔离（INetSim / fake DNS）再回来 [[re-netcap]]

## 跨域联合

- **C2 通信分析（[[re-malware]]）**：本网关是 re-malware 工作流第 4 步（捕获回连流量 → 重建协议 → 识别并解密通信加密）；加密三件套（crypto-id / crypto-keys / crypto-decrypt）被 C2 解密路径直接引用；捕获依赖 [[re-sandbox]] 的 INetSim / fake DNS 网络隔离
- **固件通信分析（[[re-firmware]]）**：本网关是 re-firmware 工作流第 6 步（固件回连 / 自定义协议 / 加密通信），[[re-netcap]] 从仿真环境的虚拟网卡抓包，binwalk 解出的协议线索供 [[re-proto-rev]] 参考
- **行为分析衔接（[[re-behavior]]）**：行为分析记录到网络连接（回连域名/IP/端口）后转本网关做协议层分析
- **IOC 产出（[[re-ioc]]）**：C2 域名/IP/端口、协议指纹、解密出的配置明文进 IOC 列表与 YARA 特征
- **二进制深挖（[[re-binary-core]]）**：加密实现/解密函数反编译走 [[re-ghidra]] / [[re-ida]] / [[re-radare2]]；密钥在内存走 [[re-memdump]]
- **白盒加密（[[re-whitebox]]）**：加密识别/密钥链路遇到白盒实现（无显式密钥的大段查表加密）时转入——常规 [[re-crypto-keys]] 路径失效的分支
- **入口调度**：本网关被 [[re-analyze]] 的 triage.md「分析网络流量 / 未知协议」路径调用（re-protocol → netcap → crypto-* → proto-rev）

## 常见坑与陷阱

- **沙箱网络未隔离就抓包 → 真外联**：现象——样本真实访问了外网 C2，抓到的流量无法区分恶意回连与正常外联；原因——跳过 [[re-sandbox]] 网络隔离（INetSim / fake DNS / 断网）直接联网跑；对策——任何运行样本前先隔离网络（[[platform-tips]] 最高原则），捕获点选在隔离环境内
- **密文当明文直接重建状态机**：现象——proto-rev 聚类/字段推断结果全乱，解析器解出的"结构"都是随机字节；原因——流量带加密层（熵 >7.0）未先识别；对策——步骤 2 [[re-crypto-id]] 先确认密文，走解密链路后再 [[re-proto-rev]]
- **跳过密钥提取硬写解密脚本**：现象——解密脚本对捕获流量解不出明文或解一半；原因——密钥是动态生成/每会话变化，硬编码假设失效；对策——按 [[re-crypto-keys]] 从内存转储（[[re-memdump]]）或密钥派生处取真实密钥，脚本里留密钥参数化
- **解密结果不验证就当结论**：现象——报告里写的"明文"实际是错误解（填充错位/IV 错）；原因——没有用已知明文对照（协议头 magic、可读字符串、已知字段值）；对策——步骤 4 必须用已知明文/头部验证，解出的明文再做一次可读性检查
- **抓包不过滤 → 文件巨大没法分析**：现象——pcap 几十 GB，tshark 统计卡死；原因——抓包点没过滤（全接口全协议）；对策——[[re-netcap]] 步骤 2 先写过滤表达式（host/port/协议），先过滤再存盘
- **C2 走 DoH → 网络隔离与内容分析全部失明**：现象——INetSim 无任何 DNS 查询记录、pcap 只有连往 dns.google/cloudflare-dns.com 的 443 密文，协议重建没有原料；原因——样本自带 DNS 客户端直接 DoH 直连外部解析器，绕过系统 resolver——fake DNS/INetSim 全盲区，且 DoH 流量与正常浏览器行为无法按内容区分（DoHdoor 后门即编码 C2 命令进 DoH 查询串）；对策——识别"443→已知 DoH 端点 / 无 SNI 的 TLS 握手（硬编码 IP 直连）/ 进程侧有连接但无 DNS 事件（Sysmon 3 无 22）"信号，转行为侧（信标周期、发起进程归属）定位 C2，重定向 DoH 端点 IP 或中间人 443（见 [[re-netcap]] 坑）
