import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseFrontmatter, checkSkillDir, collectSkills, SKILL_PREFIX } from '../validate.mjs';

// Windows 下 URL.pathname 产出 /D:/... 形式，不能直接当本地路径；用 fileURLToPath 统一转换
const FIX = fileURLToPath(new URL('./fixtures/', import.meta.url));

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

// 校验用例共用的能力注册表子集（原子技能必须声明能力，声明值须在注册表内）
const CAPS = { knownCapabilities: new Set(['triage']) };

test('good-skill 通过全部检查', () => {
  const { errors } = checkSkillDir(FIX + 'good-skill', CAPS);
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

test('broken-link 报死链接但放行 references 链接', () => {
  const { errors } = checkSkillDir(FIX + 'broken-link', {
    knownSkills: ['re-abc'],
    knownRefs: new Set(['platform-tips']),
  });
  assert.ok(errors.some(e => e.includes('re-does-not-exist')));
  assert.ok(!errors.some(e => e.includes('platform-tips')));
});

test('gateway-skill 豁免工具准备检查', () => {
  const { errors } = checkSkillDir(FIX + 'gateway-skill');
  assert.ok(!errors.some(e => e.includes('工具准备')));
});

test('collectSkills 收集全部技能目录名', () => {
  const names = collectSkills(FIX);
  assert.deepEqual([...names].sort(), ['bad-name', 'broken-link', 'gateway-skill', 'good-skill', 'no-tools']);
});

test('parseFrontmatter 解析 capabilities list', () => {
  const md = `---\nname: re-abc\ndescription: 测试。\ncapabilities: [elf-parser, unpack]\n---\n\n# 标题\n\n正文`;
  const { capabilities } = parseFrontmatter(md);
  assert.deepEqual(capabilities, ['elf-parser', 'unpack']);
});

test('guard 合法 JSON 通过、结构非法报错', () => {
  const dir = mkdtempSync(join(tmpdir(), 'guard-test-'));
  const name = dir.split(/[\\/]/).pop();
  const body = `---\nname: ${name}\ndescription: 测试。test。\ncapabilities: [triage]\nguard: %GUARD%\n---\n\n# 标题\n\n## 工具准备\n\n正文`;
  try {
    // 合法
    writeFileSync(join(dir, 'SKILL.md'), body.replace('%GUARD%', '{"require_authorization": true, "forbidden": ["unauthorized_api_testing"]}'));
    assert.deepEqual(checkSkillDir(dir, CAPS).errors, []);
    // 非 JSON
    writeFileSync(join(dir, 'SKILL.md'), body.replace('%GUARD%', 'require_authorization: true'));
    const { errors } = checkSkillDir(dir, CAPS);
    assert.ok(errors.some(e => e.includes('guard must be')));
    // 结构缺字段
    writeFileSync(join(dir, 'SKILL.md'), body.replace('%GUARD%', '{"require_authorization": "yes"}'));
    const { errors: e2 } = checkSkillDir(dir, CAPS);
    assert.ok(e2.some(e => e.includes('guard must be')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('description 须中英双含（触发词约定）', () => {
  const dir = mkdtempSync(join(tmpdir(), 'desc-i18n-'));
  const name = dir.split(/[\\/]/).pop();
  const withDesc = (d) => `---\nname: ${name}\ndescription: ${d}\ncapabilities: [triage]\n---\n\n# 标题\n\n## 工具准备\n\n正文`;
  try {
    // 双语俱全 → 通过
    writeFileSync(join(dir, 'SKILL.md'), withDesc('测试技能：test skill 触发词'));
    assert.deepEqual(checkSkillDir(dir, CAPS).errors, []);
    // 仅中文 → 报错（英文环境命中不了）
    writeFileSync(join(dir, 'SKILL.md'), withDesc('只有中文触发词'));
    assert.ok(checkSkillDir(dir, CAPS).errors.some(e => e.includes('CJK')));
    // 仅英文 → 报错
    writeFileSync(join(dir, 'SKILL.md'), withDesc('english triggers only'));
    assert.ok(checkSkillDir(dir, CAPS).errors.some(e => e.includes('CJK')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('原子技能未声明能力即报错（能力层完整性）', () => {
  const dir = mkdtempSync(join(tmpdir(), 'no-caps-'));
  const name = dir.split(/[\\/]/).pop();
  try {
    writeFileSync(join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: 测试。test。\n---\n\n# 标题\n\n## 工具准备\n\n正文`);
    assert.ok(checkSkillDir(dir, CAPS).errors.some(e => e.includes('must declare capabilities')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('capabilities 合法通过、未知标签与非法写法报错', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cap-test-'));
  const name = dir.split(/[\\/]/).pop();
  const caps = new Set(['elf-parser', 'unpack', 'tracing']);
  const body = `---\nname: ${name}\ndescription: 测试。test。\ncapabilities: %CAPS%\n---\n\n# 标题\n\n## 工具准备\n\n正文`;
  try {
    // 合法 list 通过
    writeFileSync(join(dir, 'SKILL.md'), body.replace('%CAPS%', '[elf-parser, unpack]'));
    assert.deepEqual(checkSkillDir(dir, { knownCapabilities: caps }).errors, []);
    // 未知标签报错
    writeFileSync(join(dir, 'SKILL.md'), body.replace('%CAPS%', '[elf-parser, nope-cap]'));
    const { errors } = checkSkillDir(dir, { knownCapabilities: caps });
    assert.ok(errors.some(e => e.includes("unknown capability 'nope-cap'")));
    // 非法写法（非 list）报错
    writeFileSync(join(dir, 'SKILL.md'), body.replace('%CAPS%', 'elf-parser'));
    const { errors: e2 } = checkSkillDir(dir, { knownCapabilities: caps });
    assert.ok(e2.some(e => e.includes('non-empty list')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
