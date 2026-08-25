# 沙箱环境搭建命令速查与操作序列

工具族按隔离级别组织：firejail（用户态轻量）、docker（容器）、VirtualBox/VMware（虚拟机+快照）、INetSim（网络模拟）。命令与参数以官方文档为准（firejail man、docker 文档、VBoxManage 手册、INetSim 手册）。

## 命令族速查

### firejail（用户态轻量隔离）

- `firejail <程序>` 默认沙箱运行；`firejail --private <程序>` 临时 home/root（退出即弃）
- `firejail --net=none <程序>` 断网（仅回环）；`firejail --dns=127.0.0.1 <程序>` DNS 指向本机
- `firejail --private-etc=hosts,resolv.conf <程序>` 只带指定 /etc 文件进沙箱
- `firejail --list` 列出活动沙箱（`PID:USER:Name:Command`）；`firejail --tree` 树形
- `firejail --shutdown=<name|pid>` 关停指定沙箱——注意没有 `--clean` 选项（0.9.80 实测报 invalid option）
- `firejail --version` 验证；`--help` 全参数清单

### docker（容器隔离）

- `docker pull ubuntu:22.04` / `docker run --rm -it ubuntu:22.04 bash` 一次性容器
- `docker run --rm -d --network none --name sand <镜像>` 断网后台容器（`--network none` 无网卡）
- `docker cp <样本> sand:/tmp/` 传入；`docker cp sand:/out/ ./out/` 取出产物
- `docker commit <container> sandbox-image:v1` 把运行中容器提交为镜像（快照替代）
- `docker rm -f <container>` 销毁容器；`docker images` / `docker ps -a` 查看
- 验证: `docker --version`；`docker run --rm hello-world` 跑通

### VirtualBox（VM + 快照）

- `VBoxManage list vms` 列虚拟机；`VBoxManage startvm <vm> --type headless` 无头启动
- `VBoxManage snapshot <vm> take clean` 建快照；`VBoxManage snapshot <vm> restore clean` 恢复
- `VBoxManage snapshot <vm> list` 快照清单；`VBoxManage modifyvm <vm> --nic1 hostonly` 改 Host-only 网卡
- `VBoxManage guestcontrol <vm> run --exe /bin/ls --username <u> --password <p>` 客户机执行（需 Guest Additions）
- `VBoxManage sharedfolder add <vm> --name in --hostpath <路径> --readonly` 只读共享（传入通道）
- 验证: `VBoxManage --version`

### VMware Workstation（vmrun）

- `vmrun start <vmx> nogui`；`vmrun snapshot <vx 路径> clean` 快照
- `vmrun revertToSnapshot <vx> clean` 恢复；`vmrun list` 运行中 VM
- 验证: `vmrun list`

### INetSim（网络模拟）

- `inetsim` 默认配置启动（HTTP/SMTP/DNS/FTP 等全模拟）；`inetsim --session <名>` 命名会话
- `inetsim --version` 验证；日志在 `/var/log/inetsim/`（报告 `/var/log/inetsim/report/`）
- 配置: `/etc/inetsim/inetsim.conf`（bind 地址、启停服务）

### 网络隔离验证

- `ping 8.8.8.8`（断网应不通）；`curl http://example.com`（应命中 INetSim 模拟响应）
- `dig @127.0.0.1 example.com`（fake DNS 应答）；`ss -tlnp` 看沙箱内监听

## 常用操作序列（组合套路）

### 1. VM 快照分析闭环（建快照 → 隔离 → 传样本 → 跑 → 恢复）

```
VBoxManage snapshot <vm> take clean                 # 干净基线
VBoxManage startvm <vm> --type headless
# 网络隔离（Host-only + INetSim）→ 只读共享传入样本（sha256 先存证）
# 沙箱内运行样本、观察行为、导出产物到专用输出目录
VBoxManage snapshot <vm> restore clean              # 分析完恢复
VBoxManage snapshot <vm> list                       # 确认回到 clean
```

### 2. firejail 快速隔离跑样本（轻量场景）

```
firejail --private --net=none --dns=127.0.0.1 ./sample
# 断网 + 临时 home；退出后临时目录自动清理
firejail --list                                     # 确认沙箱状态
firejail --shutdown=<name|pid>                      # 需要时按名关停
```

### 3. Docker 容器分析闭环（低风险样本快速测试）

```
docker run --rm -d --network none --name sand ubuntu:22.04 sleep 3600
docker cp ./sample sand:/tmp/
docker exec sand /tmp/sample                        # 容器内运行（无网）
docker cp sand:/tmp/out ./out/                      # 取出产物
docker rm -f sand
```

### 4. INetSim fake 网络环境（C2 观察标准做法）

```
inetsim --session c2obs                              # 沙箱宿主起模拟服务
# 沙箱 VM DNS 指向宿主 INetSim（Host-only 网段 IP）
# 样本外连被模拟服务接管并记录全部请求 → 配合 [[re-netcap]] 抓包
curl http://example.com                              # 验证命中模拟响应
# 日志与报告在 /var/log/inetsim/ 取回存档
```

## 实现教训（内化）

- 完整性从高到低：VM 快照 > 容器 > firejail——按样本威胁等级选层，决策与理由写入记录（SKILL.md 步骤 1）
- 网络隔离三档先定好再跑：断网 / fake DNS / INetSim——验证命令（ping/curl 落点）先跑通再放样本
- 传入传出走专用通道：只读共享进、专用输出目录出，样本与产物分离存证（sha256 双端）
- 恢复快照是分析的一部分：步骤 1 就写下恢复命令，分析完立即执行并验证无残留（SKILL.md 坑 1）
- INetSim 环境里 DNS 解析与 HTTP 服务都指向同一宿主，样本请求全落本地——抓包与日志对照还原 C2 行为

## 使用注意

- 本技能是 [[platform-tips]] 最高原则（默认沙箱）的执行者——动态分析一律先过这里
- 高威胁样本用 VM 快照而非容器/firejail（内核共享面与隔离深度差异，SKILL.md 坑 3）
- 时间/硬件/输入类环境指纹是另一层问题：隔离 ≠ 伪装，检测点应对见 [[re-evasion]]（SKILL.md 坑 6-8）
