# macOS 低层分支：KEXT / DriverKit(DEXT) / System Extension / 内核集合

<CORE RULE>
macOS 的坑在于**三套完全不同的低层模型混在一起**：

| 模型 | 执行位置 | 时代 |
|---|---|---|
| KEXT + IOKit | **内核态** | 传统 |
| DriverKit / DEXT | **用户态** | 现代驱动 |
| System Extension | **用户态框架**（可承载 DriverKit / EndpointSecurity / NetworkExtension） | 现代系统能力 |

Apple 明确：KEXT 在内核态，DriverKit 与 System Extension 在用户态；macOS 11 起能用 System Extension/DriverKit 实现的功能通常不再走 KEXT 路径。**所以第一条经验不是"先反汇编"，而是先确认你在逆哪一代东西。**

四个最容易让整条分析链跑偏的事实：
① **codeless KEXT 可能根本没有代码**；
② **磁盘上的 KEXT 与当前运行的可能是两个版本**（AuxKC）；
③ **arm64e 指针不能按普通 64 位函数指针解释**（PAC）；
④ **`IOServiceOpen` 失败可能停在 entitlement/activation 层**，根本没走到你的 UserClient。
</CORE RULE>

## 一、先分类（决定后面全部）

`KEXT` / `codeless KEXT` / `DEXT(DriverKit)` / `System Extension` —— 四类模型不同，误判一次后面全错。

## 二、KEXT：`Info.plist` 先行，不要先反汇编

`Foo.kext/Contents/` 下的 `Info.plist` 价值极高，因为 **`IOKitPersonalities` 直接描述匹配条件**：

`IOClass` / `IOProviderClass` / `IONameMatch` / `IOPCIMatch` / `IOPCIPrimaryMatch` / `IOKitDebug` / `CFBundleIdentifier` / `OSBundleLibraries`

IOKit 的 matching 模型就是"personality 字典决定哪个 driver 能绑定哪个 provider"；PCI personality 甚至直接含 vendor/device ID 匹配规则。

正确顺序：

```
Info.plist → 确定 IOClass / Provider / hardware match → 确定依赖
  → Mach-O → 恢复 C++ class hierarchy → 找 Start / Stop / newUserClient / externalMethod
```

**而不是从 `_start` 顺着 CFG 啃。**

## 三、codeless KEXT：没有 Mach-O 不代表文件坏了

Apple 正式支持 **codeless KEXT**：可以完全没有 executable，只靠 `Info.plist` 做 hardware matching，把设备交给已有系统 driver。

```
Foo.kext/ └── Info.plist        （没有 Contents/MacOS/Foo —— 合法）
```

正确分析：`IOKitPersonalities` → `IOProviderClass` → matching properties → **最终匹配到哪个 Apple driver** → 去分析真正执行的那个 driver。不要浪费时间寻找"不见了的 payload"。

## 四、磁盘上的 KEXT ≠ 当前正在运行的 KEXT（比 Linux 的 `.ko` 更严重）

- macOS 11 起第三方 KEXT **不再按需 load**，而是进入 **Auxiliary Kernel Collection（AuxKC）**、随 boot 加载
- 更新 KEXT 后，即使 `/Library/Extensions/Foo.kext` 已是新版，**reboot 前机器仍可能执行旧版本**
- 卸载同理：`kmutil unload` / `kextunload` **不意味着立即从运行中的内核拔掉**——新的 kernel collection 要等重启才生效，旧 KEXT 可能一直活到重启
- 所以"我明明 patch 了这个 KEXT，行为为什么还是旧的？"→ **优先怀疑 disk = version B / running AuxKC = version A**，而不是"patch 没生效 / 分析错了 / 缓存没刷"
- 运行态逆向至少要区分三份：**磁盘 bundle / AuxKC 中的 image / 当前 boot 中真正映射的 image**（可对比运行 UUID 与磁盘 UUID）
- 推论：逆向实验若不考虑这点，极易得到假结果——"工具显示已请求 unload" ≠ "代码现在已经不存在"

## 五、Apple Silicon：arm64e 与 PAC 不是混淆

- Apple Silicon 的 KEXT 必须支持 **arm64e**，于是频繁出现 `pacibsp` / `autibsp` / `pacia` / `autia` / `braa` / `blraa` / `retab`，以及"地址高位看起来不对"的指针
- **不要**把 64-bit raw value 直接当普通 canonical pointer——尤其是 **vtable / function pointer / callback / return address**
- 常见误判："function pointer 看起来不在 `__TEXT_EXEC` → pointer 被破坏了" —— 实际可能只是 **PAC-signed pointer**
- 结论：**class / vtable 重建必须 PAC-aware**

## 六、KEXT 的重点是 IOKit class graph，不是普通 call graph

- C++ IOKit 典型生命周期：`OSObject → IORegistryEntry → IOService → YourDriver`，主要围绕 `init` / `probe` / `start` / `stop` / `free`
- 真正高价值的是：**class hierarchy、vtable、OSMetaClass、IOService 继承链**，而不是"哪个函数 call 次数最多"
- **单独一个 KEXT 不一定够恢复完整类层级**——它依赖 kernel 与其他 IOKit family 的 class/vtable；实践做法是先恢复 kernel/依赖的 class metadata，再把该 KEXT 的 class 接回完整层级
- 所以"单独 KEXT 里大量 unresolved virtual calls"不一定是 stripped 太狠，**可能只是你没有它的 kernel / superclass type universe**

## 七、攻击面优先追 `newUserClient`

```
IOService → newUserClient() → IOUserClient subclass → externalMethod()
```

用户态入口：`IOServiceOpen` → `IOConnectCallMethod` / `IOConnectCallScalarMethod` / `IOConnectCallStructMethod` / `IOConnectCallAsyncStructMethod`。

实用策略：**先恢复 `selector → handler` 映射**，而不是先分析整个硬件实现。

## 八、selector 不是函数地址；dispatch 会在 handler 之前做 ABI 检查

- DriverKit 保留同一核心模型：`ExternalMethod(selector, arguments, dispatch, target, reference)`（在驱动内调用时 `dispatch` 为 NULL；非 NULL 时先按 dispatch 校验 arguments 再调用其 `function`）
- **字段名注意前缀**：dispatch 结构里的字段是 `function` / `checkCompletionExists` / `checkScalarInputCount` / `checkStructureInputSize` / `checkScalarOutputCount` / `checkStructureOutputSize`（**带 `check`**）；不带前缀的 `scalarInputCount` / `structureInputSize` / … 是 **arguments**（`IOUserClientMethodArguments`）的字段，两者别混
- kext 侧的 dispatch 表是位置式（8 字节函数指针 + 四个 uint32）；变长结构用 `kIOUCVariableStructureSize`
- **`kIOReturnBadArgument` 不一定是 handler 自己返回的**：框架层会在 handler 真正执行之前按 dispatch 拒绝（scalar 数量 / 结构大小 / completion）。排查顺序：

```
selector 对吗 → dispatch entry 对吗 → scalar count 对吗 → structure size 对吗
  → async completion 对吗 → 才进入 handler 本身
```

- 特别是 `checkCompletionExists = true` 时：**completion 需要有效的通知 Mach port**（`IONotificationPortCreate` + `IONotificationPortGetMachPort` 一类）；传错端口（例如主/主控端口）同样会得到 `kIOReturnBadArgument`——不是 handler 的逻辑问题
- DriverKit 异步：`IOUserClient::AsyncCompletion` 取代 kext 的 `sendAsyncResult64()`；注意**小 `structureOutput`（≤4096 字节）不能异步填充**，必须由 `ExternalMethod` 立即返回（只有能走 `structureOutputDescriptor` 的大缓冲才能延后填）

## 九、`IOServiceOpen` 失败：先查授权链，最后才怀疑 selector

```
service 是否真的存在 → DEXT 是否 active → matching 是否成功
  → entitlement → Team ID / signature → sandbox → UserClient policy
  → 最后才是 selector / 协议问题
```

- entitlement 名：客户端 `com.apple.developer.driverkit.userclient-access`（声明允许访问哪些 DriverKit service）；驱动侧 `com.apple.developer.driverkit.allow-any-userclient-access`（允许任意应用连接）
- 这类失败常见症状：`provider entitlements check failed` / `IOUserServer(...)::exit(Entitlements check failed)`

## 十、`.dext` 不要按 KEXT 逆（用户态模型）

DriverKit 驱动本质是**用户态**扩展，不是 ring-0 模块。分析模型：

```
Mach-O userspace executable → DriverKit 生成/运行时代码 → IOService subclass
  → IOUserClient → DriverKit IPC → kernel-mediated device access
```

**立刻停止 KEXT 模型的信号**：看到 Foundation/普通用户态运行时、普通 Mach ports、SystemExtension host app。

调试模型也随之不同：**dext 可以按普通进程调**（用户态调试器），不会因为断点把整机内核一起停掉。

## 十一、System Extension ≠ DriverKit 的同义词

`DriverKit` / `EndpointSecurity` / `NetworkExtension` 都可以作为 System Extension 运行。

看到 `*.systemextension` **不能**推断"硬件驱动"——System Extension 本身只是"高权限 user-space extension"的安装/生命周期框架，业务语义可能属于完全不同的 API。先看：**entitlements / linked frameworks / bundle metadata**。

## 十二、Host App 与 DEXT 分离时，两边都要逆

```
Host.app/Contents/Library/SystemExtensions/Foo.dext
```

Host app 负责 activation（用 SystemExtensions framework 提交 activation request），DEXT 负责 driver。完整 RE 应同时分析：

- **Host app**：installation/activation、IOService discovery、`IOConnect` 调用
- **DEXT**：matching、ExternalMethod、实际驱动

**selector 与输入结构常常在 client app 端更容易恢复。**

## 十三、"DEXT 文件存在" ≠ "DEXT 已经运行"

System Extension 有独立 activation 生命周期，六态要分开：

```
bundle exists → registered → approved → activated → matched → started
```

`.app` 内存在 `Foo.dext` 只说明"安装包包含它"；注册/审批/激活/匹配/启动都要各自核实（bundle identifier、filename、Team ID、签名与公证都要满足规则）。

## 十四、Apple Silicon 上 KEXT 不能靠 Rosetta

- Apple 文档明确：**Rosetta 不翻译 kernel extension**（也不翻译虚拟化 x86_64 平台的 VM app）
- x86_64 kext 在 Apple Silicon 上加载失败：

```
Error Domain=KMErrorDomain Code=71
"Incompatible architecture: Binary is for x86_64, but needed arch arm64e"
```

- 这**不是**安全设置 / SIP / 权限问题——只能由开发者重编为 arm64e（或 universal）
- 所以"host app 正常启动但 driver 永远加载不了"不是 UserClient bug，也不是你用错了 API

## 十五、Kernel Collection：运行态不是"一个 kernel + 一堆随时独立 load 的 bundle"

- 现代 macOS 的运行态涉及 **Kernel Collections**：kernel / Apple KEXTs / 第三方 KEXTs（第三方走 **AuxKC**）
- 做**地址归属、KEXT inventory、symbolication、runtime-vs-disk 对比**时都要把 KC 结构算进去
- 对照：不是 Linux 那种 `insmod → runtime relocate → 马上出现` 的模型

## 十六、Panic 符号化：`__TEXT` vs `__TEXT_EXEC`

- arm64/arm64e 上，panic 里的 KEXT load address **不能直接当代码 image base**
- 常见布局：`__TEXT` 从 0 开始，而可执行代码在 `__TEXT_EXEC` → **必须把 `__TEXT_EXEC.vmaddr` 加到 load address** 再交给 `atos -l`

```sh
# 取 __TEXT_EXEC 的 vmaddr（例如 0x4000）
otool -arch arm64e -l Foo.kext/Contents/MacOS/Foo | grep -A4 __TEXT_EXEC
atos -arch arm64e -o Foo.kext.dSYM/Contents/Resources/DWARF/Foo \
     -l <load_address + __TEXT_EXEC.vmaddr> <panic_addr>
```

- 不加这个偏移，`atos` / `lldb image lookup` 会返回垃圾（例如解析到 `__TEXT.__cstring` 而不是指令）
- 内核回溯同构：先算 `__TEXT_EXEC.vmaddr` 与首段之差，再从 panic 的 "Kernel text exec base" 里**减掉**，用得到的基址跑 atos

## 十七、符号化必须匹配 UUID/build，不只是版本号

- panic/crash report 记录相关 image 的 **UUID** 与地址范围；UUID 在 crash report 格式里就是"用于匹配对应符号文件/dSYM 的 build identifier"
- 版本号（`Foo.kext 1.2.3`）相同**仍然不够**——要 **UUID + architecture + exact build**
- 症状对照："函数名大概对、行号很怪、offset 一直飘" → 多半是符号文件不是同一个 build

## 十八、KEXT 进不了内核：签名合法 ≠ 系统会加载

Apple Silicon 上传统 KEXT 受整套 boot policy 约束：

```
Reduced Security（1TR 模式降级 + 勾选允许用户管理 kernel extension + 管理员密码）
  + 用户 approval + UAKL + AuxKC rebuild + reboot
```

- **UAKL**（User-Approved Kernel Extension List）：用户授权的 kext 列表的 SHA384 哈希进 LocalPolicy；内核侧 kmd 校验**只有 UAKL 内的 kext 才能进 AuxKC**
- **SIP 与签名**：SIP 开启时每个 kext 的签名在进入 AuxKC 前会被校验；SIP 关闭则不强制（permissive security，用于测试未签名 kext）
- **AuxKC 完整性**：创建后其测量值由 Secure Enclave 签名进 **Image4** 结构、由 iBoot 在启动时评估；并生成 kext receipt（可能因禁用 kext 而小于 UAKL），哈希进 LocalPolicy
- 所以"完全加载不了"要分开判断：**architecture / code signature / user approval / UAKL / boot security policy / AuxKC inclusion**

## 十九、SIP 关掉 ≠ Apple Silicon 的限制都没了

别把 macOS 当"关掉 SIP 就等于 Linux root"。这一层之上还有：secure boot policy / LocalPolicy / AuxKC measurement / **KIP** / PAC。

- **KIP（Kernel Integrity Protection）**：内核初始化完成后启用；iBoot 把 kernel 与 kexts 载入**受保护的物理内存区**，启动完成后**内存控制器拒绝对该区的写入**，MMU 同时阻止"从区外映射特权代码"与"区内可写映射"；使能 KIP 的硬件在启动后被**锁定**（所以 `csrutil disable` 不等于"内核随便 patch"）
- 相关：PPL（iOS/iPadOS/watchOS）、**SPTM/TXM**（A15+/M2+ 及以后）、SCIP（协处理器固件）、KTRR
- 做动态 patch/hook 实验前先搞清楚撞到的是哪一层：**SIP / KIP / secure boot / PAC / code signing**

## 二十、rootkit / malware 分析：落点不止 syscall hook，且强年代相关

- 历史上 KEXT rootkit 落点：`syscall`、**`kauth`**、IOKit、process structures、network stack、inline patch、**kernel symbol lookup**（公开案例：恶意 KEXT 解析 kernel symbols、修改内核状态做进程隐藏）
- **年代差异必须纳入判断**：

```
10.x Intel          ≈ 传统 KEXT 世界
11+ Intel           ≈ KC / modern policy 过渡
11+ Apple Silicon   ≈ arm64e + PAC + AuxKC + 严格 boot policy
```

- 在现代 Apple Silicon 上，"加载任意 KEXT → inline patch kernel"已比老 Intel 困难得多
- **不能拿 2012 年的 KEXT rootkit 手法直接解释 2026 年的 Apple Silicon**——样本行为与年代强相关

## 二十一、动态调试：KEXT 本来就该双机，DEXT 反而按普通进程调

- Apple 明确：KEXT/kernel **不能像普通用户态进程那样本机调试**（debugger 自己也依赖内核）。官方方案：日志 / **双机 KDP+LLDB** / panic core dump / **KDK**（匹配 kernel 符号）；需要早期或死锁现场时触发 **NMI** 让 target 停下等待远程调试器（Apple Silicon 的 NMI 组合键与 boot debug flags 有正式文档）
- 所以"attach lldb 到 kernel 失败"**不要**沿普通 userspace anti-debug 方向排查
- 反过来这是 DriverKit 最大的不同：**dext 在用户态 → 优先 userspace debugger**，不要一上来就搭 KDP 双机环境

## 决策树

```
拿到 macOS low-level target
├─ 先分类：KEXT / codeless KEXT / DEXT(DriverKit) / System Extension
├─ KEXT
│    ├─ Info.plist / IOKitPersonalities（IOClass/Provider/match）
│    ├─ Mach-O architecture（arm64e？PAC？）
│    ├─ class / vtable / OSMetaClass（需要 kernel/依赖的 type universe）
│    ├─ IOService 生命周期 init/probe/start/stop/free
│    └─ newUserClient → externalMethod（selector 表优先）
├─ 没有 executable → codeless KEXT → 找真正匹配的系统 driver
├─ 磁盘内容与运行行为不一致
│    ├─ AuxKC 仍是旧版本？ reboot 完成了吗？ disk UUID vs running UUID？
├─ Apple Silicon 约束
│    ├─ arm64e？PAC？KIP？Reduced Security？UAKL / AuxKC / LocalPolicy？
│    └─ x86_64 kext → KMErrorDomain 71（Rosetta 不翻译 kext）
├─ UserClient 调不通
│    ├─ service 是否 matched/started → selector → dispatch(count/size/completion)
│    ├─ entitlement → Team ID → sandbox
├─ symbolication 错
│    ├─ UUID / exact build(KDK) / architecture / __TEXT vs __TEXT_EXEC / runtime load address
└─ 动态调试
     ├─ KEXT/kernel → KDK + 双机 KDP/LLDB 或 panic core
     └─ DEXT → userspace debugger
```

## 工具与验证

- 结构：`otool -l`（段与 `__TEXT_EXEC.vmaddr`）、`vmmap`、`ioreg`（IORegistry：谁绑定了什么设备）、`codesign -d --entitlements :-`
- 集合与生命周期：`kmutil`（kext 与 kernel collection）、System Information / 系统设置里的扩展列表（UAKL / 已批准项）
- 符号化：`atos -arch arm64e -o <dSYM> -l <调整后基址>`、`lldb image lookup`（先按 §16 调整基址）
- 调试：KEXT → KDK + 双机 KDP/LLDB；DEXT → userspace debugger（lldb 直接 attach 进程）
- 验证：能同时说清「哪一代模型 + 哪份版本（磁盘/AuxKC/运行）+ 该管线的授权链状态（signed/approved/activated）」

## 该平台的坑（汇总）

- **把 dext 当"新版 kext"**：它跑在用户态，分析模型与调试模型都不同
- **只分析磁盘上的 kext**：先对齐 disk / AuxKC / running 三份版本与 UUID
- **以为 `kextunload` 后代码就没了**：重启前可能仍在运行
- **把 codeless kext 当坏包**：去逆它实际绑定的系统驱动
- **把 arm64e 的 PAC 指令当混淆 / 把 PAC 指针当损坏**
- **`IOServiceOpen` 连不上就怀疑 selector**：先查 activated/entitlement/Team ID/sandbox
- **把 `kIOReturnBadArgument` 当 handler 逻辑失败**：先查 dispatch 的 count/size/completion（含通知端口）
- **把 `*.systemextension` 一律当硬件驱动**：先看 entitlements 与 linked frameworks
- **只逆 .dext 不看 Host app**：selector 与输入结构常在 client 端更好恢复
- **panic 符号化直接减 KEXT base**：漏了 `__TEXT_EXEC.vmaddr`
- **拿版本号当 build 匹配**：要 UUID + arch + exact build（KDK）
- **签名合法就以为能加载**：还要 UAKL / 用户批准 / Reduced Security / AuxKC 重建 / 重启
- **以为关掉 SIP 就能随便 patch 内核**：还有 KIP / secure boot / LocalPolicy / PAC
- **拿老 Intel 的 KEXT rootkit 手法套 Apple Silicon**
- **在 KEXT 上硬啃本机调试**：KEXT 本就该双机（KDK + KDP）；但 DEXT 可以直接用用户态调试器
