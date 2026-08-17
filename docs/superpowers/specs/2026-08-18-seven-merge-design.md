# 7 处融入设计（2026-08-18）

## 背景

rev-skills（97 技能）扩展方向调研的第二批：7 处「应用场景/方法论延伸」融入现有技能（不新增技能、不改计数）。

设计约束（沿用全库红线与原则）：
- **红线 1 呈现中性**：禁用「最推荐」「强烈建议」等最高级强推措辞
- **红线 2 隐私脱敏**：内容不指向具体项目/公司/产品
- **不绑定具体工具**：方法为核心，工具为可替换示例
- 工作区有 3 个未提交文件（re-binary-core / re-mobile / re-protocol 的 SKILL.md）——本计划 7 个融入目标技能均为干净文件，不涉及
- 计数不变：97 = 1 入口 + 12 网关 + 84 原子

## 变更总览

| # | 融入目标 | 新增章节 | 内容 |
|---|---|---|---|
| 1 | re-blockchain | ## 非 EVM 链（Solana / Move） | Solana BPF 字节码、Sui/Aptos Move、DeFi/NFT 场景 |
| 2 | re-automotive | ## IVI / T-Box / V2X 路径 | 路径分流（IVI→系统分析、T-Box→模组、V2X→协议） |
| 3 | re-script-deob | ## 高级混淆对抗（商业混淆器） | JScrambler 类：CFF/字符串加密/死代码注入对抗 |
| 4 | re-forensics | ## 容器镜像取证 | 镜像层提取与文件系统分析 |
| 5 | re-exploit | ## 内核利用 | 提权原语、堆喷、内核 UAF 路径 |
| 6 | re-tracing | ## 指令级追踪 | QEMU 插件、Intel PT、trace 分析 |
| 7 | re-disk-forensics | ## 数据库文件格式 | SQLite 页结构、WAL、删除恢复 |

## ① re-blockchain：非 EVM 链（Solana / Move）

「## 跨域联合」前插入：

- **Solana**：BPF 字节码（eBPF 类指令集）——识别特征（ELF + .text 段 BPF 指令）、反编译路径（llvm-objdump BPF 反汇编 / 专用反编译器）、程序账户与指令调度（CPI 调用链）
- **Sui / Aptos（Move）**：Move 字节码（模块/资源/函数表）——反编译（move disassembler）、资源模型（对象/能力）对漏洞面的影响（转账/所有权逻辑）
- **DeFi/NFT 场景**：池子合约（AMM 常量积公式）、代币标准（ERC-20 变体/SPL）、授权与提现逻辑定位
- 流程与 EVM 同构（字节码反编译 → 漏洞分析），指令集与资源模型不同——识别运行时后按对应路径走

## ② re-automotive：IVI / T-Box / V2X 路径

「## 跨域联合」前插入：

- **IVI（车载娱乐系统）**：本质是 Android/Linux 系统——走 [[re-apk]]（Android 应用）/ [[re-firmware]]（系统镜像）路径；关注 OEM 定制层（启动器/诊断接口）
- **T-Box（远程信息处理箱）**：蜂窝模组（AT 指令接口）、MCU 固件（[[re-fw-extract]]）、远程控制协议（车控指令）
- **V2X（车联网通信）**：DSRC / C-V2X 帧结构 → [[re-protocol]] / [[re-ics]] 路径（协议状态机重建）
- 判定规则：按目标形态分流（应用层→移动/系统路径；通信层→协议路径；固件层→固件路径）

## ③ re-script-deob：高级混淆对抗（商业混淆器）

「## 跨域联合」前插入：

- **特征识别**：JScrambler 类商业混淆器特征（bootstrap 加载器、字符串表隐藏、`_0x` 变量重命名模式）
- **控制流平坦化（CFF）对抗**：dispatcher 识别（switch 分发中心）→ 状态变量追踪 → 分支还原（与 [[re-deobfuscate]] 的方法衔接）
- **字符串加密对抗**：隐藏字符串表定位（解码函数调用点）→ 运行时提取（动态执行取值或静态还原）
- **死代码注入对抗**：无引用函数过滤（同 ctf-malware 配方：按调用关系过滤）
- 工具链：js-beautify 美化 → 手动还原或半自动脚本；动态侧（[[re-sandbox]] 内执行解码函数）

## ④ re-forensics：容器镜像取证

「## 跨域联合」前插入：

- **镜像结构**：tar 归档 + 分层（每层 = 文件系统快照差异）
- **层提取**：`docker save` / `skopeo copy` 导出 → 解包层（复用 [[re-disk-forensics]] / [[re-fw-rootfs]] 的文件系统分析）
- **分析重点**：配置与密钥（环境变量/挂载点/entrypoint 脚本）、历史层残留（删除文件在旧层仍可恢复）、恶意镜像判定（启动命令/网络行为）
- 输出：镜像内容清单 + 可疑项（与 [[re-ioc]] 衔接）

## ⑤ re-exploit：内核利用

「## 跨域联合」前插入：

- **提权原语**：modprobe_path 覆写、cred 结构覆写、io_uring/BPF 子系统利用面
- **堆喷与对象布局**：堆喷策略、对象重叠（UAF 后伪造对象）、SLUB 分配器行为
- **内核 UAF 利用路径**：漏洞触发 → 对象重用 → 控制流劫持（函数指针/ops 表）
- 与用户态同框架：fuzz（[[re-fuzzing]]）→ crash（[[re-crash-triage]]）→ 利用（本技能内核路径）
- 环境：调试内核（KASAN/KASLR 关闭或绕过）、gdb/kgdb

## ⑥ re-tracing：指令级追踪

「## 跨域联合」前插入：

- **QEMU 插件**：`-plugin` 指令级 trace（insn 粒度、call/ret 路径）、插桩事件（guest 代码块）
- **Intel PT**：硬件 trace（`perf record -e intel_pt`）→ 解码（perf script / 第三方解析）、分支流还原
- **trace 分析**：热点（执行频次）、路径还原（调用链）、与反混淆衔接（跟踪真实执行路径绕过静态混淆）
- 输出：指令级执行流（供 [[analysis-contract]] 证据存档）

## ⑦ re-disk-forensics：数据库文件格式

「## 跨域联合」前插入：

- **SQLite 结构**：页头（page header）、btree 页（interior/leaf）、记录格式（varint/类型码）、溢出页
- **WAL 恢复**：WAL 文件解析（未提交事务的帧）、checkpoint 边界
- **取证应用**：浏览器/App 数据库（删除记录恢复——freelist 页）、未提交事务提取
- 工具：sqlite3 CLI（只读模式 `-readonly`）、页级解析脚本

## 校验与测试

- 每处融入后 `npm test` 全绿（97 skills 不变）
- 融入章节的 [[链接]] 全部指向已存在技能（re-apk/re-firmware/re-protocol/re-ics/re-fw-extract/re-disk-forensics/re-fw-rootfs/re-ioc/re-deobfuscate/re-sandbox/re-fuzzing/re-crash-triage/analysis-contract 等）
- 不触碰工作区 3 个未提交文件
