# Mach-O 布局：mach_header / load commands / 段节与 dyld 信息

Mach-O 文件 = mach_header + load commands 区 + 段数据（__TEXT/__DATA/__LINKEDIT）。load commands 同时承载节表、导入导出、入口与签名信息，是 Mach-O 与 ELF 最大的结构差异（ELF 的节头表是独立数组，Mach-O 的"节"嵌在 LC_SEGMENT_64 里）。本文件以 64 位为主，32 位差异单独标注。

## mach_header（文件头）

64 位共 32 字节（32 位 28 字节，无 reserved）：

| 偏移 | 字段 | 大小 | 含义 |
|---|---|---|---|
| 0x00 | magic | u32 | 0xFEEDFACF=MH_MAGIC_64（LE 文件中字节为 cffaedfe）；0xFEEDFACE=32 位；0xCAFEBABE=fat |
| 0x04 | cputype | u32 | 0x01000007=x86_64（7\|CPU_ARCH_ABI64）**0x0100000C=arm64**（12\|CPU_ARCH_ABI64）7=i386 12=arm；**arm64e 的 cputype 与 arm64 相同（都是 0x0100000C），靠 cpusubtype 区分**——不要用 cputype 判 arm64e |
| 0x08 | cpusubtype | u32 | **x86_64：3=`X86_64_ALL`、8=`X86_64_H`（x86_64h，Haswell 特性子集）**；**arm64：0=`ARM64_ALL`、1=`ARM64_V8`、2=`ARM64E`**（arm64e 由这里区分，不是 cputype）；高位是 **capability bit**：`CPU_SUBTYPE_LIB64=0x80000000`，它**改变不了基础 subtype 的含义**（`0x80000003` 仍是 X86_64_ALL 带 64 位库标记，不是 x86_64h）；arm64e 另有 `0x80000000` 作 versioned-ptrauth-ABI 掩码 |
| 0x0C | filetype | u32 | 1=MH_OBJECT 2=MH_EXECUTE 4=MH_CORE 6=MH_DYLIB 8=MH_BUNDLE 9=MH_DYLIB_STUB |
| 0x10 | ncmds | u32 | load commands 条数 |
| 0x14 | sizeofcmds | u32 | load commands 区总字节数（每条 cmdsize 之和） |
| 0x18 | flags | u32 | 按 Apple `loader.h` 的**位值**读，不要手工排成连续编号：`0x1`=NOUNDEFS、`0x2`=INCRLINK、`0x4`=DYLDLINK、`0x8`=BINDATLOAD、`0x10`=PREBOUND、`0x20`=SPLIT_SEGS、**`0x40`=LAZY_INIT（已废弃）**、**`0x80`=TWOLEVEL**、`0x100`=FORCE_FLAT、`0x200`=NOMULTIDEFS、**`0x200000`=PIE**、**`0x800000`=HAS_TLV_DESCRIPTORS（TLS 描述符，现代产物常见）** |
| 0x1C | reserved | u32 | 仅 64 位，恒 0 |

## load commands（LC）通用头

每条 LC 前 8 字节固定：`cmd: u32 + cmdsize: u32`；cmdsize 是整条命令长度（含这 8 字节），按此顺序遍历。

### 常见 LC 类型值

| 值 | 名称 | 含义 |
|---|---|---|
| 0x01 | LC_SEGMENT | 段（32 位） |
| 0x02 | LC_SYMTAB | 符号表（symoff/nsyms/stroff/strsize） |
| 0x05 | LC_UNIXTHREAD | 老入口（寄存器 state 含 rip） |
| 0x0B | LC_DYSYMTAB | 符号表分类（本地/外部/未定义范围索引） |
| 0x0C | LC_LOAD_DYLIB | 依赖动态库 |
| 0x0D | LC_ID_DYLIB | dylib 自身 install name |
| 0x0E | LC_LOAD_DYLINKER | 加载器路径（/usr/lib/dyld） |
| 0x19 | LC_SEGMENT_64 | 段（64 位） |
| 0x1B | LC_UUID | 24 字节 UUID |
| 0x1D | LC_CODE_SIGNATURE | 签名区（dataoff/datasize） |
| 0x22 / 0x80000022 | LC_DYLD_INFO / _ONLY | dyld 四表（新） |
| 0x24 | LC_VERSION_MIN_MACOSX | 最低 macOS 版本（旧式） |
| 0x26 | LC_FUNCTION_STARTS | 函数起始地址压缩表 |
| 0x80000028 | LC_MAIN | 新入口（entryoff/stacksize） |
| 0x29 | LC_DATA_IN_CODE | 代码内数据区表 |
| 0x32 | LC_BUILD_VERSION | 构建版本（platform+版本，新式，替代 LC_VERSION_MIN_*） |
| 0x80000033 | LC_DYLD_EXPORTS_TRIE | 独立导出 trie（新） |
| 0x80000034 | LC_DYLD_CHAINED_FIXUPS | 链式重定位（iOS 13+/macOS 10.15+） |

## LC_SEGMENT_64（段，72 字节；32 位 LC_SEGMENT 56 字节）

| 偏移 | 字段 | 大小 | 含义 |
|---|---|---|---|
| 0x00 | cmd / cmdsize | u32×2 | 0x19 / 72+80×nsects |
| 0x08 | segname | 16 | 段名（__TEXT/__DATA/__LINKEDIT...） |
| 0x18 | vmaddr | u64 | 段装载虚拟地址（__TEXT 通常 0x100000000） |
| 0x20 | vmsize | u64 | 内存大小 |
| 0x28 | fileoff | u64 | 文件偏移 |
| 0x30 | filesize | u64 | 文件内大小 |
| 0x38 | maxprot | u32 | 最大内存权限（7=RWX） |
| 0x3C | initprot | u32 | 初始权限（5=RX 3=RW 1=R） |
| 0x40 | nsects | u32 | 节数 |
| 0x44 | flags | u32 | 0 |

## section_64（节，80 字节，嵌在段内）

| 偏移 | 字段 | 大小 | 含义 |
|---|---|---|---|
| 0x00 | sectname | 16 | 节名（__text/__data/__got...） |
| 0x10 | segname | 16 | 所属段名 |
| 0x20 | addr | u64 | 节起始 VA |
| 0x28 | size | u64 | 节大小 |
| 0x30 | offset | u32 | 文件偏移 |
| 0x34 | align | u32 | 2 的幂（4=16 字节对齐） |
| 0x38 | reloff / nreloc | u32×2 | 重定位区（.o 常用） |
| 0x40 | flags | u32 | 低位=节类型（0x1=REGULAR 0x2=CSTRING_LITERALS 0x6=POINTERS 0x7=LAZY_POINTERS）；高位属性 |
| 0x44 | reserved1 | u32 | 间接符号表索引（__got/__la_symbol_ptr 用） |
| 0x48 | reserved2 | u32 | stub 大小等 |
| 0x4C | reserved3 | u32 | 0 |

## 典型段节布局（64 位可执行文件）

```
__PAGEZERO    vmaddr 0x0000000000000000  vmsize 4GB  （不可访问，空指针崩溃防护）
__TEXT        vmaddr 0x0000000100000000  RX
  __text 代码 / __stubs / __stub_helper / __cstring 字符串
  __unwind_info / __eh_frame
  __swift5_* （Swift 元数据，见 [[re-swift]]）
__DATA        vmaddr 0x100002000         RW
  __got GOT（新产物在 __DATA_CONST） / __la_symbol_ptr / __data / __bss
__DATA_CONST  只读常量（__got、__const；Swift 产物常见）
__LINKEDIT    vmaddr 末尾段             R     （映射只读；链接元数据，shared cache 场景驻留方式不同）
  LC_SYMTAB 符号表 / LC_DYSYMTAB 分类 / 重定位 / 代码签名 / 导出 trie
```

- 加载范围 = __TEXT..__LINKEDIT 覆盖的 vmaddr 区间；__PAGEZERO 不映射
- 入口 VA = __TEXT.vmaddr + LC_MAIN.entryoff（实测示例见 [[examples]]）
- GOT 槽初始化靠 dyld 重定位（bind 表），装载后 __DATA_CONST 段被置只读

## dyld 信息

### LC_DYLD_INFO_ONLY（48 字节；LC_DYLD_INFO 同结构）

| 字段 | 含义 |
|---|---|
| rebase_off / rebase_size | 基址修正表（64 位地址低位写入） |
| bind_off / bind_size | 外部符号绑定表（非惰性，如 __got 槽） |
| weak_bind_off / weak_bind_size | 弱符号绑定 |
| lazy_bind_off / lazy_bind_size | 惰性绑定（__la_symbol_ptr，首次调用才绑） |
| export_off / export_size | 导出符号 trie（前缀树：字节为 key 分叉，节点存符号偏移+标志） |

### 动态解析链

```
LC_LOAD_DYLIB → 依赖库列表（otool -L）
LC_SYMTAB     → 符号表（nlist_64×nsyms + 字符串表）
LC_DYLD_INFO_ONLY → rebase/bind/lazy_bind/export 四表
导出符号定位：export trie 逐字节匹配前缀 → 叶子存 symbol 偏移（相对 trie 所在区域）
绑定信息定位：bind 表的 opcode 流（ADDR/SYMBOL/TYPE 等）→ GOT 槽 ← 符号
```

### nlist_64（符号条目，16 字节；32 位 12 字节）

| 偏移 | 字段 | 大小 | 含义 |
|---|---|---|---|
| 0x00 | n_strx | u32 | 符号名在字符串表内的偏移 |
| 0x04 | n_type | u8 | **拆两层读**：基础类型 = `n_type & N_TYPE(0x0e)`，取值 `0x0=N_UNDF`、`0x2=N_ABS`、**`0xE=N_SECT`**、`0xA=N_INDR`；属性位单独判——`N_EXT(0x01)` 外部、`N_PEXT(0x10)` 私有外部。**不要把组合值当基础类型**：`0x0f` = `N_SECT\|N_EXT`（外部的节定义符号），不是 undefined |
| 0x05 | n_sect | u8 | 所在节序号（1 起） |
| 0x06 | n_desc | u16 | 引用计数/库序号（two-level namespace） |
| 0x08 | n_value | u64 | 地址或值 |

## fat（通用二进制）头

| 字段 | 大小 | 含义 |
|---|---|---|
| magic | u32 | **fat 结构在磁盘上恒为大端**（与宿主字节序无关）：正常 FAT 文件开头**就是字节 `CA FE BA BE`**（大端读得 `FAT_MAGIC=0xcafebabe`）；小端读这 4 字节得 `0xbebafeca`，即 `FAT_CIGAM`——**那是同一份字节被小端解释的结果，不是"小端文件"**。64 位 fat：`FAT_MAGIC_64=0xcafebabf`。**别用宿主的端序去猜文件端序** |
| nfat_arch | u32 | 架构片数 |
| 每条 fat_arch：cputype/cpusubtype/offset/size/align | 各 u32（**同样大端**） | offset 是指向该 slice 的绝对文件偏移；**`align` 是"对齐的 2 的幂"**——slice 必须满足 `2^align` 对齐，而不是固定 4 字节对齐（尤其 64 位 fat 用 `fat_arch_64`，另有 reserved 字段） |

## 版本差异要点

- 入口：老二进制 LC_UNIXTHREAD（0x05），新二进制 LC_MAIN（0x80000028）
- 版本命令：LC_VERSION_MIN_MACOSX（0x24）→ LC_BUILD_VERSION（0x32，多 platform 字段）
- dyld 重定位：LC_DYLD_INFO_ONLY 四表（macOS 10.8+）→ LC_DYLD_CHAINED_FIXUPS 链式（iOS 13+/macOS 10.15+，减小启动开销）
- GOT 位置：__DATA,__got → __DATA_CONST,__got（iOS 13+/macOS 10.14+）
- 导出 trie 可独立成 LC_DYLD_EXPORTS_TRIE（LC_DYLD_INFO 的 export 字段为 0）

## 使用注意

- 静态解析无需沙箱；跨架构 Mach-O（arm64 片）在 x86 Linux 上可用 llvm-objdump/llvm-otool 直接解析，反汇编需交叉工具
- 与 [[re-imports]]（dylib 依赖/劫持面）、[[re-triage]]（初勘）、[[re-lldb]]（动态）配合使用
