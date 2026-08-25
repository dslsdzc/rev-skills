# macOS 逆向方法论坑与边界

## 签名与公证组（最容易误判）

- **公证通过 ≠ 安全**：公证只证明 Apple 扫描过且无已知恶意签名，带公证的恶意/灰色应用存在——「公证状态」与「行为定性」分开陈述
- **离线环境 spctl 结果不可信**：公证与吊销（OCSP）检查需要网络——离线时 `spctl -a` 可能失败或异常；用 codesign 本地签名信息替代，标注「公证未验证」
- **codesign -dv 看不到完整要求**：designated requirement 需 `codesign -d -r-` 查看；只看默认输出会漏掉额外的 requirement 校验
- **staple 与公证是两回事**：`xcrun stapler validate` 查的是票证是否随包（离线可验证）；`spctl -a` 查整体评估（可能走网络）——一个失败不代表另一个也失败
- **改签名会破坏原签名链**：patch 后必须重签（`codesign -s -` adhoc 或开发者证书），且嵌套签名（framework/helper）要逐层处理；重签后公证状态丢失是预期
- **quarantine 干扰测试**：下载来源的 `com.apple.quarantine` 会触发 Gatekeeper 检查（崩溃/弹窗）——测试环境 `xattr -dr com.apple.quarantine` 去除后重测，注意这会改变来源证据

## 注入与动态组（hardened runtime 边界）

- **DYLD_INSERT_LIBRARIES 受 hardened runtime 限制**：无 `com.apple.security.cs.allow-dyld-environment-variables` entitlement 时注入不生效（Apple 签名 app 默认启用运行时保护）——别把「注入无效」当 bug，改走静态或 lldb
- **PT_DENY_ATTACH 拒绝 attach**：目标调用 `ptrace(PT_DENY_ATTACH)` 后 attach 被拒——先静态定位 ptrace 调用点 patch 掉（[[re-patching]]）再动态
- **AMFI/kext 级校验在用户态之外**：系统完整性保护（SIP）下对系统路径注入/挂载无效；内核级校验（kext 签名）不在本技能能力内
- **沙箱内 attach 自身受限**：沙箱环境（[[re-sandbox]]）的进程权限继承会影响目标行为——观察结论标注环境差异
- **Apple Silicon 差异**：arm64e 指针认证（PAC）影响 hook 与补丁（指针被签名校验）；Rosetta 转译层下 x86_64 行为与原生不同——按目标架构分别验证

## TCC 与隐私组（红线边界）

- **TCC.db 自身受 TCC 保护**：无 Full Disk Access 时读 TCC.db 权限失败——先确认授权，不要试图绕过系统权限（红线）
- **TCC 数据只读不导出**：授权记录属系统隐私，只读分析（谁请求了什么权限），不导出库内容（红线）
- **TCC 记录随时间变化**：授权可被撤销/新增，快照不代表历史全貌——结论标注采样时间
- **系统级 vs 用户级 TCC**：`/Library/Application Support/com.apple.TCC/`（系统）与 `~/Library/...`（用户）覆盖范围不同，按目标归属查对应库

## 钥匙串与 Secure Enclave 组

- **Secure Enclave 密钥不可提取**：`kSecAttrTokenIDSecureEnclave` 绑定的私钥永不离开 SE——内存/文件搜索必然无果，记录用途与 ACL 即可（反例：拿不到字节 ≠ 分析失败）
- **钥匙串 ACL 决定访问条件**：`kSecAttrAccessible` 与 `kSecAccessControl`（生物识别/密码提示）决定条目何时可读——分析访问点（SecItemCopyMatching 参数）比导出内容更有价值
- **钥匙串数据敏感**：条目内容属凭据，分析只读调用面，不导出口令内容（红线）
- **钥匙串迁移**：系统升级/备份恢复后 ACL 可能变化——历史环境复现时注意

## 反例与边界组

- **沙箱开启 ≠ 无网络面**：`com.apple.security.network.client` 存在时沙箱 app 照样外连——先看 entitlements 再判断行为面
- **entitlements 缺失 ≠ 无能力**：动态行为可能超出静态声明（漏洞利用/未声明调用）——能力边界以动态行为为准
- **签名者知名 ≠ 无恶意**：合法开发者账号可被窃取/滥用；以行为证据定性
- **无签名 app 也能分析**：Gatekeeper 拦截的是运行入口，静态分析不受影响；运行前去除隔离属性并放沙箱

## 使用注意

- 动态执行在沙箱内（[[re-sandbox]]，[[platform-tips]] 最高原则）
- TCC/钥匙串只读不导出（红线）；结论按 [[decision-tree]] 分级标注，签名维度与行为维度分开
