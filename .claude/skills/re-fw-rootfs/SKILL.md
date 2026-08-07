---
name: re-fw-rootfs
description: >
  固件文件系统分析：rootfs、配置、密钥、启动脚本。
  触发词：rootfs、文件系统分析、squashfs、cramfs、配置文件
---

# 固件文件系统分析（rootfs）

## 何时使用 / 何时不用

- 用：已有解包产物 / 文件系统镜像，需要找启动入口、配置、密钥、硬编码口令
- 用：需要定位固件内程序与架构（交叉二进制）
- 不用：还没有任何解包产物（先 [[re-fw-extract]]）
- 不用：需要运行固件程序观察行为（走 [[re-fw-emulate]]）
- 不用：需实物板子（走 [[re-hardware-io]]）

## 工具准备

所有工具先验证再使用。本技能纯静态分析可免沙箱（[[platform-tips]] 最高原则）；解出的程序要运行时转 [[re-fw-emulate]]。

### 解包工具（unblob / binwalk 产物优先）

- 已装则直接用 [[re-fw-extract]] 的解包产物；没装按该技能「工具准备」安装
- 验证: `unblob --version` / `binwalk --version`

### 7-Zip（7z）—— 通用容器兜底

- Linux: `apt install p7zip-full` / `dnf install p7zip-plugins` / `pacman -S p7zip`
- macOS: `brew install p7zip`
- Windows: `choco install 7zip`（或 7-zip.org 官方安装包）
- 验证: `7z i | head -5`（显示版本）

### squashfs-tools（unsquashfs）

- Linux: `apt install squashfs-tools` / `dnf install squashfs-tools` / `pacman -S squashfs-tools`
- macOS: `brew install squashfs`
- Windows/WSL: WSL 内 Linux 版
- 验证: `unsquashfs -version`

### cramfs 解包（cramfsck）

- Linux: `apt install cramfsprogs`（Debian/Ubuntu）；其他发行版无官方包 → 用 unblob 解 cramfs 兜底
- macOS/Windows: unblob 兜底
- 验证: `cramfsck -V`

### grep / ripgrep —— 配置与密钥搜索

- Linux: `apt install ripgrep` / `dnf install ripgrep` / `pacman -S ripgrep`（grep 随发行版自带）
- macOS: `brew install ripgrep`
- Windows: `choco install ripgrep`（或 WSL）
- 验证: `rg --version` / `grep --version`

### 交叉 binutils（readelf / objdump 跨架构）

- Linux: `apt install binutils-arm-linux-gnueabi binutils-arm-linux-gnueabihf binutils-mipsel-linux-gnu binutils-mips-linux-gnu`（Debian/Ubuntu；Fedora: `dnf install binutils-arm-linux-gnu binutils-mips-linux-gnu`）
- macOS: `brew install binutils`（`greadelf`）或 `brew install llvm`（`llvm-readelf`）
- WSL: Linux 版直接可用
- 验证: `arm-linux-gnueabi-readelf --version`；本机 readelf 也能读交叉 ELF 头（`readelf -h`），属性级信息用交叉版 `readelf -A`

## 操作步骤

按顺序执行，每步记下结果。

1. **挂载/解包文件系统**：
   ```sh
   # squashfs（最常见）
   unsquashfs rootfs.squashfs -d rootfs_out
   # cpio initramfs
   mkdir rootfs_out && cd rootfs_out && cpio -idmv < ../initramfs.cpio
   # 通用兜底
   7z x rootfs.img
   # cramfs（Debian 系）
   cramfsck -x rootfs_out rootfs.cramfs
   # ext 类镜像（需 root，只读挂载）
   mkdir mnt && mount -o loop,ro rootfs.img mnt
   ```
   已用 [[re-fw-extract]] 解出则直接进入下一步，跳过此步。

2. **启动脚本找程序入口**：
   ```sh
   ls etc/init.d/ etc/rc.d/ 2>/dev/null
   cat etc/inittab 2>/dev/null
   cat etc/init.d/rcS 2>/dev/null          # 常见主启动脚本
   ```
   阅读启动顺序：记录先启的服务与固件主程序（httpd / 服务端主进程），分析从它开始；rcS / rc 脚本里常有版本、厂商信息与调试开关。

3. **配置文件挖密钥/口令**：
   ```sh
   rg -i "password|passwd|secret|token|key|login|admin" rootfs_out -l
   cat etc/passwd etc/shadow 2>/dev/null
   ```
   重点目录：/etc、/usr/share、web 界面目录（固件 web 配置常明文存口令）、wpa_supplicant.conf、SSH 私钥（`find rootfs_out \( -name "*id_rsa*" -o -name "*.pem" \)`）。

4. **交叉编译二进制定位**：
   ```sh
   find rootfs_out -type f -exec file {} \; 2>/dev/null | grep ELF
   # 大镜像改用：
   find rootfs_out -type f -print0 | xargs -0 file | grep ELF
   arm-linux-gnueabi-readelf -h rootfs_out/usr/sbin/httpd   # Machine + Data 字段确认架构/字节序
   arm-linux-gnueabi-readelf -A rootfs_out/usr/sbin/httpd   # 交叉工具链细节（EABI 等）
   ```
   重点目录：/bin、/usr/bin、/usr/sbin、/usr/lib；busybox 是软链集合（`ls -la bin/` 看链接目标确认 applet）。

5. **弱口令/后门账号搜索**：
   ```sh
   cat etc/passwd
   rg -i "admin|root|debug|backdoor|telnet" rootfs_out/etc -l
   ```
   常见：root 空口令/弱口令、telnetd 常驻、默认 admin/admin、调试账号（debug/backdoor）；发现后门与可疑程序转 [[re-malware]] 评估。

## 跨域联合

- [[re-firmware]]：工作流第 3 步固定调用本技能
- 固件内 ELF 深挖 → [[re-binary-core]]（[[re-format-elf]] / [[re-ghidra]]）
- 需要运行固件 → [[re-fw-emulate]]；发现后门/恶意样本 → [[re-malware]]；发现通信 → [[re-protocol]]
- 本技能被 [[re-analyze]] 的 triage「分析固件 / IoT 设备」路径调用

## 常见坑与陷阱

- **配置里硬编码密钥/口令常见**：现象——固件里直接躺着 SSH 私钥、WiFi 密码、云平台 API key；原因——IoT 厂商为省成本硬编码；对策——系统性 `rg` 扫全部配置目录与 web 目录，别只看 /etc（步骤 3）
- **启动脚本决定分析顺序**：现象——几十个可执行文件不知从哪看起；原因——没先读启动脚本，从随机二进制开刀；对策——先读 rcS / inittab / init.d，按启动顺序定位主程序（步骤 2）
- **交叉架构二进制需对应工具链**：现象——本机 readelf 信息不全 / objdump 反汇编失败；原因——缺对应架构 binutils，或架构/字节序认错；对策——装交叉 binutils，`readelf -A` 确认架构与 EABI（步骤 4），确认后再选仿真/反编译工具
- **busybox 是软链集合**：现象——bin/ 下全是同名软链，`file` 全部指向同一 ELF；原因——busybox 单二进制多 applet；对策——看软链名即 applet 功能（ls/cat/httpd 等），分析该单一 ELF 即覆盖全部命令
