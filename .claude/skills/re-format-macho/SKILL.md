---
name: re-format-macho
description: >
  Mach-O 格式解析：mach_header、LC_*、segment、dyld 信息。
  触发词：Mach-O、解析mac程序、dyld
---

# Mach-O 格式解析

## 何时使用 / 何时不用

- 用：目标是 macOS/iOS 的 Mach-O 二进制（可执行文件/.dylib/.bundle/Framework），需要理解结构、load commands、入口、代码签名
- 不用：PE（走 [[re-format-pe]]）、ELF（走 [[re-format-elf]]）
- 不用：只需函数逻辑（反编译技能）；iOS 越狱环境问题属 [[re-mobile]] 域

## 工具准备

参考 [[platform-tips]] macOS 分支——attach/调试受 SIP 与 TCC 限制；静态解析不受影响。

### otool（Apple 自带）

- macOS: Xcode Command Line Tools: `xcode-select --install`
- 验证: `otool --version`
- Linux 替代: `llvm-otool`（`apt install llvm` / `brew install llvm`）

### llvm-objdump（跨平台）

- macOS: `brew install llvm`；Linux: `apt install llvm` / `dnf install llvm` / `pacman -S llvm`
- 验证: `llvm-objdump --version`
- 用法: `llvm-objdump --macho --private-headers sample`

### jtool2（深入 Mach-O 结构，macOS）

- macOS: 从 GitHub（intezer/jtool2）clone 后 `make`，或下载 release 二进制
- 验证: `jtool2 -h sample` 输出 load commands

### codesign（代码签名检查，macOS 自带）

- 验证: `codesign --version`

## 操作步骤

1. **otool -h / -l：头与 load commands**：
   ```sh
   otool -h sample                 # magic/cputype（x86_64 / arm64）/ncmds
   otool -l sample | head -80      # 全部 load commands（LC_SEGMENT_64/LC_MAIN/LC_LOAD_DYLIB...）
   ```
   load commands 是 Mach-O 的"节表+导入表+入口"综合体——先看它再下结论。

2. **__TEXT/__DATA 段**：
   ```sh
   otool -l sample | grep -A8 'segname __TEXT'
   otool -l sample | grep -A8 'segname __DATA'
   llvm-objdump --macho --section-headers sample
   ```
   记录各段的 vmaddr/vmsize/fileoff；`__TEXT,__text` 是代码，`__DATA,__data` 是可写数据（GOT 等价物 `__DATA_CONST`）。

3. **LC_MAIN 入口**：
   ```sh
   otool -l sample | grep -A6 LC_MAIN
   ```
   `entryoff` 是入口相对文件头的偏移，入口 VA = __TEXT 基址 + entryoff。老二进制用 LC_UNIXTHREAD（寄存器 state 含入口）。

4. **dyld 环境变量注入点**：
   ```sh
   DYLD_PRINT_ENV=1 DYLD_PRINT_LIBRARIES=1 ./sample   # 沙箱内，观察加载库序列
   DYLD_INSERT_LIBRARIES=/tmp/hook.dylib ./sample     # 注入 dylib（分析辅助，必须沙箱）
   ```
   注意: SIP 开启时 DYLD_* 对受保护二进制无效；注入用于钩住库调用（配合 [[re-tracing]]）。

5. **代码签名检查**：
   ```sh
   codesign -dv sample 2>&1          # 看签名类型（adhoc / Apple Development / not signed）
   codesign --verify --deep sample   # 验证完整性
   jtool2 --sig sample | head -20    # 签名信息细节
   ```
   - `adhoc`：自签，可被修改后重签
   - Apple 签名：修改任何字节都会失效
   - 修改后需重签才能运行: `codesign -f -s - sample`（adhoc 重签）

## 跨域联合

- [[re-binary-core]]：工作流第 3 步，Mach-O 目标格式解析
- [[re-mobile]]：iOS App/越狱环境分析的前置（arm64 Mach-O 主二进制与 dylib）
- [[re-cracking]]：macOS 破解类任务
- 动态调试配合 [[re-lldb]]（SIP/TCC 限制见 [[platform-tips]]）

## 常见坑与陷阱

- **签名验证会拦调试**：修改过的二进制 codesign 校验失败无法运行——先 `codesign -f -s -` 重签（仅限自签/adhoc 场景）
- **iOS 上需越狱环境**：真机调试要开发者证书或越狱，模拟器进程受沙盒限制——静态解析可先行，动态部分交给 [[re-mobile]]
- **LC_LOAD_DYLIB 注入检测**：恶意 dylib 通过新增 LC_LOAD_DYLIB 实现持久化——`otool -L` 列表与签名时列表不一致是重要告警
- 通用二进制（Universal）含多架构片：先 `lipo -info sample` / `file` 确认架构，别对全片解析
