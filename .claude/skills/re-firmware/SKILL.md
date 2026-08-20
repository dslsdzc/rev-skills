---
name: re-firmware
type: gateway
description: >
  固件/嵌入式/硬件分析网关。编排：提取 → rootfs → 仿真 → 硬件接口。
  子技能：[[re-fw-extract]] [[re-fw-rootfs]] [[re-fw-emulate]] [[re-hardware-io]] [[re-automotive]] [[re-uefi]] [[re-rtos]] [[re-tee]]。
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
- 汽车 ECU / CAN 总线 / OBD-UDS 诊断 → [[re-automotive]]
- 见通信（固件回连 / 自定义协议 / 加密通信）→ [[re-protocol]]
- 目标是 UEFI 固件（BIOS 更新包/DXE 驱动/bootkit）→ [[re-uefi]]（UEFITool 解析 + OVMF 仿真）

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
- **启动链逐层校验（BootROM→FDL→SPL→U-Boot→system）**：现象——patch 掉一层校验刷机仍失败，后面还卡在别的验证；原因——移动 SoC（Unisoc/展锐等）刷机链每层独立验签：BootROM→FDL1→FDL2→SPL Loader→U-Boot/LK→system，SPL 对 sml/trustos/uboot 做 RSA-2048 校验（DHTB+SIMGHDR 格式），失败进死循环；对策——沿整条链逐层追：①**格式特征转常量**：文件头 ASCII（如 `DHTB`）按 32 位小端转整数（`1112819780`），在上一层反编译中搜该常量定位校验入口；②失败陷阱=死循环（校验失败 branch 到 loop），patch 失败分支改 NOP/调整分支让它继续走；③FDL2 加载基址从 spd_dump 命令行第二个 FDL 地址拿（IDA/Ghidra 加载基址用这个，xref 才对得上）；④字符串搜索找"按分区名分发刷写逻辑"的入口；⑤硬件固化方案（RP2350 作 USB Host 自动重放握手注入）只做自动化，真正关键在逆向与魔改加载链
