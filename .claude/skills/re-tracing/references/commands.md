# strace / ltrace / dtruss 命令速查与操作序列

分工：strace 看系统调用（内核边界），ltrace 看库函数调用（用户态边界），dtruss 是 macOS 的 strace 对应物（DTrace 实现）。选项以本机 `strace --help` / `ltrace --help` 为准（版本差异见 [[gotchas]]）。

## 命令族速查

### strace —— 系统调用

| 用途 | 命令 |
|---|---|
| 全进程树跟踪 | `strace -f -o trace.log ./target` |
| 按类别过滤 | `-e trace=file,network,process,signal,ipc,memory,desc,read,write`（可组合） |
| 排除噪声 | `-e trace=!futex`（高频调用排除） |
| 指定调用 | `-e trace=openat,execve,connect,sendto` |
| 正则匹配调用名 | `-e trace=/open`（匹配含 open 的系统调用） |
| attach 运行中进程 | `sudo strace -f -p <pid> -o attach.log` |
| 汇总统计 | `-c`（退出打印 次数/耗时/错误 表） |
| 时间戳 | `-tt` 微秒级；`-T` 每调用耗时 |
| 字符串长度 | `-s 200`（默认 32） |
| hex 输出 | `-x`（非 ASCII 转 hex）；`-xx`（全部） |
| fd 解析路径 | `-y`（路径）；`-yy`（含 socket 细节） |
| 按 pid 分文件 | `-o log.%p` |
| 静默 | `-q`（抑制 attach/detach 消息） |

### ltrace —— 库调用

| 用途 | 命令 |
|---|---|
| 库调用跟踪 | `ltrace -f -o lib.log ./target` |
| 指定函数 | `-e malloc+free`（`+` 追加、`!` 排除） |
| 指定库 | `-l /path/libfoo.so`（dlopen 后加载的库） |
| 库 + 系统调用 | `-S` |
| 汇总 | `-c` |
| 相对时间戳 | `-r` |
| 指令指针 | `-i`（打印调用点 IP，对照反汇编） |
| 调用栈 | `-w 5`（最多 5 帧 backtrace） |
| attach | `ltrace -p <pid>` |

### dtruss（macOS，DTrace）

| 用途 | 命令 |
|---|---|
| 基本跟踪 | `sudo dtruss -f ./target`（DTrace 输出走 stdout） |
| 调用栈 | `-s`（打印 stack backtraces） |
| 耗时统计 | `-e`（elapsed times，微秒） |
| 过滤调用 | `-t <syscall>`（如 `-t write`） |
| 汇总 | `-c`（syscall counts 次数统计） |

### 后处理管道

```sh
strace -f -o trace.log ./target
grep -E 'openat\(.*ENOENT' trace.log        # "找不到文件"类线索（配置路径/缺失依赖）
grep -E 'connect\(' trace.log               # 网络回连点
grep -c 'ptrace' trace.log                  # 反调试痕迹排查
awk '/read\(|write\(/' trace.log           # 数据搬运片段
```

## 常用操作序列

### 1. 定位持久化/文件行为

```
strace -f -e trace=file,process -o fs.log ./target
→ grep openat/creat/rename/unlink + O_WRONLY/O_CREAT → 写盘路径清单
→ grep execve → 拉起的进程链
→ 结果对照 [[re-behavior]] 的持久化位置清单
```

### 2. 网络回连与协议参数

```
strace -f -e trace=network,read,write -o net.log ./target
→ grep -E 'socket|connect|sendto|recvfrom' → 目标 IP:端口与数据片段
→ -s 200 保证 payload 不截断；与 [[re-netcap]] 抓包对照
```

### 3. 动态解析 API 跟踪（dlopen/dlsym 之后）

```
ltrace -f -o lib.log ./target
ltrace -f -l /path/libfoo.so ./target     # 显式指定动态加载库
→ 输出出现静态 IAT 里没有的函数 → 与 [[re-imports]] 静态结果合并成完整 API 面
```

### 4. 反调试检测点定位

```
strace -f -e trace=ptrace,process -o det.log ./target
→ grep ptrace 观察样本自跟踪/检测行为
→ 样本对 trace 环境常表现为时序差异或假路径——检测点确认后按 [[re-anti-analysis]] 绕过/静态 patch
```

### 5. 热点统计（性能/路径偏好）

```
strace -f -c -o /dev/null ./target        # 系统调用热点
ltrace -f -c ./target                     # 库调用热点
→ 高频 futex/epoll_wait = 等待循环；高频 read/write = 数据搬运路径
```

## 实现教训（内化）

- 输出即证据：`-o` 落盘 + 时间戳，终端只做预览；日志 sha256 入档（[[re-triage]]）
- 字符串"看不到内容"第一嫌疑是 `-s` 默认 32 字节截断——先放大再重跑
- 白名单过滤优于黑名单：先 `-e trace=network,file` 缩小，再 `!futex` 排噪
- attach 追不到初始化：早期逻辑用启动模式重跑；attach 只看"当前时刻之后"
- ltrace 依赖 PLT/动态符号表，静态链接程序基本无输出——先 `file` 确认动态链接，静态样本换 strace 或模拟执行

## 使用注意

- 全部在沙箱内执行（[[platform-tips]] 最高原则）
- 反调试样本的 trace 结果可能被刻意污染（见 [[gotchas]] 与 [[re-anti-analysis]]）
- 证据链：日志路径 + sha256 + 时间戳 → [[analysis-contract]]
