---
name: re-go
description: Go 二进制逆向：符号保留、字符串表、goroutine。触发词：Go、golang、Go二进制、goroutine、go build
---

# Go 二进制逆向（符号 / 字符串表 / goroutine）

## 何时使用 / 何时不用

- 用：确认是 Go 编译的二进制（`file` 输出 Go BuildID / 节表含 `.gopclntab`）后，利用 Go 默认保留符号的特性还原逻辑；识别 Go 版本与构建信息；分析多 goroutine 程序的控制流；恢复 strip 后的 Go 符号
- 用：恶意 Go 样本（[[re-malware]] 静态还原——Go 恶意程序多带明文 C2 配置与 buildinfo）
- 不用：非 Go 原生程序（C/C++ 直接 [[re-binary-core]]；Rust 走 [[re-rust]]）
- 不用：确认带壳先走 [[re-anti-analysis]]（Go 二进制被加壳后 pclntab 偏移失效，脱壳后再回本技能）
- 注意：动态步骤默认沙箱（[[platform-tips]] 最高原则）；Go 二进制体积大，静态优先（大型样本原则）

## 工具准备

参考 [[platform-tips]]——Go 二进制通常 1MB 起（runtime 占大头），遵循「静态优先（大型样本）」；动态（dlv/gdb 运行样本）默认进沙箱。

### Go 工具链（go version / go tool buildid / go version -m）

- Debian/Ubuntu: `apt install golang-go`（官方包；Debian 版可能滞后——`go version -m` 的 buildinfo 指纹需 Go 1.18+，工具太旧可用官方 tarball）
- Fedora: `dnf install golang`；Arch: `pacman -S go`
- macOS: `brew install go`；Windows: `choco install golang` 或官方安装器
- 验证: `go version`；`go tool buildid sample` 能输出 build ID（非 Go 程序会报错）

### Ghidra（内置 Go 支持）与 Go 插件

- Ghidra 11.2+ 内置 Go 分析器（识别 Go 二进制、从 pclntab 恢复符号、runtime 类型标注），装法见 [[re-ghidra]]
- IDA 侧插件（可选）: GitHub `0xjiayu/go_parser`——IDA Pro 的 Go 解析脚本，恢复类型与结构体
- 验证: Ghidra 导入后函数树出现 `main.*`/`runtime.*` 命名

### GoReSym（strip 后符号恢复，可选但关键）

- 无发行版官方包 → 官方安装（需 Go 工具链）: `go install github.com/mandiant/GoReSym@latest`
- 用法: `GoReSym -t -d -p sample > gosyms.json`（-t 类型、-d 标准库包、-p 文件路径）
- 导入反编译器: `goresym_rename.py`（GoReSym 仓库脚本，社区版含 Ghidra 导入支持，见仓库 PR #11）
- 验证: `GoReSym -about` 输出版本；输出 JSON 含函数名/地址

### redress（Go 二进制元数据，可选）

- 无发行版官方包 → 官方安装: `go install github.com/goretk/redress@latest`
- 用法: `redress info sample`（编译器版本/GoRoot/main 包路径）、`redress packages sample --std --vendor`（包列表）、`redress source sample`（源码树投影）、`redress types struct sample --methods`（类型）
- 验证: `redress version`

### bloaty（体积分析，可选）

- Debian/Ubuntu: 无官方包 → GitHub `google/bloaty` release 或源码构建（cmake+ninja，需 protobuf）
- Fedora: `dnf install bloaty`；Arch: `pacman -S bloaty`；macOS: `brew install bloaty`
- Windows: 官方 release（或 WSL 内 Linux 版）
- 验证: `bloaty --version`；用法: `bloaty -d symbols sample`

## 操作步骤

按顺序执行，每步记录证据（路径 + sha256，见 [[re-triage]]）。

1. **识别 Go 二进制**：
   ```sh
   file sample                     # 含 "Go BuildID=..." 即 Go（通常静态链接）
   readelf -S sample | grep -i go  # .go.buildinfo / .gopclntab / .gosymtab
   nm sample | grep -E 'main\.main|runtime\.main'   # 符号存在性
   ```
   - `.gopclntab` 是函数表（含函数名/地址/行号），节名即判定依据
   - 确认符号保留状态：`nm` 为空 → 坑 1（strip）

2. **Go 版本指纹**：
   ```sh
   go tool buildid sample                # build ID（go build 唯一标识，一直可用）
   go version -m sample                  # Go 1.18+：Go 版本 + module 路径 + 依赖列表
   strings sample | grep -E '^go1\.[0-9]+'   # 旧版兜底：runtime.buildVersion
   ```
   - 版本决定 pclntab 布局与 GoReSym/redress 的解析方式；无 buildinfo → 坑 5
   - `go version -m` 的 module 路径直接给出项目名/依赖（恶意样本常泄露 C2 框架），先记下来

3. **符号表利用**：
   - Go 默认保留符号（除非 `-ldflags "-s -w"`）：`nm sample | grep ' main\.'` 列出用户代码函数
   - Ghidra 导入后函数树按包分组；注意 ELF 入口点 `_rt0_amd64_linux` 只是平台桩，真正用户入口是 `main.main`（由 `runtime.main` 调用），`main.init` 是初始化逻辑
   - 反编译 `main.main` 读主逻辑，从 `main.` 命名函数沿调用链展开；符号全保留时无需猜名
   - strip 后（坑 1）: GoReSym 生成 `gosyms.json` → `goresym_rename.py` 导入恢复命名

4. **字符串表**：
   ```sh
   strings -n 6 sample | grep -E '^main\.|/.*\.go'   # 函数名与源文件路径
   strings sample | grep -E 'go1\.|module |\.go$'
   ```
   - pclntab 内含函数名与源文件路径，`strings` 直接可见——先收集 `main.` 命名即调用关系草稿
   - 源路径揭示项目布局（如 `/home/user/c2/agent/main.go`）
   - Ghidra 中字符串交叉引用（Ctrl+Shift+F）回溯使用点（对应 [[re-binary-core]] R2 方法）

5. **goroutine/调度器理解**：
   - `go` 关键字在反编译中展开为 `runtime.newproc` 调用（内部再调 `newproc1`），其 funcval 参数指向的地址即该 goroutine 的入口函数
   - goroutine 入口函数返回后走 `runtime.goexit`；`runtime.gopark`/`runtime.gosched`/`runtime.schedule` 是调度与挂起点——看到它们不要当作主流程
   - 每个函数序言的 `runtime.morestack` 调用只是栈增长检查，忽略（噪声）
   - 动态（沙箱内）: dlv 对 Go 最友好——`go install github.com/go-delve/delve/cmd/dlv@latest`，`dlv attach <pid>` 后 `goroutines` 列出所有 goroutine、`goroutine <n> stack` 看栈；[[re-tracing]] 的 strace 观察并发系统调用

## 跨域联合

- [[re-binary-core]]：本技能由 core 网关引用——初勘 [[re-triage]]、格式 [[re-format-elf]]/[[re-format-pe]]、反编译底座 [[re-ghidra]]/[[re-ida]]、库指纹 [[re-imports]]
- [[re-ghidra]] / [[re-ida]]：Go 符号/类型恢复产物（GoReSym JSON、redress types）导入反编译器
- 动态侧：沙箱内 [[re-gdb]]/[[re-tracing]]；Go 程序调试首选 dlv（goroutine 感知）
- 恶意场景：Go 恶意样本（C2、loader）静态按本技能还原 → 行为分析转 [[re-malware]]
- [[platform-tips]] 相关分支：静态优先（大型样本）、动态默认沙箱、跨平台 Go 样本（Windows PE Go 在 Linux 侧走 Wine 分支）

## 常见坑与陷阱

- **strip 后符号全丢，恢复难**：现象——`nm` 无输出、Ghidra 函数全 `sub_*`、找不到 `main.main`；原因——`-ldflags "-s -w"` 或发布流程 strip 掉 symtab/DWARF（pclntab 数据仍在，只是没有符号引用它）；对策——GoReSym/redress 从 `.gopclntab`（节定位失败则按 pclntab magic 字节扫描）恢复函数名/地址 → `goresym_rename.py` 导入 Ghidra/IDA；garble 等混淆连 pclntab 一并破坏 → 工具失效，退化为 strings + 动态行为分析
- **二进制巨大，runtime 占大头**：现象——Ghidra 导入几万函数、自动分析卡顿、`runtime.*` 淹没目标；原因——Go 静态链接 runtime（调度/GC/内存管理）+ 每函数 morestack 栈检查，通常占 1-2MB+；对策——符号恢复后先过滤：`nm | grep ' main\.'`、GoReSym JSON `grep '^main\.'` 缩小到用户代码；Ghidra 只对目标函数按需反编译；遵循 platform-tips「静态优先（大型样本）」——先静态定位、动态按需补充
- **goroutine 入口识别**：现象——反编译看不到线性主流程，只见 `runtime.gopark`/`schedule` 调度调用；原因——用户代码以多个 goroutine 并发（`go` 关键字/`runtime.newproc` 派生），无单一主路径，执行顺序由调度器决定；对策——在 `runtime.newproc` 调用点读 funcval 参数得入口地址；入口返回后走 `runtime.goexit`；动态用 dlv（沙箱内）`goroutines` 列出并看各 goroutine 栈
- **逃逸分析影响栈布局**：现象——源码里的局部变量不在栈上，变成 `runtime.newobject` + 堆指针；原因——Go 编译器逃逸分析把逃逸对象移到堆（GC 管理），栈帧不含预期局部变量；对策——别按 C 风格从栈帧找局部变量；跟踪 newobject 返回的堆指针与类型（GoReSym `-t`/redress `types` 恢复类型结构），对象字段按恢复的类型布局读取
- **buildinfo 版本指纹有门槛**：现象——`go version -m` 报错或无输出，无法确定 Go 版本；原因——buildinfo（`.go.buildinfo`）自 Go 1.18 才默认嵌入，旧版或被裁剪的二进制没有；对策——`go tool buildid` 一直可用（拿 build ID）；旧版看 `strings | grep '^go1\.'` 的 `runtime.buildVersion`；`redress info` 也能按 pclntab 布局推断编译器版本
