# 沙箱工具特有坑与边界

## 网络隔离坑组

- **NAT 不等于断网**：VM 默认 NAT 允许出站外联——断网必须显式 Host-only/Internal（或 `--net=none`），并验证 `ping 8.8.8.8` 不通（SKILL.md 坑 2）
- **fake DNS 只劫持解析**：样本用 IP 直连或硬编码 IP 时 fake DNS 无效——配合防火墙/INetSim 绑住目标端口，或观察连接落点
- **INetSim 只模拟常用服务**：样本连的端口不在 INetSim 服务表里会连接失败（TCP RST）——先看样本要连什么端口（静态 [[re-netcap]]/动态抓包），按需补模拟服务；DNS 指向错误时样本静默等待超时，先验证 `curl` 落点再放样本
- **systemd-resolved 与 `--dns` 冲突**：firejail man 页注明 `--dns` 在 systemd-resolved 环境不受支持——该环境改用 `--net=none` 或 VM 内独立 DNS

## 快照/回滚坑组

- **快照只建不恢复 = 环境污染**：样本持久化残留（进程/文件/注册表）污染下次分析——恢复命令提前写好、分析完立即执行、恢复后验证无残留（SKILL.md 坑 1）
- **快照建在样本运行后**：忘了先建基线，样本已经改过系统才想起——基线快照必须早于任何样本运行；中途才建的快照含污染状态，别当干净基线
- **VBoxManage 与 VirtualBox 版本行为**：`snapshot take/restore` 语法长期稳定，但新版本对 headless/guestcontrol 有改动——自动化脚本先 `VBoxManage --version` 确认版本；VMware 侧 `vmrun` 命令兼容性以官方文档为准

## 容器坑组

- **容器共享内核 ≠ 完全隔离**：Docker 与宿主机共享内核，内核漏洞利用/全局 sysctl 影响宿主——高威胁样本用 VM 快照，容器只用于低风险快速测试（SKILL.md 坑 3）
- **`--network none` 后 docker cp 仍可用**：断网只影响容器网络栈，`docker cp`/`docker exec` 走守护进程通道不受影响——隔离与文件交互不冲突
- **镜像带样本残留**：容器删了但 commit 出的镜像还留着样本痕迹——分析完 `docker rmi` 清理镜像；复用基线镜像前重新拉取干净层

## firejail 坑组

- **`--clean` 不存在**：0.9.80 实测报 `invalid --clean command line option`，官方 man 页（0.9.72 起）无此选项——清理用 `firejail --list` + `firejail --shutdown=<name|pid>`（SKILL.md 坑「清理选项被讹传」）
- **用户态隔离不是安全边界**：firejail 是 namespace/seccomp 组合——不防内核漏洞利用与提权（`--net=none` 下用户态逃逸面仍在），高威胁样本用 VM；`--net=none` 在部分平台可致应用崩溃（man 页注明），备选 `--protocol=unix`
- **`--private` 只隔离 home/root 路径**：`--private-etc` 之外的 /etc 全局可见（读）——敏感配置先 `--private-etc=hosts,resolv.conf` 等白名单
- **firejail 检测面**：样本可查沙箱特征（firejail 环境变量/挂载特征）——与 VM 逃逸检测同理，识别后按 [[re-evasion]] 应对

## 环境指纹坑组（隔离 ≠ 伪装）

- **隔离与伪装是两个问题**：隔离防样本外联/污染宿主；伪装防样本因环境指纹不触发——时间（RDTSC/GetTickCount）、硬件（核数/内存）、交互（鼠标/窗口）检测都要单独应对（SKILL.md 坑 6-8）
- **命名与资源阈值**：`sample.exe`/`malware` 目录名、CPU/内存/磁盘阈值、交互缺失都会触发 T1497.001 类检测——命名规范化、资源充足、交互按人类分布模拟
- **统计级交互校验**：新样本对鼠标轨迹做统计判别（采样频率/欧氏距离/前台窗口数）——固定像素移动会被识破，按真实行为分布模拟并拉长观测窗（SKILL.md 坑 8）

## 版本差异

- **firejail**：0.9.72（Debian bookworm）与 0.9.80（Arch 实测）选项集稳定，`--clean` 均不存在；`--net=none` 的崩溃警告自老版本就有——发行版打包版本差异大（0.9.6x-0.9.8x），脚本化前 `firejail --version` 确认
- **VirtualBox**：snapshot 命令语法跨 6.x/7.x 稳定；Guest Additions 版本需与主版本匹配（不匹配剪贴板/共享目录失效，且是 VM 逃逸检测特征之一）
- **docker**：`--network none`、`docker cp` 行为长期稳定；commit 出的镜像不可复现依赖（分层含中间状态）——基线用 Dockerfile 重建而不是 commit 产物
- **INetSim**：Debian 包 `inetsim`（bookworm 1.3.2）；`--version`/`--session` 选项稳定；日志路径随发行版打包略有差异（以 `/etc/inetsim/inetsim.conf` 为准）

## 使用注意

- 动态分析一律先过本技能（[[platform-tips]] 最高原则）；样本/产物 sha256 双端存证（[[re-triage]]）
- 分析结论与决策记录（隔离级别、网络方案、恢复验证）写 [[analysis-contract]]
- 版本相关行为（firejail 选项、VM 工具、INetSim 服务表）以目标版本实际表现为准
