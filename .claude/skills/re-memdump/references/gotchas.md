# 内存转储与提取工具特有坑与边界

## /proc/<pid>/mem 直读坑组

- **偏移是虚拟地址不是文件偏移**：直接 `open('/proc/<pid>/mem').read()` 从 0 读必报错（偏移非法）——必须按 maps 定址 + SIGSTOP + chunked pread（SKILL.md 坑 3）
- **越界读返回 EIO**：读到的地址不在进程映射内（或只读段写）报 `Input/output error`——按 maps 白名单（含 `r` 权限区间）规划读取范围，命中 EIO 先回查 maps
- **权限门槛**：非 root 且 `kernel.yama.ptrace_scope=1/2` 时 `/proc/<pid>/mem` 打开即失败（`Permission denied`）——root 或临时 `sysctl kernel.yama.ptrace_scope=0`（用后恢复）
- **竞态窗口**：SIGSTOP 前/后进程可能正切换线程、回收页——先 STOP 再读，读完 CONT；多线程目标 STOP 是全进程冻结，读完后及时 CONT 避免影响行为分析

## core 文件坑组

- **gcore 是单进程 ELF core，不是整机镜像**：Volatility 的 linux.pslist 等只适用整机镜像（LiME/`dd if=/dev/mem` 类）——gcore 上跑 [[re-mem-forensics]] 流程会失败，进程级枚举用 gdb/eu-stack（SKILL.md 步骤 3 已述）
- **vDSO 不可移植**：重建/复现进程镜像时程序跳回原 vDSO 地址或 `call *%gs:0x10` 断掉——vDSO 地址在栈 auxv 的 `AT_SYSINFO`/`AT_SYSINFO_EHDR`，修补 auxv 也不一定能重定位；重建时把 vDSO 相关调用视为必然失效（SKILL.md 坑「vDSO 不可移植」）
- **vsyscall/vdso/vvar 读失败是预期**：`[vsyscall]` 只可执行、`[vdso]` 部分页不可读——按 maps 过滤后提取，别当 bug 排查（SKILL.md 坑 1）
- **core 可达数 GB**：先 `file` 确认是 ELF core，再按需定向提取；整文件导入 Ghidra 前先评估体积
- **gcore 取证分辨率有限**：共享库注入/函数指针重定向难查——深度取证改 ECFS 类内核级转储（core_pattern 挂钩重建 `.symtab`/`.dynsym`）或配合 maps 手工重建（SKILL.md 坑「gcore 取证分辨率」）

## 时机坑组（过早 / 过晚）

- **转储过早 = 壳的初始状态**：壳解密前 dump 拿到的是压缩/加密数据——脱壳样本必须等 OEP 后（SKILL.md 坑 2；[[platform-tips]] 关键经验）
- **解密数据见后即弃**：明文是阶段性的——解壳清理、自清除、用后即焚密钥、缓冲区复用都会立刻抹掉；一确认产物立即保存，"先保存再继续"（SKILL.md 坑「看到解密数据」；需要再现回到解密循环调用点，[[re-binary-core]] 方法论 R19）
- **转储进程生命周期**：attach 型转储要选对时机点（解密完成、校验比较点命中、C2 握手后）——同一目标不同时机 dump 内容差异巨大，取证记录时间戳

## 平台坑组

- **Windows**：procdump 进程级 minidump 与 gcore 同级——Volatility 不适用；整机镜像用 DumpIt/其他内核转储；分析入口 [[re-windbg]] / [[re-x64dbg]]（`minidump` 命令）
- **macOS**：无 /proc 与 Linux 式 gcore——进程内存读取用 task_for_pid 类接口（lldb/自定义工具），转储用 [[re-lldb]] 的 `process save-core`（产物为 Mach-O core，`file` 确认格式）
- **容器内**：`/proc/<pid>/maps` 看到的是容器 namespace 视角（容器内 pid ≠ 宿主机 pid）——转储先 `ps` 确认 pid 归属（宿主 pid 用 `nsenter` 或宿主机 ps 查）

## 版本差异

- **gdb/gcore**：gcore 随 gdb 发布，`-o` 前缀参数长期稳定；gdb 12+ 对 core 的 notes 处理更完整（含 x86_64 AVX 寄存器区）；老 gdb 导出的 core 在新工具链里符号解析可能偏少——核心用新版本，跨版本解析差异以实测为准
- **elfutils（eu-stack）**：0.196 实测 `--version` 可用；eu-stack 对 core 内符号化依赖 `.symtab` 保留情况，剥离符号的 core 输出裸地址
- **内核 core_pattern**：`core_pattern` 决定崩溃转储是传统 core 还是管道给外部工具（systemd-coredump 等）——分析崩溃转储前先确认来源格式（`coredumpctl info` 可查）

## 使用注意

- 动态运行样本在沙箱内执行（[[platform-tips]] 最高原则）
- 转储产物与时间戳 sha256 存档（[[re-triage]]）；结论写 [[analysis-contract]]
- 版本相关行为（gdb core 格式、/proc 语义）以目标版本实际表现为准
