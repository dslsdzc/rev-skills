---
name: re-disk-forensics
description: >
  磁盘/文件系统取证：删除恢复、时间线、可疑文件定位。
  触发词：磁盘取证、文件系统、删除恢复、时间线、ext4、NTFS
---

# 磁盘取证与文件系统分析

## 何时使用 / 何时不用

- 用：拿到磁盘镜像（dd / E01）或介质做取证——删除文件恢复、时间线重建、可疑文件/残留数据定位
- 用：事件响应需要"介质上发生过什么"（删了什么、什么时候写的、留了什么痕迹）
- 用：分区丢失/损坏后的分区表重建与文件抢救（testdisk）
- 不用：内存取证（那是 [[re-mem-forensics]]，与磁盘取证并列的另一个取证分支）
- 不用：普通文件系统挂载使用（那要可写挂载；取证一律只读，见坑 1）
- 不用：加密卷且无密钥——先找密钥（见坑 2）

## 工具准备

取证铁律：**只读**。本技能所有工具只读镜像文件、不挂载可写、不在原介质上写任何东西（见坑 1）。镜像获取与可疑对象提取的结果按 sha256 + 路径存档（取证要求可追溯，见 [[platform-tips]]）。

### sleuthkit —— 取证分析主力（fls/icat/tsk_recover/mmls/fsstat/blkls）

- Debian/Ubuntu: `apt install sleuthkit`
- Fedora: `dnf install sleuthkit`
- Arch: `pacman -S sleuthkit`（extra 仓库）
- macOS: `brew install sleuthkit`
- Windows: WSL 内 Linux 版优先（见 [[platform-tips]] WSL 分支）；GUI 用 Autopsy（`winget install SleuthKit.Autopsy`，内置 sleuthkit 工具）
- 验证: `fls -h`；`mmls -h`；`tsk_recover -h`；`mactime -h`

### testdisk / photorec —— 分区修复与文件雕刻（cgsecurity）

- Debian/Ubuntu: `apt install testdisk`（photorec 在同一包内，官方文档确认无独立包）
- Fedora: `dnf install testdisk`（photorec CLI 随包；GUI 版独立包 `qphotorec`）
- Arch: `pacman -S testdisk`（extra，photorec 随包）
- openSUSE: `zypper install testdisk photorec`（该发行版 photorec 为独立包）
- macOS: `brew install testdisk`
- Windows: WSL 内 Linux 版（chocolatey 上 testdisk 包极旧，不推荐）
- 验证: `testdisk /?`；`photorec /?`

### dd / ewf-tools —— 镜像获取

- dd: coreutils 自带（Linux/macOS/WSL 均可用）
- ewf-tools（E01 证据格式，带校验块）: Debian/Ubuntu `apt install ewf-tools` / Fedora `dnf install ewf-tools` / Arch `pacman -S ewf-tools`；验证: `ewfacquire -V`
- Windows: 只读镜像工具 FTK Imager（GUI，exterro 官网免费版）或 WSL 内 Linux 版

### 只读挂载 —— loop + ro（需要直接读文件内容时）

- mount 内置（util-linux）；NTFS 需 ntfs-3g: Debian/Ubuntu `apt install ntfs-3g` / Fedora `dnf install ntfs-3g` / Arch `pacman -S ntfs-3g`
- 验证: `mount -o ro,loop,noload ...` 后 `findmnt` 输出包含 `ro`

### autopsy —— 可选 GUI（团队/可视化）

- Debian/Ubuntu: `apt install autopsy`；Fedora: `dnf install autopsy`；Arch: `pacman -S autopsy`（AUR 或 extra）；Windows: `winget install SleuthKit.Autopsy`；macOS: `brew install --cask autopsy`

## 操作步骤

按顺序执行，每步产物（镜像/提取文件/时间线）存档 sha256 + 路径（供 [[re-ioc]] 报告引用）。

1. **只读镜像获取（先存证后动手）**：
   ```sh
   sha256sum /dev/sdX > evidence.sha256     # 原始介质哈希存证（分析前后复核）
   dd if=/dev/sdX of=evidence.dd bs=4M conv=noerror,sync status=progress
   sha256sum evidence.dd >> evidence.sha256 # 镜像哈希复核，与源哈希一致才继续
   ```
   - 物理盘优先用写保护器（USB write-blocker）；软件写保护 `blockdev --setro /dev/sdX`
   - 分区镜像: `dd if=/dev/sdX1 ...` 只镜像目标分区；整盘镜像保留分区表与未分配空间（未分配空间常含残留证据，见步骤 5）
   - 证据格式: raw dd 最通用；长期保存用 E01（`ewfacquire /dev/sdX`，内置校验与压缩）
   - 已有多份镜像（事件响应常用方案）时直接进入步骤 2，别重复取

2. **分区与文件系统识别（ext4 / NTFS / APFS）**：
   ```sh
   file evidence.dd                          # 常见文件系统魔数初判
   mmls evidence.dd                          # 分区表布局（含 start 扇区偏移）
   fsstat -o <分区start> evidence.dd         # 文件系统类型与元数据统计
   ```
   - sleuthkit 的 `-o` 参数是**扇区偏移**，直接填 mmls 输出的 start 列；loop 挂载则换算字节 `offset=$((start*512))`
   - ext4: fsstat 输出 superblock/mgroup；NTFS: 输出 $MFT 位置；APFS: mmls 显示 Apple_APFS 容器分区（APFS 内部卷需要 apfs 工具，sleuthkit 对 APFS 支持有限，必要时用 macOS 本机工具）
   - 无分区表（整盘文件系统 / 隐藏分区 / 被删分区表）→ mmls 无输出：直接对镜像 fsstat；分区表重建用 testdisk（步骤 3）
   - 识别失败且熵高 → 加密卷（BitLocker/FileVault/LUKS），见坑 2

3. **删除文件恢复（元数据法 + 雕刻法）**：
   ```sh
   # 元数据法（保留文件名/路径/时间）—— sleuthkit
   fls -r -o <分区start> evidence.dd                       # 全部文件，含 [DELETED]
   fls -o <分区start> evidence.dd <inode>                  # 指定目录 inode 下文件
   icat -o <分区start> evidence.dd <inode> > rec.bin       # 按 inode 提取（含删除文件）
   tsk_recover -e -o <分区start> evidence.dd out/          # 批量恢复全部已删除文件
   ```
   - fls 输出 `r/r 12345-128-1: 文件名 [DELETED]`——行首 inode 号供 icat；未删除文件也可用 icat 精确提取（比挂载拷贝可控）
   - 删除恢复结果不是 100%（SSD TRIM/覆写），见坑 5
   - **分区丢失/损坏、元数据法失效 → testdisk / photorec（雕刻）**：
     ```sh
     testdisk evidence.dd          # 交互: 恢复丢失分区表 / Advanced → Undelete
     photorec /d <输出目录> evidence.dd   # 雕刻: 按文件签名扫描恢复（无文件名，见坑 6）
     ```
   - photorec 恢复类型可交互过滤（只雕刻目标扩展名，缩小结果集）；`/d` 指定输出目录

4. **时间线重建（fls -m → mactime）**：
   ```sh
   fls -r -m / -o <分区start> evidence.dd > bodyfile      # -m 生成 body file（挂载点写 /）
   mactime -b bodyfile -d -z UTC > timeline.csv           # -d CSV、-z 指定时区
   ```
   - 时间线回答"什么时候创建/修改/删除/访问"——找异常窗口（凌晨批量写、删除+复制组合、反常的访问时间）
   - 时间戳可被伪造（timestomp），见坑 4——时间线要与其他来源（USN Journal、系统日志、[[re-mem-forensics]] 内存时间线）交叉验证
   - CSV 里按 MAC 时间过滤删除动作: `grep -i ',d,' timeline.csv`（删除记录）

5. **可疑文件提取（未分配空间/隐藏分区）**：
   ```sh
   # 未分配块（含删除文件残留、缓存、临时数据）
   blkls -o <分区start> evidence.dd > unallocated.bin
   strings -n 8 unallocated.bin | grep -iE 'key|password|flag|http' | head -50
   # 分区表空隙（slack space）/隐藏分区: 按 mmls 相邻分区起止手工截取
   dd if=evidence.dd of=gap.bin bs=512 skip=<A_end> count=<B_start-A_end>
   ```
   - 未分配空间是"删除≠消失"的主战场：凭据/密钥/URL/文档残片常留在那里
   - 被删除/隐藏分区: testdisk 扫描重建分区表项后，把重建分区按步骤 3 流程恢复文件
   - 提取对象（文件/残片）先算 sha256 再分析；可疑二进制转 [[re-binary-core]] 深挖，敏感串进 [[re-ioc]] IOC 列表

## 跨域联合

- [[re-forensics]]：本技能是该网关的磁盘侧取证分支（内存侧为 [[re-mem-forensics]]）——网关选择树按"内存 vs 磁盘"分派
- [[re-mem-forensics]]：并列的取证分支——内存残留与磁盘证据互证（进程行为 ↔ 文件落地）；BitLocker 密钥可先从内存取证插件拿（再回本技能解密卷）
- [[re-ti]]：提取对象（哈希/域名/IP）做情报查询
- [[re-ioc]]：磁盘证据（文件/时间线/残留数据）汇总成 IOC 与报告证据段
- [[re-binary-core]]：提取的可疑二进制/脚本深挖（[[re-ghidra]] / [[re-ida]]）
- [[re-crypto-keys]] / [[re-crypto-decrypt]]：加密卷密钥提取（BitLocker/LUKS）与加密文件解密
- [[re-firmware]]：固件/嵌入式存储镜像同样按"磁盘镜像"流程处理（binwalk 解包层）
- [[re-memdump]]：内存转储是磁盘取证的上游佐证（密钥/凭据/执行痕迹，默认转储优先）
- 引用 [[platform-tips]] WSL 分支（Windows 盘镜像在 WSL 内用 Linux 取证工具）与取证证据链要求

## 常见坑与陷阱

- **写操作污染证据（必须只读）**：现象——分析完镜像哈希对不上、文件系统状态前后不一致、报告无法自证；原因——`mount` 默认可写（ext4/NTFS 挂载会重放日志、更新访问时间），或在原设备上直接跑了恢复工具；对策——镜像一律 `mount -o ro,loop,noexec,nodev,nosuid`，ext4 加 `noload`、NTFS 用 `ntfs-3g -o ro,recover=no` 跳过日志重放（见坑 3）；分析前 sha256 存证、分析后复核；物理盘用写保护器或 `blockdev --setro`；只读数据尽量用 sleuthkit 工具（fsstat/fls/icat 只解析不写）而非挂载
- **加密卷（BitLocker/FileVault/LUKS）**：现象——fsstat/testdisk 报"无法识别文件系统"，扇区全是高熵；原因——全卷加密，无密钥看不到内容；对策——密钥路径: ① 系统运行时的内存转储取密钥（[[re-mem-forensics]] 的 Bitlocker FVEK 扫描插件 → `dislocker` 挂载）② 用户密码/恢复密钥（BitLocker 48 位恢复密钥、FileVault 恢复密钥、LUKS passphrase）③ 未加密的启动分区（UEFI/Boot 分区不加密，可提取启动链证据）；工具: dislocker（BitLocker）、`cryptsetup luksOpen`（LUKS）；拿不到密钥则该镜像只能做非内容取证（分区结构/引导链），并如实标注局限
- **文件系统日志干扰**：现象——fls 看到的文件状态与分析时不一致（文件"回滚"到旧状态），或挂载后镜像哈希变化；原因——ext4 jbd2 / NTFS 日志在挂载时被重放，未提交事务被写回；对策——只读挂载必须带 `noload`（ext4）/ `recover=no`（ntfs-3g）；镜像直接存两份（原始 + 工作副本），分析在副本上做，原始镜像永不挂载
- **时间戳伪造（timestomp）**：现象——时间线里成批文件的时间戳完全一致或明显不合理（如删除时间早于创建时间、全部改为同一时刻）；原因——攻击者/样本用 timestomp 类手法改写 MFT/inode 时间戳（[[re-malware]] 常见收尾动作）；对策——交叉验证: NTFS 的 USN Journal（记录了真实变更序列）、ext4 的访问时间 vs crtime、系统日志、[[re-mem-forensics]] 内存时间线；发现伪造行为本身就是重要取证结论，写进报告而不是当脏数据滤掉
- **删除 ≠ 可恢复（SSD TRIM/覆写）**：现象——fls 列出一堆 [DELETED] 但 icat 读出来全 0 或取不到；原因——SSD TRIM 已擦除物理块、数据被后续写入覆盖、NTFS 压缩/加密文件；对策——先确认介质类型（HDD/SSD）与删除时间窗口（越早恢复概率越高）；未分配空间走 blkls 看是否有残留，全 0 就如实报告"已被擦除"
- **photorec 雕刻误报**：现象——恢复出大量"文件"但打不开/内容与扩展名不符；原因——签名雕刻只认文件头，真实文件碎片化或被覆写后拼接出假文件；对策——交互菜单按文件类型过滤（只恢复目标类型）、优先验证小文件与关键类型、恢复结果抽查内容并算 sha256 入库（[[re-ioc]]）
