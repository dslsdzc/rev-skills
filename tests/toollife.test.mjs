import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractCommands, checkRegister, daysSince } from '../lib/tool-register.mjs';

test('extractCommands 只认 shell 标注块，未标注块不误抓', () => {
  const md = [
    '```sh',
    'readelf -h a.out',
    'sudo tshark -i eth0',
    '```',
    '',
    '```python',
    'import onnx',
    'print("hi")',
    '```',
    '',
    '```',
    'import struct',
    'Def = 1',
    '```',
  ].join('\n');
  const cmds = extractCommands(md);
  assert.deepEqual(cmds, ['readelf', 'tshark']);
});

test('extractCommands 跳过 heredoc 体、注释与 shell 关键字', () => {
  const md = [
    '```bash',
    '# comment',
    'cat > x.txt <<EOF',
    'readelf notacommand',
    'EOF',
    'for i in 1 2; do echo $i; done',
    'objdump -d a.out',
    '```',
  ].join('\n');
  assert.deepEqual(extractCommands(md), ['objdump']);
});

test('extractCommands 去掉环境变量前缀与提示符', () => {
  const md = '```console\n$ FOO=1 gdb ./a.out\n> otool -l x\n```\n';
  assert.deepEqual(extractCommands(md), ['gdb', 'otool']);
});

test('extractCommands 过滤基础工具（不登记 coreutils/包管理器）', () => {
  const md = '```sh\nls -l\ncat f\napt install x\ngit log\n```\n';
  assert.deepEqual(extractCommands(md), []);
});

// 造一个最小仓库：一个技能引用 readelf，登记表内容由参数决定
function fakeRepo({ register }) {
  const root = mkdtempSync(join(tmpdir(), 'toollife-'));
  mkdirSync(join(root, 'docs', 'audit'), { recursive: true });
  mkdirSync(join(root, '.claude', 'skills', 're-x'), { recursive: true });
  writeFileSync(join(root, '.claude', 'skills', 're-x', 'SKILL.md'),
    '---\nname: re-x\ndescription: 测试技能。test skill.\ncapabilities: [kernel-analysis]\n---\n\n# t\n\n```sh\nreadelf -h a\n```\n');
  writeFileSync(join(root, 'docs', 'audit', 'tool-register.json'), JSON.stringify(register, null, 2));
  return root;
}

test('死条目报错：登记在用但技能里已找不到', () => {
  const root = fakeRepo({ register: { tools: [{ name: 'objdump', kind: 'cli', where: ['re-x'], last_verified: null, source: '' }] } });
  const { errors, candidates } = checkRegister(root, join(root, '.claude', 'skills'));
  assert.ok(errors.some((e) => e.includes('死条目')));
  assert.deepEqual(candidates, ['readelf']);
  rmSync(root, { recursive: true, force: true });
});

test('登记齐备时无错，且 ignore 名单内的候选不报', () => {
  const root = fakeRepo({
    register: {
      tools: [{ name: 'readelf', kind: 'cli', where: ['re-x'], last_verified: '2026-09-13', source: 'man page' }],
      ignore: [],
    },
  });
  const { errors, candidates } = checkRegister(root, join(root, '.claude', 'skills'));
  assert.deepEqual(errors, []);
  assert.deepEqual(candidates, []);
  rmSync(root, { recursive: true, force: true });
});

test('last_verified 允许 null（待核验积压），但非法日期报错', () => {
  const ok = fakeRepo({ register: { tools: [{ name: 'readelf', kind: 'cli', where: [], last_verified: null, source: '' }] } });
  assert.deepEqual(checkRegister(ok, join(ok, '.claude', 'skills')).errors, []);
  rmSync(ok, { recursive: true, force: true });

  const bad = fakeRepo({ register: { tools: [{ name: 'readelf', kind: 'cli', where: [], last_verified: '2026/09/13', source: '' }] } });
  assert.ok(checkRegister(bad, join(bad, '.claude', 'skills')).errors.some((e) => e.includes('last_verified')));
  rmSync(bad, { recursive: true, force: true });
});

test('时效：只统计已核验的超期项，未核验的进积压', () => {
  const root = fakeRepo({
    register: {
      tools: [
        { name: 'readelf', kind: 'cli', where: ['re-x'], last_verified: '2020-01-01', source: 'x' },
        { name: 'objdump', kind: 'cli', where: [], last_verified: null, source: '' },
      ],
      ignore: [],
    },
  });
  const { stale, pending } = checkRegister(root, join(root, '.claude', 'skills'), { staleDays: 180 });
  assert.deepEqual(stale.map((s) => s.name), ['readelf']);
  assert.deepEqual(pending, ['objdump']);
  rmSync(root, { recursive: true, force: true });
});

test('仓库自身的登记表一致（无死条目、无未登记候选）', () => {
  const { errors, candidates } = checkRegister('.', '.claude/skills');
  assert.deepEqual(errors, []);
  assert.deepEqual(candidates, [], `未登记候选：${candidates.join(' ')}`);
});

test('daysSince 对非法日期返回 Infinity', () => {
  assert.equal(daysSince('not-a-date'), Infinity);
  assert.ok(daysSince('2026-09-13') >= 0);
});
