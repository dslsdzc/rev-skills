# SDR 命令速查与操作序列

SDR 链路按「采集 → 频谱 → 解调 → 位流/帧分析 → 重放」五段组织工具。命令以各工具官方文档为准（osmocom rtl-sdr、greatscottgadgets hackrf、rtl_433 官方 README、URH 文档）。

## 命令族速查

### 硬件验证

- `rtl_test [-s 采样率]`：RTL-SDR 自检（开机会自测，输出 `Successfully opened` 即 OK）
- `rtl_test -p`：测 ppm 频率误差（挂几分钟读稳定值，采集时 `-e <ppm>` 补偿）
- `hackrf_info`：HackRF 固件/序列号信息（`board_id`/`serial_number` 可见即 OK）

### 采集

- `rtl_sdr -f <频率> -s <采样率> -g <增益> -n <采样数> out.iq`：RTL-SDR 采集裸 IQ（8-bit 无符号交错 I/Q；`-g 0` 自动增益；`-e` 加 ppm 补偿）
- `rtl_sdr -f 433.9M -s 1M capture.iq`：基础采集（后续 GNU Radio / inspectrum / URH 都能读）
- `hackrf_transfer -r capture.iq -f 433.9M -s 2M -a 1`：HackRF 采集（`-a 1` 开 RX 放大器；采样率上限高，宽带场景用）
- `hackrf_transfer -t capture.iq -f 433.9M -s 2M -a 1`：HackRF 回放发射（重放攻击验证——仅授权目标）

### 频谱/监测

- `rtl_power -f 400M:470M:250k -g 40 -i 10 scan.csv`：扫频输出 CSV（频率/时间/功率），gnuplot/Excel 画瀑布
- `gqrx`：GUI 频谱+瀑布实时看；`rtl_fm`：快速听/录 AM/FM 音频（`rtl_fm -f 433.9M -M fm -s 22050`）

### 解调

- URH（GUI）: `urh` → 打开 IQ → Signal 视图自动/手动调制识别 → Demodulate → 位流视图
- GNU Radio: `gnuradio-companion` 搭解调链（RTL-SDR Source → 滤波器 → 解调器 → 位流）；`grcc flow.grc` 无头编译成 Python 脚本
- `rtl_433 -f 433.9M -A`：ISM 设备一键解调+协议猜测（`-A` 打印脉冲序列与协议命中）；`-F json` JSON 输出

### 帧/位流分析

- `inspectrum capture.iq`：离线频谱+时域（看帧结构、符号宽度、找同步字时域特征）
- URH 位流分析视图: 找同步字、编码反转（NRZ/Manchester）、字段划分
- `rtl_433 -R <协议号>`：限定协议族解码（`-h` 列表查协议号）

### 信号生成（授权场景辅助）

- GNU Radio 波形生成: 构建发射链回放/修改字段（HackRF Source 输出）
- `hackrf_transfer -t` 直接回放原始 IQ（不做修改时的最快路径）

## 常用操作序列（组合套路）

### 1. 全频段扫描 → 定位 → 采集

```
rtl_power -f 300M:500M:250k -g 40 -i 10 scan.csv   # 找活跃频点
# CSV 里找稳定高功率频点 → gqrx 对该频点确认
rtl_sdr -f <频点> -s 1M -g 40 -n 8000000 cap.iq    # 8M 采样 ≈ 8 秒（1M 采样率）
```

### 2. 未知遥控协议恢复（采集 → URH 全流程）

```
rtl_sdr -f 433.9M -s 1M -g 40 -n 8000000 cap.iq
urh → 打开 cap.iq → 调制识别（ASK/FSK）→ 解调 → 位流
找重复帧 → 标同步字 → 编码反转试验（NRZ/Manchester 组合）
多帧对照 → 字段划分（固定头/地址/长度/载荷/CRC）→ 帧结构表
```

### 3. 已知 ISM 设备快速识别（rtl_433 直解）

```
rtl_433 -f 433.9M -A            # 分析模式：看协议猜测与脉冲序列
rtl_433 -f 433.9M -F json       # 持续 JSON 输出（长时间监测）
# 命中协议 → 用 -R 限定 → 字段语义对照官方/社区解码器
```

### 4. 重放验证（仅授权目标）

```
hackrf_transfer -r cap.iq -f 433.9M -s 2M -a 1     # 用 HackRF 重新采集（保证采样率匹配）
hackrf_transfer -t cap.iq -f 433.9M -s 2M -a 1     # 原样回放
# 观察目标动作；失败先查采样率/增益是否与采集一致
# 改字段重放: GNU Radio 解调→改 bit→重新调制→hackrf_transfer -t
```

### 5. 解调位流 → 协议状态机重建（与 [[re-proto-rev]] 衔接）

```
URH 导出位流/字段 → 帧结构表（偏移/长度/语义）
多帧时序分析（重发/序号递增/ACK）→ 状态机假设 → 改字段重发验证
```

## 实现教训（内化）

- 采样率与带宽关系先算好：采样率 ≥ 2×信号带宽，窄带信号别开满 2.4M（文件大、没收益）
- 频率偏移先校准再采集：`rtl_test -p` 拿 ppm，`-e` 补偿——解调乱码时先怀疑频率而非调制识别
- 编码反转/位序是第二位流坑：NRZ/Manchester、MSB/LSB 都要试，URH 里一键切换成本低
- 多帧对照是帧结构恢复的核心方法：同一遥控按多次，不变字段=固定头，变化字段=数据/序号
- 已知设备先跑 `rtl_433 -A`：常见协议（气象站/车库门/胎压）自带解码器，别在人工恢复上浪费时间
- IQ 文件命名带频率/采样率/时间（如 `cap_433.9M_1M_20260825.iq`）——跨会话可复现

## 使用注意

- 全部在沙箱/授权环境内执行（[[platform-tips]] 最高原则）；发射/重放红线：仅授权目标
- 采集与重放参数（频率/采样率/增益）必须记录并保持一致
- 结论写 [[analysis-contract]]；信号级证据（IQ/波形）与协议级结论（帧结构）分开归档
