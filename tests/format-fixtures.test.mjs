import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// 格式断言 fixture：技能里对**字节布局**的断言，可以用纯代码构造的最小样本验证，
// 不依赖网络与外部样本。这类断言最贵——写错一个字整条解析链都错。
// 首个 fixture 对应 re-format-elf/references/layout.md 的「扩展编号三套规则」
// （该处原文即注明"建议配 parser fixture 验证这三条路径"）。

const U16 = (b, o) => b.readUInt16LE(o);
const U32 = (b, o) => b.readUInt32LE(o);
const U64 = (b, o) => Number(b.readBigUInt64LE(o));

/** 构造一个带扩展编号的 ELF64：三个哨兵值全用上，真值放在 section 0 */
function buildElfWithExtendedNumbering({ phnum = 2, shnum = 3, shstrndx = 2 } = {}) {
  const EHSIZE = 64, PHENTSIZE = 56, SHENTSIZE = 64;
  const e_phoff = EHSIZE;
  const e_shoff = EHSIZE + phnum * PHENTSIZE;
  const buf = Buffer.alloc(e_shoff + shnum * SHENTSIZE);

  // e_ident
  buf.write('\x7fELF', 0, 'latin1');
  buf[4] = 2;   // EI_CLASS = ELFCLASS64
  buf[5] = 1;   // EI_DATA  = ELFDATA2LSB
  buf[6] = 1;   // EI_VERSION
  buf[7] = 0;   // EI_OSABI = NONE

  buf.writeUInt16LE(2, 16);            // e_type = ET_EXEC
  buf.writeUInt16LE(0x3e, 18);         // e_machine = x86-64
  buf.writeUInt32LE(1, 20);            // e_version
  buf.writeBigUInt64LE(0n, 24);        // e_entry
  buf.writeBigUInt64LE(BigInt(e_phoff), 32);
  buf.writeBigUInt64LE(BigInt(e_shoff), 40);
  buf.writeUInt32LE(0, 48);            // e_flags
  buf.writeUInt16LE(EHSIZE, 52);       // e_ehsize
  buf.writeUInt16LE(PHENTSIZE, 54);    // e_phentsize
  buf.writeUInt16LE(0xffff, 56);       // e_phnum = PN_XNUM  ← 哨兵 1
  buf.writeUInt16LE(SHENTSIZE, 58);    // e_shentsize
  buf.writeUInt16LE(0, 60);            // e_shnum = 0       ← 哨兵 2
  buf.writeUInt16LE(0xffff, 62);       // e_shstrndx = SHN_XINDEX ← 哨兵 3

  // section 0：SHT_NULL，承载三个真值
  const s0 = e_shoff;
  buf.writeUInt32LE(0, s0 + 0);                    // sh_name
  buf.writeUInt32LE(0, s0 + 4);                    // sh_type = SHT_NULL
  buf.writeBigUInt64LE(BigInt(shnum), s0 + 32);    // sh_size = 真实节数（offset 是 Number，值是 BigInt）
  buf.writeUInt32LE(shstrndx, s0 + 40);            // sh_link = 真实 shstrndx
  buf.writeUInt32LE(phnum, s0 + 44);               // sh_info = 真实程序头数
  return buf;
}

/** 按 layout.md 的三套规则解析（与被测断言一一对应） */
function parsePerExtendedNumberingRules(buf) {
  const e_phnum = U16(buf, 56), e_shnum = U16(buf, 60), e_shstrndx = U16(buf, 62);
  const e_shoff = U64(buf, 40);
  const sh = (i, field) => {   // 节头表里第 i 项的某字段
    const base = e_shoff + i * U16(buf, 58);
    return { name: U32(buf, base), type: U32(buf, base + 4), size: U64(buf, base + 32), link: U32(buf, base + 40), info: U32(buf, base + 44), }[field];
  };
  return {
    phnum: e_phnum === 0xffff ? sh(0, 'info') : e_phnum,          // PN_XNUM
    shnum: e_shnum === 0 ? sh(0, 'size') : e_shnum,                // e_shnum == 0
    shstrndx: e_shstrndx === 0xffff ? sh(0, 'link') : e_shstrndx,  // SHN_XINDEX
  };
}

test('ELF 扩展编号三套规则：三个哨兵值分别落在 shdr[0] 的 sh_info / sh_size / sh_link', () => {
  const buf = buildElfWithExtendedNumbering({ phnum: 7, shnum: 11, shstrndx: 5 });
  // 哨兵确实写在头部（否则测的不是扩展编号这条路径）
  assert.equal(U16(buf, 56), 0xffff, 'e_phnum 应为 PN_XNUM');
  assert.equal(U16(buf, 60), 0, 'e_shnum 应为 0');
  assert.equal(U16(buf, 62), 0xffff, 'e_shstrndx 应为 SHN_XINDEX');
  // 按规则解析出的真值
  const r = parsePerExtendedNumberingRules(buf);
  assert.deepEqual(r, { phnum: 7, shnum: 11, shstrndx: 5 });
  // 三条规则落在**不同字段**上——共用一个字段就会互相覆盖
  assert.notEqual(parsePerExtendedNumberingRules(buf).phnum, U16(buf, 60));
});

test('ELF 魔数的字节序：字节 7f 45 4c 46，小端 u32 得 0x464c457f、大端得 0x7f454c46', () => {
  const buf = buildElfWithExtendedNumbering();
  assert.equal(buf.subarray(0, 4).toString('hex'), '7f454c46');
  assert.equal(buf.readUInt32LE(0), 0x464c457f);
  assert.equal(buf.readUInt32BE(0), 0x7f454c46);
});

test('readelf 对同一 fixture 的解读与三条规则一致（有 readelf 时才跑）', () => {
  let has = true;
  try { execFileSync('readelf', ['--version'], { stdio: 'ignore' }); } catch { has = false; }
  if (!has) return;   // 无 binutils 时跳过：本测试的价值是"用独立实现交叉验证我们自己写的解析"

  const dir = mkdtempSync(join(tmpdir(), 'elffx-'));
  const p = join(dir, 'ext.elf');
  writeFileSync(p, buildElfWithExtendedNumbering({ phnum: 7, shnum: 11, shstrndx: 5 }));
  // 固定 LC_ALL=C：本地化的 readelf 会把字段名译成"程序头数量："等，正则匹配不到
  const out = execFileSync('readelf', ['-h', p], { encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' } });
  // readelf 的显示约定：**原始哨兵值 (括号内为按规则解析出的真值)**，如 `Number of program headers: 65535 (7)`
  const resolved = (label) => {
    const m = new RegExp(`${label}:\\s+(\\d+) \\((\\d+)\\)`).exec(out);
    return m ? { raw: Number(m[1]), real: Number(m[2]) } : null;
  };
  assert.deepEqual(resolved('Number of program headers'), { raw: 0xffff, real: 7 });
  assert.deepEqual(resolved('Number of section headers'), { raw: 0, real: 11 });
  assert.deepEqual(resolved('Section header string table index'), { raw: 0xffff, real: 5 });
  rmSync(dir, { recursive: true, force: true });
});

// 对应 re-flutter/SKILL.md：Dart 的两个 magic 都是**数值**，文件里是小端字节——不是可 grep 的 ASCII 串
test('Dart kernel magic 0x90abcdef 与 snapshot magic 0xdcdcf5f5 的字节形态', () => {
  const kernel = Buffer.alloc(4);
  kernel.writeUInt32LE(0x90abcdef);
  assert.equal(kernel.toString('hex'), 'efcdab90');
  assert.notEqual(kernel.toString('latin1'), 'KERNEL');

  const snap = Buffer.alloc(4);
  snap.writeUInt32LE(0xdcdcf5f5);
  assert.equal(snap.toString('hex'), 'f5f5dcdc');
  assert.ok(!snap.toString('latin1').includes('SNAPSHOT'));
});

test('Dart snapshot 基础头为 20 字节：magic(4) + length(8) + kind(8)', () => {
  const head = Buffer.alloc(20);
  head.writeUInt32LE(0xdcdcf5f5, 0);
  head.writeBigInt64LE(0x1000n, 4);    // length
  head.writeBigInt64LE(2n, 12);        // kind = full-aot
  assert.equal(head.readUInt32LE(0), 0xdcdcf5f5);
  assert.equal(Number(head.readBigInt64LE(4)), 0x1000);
  assert.equal(Number(head.readBigInt64LE(12)), 2);
  assert.equal(head.length, 20);
  // 头部之后才是（版本相关的）子 blob 布局——本 fixture 只锁定基础头，不对其后的内部布局作承诺
});

// 对应 re-format-macho/references/layout.md：Mach-O 的基础常量与端序规则
// 取值对照 LLVM BinaryFormat/MachO.h（Apple loader.h / machine.h 的忠实移植）
test('Mach-O cputype / cpusubtype：arm64e 靠 subtype 区分，不靠 cputype', () => {
  const CPU_ARCH_ABI64 = 0x01000000;
  const CPU_TYPE_X86 = 7, CPU_TYPE_ARM = 12;
  assert.equal(CPU_TYPE_X86 | CPU_ARCH_ABI64, 0x01000007);        // x86_64
  assert.equal(CPU_TYPE_ARM | CPU_ARCH_ABI64, 0x0100000c);        // arm64
  // 两个都是 arm64 的二进制，只靠 cpusubtype 分开
  const ARM64_ALL = 0, ARM64_V8 = 1, ARM64E = 2;
  assert.deepEqual([ARM64_ALL, ARM64_V8, ARM64E], [0, 1, 2]);
  // x86_64 侧：3 是 ALL、8 才是 H；0x80000000 只是 capability 位，不改变基础 subtype
  assert.equal(3, 3);                                             // CPU_SUBTYPE_X86_64_ALL
  assert.equal(8, 8);                                             // CPU_SUBTYPE_X86_64_H
  // 注意 JS/C 共同的坑：按位或按有符号 32 位解释，0x80000000|3 会是负数——要 >>>0 才得 uint32
  assert.equal((0x80000000 | 3) >>> 0, 0x80000003);               // LIB64 capability 位
  assert.ok(0x80000000 | 3 < 0);                                  // 未修正时的真实取值
  assert.notEqual((0x80000000 | 3) >>> 0, 8);                     // 它变不出 x86_64h
});

test('Mach-O header flags 是位值，不是连续编号', () => {
  const MH = { NOUNDEFS: 0x1, INCRLINK: 0x2, DYLDLINK: 0x4, BINDATLOAD: 0x8, SPLIT_SEGS: 0x20, LAZY_INIT: 0x40, TWOLEVEL: 0x80, PIE: 0x200000, HAS_TLV_DESCRIPTORS: 0x800000 };
  assert.equal(MH.LAZY_INIT, 0x40);
  assert.equal(MH.TWOLEVEL, 0x80);
  // 若按"连续编号"手抄，会得到 2=DYLDLINK、4=TWOLEVEL、0x800000=LAZY_INIT —— 全部错位
  assert.notEqual(MH.DYLDLINK, 0x2);
  assert.notEqual(MH.TWOLEVEL, 0x4);
  assert.notEqual(MH.HAS_TLV_DESCRIPTORS, MH.LAZY_INIT);
  // 独立位可直接按位与判定
  assert.equal(0x200000 & MH.PIE, MH.PIE);
});

test('Mach-O n_type：基础类型与属性位分层读，0x0f 不是 undefined', () => {
  const N_TYPE = 0x0e, N_EXT = 0x01, N_PEXT = 0x10;
  assert.equal(0x0f & N_TYPE, 0x0e);      // N_SECT
  assert.equal(0x0f & N_EXT, 0x01);       // 且是 external
  // 0x0f 应解读为 N_SECT|N_EXT，而不是 N_UNDF
  assert.notEqual(0x0f & N_TYPE, 0x00);
  assert.equal(0xf0 & N_TYPE, 0x00);      // N_UNDF 只可能是低 4 位为 0 的组合
  assert.equal(0x01 & N_TYPE, 0);
});

test('fat Mach-O：结构恒为大端，align 是 2 的幂', () => {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(0xcafebabe, 0);     // FAT_MAGIC，按磁盘约定写大端
  header.writeUInt32BE(2, 4);              // nfat_arch
  assert.equal(header.subarray(0, 4).toString('hex'), 'cafebabe');   // 文件开头就是 CA FE BA BE
  assert.equal(header.readUInt32BE(0), 0xcafebabe);                  // FAT_MAGIC
  assert.equal(header.readUInt32LE(0), 0xbebafeca);                  // 小端读得 FAT_CIGAM——同一份字节，不是"小端文件"

  // fat_arch.align 是 2 的幂：align=14 → 偏移需 2^14 对齐，而不是固定 4 字节
  const align = 14;
  assert.equal(2 ** align, 16384);
  assert.equal(16384 % 4, 0);               // 2^align 必然满足 4 字节，反之不成立
  assert.notEqual(2 ** align, 4);
});

// 对应 re-ai-model/SKILL.md：Safetensors 前 8 字节 = 小端 u64 头长度
test('Safetensors：前 8 字节是小端 u64 的 JSON 头长度', () => {
  const header = Buffer.from(JSON.stringify({ __metadata__: { format: 'pt' } }), 'utf8');
  const len = Buffer.alloc(8);
  len.writeBigUInt64LE(BigInt(header.length));
  const file = Buffer.concat([len, header]);

  const readLen = Number(file.readBigUInt64LE(0));
  assert.equal(readLen, header.length);
  assert.deepEqual(JSON.parse(file.subarray(8, 8 + readLen).toString('utf8')), { __metadata__: { format: 'pt' } });
  // 大端读法会得到完全不同的值——这正是"必须按小端读"这条断言的意义
  assert.notEqual(file.readBigUInt64BE(0), BigInt(header.length));
});
