# 内核逆向方法论坑与边界

## 版本差异组（内核分析的最大变量）

- **结构布局随版本变**：EPROCESS/DRIVER_OBJECT/_KPCR 等内部字段偏移随 Windows 版本变化（Win10 各 build 之间也有差异）——有符号用符号名，无符号按 `ntddk.h`/公开结构手工布局并标注目标版本；反例：旧版本文档偏移直接套新系统全错
- **导出符号随版本变**：`KeServiceDescriptorTable` Win8 起不再导出（SSDT 定位需按索引/内存特征找）；`!ssdt` 命令在新版 WinDbg 输出也不同——按版本查工具能力
- **签名要求随版本变**：x64 一直强制驱动签名；Win11 新版引入 attestation 签名要求——分析 VM 用测试签名（bcdedit，关 Secure Boot）只覆盖部分场景，某些驱动加载不了是环境限制，不是分析错误
- **PatchGuard 随版本变强**：Win7 时代有效的 SSDT/关键函数 inline hook，在 x64 新版触发 bugcheck 0x109（CRITICAL_STRUCTURE_CORRUPTION）——"历史手法"与"当前可用手法"要分开标注，别在真实环境验证受保护结构的修改

## rootkit 技术边界组（手法识别反例）

- **inline hook 不改地址**：函数指针/表项全正常 ≠ 无 hook——inline hook 改写函数头指令，必须逐字节比对原始镜像（从 `lmv m nt` 拿路径读原始文件），比对长度 ≥16 字节才覆盖 `mov rax,imm64;jmp rax` 形态
- **SSDT hook 不是唯一表**：新版系统还有 IDT/irp/回调等 hook 面——只查 SSDT 会漏；回调数组（PsSet*/CmRegister/ObRegister）与 minifilter 是更常见的现代手法
- **隐藏 ≠ 不存在**：DKOM 摘链表后 `!process` 看不到，但对象仍存活（句柄/引用可定位）——取证复核用 `psxview` 的交叉视图而非单视图
- **minifilter 伪良性**：`FltRegisterFilter` 本身是合规过滤框架（EDR/备份/杀软都在用）——判断恶意性要看回调做什么（读写内容篡改？），不是看有没有注册
- **调试器 vs 恶意 hook 混淆**：内核调试下的断点（`ba`/`bu`）也会改写指令/寄存器上下文——采集 hook 证据前先停用调试器断点，避免把调试痕迹当样本行为

## 环境与工具组

- **蓝屏即回滚**：驱动 bugcheck 后调试会话可能不可用（重试时驱动已加载一半）——快照回滚是最快的恢复路径，别在坏状态里继续验证
- **断点未解析**：`bp <地址>` 在模块未加载时无效——用 `bu <符号>`（延迟绑定）；`ba` 硬件断点受数量限制（4 个）且要求地址对齐
- **符号服务器可达性**：内网/离线环境 `!analyze -v` 无符号输出变裸地址——预下载符号缓存（`srv*C:\symbols*...` 提前 `.symfix`+`.reload`），分析前确认符号加载
- **测试签名环境差异**：测试签名只影响驱动加载校验，不影响 PatchGuard/结构校验——"能加载"不等于"能 hook"，边界分开判断
- **VM 内核调试链路**：串口 named pipe 比 KDNET 稳（不依赖网卡）；调试机与目标机时间/性能差异会影响时序类检测行为——记录环境参数

## 使用注意

- 驱动加载/触发/验证全部在调试 VM 内（[[re-sandbox]] + [[platform-tips]] 最高原则），生产环境不加载分析样本
- 结论按 [[decision-tree]] 证据分级标注版本上下文；rootkit 手法描述限定在授权分析场景
