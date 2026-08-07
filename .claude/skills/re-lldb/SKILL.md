---
name: re-lldb
description: >
  lldb 调试（macOS/iOS）：attach、expr、image。
  触发词：lldb、macOS调试、iOS调试
---

# lldb 动态调试（macOS/iOS）

## 何时使用 / 何时不用

- 用：macOS/iOS 目标动态调试（attach/启动/断点/表达式求值/符号查找）
- 不用：Linux 目标（[[re-gdb]]）、Windows 目标（[[re-x64dbg]]）
- 不用：iOS 越狱/证书环境问题（属 [[re-mobile]] 域）；只读内存（[[re-memdump]] 默认转储优先）

## 工具准备

参考 [[platform-tips]] macOS 分支——SIP 与 TCC 限制 attach，需 Developer Tools 授权。

### lldb

- macOS: 自带（Xcode Command Line Tools: `xcode-select --install`）
- Linux: `apt install lldb` / `dnf install lldb` / `pacman -S lldb`
- macOS 更全: `brew install llvm`（含新版 lldb）
- 验证: `lldb --version`

### SIP 关闭或授权（attach 前置）

- 系统设置 > 隐私与安全性 > 开发者工具 > 授权使用 lldb 的终端（TCC 授权）
- 旧系统: `sudo DevToolsSecurity -enable`
- 说明: 一般不要关 SIP（可只对调试需求临时处理）；iOS 内核级调试需 KDK/开发内核，属 [[re-mobile]] 域

## 操作步骤

1. **Developer Tools 权限确认**：
   ```sh
   lldb -p <测试进程pid>   # 若报 "please check the developer mode" / 权限拒绝 → 去系统设置授权终端
   ```
   授权后重启终端；仍失败再检查 SIP 状态: `csrutil status`。
   注意: TCC 授权弹窗需在系统设置手动确认，无法命令行绕过。

2. **attach/启动**：
   ```
   (lldb) process attach --pid <pid>     # 附加
   (lldb) process attach --name Safari   # 按名字附加（需唯一）
   (lldb) target create ./sample         # 或直接启动
   (lldb) run --args arg1
   (lldb) continue / c
   ```
   iOS 设备: `platform select remote-ios` + `process connect connect://<device>`（需配合调试服务，越狱/证书要求见 [[re-mobile]]）

3. **`image lookup` 符号**：
   ```
   (lldb) image lookup -n main            # 按名字查符号
   (lldb) image lookup -a $pc             # 按地址查当前所在函数/源行
   (lldb) image list                      # 已加载镜像（dylib 基址表）
   (lldb) image lookup -rn dispatch       # 正则匹配符号
   ```
   stripped 二进制用 `image lookup -a` 反查地址归属模块，配合 `image dump symtab`

4. **内存表达式 `expr`**：
   ```
   (lldb) expr $rax
   (lldb) expr $rax = 0                   # 写寄存器
   (lldb) expr (char*)0x100000000         # 类型化读地址
   (lldb) expr -O -- @"hello"             # Objective-C 求值（objc 运行时）
   (lldb) memory read -c 20 -s 4 $rsp     # 读内存
   (lldb) memory write -s 1 0x100000000 0x90  # 写字节（绕过校验）
   ```

5. **断点脚本**：
   ```
   (lldb) breakpoint set -n main
   (lldb) breakpoint set -a 0x100004000 -c '*(int*)($rsp) == 0x1234'   # 条件断点
   (lldb) breakpoint command add 1
   > frame variable
   > expr $rax
   > continue
   > DONE
   ```
   Python 自动化: lldb 内置 Python——`script import lldb`，或用 `lldb -s script.lldb` 批处理。

## 跨域联合

- [[re-binary-core]]：工作流第 6 步（macOS/iOS 调试器）
- [[re-mobile]]：iOS App/越狱动态调试的底层工具
- [[re-format-macho]]：先解析结构再调试（入口/LC_MAIN 与签名状态）
- attach 失败时按 [[platform-tips]] 转 [[re-memdump]]

## 常见坑与陷阱

- **SIP/TCC 拦截 attach**：非授权终端 attach 被拒（`permission denied` 或静默失败）——去系统设置开发者工具授权；关闭 SIP 只在极端情况
- **权限弹窗需手动确认**：TCC 每次对新的调试目标弹窗，脚本化 attach 会被卡住——预先授权目标程序
- **内核调试需额外配置**：macOS 内核调试要 KDK 匹配版本 + 开发内核启动，普通逆向用不上，别在用户态调试上浪费时间
- **签名状态**: 修改过的 Mach-O 未重签无法运行（见 [[re-format-macho]]）——先 `codesign -f -s -` 重签再调试
- **task_for_pid entitlement/SIP/Hardened Runtime 三层限制**：现象——Developer Tools 已授权仍 attach 失败或目标启动即崩溃；原因——除 TCC 外还有三层：调试器需 task_for_pid entitlement，目标启用 Hardened Runtime 时调试 API 受限，SIP 限制系统进程 attach；对策——逐层排查（`csrutil status`、检查目标签名与 entitlement），测试目标可先去签名/重签（[[re-format-macho]]）再调试，参考 [[platform-tips]] macOS 分支
