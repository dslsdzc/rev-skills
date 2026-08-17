---
name: re-mobile-forensics
type: atomic
description: >
  移动设备取证：Android/iOS 备份解析、应用数据提取、删除恢复与时间线。
  触发词：移动取证、手机取证、ADB备份、iTunes备份、手机数据提取。
---

# 移动设备取证

## 何时使用 / 何时不用

- 用：设备备份/镜像的数据提取、应用数据取证、删除恢复
- 不用：App 逆向分析（[[re-mobile]]）；通用文件系统分析（[[re-disk-forensics]]）

## 工具准备

### adb（Android 设备接口）

- Linux: `apt install adb` / `dnf install android-tools`；macOS: `brew install android-platform-tools`；Windows: 官方平台工具
- 验证: `adb --version`

### libimobiledevice（iOS 设备接口）

- Linux: `apt install libimobiledevice-utils`；macOS: `brew install libimobiledevice`；Windows: 官方构建
- 验证: `idevice_id -l`（列出设备）

### 备份解析工具

- Android: `ab` 备份格式解析（python 脚本或工具）；iOS: `libimobiledevice` 的 `idevicebackup2` + manifest 解析
- sqlite3（数据库读取，见 [[re-disk-forensics]] 工具准备）

## 操作步骤

按顺序执行；设备操作遵循授权边界（红线：仅授权设备）。每步产物存档（路径 + sha256，见 [[re-triage]]）。

1. **Android 提取**：
   ```sh
   adb backup -f backup.ab -all        # 全量备份（应用需允许备份）
   # ab 格式：头（ANDROID BACKUP）+ 可选 AES 加密 + tar 负载
   adb shell run-as com.target.app ls data   # 应用沙箱（debuggable 应用）
   ```
   - 备份解析：ab 头 → 解包 tar（加密备份需密码）
   - 应用沙箱：`run-as`（debuggable）/ root 设备直接读
   - 数据库提取 → sqlite3（[[re-disk-forensics]] 的 SQLite 页结构方法）

2. **iOS 提取**：
   ```sh
   idevicebackup2 backup --full ./backup_dir
   # 备份结构：manifest.plist + 按哈希路径组织的文件
   ```
   - 备份解析：manifest.plist（文件映射）、加密备份需密码（无密码则标注不可提取）
   - Keychain 条目（需提取工具，权限边界）
   - 应用数据：Library/Preferences、Documents、Caches（按应用沙箱路径）

3. **删除恢复与时间线**：
   - SQLite 删除记录（freelist 残留——[[re-disk-forensics]] 数据库文件格式方法）
   - 时间线重建：文件时间戳 + 数据库记录时间（注意时区——见坑 5）
   - 产出：时间线表（时间/动作/来源）+ 恢复数据

## 跨域联合

- [[re-forensics]] 网关：本技能归属
- [[re-disk-forensics]]：SQLite 结构/WAL/删除恢复方法
- [[re-mobile]]：App 结构理解（沙箱路径/数据结构）

## 常见坑与陷阱

- **加密备份无密钥**：现象——备份无法解析；原因——AES 加密；对策——无密码则标注不可提取，不硬破解（授权边界）
- **ADB backup 权限限制**：现象——备份为空；原因——应用未声明 `allowBackup`；对策——换 root/镜像提取，标注路径局限
- **iOS 哈希路径混淆**：现象——文件找不到；原因——备份文件按内容哈希组织（非原名）；对策——manifest.plist 映射解析
- **时间线时区**：现象——时间错位；原因——设备时区与取证时区不一致；对策——统一 UTC 记录，标注设备时区
- **沙箱边界**：现象——拿不到目标数据；原因——无 root/未越狱；对策——按可提取范围交付（限定结论），不越授权
