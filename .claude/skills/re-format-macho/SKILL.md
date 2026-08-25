---
name: re-format-macho
description: >
  Mach-O 格式解析：mach_header、LC_*、segment、dyld 信息。
  触发词：Mach-O、解析mac程序、dyld
---

# Mach-O 格式解析

## 何时使用 / 何时不用

- 用：目标是 macOS/iOS 的 Mach-O 二进制（可执行文件/.dylib/.bundle/Framework），需要理解结构、load commands、入口、代码签名、动态库依赖链
- 用：检查 dylib 注入（LC_LOAD_DYLIB 异常条目）、签名/公证状态、通用二进制多架构片
- 不用：PE（走 [[re-format-pe]]）、ELF（走 [[re-format-elf]]）
- 不用：只需函数逻辑（直接反编译技能）；iOS 越狱环境问题属 [[re-mobile]] 域

## 工具准备

参考 [[platform-tips]] macOS 分支——attach/调试受 SIP 与 TCC 限制；静态解析不受影响。

### otool（Apple 自带）

- macOS: Xcode Command Line Tools: `xcode-select --install`
- 验证: `otool --version`
- Linux 替代: `llvm-otool`（`apt install llvm` / `brew install llvm` / `pacman -S llvm`），功能覆盖 otool 常用子命令

### llvm-objdump（跨平台）

- macOS: `brew install llvm`；Linux: `apt install llvm` / `dnf install llvm` / `pacman -S llvm`
- 验证: `llvm-objdump --version`
- 用法: `llvm-objdump --macho --private-headers sample`（Linux 上可直接解析 Mach-O，与 macOS 输出一致）

### jtool2（深入 Mach-O 结构，macOS）

- macOS: 从 GitHub（intezer/jtool2）clone 后 `make`，或下载 release 二进制
- 验证: `jtool2 -h sample` 输出 load commands

### codesign / lipo（macOS 自带）

- 验证: `codesign --version`；`lipo -info sample`
- Linux 替代: `llvm-lipo -info sample`（llvm 自带）

### dyld_shared_cache_util（macOS）

- 系统自带（`/usr/bin/dyld_shared_cache_util`）；用途: 解析 dyld 共享缓存中的系统 dylib 时把单个库抽出来

## 操作步骤

1. **初勘（先确认类型与架构）**：
   ```sh
   file sample                  # 可执行文件 / dylib / 通用二进制 / 字节序
   lipo -info sample            # 通用二进制列出各架构片；单架构提示 "non-fat file"
   xxd -l 16 sample             # 魔数: cffaedfe=64位小端, feedfacf=64位大端, cebafaed=32位小端, cafebabe=fat
   ```
   魔数（文件里看到的字节）：`cffa edfe`（MH_MAGIC_64）、`cefa edfe`（MH_MAGIC 32 位）、`cafe babe`（FAT，后跟 4 字节架构数）。通用二进制先 `lipo -thin <arch> -output piece sample` 提取单片再解析。

2. **mach_header 与 load commands（核心）**：
   ```sh
   otool -h sample                 # magic/cputype/filetype/ncmds/flag 一行全出
   otool -l sample | head -80      # 全部 load commands
   ```
   64 位 mach_header 固定 32 字节（32 位为 28 字节）：magic(4) + cputype(4) + cpusubtype(4) + filetype(4) + ncmds(4) + sizeofcmds(4) + flags(4) + reserved(4，仅 64 位)。load commands 是 Mach-O 的"节表+导入表+入口+签名"综合体——从头到尾按 `cmdsize` 顺序遍历，`ncmds` 计数、`sizeofcmds` 为总字节数，两者互相校验。filetype: 2=MH_EXECUTE 6=MH_DYLIB 8=MH_BUNDLE。常见 LC 值与字段表见 [[layout]]。

3. **段与节（__TEXT/__DATA/__LINKEDIT）**：
   ```sh
   otool -l sample | grep -A8 'segname __TEXT'
   otool -l sample | grep -A8 'segname __DATA'
   llvm-objdump --macho --section-headers sample
   ```
   记录各段 vmaddr/vmsize/fileoff；`__TEXT,__text` 是代码，`__DATA,__data` 是可写数据，GOT 在 `__DATA_CONST,__got`（只读常量段；旧二进制在 `__DATA,__got`）；`__LINKEDIT` 无映射内容，只放符号/签名等元数据。

4. **入口（LC_MAIN / LC_UNIXTHREAD）**：
   ```sh
   otool -l sample | grep -A6 LC_MAIN
   ```
   `entryoff` 是入口相对文件头的偏移，入口 VA = __TEXT 段 vmaddr + entryoff（64 位下 __TEXT 基址通常 0x100000000）。老二进制用 LC_UNIXTHREAD（寄存器 state 含入口）。可执行文件无 LC_MAIN 且无 LC_UNIXTHREAD 属畸形，重点排查。

5. **dyld 信息（LC_DYLD_INFO_ONLY / 导出 trie）**：
   ```sh
   otool -l sample | grep -A9 LC_DYLD_INFO_ONLY
   llvm-objdump --macho --exports-trie sample   # 导出符号（trie 解码）
   ```
   rebase（基址修正点）、bind/lazy_bind（外部符号绑定）、export（导出 trie）四张表的 offset+size 都在 LC_DYLD_INFO_ONLY（48 字节）里；新版二进制用 LC_DYLD_CHAINED_FIXUPS（链式修正，iOS 13+ 默认）。dylib 的导出符号在 trie 里，`nm -gU` 同效果。

6. **动态库依赖链（注入检测）**：
   ```sh
   otool -L sample                 # LC_LOAD_DYLIB 列表（依赖库 + install name）
   otool -l sample | grep -A4 LC_LOAD_DYLIB
   ```
   每个 LC_LOAD_DYLIB：name（绝对路径或 @rpath/@executable_path 相对）+ timestamp/current_version。**恶意 dylib 持久化 = 新增 LC_LOAD_DYLIB 条目**——与签名时列表比对不一致是重要告警（详见坑）。two-level namespace 下符号查找按 (库, 符号) 二元组，导入解析严格。

7. **符号表（nlist_64）**：
   ```sh
   llvm-nm -m sample                # 含段归属与 N_EXT 标记；undefined = 导入
   llvm-nm -gU sample               # 仅外部定义符号（导出）
   otool -l sample | grep -A3 LC_SYMTAB   # symoff/nsyms/stroff/strsize 定位表
   ```
   nlist_64 每条 16 字节：n_strx（字符串表偏移）+ n_type（N_EXT/N_SECT 等）+ n_sect + n_desc + n_value。stripped 后 `.symtab` 消失，只剩 LC_DYLD_INFO 的导出 trie 与动态绑定信息——恢复思路同 ELF（[[re-imports]] 签名匹配 + 字符串交叉引用）。

8. **代码签名检查**：
   ```sh
   codesign -dv sample 2>&1          # 签名类型（adhoc / Apple Development / not signed）
   codesign --verify --deep sample   # 完整性验证
   jtool2 --sig sample | head -20    # LC_CODE_SIGNATURE 细节（CodeDirectory/哈希）
   ```
   - `adhoc`：自签，可被修改后重签（`codesign -f -s - sample`）
   - Apple 签名：修改任何字节都会失效；Library Validation 开启时注入 dylib 会失败
   - 无 LC_CODE_SIGNATURE = 未签名（iOS 上无法直接运行）

9. **手工解析与验证**：load command 输出异常/头字段被伪造时，用 `xxd` + Python `struct` 按偏移直接解析 mach_header 与各 LC（最小可运行示例与字节样例见 [[examples]]），别把解析失败当"损坏文件"丢弃。

## 跨域联合

- [[re-binary-core]]：工作流第 3 步，Mach-O 目标格式解析
- [[re-mobile]]：iOS App/越狱环境分析的前置（arm64 Mach-O 主二进制与 dylib）
- [[re-ios]] / [[re-macos]]：生态衔接（App 层、签名公证、TCC/SIP 限制）
- [[re-cracking]]：macOS 破解类任务（补丁后重签流程见本技能步骤 8）
- [[re-imports]]：dylib 依赖与导出符号的劫持面分析
- 动态调试配合 [[re-lldb]]（SIP/TCC 限制见 [[platform-tips]]）

## 常见坑与陷阱

- **签名验证会拦调试/注入**：修改过的二进制 codesign 校验失败无法运行——先 `codesign -f -s -` 重签（仅限自签/adhoc 场景）；Library Validation 开启时 `DYLD_INSERT_LIBRARIES` 失效
- **iOS 上需越狱环境**：真机调试要开发者证书或越狱，模拟器进程受沙盒限制——静态解析可先行，动态部分交给 [[re-mobile]]
- **LC_LOAD_DYLIB 注入检测**：恶意 dylib 通过新增 LC_LOAD_DYLIB 实现持久化——`otool -L` 列表与签名时列表不一致是重要告警
- **通用二进制含多架构片**：先 `lipo -info` 确认架构再 `lipo -thin` 提取，别对全片解析；fat 头里各片 offset 是绝对文件偏移，按 (offset, size) 切出单片
- **GOT 位置随版本迁移**：新产物 GOT 在 `__DATA_CONST,__got`（只读，装载后重定位一次）；旧产物在 `__DATA,__got`（可写）——找 GOT 先 `otool -l` 看段名，别假设
- **dyld 共享缓存里没有独立 dylib 文件**：系统库（libSystem.dylib 等）实际在 `/System/Library/dyld/` 缓存内，文件系统里只有 stub——分析系统库用 `dyld_shared_cache_util -extract` 抽出
- **load command 遍历错位**：现象——`otool -l` 输出中途乱码/报错；原因——ncmds 与 sizeofcmds 被伪造或某条 LC 的 cmdsize 异常；对策——按 32/64 位结构体逐条校验 cmdsize（64 位下 LC 最小 16 字节），从 sizeofcmds 总量反推合法性
- **__LINKEDIT 内容不是映射数据**：符号表/签名/重定位偏移在 __LINKEDIT 的文件范围内，但没有运行时可访问的映射内容——在内存里找不到符号表是正常的
