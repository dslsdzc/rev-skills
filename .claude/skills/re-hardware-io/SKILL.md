---
name: re-hardware-io
description: >
  硬件接口：JTAG/UART/flash 读取。
  触发词：JTAG、UART、串口、flash芯片、硬件提取、逻辑分析仪
---

# 硬件接口（JTAG / UART / Flash 读取）

## 何时使用 / 何时不用

- 用：有实物板子，需要提取固件、抓启动日志、硬件调试
- 用：JTAG/SWD 调试、UART 串口、flash 芯片直读、逻辑分析仪抓信号
- 不用：只有固件文件（走 [[re-fw-extract]]，硬件提取是最后手段）
- 不用：已解出 rootfs 只需静态分析（走 [[re-fw-rootfs]]）
- 不用：需要运行固件（先试 [[re-fw-emulate]] 更安全、更便宜）

## 工具准备

所有工具先验证再使用。硬件操作风险高：先万用表测电平、共地、核对丝印再上电（见坑 3/4）。遵循 [[platform-tips]] 先给最轻可行方案：软件手段（文件→解包→仿真）耗尽后再上硬件。

### openocd —— JTAG/SWD 调试

- Linux: `apt install openocd` / `dnf install openocd` / `pacman -S openocd`
- macOS: `brew install openocd`
- Windows: `choco install openocd`（或官方 Windows 构建）
- 验证: `openocd --version`

### picocom / minicom —— 串口终端

- Linux: `apt install picocom`（或 `apt install minicom`）/ `dnf install picocom` / `pacman -S picocom`
- macOS: `brew install picocom`
- Windows: `choco install putty`（PuTTY 支持串口）或 WSL 内 Linux 版
- 验证: `picocom --version`

### flashrom —— flash 芯片读取

- Linux: `apt install flashrom` / `dnf install flashrom` / `pacman -S flashrom`
- macOS: `brew install flashrom`
- Windows: 官方构建或 WSL（编程器 ch341a 在 WSL 内用 `flashrom -p ch341a_spi`）
- 验证: `flashrom --version`

### 逻辑分析仪（sigrok-cli / pulseview）

- Linux: `apt install sigrok-cli pulseview` / `dnf install sigrok-cli pulseview` / `pacman -S sigrok-cli pulseview`
- macOS: `brew install sigrok-cli pulseview`
- Windows: sigrok 官方 Windows 安装包（sigrok.org）
- 验证: `sigrok-cli --version` / `pulseview --version`

### JTAGulator —— 引脚识别板（开源硬件）

- 开源硬件项目 `git clone https://github.com/grandideastudio/JTAGulator`（含固件与文档）；需自行购买/打样 JTAGulator 板
- 验证: 串口连接后发送 `help` 显示命令清单
- 用它对未知板自动枚举 UART/JTAG 引脚（步骤 1/2 的得力工具）

## 操作步骤

按顺序执行，每步记下结果。

1. **板子拆解与接口定位**：
   - 拆壳观察 PCB：丝印（TX/RX、VCC、GND、JTAG/SWD 测试点）、插针、flash 芯片型号（如 W25Q128、MX25L、GD25Q）
   - 万用表：测供电电平（3.3V 常见，也有 5V / 1.8V）、找 GND；UART TX 脚特征——上电瞬间拉高到逻辑高电平的方波
   - 拍照存档：丝印、引脚编号、flash 型号，供后续接线核对
2. **UART 串口调试（波特率枚举）**：
   ```sh
   picocom -b 115200 /dev/ttyUSB0        # 先试 115200
   # 乱码 → Ctrl+A Ctrl+X 退出，换 9600 / 57600 / 38400 / 19200 / 230400
   # 或 minicom -D /dev/ttyUSB0
   ```
   - TX/RX 需交叉接线（板子 TX ↔ 适配器 RX）；共地必须
   - 上电瞬间抓启动日志——是了解系统最快途径（见坑 4）
3. **JTAG/SWD 连接（openocd）**：
   ```sh
   openocd -f interface/stlink.cfg -f target/stm32f1x.cfg   # ST-Link + SWD 示例
   # 其他适配器在 /usr/share/openocd/scripts/interface/ 下选对应 cfg
   ```
   - 确认接口类型（JTAG 4/5 线 vs SWD 2 线）与电平（1.8V 板子需电平适配器）
   - 连上后 `halt` 暂停、读寄存器、dump flash（`flash read_bank 0 dump.bin`）
4. **flash 芯片读取（flashrom/编程器）**：
   ```sh
   # 板载 SPI flash（linux_spi 需内核 spidev 支持）：
   flashrom -p linux_spi:dev=/dev/spidev0.0 -r backup.bin
   # 离线读取（ch341a 编程器 + SOIC8 夹子，先断电）：
   flashrom -p ch341a_spi -r backup.bin
   ```
   - 核对芯片型号与封装（SOIC8 夹子/测试座），引脚方向别接反
   - 读出的镜像转 [[re-fw-extract]] 解包
5. **启动日志抓取**：
   - 串口连好 → 板子上电 → 全量抓日志（`picocom` 输出 `tee log.txt`，或 minicom 捕获）
   - 日志含 bootloader、内核启动、文件系统挂载、服务自启信息；与 [[re-fw-rootfs]] 的启动脚本对照定位
   - UART 没输出 → 回到步骤 1 复查接线/波特率，或用逻辑分析仪抓 TX 脚波形验证

## 跨域联合

- [[re-firmware]]：工作流第 5 步（需实物时）调用本技能
- 提取的 flash 镜像 → [[re-fw-extract]] 解包 → [[re-fw-rootfs]] 分析；需要运行 → [[re-fw-emulate]]
- 硬件上抓到的通信/协议 → [[re-protocol]]
- 硬件提取是固件分析的最后手段：软件手段（文件 → 解包 → 仿真）全部耗尽后再上
- 物理层芯片/PCB 分析（decap/裸片/木马检测）→ [[re-hw-chip]]

## 常见坑与陷阱

- **波特率不对 → 乱码**：现象——串口输出全是乱码或无输出；原因——波特率/数据位不匹配、TX/RX 接反；对策——按 9600 / 115200 优先枚举（57600 / 38400 / 230400 兜底），用逻辑分析仪看 TX 波形验证，共地必须
- **JTAG 被熔断/锁定**：现象——openocd 连不上，IDCODE 全 0 或超时；原因——量产板熔断 JTAG、读保护（RDP）开启；对策——试 SWD、`stm32f1x unlock` 类解锁序列，或放弃 JTAG 改走 UART + flash 直读（步骤 4）
- **5V/3.3V 电平误接烧板**：现象——接线后板子发热/冒烟/永久损坏；原因——电平不匹配（3.3V 板上接 5V TTL）、供电接错、VCC/GND 反接；对策——先万用表测电平与 GND 再接线；3.3V 系统用 3.3V 适配器；绝不带电插拔
- **先看启动日志再动手**：现象——盲目拆焊 flash / 连 JTAG 导致损坏或数据丢失；原因——跳过低成本观察直接上硬件手段；对策——先 UART 抓启动日志了解系统（步骤 2/5），再决定是否硬件读取——这是 [[platform-tips]] 先给最轻可行方案在硬件域的执行
- **Intel DCI 调试工具链兼容性坑**：现象——Intel System Studio 2019（System Debugger）在 Win10/11 安装/运行失败，DCI 线缆连不上 CPU；原因——该软件基于 Win7 开发且带环境检测与 License 校验：Win11 提示缺 Win7 安全补丁、公开 License 文件在 Windows 版无效；对策——安装用兼容模式；运行加 `--noprereq` 跳过环境检查；License 校验核心在 `issa.dll` 导出函数中（三个校验函数），patch 后替换即可；DCI 配置按平台选型（如 KBL=Kaby Lake、SPT=200 系主板、DBC=Debug Class 线缆），CLI 调试用 DAL 目录的 `PythonConsole.cmd`（Python 2.7 环境，`itp.cores`/`itp.halt()` 等命令）；ME 端需 UTOK 解锁才响应调试命令（见 [[re-fw-extract]]）
