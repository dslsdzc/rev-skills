import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dedent, splitHeredocs, normalizeShell, checkExamples, available, collectExamples } from '../lib/skill-examples.mjs';

test('dedent 去掉列表项缩进', () => {
  assert.equal(dedent('    a\n      b\n'), 'a\n  b\n');
});

test('splitHeredocs：python heredoc 体被拆出，shell 部分保留', () => {
  const { shell, heredocs } = splitHeredocs([
    'python3 - <<PY',
    'import onnx',
    'print(1)',
    'PY',
    'echo done',
  ].join('\n'));
  assert.equal(heredocs.length, 1);
  assert.equal(heredocs[0].lang, 'python');
  assert.match(heredocs[0].body, /import onnx/);
  assert.match(shell, /echo done/);
  assert.doesNotMatch(shell, /import onnx/);
});

test('normalizeShell：占位符中和（含带空格的形式）', () => {
  assert.match(normalizeShell('gcore -o out <pid>\n'), /PLACEHOLDER/);
  assert.match(normalizeShell('python3 dump.py <BundleID 或 App 名>\n'), /PLACEHOLDER/);
});

test('normalizeShell：会话记录块丢弃提示符行', () => {
  const transcript = ['jdb -classpath app.jar com.example.Main', '> stop in Foo.bar', '> print key'].join('\n');
  const out = normalizeShell(transcript);
  assert.match(out, /^jdb /);
  assert.doesNotMatch(out, /stop in/);
});

test('normalizeShell：匿名调试器提示符（无启动行）也不进 shell 检查', () => {
  const out = normalizeShell('(gdb) set disable-randomization on\n(gdb) b main\n');
  assert.doesNotMatch(out, /disable-randomization/);
});

const SHA = available();
function fakeSkill(body) {
  const root = mkdtempSync(join(tmpdir(), 'ex-'));
  const dir = join(root, 're-x');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SKILL.md'), body);
  return root;
}

test('checkExamples 报出 python 语法错', { skip: !SHA.python }, () => {
  const root = fakeSkill('```python\nsimgr.explore(find=0x4011xx, avoid=[])\n```\n');
  const { errors } = checkExamples(root);
  assert.equal(errors.length, 1);
  assert.match(errors[0].msg, /hexadecimal|invalid/i);
  rmSync(root, { recursive: true, force: true });
});

test('checkExamples 不误报带占位符的 shell 块', { skip: !SHA.shell }, () => {
  const root = fakeSkill('```sh\nvol -f dump.raw windows.dlllist -p <pid>\n```\n');
  const { errors } = checkExamples(root);
  assert.deepEqual(errors, []);
  rmSync(root, { recursive: true, force: true });
});

test('checkExamples 检查 sh 块里嵌的 python heredoc', { skip: !SHA.python }, () => {
  const root = fakeSkill('```sh\npython3 - <<PY\nx = 0x1234xx\nPY\n```\n');
  const { errors } = checkExamples(root);
  assert.equal(errors.length, 1);
  assert.match(errors[0].msg, /^heredoc:/);
  rmSync(root, { recursive: true, force: true });
});

test('collectExamples 收集技能下的全部 md（含 references）', () => {
  const root = fakeSkill('# x\n');
  mkdirSync(join(root, 're-x', 'references'), { recursive: true });
  writeFileSync(join(root, 're-x', 'references', 'a.md'), '```sh\necho hi\n```\n');
  const blocks = collectExamples(root);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].skill, 're-x');
  rmSync(root, { recursive: true, force: true });
});

test('仓库自身示例语法通过（有解释器时才跑）', { skip: !(SHA.python && SHA.shell) }, () => {
  const { errors, checked } = checkExamples('.claude/skills');
  assert.ok(checked > 100, `检查块数偏少：${checked}`);
  assert.deepEqual(errors, [], `示例语法错误：\n${errors.map((e) => `${e.file}:${e.line} ${e.msg}`).join('\n')}`);
});
