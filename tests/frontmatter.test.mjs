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

test('顶格游离行报错，不静默丢弃（块标量误写列表项回归）', () => {
  // 行号以 frontmatter 块内 1-based 计（对应 SKILL.md 文件行号 +1，块首为文件第 2 行）
  const md = '---\nname: re-x\ndescription: >\n  正文\n- 游离行\n  触发词：x\n---\n\n# 体';
  assert.throws(() => parseFrontmatter(md), /unparsable frontmatter line 4.*游离行/);
});

test('re-mobile description 覆盖块标量全部续行（截断回归）', () => {
  const md = readFileSync(join(SKILLS, 're-mobile', 'SKILL.md'), 'utf8');
  assert.match(parseFrontmatter(md).description, /加密体系审计/);
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

test('frontmatter 键接受连字符（DSH 的 disable-model-invocation / user-invocable）', () => {
  // 键文法若只认 \w+，这两个 DSH 合法键会被当成顶格游离行而整份技能报错。
  const fm = parseFrontmatterFields('name: re-x\ndescription: d\ndisable-model-invocation: false\nuser-invocable: true');
  assert.equal(fm.name, 're-x');
  assert.equal(fm['disable-model-invocation'], 'false');
  assert.equal(fm['user-invocable'], 'true');
});

test('CRLF 检出解析结果与 LF 一致（Windows 行尾回归）', () => {
  // Windows 上 core.autocrlf=true 的检出会把提交时的 LF 变成 CRLF；
  // 若不归一，分界正则不匹配 → 整库报 missing frontmatter，能力注册表也解析失败。
  const lf = '---\nname: re-x\ndescription: >\n  第一行\n  第二行\ncapabilities: [a, b]\n---\n\n# 体';
  const crlf = lf.replace(/\n/g, '\r\n');
  assert.equal(parseFrontmatter(crlf).description, parseFrontmatter(lf).description);
  assert.equal(parseFrontmatter(crlf).body, parseFrontmatter(lf).body);
  assert.deepEqual(parseFrontmatterFields(splitFrontmatter(crlf).raw), parseFrontmatterFields(splitFrontmatter(lf).raw));
  assert.equal(splitFrontmatter(crlf).body, '# 体');
  // 单个 CR 行尾（旧 Mac 风格）同样归一
  assert.equal(parseFrontmatter(lf.replace(/\n/g, '\r')).name, 're-x');
});
