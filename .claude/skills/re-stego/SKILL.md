---
name: re-stego
type: atomic
description: >
  隐写术检测与提取：文件尾附加、图片 LSB、音频与其他载体、提取验证。
  触发词：隐写、stego、LSB、文件尾附加、隐写提取、图片隐写。
---

# 隐写术检测与提取

## 何时使用 / 何时不用

- 用：隐写怀疑（CTF 题/取证对象）、文件尾异常、图片/音频异常
- 不用：正常文件分析（各归各域技能）

## 工具准备

### zsteg（图片 LSB 扫描）

- 多平台: `gem install zsteg` 或源码（GitHub）
- 验证: `zsteg -v`

### steghide（图片/音频隐写）

- Linux: `apt install steghide` / `dnf install steghide`；macOS: `brew install steghide`
- 验证: `steghide info --help`

### binwalk（尾部扫描）

- 安装与验证见 [[re-fw-extract]] 工具准备

### python3（位操作/验证脚本）

- 安装与验证见 [[re-python]] 工具准备

## 操作步骤

按顺序执行，每步产物存档（路径 + sha256，见 [[re-triage]]）。

1. **文件尾附加检测**：
   ```sh
   binwalk sample.png | tail -20       # 附加数据扫描
   hexdump -C sample.png | tail -10    # 尾部目检
   ```
   - 尾部附加：文件正常但尾部有多余数据（衔接 [[re-patching]] 尾部附加经验）
   - 提取：binwalk 自动分割或 dd 按偏移提取 → magic 检查（[[re-triage]]）

2. **图片 LSB**：
   ```sh
   zsteg sample.png                    # 全通道 LSB 扫描
   zsteg -E 'b1,rgb,lsb,xy' sample.png # 指定通道/位平面提取
   ```
   - 通道：RGB/alpha 各通道最低位；位平面：b1/b2（低 2 位）
   - 顺序：行序/位序影响提取结果（见坑 1）
   - 无工具时的脚本路径：python3 按像素遍历提取位序列

3. **其他载体**：
   - 音频：频谱隐写（音频可视化工具查频域图案）、相位/回声隐写
   - 文件冗余区：EXIF、文件头保留区、压缩文件未用空间
   - 多载体组合（题目常用）

4. **提取验证**：
   - magic 检查（提取物头部特征）
   - 可读性验证（strings/file）
   - 隐写前压缩：先解压再提（见坑 3）

## 跨域联合

- [[re-ctf]] 网关：本技能归属
- [[re-fw-extract]]：binwalk 复用
- [[re-patching]]：尾部附加经验衔接
- [[re-triage]]：提取物初勘

## 常见坑与陷阱

- **LSB 顺序**：现象——提取乱码；原因——行序（从上到下/从下到上）/位序（LSB 优先/MSB 优先）；对策——工具自动尝试或脚本枚举组合
- **多载体误判**：现象——一个文件中多个隐写层；原因——嵌套隐写；对策——分层提取，每层验证
- **隐写前压缩**：现象——提取物乱码；原因——明文先压缩再嵌入；对策——先查压缩特征（zlib 头）再解压
- **工具输出噪声**：现象——大量候选；原因——扫描输出含误报；对策——按 magic/可读性过滤
- **载体本身异常**：现象——文件损坏；原因——隐写写入破坏结构；对策——先修复/容忍损坏（按位提取不依赖结构）
