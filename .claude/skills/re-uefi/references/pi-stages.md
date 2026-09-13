# PI 阶段模型：SEC / PEI / DXE / BDS / Runtime / SMM

<CORE RULE>
**看到 PE32/PE32+ 就按普通 Windows PE 应用分析，是本域首要要排除的判断错误。**

第一步永远是**判阶段与模块类型**：

```
SEC → PEI → DXE → BDS → OS / Runtime
```

同一份固件里，不同阶段的模块运行在**完全不同的执行环境**里：可用内存不同、可调用的服务不同、生命周期不同。**模块类型判错，后面所有"它为什么这么写"的推理都会错。**
</CORE RULE>

## 一、先分类（决定后面全部）

| 类型 | 阶段 | 说明 |
|---|---|---|
| SEC | 最早 | 安全/初始化入口，尚无通用内存环境 |
| PEIM | PEI | 早期初始化，服务形式是 **PPI** |
| DXE driver | DXE | 服务形式是 **Protocol**；仅存在于 boot services 环境 |
| **DXE runtime driver** | DXE + Runtime | **跨生命周期**：`ExitBootServices()` 之后仍然存在 |
| UEFI driver / UEFI application | DXE/BDS 之后 | 更接近"跑在 UEFI 环境里的应用"，与固件内建模块不是一回事 |
| SMM/MM driver | 独立 | SMM 内执行，特权层级与生命周期自成一套 |

**判据优先级**：INF 的 `MODULE_TYPE`（若能拿到）> 节/文件类型 > 导入的服务（PPI vs Protocol vs Runtime Services）> 行为。

## 二、PEI 的特殊性：可能还没有"普通内存"

- PEI 早期**可能尚无普通 DRAM**；PEI 的主要任务之一就是**建立永久内存**，并把信息以 **HOB** 的形式交给 DXE
- PEI 用的是 **PPI**，不是 Protocol——**在 PEI 模块里找不到 `LocateProtocol` 是正常的**，要找的是 PPI 的安装/定位
- 严格说 DXE 阶段并不依赖 PEI 存在：**DXE 能执行的最低要求是"有一份合法的 HOB list"**

## 三、HOB：跨阶段数据，"没有 producer 的输入"多半就是它

**遇到"函数读一串没有普通 producer 交叉引用的结构"——先考虑 HOB list。**

- HOB list 是 PEI 交给 DXE 的交接状态：由 **PHIT HOB**（首个、必需）开头、以 End of HOB List 结尾的连续表
- 表单里通常包含：内存资源描述（DXE 拿它当物理内存用）、固件卷（FV）HOB、内存分配模块 HOB、BSP 栈 HOB 等
- **单向交接**：只有 PEI 阶段能添加/修改 HOB；**交给 DXE 后整张表是只读的**
- 因此 **DXE 侧构造 HOB 的调用（`Build*Hob` 一族）会断言失败**——在 DXE 代码里看到这些调用点，说明要么这是 PEI 代码被误判，要么是残留/调试代码
- HOB 的自洽约束也很有辨识度：长度按 8 字节对齐、不得内含指向 HOB 表内其他数据的指针（必须可整体复制而不需调整内部指针）、**只追加不删除**
- DXE 想表达"要进恢复模式"这类状态变化时**不能改 HOB**，只能走复位调用——所以"HOB 里的 Boot Mode 与当前行为不一致"通常不是被篡改

## 四、GUID 不是普通 UUID 元数据：要做 GUID 字典解析

同一串 GUID 在 UEFI 里可能是完全不同的东西：

```
Protocol / PPI / Firmware File / HOB / Variable namespace / Configuration table
```

**RE 系统应当把 GUID 解析成符号**（等价于符号恢复）：

```
LocateProtocol(&some_guid)
  → 恢复成 LocateProtocol(EFI_XXX_PROTOCOL_GUID)
  → interface vtable
  → method calls
```

- **协议图往往比普通调用图更有意义**：模块之间通过 Protocol 解耦，调用关系藏在"谁安装、谁定位"里，不在直接 call 里
- 变量命名空间同理：只看到 `GetVariable`/`SetVariable` 而不知道 GUID，等于没看懂它读的是什么

## 五、固件 dump 不能只 carve PE magic

规范本身定义了层次：

```
Firmware Volume → FFS file → section → PE32/TE image
```

- "固件里有很多 PE"是因为有成百上千模块；但**按 PE 魔数直接 carve 会丢掉归属**（属于哪个 FV、哪个 FFS 文件、什么节类型）
- 判归属要走 FV/FFS/section 层次（工具见 [[re-uefi]] 主文档步骤 1–2）；**嵌套 FV 与压缩节是常态**，只展开外层会缺件

## 六、生命周期：`DXE_DRIVER` 与 `DXE_RUNTIME_DRIVER` 不是一回事

- **`DXE_DRIVER`**：只存在于 boot services 环境，`ExitBootServices()` 时被销毁
- **`DXE_RUNTIME_DRIVER`**：**同时**运行在 boot services 与 runtime services 环境，其服务在 `ExitBootServices()` 之后、OS 运行时仍然可用；`SetVirtualAddressMap()` 被调用时，**这类模块会按 OS 给出的虚拟地址映射被重定位**
- `ExitBootServices()` 之后：**Boot Services、DXE Services、以及 boot service driver 提供的服务全部不可再用**——DXE Foundation 本身属于 boot services，所以**不能有 DXE Foundation 的代码残留到 runtime**
- `SetVirtualAddressMap()` 相关的两个动作要认得出：
  - 驱动在入口注册 `EVT_SIGNAL_VIRTUAL_ADDRESS_CHANGE` 事件（例如 `CreateEventEx` 配 `gEfiEventVirtualAddressChangeGuid`）
  - 通知函数里用 **`ConvertPointer()`** 把自管数据结构里的指针从物理地址改成虚拟地址
- **虚拟地址变更通知函数不得调用任何 Boot Services / Console Services / Protocol Services**（直接间接都不行）——因为这些服务此时已经不可用。**在通知函数里看到"没调用什么"往往是设计约束，不是代码被裁剪**
- `EFI_RUNTIME_ARCH_PROTOCOL` 自带两个可用作判据的状态：**`VirtualMode`**（`SetVirtualAddressMap()` 是否已调用）与 **`AtRuntime`**（`ExitBootServices()` 是否已调用）——现场判断"现在处于哪个生命周期"的现成依据

**关键推论**：**固件地址 ≠ OS runtime 地址**。同一份 runtime 代码在两个阶段地址不同，**不一定是 hook、也不一定是重定位出错**。要判断篡改，必须先说明"你比对的是哪一个阶段的映射"。

## 决策树

```
拿到一个 .efi / 固件模块
├─ 判阶段与模块类型（SEC / PEIM / DXE / DXE runtime / UEFI app / SMM）
│    ├─ 只有 PPI 语义 → PEI
│    ├─ 用 Protocol → DXE 环境
│    └─ 有 runtime 服务 / 注册了虚拟地址变更事件 → DXE_RUNTIME_DRIVER
├─ 输入没有 producer 交叉引用
│    └─ 先当 HOB list（PEI→DXE 单向、DXE 只读）；在 DXE 里找不到构造点属正常
├─ 一串 GUID 看不懂
│    └─ 做 GUID 字典解析：区分 Protocol/PPI/FFS/HOB/变量命名空间/配置表
│         → 由"谁安装、谁定位"恢复协议图，而不是追直接 call
├─ 文件归属不清
│    └─ 按 FV → FFS → section 层次定位（嵌套与压缩是常态），不要按 PE 魔数直接 carve
└─ 地址/行为对不上
     ├─ 比对的是哪一个阶段的地址映射？（固件地址 vs OS runtime 地址）
     ├─ runtime 代码是否经历过 SetVirtualAddressMap + ConvertPointer
     └─ 现在 AtRuntime / VirtualMode 是什么状态
```

## 工具与验证

- 阶段/类型：优先读模块自身的类型信息（INF 的 `MODULE_TYPE`、节类型、导入服务种类）；拿不到就用"它调的服务属于哪一层"反推
- HOB：从 PHIT HOB 起逐项解析 HOB list，建立"哪个阶段生产、谁消费"的对应
- GUID：建 GUID→符号字典（协议名、PPI 名、FFS 文件、变量命名空间），把 `LocateProtocol` 一类调用还原成语义名
- 归属：FV → FFS → section 层次复原，别脱离层次谈某个 PE
- 验证：能同时说清「阶段 + 模块类型（是否 runtime）+ 依赖的服务层级（PPI/Protocol/Runtime）+ 地址映射处于哪个阶段」

## 该平台的坑（汇总）

- **看到 PE32/PE32+ 就当普通 Windows PE 应用**：先判阶段与模块类型，执行环境完全不同
- **在 PEI 模块里找 `LocateProtocol`**：PEI 的服务形式是 PPI
- **把 HOB 当"普通的全局数据"**：它是 PEI→DXE 的单向交接，DXE 侧只读；在 DXE 里找构造点会一无所获，构造调用还会断言
- **以为 HOB 可以被 DXE 修改**：状态变化只能走复位调用，不能改 HOB
- **把 GUID 当无语义的 UUID**：它可能是 Protocol/PPI/FFS/HOB/变量命名空间/配置表中的任意一种，必须解析成符号
- **只看直接调用图，忽略协议图**：模块间的真正耦合在"谁安装、谁定位哪个 Protocol"
- **按 PE 魔数直接 carve 固件**：丢掉 FV/FFS/section 层次归属，也漏掉嵌套与压缩
- **不区分 `DXE_DRIVER` 与 `DXE_RUNTIME_DRIVER`**：前者在 `ExitBootServices()` 后不复存在，后者跨生命周期并被 `SetVirtualAddressMap()` 重定位
- **把 runtime 通知函数里"没调用任何服务"当异常**：那是硬性约束（此时服务已不可用），不是代码问题
- **拿固件地址与 OS runtime 地址直接比对判 hook**：先确认是哪个阶段的映射，以及是否经过 `ConvertPointer`
