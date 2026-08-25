# 威胁情报 API 端点速查与操作序列

查询源分工：VirusTotal（检测/关联主源）、hybrid-analysis（沙箱报告 API）、MISP（组织内部匹配）、Any.run（网页报告库，API 以官方文档为准）。所有端点以官方文档为最终依据（VT: docs.virustotal.com；MISP: 实例自身 /events/restSearch 行为；HA: hybrid-analysis.com/docs/api/v2）。

## 端点速查

### VirusTotal API v3（鉴权头 `x-apikey`）

| 用途 | 端点 |
|---|---|
| 通用搜索（hash/域名/IP/URL） | `GET https://www.virustotal.com/api/v3/search?query=<值>` |
| 文件检测对象 | `GET https://www.virustotal.com/api/v3/files/<sha256>` |
| 域名对象 | `GET https://www.virustotal.com/api/v3/domains/<domain>` |
| IP 对象 | `GET https://www.virustotal.com/api/v3/ip_addresses/<ip>` |
| 关联图（家族/基础设施） | `GET https://www.virustotal.com/api/v3/files/<sha256>/graphs`（复数 graphs，v2 的 /graph 已废弃） |
| 文件关联对象 | `GET https://www.virustotal.com/api/v3/files/<sha256>/related` |
| 文件行为摘要 | `GET https://www.virustotal.com/api/v3/files/<sha256>/behaviour_summary` |

通用请求模板（所有 GET 共用）：

```sh
curl -s --request GET --url "<端点>" -H "x-apikey: $VT_API_KEY" | jq '.data.attributes | {last_analysis_stats, names, tags, popular_threat_category}'
```

### hybrid-analysis API v2（鉴权头 `api-key`，base `https://hybrid-analysis.com/api/v2`）

| 用途 | 端点 |
|---|---|
| 按 hash 查报告 | `GET /search/hash?hash=<md5|sha1|sha256>`（返回 `{sha256s, reports[]}`，reports 含 verdict） |
| 概览 | `GET /overview/<sha256>` |
| 报告摘要 | `GET /report/<id>/summary` |
| 提交文件 | `POST /submit/file`（multipart，需 default 及以上权限 key） |

```sh
curl -s -H "api-key: $HA_API_KEY" "https://hybrid-analysis.com/api/v2/search/hash?hash=<sha256>" | jq '{sha256s, verdicts: [.reports[].verdict]}'
```

### MISP（鉴权头 `Authorization: <API_KEY>`）

| 用途 | 端点 |
|---|---|
| 按属性值搜事件 | `POST /events/restSearch`（body: `{"returnFormat":"json","value":"<值>"}`） |
| 按属性值搜属性 | `POST /attributes/restSearch`（同样式） |
| 按标签过滤 | body 加 `"tags": ["tag1", "!tag2"]`（`!` 排除） |
| 限制条数 | body 加 `"limit": 20, "page": 1` |

```sh
curl -s --request POST "https://<misp>/events/restSearch" \
  -H "Authorization: <MISP_API_KEY>" -H "Accept: application/json" \
  -H "Content-Type: application/json" \
  --data-binary '{"returnFormat":"json","value":"<sha256>"}' \
  | jq '.response[]?.Event | {info, date, orgc}'
```

### jq 常用提取

```sh
# 检测统计（malicious 计数与厂商数）
jq '.data.attributes.last_analysis_stats | {malicious, suspicious, undetected}'
# 首次/最后出现时间与提交名
jq '.data.attributes | {first_submission_date, last_submission_date, names: .names[0:3]}'
# graph 节点类型分布（关联来源）
jq '.data[].type' | sort | uniq -c | sort -rn
```

## 常用操作序列

### 1. 样本 hash 背景查询（第一步必做）

```
本地重算 sha256（与情报值核对）→ VT /search?query=<sha256> → 检测数 + tags + 家族
→ 无结果 → hybrid-analysis /search/hash 与 Any.run 网页再查 → 仍无 → 标"未见记录"+ 查询时间
```

### 2. 域名/IP 基础设施关联

```
VT /domains/<域名> 看解析记录与历史检测 → /ip_addresses/<ip> 看托管关系
→ VT hash 页关联样本（同 C2/同签名）→ 域名反查关联域名/样本 → 结果进 [[re-ioc]] 基础设施图
```

### 3. 家族归因（多源一致才定性）

```
VT tags + popular_threat_category + graph 关联 → hybrid-analysis verdict 对照
→ 多厂商一致 + 行为证据（[[re-behavior]]）→ 家族结论；单厂商命名只做参考
```

### 4. MISP 内部匹配（组织历史事件）

```
POST /events/restSearch value=<hash|域名|IP> → 命中则取 event ID/日期/orgc
→ 引用事件编号作为内部证据；未命中不阻塞外部情报结论
```

## 实现教训（内化）

- 查询值先本地核验：重算 sha256 再查，防"错 hash 查空"浪费时间
- 一次请求取全字段：jq 一次提取多个 attributes，别为每个字段单独请求（配额）
- 批量查询循环内加 sleep（如 15 秒）并记录每个查询时间戳——证据链要求"什么时间查到什么"
- 网页与 API 结果一致才落结论：API 返回结构与网页展示字段存在差异，敏感结论两边对照

## 使用注意

- 上传/查询前确认数据公开策略（私有样本先问归属，见 [[gotchas]]）
- 动态执行（提交沙箱）在 [[re-sandbox]] 内（[[platform-tips]] 最高原则）
- 情报入报告：IOC 列表 + 来源（报告编号/event ID）+ 查询时间（[[re-ioc]] 衔接）
