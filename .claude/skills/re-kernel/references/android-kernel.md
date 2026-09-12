# Android 内核模块分支（GKI / vendor module）

**前提认知**：Android 内核**不能只当普通 Linux** 处理——模块身份（GKI / vendor）、KMI 符号白名单、分区与加载阶段都会决定"这份模块到底能不能加载、为什么加载失败"。

## 一、先分清模块身份

- **GKI module**（Google 提供、随 GKI kernel 签名） vs **vendor module**（OEM/自建、未签名）
- 三方符号权限不同：**protected GKI module / unprotected GKI module / vendor module** 各有可访问的符号集合；vendor（unsigned）模块**只能使用 KMI 符号**，越界会被拒绝加载
- 构建期检查：ACK `kernel/build` 的 `abi/check_buildtime_symbol_protection.py`——unsigned 模块里所有 undefined symbol 必须在 **KMI 符号清单**内，或被另一个 unsigned 模块定义；否则**即使构建成功，运行时也会被拒绝加载**（构建期只是提前告警）
- 运行时症状：`module: Protected symbol: xxx (err -13)` / `module: exports protected symbol xxx`
  → **不要按普通 Linux"找不到符号 → patch 地址"处理**：这是 GKI 的符号保护策略，先识别 GKI protection / KMI 边界
- KMI 符号清单位置：`android/abi_gki_aarch64.xml` 与各子系统 fragment 文件

## 二、KMI 分支 ≠ 内核版本

- KMI 稳定性**只存在于同一 LTS + 同一 Android 大版本的组合**（例如 `android14-6.1`、`android15-6.6`、`android16-6.12`）；`android-mainline` 不保证 KMI 稳定
- 因此 **`android12-5.10` 与 `android13-5.10` 虽然都是 Linux 5.10，KMI 并不兼容**：用某一分支的 `Module.symvers` 构建的模块，与另一分支的 kernel/GKI 模块对不上；GKI 模块由 Google 签名，"只与它构建时对应的 GKI kernel 兼容"
- 分析/移植时的正确判据：精确到 **`androidXX-X.Y` + KMI generation + symbol list + `Module.symvers`/CRC**，而不是 `5.10 == 5.10`

## 三、模块在哪里、会不会被加载

- 查找位置（**不要硬编码 `*_dlkm` backing 路径**；AOSP 建议外部逻辑访问 `/vendor/lib/modules`、`/odm/lib/modules`）：
  `/vendor/lib/modules`、`/odm/lib/modules`、`/system/lib/modules`（早期模块在 vendor ramdisk 的 `/lib/modules`）
- 实际 backing 分区可能是：`vendor_dlkm` / `odm_dlkm` / `system_dlkm`
- 加载顺序与依赖：`modules.load`、`modules.dep`、`modules.softdep`
  - first-stage init 从 vendor ramdisk 的 `/lib/modules/modules.load` 按序加载 early modules，**实际顺序会因 hard/soft dependency 变化**
  - 晚期 vendor 模块可能来自 vendor/ODM DLKM
- **文件存在 ≠ 会被加载**；而且依赖的模块**可能位于另一个分区 / 另一个 boot stage**

## 工具与验证

- `modinfo`（vermagic / 依赖 / 签名）、`readelf -S`（`.modinfo` / `.BTF`）、`/proc/kallsyms`、`/sys/module/<name>/`
- GKI 侧：以目标分支的 symbol list 与 `Module.symvers` 做比对；签名侧见 `scripts/sign-file`（GKI 由 Google 签名、vendor 由 OEM 签名，key 需在 AVB 信任链内）
- 验证：能同时给出「模块身份（GKI/vendor）+ KMI 分支 + 所在分区 + 是否在 `modules.load` 计划内」

## 该平台的坑

- **把 `android12-5.10` 与 `android13-5.10` 当同一个内核**：KMI 不兼容
- **见到 `Protected symbol` 就按普通 Linux 去 patch 符号**：那是 GKI 策略，不是符号缺失
- **硬编码 `*_dlkm` 路径去找模块**：按 AOSP 建议走 `/vendor/lib/modules` 等入口
- **认为"文件在 = 已加载"**：要看 `modules.load`、依赖与分区
- **忘了模块可能是 built-in**：Android 侧同样存在（与 Linux 分支同理）
