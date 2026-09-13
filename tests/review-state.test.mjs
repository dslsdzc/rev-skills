import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hashSkill, computeStatus, markReviewed, skillDirs } from '../lib/review-state.mjs';

function fakeRepo({ reviewed = [], date = '2026-01-01' } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'rs-'));
  mkdirSync(join(root, 'docs', 'audit'), { recursive: true });
  mkdirSync(join(root, '.claude', 'skills', 're-a'), { recursive: true });
  mkdirSync(join(root, '.claude', 'skills', 're-b'), { recursive: true });
  writeFileSync(join(root, '.claude', 'skills', 're-a', 'SKILL.md'), '# a\n');
  writeFileSync(join(root, '.claude', 'skills', 're-b', 'SKILL.md'), '# b\n');
  if (reviewed.length) markReviewed(root, join(root, '.claude', 'skills'), reviewed, { date });
  return root;
}

test('hashSkill 随内容变化，且与文件顺序无关', () => {
  const root = fakeRepo();
  const dir = join(root, '.claude', 'skills', 're-a');
  const h1 = hashSkill(dir);
  writeFileSync(join(dir, 'SKILL.md'), '# a changed\n');
  const h2 = hashSkill(dir);
  assert.notEqual(h1, h2);
  rmSync(root, { recursive: true, force: true });
});

test('computeStatus：未复核 / 已复核未变 / 内容又变 三态', () => {
  const root = fakeRepo({ reviewed: ['re-a'] });
  const skills = join(root, '.claude', 'skills');
  let s = computeStatus(root, skills);
  assert.deepEqual(s.ok.map((x) => x.name), ['re-a']);
  assert.deepEqual(s.unreviewed.map((x) => x.name), ['re-b']);

  writeFileSync(join(skills, 're-a', 'SKILL.md'), '# a v2\n');
  s = computeStatus(root, skills);
  assert.deepEqual(s.changed.map((x) => x.name), ['re-a']);
  assert.equal(s.ok.length, 0);
  rmSync(root, { recursive: true, force: true });
});

test('markReviewed 回填后转为"已复核未变"', () => {
  const root = fakeRepo();
  const skills = join(root, '.claude', 'skills');
  markReviewed(root, skills, ['re-a', 're-b'], { date: '2026-09-13' });
  const s = computeStatus(root, skills);
  assert.equal(s.ok.length, 2);
  assert.equal(s.unreviewed.length, 0);
  rmSync(root, { recursive: true, force: true });
});

test('markReviewed 拒绝未知技能', () => {
  const root = fakeRepo();
  assert.throws(() => markReviewed(root, join(root, '.claude', 'skills'), ['re-nope']), /未知技能/);
  rmSync(root, { recursive: true, force: true });
});

test('已删除技能会从状态里清理并在 status 中报警', () => {
  const root = fakeRepo({ reviewed: ['re-a', 're-b'] });
  const skills = join(root, '.claude', 'skills');
  rmSync(join(skills, 're-b'), { recursive: true, force: true });
  const s = computeStatus(root, skills);
  assert.deepEqual(s.unknown, ['re-b']);
  markReviewed(root, skills, ['re-a'], { date: '2026-09-14' });
  assert.deepEqual(computeStatus(root, skills).unknown, []);
  rmSync(root, { recursive: true, force: true });
});

test('仓库自身：状态文件覆盖全部技能（无缺失、无多余）', () => {
  const names = skillDirs('.claude/skills');
  const { unreviewed, ok, changed, unknown } = computeStatus('.', '.claude/skills');
  assert.deepEqual(unknown, [], '状态里有已不存在的技能');
  assert.equal(unreviewed.length + ok.length + changed.length, names.length);
});
