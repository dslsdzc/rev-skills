---
name: re-game
description: >
  游戏逆向：Unity/Unreal、Cheat Engine。触发词：游戏逆向、Unity、Unreal、Cheat Engine、内存修改、反作弊
---

# 游戏逆向（Unity / Unreal / Cheat Engine）

## 何时使用 / 何时不用

- 用：游戏逻辑逆向（Unity mono/IL2CPP、Unreal）；内存搜索与修改（CE 数值/指针扫描）；函数定位与修改（[[re-patching]]）；反作弊（EAC/BE）检测规避（分析环境内）
- 不用：纯静态读 Unity mono 逻辑（直接 [[re-dotnet]] 反编译 `Assembly-CSharp.dll`，无需本技能）
- 不用：移动端游戏（[[re-mobile]] / [[re-apk]] / [[re-ios]] / [[re-frida]]）
- 不用：只要成品修改器/外挂——本技能是分析路径，不做发布工具，在线对战反作弊风险自担

## 工具准备

反作弊游戏分析默认沙箱 + 隔离（[[platform-tips]] 最高原则；[[re-sandbox]] 强制前置）；动态调试按 OS 分支。

### Cheat Engine（CE，Windows）

- 安装: 官网 cheatengine.org 下载安装（`choco install cheatengine` 可选）
- 验证: 打开 CE，能 attach 任意进程并做数值扫描（First Scan 有结果）

### Unity 工具

- Il2CppDumper（IL2CPP 还原）: GitHub `Perfare/Il2CppDumper` releases（Windows exe / dotnet tool）
- mono 场景: 无额外工具，`Game_Data/Managed/*.dll` 直接交 [[re-dotnet]]（dnSpy/ILSpy）
- 验证: Il2CppDumper 对目标 `global-metadata.dat` 能产出 `dump.cs`（类/方法签名）与 `script.json`（函数地址）

### Unreal 工具（UnrealFinder 思路）

- UnrealFinder（GitHub `povlhp/UnrealFinder` 或同类 `Dumper-7`）: 定位 `GObjects`/`GNames` 等全局符号，导出 UObject 类树与函数地址
- 验证: 对目标 UE 游戏 exe 能列出 `GWorld`/`GNames` 地址并导出对象列表

### 调试器（按 OS）

- Windows: [[re-x64dbg]]（轻量断点调试）或 [[re-windbg]]（异常分析）
- Linux: [[re-gdb]]（Wine 下跑 Windows 游戏时读 Wine 进程内存，见 [[platform-tips]] Linux 分支 Wine 直读方案）

## 操作步骤

按顺序执行，每步存档（引擎识别证据、地址与偏移记录、dump 产物 sha256，[[re-triage]] 存证）。

1. **运行时/引擎识别**：
   - 目录特征: `Game_Data/Managed/Assembly-CSharp.dll` → Unity mono；`Game_Data/il2cpp_data/` + `global-metadata.dat` → Unity IL2CPP
   - Unreal 特征: `Engine/Binaries/`、`*.pak`、`<游戏名>-Win64-Shipping.exe`；字符串里搜 `GWorld`/`GNames`
   - 其他/自研引擎 → 常规 [[re-binary-core]] 流程，不走本技能
   - 存档: 引擎类型 + 版本（决定后面工具选型）

2. **Unity mono vs IL2CPP 导出**：
   - mono: `Game_Data/Managed/*.dll` 直接反编译（[[re-dotnet]]，dnSpy/ILSpy 打开 Assembly-CSharp.dll 即得全部 C# 逻辑，无需本技能动态部分）
   - IL2CPP（无托管 DLL）: Il2CppDumper 导出:
   ```
   Il2CppDumper.exe <Game.exe> <Game_Data>/il2cpp_data/Metadata/global-metadata.dat
   → dump.cs（类/方法/字段签名） + script.json（方法地址） + il2cpp.h（结构体）
   ```
   用 `dump.cs` 定位目标方法名，`script.json` 拿对应函数地址 → 到 exe 对应地址调试/patch（[[re-x64dbg]] / [[re-windbg]]）
   - 存档: dump.cs/script.json + 目标方法地址表

3. **内存搜索（CE）**：
   - 数值扫描: attach 进程 → 输入当前值 `First Scan` → 游戏中改变数值 → `Next Scan` 收敛地址列表
   - 指针扫描（ASLR 下地址会变）: 对已定位地址 `What accesses this address` → 记录访问指令偏移 → `Pointer scan` 生成指针链（保存 `.pt` 文件），重启后仍可用
   - 多级指针: 结构体基址形如 `Game.exe+0x2A3F4C → +0x10 → +0x28`——偏移由引擎对象结构决定（Unity 看 MonoBehaviour 字段顺序，Unreal 看 UPROPERTY 偏移）
   - 修改验证: 内存编辑或 CE Lua 脚本冻结值，观察游戏内行为变化
   - 存档: 地址表达式（模块+偏移）、指针链文件、扫描参数

4. **函数定位与修改**：
   - 代码↔内存: 对关键地址 `Find out what writes to this address` → 断点命中写代码位置 → 记下模块内偏移 → 在反编译器（[[re-ghidra]] / [[re-binaryninja]]）对应地址分析该函数
   - 或从 `dump.cs`/`script.json` 直接拿 IL2CPP 函数地址 → 反编译 → 修改（[[re-patching]]: 改跳转/参数/返回值）
   - 修改后测试: 沙箱内运行验证功能生效（[[re-sandbox]]），记录修改前后行为差异

5. **反作弊对抗（检测规避，沙箱内）**：
   - 认知: EAC/BattleEye 检测调试器存在、内存改写痕迹、CE/外挂痕迹、多开/虚拟化特征——分析环境与真实在线环境完全隔离（专用 VM + 快照，[[re-sandbox]] + [[platform-tips]] 最高原则）
   - 手段: 先静态分析检测点（[[re-anti-analysis]] 反调试思路），hook/绕过检测 API（NtQuerySystemInformation 等），修改最小化（用后恢复），避免长期驻留痕迹
   - 收尾: 分析完恢复快照；不做在线对战用途

## 跨域联合

- [[re-binary-core]]：游戏 exe 静态分析底座（[[re-format-pe]] 等）
- [[re-dotnet]]：Unity mono 托管逻辑反编译（本技能静态侧的主要工具）
- [[re-patching]]：函数修改落地（跳转/字节级 patch）
- [[re-anti-analysis]]：反作弊检测对抗（反调试思路复用）
- [[re-sandbox]]：反作弊游戏分析强制隔离（[[platform-tips]] 最高原则）
- [[re-mobile]]：移动端游戏（Unity/Unreal 移动版）转 [[re-apk]] / [[re-ios]] / [[re-frida]]
- [[re-cracking]]：单机游戏授权/激活校验绕过

## 常见坑与陷阱

- **IL2CPP 无托管 DLL 还去找 DLL**：现象——`Game_Data/Managed/` 下只有少量/无 DLL，反编译找不到目标逻辑；原因——IL2CPP 把 C# 编成原生二进制，托管 DLL 不存在；对策——直接用 Il2CppDumper（版本须支持目标 Unity 版本，太旧解析 `global-metadata.dat` 会失败），从 dump.cs 走函数地址
- **指针链扫描繁琐且易失效**：现象——数值扫描出的地址每次启动都变，直接改无效；原因——游戏使用动态内存分配/ASLR，基址每次不同；对策——CE `Pointer scan` 保存 `.pt` 指针链，或以模块基址+偏移（`Game.exe+0x...`）定位，启动后重算基址再偏移；多层偏移逐层确认
- **反作弊（EAC/BE）强检测**：现象——attach 被拒、调试器被检测、账号被封；原因——反作弊驱动级监控调试器与内存痕迹；对策——分析环境完全隔离（专用 VM/离线，[[re-sandbox]] + [[platform-tips]] 最高原则），检测点静态分析后绕过（[[re-anti-analysis]]），绝不在在线环境挂调试器
- **游戏更新频繁补丁失效**：现象——更新后原地址全失效、patch 不生效；原因——每次更新重编译，地址/偏移变化；对策——patch 记录用「模块+偏移+字节模式」而非绝对地址，更新后用新旧 exe diff 定位变化点，或按字符串/函数名（IL2CPP dump）重新定位
- **反作弊检测到虚拟化/多开**：现象——VM 里游戏直接退出或行为异常；原因——部分反作弊检测 VBS/VMP 特征与虚拟化环境；对策——按反作弊已知规避清单调整 VM 配置（隐藏 hypervisor 特征选项），仍不行就静态分析为主，动态部分转到无反作弊的旧版本/离线模式
- **UE5 Dx12 绘制 hook（虚表替换）**：现象——Dx11 的 Present hook（抄 ImGui）在 UE5 Dx12 上失效，Present 断下后堆栈里找不到主模块代码；原因——UE5 自带单独编译的 `D3D12Core.dll`（**Release 版叫 D3D12Core.dll、Debug 版叫 d3d12SDKLayers.dll**，不用系统目录 dll，特征码在系统 dll 里搜不到），且开启 GPU 加速/超分辨率时 Present 上层堆栈被其他 dll 占据；对策——用开源 UE5 源码自己编译一份 D3D12Core.dll 拖 IDA 做参照（`ExecuteCommandLists` 在 CommandQueue 虚表 index=10）；Present 断下后直接定位**主模块下的返回地址**（超分辨率按 dll 名识别，换模式换 dll 名思路不变）；虚表替换点：`mov rax,[rcx]` 调用处取 rcx（对象指针）替换虚表
- **游戏内 5 字节 hook 检测（反 hook）**：现象——定位到的目标函数头部已被改（经典 5 字节 hook 桩），且游戏自身调用能过、外部 hook 调用失败；原因——游戏/引擎自带调用来源检测（查堆栈返回），非自身调用会还原头部 5 字节；对策——不 hook 被保护函数本体，改在**调用它的位置**（堆栈返回处）hook 取对象指针（rcx/r12 等）替换虚表达成同等效果；识别特征：函数头 5 字节被改 + 函数内部有还原头部逻辑（FName::ToString/StaticFindObject 等关键函数多处同样处理）
- **IL2CPP 元数据还原**：现象——dump 工具报版本不支持/输出不全；原因——Unity 版本改 metadata 格式；对策——升级 dump 工具（Il2CppDumper 或 Il2CppInspectorRedux），必须用同一次 dump 的产物对（script.json 与 so 匹配，换 IDA 清缓存）
- **加密的 global-metadata.dat**：现象——元数据文件是密文；原因——反作弊/自定义加密；对策——找初始化解密函数（il2cpp_init 周围），Frida 在 mmap/read 后 dump 内存中已解密的元数据再喂给 dump 工具
- **IL2CPP 方法 hook**：现象——Frida 裸 hook 报错；原因——IL2CPP 方法非标准 Java/ObjC，需按 metadata 算偏移；对策——用 frida-il2cpp-bridge 库，不硬写 Interceptor.attach
- **patch 后闪退**：现象——静态修改后启动崩溃；原因——文件 hash 校验/anti-tamper；对策——hook 优先（不改文件）；必须静态 patch 时同步处理校验逻辑；重打包后删 META-INF 重新签名（apksigner）
（来源：reverse-skill field-journal，MIT）
