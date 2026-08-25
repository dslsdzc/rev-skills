# DRM 最小解析示例

示例以本机可复现的最小样本为主：PSSH 用 Python 构造并解析（ISO/IEC 23001-7 字段），Widevine protobuf 用官方测试向量与 pywidevine 同源字段号（见 [[layout]]）。所有示例不涉及真实密钥材料。

## 1. PSSH box 解析（Python，本机可直接跑）

```python
import struct

# 构造一个 Widevine PSSH v0（Widevine SystemID + 初始数据）
WIDEVINE_SYSTEM_ID = bytes.fromhex('edef8ba979d64acea3c827dcd51d21ed')

def build_pssh(system_id, data, version=0, key_ids=()):
    body = bytes([version, 0, 0, 0]) + system_id
    if version == 1:
        body += struct.pack('>I', len(key_ids))
        for kid in key_ids:
            body += kid
    body += struct.pack('>I', len(data)) + data
    return struct.pack('>I', 8 + len(body)) + b'pssh' + body

def parse_pssh(buf):
    assert buf[4:8] == b'pssh', 'not a pssh box'
    size, = struct.unpack_from('>I', buf, 0)
    version = buf[8]
    sysid = buf[12:28].hex()
    off = 28
    kids = []
    if version == 1:
        n, = struct.unpack_from('>I', buf, off); off += 4
        kids = [buf[off + 16*i : off + 16*(i+1)].hex() for i in range(n)]
        off += 16 * n
    dsize, = struct.unpack_from('>I', buf, off); off += 4
    data = buf[off : off + dsize]
    return dict(size=size, version=version, system_id=sysid,
                key_ids=kids, data_len=dsize, data=data)

pssh = build_pssh(WIDEVINE_SYSTEM_ID, b'\x08\x10\x12\x04test')
print(parse_pssh(pssh))
# {'size': 40, 'version': 0, 'system_id': 'edef8ba979d64acea3c827dcd51d21ed',
#  'key_ids': [], 'data_len': 8, 'data': b'\x08\x10\x12\x04test'}
# size = 8(头) + 4(version/flags) + 16(SystemID) + 4(DataSize) + 8(Data) = 40 ✓
```

对照要点：v0 布局 size + pssh + version/flags + SystemID + DataSize + Data；SystemID 判 DRM 类型（对照表见 [[layout]]）；v1 的 KID 列表插在 SystemID 与 DataSize 之间——解析必须先读 version（坑 5）。

## 2. 真实媒体里找 PSSH（命令）

```sh
# 简易定位（box 链遍历更可靠，见上）
grep -oba 'pssh' sample.mp4 | head -5
# 结构化解析用 ffprobe（ffmpeg 自带）
ffprobe -v error -show_entries stream_tags=variant_bitrate -of json sample.mp4
# 或 mp4dump（bento4）：输出所有 box 树
mp4dump sample.mp4 | grep -A4 pssh
```

## 3. Widevine 挑战/响应结构速查（字段号对照）

以 pywidevine 同源 protobuf 字段号（完整表见 [[layout]]）验证解析：

```python
# 依赖: pip install protobuf
# 用 grpcio-tools 从 Widevine 协议 .proto 生成后：
# 外层 SignedMessage: msg.type 判定层（0=license request 1=license 2=error）
# 内层 LicenseRequest: client_id(1) content_id(2) type(3) request_time(4)
#                     protocol_version(6) key_control_nonce(7)
def peek_proto(data, fields):
    """极简 protobuf 字段窥探（varint 场景）：打每字段的 字段号/类型/值头"""
    out = []
    i = 0
    while i < len(data):
        tag = data[i]; i += 1
        fno, wtype = tag >> 3, tag & 7
        if wtype == 0:                      # varint
            val = 0; sh = 0
            while True:
                b = data[i]; i += 1
                val |= (b & 0x7f) << sh
                if not b & 0x80: break
                sh += 7
            out.append((fno, 'varint', val))
        elif wtype == 2:                    # length-delimited
            ln = data[i]; i += 1
            out.append((fno, 'bytes', ln, data[i:i+ln]))
            i += ln
        else:
            break
    return out

# 用例：构造的 WidevineCencHeader 初始数据（见 [[layout]] WidevinePsshData 字段）
```

对照要点：外层 SignedMessage 的 `type` 决定内层 schema——直接按 LicenseRequest 解析响应必错（坑 6）。

## 4. PlayReady 头/挑战 XML 对照

```xml
<!-- 内容元数据里的 WRMHEADER（PlayReadyHeader 命名空间） -->
<WRMHEADER xmlns="http://schemas.microsoft.com/DRM/2007/03/PlayReadyHeader" version="4.0.0.0">
  <DATA>
    <PROTECTINFO><KEYLEN>16</KEYLEN><ALGID>AESCTR</ALGID></PROTECTINFO>
    <KID>Cofu3FaCfjuAJNqKod80iw==</KID>      <!-- KID GUID（小端 base64） -->
    <CHECKSUM>2u+jpp0wDIk=</CHECKSUM>
    <LA_URL>https://lic.example/rightsmanager.asmx</LA_URL>
  </DATA>
</WRMHEADER>

<!-- 许可证挑战（SOAP，protocols 命名空间） -->
<AcquireLicense xmlns="http://schemas.microsoft.com/DRM/2007/03/protocols">
  <challenge><Challenge xmlns="http://schemas.microsoft.com/DRM/2007/03/protocols/messages">
    <LA xmlns="http://schemas.microsoft.com/DRM/2007/03/protocols" Id="SignedData">
      <Version>1</Version><ContentHeader><!-- 内嵌 WRMHEADER --></ContentHeader>
    </LA>
  </Challenge></challenge>
</AcquireLicense>
```

对照要点：KID 是公开标识（对得上许可证 URL 才有后续）；CHECKSUM 防 KID/密钥错配——拿到"密钥"后先按此核对再下结论（坑 2）。

## 5. CDM 导出表核验（Ghidra/readelf）

```sh
# 自有环境 Widevine CDM（路径见 SKILL.md 步骤 1）
readelf -d libwidevinecdm.so | grep NEEDED          # 依赖链（沙箱环境核对）
readelf -s libwidevinecdm.so | grep -E 'Initialize|CreateSession|UpdateSession|Decrypt'
# 导出函数是静态分析入口：交叉引用到密钥加载/解密路径
```

## 实现教训（内化）

- 分层建模先行（设备密钥 → CEK → 媒体），任何"密钥"先问属于哪一层、解什么
- PSSH 解析先读 version；Widevine 消息先解 SignedMessage 再按 type 选 schema
- 版本锚点（CDM 版本 + sha256 + 分析时间）是所有结论的前提

## 使用注意

- 所有步骤限授权范围与受控环境（[[platform-tips]] 最高原则）；密钥材料不进报告
- 与 [[re-protocol]]、[[re-crypto-id]]、[[re-netcap]] 配合；本文件示例不含真实密钥材料
