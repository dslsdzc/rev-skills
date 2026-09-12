import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { parseFrontmatterFields, splitFrontmatter } from '../lib/frontmatter.mjs';
import { parseFrontmatter } from '../validate.mjs';
import { readSkill } from '../bin/convert.mjs';

const SKILLS = join(dirname(fileURLToPath(import.meta.url)), '..', '.claude', 'skills');

test('折叠块标量 > 合并为单行', () => {
  const md = '---\nname: re-x\ndescription: >\n  第一行\n  第二行\n---\n\n# 体';
  assert.equal(parseFrontmatter(md).description, '第一行 第二行');
});

test('字面块标量 | 保留换行', () => {
  const md = '---\nname: re-x\ndescription: |\n  第一行\n  第二行\n---\n\n# 体';
  assert.equal(parseFrontmatter(md).description, '第一行\n第二行');
});

test('空块标量按缺描述报错（校验不再是空转）', () => {
  assert.throws(() => parseFrontmatter('---\nname: re-x\ndescription: >\n---\n\n# 体'), /description/);
});

test('块标量吸收缩进行，不吞并下一个同级键', () => {
  const fm = parseFrontmatterFields('description: >\n  正文\n  body\ncapabilities: [a, b]');
  assert.equal(fm.description, '正文 body');
  assert.equal(fm.capabilities, '[a, b]');
});

test('splitFrontmatter 缺 frontmatter 报错并保留正文', () => {
  assert.throws(() => splitFrontmatter('# 无 frontmatter'), /frontmatter/);
  assert.equal(splitFrontmatter('---\na: b\n---\n\n正文').body, '正文');
});

test('validate 与 convert 对全部技能解析一致（防解析器漂移回归）', () => {
  const dirs = readdirSync(SKILLS).filter(d => d.startsWith('re-'));
  assert.ok(dirs.length >= 46, '技能目录数异常');
  for (const name of dirs) {
    const dir = join(SKILLS, name);
    const md = readFileSync(join(dir, 'SKILL.md'), 'utf8');
    const v = parseFrontmatter(md);
    const c = readSkill(dir);
    assert.equal(v.name, c.name, `${name}: name 不一致`);
    assert.equal(v.description, c.description, `${name}: description 不一致`);
    assert.equal(v.body, c.body, `${name}: body 不一致`);
    assert.ok(v.description.trim().length > 0, `${name}: description 解析为空`);
  }
});
