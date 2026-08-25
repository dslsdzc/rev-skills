# 内核逆向决策树与证据分级

## 场景决策树（入口 → 分支）

### 1. 目标类型判定（第一级）

```
拿到 .sys 或内核相关样本
├─ 单独 .sys（无用户态样本） → 静态主线（第 2 节）
├─ .sys + 用户态样本        → 静态主线 + 交互闭环（第 2 节 + IOCTL 分支）
├─ rootkit 嫌疑（隐藏/钩子行为报告） → rootkit 特征分支（第 3 节）
├─ 崩溃 dump / 蓝屏定位      → [[re-windbg]] !analyze -v 直接走
└─ 加载器/服务安装器含驱动   → 先还原安装链（服务注册），再进静态主线
```

### 2. 静态主线（驱动分析）

```
DriverEntry 定位（EP 或 stub 跳转）
├─ 注册 MajorFunction（28 项数组赋值/RtlCopyMemory）
│  ├─ 有 IRP_MJ_DEVICE_CONTROL(0x0E)/INTERNAL_DEVICE_CONTROL(0x0F) → IOCTL 分支
│  ├─ 有 IRP_MJ_READ/WRITE → 数据流 handler 分支
│  └─ 全默认 handler        → 可能靠 minifilter/回调工作（下查 Flt*/Ps* 导入）
├─ IoCreateDevice/IoCreateSymbolicLink → 设备名 → 用户态入口 \\.\名
├─ IoAttachDevice* 出现     → filter 驱动（文件/键盘/网络过滤）→ 查挂载点与回调
├─ FltRegisterFilter 出现   → minifilter → 查 FLT_REGISTRATION 与 Instances 配置
└─ PsSet*/CmRegister/ObRegister 回调注册 → 回调分支（第 3 节）
```

### 3. rootkit 特征分支（按技术归类）

```
rootkit 嫌疑特征
├─ 函数头被改写（jmp rel32 / mov rax;jmp rax）→ inline hook → 逐字节比原始镜像（≥16 字节）
├─ 表项地址异常（!ssdt 对照）→ SSDT hook → 注意 Win8 起符号不导出 + x64 PatchGuard
├─ 进程/驱动枚举差集 → DKOM 摘链表 → 调试对照 + 取证插件复核
├─ 回调数组异常地址 → 回调滥用 → 查回调类型与注册点
├─ 文件操作被劫持 → minifilter 挂载 → 查 FLT_REGISTRATION 回调表
└─ 无静态特征但有行为异常 → 动态：内核调试断点定位 + 内存取证对照
```

### 4. IOCTL 交互分支

```
DeviceIoControl 调用点（用户态样本）
├─ 取 IOCTL 码 → 解码 CTL_CODE(高 16 位设备类型, bit14-15 访问, bit2-13 功能, bit0-1 方法)
│  ├─ Method 0 (BUFFERED)  → SystemBuffer 处理
│  ├─ Method 3 (NEITHER)   → Type3InputBuffer（需自己探针/ProbeForWrite）
│  └─ Method 1/2 (DIRECT)  → MDL 映射
├─ 驱动 handler 反编译 → 输入结构逐字段对齐（类型传播复核）
└─ 闭环验证：用户态触发 → 内核断点命中 → 参数核对
```

## 证据分级表

| 级别 | 证据形态 | 示例 | 用途 |
|---|---|---|---|
| A 强 | 动态 + 静态闭合 | 内核断点命中 handler 且参数与静态分析一致；hook 字节与原始镜像 diff 落证 | 可下"确定"结论 |
| B 中 | 静态链完整 | DriverEntry→IRP→handler 全链还原、IOCTL 结构对齐 | 可下"高可信"结论 |
| C 弱 | 静态特征 | 仅导入表含 Flt*/回调 API、可疑字符串 | 只支持"疑似"，不下结论 |
| 反证 | 良性解释 | 回调为合规过滤功能（EDR/备份）、hook 是调试器断点 | 记录并存档 |

- 内核证据必须带版本上下文：结构偏移、符号可用性、PatchGuard 行为都随系统版本变——结论标注目标系统版本
- rootkit 结论要两条独立证据线（调试会话 + 取证转储）互相印证，单线证据降一级

## 实现教训（内化）

- 先符号后偏移：有符号服务器/PDB 时全部用符号字段名，裸偏移只在无符号时用并标注版本
- IRP 表是驱动的心脏：从 28 项分发表出发比从 DriverEntry 顺序读代码更能覆盖全行为
- 交互闭环比单向静态可信：IOCTL 结构是否猜对，用用户态触发 + 内核断点验证，比反复读反编译快
- rootkit 特征按"改了什么"分类：改表项（SSDT）/改代码（inline）/改链表（DKOM）/挂回调/挂过滤——每类有对应的对照方法，别混用
- PatchGuard 是分析边界也是安全边界：被保护结构的修改行为只在调试 VM 验证，报告里标注"该手法在目标版本是否仍可行"
- 每次驱动加载前打快照，崩溃即回滚——蓝屏是常态不是意外

## 使用注意

- 全部动态环节在沙箱调试 VM 内（[[re-sandbox]]，[[platform-tips]] 最高原则）；测试签名只开在分析 VM（见 [[gotchas]]）
- 内核分析结论涉及系统完整性（rootkit 手法），报告限定在授权分析范围，不提供可用做真实环境对抗的完整载荷
