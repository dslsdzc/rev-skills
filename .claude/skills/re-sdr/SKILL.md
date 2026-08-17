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
- 不用：有线协议（转 [[re-protocol]]）；无线 IoT 协议已封装分析（转 [[re-iot-proto]]）

## 工具准备

### RTL-SDR / HackRF（接收硬件）

- 选购指引：RTL-SDR（接收，低成本入门）/ HackRF（收发，重放需要）
- 验证: 硬件插入后 `rtl_test` 或 `hackrf_info` 有输出

### GNU Radio（信号处理）

- Linux: `apt install gnuradio` / `pacman -S gnuradio`；macOS: `brew install gnuradio`
- Windows: 官方安装包
- 验证: `gnuradio-companion --version` 或 `grcc --version`

### inspectrum（频谱/时序可视化）

- Linux: `apt install inspectrum` 或源码编译；macOS: `brew install inspectrum`
- 验证: `inspectrum --version`

### Universal Radio Hacker (URH)（解调与帧恢复）

- 多平台: `pip install urh`
- 验证: `urh --version`

## 操作步骤

按顺序执行；仅限授权测试（红线：重放/交互需授权）。

1. **信号采集与频谱分析**：
   ```sh
   # 示例（工具可替换）：GNU Radio 或命令行采集
   rtl_sdr -f 433.9M -s 1M capture.iq
   ```
   - 先全频段扫（找活跃信号）→ 定中心频率与带宽 → 采集 IQ
   - 调制识别：频谱形状（FSK 双峰/PSK 平坦/AM 载波）

2. **解调**：
   - URH：加载 IQ → 自动/手动调制识别 → 解调出位流
   - GNU Radio：按识别结果搭解调链（AM/FM/PSK/QAM/FSK）
   - 产出：解调位流（0/1 序列）

3. **帧同步与协议恢复**：
   ```sh
   # URH 位流分析：preamble/同步字识别、编码反转（NRZ/Manchester）
   urh --decode
   ```
   - 找同步字（重复模式/固定前缀）→ 定帧边界 → 字段划分（地址/长度/载荷/CRC）
   - 多帧对照（重复发射）→ 不变字段=固定头、变化字段=数据/序号
   - 产出：帧结构表（字段偏移/长度/语义）

4. **重放与交互**（授权场景）：
   - HackRF 回放捕获帧（重放攻击验证——仅授权目标）
   - 交互式：改字段重发（滚动码/加密需先分析算法——转 [[re-crypto-*]]）

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
