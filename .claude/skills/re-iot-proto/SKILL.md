---
name: re-iot-proto
description: >
  物联网协议：MQTT/CoAP/BLE/Zigbee；BLE 链路层（广播解析/配对加密）与 NFC/智能卡（ISO14443/APDU/MIFARE）。
  触发词：MQTT、CoAP、BLE、Zigbee、物联网协议、IoT协议、BLE链路、BLE嗅探、广播解析、配对加密、GATT、NFC、智能卡、MIFARE、APDU、ISO14443
---

# 物联网协议逆向（MQTT / CoAP / BLE / Zigbee / NFC 智能卡）

## 何时使用 / 何时不用

- 用：拿到 IoT 设备流量（pcap / 实时抓包）需要解析 MQTT / CoAP 语义
- 用：BLE 设备（adv / GATT）交互分析
- 用：Zigbee（802.15.4）网络抓包与 ZCL 命令分析
- 用：需要理解"设备上报 / 下发控制"语义并联动固件
- 不用：通用自定义协议（走 [[re-proto-rev]]）
- 不用：普通网络流量捕获（走 [[re-netcap]]）
- 不用：加密流量无密钥——先 [[re-crypto-id]] / [[re-crypto-keys]]

## 工具准备

物理设备抓包注意授权边界（见步骤 5），动态场景默认沙箱 / 隔离网络（[[platform-tips]] 最高原则）。所有工具先验证再使用。

### wireshark / tshark —— 解析主力（MQTT/CoAP/BLE/Zigbee dissector 内置）

- Linux: `apt install wireshark tshark` / `dnf install wireshark-cli wireshark` / `pacman -S wireshark-cli wireshark-qt`（Arch 已拆分为 wireshark-cli + wireshark-qt；Debian 安装时选"允许非 root 抓包"，或 `sudo dpkg-reconfigure wireshark-common` 后把用户加入 wireshark 组）
- macOS: `brew install --cask wireshark`（含 tshark CLI；或 `brew install wireshark` 仅 CLI）
- Windows: `choco install wireshark`；WSL 内用 Linux 版
- 验证: `tshark --version`；`tshark -G fields | grep -iE 'mqtt|coap|btatt|zbee'` 列出字段名（各版本字段名有微调，以该输出为准）

### scapy —— 可选解析 / 构造

- 全平台: `pip install scapy`（Python 3）
- 验证: `python3 -c "import scapy; print(scapy.__version__)"`

### MQTT —— mosquitto 客户端（主动订阅/发布验证）

- Debian/Ubuntu: `apt install mosquitto-clients`（mosquitto_pub / mosquitto_sub）
- Fedora: `dnf install mosquitto`；Arch: `pacman -S mosquitto`；macOS: `brew install mosquitto`；Windows: `choco install mosquitto`
- 验证: `mosquitto_pub -h`；`mosquitto_sub -h`
- GUI 替代: MQTT Explorer（桌面跨平台）

### CoAP —— coap-client / aiocoap

- Debian/Ubuntu: `apt install libcoap3-bin`（提供 coap-client）
- Fedora: `dnf install libcoap libcoap-utils`（coap-client 位于 libcoap-utils 子包）；Arch: `pacman -S libcoap`（extra）；macOS: `brew install libcoap`
- 发行版包若不含示例程序 → `pip install aiocoap`（命令 `aiocoap-client`，Python 3）
- 验证: `coap-client -h`（或 `aiocoap-client -h`）

### BLE —— bluez + ubertooth

- bluez（btmon / hcitool）: Debian/Ubuntu `apt install bluez`；Fedora `dnf install bluez`；Arch `pacman -S bluez bluez-utils`；验证 `btmon --help`
- ubertooth（2.4GHz 嗅探硬件）: Debian/Ubuntu `apt install ubertooth`（固件另装 `ubertooth-firmware`）；Fedora `dnf install ubertooth`（Fedora 43/44 官方仓库有）；Arch 官方仓库无 → AUR；macOS `brew install ubertooth`；验证 `ubertooth-btle -s`
- Android btsnoop（无需安装）: 开发者选项 → 勾选"启用 Bluetooth HCI snoop 日志" → 复现交互 → `adb bugreport` 或拉取 `/sdcard/btsnoop_hci.log`（btsnoop 格式，Wireshark 直接打开）
- nRF Sniffer for BLE（Nordic，可选）: 需 nRF 系列 dongle + Wireshark extcap（Windows/macOS 为主）

### Zigbee —— Wireshark + sniffer 硬件 + KillerBee

- Wireshark zbee dissector 内置（zbee_nwk / zbee_aps / zbee_zcl）；解密在 Preferences → Protocols → ZigBee → Security（勾 Decryption、填 Network Key / Link Key）
- sniffer 硬件（无发行版包，硬件方案）: TI CC2531 USB 棒（刷 Sniffer 固件）或 Silicon Labs EFR32MG（Simplicity Studio 刷 sniffer + Wireshark extcap）
- KillerBee（Python，ZCL 抓取 / 构造 / 重放）: Debian/Fedora/Arch 官方仓库均无该包 → `pip3 install killerbee`（PyPI；依赖 libusb/libpcap——Debian/Ubuntu `apt install libusb-1.0-0-dev libpcap-dev`、Fedora `dnf install libusbx-devel libpcap-devel`、Arch `pacman -S libusb libpcap`）；固件烧写 `sudo ./kb_install_firmware`；验证 `kb --version`
- ZBOSS 协议栈（DSR 公司 Zigbee 栈）文档作 NWK/APS/ZCL 结构参考
- 密钥提取联动: [[re-firmware]]（固件 flash 读密钥，配合 zbgoodfind）/ [[re-crypto-keys]]

## 操作步骤

按顺序执行，每步产物（pcap / 密钥 / 解析脚本 + sha256）存档。

1. **协议识别**：
   ```sh
   tshark -r cap.pcap -q -z io,phs                                   # 协议分层统计
   tshark -r cap.pcap -T fields -e tcp.dstport -e udp.dstport | sort | uniq -c | sort -rn
   ```
   - 端口速查: MQTT 1883（明文）/ 8883（TLS）；CoAP 5683（UDP）/ 5684（DTLS）；BLE: 广播与 GATT（bthci_evt / bthci_acl / btatt 层，无端口）；Zigbee: 802.15.4 帧（无端口，2.4GHz 信道 11-26）
   - 非标端口 → Wireshark Decode As / `tshark -d tcp.port==9999,mqtt` 强制指定
   - 特征确认: MQTT 首字节为控制类型（CONNECT 0x10 / PUBLISH 0x30 ...）；CoAP 头 Ver 字段 2 位（值 01）；BLE HCI 事件包 0x3e；Zigbee 帧首 2 字节 802.15.4 帧控制字段
2. **MQTT/CoAP 解析（topic / payload）**：
   ```sh
   tshark -r cap.pcap -Y mqtt -T fields -e mqtt.topic -e mqtt.msg
   tshark -r cap.pcap -Y 'mqtt.topic contains "ota"' -T fields -e mqtt.msg    # 按主题过滤
   tshark -r cap.pcap -Y coap -T fields -e coap.code -e coap.uri_path -e coap.opt.content_format
   ```
   - topic 即控制语义: `device/<id>/sensor`、`ota/update`、`cmd/relay` 等——先按 topic 分桶（`-e mqtt.topic | sort | uniq -c`）
   - payload 常见 JSON / protobuf / 自定义二进制 → 字段含义对照设备 App 或固件（步骤 5）
   - 主动交互验证（授权内）: `mosquitto_sub -h <broker> -t '#' -v`（全量订阅）、`mosquitto_pub -h <broker> -t <topic> -m '{"relay":1}'`；`coap-client -m get coap://<ip>/sensor`、`coap-client -m put -e '{"on":1}' coap://<ip>/relay`
   - 加密（8883 / 5684）: TLS 用 SSLKEYLOGFILE 解密；RSA 私钥只适用于旧式 static-RSA 密钥交换（TLS 1.3 与 ECDHE 会话解不开）；DTLS PSK 在 Wireshark dtls 偏好填十六进制预共享密钥（密钥来源见步骤 4 与 [[re-crypto-keys]]）
3. **BLE 抓包（adv / GATT）**：
   - Android btsnoop: 开发者选项开启 snoop 日志 → 复现 App 与设备交互 → 拉取 `btsnoop_hci.log` 用 Wireshark 打开（自动解 HCI）
   - Linux: `btmon -w out.btsnoop`（配合目标连接过程；写出的 btsnoop 格式 Wireshark 直接打开）
   - ubertooth（无主机侧蓝牙时可嗅 2.4GHz）: `ubertooth-btle -f -c 0`（follow 模式观察广播 / 连接包）、`ubertooth-btle -s`（扫描）——实时显示不落盘，配合屏幕分析；要落盘进 Wireshark 用 btmon / Android btsnoop / nRF Sniffer（extcap）
   - GATT 解析:
     ```sh
     tshark -r ble.pcap -Y btatt -T fields -e btatt.opcode -e btatt.uuid -e btatt.value
     ```
   - 关注: 广播包（设备名 / 厂商数据 / 服务 UUID）与 GATT 读写特征（传感器值、控制指令、固件版本）
4. **Zigbee（802.15.4）**：
   - 硬件 sniffer 捕获（CC2531 / EFR32，选对信道）→ Wireshark zbee 解析
   - 解密: Preferences → Protocols → ZigBee → Security: 勾 Decryption、填 Network Key（16 字节 hex）与 Link Key（Zigbee 3.0 常见默认 TC link key 为 `ZigBeeAlliance09`）
   - 密钥获取路径: ① 抓网络组网过程（Trust Center 向新节点下发 network key）② 默认 TC link key / install code ③ 固件 flash 提取（[[re-firmware]] / [[re-hardware-io]]，配合 `zbgoodfind` 在固件里找密钥）④ 物理访问协调器读配置
   - 层结构: NWK（寻址/加密）→ APS（端点/簇）→ ZCL（命令: 开关 / 读属性 / OTA）——`tshark -r zigbee.pcap -Y zbee_zcl -T fields -e zbee_zcl.cmd` 看命令（字段名以 `tshark -G fields | grep -i zbee` 为准）
   - KillerBee 交互（授权内）: `zbdump`（抓包）、`zbstumbler`（扫网）、`zbreplay`（重放 ZCL 命令）
5. **设备固件联动（走 [[re-firmware]]）**：
   - 协议语义不明 / 自定义 payload → 固件提取（binwalk 解包）→ rootfs 里找协议实现（字符串 / so）、密钥、topic 硬编码 → [[re-fw-emulate]] 仿真设备复现协议行为
   - 协议常量与固件字符串交叉验证（端口、magic、topic 前缀）
   - OTA 通道也是协议面: MQTT topic `ota/update` 下发固件 → 截获的固件镜像可再走 [[re-firmware]]

## BLE 链路层

应用层之外补链路层视角：空口嗅探、广播/连接帧结构、配对加密协商与密钥定位。抓包工具底座见上文「BLE —— bluez + ubertooth」，本节侧重链路语义与深挖点。

### 嗅探硬件与软件（泛化选购指引）

- 主机侧（btmon / Android btsnoop）只能看到本机参与的过程；设备与第三方设备之间的交互需空口嗅探
- nRF 系 dongle + Sniffer 固件 + Wireshark extcap（桌面端为主）: 选购关注芯片覆盖的蓝牙核心版本（4.2 / 5.x 是否支持 LE Secure Connections 跟踪）、固件是否支持连接事件跟踪（跟随跳频）、天线形式（板载/外置，影响接收距离）
- ubertooth 类 2.4GHz 嗅探器: 适合广播与无加密连接的链路层数据；不参与连接，加密连接内容看不到
- 共性局限: 空口嗅探对加密连接只能看时序与包长，内容解密需 LTK（见下）

### 广播包解析

- PDU 类型区分连接意图: ADV_IND（可连接非定向，最常见）、ADV_SCAN_IND（可扫描）、ADV_NONCONN_IND（纯广播）、ADV_DIRECT_IND（定向）
- 帧结构: 2 字节头（PDU 类型 + 长度）+ Payload（AdvA + AdvData）；AdvData 为 AD structure 链（Length + AD Type + Data）: 0x01 Flags、0x03/0x07 服务 UUID、0x09 完整本地名、0x0A Tx Power、0xFF 厂商数据
- 解析: `tshark -r ble.pcap -Y btle -T fields -e btle.advertising_address -e btle.advertising_header.pdu_type -e btle.advertising_data`（字段名以 `tshark -G fields | grep -i btle` 为准）；0xFF 厂商数据段常含私有协议与设备标识，值得逐字节对照固件
- 广播只承载低频状态通告（名字/状态/服务发现），业务数据一般在连接后 GATT 通道

### 连接事件时序与信道 37/38/39

- 主广播信道固定 37/38/39（2402/2426/2480 MHz），广播事件在三信道轮转；扫描请求/响应与 CONNECT_IND 也在这三个信道
- CONNECT_IND 携带访问地址、跳频增量与连接参数 → 据此可推算后续数据信道序列（0-36）与事件节奏
- 连接参数: connInterval（1.25ms 步进）、slaveLatency、supervisionTimeout，在 HCI 层 LE Connection Complete 事件可见；连接事件以锚点（anchor point）起算，按 connInterval 周期出现
- 验证: 抓包中连接数据包间隔应为 connInterval 的整数倍；间隔混乱或单侧缺失 → 跳频跟踪脱同步（见坑 3）

### 配对 / 加密协商

- 流程: Pairing Request/Response（SMP）→ 临时密钥派生 → LTK 生成 →（绑定）双方存储 LTK
- LE Legacy: 基于 PIN/临时值派生 STK；LE Secure Connections: P-256 ECDH，AuthReq 的 MITM 位决定是否防中间人（Just Works 无用户校验，Passkey / Numeric Comparison 有）
- 定位点: Wireshark 中 SMP 交换看 AuthReq（SC / MITM / Bonding 位，字段以 `tshark -G fields | grep -i smp` 为准）——先确认模式再决定是解密还是只看时序
- 绑定（bonding）后重连不重新配对，LTK 交换只出现在首次配对
- 密钥存储: 主机侧（系统蓝牙配置 / 键值对存储）与设备侧（flash / 外部 EEPROM）→ [[re-firmware]] / [[re-crypto-keys]] 提取；拿到 LTK 填 Wireshark BLE 偏好可解密连接数据

### GATT 服务与特征枚举

- 被动: btmon / btsnoop 抓服务发现（Discover All Primary Services / 特征发现），btatt 层 UUID 与句柄映射直接可见
- 主动（连接后）: gatttool 类工具（bluez）`primary` / `characteristics` 列出 handle ↔ UUID ↔ 属性
- 读写/通知点: 特征句柄 + CCCD（0x2902）开启通知/指示后，值流在 btatt.value；`tshark -r ble.pcap -Y btatt -T fields -e btatt.handle -e btatt.value`

### 坑与陷阱

- **广播 vs 连接数据混淆**：现象——在广播包厂商数据段看到疑似业务数据就当上报语义解析，结果与 App 行为对不上；原因——广播只承载低频通告，业务流在连接后的 GATT 通道且可能加密；对策——先按帧类型分流: btle advertising 包解析 AdvData，连接数据看 btatt 层；判断目标设备是否已进入连接态再决定抓哪段
- **配对模式误判**：现象——按"抓到配对过程即可解密"推进，实际要么连接全密文要么明文无校验；原因——AuthReq 位决定模式: SC=0 且 MITM=0 为 LE Legacy Just Works——无用户校验、不防窃听侧冒充；SC=1 为 LE Secure Connections（ECDH）；对策——解析 SMP Pairing Request 的 AuthReq 先确认模式，再选解密（需 LTK）或只看时序
- **抓包丢连接事件**：现象——广播与连接建立都在，连接事件断断续续或只有单侧包；原因——数据信道跳频未被跟踪（错过锚点即脱同步）、只固定监听单信道、空口干扰丢包；对策——优先主机侧 btmon / btsnoop（全信道可靠）；空口嗅探用带连接跟踪能力的固件，并按 CONNECT_IND 的访问地址 + 跳频增量验证跟踪
- **LTK 不在抓包里**：现象——SMP 交换后无 LTK 相关包，解密无密钥；原因——绑定后重连直接用存储密钥，不重新交换；对策——清配对/重置后重抓首次配对，或从设备 flash / App 存储提取（[[re-firmware]] / [[re-crypto-keys]]）

## NFC / 智能卡

接触式 / 无接触智能卡：ISO14443 链路、APDU 交互与常见卡族弱点。硬件用 proxmark3 类通用读写器（泛化选购），抓取/分析前确认授权边界。

### ISO14443 帧结构与防冲突流程

- ISO14443A 流程: REQA（0x26 短帧）→ ATQA → 防冲突（UID 按级联 CL1/CL2/CL3 逐位协商）→ SELECT → SAK（卡类型标识）
- 帧结构: SOF + 数据字节（每字节带奇偶校验）+ CRC_A（2 字节）+ EOF；短帧 7 位（REQA/WUPA）
- SAK 判型: 0x08/0x88 类 → MIFARE Classic 族（Crypto-1，扇区/块结构）；0x20/0x40 类 → DESFire 族（文件系统 + AES/3DES）——先判型再选路径（见坑 1）
- 读写器流程: `hf 14a reader` 类命令（proxmark3 类通用）一次输出 ATQA / UID / SAK，据此进入对应卡族工具

### APDU 交互

- ISO7816-4 APDU: CLA + INS + P1 + P2，其后 Lc/数据/Le 按 case 组合出现（Case1 三者皆无；Case2 无 Lc/数据可有 Le；Case3 有 Lc+数据无 Le；Case4 全有）——解析边界前先判定 case；响应 SW1/SW2（0x9000 成功）
- 常见指令: 0xA4 SELECT（选应用）、0xB0 READ BINARY、0xB2 READ RECORD、0x20 VERIFY（口令验证）、0xD0 WRITE BINARY、0xD6 UPDATE BINARY——但各卡/应用命令集有差异（见坑 2）
- 接触式走 ISO7816 T=0/T=1；无接触卡常把 APDU 透传（如 DESFire ISO 模式），抓包位置不同
- 定位技巧: 抓已知合法交互（读写器日志 / 手机 NFC 日志）对照指令序列，比对着文档猜快

### MIFARE Classic 与 Crypto-1 弱点（泛化）

- Crypto-1 为 48 位流密码，认证时读写器发 challenge、卡返回加密响应；PRNG 与认证协议有已知弱点，可基于非加密认证响应样本做密钥恢复（重放 / 已知明文思路）
- 前提: 卡响应任意读写器的认证请求（未被配置拒绝未知密钥）；前提不满足则该思路不适用，转密钥提取（[[re-crypto-keys]] / [[re-firmware]]）或固件分析
- 边界: 仅针对 Crypto-1 类卡；AES 类卡（DESFire 族）结构不同，不适用

### proxmark3 类设备流程（泛化选购）

- 选购关注: 13.56MHz 高频支持（必备）、固件是否活跃更新、是否支持现场刷写、天线性能与外壳形式
- 流程: 上电自检 → `hf 14a reader` 判型 → 按卡族选攻击/读写流程 → 验证结果
- 授权边界: 只读与写卡/复制均需授权，实验室环境确认卡归属与目的（[[platform-tips]] 最高原则）

### 坑与陷阱

- **卡类型判断错误（MIFARE vs DESFire 结构不同）**：现象——按 Classic 扇区/块结构解析一张卡，地址与数据全对不上；原因——Classic（Crypto-1、扇区块结构、SAK 0x08/0x88 类）与 DESFire（文件系统、AES/3DES、SAK 0x20/0x40 类）内部结构完全不同；对策——先看 SAK（结合 ATQA）判卡族再选解析/攻击路径，不要拿一个结构套所有卡
- **APDU 命令集差异**：现象——同一指令在 A 卡成功、B 卡返回 0x6A82（文件未找到）/ 0x6D00（指令不支持）类错误；原因——不同卡/应用对 CLA 前缀、INS、P1/P2 约定不同（专有 CLA、扩展指令、参数含义差异）；对策——先 SELECT 目标应用，用已知合法交互抓包对照指令序列，按 SW 状态码逐条校准
- **Crypto-1 攻击前提**：现象——密钥恢复流程跑不起来或结果错误；原因——思路需要先拿到卡侧非加密认证响应样本，卡拒绝未知读写器认证、或环境无法插中间人时无从入手；对策——先验证卡是否响应任意读写器认证请求，前提成立再走攻击流程，否则转密钥提取 / 固件路径（[[re-crypto-keys]] / [[re-firmware]]）
- **UID 与数据块混淆**：现象——写卡/复制后目标卡行为异常或读写失败；原因——UID 与厂商块（块 0）存在锁定/校验，部分卡族 UID 不可改，改后访问控制失效；对策——写前先读厂商块与扇区尾块（access bits），确认可写性与授权边界

## 跨域联合

- [[re-protocol]]: 本技能是其 IoT 分支（工作流第 5 步之后的选择树入口）
- [[re-netcap]]: 捕获原料（抓包点 / 隔离）
- [[re-firmware]]: 固件联动（协议实现 / 密钥 / OTA 镜像，配合 [[re-fw-extract]] / [[re-fw-emulate]]）
- [[re-crypto-id]] / [[re-crypto-keys]] / [[re-crypto-decrypt]]: 加密流量链路（TLS / DTLS / PSK 密钥提取与解密）
- [[re-proto-rev]]: 私有 IoT 协议状态机重建
- [[re-hardware-io]]: 串口 / flash 芯片读密钥
- [[re-sandbox]]: 设备测试网络隔离与授权边界（[[platform-tips]] 最高原则）
- 本技能被 [[re-analyze]] 的 triage「协议分析」路径引用（re-protocol → re-iot-proto）
- 射频信号级逆向（采集/解调/帧恢复）→ [[re-sdr]]
- [[re-javacard]]: NFC/智能卡链路之上的 applet 逻辑（CAP 文件解析、process(APDU) 分派还原）

## 常见坑与陷阱

- **MQTT 明文 topic 泄露控制语义**：现象——pcap 里 topic 直接写明 `device/x/ota/update`、`cmd/relay`，业务意图一目了然但 payload 加密或二进制；原因——设备常只加密 payload、topic 明文（或 broker 无 TLS）；对策——topic 是语义金矿：先 `-e mqtt.topic | sort | uniq -c` 分桶，按 topic 定位关键流再解 payload；payload 二进制用 JSON/protobuf 假设对照固件（步骤 5）
- **DTLS/PSK 加密需密钥**：现象——5684 / 8883 流量熵高全是密文，dissector 只出乱码；原因——DTLS/TLS 加密层（PSK/RSA）；对策——PSK 从设备固件 / App 侧提取（[[re-crypto-keys]] → [[re-firmware]]），Wireshark dtls 偏好填十六进制 PSK；TLS 用 SSLKEYLOGFILE（RSA 私钥仅旧式 static-RSA 会话可用，现代 ECDHE/TLS 1.3 解不开）；拿不到密钥则该通道只能看时序，标注局限并转向语义推测
- **BLE 白名单/配对绑定**：现象——连接请求之后没有后续数据，或设备根本不广播；原因——白名单过滤未知主机、已配对设备按绑定信息直接连接（跳过广播 / 配对过程）；对策——清除设备配对 / 出厂重置后重抓首次连接配对过程；广播阶段数据（adv 包，含设备信息与服务 UUID）先抓全
- **Zigbee 网络密钥获取困难**：现象——zbee 帧可解析但 APS / ZCL 全密文（payload 乱码）；原因——network key 未在手，链路/网络层加密；对策——按步骤 4 密钥路径逐项试: 组网期抓包 → 默认 TC link key → 固件提取（zbgoodfind 扫固件找 key）；TC link key 与 network key 两层密钥都要拿
- **抓包硬件/信道错配**：现象——BLE 只抓到零星广播、Zigbee 一个包都没有；原因——BLE 40 信道跳频（普通适配器只能看到广播或部分连接包）、Zigbee 信道选错（11-26 选错即静默）；对策——BLE 用 btmon / btsnoop（主机侧全信道）或 ubertooth 配合 follow；Zigbee 用 sniffer 信道扫描（zbstumbler）确认工作信道再抓
