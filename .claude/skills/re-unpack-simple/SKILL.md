---
name: re-unpack-simple
description: 压缩壳脱壳：UPX/ASPack/FSG。触发词：脱壳、unpack、UPX、esp定律、OEP
---

# 脱壳：压缩壳（UPX/ASPack/FSG）

## 何时使用 / 何时不用

- 用：[[re-packer-id]] 识别为简单压缩壳（UPX/ASPack/FSG 等）；壳入口有 `pushad`/`pusha` 特征；需要干净样本继续静态/动态分析
- 用：未知壳手动流程的第一步尝试（ESP 定律对多数压缩壳有效）
- 不用：强壳 / 虚拟化壳（VMProtect/Themida，转 [[re-unpack-advanced]]）
- 不用：目标已确认无壳（直接 [[re-binary-core]]）
- 不用：需要观察带壳行为本身（行为分析有时刻意保留壳，与 [[re-behavior]] 配合时评估）
- 注意：脱壳产物验证必须在沙箱（[[re-sandbox]]，[[platform-tips]] 最高原则）

## 工具准备

### upx（官方解包主力）

- Linux: `apt install upx-ucl` / `dnf install upx` / `pacman -S upx`
- macOS: `brew install upx`
- Windows: 官方 GitHub release `upx/upx` 下载 win64 zip（或 `choco install upx`）
- WSL: Linux 包
- 验证: `upx --version`

### 调试器（按 OS）

- Linux / Wine 下调试 PE: [[re-gdb]] —— `apt install gdb` / `dnf install gdb` / `pacman -S gdb`，验证 `gdb --version`。**Wine 直读**：`wine sample.exe` 运行后 `gdb -p <pid>` attach 直接操作 Wine 进程（见 [[platform-tips]] Linux 分支）
- Windows: [[re-x64dbg]] —— 官方 release zip，验证：载入样本能单步
- macOS: PE 脱壳场景走 Wine + [[re-gdb]] 或 Windows VM，不用本机调试器
- WSL: 无法 attach Windows 进程，跨边界走 Windows 侧工具（[[platform-tips]] WSL 分支）

### Scylla（Windows IAT 修复）

- x64dbg 新版官方 release 已内置（插件目录 plugins/ 下有 Scylla）
- 独立版: GitHub `NtQuery/Scylla` release
- Wine 环境：独立版 Scylla 可 attach 到 Wine 进程做 dump 修复（失败则在 Windows 环境完成 IAT 修复）
- 验证: x64dbg 插件菜单出现 Scylla，能 Attach 到进程并列出模块

## 操作步骤

按顺序执行，每步记录结果（证据路径 + sha256，见 [[re-triage]]）。

1. **优先官方 / 自动解包（`upx -d`）**：
   ```sh
   upx -d sample.exe -o unpacked.exe
   file unpacked.exe     # 应显示正常 PE 结构；仍报 UPX / 报错 → 失败
   sha256sum unpacked.exe
   ```
   `upx -d` 失败常见原因：文件被修改过（自校验 / 二次加壳）、UPX 版本不兼容。失败则走步骤 2 手动流程。

2. **ESP 定律找 OEP**（设断在 pushad 后）：
   - 原理：压缩壳入口 `pushad` 保存寄存器 → 壳解密完毕后 `popad` → `jmp OEP`。**对 pushad 之后的 ESP 所指地址下硬件访问断点**，运行后在 `popad` 后的第一条指令附近找 OEP。
   - x64dbg（Windows）：载入 → 停在 EP → 单步见 `pushad` → 记录当前 ESP 值 → 右键 ESP 寄存器 → Hardware Breakpoint（on access）→ 运行 → 断在 `popad` 后第一条指令 → 下面几行 `jmp` 的目标即 OEP。记下 OEP 地址。
   - gdb（Linux/Wine，见 [[platform-tips]] Wine 直读）：
     ```
     (gdb) starti                    # 停在 EP
     (gdb) x/5i $eip                 # 确认 pushad
     (gdb) hbreak *$esp              # 对 ESP 地址下硬件断点（或 watch）
     (gdb) continue                  # 断在 popad 后，单步找 jmp 到 OEP
     ```
   - OEP 特征：一段函数序言（`push ebp; mov ebp,esp`），其后紧跟大量正常 API 引用。

3. **内存断点法（VirtualAlloc 断点）**：
   - 适用：ESP 定律失效（无 pushad、多 stub）。
   - x64dbg：`bp VirtualAlloc` → 每次返回后看分配区域是否被写入可执行内容（壳的解压目标节）→ 对该区域下内存访问断点（View > Memory Map > 目标节 > Set breakpoint on access）→ 运行到壳完成解密处。也可直接对壳第二节（UPX1/.aspack）下内存断点。
   - gdb（Wine）：`break *VirtualAlloc`，返回后查看分配区，再对分配地址下 watch。

4. **转储 OEP**（时机：解密完成后，见 [[platform-tips]] 关键经验；默认转储优先）：
   - Linux/Wine：运行到 OEP（解密完成）后默认转储 `gcore -o out <pid>`（完整流程见 [[re-memdump]]；转储前按 maps 过滤 vsyscall/vdso）。
   - Windows：x64dbg 运行到 OEP → `Plugins > Scylla > Attach to process` → 填 OEP 地址（步骤 2 记录值）→ `Dump`。先记镜像基址 + OEP 偏移。
   - **别在壳解密完成前 dump**——拿到的是壳的初始状态（见坑 1）。

5. **IAT 修复（Scylla/ImpREC）**：
   - x64dbg: `Plugins > Scylla > Attach to process` → OEP 填步骤 2 的地址 → `IAT Autosearch` → `Get Imports`（核对 API 解析正确）→ `Fix Dump` 输出 `unpacked_fixed.exe`。
   - 替代：ImpREC（Windows，老工具）同样流程：Open Process → IAT AutoSearch → Fix Dump。
   - 修复后验证：`file unpacked_fixed.exe` → 导入 [[re-ghidra]] / [[re-ida]] 反编译确认导入表可解析 → 沙箱内复跑（[[re-sandbox]]）确认行为与脱壳前一致、无自校验触发。

## 跨域联合

- [[re-anti-analysis]]：工作流第 3 步（简单壳分支）固定调用本技能
- [[re-analyze]] 的 triage「样本带壳 / 脱壳」路径调用（re-anti-analysis → re-unpack-simple）
- [[re-malware]]：恶意样本加壳（UPX 等）脱壳后回沙箱复跑再行为分析
- [[re-mobile]] / [[re-apk]]：部分 Android 加固壳可类比本流程思路（具体加固壳按 [[re-frida]] / [[re-memdump]] 内存 DEX 提取）
- [[re-crypto-decrypt]] / [[re-crypto-keys]]：解密 / 密钥在壳内时先脱壳（OEP 后再 dump，见 [[re-memdump]] 转储时机）
- 配套：[[re-memdump]]（默认转储）、[[re-gdb]] / [[re-x64dbg]]（调试器）、[[re-sandbox]]（脱壳产物复跑验证）

## 常见坑与陷阱

- **转储过早 = 壳初始状态**：现象——dump 后 `file` 仍报 UPX、反编译只见压缩数据；原因——壳未运行到 OEP 解密完成就转储；对策——**解密完成后**再 dump（[[platform-tips]] 关键经验），默认转储优先
- **IAT 不修 → 导入表乱**：现象——脱壳样本反编译里全是 `GetProcAddress` 动态调用、导入表解析失败；原因——导入表由壳在运行时重建，转储未修复；对策——步骤 5 Scylla/ImpREC 修复，修复后重新反编译验证
- **自校验（CRC）→ 脱壳后需补丁**：现象——脱壳样本沙箱运行即退出 / 弹校验失败；原因——程序比对自身字节（原壳时是压缩数据，脱壳后对不上）；对策——定位校验代码（xref 自身映像基址 / CRC 计算函数）patch 跳过或 hook，验证在沙箱内做
- **Wine 环境用错调试器**：现象——Windows 调试器在 Wine 下 attach 失败 / 断点不生效；原因——Wine 是 Linux 进程，需 Linux 调试路径；对策——按 [[platform-tips]] Wine 直读：`gdb -p` attach Wine 进程读内存、下断点、`gcore` 转储
