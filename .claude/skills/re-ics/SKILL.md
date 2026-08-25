---
name: re-ics
description: >
  工控协议逆向：Modbus/DNP3/OPC UA。
  触发词：工控、ICS、Modbus、DNP3、OPC UA、SCADA、PLC
---

# 工控协议逆向（ICS/SCADA）

## 何时使用 / 何时不用

- 用：拿到工控（ICS/SCADA）流量（pcap / 实时抓包）需要解析 Modbus / DNP3 / OPC UA 语义
- 用：从流量重建 PLC/RTU 的点表（线圈/寄存器/对象映射）
- 用：工控设备（PLC/HMI/RTU）固件与通信分析（配合 [[re-firmware]]）
- 用：授权范围内的 ICS 安全测试（见步骤 5 边界）
- 不用：流量是密文/带加密层（先 [[re-crypto-id]] → [[re-crypto-keys]] → [[re-crypto-decrypt]]）
- 不用：非工控自定义协议（那是 [[re-proto-rev]]）
- 不用：只需要抓包（那是 [[re-netcap]]）

## 工具准备

所有工具先验证再使用。ICS 分析红线：**只测授权系统**、默认隔离网络（[[platform-tips]] 最高原则）——测试环境严禁接生产 OT 网络（见步骤 5）。

### wireshark / tshark —— ICS 解析器主力（modbus/dnp3/opcua dissector 内置）

- Linux: `apt install wireshark tshark` / `dnf install wireshark-cli wireshark` / `pacman -S wireshark-cli wireshark-qt`（Arch 已拆分为 wireshark-cli + wireshark-qt；Debian 安装时选"允许非 root 抓包"，或 `sudo dpkg-reconfigure wireshark-common` 后把用户加入 wireshark 组）
- macOS: `brew install --cask wireshark`（含 tshark CLI；或 `brew install wireshark` 仅 CLI）
- Windows: `choco install wireshark`（或官方安装包）；WSL 内用 Linux 版
- 验证: `tshark --version`；`tshark -G fields | grep -iE 'modbus|dnp3|opcua'` 列出 ICS 字段名（各版本字段名可能有微调，以该输出为准）

### scapy —— modbus 层解析与构造（contrib 层）

- 全平台: `pip install scapy`（Python 3，推荐）
- Linux: `apt install python3-scapy`（Debian 系；含 contrib 层）
- 验证: `python3 -c "from scapy.contrib.modbus import ModbusADURequest, ModbusADUResponse; print('ok')"`
- 注意：modbus 层在 `scapy.contrib.modbus`（非默认层，需显式 import，`ModbusADURequest`/`ModbusADUResponse` + `ModbusPDU0X*Request/Response` 各功能码类）；**scapy 各版本均无 DNP3 / OPC UA 层** → DNP3/OPC UA 用 Wireshark 解析或写自定义解析器（见步骤 4）
- 读 pcap 用 `rdpcap`（纯 Python 解析，无需 libpcap）

### python3 —— 解析脚本运行环境

- 安装与验证见 [[re-proto-rev]] 工具准备

## 操作步骤

按顺序执行，每步记下结果。前提：流量已捕获（[[re-netcap]]）且为明文（密文先走 [[re-crypto-decrypt]]）。

1. **协议识别（端口 + 特征）**：
   ```sh
   tshark -r cap.pcap -T fields -e tcp.dstport | sort | uniq -c | sort -rn   # 端口统计
   tshark -r cap.pcap -q -z io,phs                                          # 协议分层统计（dissector 命中情况）
   ```
   - 端口速查：Modbus/TCP 502（Modbus over TLS 802）、DNP3 20000/TCP,UDP,SCTP（安全 DNP3 dnp-sec 19999/TCP,UDP,SCTP）、OPC UA 二进制 4840/TCP、S7comm 102、EtherNet/IP 44818、BACnet/IP 47808/UDP
   - 端口仅作初判（工控常走非标端口），用特征确认：Modbus/TCP 事务 = transId(2) + protoId 0x0000(2) + len(2) + unitId(1) + 功能码(1)；DNP3 链路帧首 2 字节固定 `05 64`；OPC UA 二进制头 3 字节消息类型（HEL/ACK/OPN/CLO/MSG）

2. **Wireshark 解析（dissector 优先）**：
   - GUI：打开 pcap，标准端口自动命中 modbus/dnp3/opcua dissector；非标端口 → 右键 Decode As 指定协议（或命令行 `tshark -d tcp.port==5020,modbus`）
   - 过滤与导出：
     ```sh
     tshark -r cap.pcap -Y 'modbus' -T fields -e modbus.func_code -e mbtcp.unit_id   # unit id 官方字段在 mbtcp 层（modbus.unit_id 非官方）
     tshark -r cap.pcap -Y 'dnp3' -T fields -e dnp3.ctl -e dnp3.dst -e dnp3.src       # 控制字 dnp3.ctl（子字段 dnp3.ctl.dir/prm/fcb/fcv/prifunc/secfunc）；站地址在顶层 dnp3.dst/dnp3.src
     tshark -r cap.pcap -Y 'opcua' -T fields -e opcua.nodeid.numeric -e opcua.nodeid.string -e opcua.nodeid.guid   # nodeid 无顶层字段，按类型用子字段
     ```
   - 字段名不确定时以 `tshark -G fields | grep -iE 'modbus|dnp3|opcua'` 输出为准

3. **功能码与对象点表**：
   - Modbus 功能码速查：01 读线圈 / 02 读离散输入 / 03 读保持寄存器 / 04 读输入寄存器 / 05 写单线圈 / 06 写单寄存器 / 0F 写多线圈 / 10 写多寄存器；异常响应 = 0x80 | 功能码
   - 点表构建：从流量收集 (unitId, 功能码, 起始地址, 数量)，对照工程文档把寄存器/线圈地址映射为标签（温度、压力、阀位……），产出"地址 → 类型 → 值 → 含义"表
   - 值解析：寄存器 16 位大端；32 位组合（IEEE754 浮点 / int32）注意高低位序（见坑 2）
   - DNP3 对象点表：组-变体编号（组 1 二进制输入 / 组 3 事件 / 组 10 二进制输出 / 组 30 模拟输入）
   - OPC UA：NodeId（NamespaceIndex:Identifier）+ BrowseName 即点标识
   - 差值法：对比正常运行 vs 触发动作的流量，差异消息 = 关键点

4. **scapy 解析器（modbus）+ 自定义 DNP3 解析**：
   ```python
   from scapy.all import rdpcap
   from scapy.contrib.modbus import ModbusADURequest, ModbusADUResponse

   for p in rdpcap('cap.pcap'):
       if 'TCP' in p and p['TCP'].dport == 502 and len(p['TCP'].payload) >= 6:
           mb = ModbusADURequest(bytes(p['TCP'].payload))   # MBAP+PDU 一起解
           mb.show()        # transId/protoId/len/unitId + PDU（功能码与寄存器字段）
   ```
   - DNP3（scapy 无层）：链路层头结构固定（`05 64 | len | ctrl | dst(2) | src(2) | CRC(2)`，源地址后为强制头 CRC），用 struct 解析即可；后续数据每 16 字节带 2 字节 CRC 分块；传输层/应用层按 IEEE 1815 的组-变体格式递进
   - 构造测试报文（发给测试床 PLC 前必须确认授权与隔离，见步骤 5）：
     ```python
     from scapy.contrib.modbus import ModbusPDU03ReadHoldingRegistersRequest
     req = ModbusADURequest() / ModbusPDU03ReadHoldingRegistersRequest(start_addr=0, quantity=10)
     ```

5. **授权范围与安全测试边界**：
   - 只测授权系统：自有/实验室测试床（PLC/RTU/HMI 模拟器）、厂商授权测试设备、漏洞披露范围内目标；**严禁**对生产 SCADA/DCS、电网/水厂/电厂等关键设施做未授权测试（涉及法律与公共安全）
   - 物理/逻辑隔离：测试网与生产 OT 网络分离（独立网段/VLAN、防火墙），抓包与分析机只接测试床；默认按 [[re-sandbox]] 网络隔离思路
   - 发送异常报文（fuzzing、非法功能码、越权写）仅限测试床，全程记录审计；不确定就退回被动分析（只抓包只解析）
   - 报告脱敏：不暴露生产环境站点/人员/网络拓扑细节；遵守所在地工控安全测试法规，留存书面授权

## 跨域联合

- [[re-protocol]]：本技能是其工控分支（工作流第 5 步之后的选择树入口）
- [[re-netcap]]：捕获原料来源（抓包点/沙箱隔离）
- [[re-sandbox]]：安全测试边界——测试床隔离、只测授权系统（[[platform-tips]] 最高原则）
- [[re-crypto-id]] / [[re-crypto-keys]] / [[re-crypto-decrypt]]：加密变体前置（Modbus over TLS、OPC UA 安全通道；DNP3 Secure Authentication 是认证扩展非默认加密，需另确认是否套了 TLS/VPN）
- [[re-firmware]]：PLC/RTU/工控设备固件分析（提取 → rootfs → 仿真）
- [[re-proto-rev]]：非标工控协议的状态机重建
- [[re-hardware-io]]：串口抓取 Modbus RTU / 现场总线

## 常见坑与陷阱

- **功能码语义混用**：现象——把 01 读线圈当 03 读寄存器，值类型全错（线圈 1 位 vs 寄存器 16 位）；原因——功能码决定数据类型与地址空间，未按功能码分桶统计；对策——先按功能码统计（`tshark -Y modbus.func_code`），点表按功能码分空间（01/02 线圈空间、03/04 寄存器空间）
- **大端字节序**：现象——寄存器值巨大/乱码（如温度 0x0128=296 被按小端读成 0x2801=10241）；原因——Modbus 寄存器默认大端，多寄存器组合（32 位/浮点）还有厂商自定义高低序叠加；对策——用已知值校验（量程/常数/精度合理性），大小端与高低序组合都试，确定后固定并写进解析脚本
- **协议变体混用**：现象——dissector 未命中或解析错位（Modbus RTU 帧被当 TCP 解、DNP3 走 TLS 端口）；原因——同一协议多载体：Modbus RTU/ASCII（串口）vs TCP（502）vs TLS（802）；DNP3 串口/TCP 20000（TLS 常复用 20000 或 dnp-sec 19999）；OPC UA 二进制（4840）vs HTTP 端点；对策——步骤 1 端口+特征双确认，Wireshark Decode As / `-d` 强制指定 dissector
- **加密变体当明文解**：现象——流量熵高、dissector 只出乱码或标记加密；原因——Modbus over TLS / OPC UA 安全通道默认加密；DNP3 Secure Authentication 是认证/完整性扩展而非保密封装，熵高时应先确认是否另有 TLS/VPN 保密层；对策——先 [[re-crypto-id]] 判定，密钥从 HMI/客户端进程内存与证书提取（[[re-crypto-keys]]），解密链路走 [[re-crypto-decrypt]]
- **点表映射错位**：现象——地址对不上、值含义错误；原因——厂商编址习惯不同（0-based vs 1-based、线圈/寄存器各自地址空间、镜像地址）；对策——多包交叉验证（同一地址多次读取值应稳定）、结合工程文档、按空间分离建表
- **S7CommPlus 鉴权链路（S7-1200/1500）**：现象——S7 流量版本对不上、鉴权数据解不开、PLCSIM 抓的流程真机对不上；原因——S7CommPlus 是分层认证体系，V1(0x01)/V2(TLS,0x02)/V3(0x03) 协议差异大；结构：OpenSSL 标准层（AES-128-ECB/SHA-256/HMAC）+ BigInt 大数层（192-bit 6 dword 编码）+ Monolith 函数族（1-11）+ 密钥派生变换流水线（TPre/T7/T12/T13/KeyD/LutG/Csum/Seed 8 类 Transform）+ 加密认证数据（AES-ECB 链 + Blob 元数据头 + AES-CTR/HarpoHash 校验）；关键常量：会话密钥 24B、挑战 20B、真实 PLC 公钥 40B vs PLCSIM 64B、认证 Blob 180 vs 216B；对策——先确认协议版本与目标（真机 vs PLCSIM，流程与密钥长度都不同），按版本分线还原：明文结构 → 密钥派生流水线 → Session Key 轮转 → Packet Digest
