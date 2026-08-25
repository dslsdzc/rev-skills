# 浏览器扩展分析方法论坑与边界

## MV2 / MV3 差异组（最容易踩）

- **权限字段语义不同**：MV3 站点权限独立在 `host_permissions`，MV2 混在 `permissions` 内（URL 匹配模式）——只读一个字段会漏判一半权限边界
- **远程代码合法性相反**：MV2 允许远程 JS（动态加载/`eval`），MV3 一律禁止（所有代码必须打包随扩展分发）——"远程拉取代码"在 MV2 是常见能力、在 MV3 是审查绕过信号，证据强度随版本不同
- **后台形态不同**：MV2 是常驻 background page；MV3 是 service worker——MV3 worker 空闲约 30 秒被终止、事件唤醒，**全局变量状态丢失**；持久状态必然落在 `chrome.storage`/IndexedDB，静态分析别在全局变量里找持久数据
- **流量修改 API 换血**：MV2 `webRequest` blocking 可拦截修改；MV3 商店扩展一般只剩 `declarativeNetRequest`（声明式规则），webRequest 阻断仅企业策略部署的例外——MV3 里找不到 webRequest 拦截代码是正常的
- **executeScript 挪窝**：动态注入 MV2 是 `tabs.executeScript`，MV3 是 `scripting.executeScript`（需 `scripting` 权限）——按版本搜对应 API 名
- **action 统一**：MV2 的 `browser_action`/`page_action` 在 MV3 统一为 `action`——页面弹窗代码位置按版本不同

## 跨浏览器差异组（Chromium vs Firefox）

- **Firefox MV3 不支持 `background.service_worker`**：声明了也不执行（warning 后忽略），实际用 `background.scripts` 事件页——同一扩展在 Firefox 里后台可能根本不跑，动态验证要按浏览器分别做
- **更新渠道不同**：Chrome 系支持 `update_url` 自托管更新清单（投毒入口）；Firefox 更新只经 AMO 渠道，`update_url` 不生效——"自托管更新投毒"仅 Chromium 系成立
- **签名要求不同**：Firefox AMO 要求扩展签名（临时加载例外）；Chromium 系开发者模式可加载未打包目录——动态分析入口不同
- **扩展 ID 派生**：Chrome 扩展 ID 由 manifest `key` 字段公钥/打包签名派生；Firefox ID 在 manifest 的 `browser_specific_settings.gecko.id` 显式声明——找 ID 的位置不同

## 解包与格式组

- **crx 解包警告别当错误**：`unzip`/`7z` 对 crx 报 `extra bytes at beginning or within zipfile` 是正常（Cr24 头在前），结果可用；想无警告用 `python3 -m zipfile -e`
- **crx2/crx3 头差异**：crx2 头含公钥与签名（可变长），crx3 是 protobuf 头 + proof——头长度字段是 LE 4 字节，先读版本号再读头长度，别按固定偏移跳
- **xpi 与 zip 无头**：Firefox xpi 就是 zip，解包无警告——"解包报错"本身可作格式判定线索

## 审查绕过与反例组

- **无远程代码也有投毒面**：扩展更新机制（自托管/商店）本身就是远程代码通道——单版本静态干净 ≠ 安全，必须看更新链（反例：首版干净、更新后恶意是常见形态）
- **混淆不是恶意证据**：商店政策允许合理打包混淆，但高混淆 + 高危权限 + 少功能组合才是可疑信号——别单凭混淆下结论
- **`<all_urls>` 权限不是必然恶意**：部分合法功能（翻译/词典/脚本管理器）确实需要全站点权限——按"权限 vs 声明功能"对照判断，越权信号要结合行为
- **content script 的隔离上下文**：content script 与页面共享 DOM 但不共享 JS 环境——页面里找不到扩展注入的变量，扩展里也读不到页面全局；跨上下文证据链要按消息传递（runtime.sendMessage）还原

## 使用注意

- 动态加载与行为触发在沙箱内（[[re-sandbox]]，[[platform-tips]] 最高原则）；扩展以浏览器进程权限运行，未隔离环境不加载
- 分析结论按 [[decision-tree]] 证据分级标注，并注明浏览器族与版本范围
