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
- **早期初始化链不止 init_array**：现象——查过 `.init_array` 却仍漏掉更早执行的逻辑（如 `strcmp@GOT` 被 hook 但 main 断点处未复现）；原因——动态链接器初始化早期会先跑 `.preinit_array`（比 .init_array 更早），恶意构造器可在 main 之前覆写 GOT/装钩子；对策——`.preinit_array` 与 `.init_array` 都反汇编，在 `__libc_start_main` 调用 init 处断点，核对 GOT 条目在 main 前是否已被改写
- **伪造节头使 readelf 报错**：现象——`readelf -S`/`-l` 报错或输出中断（e_shentsize 异常、程序头计数离谱、dynamic section 缺失）；原因——混淆/对抗样本伪造头字段使工具解析失败；对策——`xxd` 手工核对 ehdr 关键字段（e_shoff/e_shnum/e_shentsize/e_phnum），按真实值修正后重解析，别当"损坏文件"丢弃
- **fini 不在 main 后立即执行**：现象——在 main 返回处断点找不到"收尾"逻辑；原因——`fini`/`.fini_array` 在退出清理阶段执行（与 rtld_fini、atexit、析构函数一起），不紧跟 main；对策——收尾逻辑在 exit 路径（exit_group / rtld_fini）上断点，别在 main 尾部找

- **R_X86_64_RELATIVE addend 必须与 vaddr 体系自洽**：`*slot = B + addend`（B=加载 bias）。若产物 vaddr = ImageBase + RVA（PE 转换场景），文件槽内存储值即目标 vaddr → **addend = 存储值**；只有"vaddr = 纯 RVA"体系才用 `存储值 − ImageBase`——混用两套公式是终审级 bug（偏差恒定一个 base，且"能 dlopen"不暴露）
- **SHF_ALLOC 节必须被 PT_LOAD 覆盖**：动态区（.dynsym/.dynstr/.hash）标记 SHF_ALLOC 但不在任何段内 → 加载器不映射，符号解析失败——手写 ELF 生成器时给动态区单独 PT_LOAD（p_offset 与 p_vaddr 可解耦）
- **缺 PT_GNU_STACK → dlopen EINVAL**（glibc 对 dlopen 路径直接拒绝，非内核行为；除非启动期设 glibc.rtld.execstack=1）：`cannot enable executable stack`——发射 `PT_GNU_STACK`（PF_R|PF_W、无 X、align 16）
- **重定位目标段必须可写**：GLOB_DAT/RELATIVE 的 r_offset 所在段若只读（PF_R），ld.so 写入即 SIGSEGV——含重定位目标的节强制 PF_W（v1 可放弃 RELRO，后续再上 PT_GNU_RELRO）
- **shstrtab 别用 strlen 取长**：字符串表以 `\0` 开头，strlen 在首字节截断为 1——用显式长度/sizeof；同理会坑 .dynstr 索引
- **filesz > memsz 是 readelf 报错**：`p_memsz = max(vsize, raw_size)` 保证 filesz≤memsz，BSS 清零区语义由 loader 处理
- **gzexe 包裹的 ELF（伪装 .sh）**：现象——目标文件拖进 IDA 报"不是 ELF 格式"，但文件确实是可执行程序；原因——gzexe 把 ELF gzip 压缩后包在 shell 脚本里（Linux 常见压缩方式）；对策——hexdump 看头确认（脚本头 + 尾部压缩数据），`gzexe -d` 解压还原真正的 ELF 再分析
- **OLLVM 混淆 + 字符串加密的 ELF：GOT 出口拦截**：现象——静态补丁不可行（`51642` 类关键串运行时才解密，二进制里找不到）；原因——OLLVM 字符串加密使字符串仅运行时出现在内存；对策——不在数据源头动手，在数据出口拦截：程序最终发送必然经 GOT 调 `sendto`/`send`/`write`/`SSL_write` → hook GOT 槽位，在 `buf` 中搜索 needle 替换后原样调用真函数；先用 debug 模式确认目标串确实出现在发送缓冲区再 patch；**OLLVM 可能混淆 GOT 值本身**（`MOVZ+MOVK×3` 拼出的 64 位常量 `got_addend`）——hook 安装时保持与混淆方式一致（改 `MOVZ+MOVK` 立即数而非直接写地址）
- **code cave 注入 + 哨兵占位（免重编译）**：现象——要注入的 shellcode 地址依赖目标具体布局，每目标重写一次；原因——直接硬编码地址不可复用；对策——shellcode 内所有地址用哨兵值（如 `0xCAFEBABE` 开头）占位，patcher 注入时扫描哨兵替换为实际地址（cave 地址/偏移/原 init 指针均可自动检测）；注入点用 `.init_array`（程序启动自动调用，比 main 早）
