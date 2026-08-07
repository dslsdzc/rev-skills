---
name: re-format-elf
description: >
  ELF 格式解析：ehdr/phdr/shdr、GOT/PLT、init_array、符号恢复。
  触发词：ELF、解析so、dynamic section
---

# ELF 格式解析

## 何时使用 / 何时不用

- 用：目标是 Linux ELF 可执行文件或 .so 共享库，需要理解结构、看 .init_array、GOT/PLT 与符号、评估安全属性
- 不用：PE（走 [[re-format-pe]]）、Mach-O（走 [[re-format-macho]]）；裸二进制固件（非标准 ELF，走 [[re-firmware]] 域）
- 不用：只需函数逻辑（直接反编译技能）

## 工具准备

参考 [[platform-tips]]——ELF 目标多为 Linux 本地分析；跨架构（ARM/MIPS 固件 ELF）可用 QEMU 用户态仿真，静态分析无需沙箱。

### readelf（binutils）

- Linux: `apt install binutils` / `dnf install binutils` / `pacman -S binutils`
- macOS: `brew install binutils`（`greadelf`）
- WSL: Linux 版
- 验证: `readelf --version`

### objdump（binutils）

- 同上（macOS 为 `gobjdump`）
- 验证: `objdump -V`

### elfutils（eu-* 工具族）

- Linux: `apt install elfutils` / `dnf install elfutils` / `pacman -S elfutils`
- macOS: `brew install elfutils`（`eu-readelf` 等）
- 验证: `eu-readelf -h /bin/ls`

### patchelf（修改 ELF 头/加载器）

- Linux: `apt install patchelf` / `dnf install patchelf` / `pacman -S patchelf`
- macOS: `brew install patchelf`
- 验证: `patchelf --version`
- 用途: 分析辅助（改 RPATH/解释器）与修复，分析时先只读

## 操作步骤

1. **readelf 三表（ehdr/phdr/shdr）**：
   ```sh
   readelf -h sample        # ELF 头: Class/Machine/Entry/Type
   readelf -l sample        # program headers（段→装载偏移，动态加载与 GNU_STACK 在这里）
   readelf -S sample        # section headers（节→地址/大小/标志）
   ```
   三表对照: `-h` 给入口点，`-l` 给运行时内存布局，`-S` 给静态节视图。

2. **.init_array / .fini_array（main 之前执行）**：
   ```sh
   readelf -S sample | grep -i init_array
   readelf -a sample | grep -A5 -i 'init_array'
   objdump -d -j .init_array sample     # 逐条反汇编回调地址
   ```
   `.init_array` 中的函数指针在 main 之前按序执行——初始化/反调试/解密常藏在这里，必须最先查。

3. **GOT/PLT 与动态符号**：
   ```sh
   objdump -d -j .plt sample            # PLT 桩（外部函数调用入口）
   readelf -r sample | head -40         # 重定位表（含 GOT 条目）
   readelf -s sample | grep FUNC        # 符号表（动态符号在 .dynsym）
   objdump -T sample | grep UND         # 未定义符号 = 导入
   ```

4. **stripped 二进制符号恢复思路**：
   ```sh
   readelf -s sample | wc -l            # 如果只剩 .dynsym（几十个），说明被 strip
   strings -n 6 sample | grep -iE 'error|usage|\.so'   # 错误消息泄露内部函数名
   ```
   恢复流程: 字符串交叉引用（`strings -t x` 取偏移 → 在 Ghidra/radare2 中定位引用）→ 对常见库函数做签名匹配（Ghidra FLIRT / rizin `z` 签名）→ 从 main 入口逆推调用关系。

5. **安全属性检查**：
   ```sh
   readelf -l sample | grep -E 'GNU_STACK|GNU_RELRO'
   # GNU_STACK 无 E 标志 = 不可执行栈（NX）
   # GNU_RELRO 存在 + BIND_NOW = 全 RELRO；GOT 只读
   readelf -s sample | grep -c __stack_chk_fail   # >0 = 有 Canary
   ```
   RELRO/Canary/NX 情况决定后续动态分析（如 GOT 是否可写）与 [[re-imports]] 的劫持面判断。

## 跨域联合

- [[re-binary-core]]：工作流第 3 步，ELF 目标格式解析
- [[re-mobile]]：Android 原生 .so 库（分析 App 前先走本技能）
- [[re-firmware]]：嵌入式 Linux 固件中的 ELF 组件
- [[re-ctf]]：pwn/逆向题常见 ELF 目标
- 发现壳/混淆时转 [[re-anti-analysis]]

## 常见坑与陷阱

- **init_array 藏初始化/反调试**：比 main 更早执行，只看 main 会漏掉预置逻辑
- **stripped 后符号只剩 dynsym**：`readelf -s` 列表骤减，恢复靠字符串交叉引用 + 签名匹配，别期待完整符号
- **GOT 覆盖是常见攻击点**：非全 RELRO 时 GOT 可写——逆向/利用分析都要确认 `GNU_RELRO` 与 `BIND_NOW`
- 检查跨架构 ELF（ARM/MIPS）时本机 objdump 报 "unknown format" → 用对应交叉工具或 QEMU 仿真（见 [[platform-tips]] Linux 分支）
