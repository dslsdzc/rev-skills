# ELF 布局：ehdr / phdr / shdr 字段表与典型布局

ELF 文件 = ELF 头（ehdr）+ 程序头表（phdr，供加载器）+ 节区（sections）+ 节头表（shdr，供工具/链接器）。三张表的偏移与条数都在 ehdr 里给出（e_phoff/e_phnum、e_shoff/e_shnum），文件里可以按索引线性遍历。32 位与 64 位字段相同、大小不同（本文件以 64 位为主，32 位差异单独标注）。

## ELF 头（ehdr）

### e_ident 前 16 字节（0x00-0x0F）

| 偏移 | 名称 | 长度 | 典型值 |
|---|---|---|---|
| 0x00 | EI_MAG | 4 | `7F 45 4C 46`（`\x7fELF`），前 4 字节不符即非 ELF |
| 0x04 | EI_CLASS | 1 | 1=ELFCLASS32，2=ELFCLASS64 |
| 0x05 | EI_DATA | 1 | 1=小端，2=大端 |
| 0x06 | EI_VERSION | 1 | 恒 1 |
| 0x07 | EI_OSABI | 1 | 0=System V，3=Linux，9=FreeBSD；固件常见 0（裸机） |
| 0x08 | EI_ABIVERSION | 1 | 0 |
| 0x09-0x0F | 填充 | 7 | 0 |

### 字段表（64 位，总 64 字节；32 位总 52 字节）

| 偏移(64) | 名称 | 类型 | 含义 |
|---|---|---|---|
| 0x10 | e_type | u16 | 1=REL(可重定位 .o) 2=EXEC(固定基址) 3=DYN(PIE/共享库) 4=CORE |
| 0x12 | e_machine | u16 | 62=x86-64 3=i386 40=ARM 183=AArch64 8=MIPS 20=PPC 243=RISC-V |
| 0x14 | e_version | u32 | 1 |
| 0x18 | e_entry | u64 | 入口点（DYN 下为相对基址的偏移） |
| 0x20 | e_phoff | u64 | 程序头表文件偏移 |
| 0x28 | e_shoff | u64 | 节头表文件偏移 |
| 0x30 | e_flags | u32 | 架构相关（如 MIPS 的字节序/ABI 位） |
| 0x34 | e_ehsize | u16 | 64（32 位为 52） |
| 0x36 | e_phentsize | u16 | 56（32 位为 32） |
| 0x38 | e_phnum | u16 | 程序头条数（PN_XNUM=0xffff 时真实值在 .shdr[0].sh_info） |
| 0x3A | e_shentsize | u16 | 64（32 位为 40） |
| 0x3C | e_shnum | u16 | 节头条数（同上 PN_XNUM 溢出处理） |
| 0x3E | e_shstrndx | u16 | 节名表（.shstrtab）在节头表里的索引 |

32 位偏移变化：e_entry=0x18(4B)、e_phoff=0x1C、e_shoff=0x20、e_flags=0x24、e_ehsize=0x28、e_phentsize=0x2A、e_phnum=0x2C、e_shentsize=0x2E、e_shnum=0x30、e_shstrndx=0x32。

## 程序头（phdr）——加载视图

64 位每条 56 字节；32 位 32 字节。

| 偏移(64) | 名称 | 类型 | 含义 |
|---|---|---|---|
| 0x00 | p_type | u32 | 1=PT_LOAD 2=PT_DYNAMIC 3=PT_INTERP 4=PT_NOTE 6=PT_PHDR 7=PT_TLS；GNU 私有：0x6474e550=GNU_EH_FRAME 0x6474e551=GNU_STACK 0x6474e552=GNU_RELRO |
| 0x04 | p_flags | u32 | 1=PF_X 2=PF_W 4=PF_R |
| 0x08 | p_offset | u64 | 段在文件中的偏移 |
| 0x10 | p_vaddr | u64 | 段装载虚拟地址（DYN 为相对基址偏移） |
| 0x18 | p_paddr | u64 | 物理地址（多数平台忽略） |
| 0x20 | p_filesz | u64 | 文件内大小（readelf 要求 ≤ memsz） |
| 0x28 | p_memsz | u64 | 内存大小（> filesz 部分为零填充，如 .bss） |
| 0x30 | p_align | u64 | 对齐（页 0x1000；p_vaddr≡p_offset mod align） |

32 位顺序不同：p_type、p_offset、p_vaddr、p_paddr、p_filesz、p_memsz、p_flags、p_align（p_flags 在第 7 个而不是第 2 个）。

- PT_LOAD：唯一被映射的段类型；可执行文件至少 1 个，通常 2-4 个（R、R X、R W）
- PT_DYNAMIC：指向 .dynamic 段（DT_* 标签数组），动态链接入口
- PT_INTERP：解释器路径字符串（`/lib64/ld-linux-x86-64.so.2`）
- PT_GNU_STACK：无 X 标志 = NX；缺失 = 假定可执行栈
- PT_GNU_RELRO：该范围映射为只读（配合 BIND_NOW 为全 RELRO）

## 节头（shdr）——静态视图

64 位每条 64 字节；32 位 40 字节。

| 偏移(64) | 名称 | 类型 | 含义 |
|---|---|---|---|
| 0x00 | sh_name | u32 | 节名在 .shstrtab 内的偏移（0=无名） |
| 0x04 | sh_type | u32 | 1=PROGBITS 2=SYMTAB 3=STRTAB 4=RELA 5=HASH 6=DYNAMIC 8=NOBITS(.bss) 9=REL 11=DYNSYM 14=INIT_ARRAY 15=FINI_ARRAY；0x6ffffff6=GNU_HASH |
| 0x08 | sh_flags | u64 | 1=SHF_WRITE 2=SHF_ALLOC 4=SHF_EXECINSTR（A 标志 = 需装载进内存） |
| 0x10 | sh_addr | u64 | 装载后的虚拟地址（非 ALLOC 节为 0） |
| 0x18 | sh_offset | u64 | 文件偏移（NOBITS 节无内容） |
| 0x20 | sh_size | u64 | 节大小 |
| 0x28 | sh_link | u32 | 关联节索引（符号节→字符串节；RELA→符号表） |
| 0x2C | sh_info | u32 | 附加信息（RELA：重定位的节索引） |
| 0x30 | sh_addralign | u64 | 对齐 |
| 0x38 | sh_entsize | u64 | 定长条目大小（符号 24、重定位 24、DT_ 16），0=不定长 |

## 常见 section 布局

典型非 PIE x86-64 可执行文件（地址从左到右递增）：

```
文件偏移       节                    内存(vaddr)    属性
0x000000      ELF header (64B)
0x000040      Program headers (e_phnum×56B)
0x0001a8      .interp              0x4001a8      R   （解释器路径）
              .note.gnu.property   .note.ABI-tag
              .gnu.hash            符号哈希（新式查找）
              .dynsym              动态符号表（24 字节/条）  A
              .dynstr              动态符号字符串表          A
              .rela.dyn            重定位（DATA/RELATIVE）  A
              .rela.plt            重定位（JUMP_SLOT）      A
              .text                代码                   AX
              .rodata              只读数据                 A
              .eh_frame_hdr/.eh_frame
              .init_array/.fini_array  构造/析构指针数组     AW
              .dynamic             DT_* 标签数组            AW
              .got/.got.plt        GOT                     AW
              .data                已初始化数据             AW
              .bss                 零初始化（NOBITS）        AW
文件尾        .symtab/.strtab（调试符号，可被 strip）
              .shstrtab            节名表
              Section headers（e_shoff 指向）
```

布局要点：

- 程序头（加载视图）与节头（静态视图）是两套并行的视图：节可以不在任何段里（.comment、.shstrtab），段也可以不覆盖节头表（多数二进制如此）
- 动态区（.dynsym/.dynstr/.gnu.hash/.rela.*/.dynamic/.got）全部带 SHF_ALLOC，因为运行时需要；.symtab/.strtab 不带——被 strip 后只剩动态区
- 惰性绑定二进制有 .plt/.plt.got + .rela.plt；`-z now`（全 RELRO）二进制 GOT 装载时填好，只读
- 现代发行版默认 `-z now` + PIE（e_type=DYN），部分构建无 .plt（GOT 直调）

## 动态链接对象链（符号解析路径）

```
.dynamic (DT_* 标签)
  ├─ DT_SYMTAB → .dynsym（每 24 字节一个 Elf64_Sym: st_name→dynstr 偏移, st_value, st_size, st_info(bind+type), st_shndx）
  ├─ DT_STRTAB/DT_STRSZ → .dynstr（符号名字符串池）
  ├─ DT_GNU_HASH / DT_HASH → 符号查找表（GNU_HASH 新格式：bloom 过滤器 + 桶 + 链；DT_HASH 旧格式仅桶链）
  ├─ DT_JMPREL + DT_PLTRELSZ → .rela.plt（R_X86_64_JUMP_SLOT: GOT 槽 → 实际函数地址）
  ├─ DT_RELA + DT_RELASZ → .rela.dyn（GLOB_DAT/RELATIVE/64）
  └─ DT_INIT_ARRAY/DT_INIT_ARRAYSZ → 构造函数指针数组（main 前执行）
```

- R_X86_64_GLOB_DAT(6)：GOT 槽 = 符号地址；R_X86_64_JUMP_SLOT(7)：PLT/GOT 跳转槽；R_X86_64_RELATIVE(8)：槽 = 基址 + addend
- DT_BIND_NOW（或 DT_FLAGS 含 BIND_NOW）：装载时完成全部重定位，GOT 只读（全 RELRO 前提）

## 实现教训（内化）

- 一切偏移以 e_ident[4]（class）分派：32/64 位结构大小不同，解析器先读 class 再选格式
- e_phnum/e_shnum 有 0xffff 溢出约定（真实值在节 0 的 sh_info）——手写解析器要处理，工具一般已处理
- 大端目标（MIPS 固件常见）解析前按 EI_DATA 换字节序，别默认小端
- readelf 能正常解析 ≠ 结构"正确"：工具解析器有容错，关键结论（GOT 可写性、加载范围）对照 phdr 手工核一遍

## 使用注意

- 静态分析无需沙箱；跨架构目标（ARM/MIPS/RISC-V）用 `readelf -h -l` 不依赖本机架构，反汇编才需要交叉工具
- 与 [[re-imports]]（导入导出/劫持面）、[[re-triage]]（初勘）配合使用
