---
name: re-vuln
type: gateway
description: >
  漏洞挖掘网关。编排：目标与输入面识别 → 覆盖率引导 fuzzing →
  崩溃分析 → 逆向定位 → 报告。
  子技能：[[re-fuzzing]] [[re-crash-triage]]。
  触发词：漏洞挖掘、挖洞、fuzz、模糊测试、AFL、libFuzzer、崩溃分析、
  crash、vulnerability hunting、fuzzing。
---

# 漏洞挖掘（覆盖率引导 fuzzing / 崩溃定位）

## 完整工作流

按顺序执行；每步产物（目标/输入面结论、fuzz 运行目录、崩溃样本、定位证据）记录证据路径 + sha256（存证方法见 [[re-triage]]），供报告引用。

1. **目标与输入面识别** —— 先弄清"fuzz 什么、输入从哪进"（见坑 1）：
   - 目标形态：本地文件解析（图像/压缩/文档/自定义格式）、网络服务（监听端口收包）、库函数（被调用的解析 API）、命令行工具（argv/stdin）
   - 输入面：fuzz 输入通道（文件 / 文件内容 / 网络包 / stdin / argv）与解析入口函数
   - 初勘：`file` / `strings` / 熵 / checksec（[[re-triage]]）；静态定位解析入口（[[re-binary-core]] 底座，[[re-ghidra]] 反编译找主处理函数）
   - 决策：fuzz 引擎与插桩方式（源码可插桩 / 无源码 QEMU 模式），见「选择树」
2. **覆盖率引导 fuzzing → [[re-fuzzing]]** —— 插桩 + 语料 + 跑起来：
   - 源码可用：AFL++ 编译器包装器 + ASAN 构建（`afl-clang-fast -fsanitize=address`）；库函数写 harness；无源码 `-Q`（QEMU 模式）
   - 初始化语料（最小有效样本，`afl-cmin` 去重），`afl-fuzz` 多实例跑（`-M main` / `-S secondary`）
   - 覆盖率监控（afl-cov / afl-whatsup），观察 paths 增长；加字典 / 结构化输入提速
3. **崩溃分析 → [[re-crash-triage]]** —— 出现 crash 立即处理：
   - 确定性复现（同一输入重跑必崩）；ASAN 报告解读（堆溢出 / 越界 / UAF / double-free）
   - 输入最小化（afl-tmin / afl-cmin）→ 最小 PoC
   - 非确定性崩溃用 rr 录制重放
4. **逆向定位（[[re-binary-core]] 底座）** —— 把崩溃翻译成漏洞根因：
   - [[re-triage]]：崩溃输入 sha256 存证 + 目标基线记录
   - [[re-ghidra]]（或 [[re-ida]] / [[re-radare2]]）：gdb 回溯栈中无符号帧用反编译补（见坑 5）；定位崩溃函数与输入数据流向
   - 确认：越界/悬垂发生在哪段逻辑、输入是否可控、路径是否真实可达（见坑 3）
   - 崩溃 core（进程已死 / 已有 core dump）→ [[re-memdump]] 分析
5. **报告**：
   - 记录：崩溃类型、复现命令、最小 PoC（文件 + sha256）、根因（函数/行/偏移）、可达性分析、影响（越界读/写、RCE/DoS）、修复建议
   - 产出：PoC / 崩溃特征可进 [[re-ioc]]

## 何时用哪个原子技能（选择树）

按目标输入形态 / 当前状态分支：

- **本地文件解析**（输入是一个文件：图像/压缩/文档/自定义格式解析器）→ [[re-fuzzing]] 用 **AFL++**（源码插桩 + ASAN；无源码 `-Q` QEMU 模式）
- **库函数**（目标是库的 API，如 libpng 的 `png_read_*`、自定义 parser 函数）→ [[re-fuzzing]] 用 **libFuzzer**（`-fsanitize=fuzzer,address` + fuzz target harness），或 AFL++ 持久模式 harness
- **网络服务**（监听端口、协议解析）→ 网络 fuzz：[[re-netcap]] 抓真实流量做种子，写 harness 重放喂解析函数（见 [[re-fuzzing]] 坑 5）；fuzz 的是解析器不是网络栈
- **已有崩溃 / 崩溃输入**（无需重跑 fuzz）→ 直接 [[re-crash-triage]]：确定性复现 → 最小化 → 定位
- **崩溃已定位、要读函数逻辑** → [[re-binary-core]] 底座（[[re-ghidra]] / [[re-ida]] / [[re-radare2]]）
- **崩溃是 core 文件**（进程已死）→ [[re-memdump]] 分析 core，再按需逆向
- **目标无输入解析（纯算法/纯逻辑）** → fuzz 不适合，符号执行更优（[[re-angr]] / [[re-z3]]）

## 跨域联合

- **底座 [[re-binary-core]]**：第 4 步逆向定位固定调用（[[re-triage]] 初勘与存证 / [[re-ghidra]] 反编译定位 / [[re-ida]] / [[re-radare2]]）；本网关 ①-⑤ 的静态环节都落在底座技能上（规格 2.4：崩溃样本定位 = re-vuln → re-binary-core + re-memdump）
- **崩溃 core → [[re-memdump]]**：进程已死 / 已有 core dump 时，崩溃样本分析走内存转储与 core 提取
- **CTF pwn → [[re-ctf]]**：pwn 赛题的 fuzzing / 崩溃分析交本网关（[[re-ctf]] 声明"pwn 题 → re-vuln"）；赛题二进制同样适用本网关流程
- **动态执行沙箱**：fuzz / 复现崩溃都是动态执行，默认在 [[re-sandbox]] 内跑（[[platform-tips]] 最高原则）
- **网络目标**：[[re-netcap]] 抓包做种子语料与输入面确认
- **入口调度**：本网关由 [[re-analyze]] 按触发词分派（漏洞挖掘 / fuzz / 崩溃分析）；triage 显式接线随二期全库同步落地
- **产出**：PoC hash / 崩溃特征 / 漏洞指纹可进 [[re-ioc]]

## 常见坑与陷阱

- **目标/输入面识别不到位就开跑**：现象——fuzz 跑几天零崩溃，或崩溃全在无关代码；原因——输入通道/解析入口不对（如把网络程序当文件解析器 fuzz，核心解析逻辑没被覆盖）；对策——第 1 步先静态确认解析入口（[[re-ghidra]] 反编译找主处理函数），harness 直连解析函数，[[re-netcap]] 抓真实流量验证输入面
- **崩溃≠漏洞**：现象——ASAN 报的越界/UAF 在死代码分支，或崩溃由 harness 自身引入；原因——fuzzer 能触发不等于真实可达、可利用；对策——[[re-crash-triage]] 第 4 步 gdb 回溯 + [[re-binary-core]] 反编译确认崩溃路径真实可达、输入可控；区分 harness bug 与目标 bug
- **无插桩无覆盖率**：现象——execs 涨得飞快但 paths 不动、从不出新崩溃；原因——目标没插桩（release 二进制、参数写错 fuzz 了无关程序）；对策——[[re-fuzzing]] 用 `afl-showmap` 验证覆盖率变化，无源码改用 `-Q` QEMU 模式
- **崩溃去重缺失**：现象——同一个 bug 的上万个 crash 文件淹没分析；原因——每个变异输入都存盘，未按崩溃点区分；对策——afl-tmin 最小化 + 按 ASAN 类型/回溯栈合并（见 [[re-crash-triage]]）
- **符号缺失定位难**：现象——gdb `bt` 全是 `??`；原因——剥离符号/静态链接；对策——记录模块基址与偏移，用 [[re-ghidra]] 反编译补帧（[[re-binary-core]] 底座）
