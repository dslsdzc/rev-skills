# TEE/TrustZone 逆向决策树与证据分级

## 场景决策树（入口 → 分支）

### 1. 目标形态分支（第一级）

```
能拿到什么
├─ TA 镜像（.ta）→ 签名头解析 → ELF 载荷 → [[re-format-elf]] + 反编译
├─ TEE OS 镜像（core）→ 反编译，定位 TEE_* 内部 API 与 smc 分发
├─ 固件分区内嵌（bootrom/启动链）→ 先 [[re-fw-extract]] 提取再定位
└─ 都拿不到（SoC 内部 ROM/受保护）→ 主机侧调用面反推（分支 4）
```

### 2. 镜像格式分支（第二级）

```
.ta 文件头
├─ magic "OTSH"（0x4f545348）→ OP-TEE 系签名头
│  ├─ img_type=0 → 明文签名 TA：切出 ELF 直接分析
│  ├─ img_type=1 → bootstrap TA：子头含 UUID+版本，其后载荷
│  ├─ img_type=2 → 加密 TA：AES-GCM 密文，先还原解密流程（[[re-crypto-decrypt]]）
│  └─ img_type=3 → 子密钥链式头（新版本）
├─ 其他魔数 → 自定义 TEE：按「字段长度 + 常见值」反推布局（[[re-proto-rev]]）
└─ 直接是 ELF → 无签名头的裸 TA/测试构建，直接分析
```

### 3. 接口面分支（第三级，两头夹逼）

```
接口面
├─ secure world 侧：TA_InvokeCommandEntryPoint 命令分发表
│  └─ 逐 cmd_id 标注行为与参数类型（value/memref）
├─ 主机侧用户态：client 库调用（TEEC_OpenSession/InvokeCommand）
│  └─ 记录 UUID、命令号、TEEC_Operation 参数布局
├─ 主机侧内核态：/dev/tee0 ioctl（TEE_IOC_OPEN_SESSION/INVOKE/CLOSE_SESSION）
└─ 两侧对号入座 → 闭合：每个命令分支 = UUID + cmd_id + 参数布局 + 行为
```

### 4. 数据目标分支（第四级）

```
要什么
├─ 设备密钥/信任根 → DRM 方向（[[re-drm]]）确认 TEE 角色；密钥在 core/TA 内
│  └─ 不可提取时记录用途与保护机制（红线：不硬挖）
├─ secure storage 对象 → 定位落盘密文（REE 文件系统经 tee-supplicant / RPMB）
│  └─ 找解密路径（对象 ID 派生 + 加密流程）还原明文
├─ 命令接口目录 → 分发表还原（步骤 3）
└─ 调用序列（谁在何时调什么）→ 主机侧 hook（[[re-frida]]）记录
```

### 5. 拿不到 secure world 分支（第五级）

```
TEE OS/TA 不可得
├─ 主机侧 ioctl/client 调用面完整记录（UUID/命令号/参数）
├─ 返回行为观察（成功/失败码/输出缓冲区）反推内部逻辑
└─ 结论分级降级：以调用面证据为主，内部实现标注「推测」
```

## 证据分级表

| 级别 | 证据形态 | 示例 | 用途 |
|---|---|---|---|
| A 强 | 两侧夹逼闭合 | 主机侧 ioctl 参数与 TA 分发表逐条对应，明文/密文链路打通 | 可下接口与数据流结论 |
| B 中 | 单侧完整 | 只有完整主机侧调用面，或只有静态分发表（未动态确认） | 可下「疑似」，标注缺另一侧 |
| C 弱 | 特征级 | 镜像头魔数、UUID、字符串特征确认 TEE 类型 | 只支持「TEE 类型判定」 |
| 反证 | 良性解释 | 调用的命令属正常业务路径，无越权/异常 | 记录并存档 |

- 设备密钥结论分级：提取成功（A）→ 确认不可提取+用途（B）→ 仅推测在 TEE 内（C），不把推测当提取结果
- 行为差异（与静态不符）记录为「TEE 侧监测触发」证据，标注置信度

## 实现教训（内化）

- 先指纹后套模板：TEE 类型（OP-TEE 系 vs 自定义）决定一切格式假设，别拿 OP-TEE 细节当默认值
- SMC 按约定表读不靠猜：先建 SMCCC 表（w0 功能号、参数寄存器、返回值）再标注调用点
- 夹逼法两侧都要有落点：UUID、命令号、参数布局三个维度对号入座才闭合
- 加密 TA 的解密流程本身是分析对象：密钥/信任根在 core 侧，解密逻辑还原即取证
- secure storage 先找落盘再找解密：tee-supplicant 写入的 REE 文件与 RPMB 分区都是目标
- 签名头剥离脚本化：切载荷（img_size 偏移）写脚本存档，可复现

## 使用注意

- 主机侧动态（client/ioctl hook）在沙箱内（[[re-sandbox]]，[[platform-tips]] 最高原则）；secure world 内不做动态调试
- 设备密钥不可提取时记录用途与保护机制，不硬挖（红线）；结论按本表分级标注
