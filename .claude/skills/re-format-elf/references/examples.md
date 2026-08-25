# ELF 最小解析示例

以下示例以本机 `/bin/ls`（x86-64 PIE）为标本，readelf 输出与 Python/字节样例可逐字段对照（不同发行版构建参数有差异，以样本自身输出为准）。结构定义见 [[layout]]。

## 1. readelf 输出对照

### `readelf -h /bin/ls`（ELF 头）

```
ELF Header:
  Magic:   7f 45 4c 46 02 01 01 00 00 00 00 00 00 00 00 00
  Class:                             ELF64
  Data:                              2's complement, little endian
  Version:                           1 (current)
  OS/ABI:                            UNIX - System V
  Type:                              DYN (Position-Independent Executable file)
  Machine:                           Advanced Micro Devices X86-64
  Entry point address:               0x5540
  Start of program headers:          64 (bytes into file)
  Start of section headers:          164784 (bytes into file)
  Size of this header:               64 (bytes)
  Size of program headers:           56 (bytes)
  Number of program headers:         15
  Size of section headers:           64 (bytes)
  Number of section headers:         29
  Section header string table index: 28
```

对照要点：magic 第 5 字节 `02` = ELF64、第 6 字节 `01` = 小端；e_type=DYN 说明是 PIE（Address 全为相对基址偏移）；e_phoff=64、e_phentsize=56、e_phnum=15 → 程序头表占文件 `64..64+15*56`。

### `readelf -l /bin/ls`（程序头，节选）

```
Program Headers:
  Type           Offset             VirtAddr           PhysAddr
                 FileSiz            MemSiz              Flags  Align
  PHDR           0x0000000000000040 0x0000000000000040 ...
                 0x0000000000000348 0x0000000000000348  R      0x8
  INTERP         0x00000000000003ac 0x00000000000003ac ...
                 0x000000000000001c 0x000000000000001c  R      0x1
      [Requesting program interpreter: /lib64/ld-linux-x86-64.so.2]
  LOAD           0x0000000000000000 0x0000000000000000 ...
                 0x00000000000024a0 0x00000000000024a0  R      0x1000
  LOAD           0x0000000000003000 0x0000000000003000 ...
                 0x0000000000019ba1 0x0000000000019ba1  R E    0x1000
  LOAD           0x000000000001d000 0x000000000001d000 ...
                 0x0000000000008e00 0x0000000000008e00  R      0x1000
  LOAD           0x0000000000026d10 0x0000000000026d10 ...
                 0x0000000000001550 0x0000000000002868  RW     0x1000
  DYNAMIC        0x0000000000027a58 0x0000000000027a58 ...
                 0x00000000000001f0 0x00000000000001f0  RW     0x8
  GNU_STACK      0x0000000000000000 0x0000000000000000 ...
                 0x0000000000000000 0x0000000000000000  RW     0x10
  GNU_RELRO      0x0000000000026d10 0x0000000000026d10 ...
                 0x00000000000012f0 0x00000000000012f0  R      0x1
```

对照要点：4 个 PT_LOAD 按 R / R E / R / RW 权限分段（页对齐 0x1000）；最后一个 LOAD 的 `FileSiz 0x1550 < MemSiz 0x2868`——差值即 .bss 零填充区；GNU_STACK 无 X = NX；GNU_RELRO 存在 + 后面 `readelf -d` 的 BIND_NOW = 全 RELRO（GOT 只读）。

### `readelf -S /bin/ls`（节头，节选）

```
  [ 2] .interp           PROGBITS         00000000000003ac  000003ac
  [ 3] .gnu.hash         GNU_HASH         00000000000003c8  000003c8
  [ 4] .dynsym           DYNSYM           0000000000000468  00000468
  [ 5] .dynstr           STRTAB           00000000000010c8  000010c8
  [ 8] .rela.dyn         RELA             00000000000018d8  000018d8
  [11] .text             PROGBITS         0000000000003040  00003040
  [13] .rodata           PROGBITS         000000000001d000  0001d000
  [19] .init_array       INIT_ARRAY       0000000000026d10  00026d10
  [20] .fini_array       FINI_ARRAY       0000000000026d18  00026d18
  [22] .dynamic          DYNAMIC          0000000000027a58  00027a58
  [23] .got              PROGBITS         0000000000027c48  00027c48
  [24] .data             PROGBITS         0000000000028000  00028000
  [25] .bss              NOBITS           0000000000028260  00028260
```

对照要点：`.dynsym`（节 4）与 `.dynstr`（节 5）的 sh_link 关系可从 `readelf -S` 完整输出的 Link 列看到；本机构建为 BIND_NOW，节表无 .plt/.rela.plt（惰性绑定二进制才有，见 [[layout]]）；.init_array 与 .fini_array 都在数据段（RW），构造函数指针数组。

### `readelf -d /bin/ls`（dynamic section，节选）

```
Dynamic section at offset 0x27a58 contains 26 entries:
  Tag        Type                         Name/Value
 0x0000000000000001 (NEEDED)             Shared library: [libcap.so.2]
 0x0000000000000001 (NEEDED)             Shared library: [libc.so.6]
 0x000000000000000c (INIT)               0x3000
 0x0000000000000019 (INIT_ARRAY)         0x26d10
 0x000000000000001b (INIT_ARRAYSZ)       8 (bytes)
 0x000000006ffffef5 (GNU_HASH)           0x3c8
 0x0000000000000005 (STRTAB)             0x10c8
 0x0000000000000006 (SYMTAB)             0x468
 0x000000000000000b (SYMENT)             24 (bytes)
 0x0000000000000007 (RELA)               0x18d8
 0x000000000000001e (FLAGS)              BIND_NOW
```

对照要点：NEEDED 给依赖链（libc.so.6 等）；STRTAB/SYMTAB/SYMENT(24) 定位动态符号表；GNU_HASH 是新式符号查找；FLAGS=BIND_NOW 说明无惰性绑定。

## 2. Python struct 解析 ehdr（最小可运行）

```python
import struct

def parse_ehdr(path):
    data = open(path, 'rb').read(64)
    if data[:4] != b'\x7fELF':
        raise ValueError('not an ELF')
    cls = data[4]                      # 1=ELF32 2=ELF64
    endian = '<' if data[5] == 1 else '>'   # 1=LE 2=BE
    if cls == 2:                       # ELF64: 16sHHIQQQIHHHHHH
        fmt = endian + '16sHHIQQQIHHHHHH'
        f = struct.unpack_from(fmt, data, 0)
        return dict(e_type=f[1], e_machine=f[2], e_entry=f[4],
                    e_phoff=f[5], e_shoff=f[6], e_ehsize=f[8],
                    e_phentsize=f[9], e_phnum=f[10],
                    e_shentsize=f[11], e_shnum=f[12], e_shstrndx=f[13])
    else:                              # ELF32: 16sHHIIIIIHHHHHH
        fmt = endian + '16sHHIIIIIHHHHHH'
        f = struct.unpack_from(fmt, data, 0)
        return dict(e_type=f[1], e_machine=f[2], e_entry=f[4],
                    e_phoff=f[5], e_shoff=f[6], e_ehsize=f[8],
                    e_phentsize=f[9], e_phnum=f[10],
                    e_shentsize=f[11], e_shnum=f[12], e_shstrndx=f[13])

print(parse_ehdr('/bin/ls'))
# {'e_type': 3, 'e_machine': 62, 'e_entry': 21824(0x5540), 'e_phoff': 64,
#  'e_shoff': 164784, 'e_ehsize': 64, 'e_phentsize': 56, 'e_phnum': 15,
#  'e_shentsize': 64, 'e_shnum': 29, 'e_shstrndx': 28}  —— 与 readelf -h 逐字段一致
```

按 ehdr 给的 e_phoff/e_phentsize/e_phnum 可同样解析 phdr：`struct.unpack_from('<IIQQQQQQ', data, e_phoff + i*56)`；shdr 同理 `'<IIQQQQIIQQ'`。注意先按 e_ident 判 class 与字节序再选格式（[[layout]] 字段表）。

## 3. 字节样例（/bin/ls 前 64 字节，逐字段标注）

```
00000000: 7f45 4c46 0201 0100 0000 0000 0000 0000  .ELF............
         magic──┘ ┆┆┆  └┬┘  └┬┘  └── e_ident 填充 7 字节
         class=02(ELF64) data=01(LE) ver=01 osabi=00(SystemV)
00000010: 0300 3e00 0100 0000 4055 0000 0000 0000  ..>.....@U......
         e_type=03(DYN)─┘  └e_machine=003e(62)   e_version=1
                                     e_entry=0x5540──────────┘
00000020: 4000 0000 0000 0000 b083 0200 0000 0000  @...............
         e_phoff=0x40───────────────────┘ e_shoff=0x283b0──────┘
00000030: 0000 0000 4000 3800 0f00 4000 1d00 1c00  ....@.8...@.....
         e_flags=0 e_ehsize=64(0x40) e_phentsize=56(0x38)
                   e_phnum=15(0x0f) e_shentsize=64(0x40)
                   e_shnum=29(0x1d) e_shstrndx=28(0x1c)
```

手工核对流程：`xxd -l 64 /bin/ls` 与 readelf -h 输出对照；魔数不符先查是不是 gzexe 包裹/自解压壳（见 SKILL.md 坑）；伪造头字段时按真实值修正后重解析（见 SKILL.md 坑）。

## 实现教训（内化）

- 所有解析先读 e_ident[4]（class）与 e_ident[5]（字节序），再选 struct 格式——32/64、LE/BE 混用是解析器最常见的错
- 动态链接目标以 `readelf -d` 的 SYMTAB/STRTAB/SYMENT 为索引锚点，别硬编码节偏移
- readelf 输出与文件字节必须能互相印证：对不上说明头被修改或工具解析歧义，先手工核对再下结论

## 使用注意

- 静态分析无需沙箱（见 [[platform-tips]]）；跨架构 ELF 的 `readelf -h/-l/-S` 本机可直接跑，反汇编才需交叉工具
- 样例取自系统二进制仅作对照；分析真实样本时以样本自身三表为准，别套模板
