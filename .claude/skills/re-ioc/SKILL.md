---
name: re-ioc
description: >
  IOC 提取与 YARA 规则、报告结构。
  触发词：IOC、YARA、写规则、分析报告、hash列表
---

# IOC 提取与 YARA 规则

## 何时使用 / 何时不用

- 用：分析完成后产出 IOC 列表（hash/域名/IP/路径/互斥体）；写 YARA 规则做样本检测；按标准结构出分析报告
- 用：需要把行为证据整理成可复现、可分享的结论
- 不用：还没完成行为/静态分析（IOC 原料在 [[re-behavior]] / [[re-triage]] 产物里）
- 不用：用户只要一句话结论（仍建议至少给 IOC 与证据路径）

## 工具准备

本技能以静态处理为主（写规则/扫描文件），不运行样本；运行样本只在 [[re-sandbox]] 内（默认沙箱最高原则，见 [[platform-tips]]）。

### yara —— 规则引擎

- Linux: `apt install yara` / `dnf install yara` / `pacman -S yara`
- macOS: `brew install yara`
- Windows/WSL: `pip install yara-python`（Python 版，跨平台兜底）
- 验证: `yara --version`；Python: `python -c "import yara; print(yara.__version__)"`

### pefile —— PE 结构解析（写 PE 特征用）

- 全平台: `pip install pefile`
- 验证: `python -c "import pefile; print(pefile.__version__)"`

### VT / grep.app 查询（可选）

- VirusTotal: 网页 https://www.virustotal.com/ 查询 hash/域名；API key 环境变量:
  ```sh
  curl -s --request GET \
    --url "https://www.virustotal.com/api/v3/search?query=<sha256>" \
    -H "x-apikey: $VT_API_KEY" | python3 -m json.tool
  ```
  验证: 带 key 的请求返回 JSON（401 说明 key 无效）
- grep.app: 网页 https://grep.app/ 查公开代码中的特征字符串，无安装
- 注: 上传私有样本到 VT 前确认数据策略；grep.app 查询仅用于字符串/特征参考

### sha256sum / md5sum（IOC 哈希）

- 安装与验证见 [[re-triage]] 工具准备（coreutils / Get-FileHash）

## 操作步骤

按顺序执行，每步记下结果。

1. **提取 IOC（按来源分类）**：
   - 文件级: `sha256sum sample.exe`（sha256 为主，md5 仅辅助）；脱壳产物、dropper 落盘文件各算一份
   - 网络级: 行为日志（[[re-behavior]] 步骤 4）与 INetSim 记录中的域名、IP、端口；配置/内存里搜出的硬编码 URL（`strings sample | grep -iE 'http|https'`）
   - 系统级: 文件路径（持久化位置、落地路径）、互斥体名（CreateMutex 参数，用 [[re-ghidra]] / [[re-ida]] 查或 procmon 记录）
   - 每类 IOC 记来源证据（日志文件路径 + 行号/时间戳），供报告引用
   - 去重 + 标注可信度（来自行为证据 > 仅静态字符串）

2. **YARA 规则编写（特征选择 + 评分）**：
   - 特征选择标准：唯一性（只出现在该家族/样本）、稳定性（不随版本易变）、可区分（避开常见库字符串）
   - 常用特征类型：字符串（URL/域名/互斥体/机器码）、PE 结构（节名、导入）、字节模式（`{ 4D 5A 90 00 }` 或 `$a = { E8 ?? ?? ?? ?? }` 通配）
   - 评分（写注释标注，命中阈值参考）: 每个特征按信息量打分——唯一长字符串 +2、通用 API 名 +0.5、短字节模式 +1；总分 1/3 作为命中阈值参考，最终以验证为准
   - 示例:
     ```yara
     rule Win32_FamilyX_Dropper {
         meta:
             description = "FamilyX dropper 检测"
             author = "analyst"
             score = 4
         strings:
             $url = "http://c2.example.org" ascii wide
             $mutex = "Global\\FamilyX_mutex" ascii wide
             $pe   = { 4D 5A 90 00 }
         condition:
             uint16(0) == 0x5A4D and (2 of them)
     }
     ```
   - 规则名命名规范: 平台_家族_类型（如 `Win32_FamilyX_Dropper`）

3. **报告结构**（按五段写）：
   - 摘要: 一句话结论（样本是什么、判定恶意与否、主要行为）
   - 行为: [[re-behavior]] 的进程/持久化/文件/网络行为 + ATT&CK 映射表
   - 证据: 每一步产物路径 + sha256（样本、日志、内存转储、规则文件）——可复现的关键
   - IOC: 步骤 1 的分类列表 + 可信度
   - 结论: 处置建议（查杀 / 阻断域名 IP / 补丁建议）
   - 按 [[re-analyze]] 的 RE_REPORT 偏好决定格式（简要/完整）

4. **规则验证（yara 扫描样本）**：
   ```sh
   yara rule.yar sample.exe          # 命中 → 规则有效
   yara -s rule.yar sample.exe       # 显示命中的特征串，与样本实际内容核对
   yara rule.yar benign_samples/*    # 误报测试: 已知良性样本目录应 0 命中
   ```
   - 阳性对照：命中后 `yara -s` 核对命中串确属恶意特征
   - 阴性对照：良性样本目录不命中；命中即误报，回步骤 2 调整特征
   - 全库校验：把规则加入本地规则库，重扫全部已分析样本，确认无回归

## 跨域联合

- [[re-malware]]：工作流第 6 步——本技能是恶意样本分析的收尾（IOC 与报告）
- [[re-behavior]]：步骤 1 的 IOC 原料（网络级/系统级 IOC）来自行为分析产物
- [[re-protocol]]：C2 域名/IP/协议指纹进 IOC 列表与 YARA 特征
- [[re-anti-analysis]]：脱壳产物、壳指纹、加壳行为也可作为 YARA 特征来源
- 报告与规则回传给 [[re-analyze]]（按 RE_REPORT）与团队共享

## 常见坑与陷阱

- **特征选太泛 → 误报**：现象——规则命中大量无关文件（如只写了个 `http://` 或常见库字符串）；原因——特征不唯一，无评分与验证环节；对策——步骤 2 按唯一性选特征并打分，步骤 4 必须做良性样本阴性对照，误报即回改
- **只写 hash 不写行为特征**：现象——hash IOC 对新样本/变种全部失效；原因——hash 只覆盖单一样本，无法泛化到家族；对策——hash 之外至少给 YARA 规则或行为特征（互斥体/域名/字节模式），规则条件用 `2 of them` 而非单特征
- **报告缺证据路径不可复现**：现象——报告结论无法追溯（没有日志/样本路径与 hash）；原因——证据未存档或未写进报告；对策——步骤 3 报告的证据段必须逐项给路径 + sha256，IOC 与行为一一对应来源
