# TEE/TrustZone 逆向方法论坑与边界

## 镜像与格式组（最容易踩）

- **签名头不是 ELF 头**：.ta 文件头是 `struct shdr`（magic "OTSH"、img_type、img_size、algo、hash_size、sig_size + hash + sig），ELF 头在载荷内——直接按 ELF 解析必然失败；先按 magic 定位、按 img_size 切载荷
- **img_type 变体各不相同**：0 明文签名 TA / 1 bootstrap TA（子头含 UUID + ta_version）/ 2 加密 TA / 3 子密钥链式头——统一按「签名头 + 子头 + 载荷」分段解析，别假设只有一种形态
- **加密 TA 是 AES-GCM 密文**：img_type=2 时载荷为密文，`shdr_encrypted_ta` 子头带 enc_algo/iv/tag——先还原解密流程（[[re-crypto-decrypt]]）再分析；解密密钥与信任根在 core 侧，解密逻辑本身是取证对象
- **ta_head 在 ELF 内首段**：UUID/版本/flags 在载荷 ELF 的 ta_head 结构里，不是文件头字段——切出 ELF 后用 [[re-format-elf]] 找首段标注
- **bootstrap TA 与普通 TA 入口不同**：bootstrap TA 走 `TA_Boot` 入口而非标准 EntryPoint 链——按 img_type 选分析模板

## 调用约定组（SMC/ABI 边界）

- **SMC 不是普通函数调用**：SMCCC 约定功能号在 w0（含 OEN 与 SMC32/SMC64 标识），参数在 w1-w7（SMC32）或 x1-x17（SMC64），返回值从 w0 起——按普通 ABI 读寄存器会整条数据流错位
- **SMC32 vs SMC64 寄存器宽度不同**：同功能号在两种约定下参数位次/宽度不同——先看功能号第 30 位（SMC64 标识）再选解析方式
- **HVC 与 SMC 通道别混**：EL2 hypervisor 用 `hvc` 指令、EL3 用 `smc`——反编译先分清通道再标注调用点，混标会把 hypervisor 调用误归 TEE
- **32/64 位 TA 混合**：AArch32 TA 与 AArch64 TA 的调用约定（TEE_Param 布局）有差异——按 ELF 架构选解析模板

## 主机侧组

- **/dev/teepriv0 不是「私密会话」通道**：teepriv0 归 tee-supplicant（特权守护进程）使用，客户端调用走 /dev/tee0——把 teepriv0 当客户端入口会找不到调用面
- **ioctl 参数在结构体里**：`TEE_IOC_*` 的 UUID/命令号/参数布局在 `struct tee_ioctl_*` 请求结构里，不是裸 ioctl 参数——hook 时解析请求结构体
- **共享内存注册是单独流程**：invoke 前常需 `TEE_IOC_SHM_REGISTER` 注册共享内存——hook 调用序列时把 shm 注册与 invoke 配对，才能还原缓冲区内容
- **tee-supplicant 处理存储 RPC**：secure storage 落盘由 tee-supplicant 在 REE 侧执行（默认路径如 /data/tee 类目录）——找密文文件往 tee-supplicant 的行为看，别在 TA 里找文件操作
- **client 库版本差异**：libteec 与较新的 libckteec 接口有差异（PKCS#11 方向）——按目标实际使用的库选 API 模板

## 反例与边界组

- **自定义 TEE 套 OP-TEE 细节**：镜像头/SMC 功能号/存储布局各异——先指纹（镜像头特征/字符串/SMC 模式）确认体系再套模板，OP-TEE 仅作参考
- **secure world 拿不到别硬挖**：SoC 内部 ROM/受保护存储的场景，主机侧调用面 + 行为反推是唯一路径——结论降级标注「推测」，不把反推当确认
- **设备密钥不可提取**：SE/secure world 内私钥提取通常不可能——记录用途与保护机制（授权研究），不硬挖（红线）
- **「TEE 存在」≠「数据在 TEE 内」**：很多实现只把密钥放 TEE，业务数据明文在普通世界——先确认数据边界再定分析目标
- **行为差异不强行归因**：secure world 有防 dump/完整性监测（泛化）——行为不符静态时记录为「TEE 侧监测触发」证据，标注置信度

## 使用注意

- 主机侧动态在沙箱内（[[re-sandbox]]，[[platform-tips]] 最高原则）；secure world 内不做动态调试
- 结论按 [[decision-tree]] 证据分级标注；设备密钥类结论区分「提取成功/不可提取+用途/推测」三档
