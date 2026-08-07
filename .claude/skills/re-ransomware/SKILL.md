---
name: re-ransomware
description: >
  勒索软件分析：加密识别、勒索信、解密恢复思路。
  触发词：勒索、ransomware、加密文件、勒索信、解密恢复
---

# 勒索软件分析（加密识别 / 勒索信 / 解密恢复）

## 何时使用 / 何时不用

- 用：受害者文件被加密（扩展名变化、文件头损坏、熵升高）、出现勒索信（README/DECRYPT）的样本
- 用：需要判断"能不能恢复"并给出解密恢复路线（密钥提取 → 解密脚本 / 社区解密工具）
- 用：勒索样本的加密算法、密钥管理、C2 交互还原
- 不用：样本还没确认是勒索（先 [[re-triage]] 初勘 + [[re-behavior]] 行为确认）
- 不用：只分析加密算法本身（直接走 [[re-crypto-id]] / [[re-crypto-keys]]）
- 注意：运行样本 = 会真实加密文件，必须在沙箱快照内（[[re-sandbox]] 强制前置，[[platform-tips]] 最高原则）；静态分析可免沙箱

## 工具准备

所有工具先验证再使用。加密三件套与沙箱的完整装法见各技能，本技能直接复用；本技能独有的是文件系统快照工具（防样本加密破坏分析环境，坑 1）。

### 加密分析三件套（复用 crypto 域）

- [[re-crypto-id]]：算法识别（常量表指纹、自定义加密）
- [[re-crypto-keys]]：密钥提取（硬编码/内存/资源）
- [[re-crypto-decrypt]]：解密脚本（pycryptodome 装法见该技能）
- 验证: `python3 -c "from Crypto.Cipher import AES; print('ok')"`（见 [[re-crypto-decrypt]]）

### 沙箱环境（运行前置）

- [[re-sandbox]]：VM 快照 + 网络隔离（INetSim / fake DNS）；勒索样本动态分析默认 VM 快照级别（加密行为破坏性强）
- 验证: 快照 `VBoxManage snapshot <vm> list` 有 clean；网络 `ping 8.8.8.8` 不通

### 文件系统快照工具（加密前状态留底）

- Linux: btrfs 快照 `snapper`——Debian/Ubuntu `apt install snapper` / Fedora `dnf install snapper` / Arch `pacman -S snapper`；验证: `snapper --version`。非 btrfs 用 `tar`/`rsync`（自带）备份观察目录
- Windows: 卷影复制 `vssadmin`（系统自带）——`vssadmin list shadows` 验证；快照也是解密恢复途径之一（步骤 5）
- macOS: Time Machine `tmutil`（自带）——`tmutil listbackups` 验证
- 哈希/枚举: `sha256sum` / `find`（coreutils 自带）

### 家族识别与解密工具调研（在线，无需安装）

- ID Ransomware（id-ransomware.malwarehunterteam.com）：上传勒索信/加密文件头识别家族
- No More Ransom（nomoreransom.org）：官方解密器集合（坑 4 时效性）
- [[re-ti]]：样本哈希查 VT / 社区报告，确认家族与已有分析结论

## 操作步骤

按顺序执行，每步记录证据（路径 + sha256，见 [[re-triage]]）。静态优先（[[platform-tips]] 静态优先原则）：先在宿主机做 1-2，需要运行时才进沙箱。

1. **初始判断（扩展名变化 / 加密头特征 / 勒索信）**：
   ```sh
   sha256sum sample.exe 被加密文件            # 存证（[[re-triage]]）
   file 被加密文件                            # 文件头是否被改写/替换
   xxd -l 64 被加密文件                       # 头部特征：固定前缀=感染 ID/密钥块，尾部特征同理
   find / -xdev -iname "*README*" -o -iname "*DECRYPT*" -o -iname "*RECOVER*" 2>/dev/null
   find . -type f -mmin -60 -size +1k | head  # 加密时间窗内被改动的文件
   ```
   - 判定信号：扩展名批量变化（.crypt/.locker/.encrypted）、原文件被删/被覆盖、目录出现勒索信、桌面壁纸被换
   - 先给受害者文件整体哈希/目录清单留底（与快照互为备份）

2. **加密算法识别（走 crypto 域）**：
   - 对样本静态分析: [[re-crypto-id]]——常量表指纹（AES S-box / RSA 公钥 DER / CRC 表）、XOR/ROL/ROR 变换、是否混合加密（RSA 包 AES key 最常见）
   - 对密文观察: 头部/尾部固定块（感染 ID、密钥块）、密文长度对齐（AES 块长 16）、熵（>7.0 已加密）
   - 判定三选一：对称（AES 整文件）→ 找对称密钥；非对称（RSA 直接加密）→ 几乎不可恢复；混合（RSA 加密 AES key）→ 密钥块随文件保存则看步骤 3
   - 结论（算法假设 + 证据）传给步骤 3/5

3. **密钥管理还原（本地 / 网络 / C2 分发）**：
   - 本地: [[re-crypto-keys]] 静态优先（strings/硬编码/资源/导入表）→ 没有再上内存（[[re-memdump]] 默认转储 gcore；转储时机 = 加密循环执行中，密钥已派生未销毁）
   - 网络/C2 下发: 沙箱内 [[re-sandbox]]（INetSim/fake DNS）+ [[re-netcap]] 抓包，[[re-protocol]] 重建——密钥可能只在运行时由 C2 下发，静态拿不到
   - 混合模型: 样本内含 RSA 公钥、AES key 被加密写进文件头 → 无私钥不可恢复（诚实告知，见 [[re-crypto-keys]] 坑）
   - 每枚候选密钥记录来源证据（偏移/函数名/转储路径），供 [[re-crypto-decrypt]] 使用

4. **勒索信与 C2 交互（走 [[re-protocol]]）**：
   - 读勒索信: 提取邮箱 / URL（Tor/暗网）/ BTC 地址 / 感染 ID → 记入 IOC（[[re-ioc]]）
   - C2 交互: [[re-protocol]] 编排——[[re-netcap]] 抓包 → [[re-crypto-id]] 判定密文 → [[re-crypto-keys]] 取密钥 → [[re-crypto-decrypt]] 解密流量 → [[re-proto-rev]] 重建交互（密钥上传/状态上报/感染 ID 注册）
   - 重点关注: 加密前是否先上传数据（双重勒索，坑 2）、密钥是否回传 C2

5. **恢复思路（密钥提取 → 解密脚本；无密钥 → 社区工具）**：
   - 有密钥: [[re-crypto-decrypt]] 写批量解密脚本（算法/模式/IV 按 [[re-crypto-id]] 结论重放）→ 先小样本验证出明文 → 全量执行
   - 部分加密/头部加密: 只加密头部几 KB 或部分块 → 截掉头部/重建文件头即可恢复多数文件（先检查密文长度是否 = 原长，是最便宜的路径）
   - 无密钥: ID Ransomware 识别家族 → No More Ransom / 厂商解密器（必须匹配变体，坑 4）→ 失效则诚实报告"当前不可恢复"
   - 快照/备份恢复优先: vssadmin / snapper / Time Machine 回滚（注意样本可能先删卷影，检查是否被删）
   - 产出: 恢复可行性结论 + 解密脚本 + 证据链（[[re-ioc]] 报告结构）

## 跨域联合

- [[re-crypto-id]] / [[re-crypto-keys]] / [[re-crypto-decrypt]]：步骤 2/3/5 分别引用，构成加密识别→密钥→解密主链
- [[re-sandbox]] / [[re-behavior]]：动态分析强制前置（[[platform-tips]] 最高原则）与加密/外传行为观察
- [[re-protocol]]：勒索信背后的 C2 交互（netcap / crypto-* / proto-rev），步骤 4
- [[re-ti]]：样本哈希/家族识别（VT、ID Ransomware）
- [[re-ioc]]：勒索信邮箱/URL/钱包地址、密钥与密文指纹出 IOC
- [[re-malware]]：本技能由 re-malware 网关引用（勒索样本分支）；行为分析/报告走网关全流程
- [[platform-tips]] 相关分支：默认沙箱（加密行为破坏性强）、静态优先、平台分支（Linux 用 snapper、Windows 用 vssadmin）

## 常见坑与陷阱

- **样本在沙箱内加密所有文件**：现象——样本一跑，沙箱里全盘文件被加密，包括样本自身与行为日志，取证产物被毁；原因——未做文件系统快照/蜜罐隔离就运行，或分析完没恢复快照；对策——[[re-sandbox]] 快照 + 蜜罐文件夹（放假文档/假密钥，观察加密目标选择）+ 只读传入样本，分析完立即恢复快照（坑清单见 [[re-sandbox]]）；原始样本与密文副本在宿主机独立备份
- **双重勒索（数据泄露 + 加密）**：现象——勒索信同时威胁"加密文件 + 公开泄露数据"，只盯加密会漏掉外传阶段；原因——双重勒索模式：先窃取数据（C2 上传）再加密，赎金诉求双份；对策——[[re-behavior]] / [[re-netcap]] 优先观察网络外传（泄露影响面大于加密），分两阶段记录行为与 IOC，报告分开陈述
- **RaaS 变体差异**：现象——同家族不同样本加密扩展名/算法/密钥方案都不一样，套用家族通用结论出错；原因——RaaS（勒索软件即服务）向攻击者出租可定制变体，每租户可配置；对策——以手头样本实测为准（[[re-crypto-id]] 重新确认），记录样本级特征（样本哈希/密钥块指纹）而非家族级结论
- **解密工具时效性**：现象——No More Ransom 解密器报"不是此变体"或解出乱码；原因——解密器只覆盖特定变体/旧版本，新变体算法或密钥方案已变；对策——先用 ID Ransomware + 样本哈希精确匹配变体再选工具；失效就走密钥提取路线（步骤 3/5）或诚实报告不可恢复；工具随 C2 密钥泄漏更新，可定期复查
