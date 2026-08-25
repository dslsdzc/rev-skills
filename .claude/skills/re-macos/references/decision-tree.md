# macOS 应用逆向决策树与证据分级

## 场景决策树（入口 → 分支）

### 1. 目标形态分支（第一级）

```
目标对象
├─ .app bundle → 解包 Contents/，先读 Info.plist 与可执行文件
├─ 单二进制（命令行工具/daemon）→ 直接 codesign/Mach-O 分析
├─ dylib / framework → 依赖关系与导出面为主（otool -L / nm）
├─ 安装包（pkg/dmg）→ 先解包提取载荷（pkgutil --expand）
└─ 无签名/adhoc 签名 → 跳过签名面，直接静态分析
```

### 2. 签名与分发状态分支（第二级，决定动态方案）

```
codesign -dv 结果
├─ Apple 开发者/分发签名
│  ├─ 公证通过（spctl -a 过）→ 正规分发；仍按恶意面分析（公证≠安全）
│  ├─ 公证失败/未公证 → Gatekeeper 会拦；本地仍可分析
│  └─ Hardened Runtime 开 → 注入受限（见分支 3）
├─ 第三方/自签 → 注入面大，但可能带自定义校验
└─ 无签名 → 最容易动态，但注意系统会拦截运行（Gatekeeper/AMFI）
```

### 3. 动态可行性分支（第三级）

```
想动态执行（lldb attach / DYLD_INSERT_LIBRARIES / frida）
├─ Hardened Runtime 且无 cs.allow-dyld-environment-variables
│  └─ DYLD 注入不可行 → lldb attach 或静态分析（[[re-ghidra]]）
├─ PT_DENY_ATTACH（ptrace 拦截）→ 先 patch 调用点（[[re-patching]]）再 attach
├─ 沙箱开启 → 动态观察被限制在沙箱能力内（以 entitlements 为准）
└─ 全无限制 → 标准 lldb / frida 流程（沙箱环境内，[[platform-tips]]）
```

### 4. 数据目标分支（第四级）

```
要拿什么
├─ 网络行为 → 抓包（[[re-netcap]]）+ 沙箱网络权限确认
├─ 钥匙串条目 → 定位 SecItemCopyMatching 调用点，读用途与 ACL（不导出内容，红线）
├─ Secure Enclave 密钥 → 确认 tokenID，记录用途（不可提取，不找字节）
├─ 本地文件/偏好 → 容器路径（沙箱下在 ~/Library/Containers/）分析
└─ 授权/注册逻辑 → 校验 API 调用点 → [[re-license]] 方法论
```

## 证据分级表

| 级别 | 证据形态 | 示例 | 用途 |
|---|---|---|---|
| A 强 | 动态 + 静态交叉闭合 | 动态观察到网络外传，静态代码与 entitlements（network.client）一致 | 可下「恶意行为」结论 |
| B 中 | 单侧完整证据链 | 静态完整还原调用链（含触发条件），未动态确认 | 可下「高可疑」 |
| C 弱 | 静态特征 | 只有高危 entitlement（如 device.* 全开）+ 高混淆 | 只支持「需深入」 |
| 反证 | 良性解释 | 权限声明与功能相符、行为与声明一致 | 记录并存档 |

- 能力边界以动态行为为准：entitlements 声明的能力 ≠ 实际使用的能力，两者都要记录
- 签名/公证结论与恶意结论分开陈述（「分发状态」与「行为定性」是两个维度）

## 实现教训（内化）

- 先读 Info.plist + entitlements 再定动态方案——hardened runtime/沙箱直接决定注入与观察手段
- 签名信息本地可查（codesign -d -r- / -dv），公证状态需网络——离线时用本地信息替代并标注
- TCC 数据只读分析、不导出内容（红线）；Full Disk Access 是读取前置，先确认授权
- Secure Enclave 密钥记用途不找字节；钥匙串条目记录 ACL 与访问点而非口令内容
- 动态观察在沙箱内进行（[[re-sandbox]]，[[platform-tips]] 最高原则）
- 证据链记录：签名者/Team ID、entitlements 原文、TCC 依赖点、dyld 依赖清单、动态行为对照

## 使用注意

- 沙箱内执行动态（[[re-sandbox]]）；TCC/钥匙串数据只读不导出（红线）
- 结论按本表分级标注，签名/公证维度与行为维度分开陈述
