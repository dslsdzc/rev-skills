# ThreadX Modules：module preamble / dispatch request ID / XIP

<CORE RULE>
模块里的 API 调用**可能根本不是普通的 API 调用**：

```
Module
  → 预定义的 request ID
  → 软件 dispatch 函数
  → 常驻 Module Manager
  → 真正的 ThreadX 服务
```

所以在模块里看到：

```
mov  request_id, #37
branch common_dispatch
```

**不要判"大量功能被一个奇怪的 dispatcher 混淆了"**——它很可能就是 ThreadX Module 的 ABI。真正该恢复的是 **request ID → 服务名**的映射（本质接近一张 syscall table）。
</CORE RULE>

## 一、Module Manager：常驻的唯一一份

- Module Manager 是**单份常驻代码**，负责创建模块的初始线程、启动其执行，并**承接模块发出的全部 ThreadX API 请求**
- 源文件以 `txm_module_manager_*` 命名；模块侧文件不带 "manager"（如 `txm_thread_relinquish.c`），共用 `txm_module.h`
- 组成：模块装载器（加载/重定位/准备）、**API dispatch**、内存管理、线程管理
- 同时在载的模块数量**没有上限**（受可用内存限制），但 **Module Manager 只有一份**

## 二、module preamble：必须在模块的第一个地址

布局固定：

```
[module preamble][module instruction area][module RAM area]
```

preamble 描述模块的基本特征与资源：

| 内容 | 说明 |
|---|---|
| module ID / 主次版本 / preamble 大小 | 标识与格式版本 |
| **properties 位图** | 见下 |
| shell 入口 | 模块 shell 入口点 |
| start / stop 线程入口 | 模块的主线程入口 |
| start / stop 线程优先级与栈大小 | 线程配置 |
| callback 线程入口 / 优先级 / 栈大小 | 回调线程配置 |
| 代码大小 / 数据大小 | 区域尺寸 |

**properties 位图（含义各不相同）**：

- **bit 0**：特权模式 vs 用户模式（**用户模式 = MMU 保护**）
- **bit 1**：无 MPU 保护 vs MPU 保护（**MPU 保护要求用户模式**）
- **bit 2**：共享/外部内存访问的开关
- **bits 31–24**：编译器 ID（区分 IAR / ARM / GNU 等工具链）

开发者常改的字段偏移（例如 module ID 在 `0x10`、start 线程在 `0x1C`、优先级在 `0x24`、栈大小在 `0x28`）在不同版本/工具链下要现场核对，**不要跨版本照搬**。

模块还需**用位置无关代码/数据（PIC/PID）构建**，才能被放到任意内存区执行。

## 三、request ID 与软件 dispatch

模块通过 `txm_*` 版本的 API 调 ThreadX，例如：

```
(_txm_module_kernel_call_dispatcher)(TXM_THREAD_RELINQUISH_CALL, 0, 0, 0);
```

- Module Manager 提供该函数指针，它带着某个服务对应的 **ID** 调用 Module Manager 的 dispatch 函数，由后者执行**真正的 API**
- 在模块源码里定义 `TXM_MODULE` 可把 ThreadX API 调用**重映射**为这些模块专用版本
- **ARM 上非特权模块用 SVC 指令陷入内核（特权）模式执行 API**；若 preamble 把模块配为特权模式，则**可直接调 API，不陷入**

**RE 主线**：把 dispatch 调用点收集起来，**建 request ID → 服务名的映射表**，之后所有模块代码才可读。

## 四、装载方式与 XIP

- 模块的**指令区可以原地执行（XIP），也可以被拷贝进模块内存区后再执行**；**模块的数据内存需求总是从模块内存区分配**
- 因此可能出现：

```
代码地址完全不在 module RAM 分配范围内
  → 不一定是控制流劫持
  → 可能只是 XIP 模块（代码还在 Flash，数据在 RAM）
```

- 唯一的硬要求还是：**preamble 永远在模块第一个地址**
- 加载流程：分配内存 → 校验完整性 → 处理 preamble → 重定位代码与数据 → 初始化 → 创建模块线程 → 启动

## 五、线程与栈的两个细节

- 每个模块提供**一个线程入口**及其栈大小/优先级/模块 ID，另有 callback 线程的栈大小/优先级
- **模块线程在受内存保护的内核态执行时会用到另一个内核栈**（由端口配置给出）
- **模块线程栈顶存放线程入口信息结构**（`TXM_MODULE_THREAD_ENTRY_INFO` 一类）——**算栈用量时必须把它计入**，否则会误判栈溢出
- 模块拥有完整的 ThreadX API 访问权，包括在模块内创建更多线程

## 六、内存保护是可选的

启用时，**只有该模块的线程能访问其代码与数据内存**；任何越界访问都会造成内存故障并**终止出错的线程**。因此"某线程被静默终止"可能来自这里，而不是看门狗。

## 决策树

```
拿到 ThreadX Modules 目标
├─ 先定位 module preamble（必然在模块第一个地址）
│    ├─ 读 properties：特权/用户模式、MPU 保护、共享内存、编译器 ID
│    └─ 读线程入口/优先级/栈大小与代码/数据尺寸
├─ 看到大量「填 request ID → 跳公共 dispatcher」
│    └─ 这是 Module ABI；建 request ID → 服务名映射表，别判混淆
├─ 代码地址不在模块内存区
│    └─ 先考虑 XIP（指令在 Flash、数据在 RAM）
├─ 线程异常终止
│    ├─ 查是否越界触发了内存保护故障
│    └─ 查栈用量是否把栈顶的入口信息结构算进去
└─ 线程进内核态的行为
     ├─ 非特权模块 → SVC 陷入后才执行 API
     └─ 特权模块 → 直接调用，不产生陷入
```

## 工具与验证

- preamble：逐字段解析（含 properties 位与编译器 ID），并用它定位指令区与数据区
- API 路径：`txm_*` 侧调用点与 dispatch 函数、request ID 常量的分布
- 装载方式：XIP 与拷贝装载的区分（代码地址与模块内存区的关系）
- 验证：能同时说清「模块是怎么装的（XIP/拷贝）+ API 是怎么进来的（dispatch ID）+ 保护是否开启以及是哪一种」

## 该平台的坑（汇总）

- **把 request ID + 公共 dispatcher 当控制流混淆**：那是 Module ABI 的正常形态
- **忘记 preamble 必在第一个地址**：找不到它就很难定位指令区/数据区边界
- **跨版本照搬 preamble 字段偏移**：随版本与工具链变化
- **把 XIP 模块的代码地址当控制流劫持**：指令区可以留在 Flash
- **忽略 properties 位**：特权/用户模式与 MPU 开关决定了 API 是否经由 SVC 陷入
- **算栈用量时漏掉栈顶的线程入口信息结构**：会误判栈溢出
- **把"线程被终止"归因于看门狗**：内存保护故障也会终止线程
- **以为模块只能有一个**：模块数量受内存限制，常驻的只有 Module Manager
