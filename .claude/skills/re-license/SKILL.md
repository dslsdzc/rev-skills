---
name: re-license
description: 授权验证逻辑分析：注册校验定位。触发词：注册码、授权验证、license、序列号校验、破解定位
---

# 授权验证逻辑分析（注册校验定位）

## 何时使用 / 何时不用

- **边界（继承 [[re-cracking]]）**：仅限自有软件 / 授权测试 / CTF·研究环境；禁止未授权软件解锁与商业软件绕过；断点观察返回值等动态步骤前，用户须说明目标归属（所有权 / 测试授权 / 研究环境）
- 用：程序有注册 / 激活流程（输入序列号、注册码、授权文件），需要定位"在哪校验、怎么校验"
- 用：破解前置——为 [[re-patching]] / [[re-keygen]] 提供校验点地址与校验算法
- 用：判断授权是在线激活还是离线校验；识别机器码绑定、有效期 / 订阅型授权
- 不用：目标已定位校验分支、只改字节绕过（直接 [[re-patching]]）
- 不用：确认无授权机制（无注册 UI / 注册表 / 授权文件读取——诚实告诉用户，见坑 5）
- 不用：只做协议层分析（在线激活的流量分析走 [[re-protocol]]）
- 注意：样本带壳先脱壳（[[re-anti-analysis]]）；校验函数被混淆先 [[re-deobfuscate]]（见坑 1）；动态环节沙箱执行（[[re-sandbox]]，[[platform-tips]] 最高原则）

## 工具准备

### 调试器（按 OS）

- Linux / Wine 下调试 PE: [[re-gdb]] —— `apt install gdb` / `dnf install gdb` / `pacman -S gdb`，验证 `gdb --version`；**Wine 直读**：`wine sample.exe` 运行后 `gdb -p <pid>` attach（[[platform-tips]] Linux 分支）
- Windows: [[re-x64dbg]] —— 官方 release zip，attach 需管理员权限（[[platform-tips]] Windows 分支）；验证：载入样本能单步
- macOS: [[re-lldb]] —— `brew install lldb`，验证 `lldb --version`；attach 前检查 Developer Tools 授权（[[platform-tips]] macOS 分支）
- WSL: 无法 attach Windows 进程——跨边界分析走 Windows 侧工具，WSL 内只做静态（[[platform-tips]] WSL 分支）

### 反编译器（[[re-ghidra]] 等，交叉引用工作台）

- Ghidra: `apt install ghidra` / `dnf install ghidra` / `pacman -S ghidra` / `brew install --cask ghidra`，验证 `analyzeHeadless -help`（安装细节见 [[re-ghidra]]）
- 替代: [[re-ida]]（`idat64 -A` headless）、[[re-radare2]]（`apt install rizin`，验证 `rizin -v`）
- 作用：strings / API 的交叉引用（xref）是"谁在调用注册相关函数"的关键

### strings —— 可打印串快速扫描（全平台）

- Linux: `apt install binutils` / `dnf install binutils` / `pacman -S binutils`（多数自带）
- macOS: 系统自带 /usr/bin/strings
- Windows/WSL: WSL 内 Linux 版；Windows 本机用 Sysinternals `strings.exe`
- 验证: `strings --version`

### 动态补充（可选）：strace / ltrace / ProcMon

- Linux: `apt install strace ltrace`，验证 `strace --version`；观察注册表（Wine 下）/ 文件 / API 调用（详见 [[re-tracing]]）
- Windows: Sysinternals Process Monitor（官网下载独立 exe，无包管理器）——注册表 / 文件 / 进程 / 网络全量 trace（[[re-behavior]] 衔接）；注册表操作是授权读取的主路径

## 操作步骤

按顺序执行，每步记录结果（校验点地址 + 证据路径，见 [[re-triage]]）。产物：**全部校验点清单 + 校验算法**，交给 [[re-patching]] / [[re-keygen]]。

1. **字符串 / API 交叉引用定位校验函数**：
   ```sh
   strings -n 5 sample.exe | grep -iE 'register|serial|license|invalid|activation|trial|key' | head -50
   strings -el sample.exe | grep -iE 'register|serial|license' | head -20    # UTF-16LE（Windows 常见）
   ```
   - 反编译器里对命中字符串查 xref（Ghidra 右键 Find References / IDA `x` / rizin `axt @ str.*`）——看它被哪个函数引用：**弹窗/输入框附近的引用函数就是候选校验函数**（MessageBox 类"Invalid registration code"、注册对话框、注册表读取 `RegOpenKeyExW` / `RegQueryValueExW`、`GetVolumeInformationW` 机器码读取）
   - API 侧：导入表搜 `MessageBox` / `Reg*` / `GetVolumeInformation` / `GetSystemTimeAsFileTime`，反编译引用函数；Linux 目标用 ltrace 观察 `strcmp` / 文件读取调用（[[re-tracing]]）
   - 记下每个候选函数的地址与文件名（可能多个校验函数，见坑 3）

2. **调用图与校验分支（成功 / 失败跳转）**：
   - 反编译校验函数，确认结构：读输入（序列号字符串 / 注册表值）→ 计算 / 比较 → **按结果跳转**（`jz` / `jnz` 到成功或失败处理）。失败路径特征：MessageBox 报错、置注册标志为假、调用 `ExitProcess`
   - 找注册标志：全局变量（0/1）在成功路径置 1，功能代码检查它；xref 该标志可找出**所有**消费它的功能校验点（不只启动校验，见坑 3）
   - 动态确认（沙箱内，[[platform-tips]] 最高原则）：调试器断在校验函数返回处看返回值与跳转方向——[[re-gdb]]：`break <addr>` 后 `si` 跟跳转；[[re-x64dbg]]：`bp <addr>` 后看标志位
   - 产物：每个校验点的 地址 / 调用方 / 成功-失败分支地址 / 注册标志

3. **算法还原（对比 / 解密 / 签名验证）**：
   - **对比型**：`strcmp` / 逐字节比较 → 序列号与固定值或动态派生值比较，还原派生计算（可能是 [[re-crypto-id]] 的 XOR / 查表 / 简单变换）
   - **解密型**：序列号先解密（XOR / base64 / 自实现）再比对 → 还原解密为生成步骤（XOR 对称可直接逆；查表求逆映射）
   - **签名验证型**：`RSA_verify` / `ECC` 验签 → 算法不可逆，正推生成不可能 → 报告给网关转 [[re-patching]]（见坑 4）
   - 用 [[re-crypto-id]] / [[re-crypto-decrypt]] 思路还原加解密环节；反编译伪代码转成独立脚本验证一遍（对已知合法序列号，程序行为与脚本结果一致）

4. **在线激活 vs 离线校验区分**：
   - 特征：导入表含网络 API（WinINet `InternetOpen*` / `WinHttp*` / `socket`）、激活流程有"输入序列号 → 联网 → 返回激活码"、字符串含服务器 URL / "activation failed"
   - 在线激活：本地只校验响应格式（伪校验），真实验证在服务器 → 转 [[re-protocol]]（[[re-netcap]] 沙箱抓包 + [[re-crypto-id]] [[re-crypto-keys]] [[re-crypto-decrypt]] 处理加密）；本地侧只处理响应校验与离线回退逻辑
   - 离线校验：算法完全在本地，正常走步骤 3 还原
   - 区分方法：断网运行（沙箱断网）看激活是否失败/超时（[[re-sandbox]] 网络隔离）

5. **机器码绑定识别**：
   - 搜索导入/调用：`GetVolumeInformationW`（卷序列号）、`GetComputerNameW`、`GetUserProfileDirectoryW`、Windows 注册表 `MachineGuid`、Linux `/etc/machine-id` 读取
   - 确认序列号生成 / 校验输入含机器码：反编译看校验函数是否先读机器码再参与运算
   - 绑定确认后：**注册机生成逻辑必须含输入**（用户名 / 机器码参数化，见 [[re-keygen]] 坑 2）；报告里注明"此授权绑定机器码"

6. **授权模型识别（处置路线决定）**：
   - **节点锁定**（机器绑定）：序列号 = f(机器码) → 可逆则 [[re-keygen]] 路线
   - **有效期 / 订阅型**：校验到期时间 → 时间型校验分支（步骤 7）；到期提示字符串（"expired"/"trial"）xref 定位
   - **功能开关型**（freemium）：校验点散在各功能入口，注册标志多个 → 全量清单必须完整（坑 3）
   - **浮动授权**（许可证服务器）：本地无完整校验 → 转 [[re-protocol]] 分析许可证协议
   - 模型判定依据：授权文件 / 注册表项内容（含到期日期字段 = 订阅型；含机器码哈希 = 节点锁定）

7. **时间型校验（有效期）**：
   - 时间读取 API：Windows `GetSystemTimeAsFileTime` / `GetLocalTime`，Linux `time()` / `gettimeofday`——xref 到比较逻辑（`> 到期时间`）
   - 反篡改：程序可能记录"上次运行时间"并检测时钟回拨（当前时间 < 上次记录 → 报错）——改动系统时间前先定位该检测点
   - 产物：到期时间存储位置（注册表 / 文件）、比较函数地址——补丁或绕过目标

8. **证据核对（收尾）**：
   - 全量校验点清单（地址 / 分支 / 标志 / 证据级别）入档 [[analysis-contract]]；结论按证据分级标注（动态确认 vs 静态推断，见 [[decision-tree]]）
   - 交付：校验点清单 + 算法文档 → [[re-cracking]] 网关统一验证

## 跨域联合

- [[re-cracking]]：本网关是 re-cracking 工作流第 2 步（授权定位），产物（校验点清单 + 算法）供第 4 / 5 步
- [[re-patching]]：下游——拿到校验点地址后改分支 / 跳过校验
- [[re-keygen]]：下游——拿到校验算法后逆推生成逻辑
- [[re-anti-analysis]]：带壳样本先脱壳（OEP 后再分析）；校验函数被混淆先 [[re-deobfuscate]]
- [[re-protocol]]：在线激活 → 抓包分析激活协议（netcap → crypto-id → crypto-keys → crypto-decrypt → proto-rev）
- [[re-binary-core]]：反编译工作台（[[re-ghidra]] / [[re-ida]] / [[re-radare2]]）
- 动态：[[re-gdb]] / [[re-x64dbg]] / [[re-lldb]]（断点看分支返回值）、[[re-tracing]]（strace / ltrace 看注册表 / 文件 / API 调用）、[[re-memdump]]（内存中的注册标志 / 校验结果）
- [[re-behavior]]：Windows 侧 ProcMon 注册表 / 文件行为 trace 衔接
- [[re-sandbox]]：动态定位与验证沙箱（[[platform-tips]] 最高原则）
- [[re-ioc]]：注册相关字符串 / 校验指纹可作 YARA 特征

## 常见坑与陷阱

- **校验函数被混淆 / 加密**：现象——定位到的校验函数反编译全是花指令 / 平坦化 / 字符串密文，看不出比较逻辑；原因——授权校验是重点保护对象，常叠加混淆；对策——先 [[re-deobfuscate]]（花指令清除 → 平坦化还原 → 字符串解密）再分析，不要硬啃密文
- **在线激活当离线破解**：现象——本地判定分支全改完，程序依然拒绝使用 / 功能锁死；原因——真实验证在服务器端（本地只有响应校验）；对策——步骤 4 先区分在线 / 离线（断网测试），在线转 [[re-protocol]] 抓包分析激活协议，本地侧只处理响应校验
- **校验可能多次（启动 + 功能点）**：现象——启动校验绕过成功，用核心功能时又弹注册；原因——校验点不止一个（启动、功能点、定时器、版本升级检查）；对策——步骤 2 遍历校验函数全部 xref / 注册标志的全部消费点，做全量校验点清单（这是 [[re-cracking]] 网关坑 2 的根源）
- **算法不可逆还硬还原**：现象——校验含 SHA / MD5 / RSA 验签，序列号生成逻辑无法正推；原因——单向函数；对策——诚实报告不可逆，转 [[re-patching]]（跳过验签 / 改分支），不要伪造"还原成功"
- **伪校验误导**：现象——改了判定分支程序照常退出 / 无效果；原因——改动点不是真正的授权判定（假分支 / 蜜罐校验，真判定在别处）；对策——动态断点确认每个分支真实影响注册标志与程序行为，再进补丁阶段
- **时间型校验漏判**：现象——改完所有序列号校验仍提示过期；原因——另有到期时间校验（订阅 / 试用）独立于序列号校验；对策——步骤 7 查时间 API xref 与到期存储位置，纳入全量清单
- 更多决策分支与边界（授权模型判定树 / 证据分级 / 时间篡改反例）见 [[decision-tree]] 与 [[gotchas]]
