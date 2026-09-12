import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkCapabilityRegistry, checkRoutingCapabilities, checkCapabilityAnnotations } from '../validate.mjs';
import {
  collectRegistryTags, collectDeclaredCapabilities,
  renderCapabilityIndex, checkCapabilityIndex, INDEX_REL,
} from '../lib/capability-index.mjs';

// 造一个最小技能库：注册表两个标签，其中只有 alpha 被技能声明
function fakeRoot({ declareBeta = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'cap-'));
  mkdirSync(join(root, 're-analyze', 'references'), { recursive: true });
  writeFileSync(join(root, 're-analyze', 'references', 'capabilities.md'),
    '# 能力注册表\n\n- `alpha` — 甲能力\n- `beta` — 乙能力\n');
  mkdirSync(join(root, 're-x'), { recursive: true });
  writeFileSync(join(root, 're-x', 'SKILL.md'),
    `---\nname: re-x\ndescription: 甲能力技能。capability skill.\ncapabilities: [alpha${declareBeta ? ', beta' : ''}]\n---\n\n# 标题\n\n## 工具准备\n\n正文\n`);
  return root;
}

test('collectRegistryTags 解析标签与说明', () => {
  const root = fakeRoot();
  try {
    const tags = collectRegistryTags(root);
    assert.equal(tags.size, 2);
    assert.equal(tags.get('alpha'), '甲能力');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('collectDeclaredCapabilities 反查标签 → 技能', () => {
  const root = fakeRoot();
  try {
    const byTag = collectDeclaredCapabilities(root);
    assert.deepEqual([...byTag.keys()], ['alpha']);
    assert.deepEqual(byTag.get('alpha'), ['re-x']);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('悬空标签报错，补齐声明后消失', () => {
  const root = fakeRoot();
  try {
    const errors = checkCapabilityRegistry(root);
    assert.ok(errors.some(e => e.includes('beta') && e.includes('dangling')), '应报 beta 悬空');
    assert.ok(!errors.some(e => e.includes('alpha')), '已声明的标签不应报错');
    // 补声明后不再悬空
    writeFileSync(join(root, 're-x', 'SKILL.md'),
      `---\nname: re-x\ndescription: 甲能力技能。capability skill.\ncapabilities: [alpha, beta]\n---\n\n# 标题\n\n## 工具准备\n\n正文\n`);
    assert.deepEqual(checkCapabilityRegistry(root), []);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('索引缺失 / 过期 / 同步三种状态', () => {
  const root = fakeRoot();
  try {
    // 缺失
    assert.ok(checkCapabilityIndex(root)[0].includes('missing'));
    // 生成后同步
    const content = renderCapabilityIndex(root);
    mkdirSync(join(root, 're-analyze', 'references'), { recursive: true });
    writeFileSync(join(root, INDEX_REL), content);
    assert.deepEqual(checkCapabilityIndex(root), []);
    // 声明变更后未重生成 → 过期
    writeFileSync(join(root, 're-x', 'SKILL.md'),
      `---\nname: re-x\ndescription: 甲能力技能。capability skill.\ncapabilities: [alpha, beta]\n---\n\n# 标题\n\n## 工具准备\n\n正文\n`);
    assert.ok(checkCapabilityIndex(root)[0].includes('out of date'));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('路由能力列与技能声明不一致时报错', () => {
  const root = fakeRoot();
  const routing = (cap) =>
    `| 证据 | 需要能力 | 触发技能 |\n|---|---|---|\n| 看到特征 | \`${cap}\` | re-x |\n`;
  try {
    mkdirSync(join(root, 're-analyze', 'references'), { recursive: true });
    // 一致：alpha 由 re-x 声明
    writeFileSync(join(root, 're-analyze', 'references', 'rerouting.md'), routing('alpha'));
    assert.deepEqual(checkRoutingCapabilities(root), []);
    // 声明缺失：beta 无人声明
    writeFileSync(join(root, 're-analyze', 'references', 'rerouting.md'), routing('beta'));
    assert.ok(checkRoutingCapabilities(root).some(e => e.includes('beta') && e.includes('未声明')));
    // 未注册的标签
    writeFileSync(join(root, 're-analyze', 'references', 'rerouting.md'), routing('nope'));
    assert.ok(checkRoutingCapabilities(root).some(e => e.includes('未注册')));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('选择树缺能力标注 / 标注与声明不符时报错', () => {
  const root = fakeRoot();
  const withTree = (branch) =>
    `---\nname: re-x\ndescription: 甲能力技能。capability skill.\ncapabilities: [alpha]\n---\n\n# 标题\n\n## 工具准备\n\n正文\n\n## 何时用哪个原子技能（选择树）\n\n${branch}\n`;
  const p = join(root, 're-x', 'SKILL.md');
  try {
    // 合规：显式「能力：」前缀且与目标技能声明一致
    writeFileSync(p, withTree('- 分支 → [[re-x]]（能力：`alpha`）'));
    assert.deepEqual(checkCapabilityAnnotations(root), []);
    // 缺标注
    writeFileSync(p, withTree('- 分支 → [[re-x]]'));
    assert.ok(checkCapabilityAnnotations(root).some(e => e.includes('缺少能力标注')));
    // 标注了目标技能未声明（也未注册）的能力
    writeFileSync(p, withTree('- 分支 → [[re-x]]（能力：`beta`）'));
    assert.ok(checkCapabilityAnnotations(root).some(e => e.includes('beta')));
    // 非技能链接（references 文档）不要求标注
    writeFileSync(join(root, 're-analyze', 'references', 'tips.md'), '# 提示\n');
    writeFileSync(p, withTree('- 分支 → [[re-x]]（能力：`alpha`）+ [[tips]]'));
    assert.deepEqual(checkCapabilityAnnotations(root), []);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('索引渲染包含已声明能力与未声明清单', () => {
  const root = fakeRoot();
  try {
    const md = renderCapabilityIndex(root);
    assert.match(md, /\| `alpha` \| 甲能力 \| re-x \|/);
    assert.match(md, /## 尚未被声明（1）/);
    assert.match(md, /- beta — 乙能力/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
