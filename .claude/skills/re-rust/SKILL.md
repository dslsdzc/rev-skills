---
name: re-rust
description: Rust 二进制逆向：符号、monomorphization、所有权模式。触发词：Rust、rust、Rust二进制、cargo
---

# Rust 二进制逆向（符号解译 / monomorphization / 所有权）

## 何时使用 / 何时不用

- 用：确认是 Rust 编译的二进制（符号带 `_ZN`/`_RNv` 前缀）后，demangle 还原符号；识别泛型实例化（monomorphization）产生的重复代码；通过所有权/析构（drop）模式理解对象生命周期；分析 async/await 状态机与 tokio/serde 等库模式
- 用：恶意 Rust 样本（[[re-malware]] 静态还原——Rust 重写的木马/勒索增多）
- 不用：非 Rust 原生程序（C/C++/Go 直接 [[re-binary-core]]；Go 走 [[re-go]]）
- 不用：确认带壳先走 [[re-anti-analysis]]（Rust 二进制普遍无壳，但体积大）
- 注意：动态步骤默认沙箱（[[platform-tips]] 最高原则）；静态优先（大型样本原则）

## 工具准备

参考 [[platform-tips]]——反编译/符号为静态步骤，免沙箱；Rust 二进制通常 1-10MB+，静态定位先行。

### Rust 工具链（rustc/cargo——装符号工具用，可选）

- 推荐 rustup（官方安装器，全平台最新）: `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`
- Debian/Ubuntu: `apt install rustc cargo`（官方包，版本可能滞后）；Fedora: `dnf install rust cargo`；Arch: `pacman -S rust`
- macOS: `brew install rust`；Windows: `choco install rust` 或 rustup
- 验证: `rustc --version && cargo --version`

### rustfilt（Rust 符号 demangle，v0 新式 `_RNv` 必用）

- Debian/Ubuntu: `apt install rustfilt`（官方包）
- 其他发行版无官方包 → 官方安装: `cargo install rustfilt`
- 验证: `echo '_ZN3foo3barE' | rustfilt` 输出 `foo::bar`

### c++filt（legacy `_ZN` 可解；v0 不行）

- Linux: binutils 自带（`apt install binutils` / `dnf install binutils` / `pacman -S binutils`）
- macOS: `brew install binutils`（命令为 `g++filt`）或 `brew install llvm`（`llvm-cxxfilt`）
- Windows: WSL 内 Linux 版或 MinGW binutils
- 验证: `c++filt _ZN3foo3barE` 输出 `foo::bar`

### Ghidra / IDA（反编译底座，装法见对应技能）

- Ghidra 11+ 内置 Rust demangler（分析选项 "Demangler Rust"，见 [[re-ghidra]]）
- IDA 无内置 → 社区 Rust demangler 插件（如 idarustdemangler），或先 rustfilt 预处理符号表
- 验证: 反编译器函数名呈可读形式（而非 `_ZN...`/`_RNv...` 乱码）

### nm / readelf（符号表与节，binutils）

- 装法同 c++filt（binutils 自带）
- 验证: `nm --version`

## 操作步骤

按顺序执行，每步记录证据（路径 + sha256，见 [[re-triage]]）。

1. **识别 Rust**：
   ```sh
   file sample
   nm sample | head -20                  # 出现 _ZN...（legacy）或 _RNv...（v0）即 Rust
   strings sample | grep -iE 'rustc|rust_begin_unwind|panicking|__rust_alloc'
   ```
   - 特征符号: `_ZN4core9panicking...E`（panic 基建）、`_ZN3std2rt...E`（std 运行时）、`__rust_alloc`/`__rust_dealloc`（替代 malloc/free 的分配器）
   - std 程序入口是 `main`；no_std（嵌入式）用 `_start`

2. **符号解译（demangle）**：
   ```sh
   nm -C sample | grep main              # 内置 demangle（仅 legacy _ZN 可解）
   nm sample | rustfilt > symbols.txt    # 全量 demangle（v0/legacy 通吃）
   grep -iE 'main|tokio|serde' symbols.txt
   ```
   - v0 新式（`_RNv`）只有 rustfilt/Ghidra 11+ 能解，c++filt 原样吐出（坑 5）
   - Ghidra 11+ 导入后自动 demangle：函数树直接可读；符号保留确认: 无输出 → 坑 1

3. **monomorphization 识别**：
   ```sh
   grep -oE '::[a-z_]+<[^>]*>' symbols.txt | sort | uniq -c | sort -rn | head
   ```
   - 同一泛型名多种类型参数 = 多份实例代码（例：`Vec<u8>` 与 `Vec<i32>` 各一份完整展开）
   - 分析策略：选最常见类型参数的代表实例，同组实例之间只比对类型相关分支；重复代码跳过（坑 2）

4. **所有权/借用模式**：
   - drop: `core::ptr::drop_in_place::<T>` 调用 = 对象析构点（vtable drop glue），沿它定位结构体生命周期与字段
   - 分配: `__rust_alloc`/`__rust_dealloc` 对应 malloc/free；`alloc::boxed::Box`（独占堆）、`alloc::sync::Arc`（引用计数增减）、`alloc::vec::Vec`/`alloc::string::String`（容量变化触发 realloc）
   - `core::mem::replace`/`take`/`swap` 调用是借用检查器催生的常见操作
   - 反编译里大量 memcpy + size 参数 → 结构拷贝/Clone（derive(Clone)）

5. **常见库模式**：
   - tokio/async: `tokio::runtime::Runtime::block_on`、`tokio::task`/executor 符号；async fn 展开为状态机（坑 4）
   - serde: `serde::de::`/`serde::ser::` 与 `deserialize` 符号——配置/协议解析入口，沿它找数据格式
   - 网络: `std::net::TcpStream`、`tokio::net::`；日志/配置: `log::`/`tracing::`、`serde_json`
   - strings 中的错误文案/URL/配置串辅助定位目标逻辑

## 跨域联合

- [[re-binary-core]]：本技能由 core 网关引用——初勘 [[re-triage]]、反编译底座 [[re-ghidra]]/[[re-ida]]、库指纹 [[re-imports]]
- [[re-ghidra]]：11+ 内置 Rust demangler 优先；[[re-ida]]：Rust demangler 插件或 rustfilt 预处理
- [[re-emulation]]：no_std/嵌入式 Rust 固件无运行环境时可模拟执行辅助
- 恶意场景：Rust 恶意样本（勒索/木马重写版多）静态按本技能 → 行为分析转 [[re-malware]]
- [[platform-tips]] 相关分支：静态优先（大型样本）、动态默认沙箱、跨平台样本的 Wine/QEMU 分支

## 常见坑与陷阱

- **符号被 strip，恢复极难**：现象——`nm` 无输出、函数全 `sub_*`；原因——release profile 设 `strip = true` 或发布流程 strip（Rust 没有类似 Go pclntab 的恢复结构）；对策——先确认 `nm` 是否真的空（多数发布版默认保留符号，坑 3 步骤 2 排查）；strip 后用 strings 找 panic 文案/错误信息（含文件路径与类型线索），`.eh_frame`/`.gcc_except_table` 的 FDE 可还原函数边界（Ghidra 分析选项开启 unwind 解析）
- **monomorphization 大量重复代码**：现象——同一逻辑函数出现几十上百份，仅类型不同，函数列表爆炸；原因——泛型按每个类型参数实例化，每实例一份完整代码（体积也暴涨）；对策——demangle 后按泛型名分组统计，选一个代表性实例分析，同组之间 diff 只比对类型相关分支；体积/重复问题用 bloaty（`bloaty -d symbols`）确认；分析时忽略其余实例
- **panic 路径与正常路径交织**：现象——反编译里每个下标/`unwrap`/断言都带分支与 panic 调用，可读性被淹没；原因——Rust 在越界索引、`unwrap()`、`assert!` 处插入 `panic_bounds_check`/`core::panicking::panic` 检查（release 也保留索引检查），加上 `unreachable!` 死路径；对策——识别并跳过 `core::panicking::`/`std::panicking::`/`panic_impl` 相关调用与异常分支；panic 文案在 strings 里可见，可反向辅助定位调用点
- **async/await 状态机展开**：现象——一个 async fn 变成结构体 + 巨大 `match` 状态循环，函数名带 `{{closure}}`/`{{opaque}}`，找不到线性流程；原因——async fn 编译为 Future 状态机，每个 await 点是一个状态与保存点，poll 内按状态转移；对策——按状态号（0..N）追踪转移逻辑，重点读 poll 方法；识别 `core::future`/`std::future::poll_with_tls_context` 调用；tokio 程序找 `tokio::runtime` 符号与 `block_on` 定位入口
- **v0 新式命名 c++filt 解不了**：现象——`c++filt`/`nm -C` 对 `_RNv...` 原样输出，符号仍是乱码；原因——Rust 1.37+ 默认 v0 mangling（非 Itanium ABI）；对策——统一用 rustfilt（Debian/Ubuntu 官方包 `apt install rustfilt`，其余 `cargo install rustfilt`）批处理 `nm sample | rustfilt`；Ghidra 11+ 内置 demangler 直接自动解
