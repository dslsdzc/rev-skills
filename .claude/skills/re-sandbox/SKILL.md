---
name: re-sandbox
description: >
  沙箱环境搭建（动态分析强制前置）。
  触发词：沙箱、隔离环境、firejail、VM快照、安全运行
---

# 沙箱环境搭建

## 何时使用 / 何时不用

- 用：任何涉及运行样本的动态分析（行为分析、回连观察、脱壳验证、动态 API 监控）——动态分析强制前置，默认沙箱为最高原则（见 [[platform-tips]]）
- 用：需要干净、可回滚的隔离环境执行不可信程序
- 不用：纯静态分析（[[re-triage]] / [[re-format-pe]] / [[re-ghidra]] 等）可免沙箱
- 不用：样本已有可信运行环境且用户明确要求本机运行（仍应先说明风险）

## 工具准备

所有工具先验证再使用。本技能是 [[platform-tips]] 最高原则（默认沙箱，动态执行强制前置）的执行者——所有工具只为让"运行样本"更安全可控。

### firejail —— 轻量应用沙箱（最低隔离级别，仅 Linux）

- Linux: `apt install firejail` / `dnf install firejail` / `pacman -S firejail`
- macOS/Windows: 不支持（用 Docker 或 VM 替代）
- WSL: Linux 包直接可用
- 验证: `firejail --version`；`firejail --list` 能看到活动沙箱

### docker —— 容器隔离（中级）

- Linux: `apt install docker.io` / `dnf install docker` / `pacman -S docker`（或 Docker 官方脚本）
- macOS: `brew install --cask docker`（Docker Desktop，需手动启动）或 `brew install docker` + `brew install colima` + `colima start`
- Windows: `choco install docker-desktop`（Docker Desktop）；WSL2 内用 Linux 版
- 验证: `docker --version`；`docker run --rm hello-world` 能跑通
- 注意：容器共享内核，不是完全隔离（见坑 3）

### VirtualBox / VMware —— 虚拟机 + 快照（最高隔离级别）

- VirtualBox:
  - Linux: `apt install virtualbox` / `dnf install VirtualBox`（RPMFusion 源）/ `pacman -S virtualbox`
  - macOS: `brew install --cask virtualbox`
  - Windows: `choco install virtualbox`
  - 验证: `VBoxManage --version`
- VMware Workstation/Fusion: 商业授权；Windows `choco install vmware-workstation`；验证: `vmrun list` 或 `vmware --version`
- 快照命令（VBoxManage 示例）:
  ```sh
  VBoxManage snapshot <vm> take clean      # 建立快照
  VBoxManage snapshot <vm> restore clean   # 恢复快照
  ```

### INetSim —— 模拟网络服务（网络隔离主力）

- Linux: Debian/Ubuntu `apt install inetsim`（或官方 .deb；其他发行版用源码构建，Perl 依赖较多，推荐专用 Debian VM）
- macOS/Windows: 不建议本机装——在 Linux VM 内运行
- 验证: `inetsim --version`；启动后 `inetsim` 日志显示 HTTP/SMTP/DNS/FTP 等服务监听

### Cuckoo / CAPE —— 自动化恶意样本分析沙箱

- Cuckoo（旧，仍可用）: `pip install cuckoo`；验证: `cuckoo --version`
- CAPE（活跃继任）:
  ```sh
  git clone https://github.com/kevoreilly/CAPEv2
  cd CAPEv2 && pip install -r requirements.txt
  ```
  验证: `python cuckoo.py --help` 或 `cape` 子命令能列出
- 依赖虚拟机与网络隔离配置，首次搭建成本高——单次人工分析优先用 VM 快照方案

## 操作步骤

按顺序执行，每步记下结果。

1. **选隔离级别**（完整性要求从高到低：VM 快照 > 容器 > firejail）：
   - VM 快照（VirtualBox/VMware）: 需要完整还原 + 防样本外联/逃逸；分析未知高威胁样本的默认选择
   - 容器（Docker）: 快速测试 Linux 二进制、低风险样本
   - firejail: 只需限制文件系统与网络、临时跑一下
   - 决策记录：写下所选级别与理由，并把"分析完恢复快照"命令（步骤 5）提前写好

2. **网络隔离**（三档，从强到弱）：
   - 断网: VM 网络模式设 Host-only / NAT 且不启用端口转发；firejail 用 `--net=none`
   - fake DNS: /etc/hosts 或 dnsmasq 把可疑域名指向本机；或 `firejail --dns=127.0.0.1`
   - INetSim: 把沙箱 DNS 指向 INetSim 主机，模拟 HTTP/SMTP/FTP/DNS 服务并记录样本的全部请求——C2 分析的标准做法（配合 [[re-protocol]] 的 [[re-netcap]]）
   - 验证: 沙箱内 `ping 8.8.8.8` 不通；`curl http://example.com` 命中 INetSim 模拟响应

3. **快照建立**：
   ```sh
   # VirtualBox
   VBoxManage snapshot <vm> take clean
   # VMware
   vmrun snapshot <vm> clean
   # Docker: 提交运行中容器为镜像
   docker commit <container> sandbox-image:v1
   # firejail 无快照概念——靠 --private/--private-etc 临时目录，退出即清理
   ```
   快照内容至少包含：干净 OS + 分析工具（procmon / sysdig / bpftrace）+ 网络隔离配置。

4. **样本传入/传出（隔离通道）**：
   - 传入: 只读共享目录；VM 中禁用剪贴板/拖放共享（防样本反读宿主机）；或先过杀软扫描再传入
   - 传出: 产物（日志/内存转储/配置）经专用输出目录取出，与样本分开存证
   - 传入前对原始样本 `sha256sum` 存证（见 [[re-triage]]），宿主机与沙箱内各存一份原始哈希
   - 禁用 Guest Additions 剪贴板/拖放共享、只开 Host-only 网络——防 VM 逃逸检测的对策见坑 4

5. **分析完恢复快照**：
   ```sh
   VBoxManage snapshot <vm> restore clean
   # Docker
   docker rm -f <container>
   # firejail
   firejail --clean   # 或直接退出 firejail 进程，临时目录自动清理
   ```
   恢复后验证: `VBoxManage snapshot <vm> list` 确认回到 clean；沙箱内 `ps aux` 无残留进程。不恢复快照 = 环境污染（见坑 1）。

## 跨域联合

- [[re-malware]]：本网关工作流第 1 步强制前置——默认沙箱最高原则（[[platform-tips]]），恶意样本动态分析全部从这里开始
- [[re-anti-analysis]]：脱壳产物的动态验证必须在沙箱内复跑（判定壳是否脱干净）
- [[re-protocol]]：C2 流量捕获依赖本技能的 INetSim / fake DNS 网络隔离环境
- [[re-binary-core]]：其动态环节（[[re-tracing]] / [[re-gdb]] / [[re-x64dbg]] / [[re-memdump]]）引用本技能作为运行前置

## 常见坑与陷阱

- **忘恢复快照 = 环境污染**：现象——下一次分析的沙箱里有上一次样本的残留（进程/文件/注册表），两次分析结果互相污染；原因——快照只建不恢复，样本持久化行为留在沙箱里；对策——步骤 1 就写下恢复命令，分析完立即执行，恢复后验证无残留进程
- **网络未隔离样本外联**：现象——样本真实访问了外网 C2 或继续扩散；原因——跳过网络隔离直接联网跑；对策——任何运行前先按步骤 2 三档之一隔离，并验证 ping/curl 的落点
- **容器共享内核 ≠ 完全隔离**：现象——样本利用内核漏洞或修改 sysctl 等全局配置影响宿主机；原因——Docker 与宿主机共享内核，仅 namespace/cgroup 隔离；对策——高威胁样本用 VM 快照而非容器，容器只用于低风险快速测试
- **样本逃逸检测 VM 环境**：现象——样本检测到 VM 特征（Guest Additions、vmware 进程、虚拟网卡名）后休眠/退出，行为分析拿不到结果；原因——反分析技术（见 [[re-anti-analysis]] 域）；对策——禁用 Guest Additions、改虚拟硬件指纹、与 [[re-behavior]] 的延迟/交互检查对策配合延长观察
