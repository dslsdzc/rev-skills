---
name: re-address-space
type: atomic
description: >
  地址空间换算统一处理：PIE/ASLR 基址确定、RVA/VA 转换、loader offset（固件加载地址 vs 链接地址）、
  跨工具地址对齐（Ghidra/angr/frida/gdb）。
  触发词：PIE、ASLR、基址、RVA、VA、loader offset、地址换算、重定位地址、gdb算地址、angr地址。
capabilities: [address-translation, elf-parser]
---

# 地址空间换算（PIE / ASLR / 基址 / RVA-VA）

## 入口判定（Decision Gate）

```
地址相关问题
├── 静态文件（无运行态）: VA/RVA/文件偏移换算 ──→ 本技能（步骤 1-2）
├── 运行态（进程/内存）: 基址确定（PIE/ASLR）──→ 本技能（步骤 3）+ /proc/pid/maps
├── 跨工具对齐（Ghidra 显示 vs 运行时 vs angr）──→ 本技能（步骤 4）
└── 固件加载地址 vs 链接地址差 ──→ 本技能（步骤 5）
```

## 何时使用 / 何时不用

- 用：任何「这个地址对不上」问题——反编译器显示地址 ≠ 运行时地址 ≠ find 到的地址
- 用：PIE/ASLR 二进制需要换算运行时基址（frida `Module.base` / gdb `info proc mappings` / maps 文件）
- 用：RVA/VA 互转、文件偏移与虚拟地址互转、固件加载地址与链接地址差
- 不用：只是读 ELF 头/节表（走 [[re-format-elf]]）
- 不用：运行时内存布局细查（走 [[re-memdump]] / [[re-gdb]]）

## 工具准备

所有工具先验证再使用。全部为静态/轻量命令，可免沙箱。

### readelf / objdump（binutils）—— 文件侧基址与段信息

- Linux: `apt install binutils` / `dnf install binutils` / `pacman -S binutils`（多数预装）
- 验证: `readelf --version`；`objdump --version`

### gdb —— 运行态基址（跨 OS，见 [[re-gdb]]）

- 安装与验证见 [[re-gdb]] 工具准备

### python3 —— 换算脚本

- 安装与验证见 [[re-python]] 工具准备

## 操作步骤

1. **确定文件侧基址（静态）**：
   ```sh
   readelf -l target | grep LOAD        # 首个 LOAD 段 p_vaddr 即链接基址（ET_EXEC 固定；ET_DYN/PIE 为 0 起相对）
   readelf -h target | grep Type        # EXEC（固定基址）/ DYN（PIE，运行时才定基址）
   ```
   - 链接基址（link-time base）：非 PIE = p_vaddr 首个 LOAD；PIE = 0（所有地址是相对偏移）
   - 文件偏移 ↔ VA：`VA = p_vaddr + (file_offset - p_offset)`（按段匹配，别用全文件线性换算）

2. **RVA / VA 换算**：
   ```
   RVA = VA - ImageBase（PE 语境）
   VA  = RVA + ImageBase
   ```
   - ELF 无统一 ImageBase 概念——用「链接基址 + 段偏移」；PE 用节表（RVA → 文件偏移按节）
   - 32/64 位宽度影响地址表示，不影响换算逻辑

3. **运行态基址（PIE / ASLR）**：
   ```sh
   cat /proc/<pid>/maps | head -5        # 首个 r-xp 映射起点 = 代码段运行时基址（Linux）
   gdb -p <pid> -ex 'info proc mappings' -ex detach   # 或 gdb 侧（跨平台）
   ```
   - frida：`Module.findBaseAddress("libtarget.so")` 或 `Process.getModuleByName(...).base`
   - **运行时地址 = 链接地址 + load bias**——bias = 运行时基址 - 链接基址；PIE 每次运行 bias 不同（ASLR），脚本必须动态取
   - 换算：`runtime_addr = link_addr + bias`（如链接 0x1000 的符号在运行时 `0x1000 + 0x7f0000000000`）

4. **跨工具对齐**：
   - Ghidra：默认按链接基址导入（PIE 程序 Image Base 常为 0）；与运行时地址差 = load bias——`Ghidra 地址 + bias = 运行时地址`
   - angr：`proj.loader.main_object.mapped_base`（rebase 后基址）；`proj.loader.rebase_object(obj, new_base)` 可重定
   - gdb/frida：以运行时基址为准（步骤 3），反编译器地址需加 bias 才能对齐
   - 断点对齐：`gdb b *<链接地址> + <bias>` 或 frida `Module.findExportByName + 偏移`

5. **固件 loader offset**：
   - 固件镜像链接地址 vs 实际加载地址（flash 映射/解压后）差 = loader offset——先读固件头部/启动代码确认加载地址（[[re-fw-extract]] / [[re-arm]] 联动）
   - 换算：`实际地址 = 链接地址 + loader_offset`；不确定时用启动代码里对自身地址的引用反推

## 跨域联合

- [[re-binary-core]]：本技能是其子技能——二进制分析通用底座（地址换算被全域消费）
- [[re-format-elf]] / [[re-format-pe]]：段/节表来源（步骤 1-2 输入）
- [[re-frida]] / [[re-gdb]] / [[re-memdump]]：运行态基址来源（步骤 3）
- [[re-ghidra]] / [[re-angr]]：跨工具地址对齐（步骤 4）
- [[re-fw-extract]] / [[re-arm]]：固件加载地址（步骤 5）
- [[analysis-contract]]：地址换算结论进数据契约（base_addr 字段）

## 常见坑与陷阱

- **PIE 静态基址误用**：现象——把 PIE 的链接基址（0 或 ELF 头值）当运行时地址，断点/查找全落空；原因——ET_DYN 运行时基址由 ASLR 决定；对策——步骤 3 动态取 bias，不静态猜
- **文件偏移当虚拟地址**：现象——`find 0x1234`（文件偏移）后在 Ghidra/运行时找不到对应；原因——混淆偏移与 VA 两套坐标系；对策——按步骤 1 段映射换算，先确认读的是哪套
- **固件链接地址 ≠ 加载地址**：现象——固件里 `file` 报的入口与实际运行入口差一个常数；原因——链接器按 flash/ROM 地址链，运行时解压/重映射到 RAM；对策——步骤 5 反推 loader offset，别硬凑
- **跨工具地址各说各话**：现象——Ghidra 说 0x401000、angr 说 0x400000、frida 说 0x7f...——同一符号三套数；原因——各工具默认基址不同（链接/映射/rebase）；对策——步骤 4 统一到同一坐标系（运行时基址为锚）再比对
