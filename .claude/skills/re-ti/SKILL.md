---
name: re-ti
description: >
  威胁情报查询与关联：VT/Any.run/hybrid-analysis、MISP。
  触发词：威胁情报、VirusTotal、Any.run、沙箱查询、MISP、样本关联
---

# 威胁情报查询与关联

## 何时使用 / 何时不用

- 用：拿到样本 hash / 域名 / IP 要查已知恶意背景（"这个样本是什么""哪个家族"）；沙箱报告解读；家族/团伙关联；MISP 事件关联；情报进报告
- 用：分析完成后用情报验证结论（[[re-malware]] / [[re-forensics]] 的线索需要外部佐证）
- 不用：只想跑行为分析——那走 [[re-sandbox]] / [[re-behavior]]，沙箱查询只是情报手段之一
- 不用：纯离线环境无外网（只能做静态本地匹配）；VT 无结果≠干净（见坑 1）

## 工具准备

本技能以查询/解读为主，不运行样本；上传到沙箱的动态执行须在 [[re-sandbox]] 内（默认沙箱最高原则，见 [[platform-tips]]）。

### VirusTotal（核心查询，网页 + API）

- 网页: https://www.virustotal.com/ —— 查 hash/域名/IP，无安装
- API key: https://www.virustotal.com/gui/my-apikey 生成；存环境变量 `VT_API_KEY`（`export VT_API_KEY=...`，Windows 用 `setx`）
- 验证: `[ -n "$VT_API_KEY" ] && echo ok`；带 key 请求返回 JSON（401/403 说明 key 无效或配额用完）
- 隐私注意：查私有样本前确认数据策略——VT 是共享情报，上传会向第三方公开，内部样本先问归属/权限（见坑 2）

### curl —— API 请求

- Linux: `apt install curl` / `dnf install curl` / `pacman -S curl`（多数自带）
- macOS: 自带
- Windows/WSL: Windows 10+ 自带 curl.exe；WSL 用 Linux 包
- 验证: `curl --version`

### Any.run / hybrid-analysis（沙箱报告，网页）

- Any.run: https://any.run/ 注册即可查/提交（网页交互式沙箱，有公开报告库）
- hybrid-analysis: https://www.hybrid-analysis.com/ 注册即可查/提交（API 免费额度）
- 无安装；上传样本前同样确认数据公开策略

### MISP（可选，团队自建情报库）

- 部署（Linux）: `docker run -d --name misp -p 8080:80 harvarditsecurity/misp`（社区镜像，正式部署按官方文档）
- 验证: 浏览器打开 https://localhost:8080 能登录（默认账号 admin@admin.test / admin）
- 没有现成 MISP 实例时跳过本环节，不阻塞查询

### jq（可选，解析 API JSON）

- Linux: `apt install jq` / `dnf install jq` / `pacman -S jq`
- macOS: `brew install jq`
- Windows: `winget install jqlang.jq`
- 验证: `jq --version`

## 操作步骤

按顺序执行；步骤 1-3 对每个线索（hash/域名/IP）都过一遍，记下结果与查询时间（证据）。

1. **哈希/域名/IP 查询（VT）**：
   ```sh
   curl -s --request GET \
     --url "https://www.virustotal.com/api/v3/search?query=<sha256_or_domain_or_ip>" \
     -H "x-apikey: $VT_API_KEY" | jq '.data[0].attributes | {last_analysis_stats, names, tags, popular_threat_category}'
   ```
   - 网页同样可查：hash 页看检测数（`last_analysis_stats` 的 malicious 计数）、厂商命中、tags、popular_threat_category
   - 域名/IP 页看解析记录、历史检测、关联样本；查不到检测不直接判干净（见坑 1）
   - 隐私选项：上传/查询私有对象用 VT 的私有 API（企业版）或先确认数据公开风险（见坑 2）

2. **沙箱报告解读（Any.run / hybrid-analysis）**：
   - 查询: 在 Any.run/hybrid-analysis 搜同一 hash，找公开报告；提交新样本执行须在 [[re-sandbox]] 隔离环境内（网络隔离 INetSim/fake DNS，见 [[platform-tips]] 最高原则）
   - hybrid-analysis API（key 在个人 profile 的 API key 页生成，请求头 `api-key`）：
     ```sh
     curl -s -H "api-key: $HA_API_KEY" \
       "https://hybrid-analysis.com/api/v2/search/hash?hash=<sha256>" | jq '{sha256s, verdicts: [.reports[].verdict]}'
     ```
   - Any.run 有 API（api.any.run，key 在 profile 生成），端点与鉴权以官方文档为准；未配置 key 时网页查询同样可用
   - 解读三块:
     - **行为**: 启动的进程树（有无注入/镂空）、持久化动作（Run 键/计划任务/服务）、文件操作（写哪、删哪）
     - **网络**: 回连域名/IP/端口、DNS 解析、请求 URL（对照 [[re-behavior]] 的捕获）
     - **文件操作**: 释放的文件与 hash（dropper 落盘产物，进 [[re-ioc]]）
   - 记录报告编号与截图时间戳作为证据；报告不可全信（见坑 3）

3. **家族/团伙关联（VT graph、tag）**：
   ```sh
   curl -s --request GET \
     --url "https://www.virustotal.com/api/v3/files/<sha256>/graphs" \
     -H "x-apikey: $VT_API_KEY" | jq '.data[].type' | sort -u
   ```
   - 端点注意：关联图端点是 `/graphs`（复数）——`/graph` 是 API v2 时代的路径，v3 返回 404
   - VT hash 页的关联: 同 C2 域名/同签名/同互斥体命中的其他样本、`popular_threat_category`（如 "trojan.agent"）与 family 标签
   - tags 与 graph 把样本归到家族——写进报告时标注依据（哪些厂商归的、关联靠什么属性）
   - 家族名以多厂商一致为准，单厂商命名只做参考

4. **MISP 事件关联（如有实例）**：
   ```sh
   # 查询事件的属性（hash/域名/IP）——POST + JSON body
   curl -s --request POST "https://<misp>/events/restSearch" \
     -H "Authorization: <MISP_API_KEY>" \
     -H "Accept: application/json" \
     -H "Content-Type: application/json" \
     --data-binary '{"returnFormat":"json","value":"<sha256>"}' | jq '.response[]?.Event | {info, date, orgc}'
   ```
   - body 必须原样 JSON（`--data-urlencode` 会把它 URL 编码，MISP 解析不到 value）；`value` 传字符串
   - 响应形如 `{"response": [{"Event": {...}}]}`——jq 用 `.response[]?.Event` 展开；不同 MISP 版本响应结构有差异（见 [[gotchas]]）
   - 命中说明组织内已标记过该样本/基础设施——引用事件编号（event ID）作为内部证据
   - 没实例就跳过，此步不阻塞结论

5. **情报进报告（衔接 [[re-ioc]]）**：
   - 汇总: 每个线索一行——类型（hash/域名/IP）、VT 检测数、家族/分类、关联样本、来源（报告编号/事件 ID）、查询时间
   - 情报直接进 [[re-ioc]] 报告: IOC 列表（外部确认的恶意指标 + 可信度）、摘要段的家族判定依据、结论段引外部情报佐证
   - 只写结论不写来源等于没查（证据链要求，见坑 4）

## 跨域联合

- [[re-forensics]]：本网关工作流第 4 步——本技能是情报关联环节
- [[re-malware]]：恶意样本分析第 6 步前用本技能佐证家族/判定；反沙箱样本的静态情报尤其依赖本技能
- [[re-behavior]]：步骤 2 解读沙箱报告的基线来自行为分析产物（进程/网络/文件对照）
- [[re-ioc]]：步骤 5 情报汇总进 IOC 列表与报告（衔接）
- [[re-sandbox]]：本技能动态执行必须在其内（默认沙箱最高原则，见 [[platform-tips]]）
- 回传 [[re-analyze]]：按 RE_REPORT 偏好把情报摘要写进最终报告

## 常见坑与陷阱

- **私有样本 VT 无结果 ≠ 干净**：现象——查某个 hash 检测数为 0 或报"not found"，据此判定无害；原因——VT 只有公开库，私有/未公开样本查不到是常态（也可能是新样本未收录）；对策——无结果只标"未见记录"并注明查询时间，用 [[re-behavior]] / [[re-mem-forensics]] 的实际行为证据下结论；多渠道交叉（Any.run/hybrid-analysis/MISP）后再定性
- **上传私有样本泄露情报**：现象——内部样本/客户样本传上 VT/Any.run 后对外公开，触发保密问题；原因——沙箱与 VT 默认共享数据（公开报告）；对策——上传前确认数据策略：VT 用私有 API（企业）或先脱敏（去 PII 后上传），任何.run/hybrid-analysis 选 private 分析（如有），拿不准先问归属方
- **沙箱报告不可全信（反沙箱样本）**：现象——沙箱报告显示"无恶意行为/进程退出"，但实际环境检测到回连；原因——样本检测到沙箱特征（VM 硬件、调试器、网络环境）后休眠/走正常分支，报告是假的阴性；对策——结合 [[re-behavior]] 真实环境结果与 [[re-mem-forensics]] 内存残留交叉验证；反沙箱样本靠静态深挖（[[re-binary-core]]）与内存线索
- **API 配额/限速**：现象——VT 免费 key 请求返回 403/429，或者批量查询中途被限；原因——免费 key 有日配额与分钟限速，批量脚本不打间隔必触发；对策——脚本循环内 sleep（如 15 秒）、用 `/search` 批量聚合、配额耗尽换网页查询或等重置；jq 只取需要的字段减少请求次数
- **哈希误报需多重确认**：现象——某个厂商把良性文件标成恶意（hash 误报），或哈希命中但样本内容不匹配（改名/拼接的旧哈希）；原因——单厂商签名粒度粗、VT 聚合统计不加权，原始 hash 与文件内容没有强绑定验证；对策——"恶意"判定看多厂商一致 + 家族标签 + 行为证据，不认单厂商；查询前先对本地文件重算 sha256 与查询值核对（防错 hash 查询）
- 端点速查与操作序列见 [[commands]]；API 版本与数据质量坑见 [[gotchas]]
