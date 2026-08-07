---
name: re-firmware
type: gateway
description: >
  固件/嵌入式/硬件分析网关。编排：提取 → rootfs → 仿真 → 硬件接口。
  子技能：[[re-fw-extract]] [[re-fw-rootfs]] [[re-fw-emulate]] [[re-hardware-io]]。
  触发词：固件分析、固件、IoT、解包固件、rootfs、仿真固件、firmware analysis。
---

# 固件 / 嵌入式 / 硬件分析

## 完整工作流

1. 初勘：[[re-triage]] —— file/哈希/熵确认固件类型、架构与字节序（未走 [[re-analyze]] 入口则先补做，读取 `RE_*` 会话变量）
2. 提取：[[re-fw-extract]] —— binwalk/unblob 自动解包，magic 手工扫描，字节序判断
3. rootfs：[[re-fw-rootfs]] —— 挂载/解包文件系统，启动脚本定位入口，配置/密钥/硬编码口令挖掘
4. 仿真：[[re-fw-emulate]] —— 需要运行时用 QEMU 用户态优先（最轻方案，见 [[platform-tips]]），全系统按需
5. 硬件接口：[[re-hardware-io]] —— 需实物板子时（JTAG/UART/flash 读取）；有固件文件先走 2-4，硬件是最后手段
6. 通信：提取/运行中发现固件通信、回连、自定义协议 → [[re-protocol]]（netcap / proto-rev / crypto-*）
7. 产出：结论 / 报告（按 `RE_REPORT`），哈希与证据存档（见 [[re-triage]]）

每步结果存档（证据路径 + sha256，见 [[re-triage]]），供报告引用；发现恶意样本/后门随时转 [[re-malware]]。

## 何时用哪个原子技能（选择树）

- 有固件文件（.bin / .img / 升级包）→ [[re-fw-extract]] 解包
- 已有 rootfs / 解包产物 → [[re-fw-rootfs]] 分析文件系统
- 需要运行固件观察行为 → [[re-fw-emulate]]（先确认架构，见 [[re-triage]]）
- 有实物板子 / 需要硬件提取 → [[re-hardware-io]]
- 见通信（固件回连 / 自定义协议 / 加密通信）→ [[re-protocol]]

## 跨域联合

- 固件通信协议：[[re-firmware]] → [[re-protocol]]（netcap / proto-rev / crypto-* 识别与重建固件通信）
- 固件内恶意样本/后门：[[re-firmware]] → [[re-malware]]（沙箱行为分析见 [[re-sandbox]]）
- 固件内 ELF 深度静态分析：→ [[re-binary-core]]（[[re-format-elf]] / [[re-ghidra]]）
- 仿真动态分析默认沙箱 + 网络隔离（[[platform-tips]] 最高原则）
- 本网关被 [[re-analyze]] 的 triage.md「分析固件 / IoT 设备」路径调用（re-firmware → re-fw-extract → re-fw-rootfs → re-fw-emulate → 若见通信 re-protocol）

## 常见坑与陷阱

- 拿到固件跳过初勘直接 binwalk → 架构/字节序未知，解出的程序无法仿真 —— 先 [[re-triage]] 确认（大端 ARM/MIPS 常见）
- 自动解包失败就放弃 → 厂商自定义头/加密层最常见 —— 转 [[re-fw-extract]] 手工 magic 扫描 + dd 按偏移切分
- 一上来就要实物板子 → 成本高、有损坏风险 —— 有固件文件先走 提取→rootfs→仿真，[[re-hardware-io]] 是最后手段
- 仿真不隔离网络就跑固件 → 固件真实回连外网 —— 默认沙箱 + 网络隔离（[[platform-tips]] 最高原则），通信分析转 [[re-protocol]]
- rootfs 分析不看启动脚本 → 面对几十个二进制无从下手 —— 先 [[re-fw-rootfs]] 读 rcS / inittab / init.d 定位程序入口
