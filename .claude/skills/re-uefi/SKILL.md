---
name: re-uefi
description: >
  UEFI/BIOS 固件：DXE 驱动、UEFI 模块、bootkit。
  触发词：UEFI、BIOS、DXE、bootkit、Secure Boot、EFI 固件
---

# UEFI 固件逆向（DXE 驱动 / UEFI 模块 / bootkit）

## 何时使用 / 何时不用

- 用：固件镜像内含 EFI 结构（Firmware Volume / FFS 文件 / DXE 驱动）——BIOS 更新包（.fd/.rom/.bin）、UEFI 驱动、EFI 应用
- 用：bootkit 定位（SMM handler、定时器回调、启动路径挂钩）与验证
- 用：Secure Boot / 启动链相关分析（签名、证书、NVRAM 变量）——需合法授权，见坑 4
- 不用：固件是传统 Linux 嵌入式 rootfs（走 [[re-fw-extract]] / [[re-fw-rootfs]]；[[re-firmware]] 网关先判定）
- 不用：Legacy BIOS Option ROM / 非 EFI 传统固件（binwalk 走 [[re-fw-extract]]）
- 不用：只需整体解包看内容（先 [[re-fw-extract]] 初判，确认是 UEFI 结构再进本技能）
- 注意：静态分析先行（大型固件原则）；仿真 bootkit = 运行恶意代码，默认沙箱（[[platform-tips]] 最高原则）

## 工具准备

所有工具先验证再使用。固件镜像解析/模块静态分析可免沙箱；OVMF 仿真（步骤 5）是动态执行，默认沙箱 + 网络隔离（[[platform-tips]] 最高原则）。

### UEFITool / UEFIExtract（固件解析主力）

- Debian/Ubuntu: `apt install uefitool uefitool-cli`（官方包：GUI + CLI；CLI 含 UEFIExtract/UEFIFind）
- Arch: AUR `yay -S uefitool`（或 `uefitool-git`；非官方仓库）
- Fedora: 无官方包 → GitHub releases 的 Linux x64 二进制（https://github.com/LongSoft/UEFITool/releases）或源码构建（qmake + Qt6）
- macOS: GitHub releases 的 universal macOS 二进制（同上页面）
- Windows: GitHub releases 的 win64 二进制（或 `choco install uefitool` 如镜像可用）
- 验证: `uefiextract --help` 输出用法；GUI `uefitool` 能打开固件镜像

### UEFIFind（按模式串定位文件，随 uefitool-cli）

- NE 版只有位置参数语法：`uefifind imagefile {header|body|all} {list|count} pattern`，无 -g/-t 选项
- 按 GUID 定位改用 UEFIExtract 的 GUID 参数模式：`uefiextract fw.bin <GUID>`（见下）
- 装法同上（Debian/Ubuntu 的 uefitool-cli 内含）
- 验证: `uefifind --help`

### ghidra / ida（模块反编译；装法见 [[re-ghidra]] / [[re-ida]]）

- .efi 模块是 PE/COFF（subsystem EFI_BOOT_SERVICE_DRIVER / EFI_APPLICATION），两家都能直接导入
- EfiRom 插件（可选）：EDK2 工具，用于 ROM 文件与 .efi 互转/体积查询
- 验证: 导入提取出的 .efi 能自动识别 subsystem 为 EFI boot service driver

### ovmf —— OVMF（Open Virtual Machine Firmware，UEFI 仿真固件）

- Debian/Ubuntu: `apt install ovmf`（/usr/share/OVMF/OVMF_CODE.fd、OVMF_VARS.fd）
- Fedora/RHEL: `dnf install edk2-ovmf`（路径 **/usr/share/edk2/ovmf/OVMF_CODE.fd**——旧 /usr/share/OVMF 布局已废弃）
- Arch: `pacman -S edk2-ovmf`（仅装 **/usr/share/edk2/x64/OVMF_CODE.4m.fd**，4m 格式）
- macOS: `brew install qemu` 自带固件（`$(brew --prefix)/share/qemu/edk2-x86_64-code.fd`，随 qemu 包）
- Windows: QEMU 安装包自带（share/qemu/ 下 edk2-x86_64-code.fd）
- 验证: 按发行版查对应路径——Debian/Ubuntu `ls /usr/share/OVMF/OVMF_CODE.fd`；Fedora/RHEL `ls /usr/share/edk2/ovmf/OVMF_CODE.fd`；Arch `ls /usr/share/edk2/x64/OVMF_CODE.4m.fd`；macOS 用 brew 前缀路径

### qemu-system-x86_64（OVMF 运行载体）

- Debian/Ubuntu: `apt install qemu-system-x86`
- Fedora: `dnf install qemu-system-x86-core`（完整虚拟化组为 `dnf install @virtualization`）
- Arch: `pacman -S qemu-system-x86`
- macOS: `brew install qemu`
- Windows: qemu.weilnetz.de 安装包
- 验证: `qemu-system-x86_64 --version`

## 操作步骤

按顺序执行，每步记录证据（路径 + sha256，见 [[re-triage]]）。初勘先做：`file fw.bin` + 熵确认是否 UEFI 结构（[[re-triage]]）。

1. **固件镜像解析（Firmware Volume → File → Section）**：
   ```sh
   file fw.bin
   uefiextract fw.bin all            # 全量递归解包（含嵌套 FV 与压缩节，见坑 1/2）
   ls fw.bin.dump/                   # 树：Volume0/ → File0/ → Section0/ → PE32 等
   ```
   - GUI: UEFITool 打开 fw.bin，左侧树自上而下 FV → FFS File → Section；先数 FV 数量与类型——主 DXE FV 通常最大、含成百上千模块；PEI FV 与 SEC Core 在最前
   - 先确认镜像里有几层 FV（嵌套/恢复卷），别只盯着第一层（坑 1）

2. **DXE 驱动提取**：
   ```sh
   ueifind fw.bin all list <GUID>    # 按模式串（含 GUID 文本）定位文件——NE 版仅位置参数语法，无 -g/-t
   # 按 GUID 直接提取指定文件（UEFIExtract 的 GUID 参数模式）:
   #   -m 合法值: all|body|header|info|file；-t 是十六进制节类型（PE32=0x10，即 -t 10）
   uefiextract fw.bin <GUID> -o driver.efi -m body -t 10
   file driver.efi                   # 期望输出: PE32+ executable (EFI boot service driver)
   ```
   - UEFITool GUI: 右键 File → Extract body，导出"裸 PE"（去掉 FFS/节头，见坑 3）
   - 提取产物先 `sha256sum` 存证（[[re-triage]]），再进反编译器

3. **模块分析（入口 / Protocol 服务）**：
   - [[re-ghidra]] / [[re-ida]] 打开 .efi；入口 = 镜像 entry（DriverEntry），它是理解驱动的起点
   - Protocol 服务是 UEFI 的"API"：`gBS->LocateProtocol(&guid,...)`（获取服务）、`gBS->InstallProtocolInterface(...)`（注册服务）、`gBS->CreateEvent(...)`（事件/回调）、`gST->ConOut`（控制台输出）
   - GUID 即"符号"——识别出 LocateProtocol 的 GUID 等于识别 API 调用；用 UEFITool 内置 GUID 数据库（界面里 GUID 旁显示协议名）或搜 UEFI 规范/UEFI GUID 表
   ```sh
   strings driver.efi | grep -iE 'protocol|runtime|efi_' | head -30
   ```
   - 记录：入口函数、安装/获取了哪些 Protocol、是否注册了事件回调（接步骤 4）

4. **bootkit 定位（SMM / 定时器回调 / 启动路径挂钩）**：
   - **定时器回调**: `gBS->CreateEvent(EVT_TIMER, TPL, Callback, ...)` + `gBS->SetTimer(..., PERIODIC/ONESHOT, ...)` → 回调函数就是周期执行恶意逻辑的地方（最常见挂点）
   - **SMM**: `SmiHandlerRegister` / SMST 服务 → SMM driver 注册 SMI handler（SMM 内执行的代码，比内核 ring0 更高特权、SMRAM 内执行的持久层）
   - **启动路径挂钩**: BDS 阶段篡改（NVRAM 变量 BootOrder/BootNext、替换 EFI 启动项、hook 启动管理器/PXE 路径）；S3 恢复路径（AP 唤醒代码）
   - **运行时服务钩子**: 拦截/替换 `gRT->SetVariable`/`GetVariable` 等 Runtime Services 指针
   - 判定特征: 驱动不卸载、携带自定义 GUID、DXE_DEPEX 依赖其他启动器模块、strings 里出现路径/密钥/URL；确认可疑模块 GUID 与依赖关系后进步骤 5

5. **OVMF 仿真验证**（运行恶意代码——沙箱内，网络 `-net none`）：
   ```sh
   # 只读代码固件 + 可写变量固件（两片 pflash 标准做法）；OVMF_CODE.fd 路径按发行版：
   #   Debian/Ubuntu: /usr/share/OVMF/OVMF_CODE.fd
   #   Fedora/RHEL:   /usr/share/edk2/ovmf/OVMF_CODE.fd（旧 /usr/share/OVMF 布局已废弃）
   #   Arch:          /usr/share/edk2/x64/OVMF_CODE.4m.fd（4m 格式）
   qemu-system-x86_64 -drive if=pflash,format=raw,readonly=on,file=/usr/share/OVMF/OVMF_CODE.fd \
     -drive if=pflash,format=raw,file=OVMF_VARS.fd \
     -m 1024 -net none -boot menu=on
   ```
   - 验证固件能启动到 UEFI Shell/系统 → 再把提取的驱动/固件修改（UEFITool 插入或重建固件镜像）挂入同一 OVMF 观察行为差异
   - 无真实固件时 OVMF 就是基线环境（无 Secure Boot 签名约束，见坑 4）；仿真细节与用户态替代见 [[re-fw-emulate]]
   - 动态行为确认（回调触发/变量篡改）→ 沙箱 + 快照（[[re-sandbox]]），行为分析转 [[re-malware]]；每步产物存证

## 跨域联合

- [[re-firmware]]：本技能由 re-firmware 网关引用——UEFI 固件分支；整体流程仍按网关 提取→rootfs→仿真 编排
- [[re-fw-emulate]]：步骤 5 的 OVMF/QEMU 全系统仿真就是本技能对 [[re-fw-emulate]] 的 UEFI 具体化
- [[re-binary-core]]：DXE 驱动静态反编译（[[re-ghidra]] / [[re-ida]] / [[re-radare2]]）、导入表 [[re-imports]]
- [[re-triage]]：初勘（hash / 架构 / 熵），每层产物存证
- [[re-malware]]：bootkit 动态验证进沙箱（[[re-sandbox]]），恶意行为分析转 [[re-malware]]
- 非 EFI 固件（传统 BIOS / 嵌入式镜像）→ [[re-fw-extract]]（binwalk 初判）
- [[platform-tips]] 相关分支：静态优先（大型固件样本）、动态默认沙箱（仿真 bootkit 时网络 -net none）、Linux/Windows 平台分支

## 常见坑与陷阱

- **固件镜像多 FV 嵌套**：现象——UEFITool 打开只看到少量文件/模块，找不到要找的驱动；原因——现代固件把 FV 嵌套封装（PEI FV 内嵌 DXE FV、恢复卷/Capsule、ACPI 表内嵌 FV），只分析外层自然缺件；对策——用 `uefiextract fw.bin all` 全量递归展开（自动处理嵌套），或 GUI 里逐层展开子 FV；先确认镜像结构再分析
- **压缩/填充区遮挡内容**：现象——FFS 文件段显示为压缩数据或 FREE_SPACE/FIXED 填充，看不到 PE32 代码；原因——厂商对整个 DXE 卷做压缩（EFI/LZMA 压缩节），留空区是正常布局；对策——UEFITool/UEFIExtract 会自动解压并显示解压后的 Section（用它看，别用 binwalk 的原始字节）；binwalk 结果里"找不到代码"不代表没有，回 UEFITool 确认
- **PE 头在 FFS 内偏移**：现象——从固件里抠出的"文件"直接 file/IDA 打开失败或反编译全是乱码；原因——FFS File Header（24/32 字节）+ Section Header + 对齐填充后才是 PE32 主体，PE 头不在文件偏移 0；对策——用 UEFITool 右键 Extract body / `uefiextract fw.bin <GUID> -m body` 导出裸 PE，导出后 `file` 确认输出含 "PE32+ executable (EFI boot service driver)" 再进反编译器；手工提取要按 Section 布局算偏移
- **Secure Boot 签名验证绕过分析需合法授权**：现象——想"绕过 Secure Boot"/"给固件重签名"来做实验，动真实签名固件出问题；原因——签名绕过、固件密钥/证书提取、在真实设备上验证 bootkit 都涉及法律与授权边界；对策——默认在 OVMF 开发固件（无签名约束）里分析与验证行为；对真实固件动手前确认授权范围（自有设备、漏洞研究授权），未授权不碰；报告里明确边界（与 [[re-hardware-io]] 的授权边界同类表述）
