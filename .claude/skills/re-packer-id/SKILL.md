---
name: re-packer-id
description: 壳与混淆器识别：签名/节名/EP/熵。触发词：查壳、加壳识别、packer、壳名、UPX
---

# 壳与混淆器识别

## 何时使用 / 何时不用

- 用：拿到未知样本先确认是否加壳、确定壳名以选择脱壳路径；静态初勘发现熵高 / 节名异常 / 导入表极小（见 [[re-triage]] 输出）需要进一步确认
- 用：动态分析前判断"观察到的行为是壳的还是程序的"
- 不用：目标已是干净样本、直接看逻辑（转 [[re-binary-core]]）
- 不用：已知确切壳名、只差脱壳动作（直接 [[re-unpack-simple]] / [[re-unpack-advanced]]，识别步骤可跳过）
- 注意：**识别不出 ≠ 无壳**（签名库不全 / 小众壳），需用特征组合判断，必要时按未知壳走手动流程

## 工具准备

静态识别可免沙箱（[[platform-tips]] 最高原则：静态分析可免沙箱）；工具先验证再使用。

### Detect It Easy（DIE，跨平台主力）

- Linux: 官方 GitHub release `Horsicq/Detect-It-Easy` 下载 `die_lin64_portable_<ver>.tar.gz` 解压即用（CLI `diec` / GUI `die`）；Debian/Ubuntu 也可 `apt install die`（仓库版较旧，签名库不全时用官方版）
- macOS: `brew install --cask detect-it-easy`
- Windows: 官方 release `die_win64_portable_<ver>.zip` 解压，GUI `die.exe` / CLI `diec.exe`
- 验证: `diec --version`

### PEiD（Windows 老牌，补充 DIE）

- Windows 专用（Wine 下也可运行）：下载 PEiD 0.95（GitHub 镜像），建议配 `PEiD 0.96/0.97` 签名库更新包；DIE 识别不出时用它交叉验证
- 验证: 打开 PEiD 加载样本能显示壳名 / 入口点特征

### file / strings（初步特征）

- Linux: `apt install file binutils` / `dnf install file binutils` / `pacman -S file binutils`
- macOS: Xcode Command Line Tools 自带（`xcode-select --install`）
- Windows/WSL: WSL 内用 Linux 包
- 验证: `file --version`、`strings --version`

### 熵计算（python3 为主，ent/binwalk 可选）

- python3: `apt install python3` / 多数系统自带；验证 `python3 --version`
- ent（可选）: `apt install ent` / `brew install ent`；验证 `ent -h`
- binwalk（可选，熵图）: `apt install binwalk` / `brew install binwalk`；验证 `binwalk -E sample.exe | head`

### pefile（可选，PE 节/EP/导入表脚本）

- 全平台: `pip install pefile`
- 验证: `python3 -c "import pefile"`

## 操作步骤

按顺序执行，每步记录结果（证据路径 + sha256，见 [[re-triage]]）。识别结论（壳名 / 未知壳 / 无壳 + OEP 线索）是脱壳路径的输入。

1. **初步特征收集（file/strings）**：
   ```sh
   file sample.exe
   sha256sum sample.exe
   strings -n 6 sample.exe | head -30
   ```
   加壳样本通常：可读字符串极少、EP 附近有壳签名（UPX 头有 `UPX!` 魔数、ASPack 等节名特征）；干净样本字符串丰富。

2. **签名库扫描（DIE/PEiD）**：
   ```sh
   diec sample.exe          # CLI 扫描；GUI 用 die
   ```
   PEiD（Windows）: 拖入样本，看壳名 / Entrypoint / Section / Overlay 四栏签名。结果三档：**明确壳名**（UPX 0.89~3.xx / ASPack / FSG / VMProtect…）、**可疑特征**（仅入口点或节名命中）、**未识别**。未识别不代表干净（见坑 1）。

3. **节名异常检查**：
   ```sh
   objdump -h sample.exe | head -30
   ```
   特征：`UPX0`/`UPX1`、`.aspack`、`.adata`、`.petite`、全大写自定义节名、节表数量或排列异常。节名可被伪装成 `.text`/`.data`（见坑 2），节名正常仍需结合步骤 4-6。

4. **入口点指向检查（EP 是否非首节）**：
   ```sh
   objdump -f sample.exe     # 看 start address
   python3 - <<'EOF'
   import pefile
   pe = pefile.PE('sample.exe')
   ep = pe.OPTIONAL_HEADER.AddressOfEntryPoint
   for s in pe.sections:
       va, vs = s.VirtualAddress, s.Misc_VirtualSize
       if va <= ep < va + vs:
           print("EP 位于节:", s.Name.rstrip(b'\x00').decode(), hex(va))
   EOF
   ```
   正常 PE 的 EP 指向首节 `.text`；**EP 指向非首节 / 可写节 → 强壳特征**。

5. **熵 > 7 判断**：
   ```sh
   ent sample.exe            # 整文件熵（可选）
   binwalk -E sample.exe | head -20   # 熵分布图，高熵段 = 压缩/加密
   python3 - <<'EOF'
   import math, collections
   d = open('sample.exe','rb').read()
   c = collections.Counter(d); n = len(d)
   h = -sum((v/n) * math.log2(v/n) for v in c.values())
   print(f"entropy = {h:.3f} bits/byte")
   EOF
   ```
   **熵 > 7.0 bits/byte → 可疑加壳/加密**；逐节熵更有意义（壳节高熵、代码节低熵的混合分布也是壳特征）。

6. **导入表极小特征**：
   ```sh
   objdump -p sample.exe | grep -A6 'DLL Name' | head -20
   ```
   正常 PE 导入成百上千 API；加壳 PE 常只导入 `kernel32.dll` 的 `LoadLibraryA`/`GetProcAddress` 等少量 API（其余运行时动态解析）。导入表极小 + 熵高 → 几乎可断定加壳。

7. **先记 OEP 线索（识别阶段就做，别等脱壳时）**：
   ```sh
   objdump -d sample.exe | sed -n '1,20p'    # EP 附近指令
   ```
   简单压缩壳入口常以 `pushad`/`pusha` 开头（ESP 定律前提）；强壳入口常是 `push imm32; mov reg, imm; jmp vm_handler` 形态。**记录入口指令序列与入口地址**，脱壳时直接用作断点与 OEP 判断依据。

## 跨域联合

- [[re-anti-analysis]]：工作流第 1 步（壳识别）固定调用本技能，识别结论决定 unpack-simple / unpack-advanced 分支
- [[re-analyze]] 的 triage「样本带壳 / 脱壳」路径调用（re-anti-analysis → re-packer-id）
- [[re-malware]]：加壳样本先识别壳再决定脱壳路径
- [[re-mobile]] / [[re-apk]]：加固识别后确认壳类别（Android 加固壳）
- [[re-triage]]：熵异常 / 节名可疑时转本技能确认
- [[re-crypto-id]]：壳层常量污染指纹——先识别壳、脱壳后再做常量表指纹
- 识别为强壳 / 未知壳 → [[re-unpack-advanced]]；简单压缩壳 → [[re-unpack-simple]]；无壳 → 转回 [[re-binary-core]]

## 常见坑与陷阱

- **签名库不全 → 漏新壳**：现象——DIE/PEiD 报 "Not found"，但样本熵 7.8、导入表只有 3 个 API；原因——私有 / 小众壳不在签名库；对策——不依赖单一签名，用节名 + EP + 熵 + 导入表四特征组合判断，判定"未知壳"走手动脱壳流程
- **伪装节名**：现象——节名全是 `.text`/`.data` 看不出异常，但熵高、EP 指向第二节；原因——壳故意改名节表；对策——节名只作线索不作依据，交叉验证 EP 位置 + 熵 + 导入表
- **壳套壳**：现象——识别为 UPX 但 `upx -d` 解包后 `file` 仍报壳特征；原因——多层加壳（UPX 里包 Themida 等）；对策——脱一层重识别一层，套层时回到本技能重新跑
- **识别阶段不记 OEP 线索**：现象——脱壳到一半需要"壳入口指令 / EP 地址"时手忙脚乱，断点位置全靠猜；原因——识别时没记录；对策——步骤 7 在识别阶段就记录入口指令（pushad 等）与地址，供 ESP 定律直接使用
