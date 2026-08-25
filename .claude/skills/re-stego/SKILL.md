---
name: re-stego
type: atomic
description: >
  隐写术检测与提取：文件尾附加、图片 LSB、音频与其他载体、提取验证。
  触发词：隐写、stego、LSB、文件尾附加、隐写提取、图片隐写。
---

# 隐写术检测与提取

## 何时使用 / 何时不用

- 用：隐写怀疑（CTF 题/取证对象）、文件尾异常、图片/音频异常（尺寸/噪声/文件结构不匹配）
- 用：文件结构异常（IEND 后仍有数据/EXIF 段超长/像素数与文件大小不匹配）
- 用：多载体组合（题目/取证场景常见——多文件各藏一部分）
- 用：取证场景未分配空间/文件系统残留扫描（与 [[re-disk-forensics]] 配合）
- 不用：正常文件分析（各归各域技能）；加密数据解密（密文 ≠ 隐写，载荷解密转 [[re-crypto-decrypt]]）；未知文件类型识别（[[re-triage]] 先行）
- 不用：无载体线索的漫无目的扫描（先有怀疑特征再动手，见 [[decision-tree]]）

## 工具准备

### zsteg（图片 LSB 扫描）

- 多平台: `gem install zsteg` 或源码（GitHub）
- 验证: `zsteg -h` 或 `gem list zsteg`
- 覆盖范围：PNG/BMP 支持好，GIF 支持有限——GIF 载体换 python 脚本路径

### steghide（图片/音频隐写）

- Linux: `apt install steghide` / `dnf install steghide`；macOS: `brew install steghide`
- 验证: `steghide --version`；`steghide info file.jpg`（查看是否嵌入数据，无需密码）

### binwalk（尾部扫描）

- 安装与验证见 [[re-fw-extract]] 工具准备

### 其他检测/提取工具

- exiftool（EXIF/元数据）：Linux `apt install libimage-exiftool-perl` / `dnf install perl-Image-ExifTool`；macOS `brew install exiftool`；验证 `exiftool -ver`
- pngcheck（PNG 结构校验/异常）：Linux `apt install pngcheck`；macOS `brew install pngcheck`；验证 `pngcheck -v`
- sox（音频处理/频谱图）：Linux `apt install sox`；macOS `brew install sox`；验证 `sox --version`
- foremost（数据雕刻，取证场景）：`apt install foremost` / `brew install foremost`
- stegsolve（逐位平面查看，Java GUI）：GitHub 下载 jar（`java -jar stegsolve.jar`）
- outguess（JPEG DCT 域，旧工具）：Linux `apt install outguess`
- ffmpeg（音频格式转换，可选）：`apt install ffmpeg` / `brew install ffmpeg`
- python3（位操作/验证脚本 + PIL）：安装见 [[re-python]]；`pip install pillow`；验证 `python3 -c "from PIL import Image"`

## 操作步骤

按顺序执行，每步产物存档（路径 + sha256，见 [[re-triage]]）。

1. **文件尾附加检测**：
   ```sh
   binwalk sample.png | tail -20       # 附加数据扫描
   hexdump -C sample.png | tail -10    # 尾部目检
   ```
   - 尾部附加：文件正常但尾部有多余数据（衔接尾部附加经验（[[re-patching]] 补丁制作思路））
   - 结构核对：`pngcheck -v sample.png` 看 IEND 位置与文件尾差距（差值 ≈ 附加数据量）
   - 弱线索快速扫：`strings -a sample.png | grep -iE 'flag|ctf|http'`
   - 大小核对：与声称内容明显不符（如 3MB 的「小图」）是弱线索
   - 提取：binwalk 自动分割或 dd 按偏移提取（`dd if=sample.png of=tail.bin bs=1 skip=<偏移>`）→ magic 检查（[[re-triage]]）
   - EXIF 查看：`exiftool -a sample.jpg`（全段列出，异常字段/大块注释可疑）
   - 其他文件冗余区：EXIF 元数据（exiftool 查看）、文件头保留区、压缩文件未用空间

2. **图片 LSB**：
   ```sh
   zsteg sample.png                    # 全通道 LSB 扫描
   zsteg -E 'b1,rgb,lsb,xy' sample.png # 指定通道/位平面提取
   ```
   - 通道：RGB/alpha 各通道最低位；位平面：b1/b2（低 2 位）——alpha 通道也常被用于隐藏
   - zsteg 常用参数：`-a` 全通道扫描、`-v` 详细输出、`-E` 指定提取；输出解读：`b1,rgb,lsb,xy` 行 = 该平面提取结果，全 `failed` ≈ 无该平面隐写
   - 顺序：行序/位序影响提取结果（见坑 1；枚举组合见 [[decision-tree]] 提取失败分支）
   - 无工具时的脚本路径：python3 + PIL 按像素遍历提取位序列（`getpixel` 取通道低 bit → 拼位序列 → 转字节；参考 [[gotchas]] 顺序坑）
   - 脚本枚举模板：行序 × 位序 × 通道三重循环，每种组合输出文件并逐一 `file` 检查
   - stegsolve 逐位平面查看（GUI）：多平面图对比，找视觉图案（LSB 图像隐写常见）

3. **其他载体**：
   - 音频：频谱隐写（sox 频谱图：`sox in.wav -n spectrogram -o out.png` 后目检频域图案）、steghide 提取（`steghide extract -sf file.wav`）、相位/回声隐写
   - 音频分支：先看波形/频谱（频域图案呈文本/二维码形状 → 频谱隐写），再按时域（LSB 类，steghide）与频域（相位/回声，需专门工具）区分处理
   - 图片 DCT 域（JPEG）：outguess 类工具（旧工具，对新格式支持有限，见 [[gotchas]]）
   - 文件冗余区：EXIF、文件头保留区、压缩文件未用空间（ZIP 内 CRC/未用空间）
   - 其他载体：文本（空白字符/行距）、网页（注释/隐藏标签）——按场景扩展
   - 多载体组合（题目常用）：各文件分片拼接（按顺序/按特征关联，参考 [[re-triage]] 元数据初勘）

4. **提取验证**：
   - magic 检查（提取物头部特征）
   - 可读性验证（strings/file）
   - 提取物再检测：提取出的文件本身可能再藏（嵌套）——提取物走一遍完整流程；为脚本/压缩包时按对应域继续（[[re-script-deob]] / [[re-python]] 等）
   - 验证产物：提取物 `file` 类型与预期一致才定「确认嵌入」（分级表见 [[decision-tree]]）
   - 隐写前压缩：先提取再解压（提取物查压缩头——zlib `78 9C` / gzip `1F 8B` / bzip2 `42 5A 68`，见坑 3）
   - 加密载荷：无密钥时标注不可提取（不硬破解）；有密钥线索走 [[re-crypto-decrypt]]

## 跨域联合

- [[re-ctf]] 网关：本技能归属
- [[re-fw-extract]]：binwalk 复用
- [[re-patching]]：尾部附加经验衔接
- [[re-triage]]：提取物初勘
- [[re-crypto-decrypt]]：载荷解密衔接
- [[re-disk-forensics]]：未分配空间/文件系统侧隐写（取证场景）

## 常见坑与陷阱

- **LSB 顺序**：现象——提取乱码；原因——行序（从上到下/从下到上）/位序（LSB 优先/MSB 优先）；对策——工具自动尝试或脚本枚举组合
- **多载体误判**：现象——一个文件中多个隐写层；原因——嵌套隐写；对策——分层提取，每层验证
- **隐写前压缩**：现象——提取物乱码；原因——明文先压缩再嵌入；对策——先查压缩特征（zlib/gzip/bzip2 头）再解压
- **工具输出噪声**：现象——大量候选；原因——扫描输出含误报；对策——按 magic/可读性过滤
- **载体本身异常**：现象——文件损坏；原因——隐写写入破坏结构；对策——先修复/容忍损坏（按位提取不依赖结构）
- **JPEG 有损混淆**：现象——LSB 提取出噪声；原因——JPEG 有损压缩覆盖了位平面（LSB 类隐写主要针对 PNG/BMP，JPEG 走 DCT 域）；对策——先判格式（pngcheck）再选方法
- **熵误报**：现象——扫描报「有隐写」但无内容；原因——压缩/随机数据天然高熵；对策——熵特征只作怀疑线索，不单独定性（判定分级见 [[decision-tree]]）
- **steghide 密码**：现象——无密码提取失败；原因——需要口令（CTF 常给提示）；对策——先无密码试，再按提示/密钥线索尝试，无则标注
- **单工具盲区**：现象——zsteg 无结果但有隐写；原因——工具覆盖的通道/算法有限；对策——zsteg + steghide + 脚本多路交叉
- **载体副本差异**：现象——同一文件不同来源扫描结果不同；原因——副本被转码/压缩；对策——用原始载体（哈希核对，见 [[re-triage]]）
- **题目/场景提示被忽略**：现象——扫了图片半天，载荷其实在配套文件里；原因——多载体提示未看；对策——先看提示，按提示分载体
- **压缩层与隐写层混淆**：现象——把压缩数据的随机性当成隐写线索；原因——压缩内容天然高熵；对策——先解压再分析内容（压缩不是隐写）
- **乱码三分支判定**：现象——提取出内容但像乱码；原因——可能是压缩/加密/顺序错，也可能就是随机填充；对策——按压缩头/可读性/统计分布走 [[decision-tree]] 提取失败分支
- 检测/提取分支与证据分级见 [[decision-tree]]；边界与反例见 [[gotchas]]
