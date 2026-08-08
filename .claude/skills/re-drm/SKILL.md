---
name: re-drm
description: >
  DRM 分析：PlayReady/Widevine 实现、许可证流程、解密器还原。
  触发词：DRM、PlayReady、Widevine、许可证、内容保护
---

# DRM 分析（PlayReady / Widevine / 许可证流程）

## 何时使用 / 何时不用

- 用：分析 DRM 系统（Widevine / PlayReady / FairPlay）的组件结构、许可证挑战/响应流程
- 用：理解播放器/CDM（内容解密模块）如何管理密钥与解密内容（授权研究）
- 用：DRM 漏洞/弱点研究（密钥提取、解密流程绕过等，**限授权环境**）并负责任披露
- 不用：普通内容保护理解/协议逆向（那是 [[re-protocol]] 域）
- 不用：样本没有 DRM 只是普通加密（[[re-crypto-*]] 系列）
- 不用：制作盗版工具 / 提取密钥用于盗版分发（**明确禁止，见授权边界**）
- **授权边界（必读）**：本技能仅限授权研究——自有设备、自有内容、实验室环境、已获书面许可的安全研究。禁止：提取/分发用于盗版的内容密钥、发布可用密钥提取工具、绕过 DRM 获取未授权内容。DRM 分析涉及反规避法律（如 DMCA 1201 类）与平台 ToS，分析以漏洞研究 + 防御视角产出，发现走负责任披露（厂商安全团队/漏洞奖励计划），敏感细节（密钥材料）不写入公开报告。

## 工具准备

静态分析（CDM 反编译 / 抓包分析）免沙箱；运行 CDM 与抓许可证流量属动态执行，在受控环境（[[platform-tips]] 最高原则）内进行。所有工具先验证再使用。

### 反编译工作台（[[re-ghidra]]）—— CDM/解密器分析

- [[re-ghidra]]（默认）：导入 CDM 二进制（Widevine CDM 是带导出表的 ELF so）与播放器二进制
- [[re-ida]]：备选；验证: 导入 libwidevinecdm.so 后能反编译 `Initialize`/`CreateSession` 类导出
- CDM 获取（自有环境）：Chrome 的 Widevine CDM 在 `~/.config/google-chrome/WidevineCdm/`（Linux）/ `%LOCALAPPDATA%\Google\Chrome\User Data\WidevineCdm`（Windows）/ `~/Library/...`（macOS）；Edge 的 PlayReady 同理

### 网络捕获（[[re-netcap]]）—— 许可证挑战/响应

- tshark/wireshark/mitmproxy 安装见 [[re-netcap]]「工具准备」
- 验证: `tshark --version`；`mitmdump --version`
- HTTPS 解密按 [[re-netcap]] 步骤 4（mitmproxy CA 装入受控环境）

### CDM 分析辅助工具（Widevine L3 设备，研究用途）

- 无独立发行版包：Widevine L3 CDM（软件实现）的分析工具来自社区研究（GitHub 检索 Widevine L3 相关研究仓库，如 pywidevine），安装 `pip install pywidevine`（只用于自有设备授权研究）
- 验证: `python3 -c "import pywidevine; print(pywidevine.__version__)"`
- 用途与边界：只分析自有设备/自有内容；密钥材料不出现在报告中（见坑 3）

## 操作步骤

按顺序执行，每步产物（组件清单、许可证流程笔记、CDM 结构笔记）记录证据路径 + sha256（见 [[re-triage]]），供报告引用。**所有步骤在授权范围与受控环境内进行**（授权边界见「何时使用」）。

1. **DRM 组件识别（CDM / 解密器）**：
   - 播放器/浏览器侧：EME API（`requestMediaKeySystemAccess("com.widevine.alpha")` / `"com.microsoft.playready"`）→ 定位 DRM 类型与 CDM 路径
   - CDM 组件：`libwidevinecdm.so`（Chrome 内置；**后缀标注的是架构**——`-arm`/`-arm64`/`-x86`/`-x64` 为 CPU 架构而非安全等级，L1/L3 取决于设备 TEE 信任根，无 TEE 的 ARM 设备同样跑 L3 软件实现，见坑 1）；PlayReady 组件在 Edge/Windows 系统组件；FairPlay 在 Apple 侧（[[re-ios]] 域）
   - 记录：DRM 类型、CDM 路径与版本、文件 sha256（版本锚点，坑 4）

2. **许可证流程还原（挑战 / 响应）**：
   ```sh
   # 受控环境内播放一段自有内容，mitmproxy/tshark 捕获许可证请求
   tshark -r license.pcap -Y 'http.request' -T fields -e http.host -e http.request.uri | head
   # 典型流程：初始化 → license challenge（POST，含设备指纹/证书）→ license response（含密钥材料）
   ```
   - Widevine：license 请求/响应是 protobuf；PlayReady：SOAP/XML（`LicenseAcquisition`）；内容元数据里通常带 license URL（PSSH box / manifest 字段）
   - 还原：challenge 里有什么（设备证书/非对称密钥公钥/会话 ID）→ 服务端如何验设备 → 响应里封装了什么（内容密钥 CEK 的密文 + 权限策略）
   - 产物：许可证流程图（发起方 → 挑战 → 响应 → 密钥解出）+ 各步格式与字段笔记

3. **解密器实现分析（密钥管理）**：
   - CDM 静态（[[re-ghidra]]）：导出函数还原（`Initialize`、`CreateSession`、`UpdateSession`（处理许可证响应）、`Decrypt`）→ 找密钥存储与解密路径
   - 密钥分层（见坑 2）：设备密钥（device key，L3 软件密钥存于 CDM 内/持久化存储）→ 解密许可证响应拿到内容密钥（CEK）→ CEK 解密媒体；分析"哪一步解出什么密钥"
   - 解密算法识别：AES-CBC / AES-CTR 等（[[re-crypto-id]] 常量表指纹思路），CENC（Common Encryption）样本格式
   - 产物：密钥链图（每层密钥来源与保护方式）+ 解密调用路径

4. **漏洞 / 弱点定位（授权研究）**：
   - 常见研究面：L3 设备密钥提取（软件密钥从 CDM 内存/持久化存储提取）、许可证响应验证缺失、防回滚（CDM 版本检查）绕过、解密前完整性校验缺失
   - 方法：静态定位（密钥解密/加载函数）→ 动态观察（受控环境内断点/插桩看密钥材料流向）→ 验证边界（什么条件下能解出什么）
   - **发现后负责任披露**：记录复现条件与影响评估，提交厂商安全团队/漏洞奖励计划；不公开 PoC 细节
   - 产物：发现清单（条件/影响/披露状态）

5. **报告（合规）**：
   - 报告结构：授权范围声明 → 组件清单（CDM 版本/哈希）→ 许可证流程图 → 解密器/密钥管理结构 → 发现与披露计划 → 防御建议
   - 合规要点：不包含密钥材料与可用提取工具；ToS/法律边界声明（DMCA 1201 类反规避条款）；结论以漏洞研究/防御视角表述
   - 产物：报告存档（sha256）

## 跨域联合

- [[re-ghidra]]：CDM 与播放器反编译工作台（结构标注 / 脚本化分析）
- [[re-netcap]]：许可证挑战/响应捕获（mitmproxy 解密 HTTPS，[[re-protocol]] 第 1 步联动）
- [[re-protocol]]：许可证协议还原（challenge/response 结构、protobuf/SOAP 解析）
- [[re-crypto-id]] / [[re-crypto-keys]] / [[re-crypto-decrypt]]：加密算法识别、密钥材料定位、密文还原
- [[re-android-native]] / [[re-ios]]：移动端 CDM（Android 侧 Widevine 集成、FairPlay/Apple 侧）——设备侧 DRM 的延伸
- [[re-sandbox]] / [[platform-tips]]：动态执行（播放自有内容/抓包）受控环境最高原则

## 常见坑与陷阱

- **L1/L3 等级差异（硬件 vs 软件）**：现象——同一个 Widevine CDM 相关样本，在 A 设备能分析的密钥结构/流程在 B 设备完全对不上，或按 L3 思路分析 L1 目标处处碰壁；原因——安全级别不同：L1 密钥在 TEE（可信执行环境）硬件中保护，L3 是纯软件 CDM 可提取可分析；架构标识：`libwidevinecdm.so` 的后缀标注的是**架构**（`-arm`/`-arm64`/`-x86`/`-x64`）而非安全等级——L1/L3 取决于设备 TEE 信任根（带 TEE 的 ARM 设备才是 L1，无 TEE 的 ARM 设备同样跑 L3，x86 平台一般只有 L3）；PlayReady 同样分硬件信任根与软件实现；对策——先确认目标安全级别（设备能力/厂商文档），L3 才能做软件层密钥提取分析，L1 分析走 TEE/信任根方向（硬件安全）；结论严格标注级别，不跨级别套用
- **密钥分层（设备 / 内容）**：现象——费劲拿到一个"密钥"，拿去解媒体内容却解不开；原因——DRM 是分层密钥体系：设备密钥（device key）解密许可证响应 → 得到内容密钥（CEK），CEK 才用于解密媒体；拿到的是中间某一层，或 CEK 还被权限策略（输出保护等）约束；对策——先完整还原许可证流程（步骤 2：challenge 里的设备公钥/证书、response 里的 CEK 密文），再进解密器分析（步骤 3）确认每一层"哪来的、解什么"；按密钥链图核对拿到的密钥属于哪一层，缺哪层补哪层
- **法律与 ToS 边界（仅研究）**：现象——研究产物（提取脚本、密钥材料）被用于盗版分发，研究者承担法律后果（DMCA 1201 类反规避责任、平台 ToS 违约）；原因——DRM 分析产物天然可用作盗版工具，密钥提取与绕过行为可能直接违反反规避法律；对策——严格限定自有设备/自有内容/书面授权实验室；报告只写"机制如何工作"与"如何防御"，不写可复现的密钥提取步骤、不附密钥材料；发现走负责任披露（厂商漏洞奖励）；拿不准的边界先查授权文件再动
- **DRM 更新频繁（结论过期）**：现象——CDM 更新后提取/分析手段全部失效，密钥轮换后旧结论作废；原因——CDM 定期更新并轮换密钥、加固反提取（加壳/混淆/密钥在内存生命周期短）；对策——记录 CDM 精确版本 + 文件 sha256 + 分析时间（步骤 1）；分析方法（流程还原、结构分析、分层建模）跨版本复用，具体密钥/偏移/签名不跨版本复用；分析结论按"结构/流程"组织而非"某个密钥值"
