---
name: re-game
description: >
  游戏逆向：Unity/Unreal、Cheat Engine、Lua 脚本引擎、图形 Shader。触发词：游戏逆向、Unity、Unreal、Cheat Engine、内存修改、反作弊、Lua、LuaJIT、.luac、.jsc、脚本引擎、Shader、着色器、SPIR-V、DXIL、DXBC、GLSL
---

# 游戏逆向（Unity / Unreal / Lua 脚本引擎 / 图形 Shader）

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

## 游戏脚本引擎（Lua / LuaJIT）

游戏逻辑常由脚本层承载（角色行为、技能数值、关卡配置），当分析对象从引擎 C++ 侧转到脚本字节码时：先识别脚本 VM 与精确版本，再按版本走字节码解析路径。

### 字节码识别（header 签名 / 版本）

- 标准 Lua 字节码头部: `0x1B 4C 75 61`（`\x1bLua`）+ 版本字节——5.0=0x50、5.1=0x51、5.2=0x52、5.3=0x53、5.4=0x54；5.3 起头部含格式/校验数据与 int、size_t、指令、lua_Integer、lua_Number 各宽度字段，尾部带校验值
- LuaJIT 字节码头部: `0x1B 4C 4A`（`\x1bLJ`）+ 版本字节——2.0=0x01、2.1=0x02，其后是端序与各类型宽度标志
- 内存侧识别: 扫描魔数（[[re-memdump]]），或按解释器版本字符串（`Lua 5.x` / `LuaJIT 2.x`）与错误消息（`attempt to call a nil value` 类）的引用定位解释器
- 存档: VM 类型 + 精确版本 + 端序/宽度参数（决定解析路径）

### 指令结构

- Lua 5.1~5.3: 32 位指令 = opcode(6) + A(8) + B(9) + C(9)；Bx 为 B|C 拼接（18 位），sBx 带符号
- Lua 5.4: opcode 扩到 7 位，A 8 位、B/C 收窄到 8 位并新增 k 标志位，Bx 17 位——5.3 及之前的解析表不可复用
- LuaJIT: 32 位指令两种格式——ABC 格式 opcode(8) + A(8) + C(8) + B(8)（内存小端字节序为 OP/A/C/B 顺序）、AD 格式 A(8) + D(16)；无 Bx 字段，D 字段承担常量索引与跳转偏移（跳转偏移带偏置，D − 0x8000）
- 解析思路: 按版本取指令布局表，把 32 位字拆字段；布局表版本取错的表现是跳转目标/寄存器索引越界
- 跳转偏移以指令索引为单位（不是字节），基准随版本略有差异，解析时按版本确认

### 常量表 / upvalue 表定位

- 函数原型（Proto）序列化顺序固定: source 字符串 → 行号/参数/vararg/maxstacksize → 代码段 → 常量表 → upvalue 表 → 嵌套 Proto → debug 信息；字符串为长度前缀编码，按序推进
- 常量表价值: 脚本内数值/字符串（技能数值、关卡配置、校验用密钥）直接可读，比还原完整语义更快
- 内存侧: 在加载/执行 API 处拿 Proto 布局，或按已知常量值特征（格式字符串、特定数值）在堆中搜索

### 反汇编思路（luac 类工具）

- 按「头部 → 指令 → 常量/upvalue → 嵌套 Proto」逐层解析，输出伪汇编（`GETGLOBAL`/`CALL` 类）
- 现成解析器不支持目标版本时，按上述字段顺序自写解析器（量级小），核心是版本正确的指令布局表
- 产出用于: 按常量表字符串/数值交叉引用找目标函数；改指令操作数或常量值实现修改（[[re-patching]] 思路）

### LuaJIT 字节码差异

- LuaJIT 字节码与标准 Lua 5.1 字节码不兼容（语言层面兼容，指令集不同）；LuaJIT 2.0 与 2.1 之间也不兼容（opcode 编号/语义有变）
- 字节码与运行时绑定: 端序、指针宽度、类型宽度都写进文件头，异平台 dump 的文件直接换环境会解析失败
- 对策: 严格按 `\x1bLJ` + 版本字节走 LuaJIT 解析路径；修改优先在源码/字节码层面完成，不跨版本搬运

### Cocos 系脚本资源提取（.jsc / .luac 混淆变体）

- Cocos2d-x Lua 场景: `.luac` 为标准 Lua/LuaJIT 字节码，常见混淆变体为头部截断（删/改 `\x1bLua` 魔数）与单字节 XOR 全文件；加密类变体（XXTEA 方案，密文带 `xxtea` 起始标记时先解密再走字节码路径）
- Cocos Creator 场景: `.jsc` 为 JS 引擎字节码，同样常见头部截断/XOR 变体
- 对策（先识别再解）: 以已知魔数为 crib 恢复——掩码 = 魔数对应字节 XOR 文件首字节，恢复魔数后再按版本解析；截断则先补齐头部字节；方法与 [[re-fw-extract]] 的 XOR 章节同构（块首掩码、分块周期变换思路直接复用）

### 脚本函数 hook（[[re-frida]] / 内存侧）

- 加载面: `luaL_loadbuffer`/`luaL_loadbufferx`/`luaL_loadfile`/`lua_load`——hook 截获原始字节码/源码，适合改脚本逻辑（替换字节码、改常量）
- 执行面: `lua_pcall`/`lua_pcallk`/`lua_call`——hook 截参数/返回值，适合改运行行为；LuaJIT 另有不经 C API 包装的汇编调用路径
- 内存侧: 不 hook 时直接 patch 已加载字节码（改常量值/跳转），或改资源文件后替换加载路径
- 无符号场景: 按版本字符串/错误消息引用定位解释器函数地址

### 常见坑

- **Lua 版本间字节码不兼容**：现象——dump 出的字节码换工具/换运行时解析乱码或直接失败；原因——Lua 5.1~5.4 与 LuaJIT 的指令布局、头部字段、校验数据都不同，同版本还分端序/宽度，5.4 连 opcode 位数都改了；对策——先按魔数 + 版本字节精确判定版本与端序/宽度，再选对应解析路径；跨版本场景先找同版本源码/解释器重编译对照，不硬解
- **.jsc/.luac 变体魔数被截断**：现象——文件头不是 `\x1bLua`/`\x1bLJ`，直接按字节码解析失败；原因——混淆变体截掉或改掉魔数（截断头部、单字节 XOR 全文件）；对策——先识别再解：以已知魔数为 crib 恢复掩码（掩码 = 魔数字节 XOR 文件对应位置字节）或补齐截断头部，恢复魔数后再按版本解析；XXTEA 类加密先按加密特征解密再走字节码路径
- **hook 点选择：lua_pcall 不是唯一入口**：现象——只 hook `lua_pcall` 时部分脚本行为没被触发或重复触发，hook 加载类 API 又拿不到目标脚本；原因——解释器存在多个调用面（`lua_call`/`lua_pcallk`/加载类 API 各自成面），LuaJIT 还有不经 C API 的汇编调用路径；对策——先定目标：改脚本逻辑 hook 加载面拿字节码，改运行行为 hook 执行面或内存 patch；hook 不到时按版本字符串/错误消息引用定位解释器内部调用点
- **跳转目标换算错误**：现象——反汇编出的跳转目标地址荒谬/越界；原因——Lua 字节码跳转偏移以指令索引为单位（不是字节），且 Bx 位宽与基准随版本变化（5.1~5.3 为当前指令索引 + 1 + sBx）；对策——按版本确认位宽与基准，换算后核对目标是否落在代码段内

## 图形与 Shader

图形侧逆向的目标通常是: 改可视效果（颜色/参数/剔除）、定位资源绑定与常量更新点、还原渲染管线逻辑。入口分文件侧（shader 资源）与内存侧（运行时加载点）。

### SPIR-V 反汇编（spirv-dis 类思路）

- 魔数 0x07230203（文件字节序 03 02 23 07），word 流结构: 头部（魔数/版本/生成器/bound/schema）+ 指令序列（每条: word 数 + opcode + 操作数）
- 反汇编思路: 按 word 边界切分指令流，还原 OpFunction/OpEntryPoint/OpConstant/OpType*/OpDecorate 等语义
- 定位要点: OpEntryPoint 定入口（stage 类型 + 入口函数）、OpDecorate 的 DescriptorSet/Binding/Location 定资源绑定与顶点属性、OpConstant 定常量初值（可直接改）
- 泛化: 二进制 IR 解析套路（魔数 → 结构头 → 指令流 → 语义表）在多种 GPU IR 间通用，换格式只换魔数与指令表

### DXIL / DXBC 反汇编（dxc 类思路）

- DXBC: DX10/11 容器格式（"DXBC" 魔数 + chunk 表），着色器代码在 SHDR/SHEX chunk，输入/输出签名与资源反射在 ISGN/OSGN/RDEF 等 chunk
- DXIL: DX12 SM6+ 字节码，外层仍是 DXBC 容器，内层 "DXIL" 子对象为 LLVM bitcode 风格——解析路径与 DXBC 完全不同
- 反汇编思路: 先判容器/子对象类型（DXBC chunk vs DXIL），再按对应格式走；关注 SM 版本（决定指令集）与 cbuffer 反射（名称/成员偏移）
- 内存侧: 扫描 "DXBC"/"DXIL" 魔数定位已编译着色器（[[re-memdump]]），或 hook 创建类 API 截获字节

### GLSL 还原（spirv-cross 类思路，泛化）

- 还原路径: IR → 目标语言（GLSL/HLSL/MSL），思路为类型重建（OpType* → 语言类型）→ 语义还原（OpDecorate → layout/限定词）→ 表达式重建
- 还原是有损的: 循环/switch/优化后的结构重建不完整，还原结果用于阅读分析，不一定能原样重编译
- 泛化: IR→源码还原器按「类型 → 声明 → 函数体」三遍组织，换目标语言只换语法发射层

### 找渲染入口与常量表定位

- 文件侧: shader 资源（.spv/.dxbc/.hlsl/.cso 或包内资源）先解包（[[re-fw-extract]]）再按格式反汇编；在二进制里按加载 API 字符串引用定位加载点（glShaderSource/glCompileShader、CreateVertexShader/CreatePixelShader/CreateComputeShader、vkCreateShaderModule 类）
- 内存侧: hook 加载类 API 截获原始字节（源码或已编译字节码），或扫描魔数 dump（[[re-memdump]]）
- 常量表定位: CPU 侧更新点——glUniform* 系列（单值 uniform 按 location 索引）、VSSetConstantBuffers/UpdateSubresource 类、Vulkan 的 vkCmdPushConstants/descriptor 更新类；GPU 侧布局——cbuffer 按结构体成员偏移 + 16 字节对齐打包（float4 数组间有 padding），单值 uniform 无此规则
- 改参入口: 常量更新点运行时改值、字节码内常量初值静态 patch、或改常量表数据

### 常见坑

- **DXIL vs DXBC 判断错（SM6 vs SM5 路径不同）**：现象——按 DXBC 的 SHDR/SHEX 解析失败，或按 DXIL 路径反汇编乱码；原因——SM5.x 及以下是 DXBC 字节码，SM6+ 是 DXIL（LLVM bitcode 风格），解析路径完全不同，且 DXIL 外层容器同样是 "DXBC" 魔数，只看容器名会误判；对策——先确认 SM 版本（反射/RDEF 或编译配置），SM6+ 在容器内找 "DXIL" 子对象走 DXIL 路径，SM5- 走 DXBC chunk 路径，两条路径互不通用
- **SPIR-V 无函数名（按入口点/资源绑定定位）**：现象——反汇编结果全是 OpFunction/OpLabel 编号，找不到目标逻辑；原因——发布版通常剥离 OpName/OpMemberName 调试信息；对策——按 OpEntryPoint 定入口（stage 类型 + 函数引用），按 OpDecorate 的 Binding/Set/Location 定资源，按 OpConstant 已知值特征（矩阵初值/阈值常量）定位目标片段
- **着色器常量表 vs 统一缓冲区混淆**：现象——CPU 侧找到的 uniform 更新点和 GPU 侧反汇编的常量布局对不上；原因——同段逻辑可能走两套路径: 单值 uniform（按 location 序号直传）与统一/常量缓冲区（结构体成员偏移 + 16 字节对齐打包，含 padding）；对策——先由反汇编/反射确认路径（SPIR-V 看 OpDecorate Uniform/Block，DXBC 看 RDEF 的 cbuffer 成员表），单值按 location 号、cbuffer 按成员偏移换算，两套打包规则不混用

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
