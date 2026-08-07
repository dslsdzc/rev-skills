import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFrontmatter, checkSkillDir, collectSkills, SKILL_PREFIX } from '../validate.mjs';

const FIX = new URL('./fixtures/', import.meta.url).pathname;

test('parseFrontmatter 解析合法 frontmatter', () => {
  const md = `---\nname: re-abc\ndescription: 测试。\n---\n\n# 标题\n\n正文`;
  const { name, description, body } = parseFrontmatter(md);
  assert.equal(name, 're-abc');
  assert.equal(description, '测试。');
  assert.match(body, /^# 标题/);
});

test('parseFrontmatter 拒绝缺失 name/description', () => {
  assert.throws(() => parseFrontmatter('---\nname: x\n---\n'), /description/);
  assert.throws(() => parseFrontmatter('# no frontmatter'), /frontmatter/);
});

test('good-skill 通过全部检查', () => {
  const { errors } = checkSkillDir(FIX + 'good-skill');
  assert.deepEqual(errors, []);
});

test('bad-name 报名字不一致错误', () => {
  const { errors } = checkSkillDir(FIX + 'bad-name');
  assert.ok(errors.some(e => e.includes('name') && e.includes('wrong-name')));
});

test('no-tools 叶子技能报缺工具准备', () => {
  const { errors } = checkSkillDir(FIX + 'no-tools');
  assert.ok(errors.some(e => e.includes('工具准备')));
});

test('broken-link 报死链接', () => {
  const { errors } = checkSkillDir(FIX + 'broken-link', { knownSkills: ['re-abc'] });
  assert.ok(errors.some(e => e.includes('re-does-not-exist')));
});

test('collectSkills 收集全部技能目录名', () => {
  const names = collectSkills(FIX);
  assert.deepEqual([...names].sort(), ['bad-name', 'broken-link', 'good-skill', 'no-tools']);
});
