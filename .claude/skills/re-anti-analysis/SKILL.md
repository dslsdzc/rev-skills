---
name: re-anti-analysis
type: gateway
description: >
  反分析对抗网关。编排：壳识别 → 简单壳脱壳 → 强壳脱壳 → 反混淆。
  子技能：[[re-packer-id]] [[re-unpack-simple]] [[re-unpack-advanced]] [[re-deobfuscate]]。
  触发词：脱壳、查壳、加壳识别、壳、UPX、VMProtect、Themida、反调试、反混淆、花指令、unpack、anti-analysis。
---

# 反分析对抗（壳识别 / 脱壳 / 反混淆）

## 完整工作流

1. **壳识别：[[re-packer-id]]** —— 先识别再动手。DIE/PEiD 签名库扫描、节名异常（UPX0/.aspack/自定义）、入口点是否指向非首节、熵 >7、导入表极小。**先记 OEP 线索**（EP 附近 pushad 等壳入口特征），识别出的壳名决定路径
2. **分派**：简单压缩壳（UPX/ASPack/FSG）→ [[re-unpack-simple]]；强壳/虚拟化壳（VMProtect/Themida）→ [[re-unpack-advanced]]；**识别不出 → 手动流程**（按 [[re-unpack-simple]] 的 ESP 定律 + 内存断点手动找 OEP，或按强壳流程处理），不硬猜壳名
3. **简单壳脱壳：[[re-unpack-simple]]** —— 优先官方/自动解包（`upx -d`）→ ESP 定律 / 内存断点找 OEP → **OEP 解密完成后转储**（时机见 [[platform-tips]] 关键经验，默认转储优先）→ IAT 修复（Scylla/ImpREC，Windows）
4. **强壳脱壳：[[re-unpack-advanced]]** —— 反调试对抗（scyllaHide 思路：NtQueryInformationProcess/时间差）→ 堆栈回溯/内存断点组合找 OEP → 转储（默认转储优先）→ IAT 修复（含重定向）→ 虚拟化代码区域标注（标记绕过而非还原）
5. **反混淆：[[re-deobfuscate]]** —— 脱壳后若仍有花指令 / 控制流平坦化 / 字符串加密：花指令清除、平坦化还原（D-810/手动）、字符串解密循环定位与仿真、批量脚本化、还原前后对比验证
6. **验证**：脱壳产物 sha256 存档 → 沙箱内复跑（[[re-sandbox]] 判定脱干净、[[platform-tips]] 最高原则）→ 导入 [[re-ghidra]] / [[re-ida]] 确认 OEP 处可正常反编译；导入表可解析才算完成。产物交回原调用域继续（恶意样本回 [[re-malware]] 行为分析、破解目标转 [[re-cracking]] 授权定位）

每步结果存档（证据路径 + sha256，见 [[re-triage]]）；壳指纹 / 脱壳产物是 [[re-ioc]] YARA 特征来源。

## 何时用哪个原子技能（选择树）

**先识别、再选脱壳路径；识别不出走手动流程。**

- **输入是未知样本 / 怀疑带壳** → [[re-packer-id]] 识别 → 按结果分支（不跳步）
  - 识别出简单压缩壳（UPX / ASPack / FSG 等）→ [[re-unpack-simple]]
  - 识别出强壳 / 虚拟化壳（VMProtect / Themida 等）→ [[re-unpack-advanced]]
  - **识别不出壳名**（无签名匹配）→ 手动流程：先按 [[re-unpack-simple]] 的 ESP 定律 + 内存断点尝试；失败或发现反调试/虚拟化特征 → [[re-unpack-advanced]] 手动脱壳
- **目标只是确认壳**（"这是什么壳"）→ [[re-packer-id]] 即可，不进入脱壳
- **脱壳后仍有代码混淆**（花指令 / 平坦化 / 字符串加密）→ [[re-deobfuscate]]
- **目标已确认无壳** → 不需要本网关，转 [[re-binary-core]]（[[re-ghidra]] / [[re-ida]] / [[re-radare2]]）直接分析
- 脱壳全程需要读进程内存 → [[re-memdump]]（OEP 后默认转储）；Windows 调试 → [[re-x64dbg]]；Linux/Wine 调试 → [[re-gdb]]

## 跨域联合

- 恶意样本加壳：[[re-malware]] → 本网关（packer-id → unpack-*），脱壳产物回沙箱复跑再行为分析
- 破解前置：[[re-cracking]] → 本网关（带壳先脱壳，再定位授权逻辑），授权定位产物供补丁/注册机
- 移动加固：[[re-mobile]] / [[re-apk]] → 本网关（Android 加固脱壳）
- 静态发现壳：[[re-binary-core]] / [[re-format-pe]] / [[re-format-elf]] / [[re-imports]]（导入表极小/壳隐藏导入）→ 转入本网关
- 动态辅助：[[re-gdb]]（断 OEP、Wine 下脱壳）、[[re-x64dbg]]（Windows OEP + Scylla）、[[re-memdump]]（OEP 后默认转储）、[[re-tracing]]（反调试样本检测 trace 环境时配合）
- 脱壳产物验证必须沙箱：[[re-sandbox]]（[[platform-tips]] 最高原则）
- 壳层常量污染指纹：[[re-crypto-id]] 加壳样本先脱壳再做常量表指纹
- 本网关被 [[re-analyze]] 的 triage「样本带壳 / 脱壳」路径调用（re-anti-analysis → packer-id → unpack-* → 验证）

## 常见坑与陷阱

- **跳过识别直接脱**：现象——拿样本就上调试器/OEP 流程，撞上强壳反调试或浪费时间；原因——没先判壳类别；对策——先 [[re-packer-id]] 识别，简单壳自动解包秒解，强壳才值得上手动流程
- **转储时机过早**：现象——dump 出来还是壳的初始状态（压缩/加密数据），脱了个寂寞；原因——壳未运行到 OEP 就转储；对策——等解密完成后 dump（[[platform-tips]] 关键经验，默认转储优先）
- **IAT 不修当成品**：现象——脱壳后导入表乱，Ghidra/IDA 反编译一片混沌；原因——导入表在壳内动态重建，转储未修复；对策——Windows 上 Scylla/ImpREC 修复，修复后重新反编译验证
- **壳套壳**：现象——脱完一层发现里面还有一层（UPX 里包 Themida 等）；原因——多层加壳是常见反分析手法；对策——脱一层验证一层（sha256 + 导入表 + 沙箱复跑），套层时回到第 1 步重新识别
- **反调试干扰整个流程**：现象——调试器断点不生效、进程退出、时序错乱；原因——样本检测调试器（NtQueryInformationProcess、时间差、调试端口）；对策——[[re-unpack-advanced]] 反调试对抗先行（scyllaHide 思路），先攻最外层检测
