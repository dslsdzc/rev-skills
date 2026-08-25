# 内存转储与提取命令速查与操作序列

工具族按「默认转储优先」组织：gcore/gdb（转储主力）、maps 与 /proc 文件系统（定址/直读）、grep/strings/python（定向提取）、gdb/eu-stack（core 复盘）、procdump/DumpIt（Windows 分支）。命令与参数以官方文档为准（gdb 手册、linux proc(5) 手册、Sysinternals 文档）。

## 命令族速查

### 转储（gcore / gdb）

- `gcore -o <前缀> <pid>` 按 pid 转储（产物 `<前缀>.<pid>`）；`gcore -a -o <前缀> <pid>` 含所有映射段
- `gdb -q -p <pid> -ex 'gcore out' -ex detach -ex quit` 调试器内转储（attach 后可见状态再 dump）
- `gcore --help` 验证；产物是单进程 ELF core（含线程/寄存器 notes）
- 时机：脱壳样本必须等 OEP 解密完成后再 dump（见 SKILL.md 坑「转储时机过早」）

### maps 定址（/proc）

- `cat /proc/<pid>/maps > maps.txt` 记录全部映射（地址区间/权限/路径）
- `grep -E 'vsyscall|vdso|vvar' maps.txt` 剔除不可读极端段（见 [[platform-tips]] Linux 内存转储极端段）
- `awk '$1 ~ /r/ {print $1}' maps.txt` 只保留含读权限的映射区间（提取范围白名单）

### 定向提取（core 内搜索）

- `grep -abo $'dex\n035' out` 找 DEX 魔数位置（`-b` 输出字节偏移）
- `grep -abo '-----BEGIN' out` 找 PEM 私钥头；`grep -abo $'\x89PNG' out` 找 PNG
- `strings -n 8 out | grep -iE 'key|secret|flag|BEGIN'` 通用字符串过滤
- `dd if=out of=seg.bin bs=4096 skip=<偏移/4096> count=<页数>` 按块导出区间（对齐页性能好）
- python 一次性扫描：`data.find(b'\x89PNG')` 循环取全部命中（见 SKILL.md 步骤 4 示例）

### 直读（/proc/<pid>/mem 特例）

- `kill -STOP <pid>` 先停住进程防竞态；`dd if=/proc/<pid>/mem bs=1 skip=<虚拟地址> count=<长度> of=seg.bin 2>/dev/null`（bs=1 慢，小段可用；大段用 python pread 分块）
- python: `os.lseek(f.fileno(), <虚拟地址>, os.SEEK_SET)` + `f.read(n)`（见 SKILL.md 步骤 5 示例）；完成后 `kill -CONT <pid>`
- 偏移是虚拟地址不是文件偏移；maps 白名单（读权限段）之外的地址读必报错——按 maps 定址再读

### core 复盘

- `file out` 确认是 ELF core（`ELF 64-bit LSB core file ...`）
- `gdb -q ./target out` → `bt` / `info registers` / `x/gx $rsp` / `info threads`
- `eu-stack -e out | head -30` 快速栈回溯（elfutils）
- Ghidra: `File > Import File` 导入 core，符号/堆栈线索可用；ELF 结构细节对照 [[re-format-elf]]

### Windows 分支

- `procdump -accepteula -ma <pid> out.dmp` 全进程内存 minidump（含托管堆）
- DumpIt（Comae，管理员）整机物理内存 .raw → [[re-mem-forensics]]
- 分析：[[re-windbg]] 打开 .dmp；[[re-x64dbg]] 命令 `minidump <文件>` 加载

## 常用操作序列（组合套路）

### 1. 标准转储流（maps 记录 → 时机确认 → gcore → 验证 → 定向提取）

```
cat /proc/<pid>/maps > maps.txt                    # 定址基线
# 脱壳样本：确认运行到 OEP（壳解密完成）再 dump
gcore -o out <pid>
file out                                           # 确认 ELF core
grep -abo $'dex\n035' out | head                   # 定向提取（密钥/DEX/字符串）
strings -n 8 out | grep -iE 'key|secret|flag'
# 一次转储满足后续所有定向提取，不重复多次 dump
```

### 2. 直读特例（进程必须保持运行 / 极小区段）

```
kill -STOP <pid>
# 从 maps.txt 取目标段起始虚拟地址
python3 - <<'EOF'
import os
f = open(f"/proc/{pid}/mem", "rb")
os.lseek(f.fileno(), 0x7f0000000000, os.SEEK_SET)
data = f.read(4096); f.close()
EOF
kill -CONT <pid>
```

### 3. 解密数据即时捕获（动态里的「先保存再继续」）

```
# 在解密循环/校验比较点命中时（调试器内）
gdb -q -p <pid> -ex 'gcore out' -ex detach -ex quit   # 立即转储
grep -abo '-----BEGIN' out                             # 或直接定向提取明文区段
# 确认产物可用后再继续运行——解密数据阶段性的，晚了就没了（见 SKILL.md 坑）
```

### 4. core 复盘（进程已死 / 事后分析）

```
file out
gdb -q ./target out                                    # bt / info registers
eu-stack -e out | head -30                             # 快速栈回溯
# Ghidra 导入 core 看反编译与符号；ELF 结构对照 [[re-format-elf]]
```

## 实现教训（内化）

- 转储前先存 maps：直读/提取的所有地址都以 maps.txt 为基准，别凭记忆写偏移
- vsyscall/vdso/vvar 是垃圾页不是 bug：读失败正常，转储后提取跳过，白名单方式直读
- 密钥/明文碎片化：先定位加密上下文（[[re-ghidra]] 看调用点）再取数据，纯扫描可能只拿到半个密钥
- `gcore` 与 `procdump` 都是进程级镜像，整机取证（[[re-mem-forensics]]）需要 DumpIt/LiME 类整机转储——按目标选层级
- ptrace_scope 权限拦是环境问题不是命令问题：root/降级 sysctl 前先确认目标进程归属

## 使用注意

- 动态运行样本在沙箱内执行（[[platform-tips]] 最高原则）；转储产物 sha256 存档（[[re-triage]]）
- 大 core（数 GB）先 `file` 确认再按需定向提取，别整文件导入工具
- 结论与证据（转储时间戳/地址/明文片段）写 [[analysis-contract]]
