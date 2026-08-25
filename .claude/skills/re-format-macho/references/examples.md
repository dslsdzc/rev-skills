# Mach-O 最小解析示例

以下示例以本机（Linux + clang 22 + ld64.lld）构建的真实 x86_64 Mach-O 可执行文件为标本，otool/llvm-objdump 输出与 Python/字节样例可逐字段对照。构建命令（无 macOS 环境时可复现，仅需 clang + lld 的 darwin 支持）：

```sh
# hello.c: 定义 _start 入口（Mach-O 中 C 符号加下划线，链接器 -e 用 __start）
clang -target x86_64-apple-darwin -c hello.c -o hello.o
ld64.lld -arch x86_64 -platform_version macos 10.13 10.13 \
  -e __start -undefined dynamic_lookup hello.o -o hello_macho
```

## 1. 工具输出对照

### `llvm-otool -h hello_macho`（mach_header，全字段）

```
Mach header
      magic cputype cpusubtype  caps    filetype ncmds sizeofcmds      flags
 0xfeedfacf 16777223          3  0x80           2    13       1288 0x00200085
```

对照要点：magic=0xfeedfacf（64 位 LE）；cputype=16777223=0x01000007=x86_64；cpusubtype=3、caps=0x80（x86_64h 能力位）；filetype=2=MH_EXECUTE；ncmds=13、sizeofcmds=1288（二者乘积关系可校验遍历）；flags=0x00200085 = NOUNDEFS(1)+DYLDLINK(2)+TWOLEVEL(4)+PIE(0x200000)。

### `llvm-otool -l hello_macho`（load commands，节选）

```
Load command 0
      cmd LC_SEGMENT_64
  cmdsize 72
  segname __PAGEZERO
   vmaddr 0x0000000000000000
   vmsize 0x0000000100000000      ← 4GB 空洞（空指针保护）
  maxprot 0x00000000  initprot 0x00000000  nsects 0
Load command 1
      cmd LC_SEGMENT_64
  cmdsize 552
  segname __TEXT
   vmaddr 0x0000000100000000
  fileoff 0  filesize 8192
  maxprot 0x00000005  initprot 0x00000005  nsects 6   ← RX
Section
  sectname __text   addr 0x100000550  size 0x1e  offset 1360  align 2^4
  sectname __stubs  addr 0x100000570  size 0x6   offset 1392  reserved1 1 (index into indirect symbol table)
  sectname __cstring addr 0x100000592 size 0xf  offset 1426  flags 0x00000002 (CSTRING_LITERALS)
Load command 2
      cmd LC_SEGMENT_64
  segname __DATA  vmaddr 0x100002000  fileoff 8192  initprot 0x3  nsects 3
Section
  sectname __got           addr 0x100002000 size 8 offset 8192 flags 0x6 (POINTERS) reserved1 0
  sectname __la_symbol_ptr addr 0x100002008 size 8 offset 8200 flags 0x7 (LAZY_POINTERS) reserved1 2
Load command 3
      cmd LC_SEGMENT_64  segname __LINKEDIT  vmaddr 0x100003000  fileoff 12288  nsects 0
Load command 4
            cmd LC_DYLD_INFO_ONLY
        cmdsize 48
     rebase_off 12288    rebase_size 8
       bind_off 12296    bind_size 24
  lazy_bind_off 12320    lazy_bind_size 16
     export_off 12336    export_size 48
Load command 5
     cmd LC_SYMTAB
  symoff 12392  nsyms 5  stroff 12488  strsize 72
Load command 7
          cmd LC_LOAD_DYLINKER  cmdsize 32  name /usr/lib/dyld (offset 12)
Load command 8
     cmd LC_UUID  cmdsize 24  uuid ...
Load command 9
      cmd LC_VERSION_MIN_MACOSX  cmdsize 16  version 10.13  sdk 10.13
Load command 10
       cmd LC_MAIN
  cmdsize 24
  entryoff 1360              ← 入口文件偏移 = __text 的 offset（0x550）
  stacksize 0
Load command 11
          cmd LC_LOAD_DYLIB
      cmdsize 40
         name libstub.dylib (offset 24)   ← 依赖库（本示例用 -L. -lstub 链接出的）
```

对照要点：LC_SEGMENT_64 的 cmdsize=72+80×nsects（552=72+80×6，自查一致）；__text 的 addr 与 LC_MAIN.entryoff 一致（0x100000550 与 1360）；__got/__la_symbol_ptr 的 reserved1 指向 LC_DYSYMTAB 的间接符号表索引；LC_LOAD_DYLIB 的 name 从偏移 24 开始（16+8=24）。入口 VA = 0x100000000 + 0x550 = 0x100000550。

### `llvm-nm -m hello_macho`（符号表，含段归属）

```
0000000100002010 (__DATA,__data) non-external __dyld_private
0000000100000000 (__TEXT,__text) [referenced dynamically] external __mh_execute_header
0000000100000550 (__TEXT,__text) external __start
                 (undefined) external _puts (dynamically looked up)
                 (undefined) external dyld_stub_binder (dynamically looked up)
```

对照要点：外部定义符号带 (段,节) 归属；undefined 条目 = 导入（依赖 dyld 绑定）；`__mh_execute_header` 是 Mach-O 特有的"文件头即符号"（macho_header 的地址）。nlist_64 的 n_sect 值指向节序号。

## 2. Python struct 解析 mach_header（最小可运行）

```python
import struct

def parse_macho_header(path):
    d = open(path, 'rb').read(32)
    magic = struct.unpack_from('<I', d, 0)[0]
    if magic == 0xFEEDFACF:        # MH_MAGIC_64（LE 文件字节 cffaedfe）
        f = struct.unpack_from('<IIIIIIII', d, 0)   # 8 个 u32 = 32 字节
        return dict(magic=hex(f[0]), cputype=f[1], cpusubtype=f[2],
                    filetype=f[3], ncmds=f[4], sizeofcmds=f[5],
                    flags=hex(f[6]), reserved=f[7])
    if magic == 0xFEEDFACE:        # 32 位，28 字节
        f = struct.unpack_from('<IIIIIII', d, 0)
        return dict(magic=hex(f[0]), cputype=f[1], cpusubtype=f[2],
                    filetype=f[3], ncmds=f[4], sizeofcmds=f[5], flags=hex(f[6]))
    raise ValueError('not a Mach-O (magic %x)' % magic)

print(parse_macho_header('hello_macho'))
# {'magic': '0xfeedfacf', 'cputype': 16777223, 'cpusubtype': 3, 'filetype': 2,
#  'ncmds': 13, 'sizeofcmds': 1288, 'flags': '0x200085', 'reserved': 0}
# —— 与 llvm-otool -h 逐字段一致
```

按 mach_header 的 ncmds/cmdsize 可继续遍历 LC：前 8 字节 `I I`（cmd, cmdsize），cmdsize=0 或超过 sizeofcmds 总量即遍历异常。LC_SEGMENT_64 用 `'<I I 16s QQQQQ II II'` 展开（72 字节），再按 nsects 解析 80 字节的 section_64。

## 3. 字节样例（hello_macho 前 32 字节，逐字段标注）

```
00000000: cffa edfe 0700 0001 0300 0080 0200 0000  ................
         magic──┘ └cputype(0x01000007=x86_64)┘ └cpusubtype(0x80000003)┘
         filetype=02(MH_EXECUTE)───────────┘
00000010: 0d00 0000 0805 0000 8500 2000 0000 0000  .......... .....
         ncmds=13(0x0d)──┘ └sizeofcmds=1288(0x508)  └flags=0x00200085
         reserved=0────────────────────────┘
```

对照流程：`xxd -l 32 hello_macho` 与 `llvm-otool -h` 输出对照；magic 不符先查是不是 fat（cafebabe）再决定是否 `lipo -thin` 拆片（见 SKILL.md 坑）。

## 4. 导出 trie 与绑定表（LC_DYLD_INFO_ONLY 解析）

```python
import struct

d = open('hello_macho', 'rb').read()
# 读 LC_DYLD_INFO_ONLY（第 5 条 LC，前 8 字节 cmd/cmdsize）
off = 32
for _ in range(5):
    cmd, size = struct.unpack_from('<II', d, off)
    assert size >= 8
    off += size
    if cmd == 0x80000022:          # LC_DYLD_INFO_ONLY
        (r_off, r_sz, b_off, b_sz, w_off, w_sz, l_off, l_sz, e_off, e_sz) = \
            struct.unpack_from('<10Q', d, off)
        print('export trie: off=%d size=%d' % (e_off, e_sz))
        print('export trie 原始字节:', d[e_off:e_off+e_sz].hex())
        break
```

本例 trie 原始字节（export_off=12336 起，48 字节）：

```
00003030: 0001 5f5f 0006 0002 7374 6172 7400 226d  ..__....start."m
00003040: 685f 6578 6563 7574 655f 6865 6164 6572  h_execute_header
00003050: 0027 0300 d00a 0002 0000 0000 0000 0000  .'..............
```

解码（dyld 导出 trie 格式：边是 `\0` 结尾字符串，子节点偏移是相对 trie 起点的 uleb128——Apple dyld（MachOAnalyzer.cpp）、lld（ExportTrie.cpp）与 LLVM 解析器三方一致，无第二种边格式）：

```
0x00: 00                root 节点 terminalSize=0（非终端）
      01                子节点数=1
      5f 5f 00          边字符串 "__"（Mach-O 符号名含下划线前缀）
      06                子节点绝对偏移 6 → 0x3036
0x06: 00 02             terminalSize=0；子节点数=2
      73..74 00         边 "start"
      22                子节点偏移 34 → 0x3052
      6d..72 00         边 "mh_execute_header"
      27                子节点偏移 39 → 0x3057
0x22: 03 00 d0 0a 00    terminalSize=3；flags=0；address=uleb128(d0 0a)=0x550
                        → __start @ 0x100000000+0x550=0x100000550（与 otool 对照 ✓）
0x27: 02 00 00 00 00    terminalSize=2；flags=0；address=0
                        → __mh_execute_header @ 0x100000000（文件头即符号）
```

注意 `d0 0a` 是两字节 uleb128（0xd0 最高位=1 续读）：0x50 | (0x0a<<7) = 0x550。手工解码过一遍即掌握 dyld 导出表格式：所有生成端（Apple ld64/lld）都是同一种 `\0` 结尾边 + 相对 trie 起点 uleb128 偏移，解码脚本只需处理这一种。

## 实现教训（内化）

- 一切解析先看 magic 分 64/32 位（字段数不同），fat 先拆片
- load commands 遍历只信 cmdsize，不信 ncmds 之外的信息；ncmds×最小 16 字节 > sizeofcmds 即异常
- 段节是一棵树（段→节），不是平铺数组；节地址 = 段 vmaddr 内的相对偏移
- otool 输出与文件字节必须能互相印证：对不上说明头被修改或工具解析歧义，先手工核对再下结论

## 使用注意

- Linux 上解析 Mach-O 用 llvm-otool/llvm-objdump/llvm-lipo（llvm 包自带），输出与 macOS 一致；反汇编才需交叉环境
- 样例取自本机构建的极简二进制；分析真实样本时以样本自身 load commands 为准，别套模板
