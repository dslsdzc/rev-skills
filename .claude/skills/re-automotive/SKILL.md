---
name: re-automotive
description: >
  汽车逆向：CAN 总线、ECU 固件。
  触发词：汽车、CAN、ECU、车载、OBD、UDS
---

# 汽车逆向（CAN 总线 / ECU）

## 何时使用 / 何时不用

- 用：拿到车辆 CAN 总线流量（candump 日志 / .asc / .blf）需要解析报文与信号
- 用：车载设备（车机、T-Box、IVI、ECU 升级包）逆向
- 用：OBD-II / UDS 诊断会话分析（读 DTC、安全访问、标定读写）
- 用：ECU 固件提取与后续解包（配合 [[re-firmware]]）
- 不用：只有 ECU 固件文件、没有总线访问（直接 [[re-fw-extract]]）
- 不用：需要跑固件观察行为（[[re-fw-emulate]]）
- 不用：需要 JTAG/SWD 读 flash（[[re-hardware-io]]）
- 红线：只对自有/获授权车辆与测试台架测试（见步骤 5）

## 工具准备

所有工具先验证再使用。实车/实总线测试默认物理隔离——[[platform-tips]] 最高原则：仅自有或获授权测试车辆/台架可接入；实验室起步用 vcan 虚拟总线，不接真车。

### can-utils —— candump/cansend/cangen/canplayer 主力

- Linux: `apt install can-utils`（Debian/Ubuntu）/ `dnf install can-utils`（Fedora）/ Arch: 无官方包 → AUR（can-utils）或源码构建（`git clone https://github.com/linux-can/can-utils && cd can-utils && ./autogen.sh && ./configure && make`）
- macOS/Windows: 无官方包（SocketCAN 为 Linux 内核特性）→ WSL/虚拟机内 Linux 版
- 验证: `candump --help`；`cansend --help`

### socketcan —— Linux 内核 CAN 栈（vcan 虚拟总线 / can-isotp）

- Linux: 内核自带模块（5.10+ 内核含 can-isotp）：`modprobe can vcan can-isotp`；`ip link` 来自 iproute2（基础系统自带）
- macOS/Windows: 不支持 → WSL2/虚拟机（需 Linux 5.10+）
- 验证: `modprobe vcan && ip link add dev vcan0 type vcan && ip link set up vcan0 && ip -details link show vcan0`

### USB-CAN 适配器 —— gs_usb 系（canable/candlelight）即插即用

- Linux: 内核自带 gs_usb 驱动（drivers/net/can/usb/gs_usb.c）；插入后 `dmesg` 应注册 can0（个别发行版 CAN 驱动在 modules-extra 包，`modprobe gs_usb` 报错时装对应 extra 包）
- macOS/Windows: 用厂商驱动 + 厂商软件，或经虚拟机透传
- 验证: `modprobe gs_usb`；`ip -details link show can0`

### wireshark / tshark —— CAN/ISO-TP/UDS 解析

- 安装同 [[re-netcap]] 工具准备（apt/dnf/pacman/brew/choco）；CAN（socketcan / Vector ASCII / BSLogger）、ISO-TP、UDS（ISO 14229）dissector 内置
- 验证: `tshark --version`；candump `-l` 日志可直接 File → Open 打开

### python-can —— 脚本化解析（跨平台）

- 全平台: `pip install python-can`
- Linux: `apt install python3-can`（Debian/Ubuntu）/ `dnf install python3-can`（Fedora）/ `pacman -S python-can`（Arch extra）
- 验证: `python3 -c "import can; print(can.__version__)"`

### OBD-II / UDS 诊断库

- python-obd（ELM327 适配器，OBD-II 标准服务）: 无官方包 → `pip install obd`；验证 `python3 -c "import obd"`
- udsoncan（UDS ISO 14229 客户端）: 无官方包 → `pip install udsoncan isotp`；验证 `python3 -c "import udsoncan, isotp"`
- 注意：udsoncan 用 IsoTPSocketConnection 需要 Linux can-isotp 内核模块（5.10+）或 socketcan；无内核模块时用 PythonIsoTpConnection（走 python-can，跨平台但时序略差）

### scapy —— 汽车协议层（automotive 包，可选）

- 全平台: `pip install scapy`（含 `scapy.contrib.automotive` 与 `scapy.layers.can`）
- 验证: `python3 -c "from scapy.contrib.automotive.uds import UDS; from scapy.contrib.automotive.doip import DoIP; from scapy.layers.can import CAN; print('ok')"`

## 操作步骤

按顺序执行，每步记下结果。

1. **CAN 接入（USB-CAN / socketcan）**：
   - 无硬件起步（vcan 虚拟总线）:
     ```sh
     sudo modprobe can vcan can-isotp
     sudo ip link add dev vcan0 type vcan
     sudo ip link set up vcan0
     ```
   - USB-CAN（gs_usb 系）:
     ```sh
     sudo modprobe gs_usb
     sudo ip link set can0 up type can bitrate 500000    # 500 kbit/s 经典波特率
     ip -details link show can0                          # 确认 bitrate / state UP
     ```
   - 波特率必须与总线一致（错误波特率 = 错误帧刷屏，见坑 3）

2. **candump 抓包**：
   ```sh
   candump -t a can0                     # 实时查看（绝对时间戳）
   candump -l can0                       # 落盘日志（自动轮转，Wireshark 可直接打开）
   candump can0 -n 100                   # 只抓 100 帧
   candump can0 -f 0x7E0:0x7FF           # ID 过滤：掩码 0x7FF = 精确匹配 0x7E0；区间过滤用 0x7F8（匹配 0x7E0~0x7E7）；CAN 无地址（见坑 1）
   ```

3. **报文 ID / 周期 / 信号解析**：
   ```sh
   cansniffer can0                       # 按 ID 聚类、周期与变化字节高亮
   candump -c can0                       # 每 ID 帧计数
   canbusload can0@500000                # 总线负载率 %
   ```
   - 周期消息（固定间隔 10/50/100ms 常见）→ 转速/车速等连续信号；事件消息（无规律）→ 开关/按钮
   - 信号解包：先定字节序（Intel 小端 vs Motorola 大端，见坑 2）→ 逐字节变化观察（cansniffer 高亮变化字节）→ 用 cantools 按 DBC 定义解包（`pip install cantools`）
   - 产出 ID 表：ID / 周期 / 长度 / 疑似信号 / 字节序

4. **UDS / OBD 诊断**：
   - OBD-II 快速体检（标准诊断对 0x7E0/0x7E8，ELM327 适配器）:
     ```python
     import obd
     conn = obd.OBD()                     # 自动探测适配器串口
     conn.query(obd.commands.SPEED)       # 车速
     conn.query(obd.commands.GET_DTC)     # 故障码
     ```
   - UDS（ISO 14229，厂商诊断 ID 不固定，先抓包确认）:
     ```python
     import udsoncan, isotp
     from udsoncan.connections import IsoTPSocketConnection
     from udsoncan.client import Client
     from udsoncan.services import DiagnosticSessionControl, DataIdentifier
     conn = IsoTPSocketConnection('can0', isotp.Address(isotp.AddressingMode.Normal_11bits, rxid=0x7E8, txid=0x7E0))
     with Client(conn, request_timeout=2) as client:
         client.change_session(DiagnosticSessionControl.Session.extendedDiagnosticSession)
         client.read_data_by_identifier(DataIdentifier.VIN)
     ```
   - 服务速查：0x10 会话控制 / 0x22 读数据标识符 / 0x27 安全访问（seed-key）/ 0x2E 写数据 / 0x31 例程控制 / 0x3E 保持活动 / 0x11 ECU 复位 / 0x34-0x36-0x37 固件下载流程
   - Wireshark 打开 candump 日志 → ISO-TP/UDS dissector 自动解码诊断会话

5. **ECU 固件**：
   - UDS 下载流程（0x27 解锁 → 0x34 请求下载 → 0x36 传输数据 → 0x37 退出传输）或 0x23 读内存获取固件 → 转 [[re-fw-extract]] 解包（ECU/车机固件与 IoT 固件同流程）
   - 直接拿到的升级包文件 → [[re-fw-extract]]；固件 ELF → [[re-binary-core]]；需硬件 flash 读取 → [[re-hardware-io]]

## IVI / T-Box / V2X 路径

按目标形态分流（判定规则）：

- **IVI（车载娱乐系统）**：本质是 Android/Linux 系统——应用层走 [[re-apk]]，系统镜像走 [[re-firmware]]；关注 OEM 定制层（启动器、诊断接口、ADB/调试口）
- **T-Box（远程信息处理箱）**：蜂窝模组（AT 指令接口）、MCU 固件（[[re-fw-extract]] 提取分析）、远程控制协议（车控指令——门锁/空调/启动，走 [[re-protocol]]）
- **V2X（车联网通信）**：DSRC / C-V2X 帧结构 → [[re-protocol]] / [[re-ics]] 路径（协议状态机重建、PC5/Uu 接口区分）
- 判定规则：应用层 → 移动/系统路径（[[re-apk]] / [[re-firmware]]）；通信层 → 协议路径（[[re-protocol]] / [[re-ics]]）；固件层 → 固件路径（[[re-fw-extract]] / [[re-fw-rootfs]]）

## 跨域联合

- [[re-firmware]]：本技能是其汽车分支（ECU 固件提取后 → 解包 → rootfs → 仿真）
- [[re-fw-extract]] / [[re-fw-rootfs]] / [[re-fw-emulate]]：ECU/车机固件解包、文件系统分析、仿真
- [[re-hardware-io]]：OBD 口抓包（CAN/UART）、JTAG/SWD 读 flash
- [[re-protocol]]：DoIP（UDS over Ethernet，13400 端口）等车载以太网协议重建；CAN 私有协议转 [[re-proto-rev]]
- [[re-sandbox]]：虚拟 CAN / DoIP 测试床隔离；固件仿真默认网络隔离（[[platform-tips]] 最高原则）
- [[re-binary-core]]：固件内 ELF 深度静态分析
- [[re-crypto-id]] / [[re-crypto-decrypt]]：seed-key 算法、CAN 加密变体

## 常见坑与陷阱

- **CAN 无地址概念 → 过滤/归因错**：现象——想"按目标 ECU 过滤"却要么漏帧要么全抓；原因——CAN 帧无源目地址，只有 11/29 位仲裁 ID，ID 兼具优先级与"身份"（ID 越小优先级越高）；对策——先全量抓（candump）再按 ID 聚类归类（cansniffer / candump -c），用 `-f ID:mask` 过滤，不预设主机概念
- **信号位打包错**：现象——信号值乱（转速负值/巨大、多字节字段错位）；原因——信号跨字节跨位打包，Intel（小端）/Motorola（大端）序混用，且信号不必对齐字节边界；对策——先定字节序再解包，用 DBC + cantools 定义位布局，与实车读数/已知量程交叉验证
- **波特率不符与总线负载**：现象——`candump` 错误帧刷屏（error frame），或高负载下周期抖动、抓到的周期不可信；原因——波特率与总线不一致；负载高（>60-70%）时仲裁延迟与丢帧；对策——接入前确认波特率（500 kbit/s 最常见，canbusload 看负载率），周期性分析排除高负载时段，需要精确时序用硬件时间戳
- **seed-key 安全访问被拒**：现象——UDS 读内存/写标定回 0x7F 27 33（SecurityAccessDenied）；原因——0x27 需先解锁：服务端发 seed（0x27 01/03），客户端回 key（0x27 02/04），算法厂商私有（XOR/CRC/AES 常见）；对策——有合法诊断仪/工具时先抓一次正常解锁流程，算法还原走 [[re-crypto-id]] / [[re-crypto-decrypt]]；只在自有测试设备上做，不盲目爆破
- **固件校验/加密层**：现象——提取的固件在 [[re-fw-extract]] 解出垃圾，或烧回不工作；原因——ECU 固件带签名/CRC 校验、bootloader 验签或整体加密；对策——提取时按 0x34/0x36 会话完整传输并校验；分析时先区分加密/签名层再解包，解不开转 [[re-crypto-id]] / [[re-crypto-decrypt]]；仅在授权测试床/设备上操作
