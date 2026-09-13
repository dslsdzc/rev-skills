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
