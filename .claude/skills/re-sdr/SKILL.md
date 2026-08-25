---
name: re-sdr
type: atomic
description: >
  射频逆向：信号采集、频谱分析、解调、帧同步与协议恢复、重放。
  触发词：SDR、射频、信号分析、解调、RTL-SDR、HackRF、无线协议、遥测。
---

# 射频信号逆向（SDR）

## 何时使用 / 何时不用

- 用：无线协议/遥控/遥测信号（IoT 无线、遥控器、遥测链路）、信号级协议恢复
- 用：433/868/915MHz ISM 频段传感器/遥控设备快速识别（`rtl_433` 自带解码器，见 [[commands]]）
- 用：重放攻击验证（仅授权目标——先把帧解出来再重放，别盲放）
- 不用：有线协议（转 [[re-protocol]]）；无线 IoT 协议已封装分析（转 [[re-iot-proto]]）
- 不用：只分析已解调的数据流/应用层（直接 [[re-proto-rev]] / [[re-crypto-decrypt]]）
- 不用：多通道同时监测（单 RTL-SDR 单通道；多通道需多设备或相位一致的采集方案）

## 工具准备

### RTL-SDR / HackRF（接收硬件）

- 选购指引：RTL-SDR（接收，低成本入门）/ HackRF（收发，重放需要）
- 驱动: `apt install rtl-sdr` / `brew install rtl-sdr`；HackRF: `apt install hackrf` / `brew install hackrf`
- 验证: 硬件插入后 `rtl_test` 或 `hackrf_info` 有输出
- 频率校准: `rtl_test -p` 挂几分钟读稳定 ppm 误差值，采集时 `rtl_sdr ... -e <ppm>` 补偿——频率偏移是解调乱码的首要原因
- 带宽差异: RTL-SDR 稳定带宽约 2.4MHz（理论 3.2MHz 不稳）；HackRF 最高 20MHz、半双工——宽带采集/主动发射选 HackRF（见 [[gotchas]]）

### GNU Radio（信号处理）

- Linux: `apt install gnuradio` / `pacman -S gnuradio`；macOS: `brew install gnuradio`
- Windows: 官方安装包
- 验证: `gnuradio-companion --version` 或 `grcc --version`

### Gqrx（频谱/接收 GUI）

- Debian/Ubuntu: `apt install gqrx-sdr`（注意包名带 -sdr 后缀）；Arch: `pacman -S gqrx`；Fedora: `dnf install gqrx`；macOS: `brew install --cask gqrx`
- 验证: `gqrx --version`（或 GUI 能打开并看到频谱瀑布）
- 用途: 实时频谱/瀑布图快速定位活跃信号与中心频率，比命令行扫频直观

### inspectrum（频谱/时序可视化）

- Linux: `apt install inspectrum` 或源码编译；macOS: `brew install inspectrum`
- 验证: `inspectrum --version`
- 用途: 对录好的 IQ 文件做离线时域/频谱分析（找帧结构、符号宽度）

### Universal Radio Hacker (URH)（解调与帧恢复）

- 多平台: `pip install urh`
- 验证: `urh --version`
- 用途: 解调（调制识别）、位流分析（同步字/编码反转）、字段划分一体

### rtl_433（ISM 频段传感器解码）

- Debian/Ubuntu: `apt install rtl-433`；Fedora: `dnf install rtl-433`；macOS: `brew install rtl_433`（下划线）；Arch: 仓库无包（AUR 或源码编译）
- 验证: `rtl_433 -h` 列出支持设备列表（如 0: 通用协议族、1: 温湿度计……）
- 用途: 433/868MHz 气象站/温湿度/车库门等常见遥控协议一键解码

## 操作步骤

按顺序执行；仅限授权测试（红线：重放/交互需授权）。

1. **信号采集与频谱分析**：
   ```sh
   # 示例（工具可替换）：GNU Radio 或命令行采集
   rtl_sdr -f 433.9M -s 1M capture.iq
   ```
   - 先全频段扫（找活跃信号）→ 定中心频率与带宽 → 采集 IQ
   - 扫描: `rtl_power -f 400M:470M:250k -g 40 -i 10 scan.csv`（输出 CSV，可用 gnuplot 画图）或用 Gqrx 瀑布图
   - 调制识别：频谱形状（FSK 双峰/PSK 平坦/AM 载波）；Gqrx 实时看，inspectrum 离线细看
   - 采集参数: `rtl_sdr -f <频率> -s <采样率> -g <增益> -n <采样数> out.iq`；`-g 0` 自动增益
   - 采样率原则: 采样率 ≥ 2×信号带宽——窄带遥控（几十 kHz）用 250k–1M 足够，别为省事开满 2.4M 徒增文件体积

2. **解调**：
   - URH：加载 IQ → 自动/手动调制识别 → 解调出位流
   - GNU Radio：按识别结果搭解调链（AM/FM/PSK/QAM/FSK）
   - 快速监听: `rtl_fm -f 433.9M -M fm -s 22050`（FM 语音/FSK 音频监听，听/录音频辅助识别）
   - 产出：解调位流（0/1 序列）

3. **帧同步与协议恢复**：
   - URH 打开捕获文件 → 位流分析视图找同步字、试编码反转（NRZ/Manchester）
   - 找同步字（重复模式/固定前缀）→ 定帧边界 → 字段划分（地址/长度/载荷/CRC）
   - 多帧对照（重复发射）→ 不变字段=固定头、变化字段=数据/序号
   - 位流转字节: 先确认位序（MSB/LSB first）与长度对齐（8 的倍数）——URH 默认按位显示，转字节前核对，否则字段划分全错
   - 产出：帧结构表（字段偏移/长度/语义）
   - 已知 ISM 设备: 先跑 `rtl_433 -f 433.9M -A`（`-A` 分析模式打印解出的脉冲序列与协议猜测）——常见协议（气象站/车库门/胎压）直接命中，省去人工恢复

4. **重放与交互**（授权场景）：
   - HackRF 回放捕获帧（重放攻击验证——仅授权目标）:
     ```sh
     hackrf_transfer -r capture.iq          # 先采集（HackRF 口）
     hackrf_transfer -t capture.iq -f 433.9M -a 1 -s 2M   # 回放（-a 1 开放大器）
     ```
   - 交互式：改字段重发（滚动码/加密需先分析算法——转 [[re-crypto-id]] / [[re-crypto-decrypt]]）
   - 重放前先验证采样率/增益与采集时一致——参数不匹配重放出去目标收不到（见 [[gotchas]]）

5. **证据整理（收尾）**：IQ 文件、解调位流、帧结构表（字段偏移/长度/语义）、重放记录（时间/参数/结果）对照入档；结论写 [[analysis-contract]]——信号级证据（截图/波形）与协议级结论（帧结构）分开归档

## 跨域联合

- [[re-iot-proto]]：无线 IoT 协议衔接（MQTT/CoAP 等封装层）
- [[re-protocol]]：帧结构状态机重建衔接
- [[re-crypto-id]] / [[re-crypto-decrypt]]：载荷加密分析
- [[re-feedback]]：信号案例经验沉淀（脱敏后）

## 常见坑与陷阱

- **频率偏移/采样率错误**：现象——解调全乱码；原因——中心频率偏、采样率不匹配；对策——先用已知信号（FM 广播）校准
- **调制误判**：现象——FSK 当 PSK 解；原因——频谱特征相似；对策——对照时域波形（inspectrum）再定
- **重放需授权**：现象——未授权重放触发设备动作；原因——越界操作；对策——红线：仅授权目标
- **编码反转漏看**：现象——位流全反；原因——NRZ/Manchester 未识别；对策——试反相与编码模式组合
- **捕获不完整**：现象——帧被截断；原因——带宽不够/触发时机；对策——加宽带宽、延长采集、按同步字触发
- **RTL-SDR 镜像频率/带宽限制**：现象——采到的信号在错误频率出现、带宽超 2.4MHz 后解调全乱；原因——直接采样混叠、USB 传输不稳；对策——带宽 ≤2.4M、先 `rtl_test -p` 校准 ppm 后用 `-e` 补偿（详见 [[gotchas]]）
- 硬件差异、工具特有坑见 [[gotchas]]；命令速查见 [[commands]]
