import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

// 审查记录的回归断言：把「已修的事实性缺陷」变成永久检查。
// 价值有两层——① 复核（确认修正确实落地）② 防回归（日后有人重写技能时，不会把错的说法写回去）。
// 每条对应 docs/audit/2026-09-13-factual-audit.md 的一个编号。
const S = '.claude/skills/';
const read = (p) => readFileSync(S + p, 'utf8');

// 「提到错误写法」与「把错误写法当对的用」是两回事——技能里的迁移说明会刻意写出旧写法
// （如"旧写法 Module.findExportByName(null, n) 已移除"）。因此断言只认**非否定语境**下的出现。
const NEGATION = /已移除|已废弃|弃用|无此|没有|不再|不是|勿用|不应|错误|旧写法|过时|不携带|不具备|不支持|不存在/;

/** 断言：这些串不该再以"正确写法"的身份出现 */
function absent(t, file, needles, note) {
  const lines = read(file).split('\n');
  const hit = [];
  for (const n of needles) {
    const offenders = lines.filter((l) => l.includes(n) && !NEGATION.test(l));
    if (offenders.length) hit.push(`${n}（${offenders.length} 处，如：${offenders[0].trim().slice(0, 70)}）`);
  }
  assert.deepEqual(hit, [], `${file} 仍把已修正的错误表述当作正确写法（${note}）`);
}
/** 断言：文件里应出现这些串（修正后的表述） */
function present(t, file, needles, note) {
  const text = read(file);
  const miss = needles.filter((n) => !text.includes(n));
  assert.deepEqual(miss, [], `${file} 缺少修正后的表述（${note}）：${miss.join(' / ')}`);
}

test('#1/#2 re-android-crypto：KeyInfo 的 API 用对', () => {
  const f = 're-android-crypto/SKILL.md';
  absent(null, f, ['getKeyAlias'], 'KeyStore 无此方法');
  present(null, f, ['getSecurityLevel'], 'API 31+ 判安全等级');
});

test('#3 re-macos：Secure Enclave 密钥不能用导入 API', () => {
  const f = 're-macos/SKILL.md';
  present(null, f, ['SecKeyCreateRandomKey'], 'SE 密钥只能设备内生成');
});

test('#4 re-ai-model：Safetensors 头长度是小端', () => {
  const f = 're-ai-model/SKILL.md';
  absent(null, f, ['大端 u64 头长度'], '字节序反了');
  present(null, f, ['<Q'], '小端解析');
});

test('#5/#6/#7 re-mobile-forensics：备份索引是 Manifest.db、fileID 由路径派生、IsEncrypted 判加密', () => {
  const f = 're-mobile-forensics/SKILL.md';
  present(null, f, ['Manifest.db'], '文件索引在 SQLite');
  present(null, f, ['IsEncrypted'], '加密判定读 Manifest.plist 的该键');
});

test('#8 re-riscv：QEMU virt 的 reset 向量在 MROM 0x1000', () => {
  const f = 're-riscv/SKILL.md';
  present(null, f, ['0x1000'], 'MROM 地址');
  present(null, f, ['0x80000000'], 'DRAM 基址（stub 跳转目标）');
});

test('#9 re-dotnet：EntryPoint 是 union，不总是 RVA', () => {
  const f = 're-dotnet/SKILL.md';
  present(null, f, ['EntryPointToken'], 'union 写法');
  present(null, f, ['COMIMAGE_FLAGS_NATIVE_ENTRYPOINT'], '按标志位决定解释');
});

test('#10 re-automotive：candump 的过滤语法与写文件是两件事', () => {
  const f = 're-automotive/SKILL.md';
  present(null, f, ['candump can0,7E0:7FF'], '过滤在接口名后的逗号位');
  absent(null, f, ['candump can0 -f 0x7E0'], '-f 是写文件，不是过滤');
});

test('#11 re-forensics：gcore 产物走进程级复盘，不走 Volatility 整机路径', () => {
  const f = 're-forensics/SKILL.md';
  present(null, f, ['gcore'], '分流说明应保留');
});

test('#12 re-ai-model：ONNX 起始字节不是固定 signature', () => {
  const f = 're-ai-model/SKILL.md';
  present(null, f, ['ir_version'], '首字段是 ir_version，随版本递增');
});

test('#13 re-dotnet：版本串是典型默认值，不是不变量', () => {
  const f = 're-dotnet/SKILL.md';
  absent(null, f, ['产物恒定'], '不应作恒定断言');
});

test('#14 re-macos：可访问性与访问控制是两个属性', () => {
  const f = 're-macos/SKILL.md';
  present(null, f, ['kSecAttrAccessControl'], '访问控制是它，不是 kSecAttrAccessible');
});

test('#15 re-mem-forensics：volatility3 只要求 Python 3.8+，无 3.11 上限', () => {
  const f = 're-mem-forensics/SKILL.md';
  absent(null, f, ['Python 3.8-3.11'], '官方无该上限');
});

test('#16 高熵不等于加密（ransomware 与 proto-rev 两处）', () => {
  const r = read('re-ransomware/SKILL.md');
  assert.ok(!/>7\.0 已加密/.test(r), 're-ransomware 不应把高熵当加密判定');
  const p = read('re-proto-rev/SKILL.md');
  assert.ok(!/几乎肯定加密/.test(p), 're-proto-rev 不应出现"几乎肯定加密"');
});

test('#17 Frida 17：静态查找/枚举 API 已移除，须用模块实例方法', () => {
  const files = [
    're-frida/SKILL.md', 're-frida/references/frida-scripts.md',
    're-android-native/SKILL.md', 're-android-native/references/probes.md',
    're-crypto-id/SKILL.md', 're-ios-jb/SKILL.md', 're-flutter/SKILL.md',
    're-address-space/SKILL.md',
  ];
  const offenders = [];
  for (const f of files) {
    if (!existsSync(S + f)) continue;
    const lines = read(f).split('\n');
    for (const bad of ['Module.findExportByName(', 'Module.getExportByName(', 'Module.findBaseAddress(']) {
      const badLines = lines.filter((l) => l.includes(bad) && !NEGATION.test(l));
      if (badLines.length) offenders.push(`${f}: ${bad}（${badLines[0].trim().slice(0, 70)}）`);
    }
  }
  assert.deepEqual(offenders, [], `仍在使用 Frida 17 已移除的静态 API：\n${offenders.join('\n')}`);
});

test('#18 re-frida-script-author：改返回值必须用 onLeave 的 retval.replace', () => {
  const f = 're-frida-script-author/SKILL.md';
  present(null, f, ['retval.replace'], 'onLeave 的 retval 才是改返回值的入口');
  absent(null, f, ['this.returnValue'], '`this` 上没有 returnValue');
});

test('#19 re-ics：scapy Modbus 字段名是 camelCase startAddr', () => {
  const f = 're-ics/SKILL.md';
  present(null, f, ['startAddr'], 'scapy 定义的字段名');
  absent(null, f, ['start_addr='], '下划线写法在 scapy 上不成立');
});

test('#20 re-angr：9.2.x 不是固定 Python 区间', () => {
  const f = 're-angr/SKILL.md';
  absent(null, f, ['支持 Python 3.8–3.11', '支持 Python 3.8-3.11'], '下限随补丁版本抬高');
  present(null, f, ['requires-python'], '以目标版本元数据为准');
});

test('#21 re-ios-jb：读 C 字符串是 NativePointer 实例方法', () => {
  const f = 're-ios-jb/SKILL.md';
  absent(null, f, ['Memory.readCString'], 'Memory 下无此方法');
});

test('补充 22：analysis-contract 的 ELF 魔数表述与字节序正确', () => {
  const f = 're-analyze/references/analysis-contract.md';
  const text = read(f);
  assert.ok(text.includes('7f 45 4c 46'), '应给出字节序列');
  assert.ok(text.includes('0x464c457f'), '小端 u32 读法');
  assert.ok(!/小端读作 0x7f454c46/.test(text), '旧表述把大端读法写成了小端');
  assert.ok(!text.includes('0x202'), '最初的错误值不应复现');
});

test('补充 22：system-fingerprints 的 FreeBSD 标识是 .note.tag', () => {
  const f = 're-analyze/references/system-fingerprints.md';
  const text = read(f);
  assert.ok(text.includes('.note.tag'), '现代 FreeBSD 由 crtbrand.S 生成 .note.tag');
  assert.ok(!text.includes('`.note.ABI-tag`(FreeBSD)'), '不应把 note type 与 section name 混写');
});

test('补充 22：ET_REL 不单独断定 Linux 内核模块', () => {
  const f = 're-analyze/references/system-fingerprints.md';
  const text = read(f);
  assert.ok(!/ET_REL\s*\*\*\s*→.*Linux 内核模块/s.test(text) || !/\[强\]\s*Linux 内核模块/.test(text),
    'ET_REL 只说明"可重定位 ELF"，需组合判据才升 Linux kmod');
});

test('补充 28：Mach-O 基础常量表与 Apple 头文件一致', () => {
  const f = 're-format-macho/references/layout.md';
  const text = read(f);
  // 旧的错误表述不得复现
  assert.ok(!text.includes('0x0100000B=arm64e'), 'arm64e 的 cputype 不是 0x0100000B');
  assert.ok(!text.includes('0x80000003=x86_64h'), '0x80000003 是 ALL+LIB64 位，不是 x86_64h');
  assert.ok(!/4=TWOLEVEL/.test(text), 'TWOLEVEL 是 0x80 不是 4');
  assert.ok(!/0x800000=LAZY_INIT/.test(text), '0x800000 是 HAS_TLV_DESCRIPTORS');
  assert.ok(!/0x0F=N_UNDF/.test(text), '0x0f = N_SECT|N_EXT');
  assert.ok(!/LE 文件字节 be ba fe ca/.test(text), 'fat 恒为大端，文件开头是 CA FE BA BE');
  assert.ok(!/offset 为 4 字节对齐的绝对文件偏移/.test(text), 'align 是 2 的幂，不是固定 4 字节对齐');
  // 修正后的取值应在文中
  for (const s of ['0x0100000C', 'ARM64E', '0x40', 'TWOLEVEL', '0x800000', 'N_SECT', 'CA FE BA BE', '2 的幂']) {
    assert.ok(text.includes(s), `缺少修正后的表述：${s}`);
  }
});

test('补充 28：udsoncan 示例带 config 的 data_identifiers', () => {
  const f = 're-automotive/SKILL.md';
  const text = read(f);
  assert.ok(text.includes('data_identifiers'), 'DID 解码依赖配置里的 codec 映射');
  assert.ok(text.includes('config=config'), '示例必须把 config 传给 Client');
  assert.ok(!/with Client\(conn, request_timeout=2\) as client/.test(text), '不带 config 的旧示例会解码失败');
});

test('补充 27：re-flutter 的 Dart 格式 magic 是数值不是 ASCII 串', () => {
  const f = 're-flutter/SKILL.md';
  absent(null, f, ['"KERNEL" magic'], 'KERNEL 不是 magic（正确写法是数值 0x90abcdef）');
  present(null, f, ['0x90abcdef'], 'kernel magic 实为该数值');
  present(null, f, ['0xdcdcf5f5'], 'snapshot magic 实为该数值');
  absent(null, f, ["b'SNAPSHOT'"], '快照头里没有 ASCII SNAPSHOT');
  absent(null, f, ['版本串 12B'], '不存在固定 12 字节版本串');
});

test('补充 27：re-flutter 的 Profile 属 AOT 一侧', () => {
  const f = 're-flutter/SKILL.md';
  absent(null, f, ['kernel_blob 只在 debug/Profile 构建存在'], 'Profile 用的是 AOT');
  present(null, f, ['Profile 与 Release 都是 AOT'], '执行模型划分');
});

test('补充 27：不写死 IDA Free 的版本代际', () => {
  const f = 're-analyze/references/preferences.md';
  absent(null, f, ['当前 8.x'], '版本代际会漂移');
});

test('补充 27：mitmproxy 的 Python 下限为 3.12', () => {
  const f = 're-netcap/SKILL.md';
  present(null, f, ['Python >=3.12'], '当前 12.x 的要求');
  absent(null, f, ['（Python 3.10+）'], '旧的 Python 下限');
});

test('补充 27：angr 的 Python 版本矩阵只维护一处（re-angr）', () => {
  const f = 're-exploit/SKILL.md';
  absent(null, f, ['9.x 支持 Python 3.9–3.11'], '与 re-angr 冲突的旧矩阵');
  present(null, f, ['[[re-angr]]'], '指向唯一事实源');
});

test('补充 29：re-apk 的 apktool 版本模型是 3.x 主线 / 2.x 维护线', () => {
  const g = 're-apk/references/gotchas.md';
  present(null, g, ['3.x 为当前主线', '2.x 为维护线'], '版本模型');
  present(null, g, ['--all-src'], '取代 --only-main-classes 的选项');
  present(null, g, ['--aapt'], '3.x 的 aapt2 二进制入口');
  present(null, g, ['Unrecognized option'], '旧短参在 3.x 的失败表现');
  present(null, 're-apk/SKILL.md', ['3.x 为当前主线'], '工具准备段须先定 major version');
});

test('补充 29：apktool 调用行里不得残留 2.x 专有选项', () => {
  // 迁移说明会**刻意引用**旧写法（"--use-aapt2 已移除"），因此只查"像命令一样写出来"的行；
  // 判据是行内出现 apktool d/b 调用，且整行不在迁移语境里。
  const MIGR = /移除|消失|取代|不再|没有|无此|旧写法|过时|改用|2\.x|须写/;
  const BANNED = ['--use-aapt2', '--use-aapt1', '--api-level', '--only-main-classes'];
  const files = ['re-apk/SKILL.md', 're-apk/references/gotchas.md', 're-apk/references/commands.md'];
  const bad = [];
  for (const f of files) {
    for (const l of read(f).split('\n')) {
      if (!/\bapktool\s+[bd]\b/.test(l) || MIGR.test(l)) continue;
      for (const opt of BANNED) if (l.includes(opt)) bad.push(`${f}: ${l.trim().slice(0, 90)}`);
    }
  }
  assert.deepEqual(bad, [], `apktool 调用行里仍有 2.x 专有选项：\n${bad.join('\n')}`);
});

test('补充 29：apktool 的 --api-level 不得写成可用选项', () => {
  const files = ['re-apk/SKILL.md', 're-apk/references/gotchas.md', 're-apk/references/commands.md'];
  const offenders = [];
  for (const f of files) {
    for (const l of read(f).split('\n')) {
      if (l.includes('--api-level') && !/移除|不再|消失|没有|无此|旧写法|过时/.test(l)) {
        offenders.push(`${f}: ${l.trim().slice(0, 90)}`);
      }
    }
  }
  assert.deepEqual(offenders, [], '--api-level 在 apktool 3.x 已移除（API 等级不再由命令行指定）');
});

test('补充 29：不再支持 32 位的表述与 2.x 的 _64 后缀命名一致', () => {
  const g = 're-apk/references/gotchas.md';
  present(null, g, ['32 位'], '3.x 无 32 位产物');
  assert.ok(!/老环境用 `aapt`（34 前默认）.*apktool/.test(read(g)), 'aapt 与 apktool 的版本线不得混写');
});

test('补充 23：re-angr 的 recv hook 返回值是长度不是指针', () => {
  const f = 're-angr/SKILL.md';
  present(null, f, ['ssize_t'], '返回值语义');
  absent(null, f, ['hook 返回符号指针'], '旧写法会把控制流建歪');
});
