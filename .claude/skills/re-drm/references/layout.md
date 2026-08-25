# DRM 布局：密钥分层 / CENC-PSSH / Widevine protobuf / PlayReady SOAP

DRM 分析的三个结构层：媒体侧（PSSH 与加密方案）、协议侧（许可证挑战/响应格式）、设备侧（CDM 导出与密钥链）。本文件给出三层的关键字段表，字段以 ISO/IEC 23001-7、Widevine protobuf（pywidevine 同源）与 PlayReady 官方规范为准。

## 密钥分层模型（先建层再动手）

```
设备密钥 (device key, L3 软件密钥在 CDM 内/持久化存储；L1 在 TEE)
  │ 解密许可证响应（含 CEK 密文 + 权限策略）
  ▼
内容密钥 (CEK, content key)
  │ AES-CBC/CTR 解密媒体样本（cenc/cbc1/cbcs）
  ▼
明文媒体
```

- 分析每层时回答"哪来的、解什么"：设备密钥解许可证、CEK 解媒体——拿到中间层去解媒体必失败（坑 2）
- CEK 通常还有权限策略约束（输出保护 HDCP 等）与短生命周期（密钥轮换）

## CENC PSSH box（ISO/IEC 23001-7，大端）

```
offset  字段              说明
0x00    size (u32)        整 box 字节数（含自身）
0x04    'pssh' (u32)      类型（0x70 73 73 68）
0x08    version (1B) + flags (3B)   version 0 / 1
0x0C    SystemID (16B)    DRM 系统 UUID
[version=1 时] KID count (u32) + KIDs (16B×N)
0x?     DataSize (u32)    初始数据长度
0x?     Data              DRM 特定初始数据（Widevine 为 WidevineCencHeader protobuf）
```

### SystemID 对照表

| DRM | SystemID |
|---|---|
| Widevine | `edef8ba9-79d6-4ace-a3c8-27dcd51d21ed` |
| PlayReady | `9a04f079-9840-4286-ab92-e65be0885f95` |
| FairPlay | `94ce86fb-07ff-4f43-adb8-93d2fa968ca2` |
| Common (v1) | `1077efec-c0b2-4d02-ace3-3c1e52e2fb4b` |

- EME keySystem 字符串：`com.widevine.alpha` / `com.microsoft.playready` / `com.apple.fairplay`
- DASH 等价：`ContentProtection schemeIdUri="urn:uuid:EDEF8BA9-..."` + base64 `<cenc:pssh>`
- 媒体加密方案：cenc（AES-CTR）/ cbc1（AES-CBC）/ cbcs（模式保留，样本级加密）——决定解密分析走向

## Widevine 消息（protobuf）

所有客户端-服务端消息外层为 SignedMessage，按 type 选内层 schema。

### SignedMessage（外层）

| 字段号 | 名称 | 说明 |
|---|---|---|
| 1 | type | 0=license request 1=license 2=error |
| 2 | msg | 内层序列化消息（按 type 解析） |
| 3 | signature | 签名（会话密钥/设备密钥派生） |
| 4 | session_key | 会话密钥（RSA-OAEP 封装） |
| 5 | remote_attestation | 远程证明 |

### LicenseRequest（type=0 时的内层）

| 字段号 | 名称 | 说明 |
|---|---|---|
| 1 | client_id | ClientIdentification（设备证书/指纹） |
| 2 | content_id | ContentIdentification（oneof） |
| 3 | type | 1=NEW 2=RENEWAL 3=RELEASE（首次获取恒 NEW） |
| 4 | request_time | Unix 秒（客户端时钟） |
| 6 | protocol_version | 恒 CURRENT（协议版本 21） |
| 7 | key_control_nonce | u32 随机数（31 位），参与 CMAC 密钥派生 |
| 8 | encrypted_client_id | 隐私模式（AES-CBC 加密的 ClientIdentification） |

### ClientIdentification

- 1=token（TOKEN_TYPE_KEYBOX 或 DEVICE_CERTIFICATE）、2=client_info（name/value 对）、3=provider_info、4=supported_protocols（含 3=SRM 等）、5=key_control_nonces（老式）

### ContentIdentification（oneof content_id_variant）

| 变体号 | 名称 | 说明 |
|---|---|---|
| 1 | widevine_pssh_data | WidevinePsshData：pssh_data、key_ids、content_id、protection_scheme、crypto_period_* |
| 2 | webm_key_id | WebM（header + license_type） |
| 3 | existing_license | 续期/释放（引用已有 license） |
| 4 | init_data | 原始 init data（隐私/非标准 PSSH） |

### License（type=1 时的内层）

- 1=license_identification（request_id + session_id）、2=content_key_info[]（每条：1=key_id、2=key_type（SW_SECURE_CRYPTO/SW_SECURE_DECODE/HW_SECURE_CRYPTO/HW_SECURE_DECODE/HW_SECURE_ALL）、3=key（CEK 密文）、4=permissions）、3=certificate、4=protection_scheme
- key_type 等级与安全级别（L1/L3）对应——设备侧能力决定能拿到哪种 key

## PlayReady 许可证（SOAP/XML）

- 命名空间三件套：头 `http://schemas.microsoft.com/DRM/2007/03/PlayReadyHeader`；协议操作 `http://schemas.microsoft.com/DRM/2007/03/protocols`（`AcquireLicense`/`LicenseResponse`）；消息包裹 `.../protocols/messages`
- 挑战：`AcquireLicense` → `challenge` → `LA`（SignedData，Version=1 + ContentHeader 内嵌 WRMHEADER）
- 响应：`Response` → `LicenseResponse` → 加密 `License` blob（base64）

### WRMHEADER（PlayReady 头，version 属性 4.0.0.0+）

```xml
<WRMHEADER xmlns="http://schemas.microsoft.com/DRM/2007/03/PlayReadyHeader" version="4.0.0.0">
  <DATA>
    <PROTECTINFO><KEYLEN>16</KEYLEN><ALGID>AESCTR</ALGID></PROTECTINFO>
    <KID>base64-KID</KID>              <!-- 4.1+ 为 VALUE/ALGID/CHECKSUM 属性形式 -->
    <CHECKSUM>base64-checksum</CHECKSUM>
    <LA_URL>https://.../rightsmanager.asmx</LA_URL>
  </DATA>
</WRMHEADER>
```

- KID 是公开的密钥标识 GUID（小端字节序 base64）；CHECKSUM 防 KID/密钥错配
- 服务端按 KID 查/派生内容密钥（key seed + KID 派生算法）
- FairPlay（Apple 侧）：SPC（Server Playback Context，设备证书+会话）→ CKC（Content Key Context，含 CEK 密文）——由 [[re-ios]] 域延伸

## CDM 导出函数（libwidevinecdm.so，C ABI）

| 导出 | 作用 |
|---|---|
| Initialize | 初始化 CDM 实例（allow_distinctive_identifier / allow_persistent_state 等标志） |
| CreateSession | 建会话（session_type + init_data_type + init_data），产出挑战 |
| UpdateSession | 喂许可证响应（服务端返回的 license 消息） |
| CloseSession / RemoveSession | 关会话 / 删持久会话 |
| Decrypt | 解密样本（InputBuffer → 明文；无密钥返回 kNoKey） |
| SetServerCertificate | 设置服务端证书（隐私模式/会话密钥封装） |

- 静态分析入口：导出函数 → 交叉引用到密钥加载/解密路径
- 接口带版本号（ContentDecryptionModule_7/8/11），同一导出名不同版本行为有差异

## 版本差异要点

- PSSH version 0（老）vs 1（新，带 KID 列表）——解析先读 version
- Widevine 协议版本 CURRENT=21（字段号稳定，但服务端可能拒绝旧协议）
- PlayReady WRMHEADER：4.0 的 KID 元素 → 4.1+ 的 VALUE/ALGID/CHECKSUM 属性形式
- CDM 每季度更新：分析方法跨版本复用，密钥/偏移/签名不跨版本复用

## 使用注意

- 所有动态步骤在受控环境内（[[platform-tips]] 最高原则）；密钥材料不进报告
- 与 [[re-protocol]]（协议结构）、[[re-crypto-id]]（算法识别）、[[re-netcap]]（抓包）配合使用
