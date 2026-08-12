---
name: re-fw-extract
description: >
  固件提取与解包：binwalk/unblob、magic 扫描、字节序。
  触发词：固件、binwalk、解包固件、firmware、IoT
---

# 固件提取与解包

## 何时使用 / 何时不用

- 用：拿到固件文件（.bin / .img / 升级包 / IoT 镜像）需要解开看内容
- 用：需要判断固件打包方式、架构与字节序
- 不用：已是文件系统镜像 / rootfs（直接走 [[re-fw-rootfs]]）
- 不用：需要运行固件观察行为（走 [[re-fw-emulate]]）
- 不用：需实物板子硬件提取（走 [[re-hardware-io]]）

## 工具准备

所有工具先验证再使用。解包与 magic 扫描是纯静态分析，可免沙箱（[[platform-tips]] 最高原则）；解出产物要运行时转 [[re-fw-emulate]]。

### binwalk —— 自动解包主力

- Linux: `apt install binwalk`（Debian/Ubuntu 仓库版为 2.x）/ `dnf install binwalk` / `pacman -S binwalk`
- pip（跨平台、版本新、签名库全，推荐）: `pip install binwalk`
- macOS: `brew install binwalk`（或 pip 版）
- Windows/WSL: Windows 本机无官方包，用 WSL 内 Linux/pip 版
- 验证: `binwalk --version`（2.x）或 `binwalk --help`（老版）

### unblob —— 更准的自动解包（推荐主力）

- 跨平台: `pip install unblob`（依赖较多，建议 venv: `python3 -m venv venv && venv/bin/pip install unblob`）
- 各发行版基本无官方包，用 pip
- 验证: `unblob --version`

### dd —— 按偏移切分

- Linux/macOS: coreutils 自带（macOS 自带 /usr/bin/dd）
- Windows/WSL: WSL 内 Linux 版；Windows 本机用 Git Bash 自带 dd 或 WSL
- 验证: `dd --version`

### hexdump —— 十六进制查看与手工 magic 扫描

- Linux: `apt install bsdmainutils`（Debian/Ubuntu）/ `dnf install util-linux`（Fedora/RHEL，含 hexdump）
- macOS: 自带 /usr/bin/hexdump
- Windows/WSL: WSL 内 Linux 版
- 验证: `hexdump -C /dev/null`（无报错即可用；macOS 版无 `--version`）

### sasquatch —— 老式/厂商魔改 squashfs 解包

- Linux: 源码编译（`git clone https://github.com/devttys0/sasquatch`，需 `apt install zlib1g-dev liblzma-dev build-essential` 后 `make`）
- macOS: 同上源码编译（需 Xcode Command Line Tools）
- Windows/WSL: WSL 内编译
- 验证: `sasquatch -h` 输出用法（编译产物在仓库子目录，需加入 PATH）

## 操作步骤

按顺序执行，每步记下结果。

1. **自动解包（unblob 优先，binwalk 兜底）**：
   ```sh
   unblob firmware.bin                      # 更准，自动识别 50+ 容器格式并递归解包
   # 或 binwalk：
   binwalk firmware.bin                     # 先列出签名与偏移
   binwalk -Me firmware.bin                 # -M 递归 -e 提取
   ```
   产物：`firmware.bin/`（unblob）或 `_firmware.bin.extracted/`（binwalk）目录。解出的文件系统转 [[re-fw-rootfs]]，ELF 转 [[re-binary-core]]。

2. **magic 手工扫描（自动解包不全时）**：
   ```sh
   hexdump -C firmware.bin | head -40
   # 或按 binwalk 报告的偏移核对：
   dd if=firmware.bin bs=1 skip=<偏移> count=16 | hexdump -C
   ```
   常见魔数：JPEG `FF D8 FF`、gzip `1F 8B`、squashfs `hsqs`、cramfs `45 3D CD 28`（小端，大端反序）、U-Boot `27 05 19 56`、jffs2 `85 19`、ELF `7F 45 4C 46`。识别出一个就按该格式处理。

3. **字节序判断**：
   ```sh
   file firmware.bin                        # 输出含 LSB/MSB 提示
   readelf -h <解出的ELF>                    # Machine 字段 + Data 字段（大小端）
   strings firmware.bin | head               # 可读串确认字节序
   ```
   大端 ARM/MIPS 固件常见：大端时魔数与字符串按大端编码（如 `hsqs` 反序出现）；确认后整个流程按该字节序进行。

4. **嵌套容器逐层解**：
   - unblob / `binwalk -Me` 会自动递归，但嵌套（tar 里再 zip、自定义头包着 gzip）常中途断
   - 逐层手动：先解外层 → `file` 确认内层类型 → 用对应工具（tar/gzip 系统自带；squashfs 用 sasquatch；其他用 [[re-fw-rootfs]] 工具准备的 7z/unsquashfs）再解，直到出现文件系统或 ELF
   - **结束标记后的附加数据**：图片（PNG `IEND`、JPEG `FFD9`）等格式的结束标记之后常附加容器/压缩流（解析器读到结束标记即停，附加数据对正常查看不可见）——`file` 会把整文件报成图片，检查 `rfind(IEND/FFD9)` 之后的部分，且**结束标记用第一个还是最后一个取决于数据里可能碰巧出现同样的字节对**
   - **zip 缺签名也能修复**：附加的 zip 可能缺本地文件头开头的 `PK\x03\x04`（4 字节被剥）——用字段自洽验证：补上签名后 version（常见 20/45）、mod date（年 1980+）、compressed/uncompressed size（与 EOCD/中央目录条目一致）全部合理，且 EOCD 在尾部完好 → 补 `PK\x03\x04` 前缀即完整可解（`unzip` 报 "missing 4 bytes" 或 zipfile `OSError: Invalid argument` 是典型征兆）
   - **套娃模式自动化**：同一手法重复出现（如每层都是"图片+尾部 zip 含下一层"）时写循环自动剥——提取尾部 → 修复 → 解压 → 定位下一层 → 重复，直到无附加数据；中间产物每层命名保留（可回滚）

5. **自动失败时手工切分（dd 按偏移）**：
   ```sh
   binwalk firmware.bin                     # 找内嵌文件偏移
   dd if=firmware.bin of=part1.bin bs=1 skip=<偏移1> count=<长度1>
   dd if=firmware.bin of=part2.bin bs=1 skip=<偏移2>
   file part*.bin                           # 每块验证
   ```
   厂商自定义头最常见：跳过头部 N 字节后才是标准格式（先 hexdump 目测头长度再切）。

## 跨域联合

- [[re-firmware]]：工作流第 2 步固定调用本技能
- 解出的文件系统 → [[re-fw-rootfs]]；解出的可运行程序 → [[re-fw-emulate]]
- 解出的 ELF → [[re-binary-core]]（[[re-format-elf]] / [[re-ghidra]]）；发现恶意样本 → [[re-malware]]
- 本技能被 [[re-analyze]] 的 triage「分析固件 / IoT 设备」路径调用（re-firmware → re-fw-extract）

## 常见坑与陷阱

- **自动解包失败 ≠ 没东西**：现象——binwalk 输出空白或解出 0 字节文件；原因——厂商自定义头/加密层使魔数不匹配，签名库漏判；对策——hexdump 手工扫自定义头（步骤 2），跳过头部偏移再用 dd 切分（步骤 5）
- **字节序错 → 全错**：现象——解出的文件/ELF/字符串全乱；原因——大端 ARM/MIPS 固件被当小端处理；对策——先 `file` + `readelf -h` 确认字节序（步骤 3），后续解包/分析全程保持一致
- **大端 MIPS 头被 binwalk 漏**：现象——binwalk 识别不出已知文件系统（如 squashfs）；原因——签名按小端特征匹配，大端魔数反序；对策——hexdump 手工找反序魔数，按偏移 dd，用 sasquatch 解
- **解包产物混入垃圾**：现象——解出的"文件"是随机数据，`file` 报 data；原因——签名误报或切分偏移错位；对策——每个产物 `file` + 看头 16 字节验证 magic，无效即重试偏移
- **扩展名与内容不符（伪装扩展名）**：现象——`.jpg` 报 PNG、`.so` 报 tar、`.c` 报 XZ；原因——作者故意用无关扩展名（隐写/套娃/免检场景常见）；对策——永远以 `file`/魔数为准，扩展名只当线索；`file` 输出带 "with extra data prepended" 等提示时直接照做
- **zip 报错但能列出文件**：现象——`unzip` 报 "missing 4 bytes"/"invalid zip with overlapped components"（zip bomb 误报）或 Python zipfile `OSError: [Errno 22] Invalid argument`；原因——本地文件头缺 `PK\x03\x04` 签名，或数据前有前缀垃圾；对策——先 `unzip -l` 看能否列出（能列出说明 EOCD/中央目录完好），补签名（步骤 4）或用 `UNZIP_DISABLE_ZIPBOMB_DETECTION=TRUE` 强制
