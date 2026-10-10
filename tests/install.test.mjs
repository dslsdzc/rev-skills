import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { planFor, SKILLS_SRC } from '../bin/install.mjs';

const INSTALLER = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'install.mjs');

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

// DSH 技能根：全局 <dshHome>/skills（~/.dsh/skills），项目 .dsh/skills
test('planFor: dsh global 落在 DSH 家目录的技能根', () => {
  const old = process.env.HOME;
  process.env.HOME = '/tmp/fakehome';
  try {
    const plan = planFor('dsh', 'global', {});
    assert.equal(plan.mode, 'native');
    assert.equal(plan.dest, '/tmp/fakehome/.dsh/skills');
    assert.ok(plan.names.includes('re-analyze'));
  } finally {
    process.env.HOME = old;
  }
});

test('planFor: dsh project 落在 .dsh/skills', () => {
  const plan = planFor('dsh', 'project', {});
  assert.equal(plan.mode, 'native');
  assert.equal(plan.dest, '.dsh/skills');
});

// `--target all --global` 跳过只有 --project 的目标；dry-run 保证不落盘。
// 顺带看住自检提示是按目标取词：dsh 给 DSH 口径，claude 保持原样。
test('CLI: --target all --global --dry-run 跳过规则型目标并包含 dsh', () => {
  const out = execFileSync(process.execPath, [INSTALLER, '--target', 'all', '--global', '--dry-run', '--yes'], { encoding: 'utf8' });
  for (const t of ['cline', 'cursor', 'copilot', 'windsurf']) {
    assert.match(out, new RegExp(`\\[${t}\\] skip:`), `${t} 没有全局落点，应被跳过`);
  }
  const count = readdirSync(SKILLS_SRC).length;
  assert.ok(out.includes(`[dsh] plan: ${count} skills`), `dsh 应参与 --target all --global：\n${out}`);
  assert.match(out, /\[dsh\] verify: 技能根 .*\.dsh[\\/]skills；新建会话后 `skill` 工具目录可见/);
  assert.match(out, /\[claude\] verify: Claude Code 中运行 \/skills 查看/);
});

test('CLI: --target dsh --project --dry-run 只打印计划', () => {
  // 在临时目录里跑，避免工作区里已有的 .dsh 让「dry-run 不落盘」这条断言假阴/假阳
  const cwd = mkdtempSync(join(tmpdir(), 'rs-install-'));
  const out = execFileSync(process.execPath, [INSTALLER, '--target', 'dsh', '--project', '--dry-run'], { encoding: 'utf8', cwd });
  assert.match(out, /\[dsh\] plan: \d+ skills → \.dsh[\\/]skills/);
  assert.ok(!existsSync(join(cwd, '.dsh')), 'dry-run 不应创建 .dsh 目录');
});
