---
name: re-browser-ext
type: atomic
description: >
  浏览器扩展逆向：权限清单、恶意行为定位、混淆还原、上架审查绕过面。
  触发词：浏览器扩展、Chrome扩展、Firefox扩展、恶意扩展、extension。
---

# 浏览器扩展逆向

## 何时使用 / 何时不用

- 用：扩展文件（crx/xpi/zip）、恶意扩展行为分析、扩展权限审计
- 用：判断扩展是否过度授权、远程代码、更新投毒（首版干净后续版本恶意）
- 不用：网页 JS 混淆（[[re-script-deob]] 覆盖纯脚本）
- 不用：Chrome/Edge 浏览器本身的漏洞利用（扩展与浏览器漏洞是两个对象）
- 注意：动态加载扩展跑恶意行为属执行未知代码——沙箱内进行（[[re-sandbox]]，[[platform-tips]] 最高原则）

## 工具准备

### unzip / 7z / python zipfile（解包）

- 安装与验证见 [[re-doc-malware]] 工具准备（7z）
- crx = "Cr24" 头（版本号 + 头长度；crx2 含公钥与签名、crx3 含 protobuf 头与 proof）+ 尾部 zip 数据——`unzip`/`7z` 直接解包会报 `extra bytes at beginning` 警告但结果正确；`python3 -m zipfile -e sample.crx ext/` 无警告
- xpi 就是纯 zip，直接解

### jq（manifest 解析）

- Linux: `apt install jq`；macOS: `brew install jq`；Windows: 官方构建
- 验证: `jq --version`

### node / js-beautify（脚本还原）

- Linux: `apt install nodejs`；macOS: `brew install node`；Windows: nodejs.org 官方安装包；验证: `node --version`
- js-beautify: `npm install -g js-beautify`，验证 `js-beautify --version`（压缩 JS 先格式化再读）

### 浏览器加载验证（动态，沙箱）

- Chromium 系: `chrome://extensions` 开发者模式 → Load unpacked；Edge 同（`edge://extensions`）
- Firefox: `about:debugging#/runtime/this-firefox` → Load Temporary Add-on（免签名临时加载）
- 验证: 扩展出现在扩展列表、后台脚本/页面能打开

## 操作步骤

按顺序执行，每步产物存档（路径 + sha256，见 [[re-triage]]）。

1. **解包与结构**：
   ```sh
   unzip -o sample.crx -d ext/ 2>/dev/null || python3 -m zipfile -e sample.crx ext/
   jq '.manifest_version, .name, .version' ext/manifest.json
   jq '.permissions, .host_permissions' ext/manifest.json
   # host_permissions 为 MV3 字段；MV2 站点权限在 permissions 内（含 URL 匹配模式）
   ```
   - 结构：manifest.json + 背景脚本（MV3 service worker / MV2 background page）+ 内容脚本（content_scripts）+ 页面（options/popup）+ 资源（web_accessible_resources）
   - 先确认 `manifest_version`（2 还是 3）——MV2/MV3 的权限模型与能力差异决定后续所有判断（见 [[gotchas]]）
   - 其他关键字段：`update_url`（自托管更新清单，投毒面）、`key`（扩展 ID 派生）、`externally_connectable`（外部页面消息通道）、`oauth2`（令牌）、`optional_permissions`（运行时再要权）、`minimum_chrome_version`（兼容边界）
   - 次要结构：`_locales/`（i18n 消息，可藏字符串）、`icons/`、`options_page` / `options_ui`、`commands`（快捷键，触发行为入口）、`incognito`（隐身窗口行为声明）

2. **权限审计（能力边界）**：
   - 高危 API 权限：`tabs`（读标签页 URL/标题）、`storage`（数据收集缓存）、`webRequest`（流量观察；MV3 阻断能力仅企业策略部署例外，一般改走 `declarativeNetRequest`）、`scripting`（MV3 动态注入）、`clipboardRead`（剪贴板）、`cookies`（读站点 Cookie）、`history`、`downloads`、`nativeMessaging`（与宿主程序通信）、`debugger`
   - 站点权限（host_permissions / MV2 permissions 内 URL 模式）决定能碰哪些网站的数据——`<all_urls>` 或 `*://*/*` 是高危信号
   - 权限与声明用途对照：装了 `storage`+`tabs`+`<all_urls>` 但功能只是改主题——越权信号
   - 权限风险速查（声明即能力，不必看代码）：

     | 权限 | 能力 | 恶意用途 |
     |---|---|---|
     | `tabs` + `<all_urls>` | 读标签页 URL/标题 | 浏览习惯收集 |
     | `storage` | 本地持久化 | 收集数据缓存/配置下发 |
     | `webRequest` / `declarativeNetRequest` | 流量观察/规则修改 | 监控、注入、拦截 |
     | `scripting` / `content_scripts` | 页面注入 | 键盘记录、表单窃取 |
     | `clipboardRead` | 读剪贴板 | 剪贴板内容窃取（如钱包地址） |
     | `cookies` | 读/写站点 Cookie | 会话劫持 |
     | `nativeMessaging` | 与宿主程序通信 | 落地可执行/外带数据 |
     | `downloads` | 读写下载 | 下载投毒/篡改下载文件 |

3. **恶意行为定位**：
   - 数据外泄：fetch/XHR/`navigator.sendBeacon`、图片像素外传（`new Image().src`）、`chrome.storage` 收集后批量上传（[[re-netcap]] 衔接）
   - 注入面：content_scripts 匹配站点、动态注入（MV3 `chrome.scripting.executeScript`；MV2 `tabs.executeScript`）、`web_accessible_resources` 开放页面供第三方站点调用
   - 键盘记录：content script 监听 keydown/input 并外传——搜索 `addEventListener('keydown'` 与 `value` 读取
   - 触发时机：`chrome.runtime.onInstalled` / `onStartup`（安装/启动即跑）、`chrome.alarms` / `setInterval`（定时任务）、`chrome.runtime.onMessage`（消息驱动）——按触发点还原调用链，别只看顶层代码
   - 后台脚本是核心：MV3 的 service worker / MV2 的 background page；MV3 service worker 空闲约 30 秒被终止、事件唤醒——状态在 `chrome.storage` 或 IndexedDB 落地，别在全局变量里找持久状态

4. **混淆还原**：
   - 衔接 [[re-script-deob]] 高级混淆对抗（bootstrap/字符串表/CFF）；压缩代码先 js-beautify 再读
   - 远程代码：MV2 允许远程 JS（`eval`/动态加载）；MV3 禁止远程代码（所有代码必须打包）——MV3 里出现远程拉取 = 审查绕过信号，重点标记
   - 二进制载荷：Wasm/ArrayBuffer 下载后分析（转 [[re-binary-core]] 初勘）
   - 字符串定位：`grep -rniE 'http|sendBeacon|fetch|XMLHttpRequest|chrome\.' ext/` 扫全包；i18n 字符串在 `_locales/*/messages.json`（消息外衣下藏真实 URL 常见）

5. **更新机制与版本投毒**：
   - Chrome 系：`update_url` 自托管更新清单（XML 指向新 crx）是投毒入口；商店自动更新同理
   - 版本对比：拉旧版本扩展与当前版本做 diff（文件清单/哈希/manifest/脚本），定位"何时引入恶意"（[[re-variant]] 思路）
   - Firefox：更新只经 AMO 渠道，`update_url` 不生效——投毒面不同

6. **动态验证**（沙箱）：
   - 加载到浏览器（工具准备），配好代理/抓包（[[re-netcap]]），触发功能看网络与存储变化
   - 分上下文分析：background / content script / 扩展页面 三套隔离上下文，API 调用点按上下文定位（坑 4）
   - 扩展页面/弹窗可直接开 DevTools（`chrome-extension://<id>/` 页面 F12）——配合断点看 service worker 内全局状态与网络调用
   - 行为记录与 [[re-ioc]] 指标提取（C2 域名、命令格式）衔接

## 跨域联合

- [[re-managed]] 网关：本技能归属（选择树「浏览器扩展」分支）
- [[re-script-deob]]：混淆还原
- [[re-netcap]]：网络行为衔接（外传/远程拉取）
- [[re-variant]]：扩展版本对比（更新后恶意检测）
- [[re-triage]]：解包物哈希/初勘存证

## 常见坑与陷阱

- **manifest 版本差异**：现象——MV2 分析思路套 MV3 失效；原因——权限模型不同（MV3 禁远程代码/后台改 service worker）；对策——先确认 manifest_version，按版本分支分析（见 [[gotchas]]）
- **远程代码策略**：现象——静态找不到恶意逻辑；原因——代码远程拉取（MV2）；对策——网络侧抓取（[[re-netcap]]）后还原
- **动态注入绕过静态分析**：现象——content_scripts 无恶意但行为异常；原因——运行时注入；对策——hook 注入 API（scripting.executeScript / tabs.executeScript）
- **沙箱与页面隔离**：现象——扩展 API 调用点难定位；原因——扩展上下文与页面上下文隔离；对策——分上下文分析（background/content/page），按 API 归属判断在哪个上下文执行
- **更新后恶意**：现象——首版干净；原因——版本更新注入恶意；对策——版本 diff（[[re-variant]]）
- **service worker 状态丢失**：现象——MV3 后台脚本里找不到持久数据；原因——service worker 空闲被终止，状态在存储层；对策——查 `chrome.storage`/IndexedDB 落地数据
- **Firefox MV3 差异**：现象——manifest 写了 `background.service_worker` 但 Firefox 里后台不跑；原因——Firefox MV3 不支持 service_worker 字段，用 `background.scripts` 事件页；对策——双字段写法（Chrome 用 service_worker、Firefox 用 scripts）按浏览器分别验证
- 更多 MV2/MV3 差异、crx 格式细节与审查绕过边界见 [[gotchas]] 与 [[decision-tree]]
