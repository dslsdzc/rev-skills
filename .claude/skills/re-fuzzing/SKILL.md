---
name: re-fuzzing
description: >
  覆盖率引导模糊测试：AFL++/libFuzzer/honggfuzz、插桩与语料初始化、
  afl-fuzz 运行参数、覆盖率(afl-cov)、字典/结构化输入。
  触发词：fuzz、模糊测试、AFL、afl-fuzz、libFuzzer、honggfuzz、
  覆盖率、corpus、语料、dictionary、挖洞、fuzzing。
---

# 覆盖率引导模糊测试（AFL++ / libFuzzer / honggfuzz）

## 何时使用 / 何时不用

- 用：目标有明确输入面（文件解析 / 库函数 / 网络协议解析），要自动化找崩溃；有源码可插桩（或无源码愿意用 QEMU 模式）；需要持续回归找新 bug
- 不用：目标无输入解析（纯算法/纯逻辑 → 符号执行 [[re-angr]] / [[re-z3]]）；已有崩溃只需分析（→ [[re-crash-triage]]）；目标是内核/驱动（走 [[re-kernel]] 域思路，不在用户态 fuzz 范围）
- 不用：只有单个崩溃样本要复现（直接走 [[re-crash-triage]]，无需重跑 fuzz）

## 工具准备

所有工具先验证再使用。fuzz 是动态执行，一律在沙箱内跑（[[platform-tips]] 最高原则，见 [[re-sandbox]]）。

### AFL++ —— 覆盖率引导 fuzz 主力

- Debian/Ubuntu: `sudo apt install afl++`
- Fedora: `sudo dnf install american-fuzzy-lop american-fuzzy-lop-clang`（包即 AFL++ fork）；或源码编译拿最新版（见下）
- Arch: `sudo pacman -S afl++`
- macOS: `brew install afl++`
- Windows: WSL2 内 `sudo apt install afl++`（AFL++ 官方支持 WSL；Windows 本机不可直接跑）
- 源码编译（推荐，版本最新、含全部模式）:
  ```sh
  git clone https://github.com/AFLplusplus/AFLplusplus && cd AFLplusplus
  make distrib        # 需要 clang/LLVM 工具链
  sudo make install
  ```
- 验证: `afl-fuzz -h`（打印 usage 即 OK）；`afl-clang-fast --version`

### clang / LLVM —— libFuzzer 宿主 + ASAN 编译器

- Debian/Ubuntu: `sudo apt install clang`
- Fedora/RHEL: `sudo dnf install clang`
- Arch: `sudo pacman -S clang`
- macOS: Xcode 自带（`xcode-select --install` 补命令行工具），或 `brew install llvm`
- Windows: WSL2 内 Linux 版；本机 Visual Studio 的 clang-cl 亦可（MSVC 支持 `/fsanitize=fuzzer`）
- 验证: `clang --version`

### libFuzzer —— 库函数 / 单函数 fuzz（随 clang 附带）

- 无需单独安装：clang 自带，`-fsanitize=fuzzer` 即启用
- 验证:
  ```sh
  clang -fsanitize=fuzzer -x c /dev/null -o /tmp/fztest && /tmp/fztest -runs=1
  ```
  输出含 `INFO: libFuzzer` 即 OK（`/tmp/fztest` 用完可删）

### honggfuzz —— 硬件计数器 / 多线程 fuzz 备选

- Debian/Ubuntu: 无官方包 → 源码编译：
  ```sh
  sudo apt install build-essential binutils-dev libunwind-dev libblocksruntime-dev clang
  git clone https://github.com/google/honggfuzz && cd honggfuzz && make
  ```
- Fedora/RHEL: `sudo dnf install honggfuzz`
- Arch: `sudo pacman -S honggfuzz`（或 AUR 包 `honggfuzz`）
- macOS: 无 brew 公式 → 源码编译（需 Xcode + libblocksruntime）
- Windows: WSL2 内 Linux 版
- 验证: `honggfuzz --help`

### afl-cov —— 覆盖率统计（gcov/lcov 前端）

- 依赖 lcov/gcov: `sudo apt install lcov` / `sudo dnf install lcov` / `sudo pacman -S lcov`（gcov 随 gcc 自带）
- 本体无 pip 包，git clone 直接运行:
  ```sh
  git clone https://github.com/mrash/afl-cov && cd afl-cov
  ```
- 验证: `./afl-cov -V`
- 注意：afl-cov 需要目标用 gcov 插桩编译（`gcc -fprofile-arcs -ftest-coverage`），与 AFL 插桩不兼容——**同一份代码编两次**：一次 afl+ASAN 版跑 fuzz，一次 gcov 版测覆盖率

## 操作步骤

按顺序执行；每步产物（harness 源码、语料目录、fuzz 输出目录）记录路径，供 [[re-crash-triage]] / 报告引用。

1. **目标与插桩选择**：
   - 源码可编译 → AFL++ 编译器包装器 + ASAN：
     ```sh
     CC=afl-clang-fast CXX=afl-clang-fast++ AFL_USE_ASAN=1 ./configure && make
     # 简单单文件目标：
     afl-clang-fast -fsanitize=address -g -O1 -o target target.c
     ```
   - 无源码 → `-Q` QEMU 模式（`afl-fuzz -Q ...`），无需插桩但慢 2-5 倍
   - 目标是库函数 → 写 fuzz target（harness）读文件喂解析 API：
     ```c
     /* fuzz_target.c —— 以 libpng 的 png_read 入口为例 */
     #include <stdint.h>
     extern int my_parse(const char *data, size_t len); /* 目标解析入口 */
     int LLVMFuzzerTestOneInput(const uint8_t *data, size_t size) {
       my_parse((const char *)data, size);
       return 0;
     }
     ```
     libFuzzer 编译：`clang -fsanitize=fuzzer,address -g -O1 -o fuzz_target fuzz_target.c target_lib.c`
     AFL++ 编译同一 harness：`afl-clang-fast -fsanitize=fuzzer,address -o fuzz_target_afl fuzz_target.c`（afl-clang-fast 拦截 `-fsanitize=fuzzer` 并链接自带 driver），运行 `afl-fuzz -i in -o out -- ./fuzz_target_afl @@`
   - 网络目标 → 见坑 5：harness 直调解析函数（数据来自文件），不要 fuzz 整个服务进程
2. **语料初始化**：
   ```sh
   mkdir in out
   # 每个种子是目标可正常解析的最小有效输入（别拿空文件起步）
   cp seed_sample.bin in/
   afl-cmin -i in -o in_min -- ./target @@   # 去重：只留覆盖不同路径的种子
   ```
   - 语料质量比数量重要：10 个覆盖不同解析分支的小样本 > 1000 个同类大文件（见坑 2）
   - 空语料/纯空文件起步：前几千 execs 全在 EOF 分支，解析逻辑迟迟不被覆盖
3. **afl-fuzz 运行参数**：
   ```sh
   afl-fuzz -i in_min -o out -m none -t 1000+ -x dict.txt -- ./target @@
   ```
   - `-m none`：ASAN 程序默认内存限制会误杀，必加（见坑 4）
   - `-t 1000+`：初始超时给足（`+` 号表示随路径增长自适应）
   - `@@` 占位符 = fuzz 生成的文件路径；输入走 stdin 则去掉 `@@`
   - 多核多实例：`-M main` 主实例 + `-S secondary1` 等从实例（共享同一 out 目录）；`afl-whatsup out` 看汇总
   - 续跑：`afl-fuzz -i - -o out ...`（`-i -` 复用已有输出目录）
   - 运行时长：24h+ 才有统计意义，别早期就停；出现崩溃后不打断，另开分析（[[re-crash-triage]] 可用 `afl-tmin` 在 out/crashes 上工作）
4. **覆盖率（afl-cov）**：
   - 运行中实时看：`afl-whatsup out`——`paths_total` 增长 + `execs_done` 高 = 正常
   - gcov 版目标（与 fuzz 版本分开编）：
     ```sh
     gcc -fprofile-arcs -ftest-coverage -g -O0 -o target_gcov target.c
     ```
   - 汇总:
     ```sh
     ./afl-cov -d out --live --coverage-cmd "cat AFL_FILE | ./target_gcov" --code-dir .
     ```
     产出在 `out/cov/`，HTML 报告 `out/cov/web/`（lcov/genhtml 生成）
   - 无 gcov 的替代：`afl-showmap -o /tmp/map -- ./target @@` 看单输入覆盖哪些块；对比两个输入的 map 判断是否覆盖新路径
5. **字典 / 结构化输入**：
   - 字典 `-x dict.txt`：关键词（魔数、分隔符、关键字）降低跨格式变异成本；AFL++ 自带大量格式字典（`AFLplusplus/dictionaries/` 含 png/pdf/jpeg/tiff 等，直接 `-x` 引用）
   - 结构化输入（头+长度+数据类格式）：初始种子必须覆盖不同结构变体；长度字段在字典里给常见取值；进阶用自定义 mutator（AFL++ `AFL_CUSTOM_MUTATOR_LIBRARY`，Python 示例在 `utils/python_mutators/`），维护校验和/长度的一致性

## 跨域联合

- [[re-vuln]]：本网关工作流第 2 步固定调用本技能（漏洞挖掘域覆盖率的底座原子）
- [[re-crash-triage]]：本技能产出的崩溃输入（`out/crashes/`）交其分析；最小化/去重（cmin/tmin）在其流程内完成
- [[re-ctf]]：CTF pwn / 赛题二进制的 fuzzing 引用本技能
- [[re-binary-core]]：写 harness 前用反编译确认解析入口与 API 语义（[[re-ghidra]] / [[re-ida]]）
- [[re-netcap]]：网络目标 fuzz 的种子语料来源（真实流量抓包）
- [[re-sandbox]] / [[platform-tips]]：fuzz 是动态执行，默认沙箱内跑

## 常见坑与陷阱

- **无插桩无覆盖率**：现象——`afl-fuzz` 跑起来 execs 暴涨但 paths 数不动、从不出崩溃；原因——目标没被插桩（release 二进制 / 编译器不是 afl-* 包装器 / `@@` 传参错误 fuzz 了无关程序）；对策——开跑前 `afl-showmap -o /tmp/map -- ./target @@` 验证覆盖率有变化；`afl-fuzz` 启动输出会警告 instrumentation 缺失；无源码改用 `-Q` QEMU 模式
- **语料大小失衡**：现象——启动慢、每轮 exec 率低，或早期完全覆盖不到解析逻辑；原因——种子太多太大（队列膨胀）或全是空文件/同一格式变体；对策——`afl-cmin` 去重到几十个覆盖不同分支的最小样本；不同格式变体各留一个代表
- **崩溃去重（cmin/tmin）**：现象——`out/crashes/` 堆积上万个文件，实际是同一个 bug；原因——fuzzer 对每个触发输入都存盘，未按崩溃点区分；对策——用 `afl-tmin` 逐个最小化（`afl-tmin -i crash -o crash.min -- ./target @@`），再按 ASAN 报错类型 + 回溯栈合并同类项（见 [[re-crash-triage]]）
- **sanitizer 配置错误**：现象——真崩溃不报（漏检）或 fuzz 进程被误杀（假崩溃）；原因——没开 ASAN（漏 `AFL_USE_ASAN=1` / `-fsanitize=address`）、`-m none` 未设导致 ASAN 内存限制被杀、ASAN 与老版本 glibc 冲突；对策——统一 `AFL_USE_ASAN=1` + `-m none`；`-t` 给足；先手工跑一个已知崩溃输入确认 ASAN 能报
- **网络目标需 harness**：现象——fuzz 网络服务二进制，输入从 socket 来，`@@` 文件根本喂不进解析逻辑，覆盖率恒为 0；原因——网络程序读 fd 不读文件，fuzz 通道错位；对策——写 harness 把文件内容直接喂给解析函数（fuzz 的是解析器不是网络栈）；真实流量用 [[re-netcap]] 抓包做种子
