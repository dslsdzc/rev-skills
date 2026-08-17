---
name: re-blockchain
description: >
  EVM 智能合约逆向：字节码反编译、漏洞分析。
  触发词：智能合约、EVM、Solidity、字节码、合约漏洞、ABI、Solana、Move、BPF
---

# EVM 智能合约逆向（cast / panoramix / web3.py）

## 何时使用 / 何时不用

- 用：拿到合约字节码（链上地址或 .bin/.hex 文件）要还原逻辑——ABI 恢复、反编译、存储布局重建
- 用：合约漏洞分析（重入/整数溢出/权限）或漏洞利用前的审计定位
- 用：恶意合约/代币诈骗合约取证（链上数据获取、只读拉取）
- 不用：Solidity 源码可得且未混淆——直接读源码更准（审计思路同 [[re-vuln]]），本技能面向无源码/仅字节码
- 不用：本节未覆盖的非 EVM 链（如 WASM 系链，指令集不同）；WASM 走 [[re-wasm]]
- 注意：链上交互以只读为主（`cast call`/`cast code`/`cast storage`）；任何写链/部署/动态验证默认本地 anvil 或隔离网络（[[platform-tips]] 沙箱最高原则）；合约分析基本静态，按「静态优先」执行

## 工具准备

### python3 —— 脚本化分析基础

- Linux: `apt install python3` / `dnf install python3` / `pacman -S python`
- macOS: `brew install python3`；Windows: `choco install python`
- 验证: `python3 --version`（本技能脚本均为 Python 3）

### cast（foundry）—— 链上交互/字节码/存储主力

- 官方安装器（全平台，装到 `~/.foundry/bin`，含 forge/cast/anvil/chisel）: `curl -L https://foundry.paradigm.xyz | bash && foundryup`
- macOS: `brew install foundry`（官方 Homebrew formula，含四件套）
- Arch: 官方仓库**无** foundry——用 AUR `foundry-bin`（`yay -S foundry-bin` 等）；**注意 `pacman -S foundry` 是无关的 GNOME Builder 工具包，别装错**；Debian/Ubuntu/Fedora 无官方包——用官方安装器
- 验证: `cast --version && anvil --version`

### web3.py（pip，Python 3.8+）—— 脚本化链上分析

- `pip install web3`（官方 PyPI，web3 7.x 要求 Python ≥3.8，PyPI 声明 `<4` 无 3.12 上限）
- 验证: `python3 -c "import web3; print(web3.__version__)"`

### panoramix（pip，Python 3.9–3.11）—— EVM 反编译器（disasm→流程）

- `pip install panoramix-decompiler`（官方 PyPI 0.6.x，要求 Python 3.9–3.11）；维护更活跃的 fork 为 `panoramix-decompiler-abi`，两者都提供 `panoramix` 命令
- 验证: `panoramix --help`（或 `python3 -m panoramix --help`）
- 用法: 直接传原始字节码 `panoramix <hex> --abi` 反编译；传合约地址则需 `WEB3_PROVIDER_URI` 环境变量（从链上拉字节码）；输出伪码 `.pan`/反汇编 `.asm` 写到 cache 目录

### pyevmasm（pip，Python 3）—— EVM 反汇编

- `pip install pyevmasm`（官方 PyPI）；验证: `pyevmasm -d 0x6001600101` 输出指令行
- 备选: `cast disassemble <hex>`（foundry 自带，同一用途）

### hevm / echidna（可选，形式化/模糊验证）

- echidna: GitHub releases 预编译二进制（crytic/echidna）或 `cargo install --locked echidna`（官方仓库无发行版包；Arch 有 AUR 包）；验证: `echidna --version`
- hevm: GitHub releases（ethereum/hevm）或 cargo 构建；验证: `hevm --version`
- 均为可选——先跑完步骤 1-5 的静态分析，需要行为验证再上

### solc / solc-select（可选）—— 存储布局对照

- `pip install solc-select`（Python 3）+ `solc-select install 0.8.28`（官方 PyPI/编译产物下载）；或 solc-bin 官方二进制（Linux x86 静态包）
- 验证: `solc --version`
- 无源码合约不需要；用于"拿到同源码编译产物"时对照权威 storage layout（坑 2）

## 操作步骤

按顺序执行，每步产物（字节码/选择器表/伪码/asm）存档 sha256 + 路径（[[re-ioc]] 证据链）。

1. **合约字节码获取（链上/文件）**：
   ```sh
   # 链上（RPC 节点；公开 RPC 或自有节点）
   cast code 0xDEAD... --rpc-url https://eth.llamarpc.com > code.hex
   # 文件（.bin/.hex 文本或二进制）
   xxd -r -p code.hex > code.bin && file code.bin && xxd code.bin | head -2
   sha256sum code.bin > code.sha256
   ```
   - 区分 **creation code**（含 initcode + runtime，前面是部署逻辑）与 **runtime code**（纯业务逻辑，首指令常 `0x6080...` PUSH1 0x80 分配内存）——Etherscan 的 Bytecode 页是 creation、Deployed Bytecode 页是 runtime；分析业务逻辑用 runtime
   - 链上数据获取纪律：`cast call`/`cast code`/`cast storage` 只读安全；写链/交易类操作默认本地 `anvil` 起测试链

2. **ABI 恢复（函数选择器/签名）**：
   ```sh
   # 从字节码提取 PUSH4 选择器常量（4 字节 = keccak256(signature)[:4]）
   cast disassemble "$(cat code.hex)" | grep -E 'PUSH4' | awk '{print $NF}' | sort -u > selectors.txt
   # 对照签名库（4byte.directory / etherface 在线服务）
   while read s; do echo -n "$s "; cast 4byte "$s"; done < selectors.txt
   # 已知签名本地计算（签名必须规范化，见坑 1）
   cast sig "transfer(address,uint256)"
   cast sig "balanceOf(address)"
   ```
   - 事件 topic 同理：日志 topic0（前 32 字节）= keccak256(事件签名)，对 etherface/4byte 查询
   - 候选签名多时用参数长度（CALLDATASIZE 比较）、回退逻辑、存储访问模式消歧（坑 1）

3. **反编译（panoramix 思路：disasm→流程）**：
   ```sh
   panoramix "$(cat code.hex)" --abi > contract.pan    # 伪码（可读性优先）
   cast disassemble "$(cat code.hex)" > contract.asm   # 精确指令流（交叉验证真值）
   # 按地址反编译（需节点）: WEB3_PROVIDER_URI=<rpc> panoramix 0xDEAD...
   ```
   - 工作流：disasm（指令级真值）→ 函数边界定位（分派表：`PUSH4 sel EQ PUSH2 off JUMPI` 模式，位于字节码开头 ~0x00-0x1f 区域）→ 伪码粗读 → 关键函数回 asm 精读
   - 输出粗糙是常态（坑 4），一切反编译结论以 asm 交叉验证

4. **逻辑还原（存储布局/状态变量）**：
   ```sh
   # 链上存储读取（状态变量从 slot 0 起、每槽 32 字节）
   cast storage 0xDEAD... 0 --rpc-url <rpc>
   cast storage 0xDEAD... 1 --rpc-url <rpc>
   # 动态数组/映射槽位 = keccak256 派生（见坑 2 公式）
   cast call 0xDEAD... "owner()(address)" --rpc-url <rpc>   # 公开变量 getter
   # 无源码：从反编译的 SSTORE/SLOAD 常量与 getter 推断语义
   grep -E 'SSTORE|SLOAD' contract.asm | head
   ```
   - 布局规则：继承按 C3 线性化合并不变式、每变量 32 字节（`bool/uint8/address` 等可同槽打包）、动态数组 `slot = keccak256(slot_index)`、mapping `slot = keccak256(key ++ slot_index)`；有源码时 `solc --storage-layout` 出权威 JSON 对照
   - 与 ABI getter 交叉验证：公开状态变量自动生成 getter，`cast call` 结果反推变量类型与槽位

5. **漏洞分析（重入/整数溢出/权限）**：
   ```sh
   grep -cE 'CALL|DELEGATECALL|CALLCODE' contract.asm     # 外部调用面（重入/交互边界）
   grep -E 'ADD|MUL|SUB' contract.asm | head               # 算术运算（<0.8 无内置溢出检查）
   grep -E 'CALLER' contract.asm | head                    # 调用者检查（onlyOwner 权限）
   ```
   - 重入：外部调用（CALL 到用户可控地址）之后才改状态（SSTORE 顺序在 CALL 之后）——检查 effects 是否在 interactions 之前
   - 溢出：Solidity <0.8 无内置检查——看 ADD/MUL 后是否有溢出分支；0.8+ 找 `unchecked` 块
   - 权限：CALLER 与 owner 槽比较模式；owner 槽可写/无检查即任意调用（只有构造函数初始化 owner 是常见权缺失）
   - 可选行为验证：echidna 属性测试（不变量/重入/溢出模式）、hevm 符号执行、`anvil` 本地复现攻击序列
   - 结论纪律：漏洞判定需"路径可达"证据（调用链 + 状态条件），仅指令模式是弱信号（坑 4）

## 非 EVM 链（Solana / Move）

流程与 EVM 同构（字节码反编译 → 漏洞分析），指令集与资源模型不同——先识别运行时，再按对应路径走。

- **Solana（BPF 字节码）**：识别特征——ELF 文件 + .text 段为 BPF 指令（eBPF 类指令集）；反编译路径——`llvm-objdump -d`（BPF 反汇编）或专用反编译器；分析重点——程序账户与指令调度（CPI 跨程序调用链）、账户数据布局（结构体偏移）
- **Sui / Aptos（Move 字节码）**：识别特征——模块/资源/函数表结构；反编译——move disassembler（`move disassemble`）；分析重点——资源模型（对象/能力）对漏洞面的影响（转账/所有权逻辑）、模块依赖图
- **DeFi/NFT 场景**：池子合约（AMM 常量积公式）、代币标准变体（SPL 等）、授权与提现逻辑定位
- 漏洞分析承接：逻辑漏洞（重入/权限）沿用 EVM 思路，资源/账户模型差异处单独判断

## 跨域联合

- [[re-managed]]：本网关「识别运行时」识别到 EVM 字节码（.bin/hex）后固定调用本技能（合约字节码是"托管字节码"分支）
- [[re-vuln]]：合约漏洞与漏洞挖掘网关衔接——echidna 的覆盖引导/语料思路同 [[re-fuzzing]]，断言崩溃分析思路同 [[re-crash-triage]]；漏洞报告结构一致（入口/条件/影响/修复）
- 链上数据获取：cast/web3.py 经 RPC 只读（公开 RPC、自有节点、Etherscan API）；写链与动态验证默认本地 anvil（隔离网络）
- [[re-wasm]]：非 EVM 的 Wasm 合约/链上 Wasm 模块（同域不同指令集）
- 引用 [[platform-tips]] 静态优先（大型样本）与沙箱隔离分支（写链/动态验证隔离）

## 常见坑与陷阱

- **选择器碰撞**：现象——`cast 4byte` 返回多个候选签名，或按猜的签名 `cast call` 解析失败/结果错位；原因——选择器是 keccak256(signature) 前 4 字节，碰撞存在（恶意变体/已知碰撞案例），且大量签名未入库；对策——`cast sig` 只对规范化签名成立（参数间无空格、`uint256` 不写 `uint`、地址小写完整），候选签名用 CALLDATASIZE 比较（参数长度分派）、回退逻辑（fallback 处理）、存储访问模式消歧；最终以完整签名 keccak256 比对确认
- **存储布局 vs 源码映射难**：现象——无源码合约按"声明顺序=槽位顺序"推断出错，读出的值类型对不上/混槽；原因——布局受编译器版本、优化开关、继承顺序（C3）、结构体/数组打包规则影响，无源码时没有权威映射；对策——有源码: `solc --storage-layout` 出 JSON 对照（编译器版本要一致）；无源码: 从反编译的 SSTORE 常量 + getter 行为 + 值大小推断类型，标注置信度不硬猜；动态数组/mapping 槽位按 keccak256 公式算（步骤 4），别线性加一
- **代理合约（delegatecall 逻辑在别处）**：现象——主合约反编译只有 fallback + delegatecall 转发，找不到任何业务逻辑；原因——升级代理模式（EIP-1967 等）把逻辑放实现合约：主合约只存实现地址并 delegatecall，状态变量布局在主合约、代码在实现合约（布局冲突本身是经典漏洞）；对策——先查 EIP-1967 实现槽: `cast storage <addr> 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc --rpc-url <rpc>`（管理员槽 `0xb53127684a568b3173ae13bae8d486943e0793e1d5dccd29778a66c42e1c39d`），非标准代理从反编译定位 SLOAD 常量槽位读实现地址；再 `cast code <实现地址>` 分析实现；实现地址可变=可升级，结论标注读取时点
- **反编译工具输出粗糙需手工**：现象——panoramix 伪码缺变量名/类型/存储语义，函数边界错位，误以为合约逻辑混乱或遗漏关键分支；原因——EVM 无类型无符号表，符号执行/启发式反编译丢信息，现代 Solidity 优化产物（ABIEncoderV2、优化器）结构复杂；对策——伪码只当"粗读地图"，关键函数回 `cast disassemble` 指令级精读（分派表定位 → 逐指令语义 → 存储/调用模式）；多工具交叉（panoramix + cast disasm + echidna 行为验证）；结论标注置信度与验证方式
