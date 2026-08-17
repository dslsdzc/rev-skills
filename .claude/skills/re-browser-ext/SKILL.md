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
- 不用：网页 JS 混淆（[[re-script-deob]] 覆盖纯脚本）

## 工具准备

### unzip / 7z（解包）

- 安装与验证见 [[re-doc-malware]] 工具准备（7z）

### jq（manifest 解析）

- Linux: `apt install jq`；macOS: `brew install jq`；Windows: 官方构建
- 验证: `jq --version`

### node（扩展脚本运行/验证，可选）

- 各平台安装见 [[re-python]] 工具准备模式（node 官方安装包）
- 验证: `node --version`

## 操作步骤

按顺序执行，每步产物存档（路径 + sha256，见 [[re-triage]]）。

1. **解包与结构**：
   ```sh
   unzip sample.crx -d ext/          # crx/xpi = zip 容器
   jq '.permissions, .host_permissions' ext/manifest.json
   ```
   - 结构：manifest.json + 背景脚本（background/service_worker）+ 内容脚本（content_scripts）+ 页面
   - 权限清单：`permissions`（API 权限）、`host_permissions`（站点访问）——权限决定能力边界

2. **恶意行为定位**：
   - 数据外泄：fetch/XHR/beacon（[[re-netcap]] 衔接）、`navigator.sendBeacon`、图片像素外传
   - 权限滥用：tabs（读取页面）、storage（数据收集）、webRequest（流量篡改/监控）、clipboard（剪贴板窃取）
   - 注入面：content_scripts 匹配站点、动态注入（`chrome.scripting.executeScript`）
   - 后台脚本是核心（MV3 的 service worker / MV2 的 background page）

3. **混淆还原**：
   - 衔接 [[re-script-deob]] 高级混淆对抗（bootstrap/字符串表/CFF）
   - 远程代码：MV2 允许远程 JS（`eval`/动态加载）；MV3 禁止远程 JS（远程代码是审查绕过信号）

4. **上架审查绕过面分析**：
   - 动态加载（运行时拉取代码——MV2 特征）
   - obfuscation 检测规避（代码混淆超过阈值触发审查）
   - 多阶段（无害首版 + 更新后恶意——版本对比 [[re-variant]] 思路）

## 跨域联合

- [[re-managed]] 网关：本技能归属（选择树「浏览器扩展」分支）
- [[re-script-deob]]：混淆还原
- [[re-netcap]]：网络行为衔接
- [[re-variant]]：扩展版本对比（更新后恶意检测）

## 常见坑与陷阱

- **manifest 版本差异**：现象——MV2 分析思路套 MV3 失效；原因——权限模型不同（MV3 禁远程代码/后台改 service worker）；对策——先确认 manifest_version
- **远程代码策略**：现象——静态找不到恶意逻辑；原因——代码远程拉取（MV2）；对策——网络侧抓取（[[re-netcap]]）后还原
- **动态注入绕过静态分析**：现象——content_scripts 无恶意但行为异常；原因——运行时注入；对策——hook 注入 API（scripting.executeScript）
- **沙箱与页面隔离**：现象——扩展 API 调用点难定位；原因——扩展上下文与页面上下文隔离；对策——分上下文分析（background/content/page）
- **更新后恶意**：现象——首版干净；原因——版本更新注入恶意；对策——版本 diff（[[re-variant]]）
