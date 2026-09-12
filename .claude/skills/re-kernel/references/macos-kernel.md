# macOS 内核扩展分支：两代模型（KEXT / System Extension + DriverKit）

**关键前提**：Apple 已明确 **deprecated KEXT**；现代替代是 **System Extension / DriverKit**，且 **DriverKit 驱动（dext）运行在用户空间**——分析模型完全不同，**不要把 dext 当"新版 kext"**。

## 一、第一代：KEXT（内核扩展，legacy）

1. **先读 `Info.plist`，不要先反汇编**：`CFBundleIdentifier`、`CFBundleExecutable`、`OSBundleLibraries`（依赖）、`IOKitPersonalities`（`IOClass` / `IOProviderClass` / matching properties）——往往已经回答了：绑定什么设备 → 创建什么 IOService → 依赖哪些内核组件 → **哪个类是真入口**
2. 然后才进 Mach-O（[[re-format-macho]]：LC_*、段、符号）
3. **用户态接口是最高价值目标**：
   `IOService::newUserClient` → `IOUserClient` 子类 → `externalMethod(selector, ...)` → 分发表 → 具体 handler。
   Apple 的接口定义表明 ExternalMethod 接收 selector 与 scalar/structure 输入输出，并通过 `IOUserClientMethodDispatch` 检查参数个数与结构大小。
   → **先恢复 selector map（0→handler A、1→handler B…），再逐个逆 handler**，而不是从 KEXT 第一条指令顺序啃
4. **AuxKC 版本不一致（macOS 11+ 的真实坑）**：第三方 kext **不能按需加载**，会被并入 **Auxiliary Kernel Collection（AuxKC）**，**在启动时**加载。更新或卸载 kext 后，**即使磁盘内容已经改变，重启之前旧版本仍可能继续运行**。
   所以 `/Library/Extensions/foo.kext` **不能等价于**"当前内核中执行的 foo"——逆向与复现实验要记录 **disk bundle version / AuxKC version / running version / boot time**，否则会出现"我 patch 明明改了，为什么行为没变？"（跑的是旧 AuxKC）。
   - 相关工具：`kmutil`（构建/安装内核集合）；AuxKC 缓存位于 `/System/Volumes/Preboot/*/boot/*/System/Library/Caches/com.apple.kernelcaches/`
   - 重建 AuxKC 需要用户批准 + 重启（且 Secure Boot 需为 Reduced Security）；LocalPolicy 中与 kext 集合相关的字段（用户授权 kext 列表哈希 `auxp`、AuxKC 镜像清单签名 `auxi`、收据哈希 `auxr`）会随之变化
5. **codeless kext**：有 `Info.plist` 但**没有可执行文件**是合法形态——作用是 matching/配置（把设备绑定给既有系统驱动；`kmutil` 的报错信息里也会出现 codeless kext）。
   正确操作：分析 matching 规则 → 找最终绑定的系统驱动 → **逆那个驱动**，而不是继续找"不存在的二进制"
6. **Apple Silicon 上大量 PAC 指令是正常的（arm64e）**：`pacibsp` / `autibsp` / `braa` / `blraa` 等 Pointer Authentication 序列**不是混淆**；"raw 64-bit pointer == code address"的旧假设不成立——需要 PAC-aware 的反汇编与地址规范化

## 二、第二代：System Extension / DriverKit（dext，**用户态**）

Apple 明确：现代 System Extension 在**用户空间**运行。分析模型随之变成：

```
Mach-O 用户态可执行
   → DriverKit 类
   → IOUserClient
   → DriverKit IPC（用户态驱动 ↔ 内核中介 / 硬件）
```

- 安装位置：`/Library/SystemExtensions/<UUID>/<bundle-id>.dext`（宿主 App 通过 `OSSystemExtensionRequest` 申请激活，系统负责安装与审批）
- `Info.plist` 特征：`IOKitPersonalities` 用 `IOUserClass` / `IOUserServerName` / `IOProviderClass`（如 `IOUSBHostInterface`）；`UserClientProperties` 里 `IOClass = IOUserUserClient`
- **"连不上"不一定是 selector 分析错**：默认只允许**相同 Team ID** 的进程连接；允许其他 Team 需要 `com.apple.developer.driverkit.allow-any-userclient-access` 一类 entitlement（还要向 Apple 申请 capability），而且 **sandbox 仍可能继续阻止**。日志里可见 `provider entitlements check failed` / `IOUserServer(...)::exit(Entitlements check failed)`
  - 排错顺序：extension 是否 **activated**？→ service 是否存在？→ **entitlement / Team ID / sandbox**？→ 才轮到 `IOServiceOpen` 与 selector/参数
- 采集侧：dext 按**用户态进程**处理即可（不需要内核态手段）——见 [[re-sample-acquire]] 的 macOS 分支

## 三、签名与权限现实（决定能不能分析/加载）

- KEXT 需签名与用户批准；macOS 11 起只能并入 AuxKC 在启动时加载（见上）
- System Extension 激活会检查：文件位置、代码签名、**Team ID**、entitlement、bundle identifier（是否已被其他 extension 占用）
- 结论：分析前先确认"目标处于哪一代模型 + 是否已激活/被批准"，否则会在错误的前提上做静态分析

## 工具与验证

- `otool` / `vmmap`（Mach-O 与内存视图，[[re-format-macho]]）、`ioreg`（IORegistry：谁绑定了什么设备）、`kmutil`（kext 与内核集合）、`codesign -d --entitlements :-`（签名与 entitlement）、`lldb`（[[re-lldb]]）
- 验证：kext 能给出「Info.plist 的 IOKitPersonalities → 目标 IOService/IOClass → `newUserClient` 链」；dext 能确认「用户态进程 + 宿主 App + 激活状态」

## 该平台的坑

- **把 dext 当"新版 kext"**：它跑在用户空间，分析模型不同（先按用户态可执行分析）
- **只分析磁盘上的 kext**：实际运行的是 AuxKC 里的版本——先核对 disk/AuxKC/running 版本与 boot time
- **把 codeless kext 当坏包**：去逆它实际绑定的系统驱动
- **把 arm64e 的 PAC 指令当混淆**
- **IOUserClient 连不上就怀疑 selector**：先查 activated / entitlement / Team ID / sandbox
