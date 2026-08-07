import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSkill, convertAll } from '../bin/convert.mjs';

const SKILLS = join(dirname(fileURLToPath(import.meta.url)), '..', '.claude', 'skills');

test('readSkill 解析 frontmatter', () => {
  const s = readSkill(join(SKILLS, 're-analyze'));
  assert.equal(s.name, 're-analyze');
  assert.ok(s.description.length > 10);
  assert.match(s.body, /##/);
});

test('convertAll cursor 生成 .mdc 且带 description 头', () => {
  const out = mkdtempSync(join(tmpdir(), 'rs-cursor-'));
  const files = convertAll('cursor', out);
  const names = readdirSync(out);
  assert.ok(names.includes('re-analyze.mdc'));
  assert.match(readFileSync(join(out, 're-analyze.mdc'), 'utf8'), /^---\ndescription: /);
  assert.ok(files.length >= 46);
});

test('convertAll copilot 聚合为单文件', () => {
  const out = mkdtempSync(join(tmpdir(), 'rs-copilot-'));
  convertAll('copilot', out);
  const p = join(out, 'copilot-instructions.md');
  assert.ok(existsSync(p));
  const txt = readFileSync(p, 'utf8');
  assert.match(txt, /## re-analyze/);
  assert.match(txt, /## re-z3/);
});

test('convertAll windsurf 每技能一文件', () => {
  const out = mkdtempSync(join(tmpdir(), 'rs-ws-'));
  convertAll('windsurf', out);
  assert.ok(existsSync(join(out, 're-triage.md')));
});
