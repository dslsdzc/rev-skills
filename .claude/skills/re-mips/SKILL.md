---
name: re-mips
description: >
  MIPS 架构逆向与路由器固件分析方法论：延迟槽、$gp 调用约定、大小端判断、httpd 定位。
  触发词：MIPS、mipsel、路由器固件、嵌入式、延迟槽、big-endian、大端、小端、httpd、busybox
---

# MIPS 架构逆向（路由器固件）

## 何时使用 / 何时不用

- 用：MIPS 架构 ELF 样本/恶意软件（路由器、嵌入式设备固件中解出的可执行文件）
- 用：路由器固件内程序（web 后端、服务、工具类二进制）的逻辑分析
- 用：MIPS 大端（mips）/小端（mipsel）任意端序的二进制
- 不用：ARM / x86 等其他架构（通用底座 [[re-binary-core]]，本技能只补 MIPS 特有语义）
- 不用：只需解包固件看内容（走 [[re-fw-extract]]）
- 不用：只需分析文件系统/配置（走 [[re-fw-rootfs]]）
- 不用：需要整体运行固件（走 [[re-fw-emulate]]）

## 工具准备

所有工具先验证再使用。静态分析可免沙箱；qemu-user 动态执行默认沙箱 + 网络隔离（[[platform-tips]] 最高原则）。

### 反编译器（Ghidra / IDA 任选其一）

- Ghidra（内置 MIPS 处理器模块，mips / mipsel / mips64 / mips64el 变体齐全）：
  - Linux: 官方 release 包（需 JDK）；部分发行版仓库有 `apt install ghidra` / `pacman -S ghidra`
  - macOS: `brew install --cask ghidra`；Windows: 官方 zip
  - 验证: `analyzeHeadless -help`（headless 模式）或 GUI 导入 MIPS ELF
- IDA：商业版含 MIPS 模块；Freeware 版架构支持范围以官方页面为准
- 导入时确认处理器变体与端序正确（mips 大端 / mipsel 小端），选错全部错位

### binwalk / unblob —— 固件与内嵌文件扫描

- 同 [[re-fw-extract]] 工具准备：`pip install binwalk`（推荐）或发行版包；unblob: `pip install unblob`
- 验证: `binwalk --version`、`unblob --version`

### readelf / file —— 架构与字节序确认（binutils）

- Linux: binutils 自带（`apt install binutils` 等）；macOS: `brew install binutils` 或 LLVM 系 readelf；Windows: WSL 内
- 验证: `readelf --version`

### qemu-user —— MIPS 用户态仿真（动态验证）

- Linux: `apt install qemu-user` / `dnf install qemu-user` / `pacman -S qemu-user`
- macOS: `brew install qemu`（含用户态）；Windows/WSL: WSL 内 Linux 版
- 大小端是独立二进制：`qemu-mips`（大端）/ `qemu-mipsel`（小端），64 位为 `qemu-mips64` / `qemu-mips64el`
- 验证: `qemu-mips --version`、`qemu-mipsel --version`

### python3

- Linux: `apt install python3` / `dnf install python3` / `pacman -S python`
- macOS: 自带；Windows: 官方安装器
- 验证: `python3 --version`

## 操作步骤

按顺序执行，每步结果存档；步骤 5（动态执行）默认沙箱。

1. **前置：固件提取与架构确认**：
   - 固件整体文件 → [[re-fw-extract]] 解包；解出的文件系统 → [[re-fw-rootfs]]；解出的 ELF 继续本步骤
   - 架构确认：
     ```sh
     file target.elf               # 是否 MIPS + 端序提示
     readelf -h target.elf         # Machine=MIPS；Data=big-endian/little-endian
     readelf -A target.elf | head  # 子版本/ABI 附加信息
     ```
   - `file` 输出含 "MIPS" 才进入本技能流程；非 MIPS 转 [[re-binary-core]] 通用底座

2. **字节序判断（大端 / 小端）**：
   - `file` 输出 MSB → 大端（处理器变体 mips）；LSB → 小端（mipsel）
   - `readelf -h` 的 Data 字段直接给出端序；e_flags 含 ABI 信息（o32 / n32 / n64）
   - strings 可读性验证：大端数据在小端视角下字节反转（如魔数 `hsqs` 反序出现）
   - 确认后导入反编译器选对变体，后续 $gp、跳转目标、字符串偏移全程按该端序——端序选错则数据、指令、地址全部错位

3. **反编译注意（MIPS 特有语义）**：
   - **延迟槽（硬件特性）**：分支/跳转指令后紧跟的一条指令无条件执行（无论跳转与否，先执行再转移控制）；`beq` / `bne` / `j` / `jal` 后常见汇编器填充的 nop 或有用的指令；手读代码时把该指令同时计入跳转两路；补丁时分支后必须处理延迟槽（填 nop 或等价指令）；MIPS32r6 起取消延迟槽（r6 代码无此问题）
   - **调用约定**：$a0-$a3 传前 4 个参数（多余参数栈传）、$v0 返回值、$ra 返回地址（`jal` 自动写入）、$s0-$s7 被调用者保存、$t0-$t9 调用者保存；PIC 间接调用模式 `jalr $t9`（$t9 载入被调函数地址，函数开头常重载 $gp）
   - **$gp 与 .got**：$gp（r28）一般指向 .got 中间（常见 .got+0x7FF0，±32KB 偏移覆盖整个 GOT）；数据访问形如 `lw $t0, off($gp)` / `addiu $t0, $gp, off`；函数序言常见 `lui gp, %hi(...)` + `addiu gp, gp, %lo(...)` 重设 $gp
   - **-mlong-calls 跳板**：`j` / `jal` 立即数跳转只覆盖同 256MB 段（26 位地址左移 2 位），跨段调用由编译期生成 stub 跳板（先加载地址再 `jalr`）；看到成片 `lui + addiu + jalr` 三指令序列多为跳板，不要当业务逻辑
   - 反编译器（如 Ghidra）默认处理延迟槽与 GOT 引用，但剥离符号/静态链时 $gp 值需手工确认（见坑 3）

4. **路由器固件专项**：
   - **web 后端 httpd 定位**：rootfs 中找 httpd 系程序（httpd / mini_httpd / boa / lighttpd 及厂商改名版本）与 web 目录（www / htdocs / cgi-bin）；字符串搜 "GET " / "HTTP/1" / 响应头字符串定位主请求循环
   - **认证绕过 / 命令注入模式**：搜 `system(` / `popen(` / `exec` 调用点 → 回溯参数来源是否为 URL 参数或 CGI 字段；认证常见缺陷是后端信任可客户端控制的字段（cookie、Referer、固定口令）或硬编码口令比对
   - **busybox 集成命令识别**：busybox 多合一——多个 applet 共用同一 main，按 argv[0] 分发；定位方式：可运行时 `busybox --list`，静态时找符号表中 applet 表（`applet_names`）；单二进制内多 applet 逻辑，避免误判"一个函数处理一切"
   - **配置与密码哈希提取**：/etc/passwd、/etc/shadow、/etc/config 配置目录（开源路由系统常见）与 web 备份配置；密码哈希常见 `$1$`（MD5-crypt）、`$5$` / `$6$`（SHA-crypt）及自定义格式；备份配置常 base64 / gzip / 自定义打包（衔接 [[re-fw-rootfs]] 与 [[re-crypto-id]]）

5. **动态验证（沙箱）**：
   - 默认沙箱原则：qemu-user 跑 MIPS 程序前先进 [[re-sandbox]]（网络隔离 + 快照）
   - ```sh
     qemu-mips -L <rootfs路径> ./target           # 大端；小端用 qemu-mipsel
     qemu-mips -L <rootfs路径> -strace ./target   # 系统调用跟踪
     qemu-mips -L <rootfs路径> -E <ENV=val> ./target
     ```
   - `-L` 指定 rootfs 作为动态加载器/库来源（MIPS 程序常依赖固件内 libc 与配置）
   - 动态只作行为验证（文件/网络/配置读取），主逻辑以静态为主

## 跨域联合

- [[re-firmware]]：固件类样本网关路径（re-firmware → re-fw-extract → re-fw-rootfs → 本技能）
- [[re-fw-extract]] / [[re-fw-rootfs]]：固件解包与文件系统/配置分析前置
- [[re-binary-core]]：MIPS ELF 通用初勘/反编译/调试底座（[[re-ghidra]]、[[re-gdb]] 等子技能照常使用）
- [[re-vuln]]：web 认证绕过/命令注入的漏洞确认与利用验证
- [[re-sandbox]]：一切动态执行强制前置（[[platform-tips]] 默认沙箱原则）
- 配套：[[re-emulation]]（无 qemu 场景用 Unicorn 模拟执行 MIPS 指令）、[[re-fw-emulate]]（需要整体启动固件）、[[re-crypto-keys]]（配置/固件中硬编码密钥）、[[re-patching]]（延迟槽感知的字节补丁）

## 常见坑与陷阱

- **延迟槽执行流错位**：现象——手读分支处逻辑对不上，紧跟分支的指令"看似不该执行"却改变了状态；原因——MIPS 硬件特性：分支/跳转后紧跟的一条指令无条件执行后才转移控制（MIPS32r6 起取消）；对策——读代码把延迟槽指令同时计入跳转两路，补丁分支后补 nop/等价指令；依赖反编译器输出时核对延迟槽指令的还原位置
- **大小端判断错 → 全部乱码**：现象——字符串、立即数、地址全乱，反编译面目全非；原因——MIPS 大小端并存（路由器固件多为大端，也有小端），读错端序后 4 字节整字全部错位；对策——`file`（MSB/LSB）+ `readelf -h` Data 字段 + strings 可读性三重确认，导入工具选对 mips / mipsel 变体
- **无重定位信息时 $gp 基址只能猜**：现象——`lw $t0, off($gp)` 指向不明、GOT 引用解不出；原因——剥离符号/静态链后重定位丢失，$gp 值（常见 .got+0x7FF0）需自行确认；对策——在 `_start` / crt0 序言的 `lui gp` + `addiu gp` 处计算实际 gp 值并在反编译器中标注；无符号时按 .got 段基址推算
- **路由器固件非标准头/多层压缩**：现象——binwalk 解不出或解出物不是文件系统，web 后端找不到；原因——厂商自定义头 + 多层压缩/嵌套打包（同 [[re-fw-extract]] 常见坑）；对策——hexdump 手工查魔数、跳过头部偏移 dd 切分、逐层 file 确认后再分析
- **反编译工具对伪指令处理差异**：现象——同一函数不同反编译器输出差异大，li / la / move 展开不一致；原因——MIPS 汇编器展开伪指令方式多样（li 拆 lui+ori 等），工具按各自规则还原；对策——以机器码语义为准，跨工具对照，关键逻辑（延迟槽/跳板/GP 引用）回指令级核实
- **busybox 单二进制多 applet 误判**：现象——一个二进制里逻辑"什么都干"，找不到入口；原因——busybox 按 argv[0] 分发 applet，全部逻辑共用一个 main；对策——`busybox --list` 或符号表 applet 表（`applet_names`）定位具体 applet，以对应子命令入口为分析起点
