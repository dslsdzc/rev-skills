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
