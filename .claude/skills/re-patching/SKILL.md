---
name: re-patching
description: 补丁制作：字节级 patch、指令重写。触发词：打补丁、patch、修改跳转、绕过验证、crack
---

# 补丁制作（字节级 patch / 指令重写）

## 何时使用 / 何时不用

- 用：已从 [[re-license]] 定位校验点，需要改字节绕过验证 / 修改行为（解锁功能、跳过校验）
- 用：校验算法不可逆（哈希 / 非对称验签）时替代注册机（见 [[re-keygen]] 坑 1）
- 用：分发场景（补丁文件小、不改动原始文件分发）
- 不用：校验点都还没定位（先 [[re-license]]）
- 不用：需要为正版用户生成合法序列号（算法可逆 → 走 [[re-keygen]] 更优雅，不修改目标）
- 不用：只改内存不落盘（会话级 hook 走 [[re-frida]]；调试器内修改不存档不算补丁）
- 注意：补丁版验证必须在沙箱（[[re-sandbox]]，[[platform-tips]] 最高原则）；修改前备份原文件（见坑 1）

## 工具准备

### 十六进制编辑器

- Linux: `apt install hexedit` / `dnf install hexedit` / `pacman -S hexedit`，验证 `hexedit --version`（交互式按 F2 保存）
- Windows: HxD（官方免费下载，便携版免安装）；或 010 Editor（商业，模板解析强）
- macOS: `brew install hexedit`
- WSL: WSL 内 Linux 版；跨边界文件编辑用 Windows 侧 HxD（[[platform-tips]] WSL 分支）

### 调试器（按 OS，定位 patch 点 / 确认分支方向）

- Linux / Wine 下调试 PE: [[re-gdb]] —— `apt install gdb`，验证 `gdb --version`；**Wine 直读**：`wine sample.exe` 后 `gdb -p <pid>` attach（[[platform-tips]] Linux 分支）
- Windows: [[re-x64dbg]] —— 官方 release zip，验证：载入样本能单步（attach 需管理员权限，[[platform-tips]] Windows 分支）
- macOS: [[re-lldb]]（`brew install lldb`）；Windows 目标走 Wine + gdb 或 VM
- 作用：断点确认成功 / 失败分支的真实走向，避免改错分支（见坑 2）

### rizin（`wx` 写字节，命令行 patch 主力）

- Linux: `apt install rizin` / `dnf install rizin` / `pacman -S rizin`；macOS: `brew install rizin`；Windows/WSL: WSL 内 Linux 包
- 验证: `rizin -v`
- 写字节语法: `wx 90 @ 0x401234`（把 0x401234 处一个字节写成 0x90）、`wx 909090 @ 0x401234`（连写三个）

### 补丁文件工具（导出 diff / patch）

- `radiff2`（rizin 自带，二进制 diff 对比）
- `bsdiff` / `bspatch`：Linux `apt install bsdiff` / macOS `brew install bsdiff`，验证 `bsdiff -h`
- `xdelta3`：Linux `apt install xdelta3`，验证 `xdelta3 -V`
- Windows 侧：`llvm-objdump`（LLVM 套件）对比原始字节段

## 操作步骤

按顺序执行，每步记录结果（原始字节 → 修改字节 → 偏移，证据路径见 [[re-triage]]）。**修改前 `cp sample.exe sample.bak` 并 `sha256sum` 存档**（见坑 1）。

1. **定位 patch 点（失败跳转 → 改 jz / jnz）**：
   - 从 [[re-license]] 的校验点清单拿地址；反编译确认该点的指令形态：**失败跳转**（比较后 `jz fail` / `jnz fail`）是把校验失败当成立即跳走的分支
   - 动态确认方向（沙箱内）：调试器断在该分支，输入错误序列号跑一次，观察跳转与标志位（[[re-gdb]] / [[re-x64dbg]]）——确认"改哪个条件、跳到哪里"才是绕过（见坑 2）
   - 记录：patch 地址、原始字节、目标形态（如 `jz 0x401300` → `nop`）

2. **字节修改（nop / 跳转重写）**：
   - 条件跳转取反：`jz` ↔ `jnz`（x86 短跳 `74` ↔ `75`，近跳 `0F 84` ↔ `0F 85`）；无条件跳转 `EB`（rel8）/ `E9`（rel32）直接落到成功路径
   - 跳过校验：判定处 `nop` 掉（`90`）；或让校验函数直接返回成功：把函数开头的 `push ebp` 改成 `mov eax,1; ret`（`B8 01 00 00 00 C3`，按栈平衡调整）
   - rizin 写模式：
     ```
     rizin -w sample.exe
     [0x00401000]> wx 90 90 @ 0x00401234            # nop 掉两个字节的失败跳转
     [0x00401000]> wx 0f 85 00 00 00 00 @ 0x00401230 # jz(0F84) 改 jnz(0F85)，注意 rel32 需重算
     [0x00401000]> q
     ```
   - hexedit 直接改：`hexedit sample.exe`，Ctrl+S 跳地址 → 改字节 → F2 保存
   - **跳转目标偏移必须重算**：改写条件跳转（尤其 rel8 → rel32）后，目标地址重新编码（见坑 5）
   - 改完立即 `sha256sum sample.exe` 存档中间产物

3. **校验和 / 自校验处理**：
   - 现象：运行补丁版即退出 / 弹"文件已损坏"（见坑 3）
   - 定位：xref 自身镜像基址 / 数据节起始地址的函数，或搜 CRC32 / MD5 计算调用（导入表 `CheckSumMappedFile` 等）；反编译确认比对对象（文件字节 vs 期望值）
   - 处理：patch 自校验函数跳过（同样改判定分支 / `mov eax,1; ret` 提前返回）；或按新字节重算校验值写回
   - 注意：先 patch 自校验、再 patch 目标逻辑，或一次做完后统一修校验——顺序不影响结果，但每步后都要在沙箱复跑确认

4. **补丁导出（二进制 diff / patch 文件）**：
   - 生成 patch：`bsdiff sample.bak sample.exe sample.patch`（分发时 `bspatch sample.exe sample_patched.exe sample.patch`）；或 `xdelta3 -e -s sample.bak sample.exe sample.patch`
   - 记录补丁内容清单（地址 → 原始字节 → 新字节），`radiff2 -D sample.bak sample.exe` 输出逐字节差异供报告引用
   - 跨版本适配：不同版本分别生成 patch，清单标注版本号（见坑 4）

5. **多架构（ARM 改 B 指令等）**：
   - ARM32: 无条件跳转 `B` = `EA`（后接 24 位偏移）；条件分支 `BEQ` = `0A`、`BNE` = `1A`（互改即取反）；`NOP` = `00 00 A0 E1`（条件前缀可调）
   - Thumb: 短跳 `B` 编码 `E000` 起；条件分支取反改 `cond` 高半字节（`D0` EQ ↔ `D1` NE）
   - AArch64: `B` = `0x14000000 | (imm26 << 0)`（±128MB）；`B.EQ` = `0x54000000 | (cond<<12)`（EQ 即 cond=0x0）；`NOP` = `D503201F`
   - 用 [[re-ghidra]] / [[re-radare2]] 反汇编确认目标指令原始编码后再写；修改后重新反汇编验证指令解析正常
   - Android 加固 / so 层校验注意：先脱壳（[[re-anti-analysis]] / [[re-memdump]]）再 patch，patch 的是脱壳产物（见 [[re-mobile]]）

**验证**：`sha256sum` 记录产物 → 沙箱内复跑（[[re-sandbox]]）——补丁版必须通过**全部**校验点（[[re-license]] 清单），且功能行为与原始样本一致；再静态反编译确认 patch 点指令形态正确。

## 跨域联合

- [[re-cracking]]：本网关是 re-cracking 工作流第 4 步（补丁），第 6 步统一验证
- [[re-license]]：上游——patch 点来自它的校验点清单（地址 + 分支方向）
- [[re-keygen]]：互替关系——算法可逆优先 keygen；不可逆或快速绕过用本技能
- [[re-anti-analysis]]：带壳样本先脱壳（OEP 后再定位 patch 点）；自校验/防篡改常与壳叠加
- [[re-binary-core]]：反编译工作台（[[re-ghidra]] / [[re-ida]] / [[re-radare2]] 的 Patch Instruction 亦可直接写）
- 动态：[[re-gdb]] / [[re-x64dbg]] / [[re-lldb]]（确认分支方向）、[[re-frida]]（不落盘的会话级 hook 替代方案）
- [[re-sandbox]]：补丁版复跑验证沙箱（[[platform-tips]] 最高原则）
- [[re-ioc]]：补丁字节特征 / 典型绕过模式可作检测特征

## 常见坑与陷阱

- **改错分支 → 功能异常**：现象——patch 后启动校验过了，但程序崩溃 / 无限弹窗 / 功能错乱；原因——改的不是授权判定（改到业务分支），或条件方向改反（该 nop 的改成跳转）；对策——步骤 1 先动态确认分支真实走向（错误序列号跑一次看跳转），只做最小改动（1-2 字节），改一处验证一处
- **自校验检测修改**：现象——补丁版沙箱运行即退出 / 弹"文件已损坏" / 无限重启；原因——程序比对自身字节（CRC / 文件大小 / 节校验），补丁后对不上；对策——步骤 3 定位自校验函数（xref 镜像基址 / 搜 CRC 调用）patch 跳过或重算校验值；先备份原始字节便于回溯
- **补丁跨版本失效**：现象——同一个补丁在另一版本上无效或破坏程序；原因——版本间偏移变化 / 版本号检测；对策——步骤 4 按版本分别导出 patch 并标注版本；patch 前先确认目标地址字节与预期一致（`xxd` / hexedit 抽查），不一致说明版本不对，不要硬写
- **签名（Authenticode）失效提示**：现象——Windows 运行补丁版弹"无法验证发布者 / 文件已损坏"；原因——补丁破坏代码签名目录；对策——属预期现象：提示可忽略，或删除签名证书表（`llvm-objcopy --remove-section=.rsrc` 处理证书目录，`pesign -d` 删除签名）；签名不可恢复，勿伪造
- **跳转偏移算错 → 跳飞**：现象——patch 后运行即崩 / 反汇编出现 undefined 指令；原因——改写条件跳转（rel8 ↔ rel32）或 `jmp` 时目标偏移没重算（相对偏移 = 目标 − 下一条指令地址）；对策——用 rizin / Ghidra 反汇编验证 patch 点指令解析与跳转目标正确，短距离优先保留 rel8 形态，超范围才用 rel32
