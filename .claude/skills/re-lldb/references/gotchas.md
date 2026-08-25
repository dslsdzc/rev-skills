# lldb 工具特有坑与边界

## macOS 权限栈（attach 前置，逐层排查）

- **TCC（隐私与安全性 > 开发者工具）**：非授权终端 attach 报 `permission denied` 或静默失败——系统设置手动授权后重启终端；弹窗无法命令行绕过
- **DevToolsSecurity**：旧系统（10.14 前）还需 `sudo DevToolsSecurity -enable`；新系统此命令已非必需
- **task_for_pid entitlement**：调试器进程需要 task_for_pid 权限——普通终端下 lldb 依赖 Developer Tools 授权链，越狱/企业环境另有路径（属 [[re-mobile]] 域）
- **Hardened Runtime**：目标启用 Hardened Runtime（macOS 10.14.4+）时调试 API 受限（如 `get-task-allow` 缺失）——目标先重签（`codesign -f -s -` 或带 `com.apple.security.get-task-allow` entitlement，见 [[re-format-macho]]）
- **SIP**：`csrutil status` 确认；SIP 关闭只影响系统保护进程 attach，普通目标不用动
- 排查顺序: TCC 授权 → DevToolsSecurity → csrutil → 目标签名/entitlement——逐层排除，别一上来关 SIP

## 版本差异

- **Xcode lldb vs llvm.org lldb**：Xcode 自带版本与上游 llvm 版本不同步（版本号差异大）；`brew install llvm` 的 lldb 新于系统版，功能/API 更新——脚本依赖以实际版本为准
- **Swift 工具链 lldb**：Swift 表达式求值支持最好；无 Swift 需求的逆向场景用系统/llvm 版即可
- **Python API 兼容**：`lldb.SBDebugger` API 跨版本大体稳定但偶有增减——`lldb -s` 批处理脚本比 Python 脚本跨版本更稳
- **Linux 发行版 lldb 版本滞后**：apt/dnf/pacman 的 lldb 版本落后上游——需要新特性时用 llvm.org 官方二进制或 brew

## 调试行为坑

- **表达式求值有副作用**：`expr` 会真实执行代码（调用函数、写内存、触发消息发送）——在 hook 点乱求值可能改变目标行为甚至崩溃；只读验证用 `frame variable`
- **条件断点永远不命中**：条件里引用了未加载符号/类型时会静默失败——先无条件断确认能停，再逐级加条件
- **ASLR 基址漂移**：macOS 默认开启随机基址——每次 `run` 后 `image list` 基址都变；脚本硬编码地址失效，用符号断点或 `image list -o` 换算
- **stripped 目标没有 `-n` 断点**：`breakpoint set -n` 找不到符号——用 `image lookup -a` 反查地址归属，或对 `-rn` 正则碰运气；地址断点 + `image list -o` 换算
- **`memory read` 格式冲突**：不同宽度/格式混用时报 `invalid format`——显式 `-s 4 -f x` 一组组给
- **attach 后目标冻结**：附加后目标默认暂停（SIGSTOP）——`continue` 才恢复；忘记 continue 会以为目标卡死
- **wow64 类场景（32 位目标）**：64 位 lldb 调试 32 位 macOS 目标正常（系统自带 32 位支持），但 `expr` 的指针宽度按 64 位算——按目标位数写表达式

## 反调试与边界

- **ptrace 检测**：目标可调 `ptrace(PT_DENY_ATTACH)` 拒绝附加（启动即拒绝）——先静态定位（[[re-format-macho]] / [[re-ida]] 找 ptrace 调用），patch 掉后再调试
- **调试器特征检测**：`sysctl`/`task_info` 枚举调试标志——检测点先静态处理（见 [[re-anti-analysis]]）
- **内核调试门槛高**：macOS 内核调试需 KDK 版本匹配 + 开发内核启动参数——普通逆向不划算，别在用户态调试上耗时间
- **iOS 远程调试**：`platform select remote-ios` + debugserver 需要签名/越狱环境——环境问题归 [[re-mobile]]，本技能只管命令层面

## 使用注意

- 全部在沙箱内执行（[[platform-tips]] 最高原则）；attach 需 Developer Tools 授权
- 目标为恶意样本时先静态初勘（[[re-triage]] 哈希/[[re-format-macho]] 结构）再动态
- 结论写 [[analysis-contract]]；符号/地址证据与 [[re-triage]] 初勘值对照
