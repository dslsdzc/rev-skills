# Zig 最小解析示例

示例以本机 zig 0.17.0-dev 编译的真实产物为标本（Debug/ReleaseSafe 两种构建），readelf/反汇编输出与实测数据可逐字段对照。布局规则见 [[layout]]。

## 0. 标本构建

```zig
// hello.zig
const std = @import("std");
fn check(x: u32) !u32 {
    if (x == 0) return error.BadInput;
    return x * 2;
}
pub fn main() void {
    const r = check(21) catch |e| {
        std.debug.print("err {s}\n", .{@errorName(e)});
        return;
    };
    std.debug.print("val {d}\n", .{r});
}
```

```sh
zig build-exe hello.zig -O Debug -femit-bin=hello_dbg
zig build-exe hello.zig -O ReleaseSafe -femit-bin=hello
```

## 1. 产物判别（readelf 实测）

```
$ readelf -S hello | grep -E 'gcc_except|eh_frame'
  [ 2] .eh_frame_hdr
  [ 3] .eh_frame            ← 有 .eh_frame 但无 .gcc_except_table（不能单独作判据）

$ readelf -s hello | grep -E '__gxx_personality_v0|_ZTV'   # 无输出 = 无 C++ 异常/RTTI
$ readelf -s hello | grep -E 'panic' | head -3
    26: 0000000000000000     8 TLS     LOCAL  DEFAULT    5 debug.panic_stage
    27: 0000000001088000     1 OBJECT  LOCAL  DEFAULT    9 debug.panicking
    64: 000000000107ac00   718 FUNC    LOCAL  DEFAULT    4 debug.panicExtra[...]
```

对照要点：panic 链符号（0.17 命名 `debug.panicExtra`/`debug.panicking`，老版本是 `std.debug.panic`）；`.eh_frame` 是 C 编译器统一产物，判别看 `.gcc_except_table` 与 `__gxx_personality_v0`。

## 2. 符号可见性（LOCAL vs GLOBAL）

```
$ readelf -s hello | grep -wE '_start|main'
     2: 0000000001024c30    16 FUNC    LOCAL  DEFAULT    4 start._start
   838: 0000000001024c30    16 FUNC    GLOBAL DEFAULT    4 _start      ← 唯一默认导出
    18: 0000000001075540   388 FUNC    LOCAL  DEFAULT    4 hello.main   ← 业务函数 LOCAL

$ readelf -s hello | grep FUNC | awk '$7=="GLOBAL"' | wc -l     # 全局函数计数（约 1-2）
```

对照要点：业务函数是 LOCAL 符号（Debug/ReleaseSafe 保留符号表但非导出）；hook/注入面按 GLOBAL 算。

## 3. 错误联合布局（反汇编实测，0.17）

`check` 函数（Debug 构建）关键片段：

```
00000000011df000 <hello.check>:
 11df008: 89 44 24 18             movl %eax, 0x18(%rsp)   ; 参数 x
 11df00c: 83 f8 00                cmpl $0x0, %eax
 11df00f: 0f 85 12 00 00 00       jne  ...                ; x!=0 走正常路径
 11df015: e8 16 a3 e4 ff          callq lang.returnError  ; 错误返回路径（0.17 命名）
 11df01a: 48 8b 04 25 94 6a 27 01 movq 0x1276a94, %rax    ; 装入错误表值（错误码在高位）
 11df02c: bb 02 00 00 00          movl $0x2, %ebx         ; 正常路径: x*2
 11df05f: 48 89 54 24 10          movq %rdx, 0x10(%rsp)
 11df064: 89 44 24 10             movl %eax, 0x10(%rsp)   ; 载荷(u32)在槽位低 4 字节
 11df068: 66 c7 44 24 14 00 00    movw $0x0, 0x14(%rsp)   ; 错误码 u16=0（无错）在 offset+4

; main 中调用点（catch 检查）:
 11df0e0: b8 15 00 00 00          movl $0x15, %eax        ; x=21
 11df0e5: e8 16 ff ff ff          callq hello.check
 11df0ea: 48 89 44 24 28          movq %rax, 0x28(%rsp)   ; 8 字节槽位
 11df0ef: 66 83 7c 24 2c 00       cmpw $0x0, 0x2c(%rsp)   ; ← 错误码比较（catch/orelse）
 11df0f5: 0f 85 0e 00 00 00       jne  错误分支
```

对照要点：`E!u32` 是 8 字节槽位——载荷在低 4 字节、错误码 u16 在 offset +4（无错=0）；`cmpw $0, slot+4` + 分支即 `catch` 编译产物。

## 4. 错误联合尺寸实测（sizeOf）

```
$ zig build-exe sizez.zig -O ReleaseSafe -femit-bin=sizez && ./sizez
u32: 8  u128: 32  struct16: 24  u8: 4  bool: 4
```

| 载荷 | E!T 尺寸 | 说明 |
|---|---|---|
| u8/bool | 4 | 载荷 + u16 错误码 + 填充 |
| u32/u64 | 8 | 错误码在载荷之后（高位侧） |
| u128 | 32 | 错误码在前 2 字节、载荷按 16 对齐内联 |
| struct{u64,u64} | 24 | 载荷按 8 对齐内联 |

## 5. 启动链与栈检查（ReleaseSafe 实测）

```
$ readelf -s hello | grep -E '_start|probe'
   838: 0000000001024c30    16 FUNC    GLOBAL DEFAULT    4 _start
   833: 000000000107e460    54 FUNC    LOCAL  HIDDEN     4 __zig_probe_stack

0000000001024c30 <_start>:                ; 16 字节短桩
 1024c30: 48 8d 3d 21 e0 05 00  leaq 0x5e021(%rip), %rdi
 1024c37: e9 14 00 00 00       jmpq  0x1024c50           ; → std.start 初始化
```

对照要点：`_start` 是短桩跳转；`__zig_probe_stack` 是栈探测（安全特性）；ReleaseSafe 保留 `hello.main` LOCAL 符号与 panic 链。

## 实现教训（内化）

- 判别组合用三个独立特征：无 `.gcc_except_table` / 无 `__gxx_personality_v0` / 无 `_ZTV*`；`.eh_frame` 不算
- 错误码恒为 u16、检查模式恒为"槽位高 16 位比较"——先找 `cmpw` + 分支即可定位所有 catch/orelse
- 符号可见性决定 hook 面：LOCAL 符号只是线索，`export`/GLOBAL 才是宿主调用点

## 使用注意

- 本机 0.17.0-dev 实测；用户产物以自身版本为准（panic 链命名与错误联合细节随版本变，见 [[layout]] 版本差异）
- 与 [[re-cpp-abi]]（C++ 判别）、[[analysis-contract]]（符号表传递）配合使用
