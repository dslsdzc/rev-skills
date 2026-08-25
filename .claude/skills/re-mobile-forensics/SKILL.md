---
name: re-mobile-forensics
type: atomic
description: >
  移动设备取证：Android/iOS 备份解析、应用数据提取、删除恢复与时间线。
  触发词：移动取证、手机取证、ADB备份、iTunes备份、手机数据提取。
---

# 移动设备取证

## 何时使用 / 何时不用

- 用：设备备份/镜像的数据提取、应用数据取证、删除恢复、时间线重建
- 用：应用数据落盘路径解析（数据库/偏好/缓存）——App 结构理解配合 [[re-mobile]]
- 用：时间点对比取证（备份前后数据变化/已删除记录比对）
- 用：轻量定向提取（单应用单表数据——直接 run-as/单应用备份，不必全量）
- 用：删除数据可恢复性评估（先判定再动手，避免无效耗时）
- 用：设备已离线/损坏时（备份文件仍可解析——备份解析不依赖设备在线）
- 不用：App 逆向分析（[[re-mobile]]）；通用文件系统分析（[[re-disk-forensics]]）；运行中进程动态提取（[[re-frida]]）
- 不用：云备份/云同步数据（Google/iCloud 云侧不在本技能，取证范围需另行授权）
- 不用：无授权设备（红线：仅授权设备；设备隔离与保全原则见 [[gotchas]]）

## 工具准备

### adb（Android 设备接口）

- Linux: `apt install adb` / `dnf install android-tools`；macOS: `brew install android-platform-tools`；Windows: 官方平台工具
- 验证: `adb --version`；`adb devices` 需设备开启 USB 调试并授权（屏幕弹窗确认）

### libimobiledevice（iOS 设备接口）

- Linux: `apt install libimobiledevice-utils`；macOS: `brew install libimobiledevice`；Windows: 官方构建
- 验证: `idevice_id -l`（列出设备）

### 备份解析工具

- Android: abe（Android Backup Extractor，Java jar，GitHub `nelenkov/android-backup-extractor`：`java -jar abe.jar unpack backup.ab backup.tar`）或等价 python 脚本；验证: `java -jar abe.jar --help`（需 Java，安装见 [[re-java]]）
- iOS: `idevicebackup2` + manifest 解析（见步骤 2）
- sqlite3（数据库读取——Linux: `apt install sqlite3`；macOS: `brew install sqlite3`；Windows: 官方构建）；验证: `sqlite3 --version`
- foremost（数据雕刻——Linux: `apt install foremost`；macOS: `brew install foremost`）；验证: `foremost -h`
- python3（解析脚本）：安装见 [[re-python]] 工具准备

## 操作步骤

按顺序执行；设备操作遵循授权边界（红线：仅授权设备）。取证顺序：隔离（断网/飞行模式）→ 记录设备状态（版本/解锁/加密/网络）→ 只读提取优先 → 产物存档。每步产物存档（路径 + sha256，见 [[re-triage]]）；远端擦除与保全细节见 [[gotchas]]。

1. **Android 提取**：
   ```sh
   adb backup -f backup.ab -all        # 全量备份（应用需允许备份）
   adb backup -f app.ab -apk -noobb com.target.app   # 单应用备份（按包名）
   adb shell run-as com.target.app ls data   # 应用沙箱（debuggable 应用）
   # root 设备：dd 镜像关键分区 / adb pull /data 直接提取
   ```
   - 备份可行性预检：`adb shell bmgr list transports`（确认系统备份服务可用；无输出/报错 → adb backup 不可用，换路径）
   - 设备状态记录：版本（`adb shell getprop ro.build.version.release`）+ 加密/解锁状态（影响后续解析路径）
   - `adb backup` 现状：Android 12 起官方弃用，targetSDK 31+ 的应用数据不再导出（仅 targetSDK<31 或 debuggable 应用有效，Play 商店新应用基本不可用）——失效时换 root/镜像提取（判据见 [[decision-tree]]）
   - ab 格式：魔数 `ANDROID BACKUP` + 版本/标志字节（压缩/加密位）+ 可选 AES-256-CBC 加密参数 + tar（可 deflate 压缩）负载
   - 备份解析：ab 头 → 解包 tar（加密备份需备份密码；无密码标注不可提取）；产物先用 `file backup.ab` 验魔数与大小
   - 产物存放：独立目录 + 命名含设备标识/时间（防多设备混淆）
   - 解析组合套路：`abe unpack backup.ab backup.tar`（加密加 `-password`）→ `tar tf` 列内容 → sqlite3/plist 分析
   - 应用沙箱：`run-as`（debuggable）/ root 设备直接读；`allowBackup=false` 的应用备份为空且无警告（见坑 2）
   - run-as 二进制安全拉取：`adb exec-out run-as com.target.app cat files/x.db > x.db`（exec-out 不做终端转义）
   - root 镜像注意：先查分区表（`adb shell ls /dev/block/by-name/` 或 `cat /proc/partitions`）再 dd 目标分区；镜像产物大，先确认磁盘空间
   - 硬件 Keystore 密钥不可通过备份导出（绑定设备硬件，标注局限）
   - 数据库提取 → sqlite3（[[re-disk-forensics]] 的 SQLite 页结构方法）

2. **iOS 提取**：
   ```sh
   idevicebackup2 backup ./backup_dir
   # 备份结构：Manifest.plist + 按 SHA1 哈希路径组织的文件
   ```
   - 备份结构：Manifest.plist（文件映射表：domain/相对路径 → 哈希文件名）、Info.plist（设备信息）、Status.plist（备份状态）、文件按内容哈希命名（[[gotchas]] 坑 3）
   - 首次连接需设备端信任（设置 > 通用 > 设备管理/信任此电脑）——未信任时 idevice_id 无输出
   - 加密备份判定：Manifest.plist 无法明文读取而 Info.plist/Status.plist 正常 → 加密备份；需备份密码（无密码则标注不可提取）
   - Keychain 数据在 keychain-backup.plist，同样需备份密码解密（密钥由密码派生，工具差异大，按实际工具文档操作）
   - 应用数据路径：Library/Preferences（plist 偏好）、Documents（用户数据）、Caches（缓存）、Library/Application Support（数据库常见位置）——App 结构理解见 [[re-mobile]]
   - 提取优先级：数据库 > 偏好 > 缓存（缓存可能含已删除内容残留）
   - 备份完整性核对：Manifest.plist 的文件大小/时间字段与实际文件对照
   - 备份与实时提取选型：备份优先（不触碰设备，证据完整性好）；需最新状态时实时提取并记录操作时间
   - 已有本地备份时直接解析默认目录：`~/Library/Application Support/MobileSync/Backup`（每设备独立子目录，核对 UDID 防混设备）

3. **删除恢复与时间线**：
   - SQLite 删除记录：freelist 页/WAL 未 checkpoint 页/未分配页残留——先确认 journal_mode（WAL/delete/journal）再选恢复路径，方法见 [[re-disk-forensics]] 数据库文件格式
   - 数据雕刻：foremost 对未分配空间按文件签名恢复（图片/压缩包/数据库页）；默认覆盖常见签名（jpg/png/zip），自定义类型用配置文件（`-c`）；恢复物用 magic/可读性验证（[[re-triage]] 初勘）
   - 加密设备注意：Android FBE/全盘加密下未分配页是密文，雕刻无效——优先走备份/镜像内已解密文件路径（见坑 8）
   - 时间线重建：文件时间戳 + 数据库记录时间（先归一 UTC，标注设备时区——坑 4）+ Status.plist 备份时点（佐证）
   - 恢复数据交叉验证：同一记录在多个数据库出现（如聊天库 + 索引库）时交叉比对，提高可信度
   - 产出：时间线表（时间/动作/来源）+ 恢复数据（按应用/数据类型归档）；时间线证据分级见 [[decision-tree]]

4. **证据整合与交付**：
   - 汇总：时间线表 + 提取物清单（每类数据的来源/提取方式/可信度）+ 方法记录
   - 结论按 [[analysis-contract]] 复核格式交付（结论/证据/置信度）；删除恢复带「部分恢复」限定

## 跨域联合

- [[re-forensics]] 网关：本技能归属
- [[re-disk-forensics]]：SQLite 结构/WAL/删除恢复方法
- [[re-mobile]]：App 结构理解（沙箱路径/数据结构）
- [[re-frida]]：运行中动态提取（本技能是静态/备份侧，两者互补）
- [[re-triage]]：产物初勘（类型/magic/哈希）
- [[re-mem-forensics]]：设备内存转储分析衔接（root 设备可 dump 内存）
- [[analysis-contract]]：结论交付格式

## 常见坑与陷阱

- **加密备份无密钥**：现象——备份无法解析；原因——AES 加密；对策——无密码则标注不可提取，不硬破解（授权边界）
- **ADB backup 权限限制**：现象——备份为空；原因——应用未声明 `allowBackup` 或 targetSDK≥31（Android 12+）；对策——换 root/镜像提取，标注路径局限
- **iOS 哈希路径混淆**：现象——文件找不到；原因——备份文件按内容哈希组织（非原名）；对策——manifest.plist 映射解析
- **时间线时区**：现象——时间错位；原因——设备时区与取证时区不一致；对策——统一 UTC 记录，标注设备时区
- **沙箱边界**：现象——拿不到目标数据；原因——无 root/未越狱；对策——按可提取范围交付（限定结论），不越授权
- **设备联网被远端擦除**：现象——提取中数据消失/变化；原因——设备联网触发远端抹除/同步覆盖；对策——先隔离（飞行模式/断网），后接电源防自动关机
- **备份中途损坏**：现象——备份文件不完整/解析报错；原因——操作中断（线缆/锁屏/空间不足）；对策——重试前确认空间与连接稳定，产物 sha256 存档；损坏备份按未分配数据走雕刻
- **完整性校验缺失**：现象——提取数据被篡改/不完整不知情；原因——未做校验；对策——产物 sha256 存档，镜像类产物校验分区摘要（无摘要则标注无法校验）
- **FBE/全盘加密**：现象——雕刻恢复出来是密文；原因——设备开启文件级/全盘加密（现代 Android 默认）；对策——优先走备份/镜像内已解密文件路径，标注加密局限
- **锁屏/授权状态**：现象——`adb devices` 显示 unauthorized/offline；原因——锁屏未解锁/USB 调试授权过期；对策——先解锁（授权范围内）再连接，记录授权状态
- **adb 多设备歧义**：现象——命令报错/操作错设备；原因——多设备连接未指定序列号；对策——`adb devices` 确认序列号，命令加 `-s <serial>`
- **删除恢复误判**：现象——恢复出的「已删除」记录实际是应用保留的冗余副本；原因——应用多处保存；对策——以「备份内不存在 + 镜像内存在」为删除判据（交叉验证）
- **备份密码遗忘**：现象——有密码备份但密码丢失；原因——密码未随备份记录；对策——提取时立即记录密码来源（授权范围内），不可恢复时标注
- **备份格式版本差异**：现象——解析工具报格式错；原因——新旧 Android/iOS 备份格式差异；对策——用与系统版本匹配的工具链，标注版本
- 场景分支与提取路径选择见 [[decision-tree]]；边界与反例见 [[gotchas]]
