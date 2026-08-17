---
name: re-frida-script-author
type: atomic
description: >
  Frida 脚本生成方法论：目标特征 → 模板选择 → 改写 → 验证。独立于执行插桩（re-frida）。
  触发词：生成Frida脚本、写hook脚本、frida脚本怎么写、写个hook、脚本生成。
---

# Frida 脚本生成

## 何时使用 / 何时不用

- 用：需要新脚本时——拦截（加密/网络/文件）、绕过（检测/固定）、追踪（JNI/方法调用）
- 不用：执行现成脚本 → 转 [[re-frida]]；反检测对抗面分析 → [[anti-dynamic-workflow]]

## 工具准备

### frida-tools（脚本编写与运行验证）

- Linux: `pip install frida-tools`（或 `apt install frida-tools` / `pacman -S frida`）
- macOS: `pip install frida-tools` / `brew install frida`
- Windows: `pip install frida-tools` / `choco install frida`
- 验证: `frida --version`、`frida-ps -U`（连设备后）

### python3（配合脚本调试）

- 各平台同 [[re-python]] 工具准备

### 目标设备/模拟器

- Android 真机/模拟器 + frida-server（安装见 [[re-frida]] 工具准备）；桌面目标直接本机

## 操作步骤

按「探 → 选 → 改 → 验」四步，先探后写，不猜：

1. **目标侦察**：
   - 静态：目标包名/类名/关键 API（[[re-apk]] jadx 输出）、加固商特征（[[re-mobile-pack]]）、Flutter/RN 混合结构（[[re-hybrid-app]]）
   - 动态基线：原样跑一次抓崩溃（崩溃特征 → 保护机制对照，见 [[anti-dynamic-workflow]]）
   - 产出：目标特征清单（检测点/目标 API/输入输出形态）

2. **模板选择**：按特征清单对照 [[frida-scripts]] 模板表：

| 目标特征 | 模板 |
|---|---|
| HTTPS 抓包被 TLS 加密（BoringSSL） | TLS 密钥日志（SSLKEYLOGFILE） |
| 证书固定挡抓包 | SSL 固定绕过（TrustManager/CertificatePinner） |
| 加密算法/密钥要提取 | 加密拦截（Cipher/SecretKeySpec 全 overload） |
| 加固/运行时解密 | DEX dump（类加载点）/ SO dump |
| 双向 TLS 客户端证书 | keystore p12 导出 |
| JNI 动态注册要还原 | RegisterNatives + 汇聚点双 hook |
| 反调试/检测拦截 | 检测绕过表（root/属性/文件/命令） |

3. **改写**：
   - 替换占位符：包名/类名/方法名（精确匹配，Java 全限定名）
   - overload 精确匹配：目标方法多 overload 时逐一定义或按参数类型选
   - 保存 original 引用、带原 `this` 调用；输出 JSON（可打印 ASCII + hex 双格式）
   - 同一类多 hook 合并进一个 `.implementation`（缓存静默覆盖）

4. **验证**：
   ```sh
   frida -U -f <pkg> -l script.js --pause   # spawn + 停在早期代码前
   ```
   - 输出 JSON 可解析、目标行为符合预期（拦截到目标调用/绕过生效）
   - 失败 → 回步骤 2 重选模板或细化特征；崩溃 → 按 [[anti-dynamic-workflow]] 崩溃对照表定位

## 跨域联合

- [[re-frida]]：脚本执行（本技能产出 → re-frida 运行）
- [[re-mobile]] / [[re-android-native]]：移动目标场景衔接
- [[anti-dynamic-workflow]]：检测面与崩溃迭代法
- [[frida-scripts]]：模板素材库（re-frida references）
- [[analysis-contract]]：脚本输出按数据契约消费（证据存档）

## 常见坑与陷阱

- **overload 不匹配静默失效**：现象——hook 无输出；原因——目标方法 overload 签名与定义不符；对策——先 `Java.use(...).<method>.overloads` 列出全部重载再选
- **Java.use 缓存覆盖**：现象——多个 hook 只生效最后一个；原因——同类多次 `.implementation` 赋值静默覆盖；对策——合并进一个 hook
- **参数索引版本相关**：现象——native 参数读错；原因——目标版本字段/参数位次变化；对策——对照目标符号核实，不照搬经验值
- **不侦察就写脚本**：现象——脚本对不上目标；原因——跳过步骤 1；对策——先探后写
- **绕过类脚本只观察不持久化**：现象——测试后目标状态被改；原因——脚本含写操作；对策——脚本只做读取/日志，绕过仅用于观察

## 使用注意

- 全部在沙箱内执行（[[platform-tips]] 最高原则）
- 输出 JSON 供 [[analysis-contract]] 数据契约消费
