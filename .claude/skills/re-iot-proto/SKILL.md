---
name: re-iot-proto
description: >
  物联网协议：MQTT/CoAP/BLE/Zigbee。
  触发词：MQTT、CoAP、BLE、Zigbee、物联网协议、IoT协议
---

# 物联网协议逆向（MQTT / CoAP / BLE / Zigbee）

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
   - 加密（8883 / 5684）: TLS 用 SSLKEYLOGFILE 或 RSA 私钥解密；DTLS PSK 在 Wireshark dtls 偏好填十六进制预共享密钥（密钥来源见步骤 4 与 [[re-crypto-keys]]）
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

## 常见坑与陷阱

- **MQTT 明文 topic 泄露控制语义**：现象——pcap 里 topic 直接写明 `device/x/ota/update`、`cmd/relay`，业务意图一目了然但 payload 加密或二进制；原因——设备常只加密 payload、topic 明文（或 broker 无 TLS）；对策——topic 是语义金矿：先 `-e mqtt.topic | sort | uniq -c` 分桶，按 topic 定位关键流再解 payload；payload 二进制用 JSON/protobuf 假设对照固件（步骤 5）
- **DTLS/PSK 加密需密钥**：现象——5684 / 8883 流量熵高全是密文，dissector 只出乱码；原因——DTLS/TLS 加密层（PSK/RSA）；对策——PSK 从设备固件 / App 侧提取（[[re-crypto-keys]] → [[re-firmware]]），Wireshark dtls 偏好填十六进制 PSK；TLS 用 SSLKEYLOGFILE / RSA 私钥；拿不到密钥则该通道只能看时序，标注局限并转向语义推测
- **BLE 白名单/配对绑定**：现象——连接请求之后没有后续数据，或设备根本不广播；原因——白名单过滤未知主机、已配对设备按绑定信息直接连接（跳过广播 / 配对过程）；对策——清除设备配对 / 出厂重置后重抓首次连接配对过程；广播阶段数据（adv 包，含设备信息与服务 UUID）先抓全
- **Zigbee 网络密钥获取困难**：现象——zbee 帧可解析但 APS / ZCL 全密文（payload 乱码）；原因——network key 未在手，链路/网络层加密；对策——按步骤 4 密钥路径逐项试: 组网期抓包 → 默认 TC link key → 固件提取（zbgoodfind 扫固件找 key）；TC link key 与 network key 两层密钥都要拿
- **抓包硬件/信道错配**：现象——BLE 只抓到零星广播、Zigbee 一个包都没有；原因——BLE 40 信道跳频（普通适配器只能看到广播或部分连接包）、Zigbee 信道选错（11-26 选错即静默）；对策——BLE 用 btmon / btsnoop（主机侧全信道）或 ubertooth 配合 follow；Zigbee 用 sniffer 信道扫描（zbstumbler）确认工作信道再抓
