---
name: re-fw-emulate
description: >
  固件仿真：QEMU 用户态/全系统。
  触发词：仿真、QEMU、firmadyne、跑固件
---

# 固件仿真（QEMU）

## 何时使用 / 何时不用

- 用：需要运行固件内程序观察行为/验证假设（固件 web 界面、服务端逻辑）
- 用：rootfs 已解出、需要整体启动（全系统仿真）
- 不用：只需静态分析（[[re-fw-rootfs]] 已覆盖）
- 不用：有实物板子且必须真实硬件交互（走 [[re-hardware-io]]，硬件提取/接口调试）
- 不用：目标只是解包看内容（走 [[re-fw-extract]]）

## 工具准备

所有工具先验证再使用。仿真 = 动态执行，默认沙箱 + 网络隔离（[[platform-tips]] 最高原则）；用户态仿真优先（最轻可行方案）。

### qemu-user —— 用户态仿真（最轻）

- Linux: `apt install qemu-user` / `dnf install qemu-user` / `pacman -S qemu-user`
- macOS: `brew install qemu`（含用户态与系统态）
- Windows/WSL: WSL 内 Linux 版
- 验证: `qemu-arm --version`、`qemu-mips --version`（大端）、`qemu-mipsel --version`（小端）

### qemu-system —— 全系统仿真

- Linux: `apt install qemu-system-arm qemu-system-mips` / `dnf install qemu-system-arm qemu-system-mips` / `pacman -S qemu-system-arm qemu-system-mips`
- macOS: `brew install qemu`
- Windows/WSL: WSL 内 Linux 版
- 验证: `qemu-system-arm --version`

### binfmt_misc —— 直接执行交叉程序

- Linux: `apt install binfmt-support`（Debian/Ubuntu；Fedora 用 systemd binfmt 配置）；注册: `update-binfmts --enable qemu-arm`（或 /etc/binfmt.d/ 配置文件）
- macOS/Windows: 不支持，用 `qemu-<arch>` 显式调用
- 验证: `ls /proc/sys/fs/binfmt_misc/` 可见 qemu-arm 条目；之后可直接执行 `./rootfs_out/usr/sbin/httpd`

### gdb-multiarch + gdbserver —— 交叉调试

- Linux: `apt install gdb-multiarch` / `dnf install gdb-multiarch` / `pacman -S gdb-multiarch`；gdbserver: `apt install gdbserver`（或随 gdb 包提供）
- macOS: `brew install gdb`（需 Developer Tools 授权，见 [[platform-tips]] macOS 分支）或 WSL 内 Linux 版
- Windows/WSL: WSL 内 Linux 版
- 验证: `gdb-multiarch --version`

### firmadyne —— 全系统自动仿真框架（思路参考，可选装）

- 安装: `git clone https://github.com/firmadyne/firmadyne`，依赖 qemu-system-* 与预编译内核（scripts/ 下下载），首次搭建较重
- 验证: `ls sources/` 有 getArch.py 等脚本；`which qemu-system-mips`
- 多数单程序分析不需要它——用户态优先（[[platform-tips]] 先给最轻可行方案）

## 操作步骤

按顺序执行，每步记下结果。

1. **用户态仿真（最轻，优先）**：
   ```sh
   file rootfs_out/usr/sbin/httpd                    # 确认架构：ARM 32/64、MIPS(BE/EL)、RISC-V
   qemu-arm -L rootfs_out rootfs_out/usr/sbin/httpd  # -L 把 rootfs 当 sysroot（动态库/链接器从 rootfs 加载）
   # 大端 MIPS: qemu-mips -L rootfs_out ...
   # 小端 MIPS: qemu-mipsel -L rootfs_out ...
   ```
   缺库报错 → 交叉 `ldd` / `readelf -d` 看依赖，从 rootfs 补库；Web 服务类程序可加 `-E` 传环境变量。跑不起来但静态可分析 → 回 [[re-fw-rootfs]] / [[re-binary-core]]，不在仿真上死磕。

2. **全系统仿真**：
   ```sh
   # ARM（vexpress 平台）+ 内核与 initramfs：
   qemu-system-arm -M vexpress-a9 -kernel vmlinuz -initrd initramfs.img -nographic \
     -append "console=ttyAMA0 root=/dev/ram rdinit=/sbin/init"
   # MIPS（malta 平台，大端示例）：
   qemu-system-mips -M malta -kernel vmlinuz -initrd initramfs.img -nographic \
     -append "console=ttyS0 rdinit=/sbin/init"
   ```
   把 rootfs 制作成磁盘镜像（ext2 挂 root）或 initramfs（cpio 打包 rootfs_out）；firmadyne 的脚本就是自动化这套流程。

3. **外设缺失用 stub/回环**：
   - 用户态：程序 mmap 固定地址（GPIO/UART 寄存器）崩溃 → `strace` 定位访问点，`LD_PRELOAD` 提供 stub 库返回假寄存器值
   - 全系统：`-device` 挂虚拟外设（e1000 / virtio 等）；真实芯片外设（wifi/基带）QEMU 无法模拟 → 打补丁跳过初始化或 stub 该 ioctl
   - 先确定程序初始化到哪一步崩（串口输出/日志），再决定 stub 哪部分

4. **交叉调试（qemu -g + gdb-multiarch）**：
   ```sh
   qemu-arm -g 1234 -L rootfs_out rootfs_out/usr/sbin/httpd &   # -g 起 gdbstub
   gdb-multiarch rootfs_out/usr/sbin/httpd
   (gdb) target remote :1234
   ```
   全系统内：把 gdbserver 放进 rootfs，`gdbserver :1234 /usr/sbin/httpd`，宿主 `target remote <qemu_ip>:1234`；调试手法按 [[re-gdb]]。

5. **网络隔离下仿真**：
   - 用户态：默认无网络；需要时用全系统方案
   - 全系统：先 `-net none`，确认行为后再加 `-netdev user,id=n0`（用户态 NAT，仅模拟出站，隔离宿主机）
   - 分析回连/协议前先隔离（[[platform-tips]] 最高原则），流量抓包与协议重建转 [[re-protocol]]；firmadyne 默认带网卡也需按此原则先行隔离

## 跨域联合

- [[re-firmware]]：工作流第 4 步固定调用本技能
- 架构识别与指令级深挖：ARM（向量表/Thumb/MMIO 外设交叉）→ [[re-arm]]；RISC-V（RV32/RV64/ecall）→ [[re-riscv]]（选对 qemu-<arch> 前先对照）
- 仿真内动态行为观察 → [[re-tracing]] + [[re-gdb]]（默认沙箱内，[[platform-tips]] 最高原则）
- 固件运行产生通信 → [[re-protocol]]；仿真内 ELF 深挖 → [[re-binary-core]]
- 仿真不成的程序回退静态 → [[re-fw-rootfs]]

## 常见坑与陷阱

- **外设寄存器访问崩溃**：现象——程序 mmap 固定地址后读 GPIO/UART 寄存器段错误；原因——QEMU 用户态不模拟外设，地址无映射；对策——strace 定位访问点，LD_PRELOAD stub 返回模拟值（步骤 3）
- **架构选错直接 segfault**：现象——qemu-arm 跑 MIPS 程序秒崩；原因——没先 `file`/`readelf` 确认架构与字节序（大端 mips ≠ mipsel）；对策——步骤 1 先确认，选对 qemu-<arch>
- **无网络设备 → 初始化卡死**：现象——程序在网卡初始化处挂起不退出；原因——全系统仿真没配网卡，ioctl 无返回；对策——启动加 `-device e1000` 等虚拟网卡，或先 `-net none` 观察是否跳过（步骤 5）
- **时间戳/时钟函数陷阱**：现象——程序读时间怪异（1970/倒退），行为与真实设备不同；原因——QEMU 虚拟时钟与墙钟不同步；对策——`-rtc base=utc` 固定，或 stub 掉 clock_gettime 相关调用
- **网络未隔离就仿真**：现象——固件真实回连外网（C2/升级服务器）；原因——跳过网络隔离；对策——全系统仿真默认 `-net none` / 用户态 NAT（步骤 5），回连分析前按 [[platform-tips]] 隔离
