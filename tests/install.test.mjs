import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { planFor, SKILLS_SRC } from '../bin/install.mjs';

test('planFor: claude global 使用 HOME 展开', () => {
  const old = process.env.HOME;
  process.env.HOME = '/tmp/fakehome';
  const plan = planFor('claude', 'global', {});
  assert.equal(plan.dest, '/tmp/fakehome/.claude/skills');
  assert.equal(plan.mode, 'native');
  process.env.HOME = old;
});

test('planFor: cursor 是 rule 模式', () => {
  const plan = planFor('cursor', 'project', {});
  assert.equal(plan.mode, 'rule');
  assert.equal(plan.ruleType, 'cursor');
});

test('planFor: cline 不支持 --global', () => {
  assert.throws(() => planFor('cline', 'global', {}), /does not support/);
});

test('SKILLS_SRC 存在且含 re- 技能', () => {
  const names = readdirSync(SKILLS_SRC);
  assert.ok(names.includes('re-analyze'));
  assert.ok(names.length >= 46);
});
