# QEMU 仿真命令速查与操作序列（用户态 / 全系统）

分工：qemu-user（用户态，跑单程序最轻）→ qemu-system（全系统，启动完整固件）→ binfmt_misc（直接执行交叉程序）→ gdb-multiarch（交叉调试）。参数以本机 `qemu-<arch> --help` / `qemu-system-<arch> --help` 为准（版本差异见 [[gotchas]]）。

## 命令族速查

### qemu-user —— 用户态仿真

| 用途 | 命令 |
|---|---|
| 架构对应 | `qemu-arm`（32 位）/ `qemu-aarch64` / `qemu-mips`（大端）/ `qemu-mipsel`（小端）/ `qemu-riscv64` 等 |
| 基本运行 | `qemu-arm -L <rootfs> <rootfs>/usr/sbin/httpd` |
| sysroot | `-L <path>`（动态库/链接器从 rootfs 加载；缺 `-L` 报 ld-linux 找不到） |
| 环境变量 | `-E VAR=value`（可多个；Web 服务常传 `-E LD_LIBRARY_PATH=...`） |
| 伪造 argv[0] | `-0 <argv0>`（程序按调用名分支时用） |
| 系统调用日志 | `-strace`（等效仿真内 strace，排查 mmap/ioctl 崩溃点） |
| gdbstub | `-g <port>`（等 gdb 连接，配合 gdb-multiarch） |
| 指定 CPU | `-cpu <型号>`（`-cpu help` 列全部，如 cortex-a9） |
| 限定地址空间 | `-B <size>`（guest 地址空间大小，老内核小空间时用） |
| 启动即暂停 | `-g` 之外可用 `-d in_asm` 反汇编日志（调试/取证） |

### qemu-system —— 全系统仿真

| 用途 | 命令 |
|---|---|
| 平台选择 | `-M vexpress-a9`（ARM）/ `-M malta`（MIPS）/ `-M virt`（通用）——`-M help` 列全部 |
| 内核与 initramfs | `-kernel vmlinuz -initrd initramfs.img` |
| 挂磁盘镜像 | `-drive file=rootfs.ext2,format=raw` |
| 串口到终端 | `-nographic`（`-serial mon:stdio` 变体） |
| 内核参数 | `-append "console=ttyAMA0 root=/dev/ram rdinit=/sbin/init"` |
| 网络（默认无） | `-netdev user,id=n0 -device e1000,netdev=n0`（用户态 NAT，仅出站） |
| 网络简写 | `-nic user,model=e1000`（新版推荐；`-net` 旧语法已标记弃用） |
| 完全断网 | 不加任何网络参数即可（默认 `-net none`） |
| 虚拟外设 | `-device virtio-net-pci,netdev=n0` / `-device e1000` 等（`-device help` 列全部） |
| 固定时钟 | `-rtc base=utc`（避免时间怪异，见 [[gotchas]]） |
| 内存 | `-m 256`（按固件需求，常见 64-256MB） |
| gdbstub | `-s`（1234 端口）/ `-S`（启动即暂停等 gdb） |

### binfmt_misc —— 直接执行交叉程序

```sh
# Debian/Ubuntu：apt install binfmt-support qemu-user-static 后自动注册
# 手动注册：update-binfmts --enable qemu-arm（或 /etc/binfmt.d/ 配置文件）
ls /proc/sys/fs/binfmt_misc/        # 可见 qemu-arm 等条目
./rootfs_out/usr/sbin/httpd          # 之后可直接执行（等效 qemu-arm -L rootfs_out ...）
# 注意：binfmt 直接执行不带 -L sysroot，动态链接程序仍需设置 QEMU_LD_PREFIX 或先解出依赖
```

### gdb-multiarch + gdbserver —— 交叉调试

```sh
qemu-arm -g 1234 -L rootfs_out rootfs_out/usr/sbin/httpd &   # 用户态 gdbstub
gdb-multiarch rootfs_out/usr/sbin/httpd
(gdb) target remote :1234
# 全系统内：rootfs 里放 gdbserver，gdbserver :1234 /usr/sbin/httpd
# 宿主 (gdb) target remote <qemu_guest_ip>:1234
```

## 常用操作序列

### 1. 用户态跑单个固件程序（最轻，优先）

```
file 确认架构与字节序 → qemu-<arch> -L <rootfs> <程序>
→ 缺库：readelf -d 看依赖，从 rootfs 补（或 -E LD_LIBRARY_PATH）
→ 崩溃：加 -strace 看系统调用，定位到 mmap/ioctl 访问点再决定 stub（序列 4）
```

### 2. 全系统启动（initramfs 与磁盘镜像两式）

```
式一（initramfs）：cpio 打包 rootfs_out → -kernel vmlinuz -initrd initramfs.img -append "rdinit=/sbin/init"
式二（磁盘镜像）：dd/ext2 制作 rootfs.ext2 → -kernel vmlinuz -drive file=rootfs.ext2,format=raw -append "root=/dev/<设备>"
→ 串口看不到输出先核对 console= 参数与 -M 平台（ttyAMA0=ttyS0 因平台而异）
```

### 3. 仿真内交叉调试（用户态 / 全系统）

```
用户态：qemu-arm -g 1234 → gdb-multiarch target remote :1234
全系统：gdbserver 放进 rootfs → 在固件里启动 gdbserver → 宿主 target remote <guest_ip>:1234
→ 调试手法（断点/内存/单步）按 [[re-gdb]]
```

### 4. 外设缺失 stub（GPIO/UART 寄存器崩溃）

```
qemu-<arch> -strace 定位首个崩溃访问（如 mmap 固定地址后读 [addr]）
→ LD_PRELOAD 提供 stub 库：该地址返回模拟值（用户态）
→ 全系统：-device 挂虚拟外设（e1000/virtio）；真实芯片外设打补丁跳过初始化
→ 先确认程序初始化到哪一步崩（串口输出/日志），再决定 stub 范围
```

### 5. 网络隔离下仿真

```
全系统先不加网络参数（默认 -net none）确认行为 → 需要网络再加 -nic user,model=e1000
→ 回连/协议分析前按 [[platform-tips]] 隔离；抓包与协议重建转 [[re-protocol]]
→ firmadyne 默认带网卡，同样先隔离再跑
```

## 实现教训（内化）

- 用户态先行：单程序 80% 场景 qemu-user 足够，别一上来搭全系统
- `-L` 不匹配的典型症状是 ld-linux 报错——先把 sysroot 指对再谈其他
- `-strace` 是仿真内排障第一工具：崩溃/挂起先看系统调用流
- 全系统串口无输出先查 `console=` 与 `-M` 平台匹配（console 设备名因平台/内核而异）
- 仿真是验证手段不是目的：跑不动且静态可分析就回退静态（[[re-fw-rootfs]] / [[re-binary-core]]）

## 使用注意

- 仿真 = 动态执行，默认沙箱 + 网络隔离（[[platform-tips]] 最高原则）
- 架构识别先做（[[re-arm]] / [[re-riscv]] / [[re-mips]] 对照），选错 qemu-<arch> 秒崩
- 产物与日志 sha256 入档（[[re-triage]] 惯例）；仿真结论写 [[analysis-contract]]
