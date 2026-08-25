# QEMU 仿真工具特有坑与边界

## 架构与启动

- **架构/字节序选错秒崩**：大端 MIPS（qemu-mips）与小端（qemu-mipsel）互跑直接 Invalid ELF/segfault——先 `file`/`readelf -h` 确认；ARM 32/64（qemu-arm vs qemu-aarch64）同理
- **-L sysroot 不匹配**：缺 `-L` 或指向错误目录 → 报 ld-linux 找不到/加载器版本不符——sysroot 必须含目标架构的 `/lib`、`/usr/lib` 与动态链接器
- **内核与 rootfs 不匹配**：全系统内核必须支持 rootfs 的文件系统与架构（如 ext2 内核没编入 → 挂载失败 Kernel panic）——换内核或换文件系统格式
- **console 参数与平台不匹配**：`console=ttyAMA0`（vexpress）vs `console=ttyS0`（malta）——串口无输出先核对，别先怀疑内核坏了
- **-M 平台与设备模型耦合**：同一内核在不同 -M 平台（vexpress/virt）下设备树不同——换平台要同步换 -append/root 设备名

## 外设与内存

- **用户态不模拟外设**：mmap 固定地址（GPIO/UART 寄存器）后访问直接段错误——`-strace` 定位访问点，LD_PRELOAD stub 返回模拟值（见 [[commands]] 序列 4）
- **网卡初始化挂起**：全系统没配网卡时 ioctl 无返回、程序卡死——加 `-device e1000`/virtio 或先 `-net none` 确认是否跳过
- **内存给太小**：固件按真实内存初始化（malloc 上限/分区表），`-m 32` 可能启动失败——常见 64-256MB 起步试
- **时间/时钟怪异**：QEMU 虚拟时钟与墙钟不同步（读时间 1970/倒退）——`-rtc base=utc` 固定，或 stub 掉 clock_gettime 相关调用

## qemu-user 边界

- **只仿真用户态指令**：特权指令/内核路径（驱动 ioctl 真实设备）不工作——需要完整内核行为的程序必须全系统仿真
- **进程模型差异**：qemu-user 对 fork/线程有支持但受限（老版本多线程程序偶发崩溃）——多线程目标优先全系统
- **共享内存/IPC 受限**：POSIX shm、跨进程通信在用户态仿真下不可靠——依赖共享内存的多进程固件走全系统
- **-strace 输出量大**：全量系统调用日志可 GB 级——`-strace` 后管道 grep 目标调用（open/connect/mmap）

## 网络与隔离

- **默认无网络**：qemu-user 无网络；qemu-system 默认 `-net none`——需要出站时显式加 `-netdev user`（用户态 NAT，仅模拟出站，不暴露宿主）
- **NAT 不等于隔离**：`-netdev user` 的 guest 出站直达宿主网络栈——回连分析前仍按 [[platform-tips]] 隔离（断外网/fake DNS），firmadyne 默认网卡同样先隔离
- **guest 内需要 IP 固定**：user 模式 NAT 的 DHCP/地址分配与固件假设不符时程序初始化失败——`-netdev user,net=192.168.x.0/24` 定制网段

## 版本差异

- **QEMU 8/9/10/11 世代**：网络配置推荐 `-nic`/`-netdev` 简写（`-net` 旧语法仍兼容但标记弃用）；`-device` 支持的外设模型持续扩充；新版对 ARM/MIPS 平台支持更完整（老版可能缺某些 -M 平台）
- **qemu-user 与 qemu-system 分包**：发行版拆分为 qemu-user（各架构用户态）+ qemu-system-<arch>——只装其一会出现"命令不存在"；Debian 系 `apt install qemu-user qemu-system-arm qemu-system-mips` 按需装
- **qemu-user-static**：Debian 系含静态链接的 qemu-<arch>-static（binfmt 直接执行用）；普通 qemu-user 是动态链接版，无法给宿主上 binfmt 用
- **内核侧**：同 -M 平台下不同版本内核的设备树/驱动行为有差异——固件配套内核缺失时试同架构近版本内核

## 使用注意

- 仿真 = 动态执行，默认沙箱 + 网络隔离（[[platform-tips]] 最高原则）
- 跑不动且静态可分析就回退静态（[[re-fw-rootfs]] / [[re-binary-core]]），不在仿真上死磕
- 仿真结果与真实硬件行为有差距（时序/外设/内核驱动）——涉及硬件交互的结论用 [[re-hardware-io]] 验证
