# Zig 二进制布局：启动路径 / 错误联合 / panic 链 / 符号可见性

Zig 产物与 C 产物的最大差异在错误处理（error union 而非异常表）与符号可见性（业务函数 LOCAL）。先确认 Zig 版本再读布局——panic 链命名与错误联合细节随版本演进。

## 启动路径（ELF，x86-64 实测 0.17.0-dev）

```
_start (GLOBAL)           ← 链接器入口（用户代码不可见）
  └─ std.start 运行时初始化（栈指针/安全栈、exit 处理）
       └─ main (LOCAL)    ← 用户 main 函数（Zig 的 main 是普通函数）
            退出经 std.start 包裹层（return 后处理）
```

- `_start` 是唯一默认导出的业务无关 GLOBAL 函数；`export fn` 才产生其他导出
- 反汇编入口链：`_start` 短桩（16 字节级）→ std.start 初始化函数（大，含安全特性安装）

## 符号可见性（与 C 的重要差异）

| 构建模式 | 业务函数符号 | 说明 |
|---|---|---|
| Debug / ReleaseSafe | LOCAL（符号表保留） | `nm` 可见但非导出；`_start` 为 GLOBAL |
| ReleaseFast / ReleaseSmall | 可被 strip | 按行为特征恢复 |
| `export fn` | GLOBAL | 显式导出（C ABI 边界，宿主调用点） |

- 判别命令：`readelf -s sample | grep FUNC | awk '$7=="GLOBAL"'` 数全局函数
- hook/注入面按导出表（GLOBAL + 动态符号）算，LOCAL 符号只是分析线索

## 错误联合（error union）布局

`E!T`（错误联合）编译为"错误码 + 载荷"：错误码恒为 u16（0 = 无错），布局按载荷大小分两种。

### 载荷 ≤ 8 字节：整体一个槽位，错误码在载荷之后（高位侧）

| 载荷类型 | 槽位大小（实测 0.17） | 错误码位置 |
|---|---|---|
| u8 / bool | 4 字节 | 载荷之后（u8 在 offset 1） |
| u32 | 8 字节 | offset +4（u16） |
| u64 | 8 字节 | 高位 u16 |

### 载荷 > 8 字节：错误码在前 2 字节，载荷按自身对齐内联

| 载荷类型 | 槽位大小（实测 0.17） |
|---|---|
| u128（对齐 16） | 32 字节 |
| struct { u64, u64 }（对齐 8） | 24 字节 |

- 反汇编识别：调用点后 `cmpw $0, 槽位+offset` + 分支 = `catch`/`orelse` 的错误码检查；错误返回路径 `call lang.returnError`（0.17 命名）后装入错误表地址
- `@errorName(e)` 在字符串池留错误名（`__zig_tag_name_*` 符号/字符串），可还原错误语义

## panic 链

| 版本 | 链形态 |
|---|---|
| 0.14+（实测 0.17.0-dev） | `@panic`/断言 → `debug.panicExtra`/`debug.FullPanic.defaultPanic` → `debug.panicking` 状态 + 打印 + abort；溢出检查 `debug.FullPanic(...).integerOverflow` |
| 更早版本 | `std.debug.panic`（直接命名） |

- 定位方式不依赖符号名：找"打印 + abort"序列（`__zig_probe_stack` 附近的栈检查调用也常见）
- `debug.panicking` 是 TLS 状态（panic 期间再 panic 短路）

## C ABI 边界

- 默认调用约定即 C ABI（`callconv(.c)` 默认，x86-64 SysV）——反编译无特殊约定负担
- 导入：`@extern`/`@cImport` → 动态符号表（`readelf -d` NEEDED + UND 符号）
- 导出：`export fn` → GLOBAL（导出表）
- 混合产物判别：Zig 侧无 RTTI/异常表符号（`_ZTV*`/`__gxx_personality_v0` 缺失），C++ 侧有

## 版本差异要点

- panic 链命名：0.14 前后差异大（`debug.panicExtra` vs `std.debug.panic`）
- 错误联合布局：u16 错误码不变；槽位尺寸/对齐随版本微调（以实测为准，[[examples]] 有 0.17 实测）
- `main` 符号形态稳定（LOCAL 普通函数）；`_start` 稳定（GLOBAL）
- ReleaseFast 可能去除 panic 链（`-Drelease-fast` 下安全检查关闭）

## 使用注意

- 静态分析无需沙箱；跨架构 Zig 产物（ARM/RISC-V）布局规则同（错误码 u16 不变），槽位尺寸按指针宽度
- 与 [[analysis-contract]]（符号表传递）、[[re-cpp-abi]]（C++ 判别）配合使用
