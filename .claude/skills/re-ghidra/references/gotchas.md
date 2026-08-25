# Ghidra 工具特有坑与边界

## 版本差异（JDK / API / 构建链）

- **JDK 版本**：11.3+ 运行官方 release 需 JDK 21（装错报 `UnsupportedClassVersionError`）；从源码构建 Ghidra 自身需 JDK 25 + Gradle 9.1+（与"运行"是两套要求，别混）
- **12.x 破坏性 API 变更**：函数管理类等有迁移（11.x 起持续发生）——写脚本前先查目标版本 javadoc，编译失败先怀疑 API 差异而非业务逻辑
- **MemoryBlock 权限 API 版本间方法名不同**（如 12.x 的 `isExecute()` 与旧版命名差异）：写内存段权限判断脚本时以小验证脚本确认当前版本方法名
- **GhidraDev/Eclipse 版本配套**：GhidraDev 插件版本与 Eclipse 版本有对应表，装不上先在官方 release notes 核对组合
- **扩展兼容范围**：Java 扩展的 extension.properties 声明适用的 Ghidra 版本范围，装到范围外版本会被拒载（见 [[re-plugin-dev]]）

## 无头批处理坑

- **headless 与 GUI 分析选项有差异**：默认分析选项集不完全一致——保证一致性用 `-postScript` 显式执行分析脚本
- **工程锁冲突**：同一工程同时被 GUI 与 headless 打开报锁（File Lock）——headless 用独立工程目录或先关 GUI
- **-import 与 -process 互斥**：重跑已导入文件用 `-process`，重复导入需 `-overwrite`（否则跳过已存在文件）
- **两个日志别混**：`-log` 是运行日志，`-scriptlog` 是脚本 print/异常——脚本没输出先看后者
- **路径含空格**：`-scriptPath` 多路径分号分隔且整体加引号；参数值含空格同样引起来

## 脚本 / API 坑

- **Jython 2.7 限制**：无 f-string/海象运算，无法 import pip 包；`SyntaxError`/`ImportError` 都是这个原因——现代 Python 需求走 ghidra-bridge
- **大循环慢**：getByte/setByte 逐字节在几 MB 区间上是数量级灾难，改 mem.getBytes/setBytes
- **地址字符串**：脚本里 `"0x401000"` 需经 `getAddressFactory().getDefaultAddressSpace().getAddress()`，直接 `currentAddress` 之外写 `"401000"` 会歧义
- **脚本崩溃不留痕**：headless 下脚本异常进 `-scriptlog` 但可能不影响退出码——批处理脚本结尾主动打印成功标志
- **中文输出乱码**：print 中文在部分终端乱码是编码问题，脚本内先处理字符编码或输出 ASCII 摘要

## 分析结果坑

- **自动分析漏混淆代码**：花指令/乱序段未反汇编——手动选段 `C` 强制标记，必要时 `Create Function` 修边界
- **反编译假象**：手写汇编/尾调用/无 frame pointer 会让函数边界与帧推断出错——以 Listing 汇编语义为准，不盲信反编译 C
- **大文件分析卡死**：间接调用爆炸/大型 C++ RTTI/混淆控制流——先降自动分析范围（限/关间接调用与 RTTI 选项），`-analysisTimeoutPerFile` 兜底
- **-noanalysis 的能力边界**：跳过自动分析后无函数/反编译，但符号（含 JNI 导出）与字符串扫描可用——单函数反编译仍要先跑局部分析

## 使用注意

- 静态分析免沙箱；内存 <4GB 换 [[re-radare2]]（启动即卡顿）
- 样本/工程/导出产物 sha256 存证（[[re-triage]]）；结论入 [[analysis-contract]]
- 版本相关行为（API 方法名、分析选项）以目标版本实际表现为准
