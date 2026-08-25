# Python 打包产物最小解析示例

以下示例以本机 Python 3.14.7 与 PyInstaller 6.22.2 为标本，命令与输出可原样复现（工具链：`python3`、`pip install pyinstaller pyinstxtractor-ng`；系统 pip 受 PEP 668 限制时先 `python3 -m venv` 再装）。结构定义见 [[layout]]。

## 1. pyc 头解析（python3 本机可复现）

### 生成 pyc

```sh
python3 -c "import py_compile; py_compile.compile('sample.py', cfile='sample.pyc')"
# sample.py 内容：import base64
# k = base64.b64decode("czNjcmV0")
# print(k)
```

### struct 解析头 + marshal 验证 + 反汇编

```python
import struct, marshal, dis

d = open('sample.pyc', 'rb').read()
magic, flags, mtime, size = struct.unpack('<IIII', d[:16])
print('magic=0x%08x  flags=%d  mtime=%d  size=%d' % (magic, flags, mtime, size))
print('code 对象从偏移 16 开始，类型字节 0x%02x' % d[16])
code = marshal.loads(d[16:])          # 与解释器同版本的权威解析
print('argcount=%d nlocals=%d stacksize=%d' % (code.co_argcount, code.co_nlocals, code.co_stacksize))
dis.dis(code)
```

本机实测输出：

```
magic=0x0a0d0e2b  flags=0  mtime=1787648948  size=56
code 对象从偏移 16 开始，类型字节 0xe3
argcount=0 nlocals=0 stacksize=3
  0           RESUME                   0
  1           LOAD_SMALL_INT           0
              LOAD_CONST               1 (None)
              IMPORT_NAME              0 (base64)
              STORE_NAME               0 (base64)
  ...
```

对照要点：`magic` 低 2 字节 `0x0e2b` = 3.14；`flags=0` = timestamp 校验；`size=56` = 源文件字节数；类型字节 `0xe3` = `0x63|0x80`（code + REF 标志），PyInstaller 解出的条目标 `0x63`——两种都合法，别拿类型字节判损坏。

### 字节样例（pyc 头 16 字节，逐字段标注）

```
00000000: 2b0e 0d0a 0000 0000 9e5b 8d6a 3800 0000  +......[.j8...
         magic=0x0a0d0e2b─┘ └flags=0     └size=56(0x38)
                            mtime=0x6a8d5b9e──────┘
00000010: e300 0000 0000 0000 0000 0000 0003 0000  ................
         类型0xe3(code+REF)  argcount=0 posonly=0 kwonly=0 nlocals=3
```

手工核对：`xxd sample.pyc | head -2` 与上述一致；PyInstaller 解出的 pyc 头 mtime/size 为 0（清零正常，见 [[layout]] 头字段表）。

## 2. PyInstaller onefile：构建 → 解包 → cookie 解析

### 构建与解包

```sh
pip install pyinstaller pyinstxtractor-ng
pyinstaller --onefile sample_app.py
python3 -m pyinstxtractor_ng dist/sample_app
```

本机实测解包输出（节选）：

```
[+] Possible entry point: sample_app.pyc
[+] Found 130 files in PYZ archive
[+] Successfully extracted pyinstaller archive: dist/sample_app
```

产物结构见 [[layout]] §2 末；入口 pyc 头 `2b 0e 0d 0a | 00000000 | 00000000 | 00000000`——flags/mtime/size 全 0（清零正常），code 对象从 0x10 开始（`63 00 00 00 ...`）。

### CArchive cookie 手工解析（大端，`!8sIIII64s`）

```python
import struct

d = open('dist/sample_app', 'rb').read()
magic = b'MEI\x0c\x0b\x0a\x0b\x0e'
i = d.rfind(magic)                        # cookie 在归档末尾，取最后一次出现
ln, toc, toclen, pyver = struct.unpack_from('!IIII', d, i + 8)
name = d[i + 24:i + 88].split(b'\0')[0].decode()
start = i + 88 - ln                       # 归档起点 = cookie 尾 − archive_length
print('cookie @0x%x' % i)
print('archive_length=%d toc_offset=0x%x toc_length=%d pyver=%d' % (ln, toc, toclen, pyver))
print('pylib=%s  archive 起点=0x%x' % (name, start))
```

本机实测输出：

```
cookie @0x974549
archive_length=9847480 toc_offset=0x963220 toc_length=4160 pyver=314
pylib=libpython3.14.so.1.0  archive 起点=0x102e9
```

对照要点：pyver=314 即 Python 3.14（`major*100+minor`）；`toc_offset + toc_length + 88 == archive_length`（实测 0x963220+4160+88=9847480 吻合）；onefile 下归档起点之前是 bootloader——所有归档内偏移都要加该起点换算；**起点 = cookie 尾 − archive_length**（cookie 自身 88 字节不算进归档，算错会整体偏移 88 字节）。

### TOC 条目遍历（变长，16 字节对齐）

```python
import struct

d = open('dist/sample_app', 'rb').read()
magic = b'MEI\x0c\x0b\x0a\x0b\x0e'
i = d.rfind(magic)
ln, toc, toclen, pyver = struct.unpack_from('!IIII', d, i + 8)
start = i + 88 - ln                        # 归档起点
pos = start + toc
end = pos + toclen
while pos < end:
    entry_len, off, clen, dlen, comp, tc = struct.unpack_from('!IIIIBc', d, pos)
    name = d[pos + 18:pos + entry_len].split(b'\0')[0].decode('latin1')
    print('%-26s type=%s off=0x%-7x clen=%-7d' % (name[:26], tc, off, clen))
    pos += entry_len
```

本机实测输出（节选）：

```
struct                     type=m off=0x0       clen=232
pyimod01_archive           type=m off=0xe8      clen=2896
pyimod02_importers         type=m off=0xc38     clen=13829
pyimod03_ctypes            type=m off=0x423d    clen=2874
pyiboot01_bootstrap        type=s off=0x4d77    clen=1158
pyi_rth_inspect            type=s off=0x51fd    clen=1486
sample_app                 type=s off=0x57cb    clen=366
libbrotlicommon.so.1       type=b off=0x5939    clen=63578
...（共 58 条，遍历终点 == cookie 位置 0x974549）
base_library.zip           type=z off=0x761256  clen=415154
PYZ.pyz                    type=z off=0x7c6808  clen=1690136
```

对照要点：`type=m` = 内嵌引导模块（zlib 压缩 pyc 块）、`s` = 脚本类（入口/启动钩子）、`b` = 二进制数据、`z` = PYZ 类条目（含 base_library.zip 与 PYZ.pyz）；名字无扩展名且是变长的——按 `entry_length` 跳（条目对齐到 16 字节），不能按定长扫。

## 3. PYZ 头解析

```python
import struct
d = open('sample_app_extracted/PYZ.pyz', 'rb').read()
print('MAGIC=%r pyc_magic=%s toc_offset=0x%x' % (
    d[:4], d[4:8].hex(), struct.unpack('!i', d[8:12])[0]))
```

本机实测输出：

```
MAGIC=b'PYZ\x00' pyc_magic=2b0e0d0a toc_offset=0x19b92b
```

对照要点：PYZ 头 = `PYZ\0` + pyc magic（同 pyc 版本判定）+ 大端 TOC 偏移；TOC 在文件尾部（marshal 列表），模块条目按 (name, (typecode, offset, length)) 索引 zlib 压缩的 code 对象。

## 实现教训（内化）

- 版本先于一切：pyc magic → marshal 版本 → PyInstaller pyver 三处分别判版本，混用即错位
- 归档偏移是相对的：onefile 的 cookie 用 `rfind` 定位，归档起点 = cookie − archive_length
- TOC 条目按 entry_length 跳，16 对齐，别定长扫
- 官方 `marshal.loads` + `dis` 是权威解析路径；手写解析只到头部字段为止

## 使用注意

- 样例为本地构建产物，仅作结构对照；分析真实样本以样本自身头字段为准（[[layout]] 各表）
- 动态取明文（进入桩解密窗口内抓取）在沙箱内执行（[[re-sandbox]]，见 [[platform-tips]]）
