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
- 导入反编译器: `goresym_rename.py`（GoReSym 官方仓库脚本，Ghidra/IDA 导入，PR #11 已合入）
- 验证: `GoReSym -about` 输出 about 与 license 信息；输出 JSON 含函数名/地址

### redress（Go 二进制元数据，可选）

- 无发行版官方包 → 官方安装: `go install github.com/goretk/redress@latest`
- 用法: `redress info sample`（编译器版本/GoRoot/main 包路径）、`redress packages sample --std --vendor`（包列表）、`redress source sample`（源码树投影）、`redress types struct sample --methods`（类型）
- 验证: `redress version`

### garble —— Go 混淆识别（恶意样本常见，无独立工具）

- garble 是 Go 官方团队维护的混淆器（构建期变换，非运行时壳）——Go 恶意样本越来越常见，需先识别再分析
- **识别特征**：①字符串/节表含 `garble` 标识或 `garble` 版本串 ②`-dwarf=false` 构建无 DWARF（`readelf -S` 无 `.debug_*`）③函数名 hash 化（`main.main` → 短 hash 名，pclntab 保留但名字不可读）④`-literals` 构建字符串乱码
- **常见构建标志**：`garble -dwarf=false -literals build`（去调试 + 字符串混淆；另有 `-tiny` 去生成名/内联信息）
- 分析要点见步骤 3（hash 函数名 / runtime string decrypt / interface wrapper）

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
   - pclntab magic 直接判版本段：`.gopclntab` 开头 4 字节 `0xfffffffb` = Go 1.2–1.15、`0xfffffffa` = 1.16–1.17、`0xfffffff0` = 1.18–1.19、`0xfffffff1` = 1.20+（头部布局见步骤 6；GoReSym 等工具按这四个值扫描）

3. **符号表利用**：
   - **工具选择（目标 → 工具）**：
     - 恢复函数名（strip 后符号）→ **GoReSym**：`GoReSym -p sample > gosyms.json` → `goresym_rename.py` 导入反编译器恢复命名
     - 类型恢复（结构体字段/接口/方法签名）→ **redress**：`redress types struct sample --methods`（或 GoReSym `-t` 输出类型信息）
     - 版本识别 → buildinfo（`go version -m` / `go tool buildid`）+ pclntab magic（步骤 2）——不需要符号工具
   - Go 默认保留符号（除非 `-ldflags "-s -w"`）：`nm sample | grep ' main\.'` 列出用户代码函数
   - Ghidra 导入后函数树按包分组；注意 ELF 入口点 `_rt0_amd64_linux` 只是平台桩，真正用户入口是 `main.main`（由 `runtime.main` 调用），`main.init` 是初始化逻辑
   - 反编译 `main.main` 读主逻辑，从 `main.` 命名函数沿调用链展开；符号全保留时无需猜名
   - **garble 混淆样本**（恶意 Go 样本常见，见工具准备）：pclntab 仍可解析但函数名 hash 化——GoReSym 列出 hash 名，结构/调用链仍可用；`-literals` 字符串在 init 中解密，运行后内存取明文或静态还原解密循环；interface wrapper 使调用链多一层间接，沿 wrapper 到真实实现

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

6. **运行时结构要点（pclntab / goroutine 栈 / buildinfo）**：
   - pclntab 头（1.20+ 布局）：magic(4) + pad1 + pad2 + minLC + ptrSize + nfunc(8) + nfiles(8) + 保留(8) + funcnameOffset(8) + cuOffset(8) + filetabOffset(8) + pctabOffset(8) + pclnOffset(8)；funcnameOffset 指向函数名字符串池，pctab 是 PC→行号表——1.18/1.19 与 1.20+ 的 pcHeader 同为 72 字节（debug/gosym ver118/ver120 同一解析分支；1.20 差异是 textStart 字段改保留 + 符号名加冒号）；真正更短的头在 ≤1.17（ver116 无 textStart 字段）；1.18 的 Go118PCLnTabMagic 变更了 functab 偏移（func 数据入口从地址改偏移），工具按 magic 分派
   - goroutine 栈：g 结构（runtime 私有）首字段 `stack{lo, hi}` 即栈区间，`stackguard0` 是栈增长检查阈值——每个函数序言的 `runtime.morestack` 检查的是它（噪声来源），`sched.gobuf` 保存挂起时的 sp/pc；dlv 的 `goroutines`/`goroutine <n> stack` 输出即来自这些字段，挂起点在 `runtime.gopark` 恢复
   - buildinfo 手工解析：`.go.buildinfo` 内嵌 `\xff Go buildinf:`（14 字节）+ ptrSize(1) + 字节序标记(1)，16 字节对齐；`go version -m` 失效时按此魔数提取版本与 module 信息（与 go tool 同源，解码失败才是真没有）
   - 平台差异：Windows Go 产物是 PE 但节名与符号体系相同（`.gopclntab`/`.go.buildinfo` 都在），nm/GoReSym/redress 在 Linux 上可直接分析 PE Go 样本；入口桩符号随平台（Linux `_rt0_amd64_linux`、Windows `_rt0_amd64_windows`、macOS `_rt0_amd64_darwin`），都只是跳到 runtime.main

## 跨域联合

- [[re-binary-core]]：本技能由 core 网关引用——初勘 [[re-triage]]、格式 [[re-format-elf]]/[[re-format-pe]]、反编译底座 [[re-ghidra]]/[[re-ida]]、库指纹 [[re-imports]]
- [[re-ghidra]] / [[re-ida]]：Go 符号/类型恢复产物（GoReSym JSON、redress types）导入反编译器
- 动态侧：沙箱内 [[re-gdb]]/[[re-tracing]]；Go 程序调试首选 dlv（goroutine 感知）
- 恶意场景：Go 恶意样本（C2、loader）静态按本技能还原 → 行为分析转 [[re-malware]]
- [[platform-tips]] 相关分支：静态优先（大型样本）、动态默认沙箱、跨平台 Go 样本（Windows PE Go 在 Linux 侧走 Wine 分支）

## 常见坑与陷阱

- **strip 后符号全丢，恢复难**：现象——`nm` 无输出、Ghidra 函数全 `sub_*`、找不到 `main.main`；原因——`-ldflags "-s -w"` 或发布流程 strip 掉 symtab/DWARF（pclntab 数据仍在，只是没有符号引用它）；对策——GoReSym/redress 从 `.gopclntab`（节定位失败则按 pclntab magic 字节扫描）恢复函数名/地址 → `goresym_rename.py` 导入 Ghidra/IDA；garble 等混淆会混淆函数名（pclntab 结构保留、函数边界仍可恢复，但名字无意义）→ 需 GoResolver/GoStringUngarbler 配合，必要时退化为 strings + 动态行为分析
- **二进制巨大，runtime 占大头**：现象——Ghidra 导入几万函数、自动分析卡顿、`runtime.*` 淹没目标；原因——Go 静态链接 runtime（调度/GC/内存管理）+ 每函数 morestack 栈检查，通常占 1-2MB+；对策——符号恢复后先过滤：`nm | grep ' main\.'`、GoReSym JSON `grep '^main\.'` 缩小到用户代码；Ghidra 只对目标函数按需反编译；遵循 platform-tips「静态优先（大型样本）」——先静态定位、动态按需补充
- **goroutine 入口识别**：现象——反编译看不到线性主流程，只见 `runtime.gopark`/`schedule` 调度调用；原因——用户代码以多个 goroutine 并发（`go` 关键字/`runtime.newproc` 派生），无单一主路径，执行顺序由调度器决定；对策——在 `runtime.newproc` 调用点读 funcval 参数得入口地址；入口返回后走 `runtime.goexit`；动态用 dlv（沙箱内）`goroutines` 列出并看各 goroutine 栈
- **逃逸分析影响栈布局**：现象——源码里的局部变量不在栈上，变成 `runtime.newobject` + 堆指针；原因——Go 编译器逃逸分析把逃逸对象移到堆（GC 管理），栈帧不含预期局部变量；对策——别按 C 风格从栈帧找局部变量；跟踪 newobject 返回的堆指针与类型（GoReSym `-t`/redress `types` 恢复类型结构），对象字段按恢复的类型布局读取
- **buildinfo 版本指纹有门槛**：现象——`go version -m` 报错或无输出，无法确定 Go 版本；原因——buildinfo（`.go.buildinfo`）自 Go 1.18 才默认嵌入，旧版或被裁剪的二进制没有；对策——`go tool buildid` 一直可用（拿 build ID）；旧版看 `strings | grep '^go1\.'` 的 `runtime.buildVersion`；`redress info` 也能按 pclntab 布局推断编译器版本
- **自定义结构序列化数据（gob）**：现象——程序数据段是"字节流"但反编译显示用 `encoding/gob` 解码；原因——作者用 gob 编码自定义结构（配置/VM 程序/内嵌对象），`LoadProgram` 类函数里 `gob.NewDecoder` + `Decode` 就是入口；对策——从反编译重建结构体（字段名/字段数从 gob 流里的类型定义提取），**用 Go 生成同结构样本对比字节**（逐字节比对类型定义段，字段名/类型/数量一目了然），字段名损坏（材料/编码导致缺字节）时 gob 按字段号越界报错，可改本地 gob 源码做宽松解码（跳过字段号检查）逼近数据
- **LD_PRELOAD 对 Go 程序无效**：现象——hook libc 函数（execve/openat）拦截不到 Go 程序的调用；原因——Go 直接 syscall（不经过 libc 符号），LD_PRELOAD 只劫持 libc 动态符号；对策——hook **子进程**（bash 等 C 程序调用的 libc 符号）或 hook 更底层（seccomp/strace 观察真实 syscall）；Go 程序执行的 `exec.Command` 会 fork 子进程，子进程（bash/ls）仍走 libc，可被 LD_PRELOAD 拦截
- **运行时行为重放（伪服务端）**：现象——Go 恶意程序逻辑复杂但需要网络交互（IRC/HTTP 服务端）才能触发；原因——程序是客户端（信标/C2 bot），离线静态分析看不到完整行为；对策——**伪造服务端重放**：DNS hook（getaddrinfo 劫持域名→127.0.0.1）+ 假 IRC/HTTP 服务器（按 pcap 提取的真实交互序列重放），让程序自己跑完逻辑链；注意握手时序（等 bot JOIN 完成再发消息）与消息格式（bot 按名字/频道校验消息）
- **Garble 混淆的 Go 二进制**：现象——stripped + 随机函数名 + 字符串全空；原因——Garble 同时混淆函数名与字符串；对策——GoReSym 恢复 pclntab（函数边界不受名字混淆影响）→ GoResolver CFG 签名恢复标准库名 → GoStringUngarbler 批量解密字符串 → 从解密串找 C2/密钥
- **Go 加密密钥定位**：现象——找不到 AES 密钥；原因——密钥运行时从多个常量拼接；对策——跟踪 `crypto/aes.NewCipher`（或 `crypto/cipher.NewGCM`）第一个参数来源，回溯拼接点
- **Go 接口调用看不懂**：现象——反编译的 interface 调用是间接跳转；原因——Go interface 经 itab 分派；对策——定位 itab 表手动标注接口类型
- **符号可用但签名缺失**：现象——函数名有、参数/类型没有；原因——新版本 Go 产物不带完整符号信息；对策——接受函数名可用、签名靠其他证据（配置反序列化类型/调用点）重建
- **字符串噪声大**：现象——恢复的字符串混入大量标准库常量；原因——Go 标准库字符串常量；对策——按包级别过滤后再筛业务字符串
- **源码重建原则**：现象——逐行还原不现实；原因——产物无源码对应；对策——按包重建可读代码、保留逻辑而非逐行一致（逻辑优先）
- **cgo 混合产物，C 部分无 Go 命名**：现象——`nm` 里混着一批裸名符号（`printf`、`pthread_*`），与 `main.`/`runtime.` 风格不一致；原因——cgo 把 C 代码/静态库直接链接进 Go 二进制，C 符号不参与 Go 命名体系；对策——按命名风格分片：Go 侧（`main.`/包名.）走本技能，C 侧裸名符号走 [[re-binary-core]]（[[re-imports]] 库指纹）；cgo 块通常只做薄封装，主逻辑仍在 Go 侧
- **Windows PE Go 样本在 Linux 上直接静态分析**：现象——`file` 报 PE、Ghidra 导入后入口不是 `_rt0_amd64_linux`，误以为需要 Windows 环境；原因——Go 产物跨平台结构一致，只是容器格式（PE/Mach-O/ELF）不同；对策——nm/GoReSym/redress 照常用（符号表与 pclntab 与平台无关），入口按平台认（Windows 侧 PE 入口指向 `_rt0_amd64_windows` 桩）；动态侧才需要 Windows/Wine（[[platform-tips]] 分支）
（来源：reverse-skill field-journal，MIT）
