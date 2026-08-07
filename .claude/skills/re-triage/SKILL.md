---
name: re-triage
description: >
  文件初步勘察：file/哈希(sha256/md5)/熵/strings/架构识别。
  触发词：先看看这文件、triage、初勘、这是什么文件、hash
---

# 文件初步勘察（triage）

## 何时使用 / 何时不用

- 用：刚拿到未知样本的第一步；判断文件真实类型与架构；任何分析开始前的哈希存证；熵值评估是否加壳/加密
- 不用：已确定文件类型、只需深挖结构（直接走对应格式技能 [[re-format-pe]] / [[re-format-elf]] / [[re-format-macho]]）；只需函数逻辑（走反编译技能）
- 不用：样本已确认带壳、目标直接是脱壳（走 [[re-anti-analysis]] 域）

## 工具准备

所有工具先验证再使用。参考 [[platform-tips]] 最高原则（静态分析可免沙箱，但涉及运行一律沙箱）。

### file —— 文件类型判定

- Linux: `apt install file` / `dnf install file` / `pacman -S file`（多数发行版自带）
- macOS: `brew install file`（自带 /usr/bin/file）
- Windows/WSL: WSL 内用 Linux 版；Windows 本机用 Git for Windows 自带 file 或第三方版
- 验证: `file --version`

### sha256sum / md5sum —— 哈希存证

- Linux: coreutils 自带（无则 `apt install coreutils` / `dnf install coreutils` / `pacman -S coreutils`）
- macOS: 自带，用 `shasum -a 256` 或 `md5`
- Windows/WSL: WSL 内 Linux 版；Windows 本机 PowerShell: `Get-FileHash -Algorithm SHA256`
- 验证: `sha256sum --version`

### strings —— 关键字符串提取

- Linux: binutils 自带（`apt install binutils` / `dnf install binutils` / `pacman -S binutils`）
- macOS: `brew install binutils`（命令带 `g-` 前缀，如 `gstrings`）或 `llvm-objdump --strings`
- Windows: Sysinternals `strings64.exe`（choco: `choco install sysinternals`），或 WSL 内 Linux 版
- 验证: `strings --version`（Linux）/ `gstrings --version`（macOS brew）

### objdump / readelf —— 架构与头信息确认

- Linux: `apt install binutils` / `dnf install binutils` / `pacman -S binutils`
- macOS: `brew install binutils`（`gobjdump`）或 `brew install llvm`（`llvm-objdump`）
- WSL: Linux 版直接可用
- 验证: `objdump -V` / `readelf --version`

### xxd —— 十六进制查看

- Linux: `apt install xxd` / `dnf install vim-common` / `pacman -S xxd`
- macOS: `brew install xxd`
- WSL: Linux 版
- 验证: `xxd -v`

### ent / python —— 熵计算

- `ent`: `apt install ent`（Debian/Ubuntu）；dnf/pacman 无官方包 → 用 python 方案
- python（跨平台兜底，推荐）: `pip install --user` 无需依赖，直接写脚本或一行命令：
  ```sh
  python3 - <<'EOF'
  import math, collections
  data = open('sample.bin', 'rb').read()
  c = collections.Counter(data); n = len(data)
  e = -sum((v/n) * math.log2(v/n) for v in c.values())
  print(f"entropy={e:.3f} bits/byte ({len(data)} bytes)")
  EOF
  ```
- 验证: 对 `/dev/zero` 输出熵 ≈ 0.000，对随机文件 ≈ 7.9+

## 操作步骤

按顺序执行，每步记下结果。

1. **file 判定格式**：
   ```sh
   file sample.bin
   ```
   记录 Magic、格式（PE32/PE32+、ELF 32/64-bit LSB、Mach-O arm64…）、架构。file 结论不可尽信——魔数可伪造，随后用 objdump 交叉验证：
   ```sh
   objdump -f sample.bin   # 打印头信息与架构
   ```
   ELF 类可加 `readelf -h sample.bin` 看 Machine 字段。

2. **哈希存证（先做再动文件）**：
   ```sh
   sha256sum sample.bin > sample.sha256
   md5sum sample.bin
   ```
   输出保存为 `sample.sha256`，写入分析笔记。之后对文件的任何修改（patch/脱壳产物）都要能与原始哈希对照。

3. **strings 提取关键串**：
   ```sh
   strings -n 6 sample.bin | head -100
   ```
   - 找：可读文件名/URL/路径、`flag`/`key`/`secret`、错误消息（泄露内部函数名）、Go/Rust 运行时特征（`runtime.main`、`_ZN...`）
   - 中文环境：默认 `strings` 只取 ASCII；UTF-16 串用 `strings -e l sample.bin`（little-endian 16 位）；GBK 中文串先 `xxd sample.bin | head` 目测编码再决定
   - 输出巨大时先 `-n 6` 过滤短串，再配合 `grep -iE 'http|flag|key|secret|dll|\.so'`

4. **熵评估**：
   ```sh
   ent sample.bin
   # 或 python 一行脚本（见工具准备）
   ```
   - 熵 > 7.0 bits/byte：可疑加壳/加密/压缩 → 下一步按 [[re-anti-analysis]] 路径处理
   - 熵 4.5-7.0：混合内容，正常可执行文件常见区间，继续
   - 熵 < 4.5：多为明文数据/未压缩代码
   - 分节评估更准：用 `objdump -h` 或 pefile 按节算熵（壳的特征是某些节熵极高）

5. **决定下一步**：
   - 正常格式 + 熵正常 → [[re-format-pe]] / [[re-format-elf]] / [[re-format-macho]]（按类型）
   - 熵异常 / 节名可疑（UPX0/.aspack）→ 转 [[re-anti-analysis]] 先确认壳
   - 目标是动态行为 → 沙箱内 [[re-tracing]] + [[re-gdb]]（见 [[platform-tips]] 最高原则）

## 跨域联合

- [[re-binary-core]]：工作流第 2 步固定调用本技能
- [[re-malware]] / [[re-firmware]] / [[re-mobile]] / [[re-ctf]]：各网关接手样本的第一步都是初勘
- 本技能结论（RE_TRIAGE 结果）决定后续格式技能选择，是全部动态分析前的强制前置

## 常见坑与陷阱

- **熵高 ≠ 必然加壳**：压缩数据（UPX 壳内压缩段、zlib 资源段）熵同样 >7，需结合节名与导入表判断，不要单凭熵值定性
- **strings 中文环境编码**：中文串常为 GBK 或 UTF-16LE，默认 `strings` 输出乱码/丢失——按 `-e` 参数指定编码，必要时 `xxd` 目测
- **hash 先做再动文件**：任何分析前先 sha256 存证；动态执行会污染样本文件，没有原始哈希就无法对照
- 大文件 strings 全量输出可达数百 MB → 先 `-n` 设最小长度并 `head` 截断
- **工具报错 ≠ 文件损坏**：现象——`file`/`readelf`/`objdump` 对样本报错或输出中断；原因——对抗样本伪造头字段（节头大小异常、程序头计数离谱、缺失 dynamic section）使解析器失败，并非文件真的损坏；对策——先用 `xxd` 手工核对关键头字段（e_lfanew / e_shoff / e_shnum / e_shentsize），按真实值手工修复后再解析，别把样本当垃圾丢弃
