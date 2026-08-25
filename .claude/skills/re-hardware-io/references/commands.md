# 硬件接口命令速查与操作序列（UART / JTAG-SWD / Flash / 逻辑分析仪）

工具族分工：picocom/minicom（串口终端）→ openocd（JTAG/SWD 调试与 flash dump）→ flashrom（SPI flash 直读）→ sigrok-cli/pulseview（逻辑分析仪）→ JTAGulator（未知板引脚枚举）。硬件操作前置：万用表测电平、共地、核对丝印（见 [[gotchas]] 与 SKILL.md 坑）。

## 命令族速查

### 串口（picocom / minicom）

| 用途 | 命令 |
|---|---|
| 打开串口 | `picocom -b 115200 /dev/ttyUSB0` |
| 退出 picocom | `Ctrl+A Ctrl+X` |
| 无流控模式 | `picocom -b 115200 --nolock /dev/ttyUSB0`（权限不够时配合 sudo） |
| minicom 版 | `minicom -D /dev/ttyUSB0`（`Ctrl+A Z` 帮助，`Ctrl+A X` 退出） |
| 串口设备确认 | `ls /dev/ttyUSB* /dev/ttyACM*`；`dmesg | grep tty`（插拔后看新节点） |
| 记录到文件 | `picocom ... | tee log.txt`（或 minicom 捕获功能） |

### openocd —— JTAG/SWD（Telnet 交互 + 命令行）

| 用途 | 命令 |
|---|---|
| ST-Link + STM32F1 | `openocd -f interface/stlink.cfg -f target/stm32f1x.cfg` |
| 其他适配器 | `ls /usr/share/openocd/scripts/interface/`（jlink/swd 等按名选） |
| 一行命令模式 | `openocd -f <if> -f <target> -c "init; halt; flash read_bank 0 dump.bin; exit"` |
| 交互模式 | 启动后连 `telnet localhost 4444`（默认端口） |
| halt 暂停 | `halt` |
| 读寄存器 | `reg pc` / `reg sp` / `reg`（全部） |
| 读内存 | `mdw <addr> 16`（32 位读 16 个）/ `mdb` / `mwh` |
| 写内存 | `mww <addr> <val>`（危险操作，先读后写） |
| dump flash | `flash read_bank 0 dump.bin`（bank 号与镜像大小以 `flash banks` 为准） |
| 擦/写 flash | `flash erase_sector 0 0 last` / `flash write_bank 0 firm.bin`（写会破坏原内容，先备份） |
| 复位 | `reset` / `reset halt` |
| 解锁（读保护） | `stm32f1x unlock 0` 类命令（按目标系列；见 [[gotchas]]） |

### flashrom —— SPI flash 直读

| 用途 | 命令 |
|---|---|
| 列芯片型号 | `flashrom -p ch341a_spi`（不带 -r 先识别） |
| 读取 | `flashrom -p ch341a_spi -r backup.bin` |
| 板载 SPI（spidev） | `flashrom -p linux_spi:dev=/dev/spidev0.0 -r backup.bin` |
| 校验 | `flashrom -p ch341a_spi -v backup.bin`（读回比对） |
| 写入 | `flashrom -p ch341a_spi -w new.bin`（破坏性，先读后写） |
| 强制指定型号 | `-c <chipname>`（识别失败但已知型号时，`flashrom -p ch341a_spi -c "W25Q128"` 类） |

### 逻辑分析仪（sigrok-cli）

| 用途 | 命令 |
|---|---|
| 列设备 | `sigrok-cli -L` / `sigrok-cli --scan` |
| 采样抓取 | `sigrok-cli -d <driver>:conn=<设备> -c samplerate=1M -O <格式> -o data.sr -t 10s` |
| UART 解码 | `sigrok-cli -d ... -A uart:rx=<通道>:baudrate=115200 -o out.txt` |
| SPI 解码 | `-A spi:clk=<脚>:mosi=<脚>:miso=<脚>:cs=<脚>` |
| 图形查看 | `pulseview`（GUI，加载 .sr 逐协议解码） |

### JTAGulator —— 引脚枚举

```
串口连接（如 /dev/ttyUSB0，115200）→ 发送 help 看命令
UART 枚举：uart 命令逐引脚扫波特率
JTAG 枚举：jtag 命令（目标断电/上电状态按提示操作）
```

## 常用操作序列

### 1. UART 启动日志抓取（最轻的固件情报）

```
万用表确认 VCC/GND/TX（上电瞬间 TX 拉高的方波）→ 交叉接线 + 共地
→ picocom -b 115200 → 乱码则 Ctrl+A Ctrl+X 换 9600/57600/38400/19200/230400
→ 板子重新上电抓完整启动日志 → tee log.txt 存档
→ 日志含 bootloader/内核/文件系统/服务自启 → 对照 [[re-fw-rootfs]] 启动脚本
```

### 2. SPI flash 直读（离线提取）

```
断电 → SOIC8 夹子夹住 flash（核对 1 脚方向）→ 编程器接 USB
→ flashrom -p ch341a_spi（识别型号）→ -r backup.bin → 断电取下
→ 镜像转 [[re-fw-extract]] 解包；保留原始 bin 与 sha256
```

### 3. JTAG/SWD 连上 dump flash（板载在线）

```
核对丝印找 JTAG/SWD 测试点（VCC/GND/TMS-TCK-TDO-TDI 或 SWDIO/SWCLK）→ 接调试器
→ openocd -f interface/stlink.cfg -f target/stm32f1x.cfg → halt
→ flash banks 看 bank 列表 → flash read_bank 0 dump.bin
→ 失败（IDCODE 全 0/超时）→ 查熔断/读保护（见 [[gotchas]]）
```

### 4. 逻辑分析仪抓 UART 验证波特率

```
板子 TX 接到分析仪通道（共地）→ sigrok-cli -c samplerate=1M 采样
→ -A uart:baudrate=115200 解码 → 乱码则换 9600/57600 重试
→ 波形图确认 TX 空闲电平与帧格式（8N1）→ 反推真实波特率
```

## 实现教训（内化）

- 硬件操作不可逆程度高：先观测（万用表/逻辑分析仪/启动日志）后动手（焊/写）
- 每次接线/换挡记录照片与笔记：丝印、引脚编号、电平、接线颜色——返工排查全靠它
- flash 写操作前必读备份并校验（-v）——写坏救不回来
- 一个工具不通换路径：JTAG 锁了走 UART + flash 直读；flash 焊接位坏走在线读；始终保留最轻方案
- 提取产物（dump.bin + sha256 + 板型/芯片型号）入档，供 [[re-fw-extract]] / [[re-fw-rootfs]] 消费

## 使用注意

- 断电操作接线；带电插拔是烧板第一原因（见 [[gotchas]]）
- 提取的镜像与日志 sha256 存档；硬件操作记录（时间/步骤/照片）写分析笔记（[[re-triage]] 惯例）
- 板子来源与授权：仅分析自己持有或有权限的硬件
