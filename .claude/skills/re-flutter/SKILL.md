---
name: re-flutter
description: Flutter/Dart AOT 逆向：libapp.so 快照分区解析、符号还原、Dart VM 动态分析。触发词：Flutter、Dart、libapp.so、AOT snapshot、kernel_blob、flutter_assets、Dart VM
---

# Flutter / Dart AOT 逆向（快照解析 / 符号还原 / VM 动态分析）

## 何时使用 / 何时不用

- 用：Android 包内发现 `lib/<abi>/libapp.so`（Dart AOT 快照）与 `libflutter.so`（引擎）——业务逻辑在 libapp.so
- 用：iOS 的 `App.framework/App`（AOT 快照嵌入 Mach-O，`Flutter.framework` 为引擎）
- 用：debug 构建的 `assets/flutter_assets/kernel_blob.bin`（Dart kernel 二进制，含类/函数名与 AST）
- 用：需要还原 Flutter App 的 Dart 业务逻辑（网络接口、签名/加密算法、协议、MethodChannel 通道）
- 不用：纯原生 Android App（无 libapp.so / kernel_blob，走 [[re-apk]]）
- 不用：纯原生 iOS App（无 App.framework，走 [[re-ios]]）
- 不用：Flutter Web（产物是 JS/WASM 而非快照，走 [[re-wasm]]）
- 不用：引擎层本身（libflutter.so / Flutter.framework 内部逻辑，见步骤 4）
- 注意：动态步骤在受控设备 / 模拟器快照内执行（[[platform-tips]] 最高原则）；静态优先（大型样本原则）

## 工具准备

参考 [[platform-tips]]——Flutter 产物大（libapp.so 数十 MB 起），遵循「静态优先（大型样本）」：先静态定位、动态按需补充；动态（运行 / 重打包 App）默认在受控设备 / 模拟器快照内。

### python3（快照头部 / 分区解析主力）

- Linux: `apt install python3` / `dnf install python3` / `pacman -S python`
- macOS: 自带；Windows: 官方安装器或 `choco install python`
- 验证: `python3 --version`

### binutils（readelf / strings / objcopy，快照定位与段提取）

- Debian/Ubuntu: `apt install binutils`；Fedora: `dnf install binutils`；Arch: `pacman -S binutils`
- macOS: Xcode 命令行工具自带（`xcode-select --install`）
- Windows: 无自带 binutils——用 WSL，或 Ghidra 内置解析替代
- 验证: `readelf --version && strings --version`

### Ghidra（指令段反汇编 / 反编译与交叉引用）

- 装法与验证见 [[re-ghidra]]；无 Ghidra 时 IDA / radare2 等价（[[re-ida]] / [[re-radare2]]）
- 验证: 导入 libapp.so 后能定位 `_kDart*` 符号

### frida（动态侧，Dart VM 入口 hook）

- 安装、frida-server 部署与版本匹配见 [[re-frida]] 工具准备（主机与设备版本必须一致）
- 验证: `frida --version`；`frida-ps -U` 列出设备进程

### blutter（AOT 快照自动还原，可选）

- release libapp.so 的类/函数/对象池自动还原，安装与用法见 [[re-hybrid-app]] 工具准备；本技能步骤 2 以手动解析为核心方法，blutter 作自动化替代与核对
- 验证: 输出目录出现 `pp.txt` 且含目标 App 类名

## 操作步骤

按顺序执行；每步产物（段提取 / 解析脚本 / hook 脚本 + sha256）存档。

1. **识别构建模式（debug / release）**：
   ```sh
   unzip -l app.apk | grep -E 'kernel_blob|libapp|libflutter'    # Android 容器内定位
   file lib/arm64-v8a/libapp.so
   readelf -sW lib/arm64-v8a/libapp.so | grep _kDart             # release: AOT 快照符号
   xxd -l 32 assets/flutter_assets/kernel_blob.bin               # debug: "KERNEL" magic
   strings -n 6 libapp.so | grep -c SNAPSHOT                     # AOT 数据段 magic 命中
   ```
   - debug: `assets/flutter_assets/kernel_blob.bin` 存在（头部 "KERNEL" magic，Dart kernel 二进制，类/函数名与 AST 保留，还原成本低）→ 直接步骤 3
   - release: 无 kernel_blob，业务代码在 libapp.so 的 `_kDartIsolateSnapshotData`（数据）/ `_kDartIsolateSnapshotInstructions`（指令）→ 步骤 2
   - iOS: `Payload/<App>.app/Frameworks/App.framework/App`（业务）与 `Flutter.framework/Flutter`（引擎），Mach-O 内同段名，`otool -l` / strings 定位

2. **Dart AOT 快照分区解析（release）**：
   ```sh
   objcopy --dump-section .rodata=snap.rodata libapp.so    # 数据段（含 VM + isolate 两份快照）
   objcopy --dump-section .text=snap.text libapp.so        # 指令段
   python3 - <<'PY'
   import struct
   data = open('snap.rodata', 'rb').read()
   off = 0
   while True:
       off = data.find(b'SNAPSHOT', off)
       if off < 0: break
       print('magic @', hex(off),
             'version:', data[off+8:off+20].rstrip(b'\x00'),
             'blob_len:', struct.unpack('<Q', data[off+20:off+28])[0])
       off += 1
   PY
   ```
   - 快照数据段结构：头部（magic "SNAPSHOT" 8B + 版本串 12B + 长度 8B LE）之后是子 blob 序列，每个子 blob 为「头（长度/类型）+ 内容」，分区依次为：**strings**（Dart 字符串表）、对象 blob（库/类结构）、**ObjCode**（代码对象表，含指令地址）、**rodata**（只读数据）；机器码本体在独立指令段 **instructions**（`_kDartIsolateSnapshotInstructions`）
   - `_kDartVmSnapshot*` 是 VM 快照（dart:core/io 等标准库，所有 Flutter App 共用），业务只在 `_kDartIsolateSnapshot*`
   - strings blob 提取业务字符串:
     ```sh
     strings -n 6 -t x snap.rodata | grep -E 'https?://|token|secret|api/|MethodChannel'
     ```
   - 指令段导入 Ghidra：以 ObjCode 表的代码对象地址为函数边界创建函数（自动分析常认不出 AOT 代码对象），反编译后按字符串交叉引用定位业务函数
   - 自动替代：blutter（工具准备）还原 asm/对象池/类名；手动解析用于核对与版本兜底（坑 5）

3. **符号还原**：
   - 构建侧留了映射（`--obfuscate --split-debug-info`）:
     ```sh
     # 构建命令: flutter build apk --obfuscate --split-debug-info=symbols/
     ls symbols/                               # app.android-arm64.symbols 等（每 ABI 一个）
     python3 -c "import json; d=json.load(open('symbols/app.android-arm64.symbols')); print(len(d['data']))"
     # JSON 结构: {"data": {"混淆名": "原名"}} —— 反向映射表，查表即得原名
     ```
   - 无映射时字符串交叉引用反推：strings blob 里的 UI 文案 / 错误提示 / URL → Ghidra 交叉引用找引用指令 → 沿调用链上下游展开（方法对应 [[re-binary-core]] 交叉引用）
   - debug kernel_blob.bin：kernel 格式含类/函数名与 AST，strings + 结构解析直接还原调用关系，无需符号表

4. **引擎与业务区分**：
   - `libflutter.so` / `Flutter.framework`：Flutter 引擎（C++：Dart VM、Skia、通道实现），各 App 基本一致——不分析，仅用于取 VM 导出符号（步骤 5）
   - `libapp.so` / `App.framework/App`：Dart 业务代码 AOT 快照——分析目标
   - `_kDartVmSnapshot*`（VM 快照 / 标准库）≠ `_kDartIsolateSnapshot*`（业务）：业务字符串与类名只在 isolate 快照
   - 原生插件与 MethodChannel 原生端在业务 so 之外，走 [[re-binary-core]]

5. **动态侧（受控设备 / 模拟器快照内，[[platform-tips]] 默认沙箱）**：
   - hook Dart VM 类库注册点——libflutter.so 导出的 `Dart_CreateRootLibrary`（root library 注册入口，onEnter 读库 URI）:
     ```js
     var f = Module.findExportByName("libflutter.so", "Dart_CreateRootLibrary");
     if (f) Interceptor.attach(f, {
       onEnter: function (args) {
         var uri = args[1].readCString();     // 库 URI（C 字符串）
         console.log("root library: " + uri);
       }
     });
     ```
     - release AOT 下该 C API 可能不触发（库直接由快照反序列化）——改 hook VM 内部 `dart::Library::New`（libflutter.so 内符号，随版本裁剪）或直接走下面的 VM Service 枚举
   - Dart VM Service 枚举 isolate / 库（release 需先开启 VM service：hook `Dart_SetVMFlags` / `Dart_InitIsolate` 注入 `--enable-vm-service`，或改用 debug 构建验证动态行为）:
     ```sh
     adb forward tcp:8181 tcp:8181
     curl http://127.0.0.1:8181/getVM
     curl "http://127.0.0.1:8181/getIsolate?isolateId=isolates/1"
     curl "http://127.0.0.1:8181/getInstalledLibraries?isolateId=isolates/1"
     ```
     - `getInstalledLibraries` 列出全部业务库（库名 = 包名 / 路径）；`getObject` 按 objectId 枚举类/字段；VM service 元数据里类名与字符串仍可读
   - 定位到目标函数后按地址 hook（`_kDartIsolateSnapshotInstructions` 基址 + 代码对象偏移），插桩底座见 [[re-frida]]

## 跨域联合

- [[re-mobile]]：移动 App 分析网关——Flutter 分支由 [[re-hybrid-app]] 与本技能承接（容器侧静态与动态跑通走网关）
- [[re-hybrid-app]]：Flutter 快照自动还原（blutter / reFlutter）与 MethodChannel 拦截——与本技能（手动快照解析 + VM 层动态）互补
- [[re-apk]] / [[re-ios]]：Android / iOS 容器侧静态（解包、manifest、签名、DEX/ObjC 原生桥接）
- [[re-frida]]：动态插桩底座（版本匹配、spawn/attach、反检测、脚本模板）
- [[re-binary-core]]：libapp.so / libflutter.so 的原生层（[[re-format-elf]] + [[re-ghidra]] 反编译引擎与 JNI 桥）

## 常见坑与陷阱

- **release 没有 kernel_blob.bin**：现象——按 debug 教程找 `assets/flutter_assets/kernel_blob.bin` 找不到；原因——kernel_blob 只在 debug/Profile 构建存在，release 业务代码在 libapp.so 的 AOT 快照段；对策——先按步骤 1 判模式：无 kernel_blob → 走步骤 2 快照分区解析，别在 assets 里死找
- **obfuscate/tree-shaking 后短名**：现象——快照里函数/类名全是 `a`/`b` 等短名或直接缺失；原因——`--obfuscate` 混淆名称 + tree-shaking 删除未引用代码；对策——构建侧有 `--split-debug-info` 映射文件就直接查表（步骤 3 JSON）；没有映射则以 strings blob 的文案/URL 为锚交叉引用反推调用链；动态侧 hook 关键函数观察行为互补
- **引擎与业务代码混淆**：现象——分析深陷 libflutter.so 的 `dart::` 内部函数或 `_kDartVmSnapshot*` 段（dart:core/io 标准库），时间空耗；原因——引擎层与 VM 快照是所有 Flutter App 共用代码，不是业务；对策——业务只分析 libapp.so 的 `_kDartIsolateSnapshot*`；libflutter.so 只取 VM 导出（步骤 4/5）
- **frida 版本不匹配**：现象——`frida-ps -U` 报协议错误 / unable to communicate；原因——主机 frida-tools 与设备 frida-server 版本号不一致，或架构不符；对策——严格按 [[re-frida]] 工具准备：`frida --version` 对照下载同版本 frida-server，选对架构（arm64/arm/x86_64）
- **快照版本与解析脚本不匹配**：现象——分区偏移错位、strings blob 内容乱码或解析中断；原因——Dart 版本间快照布局有差异（版本串在头部可见），手工/第三方脚本只覆盖特定版本；对策——先读头部版本串；解析按版本分支；版本过新时以通用方法兜底（magic 扫描 + 分区语义推演）
- **hook 读 Dart 字符串读出乱码**：现象——hook 到 Dart 对象指针但打印乱码；原因——Dart 字符串不是 C 字符串（对象指针 +7 偏移处 4 字节 Smi 编码长度，右移 1 位为真实长度，+15 起为 UTF-8 数据，该偏移为社区实测值）；对策——写 readDartString 工具函数按此布局读取并加长度上限（布局细节见 [[re-hybrid-app]] 坑条目）；**偏移随 Dart 版本浮动**——以 `gen_snapshot --print-object-layout-to` 导出的权威偏移或实测为准，别在异版本上照抄死偏移
- **对象池反序列化当定宽读（VLE）**：现象——blutter 对 custom engine / 结构性重排的快照失败（`No cluster defined for cid N` 或空输出）后，自写解析器读出的 ref 错位、字符串全乱；原因——Dart AOT 对象池是带 tag 的条目数组（X27 持池基址，`LDR Xn,[X27,#off]` 加载第 off/8 号槽），填充区每条目 1 字节 type（`TypeBits = eb & 0x7f`，`PatchableBit = 0x80`），type 0（kTaggedObject）带 VLE ref、**type 1（kImmediate）带 VLE 值且是变长不是定宽**（常见坑），type 2/3/4 无载荷；无符号 VLE 每字节 7 数据位、末段 bit7 置位（5→`0x85`，27673→`19 58 81`）；对策——VLE 读 length 开头后逐条按 type 解码，slot_offset = idx × 8；先用 2–4 个已知 ref→offset 锚点验证再全量信任，锚点不符时收窄扫描窗口重试；对象池即无符号二进制的符号表——`pool_offset → {加载它的所有 PC} → {所属函数}`，让「哪些函数触及字符串 ref N」可静态回答（来源：reverse-skills（inliver233），MIT）
- **strings 找不到中文文案**：现象——对 libapp.so 跑 `strings`/grep 找不到中文/CJK/emoji 业务文案，线索断掉；原因——Dart 快照字符串两种存储：OneByteString（CID 85，Latin-1/UTF-8，可普通 grep）与 TwoByteString（CID 86，**UTF-16LE**）；中文/CJK/emoji 基本都在 TwoByteString，按 UTF-8 字节序列去匹配 UTF-16LE 存储当然不中；对策——对目标串同时搜 UTF-8 与 UTF-16LE 两种编码，记录 offset + 编码 + 出现次数；`--dump-utf16` 全量导出 CJK 串再 grep；对象池内函数 Code 与其加载的字符串相邻，无符号时可凭池内邻近性猜字符串↔函数归属（来源：reverse-skills（inliver233），MIT）
- **池槽字符串查不到交叉引用**：现象——已知字符串在池中的 offset，但反编译器的交叉引用列表为空，定位不到引用函数；原因——取池只有两种标准 idiom：`ADD xR,x27,#page,LSL#12` 后跟 `LDR xD,[xR,#off]`（offset=(page<<12)+off），以及 page==0 时的直接 `LDR xD,[x27,#off]`；通用 xref 分析对这类间接取址常漏报；对策——写模式扫描器用原始字节匹配两种 idiom（不需要反编译器），函数归属用 prologue 特征（`fd 79 bf a9 fd 03 0f aa`）反向扫描定位函数起点；先用一个已知加载点校准再信全量；**「扫描器没找到」≠「无加载者」**——非标准编码的加载会被漏掉，阴性结果需第二方法交叉验证；恰好只被一个函数加载的字符串是 feature-dedicated，是功能 UI builder 的强线索（来源：reverse-skills（inliver233），MIT）
- **build/虚方法 callers=0 误判死代码**：现象——对 build 或虚方法做 BL xref 扫描得到 0 个调用者，被误判为死代码放弃分析；原因——Dart build/虚方法不经 BL 调用，而是经分派 stub：读对象 cid → 查分派表 → `blr x30` 虚拟分派，静态 BL 扫描天然看不到；对策——callers=0 是常态，不作死代码证据；找调用者必须动态：在分派 stub 或目标函数 onEnter 捕获 `lr` + `Thread.backtrace(Backtracer.ACCURATE)` 定位分派点（「while rebuilding dirty elements」帧是框架渲染路径，业务 builder 已返回）；stub 把 cid 放 x0（低 16 位）、对象指针在 x1，对象字段 @1 也存 cid 可兜底；拿到 cid 后静态搜 `movk xR,#<cid>,lsl#16` 找构造器，其 BL 调用者即父 build；X21 = 分派表基址，需覆盖全表时配合 cid→构造器静态映射（来源：reverse-skills（inliver233），MIT）
- **Dart bool 当 0/1 处理**：现象——反编译 AOT 代码时把 bool 当普通 0/1 整数读，逻辑翻来覆去对不上；原因——Dart AOT 固定寄存器约定：X15=shadow-stack、X26=Thread、X27=Pool、X22=null 哨兵、X28=堆基（压缩指针）、X21=分派表基；**Dart bool 是 canonical 对象的 tagged pointer，不是 0/1**——True = null+0x30（低 16 位常形如 …8071），False = null+0x20（…8061），消费端用 `tbz/tbnz w0,#4` 测 bit4；对策——按固定寄存器语义读反汇编（`mov x0,x22` 返回 Dart null；标准 prologue `stp x29,x30,[x15,#-16]!; mov x29,x15`，字节 `fd 79 bf a9 fd 03 0f aa`）；bool 编码可用指令频度破解：`add xR,x22,#0x30` 出现数千次（True）、`add xR,x22,#0x20` 同理（False）；Thread 全局 `G = Thread[x26+0x80]`，字段按偏移读；分配 thunk 模式 `mov x2,#imm; movk x2,#cid,lsl16; ldr x4,[x26,#0x228]; br x4`（来源：reverse-skills（inliver233），MIT）
- **patch 物化 false 用 movz w0,#0 崩溃（SIGILL）**：现象——静态 patch 或 Frida 运行时内存写用 `movz w0,#0`（字节 52800000）物化「假」，运行时崩溃信号 4（SIGILL）；原因——Dart bool 是 tagged pointer，0 是非法的 immediate tag；对策——物化 False 用 `add x0,x22,#0x20`（字节 c0820091）、True 用 `+0x30`；该规则同时适用于静态 patch 与 Frida 运行时内存写，写 Dart bool 一律写 canonical 地址（来源：reverse-skills（inliver233），MIT）
- **弹窗 patch 无效（三源分诊）**：现象——NOP 掉所有 showDialog 调用后弹窗照旧，或弹窗约 60 秒定时出现，反复重试成时间黑洞；原因——Flutter 弹窗只有三个来源，误分诊是最大浪费：(a) 显式 showDialog BL；(b) 未捕获异常——MissingPluginException → FlutterError.onError/zone onError → **异步弹窗，不经任何 showDialog BL**；(c) 完整性聚合门——一个聚合函数 OR 约 7 个检查，任一为真就弹窗；对策——logcat + Dart 栈帧见 MissingPluginException/Unhandled Exception 且定时出现 → 源 (b)，正解是截断 fault-body 构造器（把 body 构建的条件分支改为无条件跳过），全局 handler 无内容可显示，**停止 NOP 弹窗**；弹窗文案 → 池 ref → body builder → 调用者追踪，callers=0（cid 分派）且无 showDialog BL → 也是源 (b)；源 (c) 找聚合函数（引用大量 check*/get* 通道方法字符串 + 条件 → 弹窗构建），NOP 其聚合失败分支（`CMP W0,W22; B.EQ fail`）或 entry-null 弹窗构造 helper；patch 在某设备生效另一设备不生效时，用文案内容定位新触发的检查类别（如校验提示文案对应环境/模拟器检查）（来源：reverse-skills（inliver233），MIT）
- **无符号万级函数不知从哪下手**：现象——libapp.so 无符号、约两万函数，直接翻反汇编大海捞针；原因——无符号时函数边界、字符串归属、调用关系全靠静态重建，缺乏优先级信号；对策——用 prologue 特征字节（`fd 79 bf a9 fd 03 0f aa`）在 .text 内反向扫描（窗口约 0x6000–0x8000 字节）先恢复函数边界；每函数建特征向量：访问的字符串集（主导信号）、BL 目标/调用者 fan-in（`(word>>26)==0b100101` 解码 imm26）、gate 后分支点（TBZ/TBNZ/B.EQ）、null 比较（`CMP W0,W22`/`MOV X0,X22`）、bool 返回标志；四排序器把 2 万 → 短名单：关键字串短名单 → 共访问数（关键字类字符串 ≥2 个 → orchestrator）→ 双锚点集合交集（标题串+正文串的访问函数集相交 → 精确 builder，0 或 1 个函数）→ BL 调用 fan-in 向上迭代；**caller 计数 = 风险度量**——高计数（共享状态函数）避免作 patch 点，计数 1 的专用 handler 是安全目标；高 cmp + 条件分支数聚合得分用于浮现完整性门/聚合谓词（来源：reverse-skills（inliver233），MIT）
