// lib/capability-index.mjs — 能力层闭环：索引生成与完整性检查
//
// 能力层设计（re-analyze/references/capabilities.md）：技能声明 capabilities → 路由按能力匹配。
// 本模块是「声明」与「消费」之间的那一环，产出能力 → 技能索引（路由/检索的查询表），
// 并提供两条完整性检查，防止能力层停留在"只写不读"的状态：
//   1) 注册表标签悬空——注册表里有、没有任何技能声明
//   2) 索引过期——声明变更后未重新生成（`node bin/capindex.mjs`）
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseFrontmatterDocument } from './frontmatter.mjs';

export const INDEX_REL = 're-analyze/references/capability-index.md';
const REGISTRY_REL = 're-analyze/references/capabilities.md';
const SKILL_PREFIX = 're-';
// 机器生成文件头——含生成命令与用途，避免被当作手写文档维护
const HEADER = `# 能力索引（机器生成，勿手改）

> 生成：\`node bin/capindex.mjs\`｜校验：\`npm test\`（过期即失败）
> 用途：路由与检索按能力反查技能——能力层的查询表（声明侧见 capabilities.md）
`;

// 注册表标签 → 一行说明
export function collectRegistryTags(root) {
  const p = join(root, REGISTRY_REL);
  if (!existsSync(p)) return new Map();
  const map = new Map();
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^\-\s+`([a-z0-9-]+)`\s+—\s+(.*)$/);
    if (m) map.set(m[1], m[2].trim());
  }
  return map;
}

// 各技能声明的能力：tag → [技能名]（非法写法在此跳过，由 validate 逐技能报错）
export function collectDeclaredCapabilities(root) {
  const byTag = new Map();
  for (const dir of readdirSync(root, { withFileTypes: true })) {
    if (!dir.isDirectory() || !dir.name.startsWith(SKILL_PREFIX)) continue;
    const p = join(root, dir.name, 'SKILL.md');
    if (!existsSync(p)) continue;
    let value;
    try {
      value = parseFrontmatterDocument(readFileSync(p, 'utf8')).fm.capabilities;
    } catch {
      continue;
    }
    if (value === undefined) continue;
    const m = String(value).match(/^\[\s*([a-z0-9-]+(?:\s*,\s*[a-z0-9-]+)*)\s*\]$/);
    if (!m) continue;
    for (const tag of m[1].split(',').map(s => s.trim())) {
      byTag.set(tag, [...(byTag.get(tag) ?? []), dir.name]);
    }
  }
  return byTag;
}

// 渲染索引全文（生成与校验共用同一函数，保证比较的是同一事实）
export function renderCapabilityIndex(root) {
  const declared = collectDeclaredCapabilities(root);
  const registry = collectRegistryTags(root);
  const tags = [...declared.keys()].sort();
  const missing = [...registry.keys()].filter(t => !declared.has(t)).sort();
  // 覆盖率看板：标签覆盖（注册表自洽）与技能覆盖（渐进标注进度）分开计
  const declaredSkills = new Set([...declared.values()].flat());
  const totalSkills = readdirSync(root, { withFileTypes: true })
    .filter(d => d.isDirectory() && d.name.startsWith(SKILL_PREFIX) && existsSync(join(root, d.name, 'SKILL.md'))).length;
  const out = [HEADER];
  out.push(`## 已声明能力（标签 ${tags.length}/${registry.size}｜技能 ${declaredSkills.size}/${totalSkills}）\n`);
  out.push('| 能力 | 说明 | 提供技能 |');
  out.push('|---|---|---|');
  for (const t of tags) {
    out.push(`| \`${t}\` | ${registry.get(t) ?? '（不在注册表）'} | ${[...declared.get(t)].sort().join(', ')} |`);
  }
  out.push(`\n## 尚未被声明（${missing.length}）\n`);
  out.push(missing.length
    ? missing.map(t => `- ${t} — ${registry.get(t)}`).join('\n')
    : '（无——注册表标签全部有技能声明）');
  out.push('');
  return out.join('\n');
}

// 索引缺失或与当前声明不一致 → 报错（提示重新生成）
export function checkCapabilityIndex(root) {
  const p = join(root, INDEX_REL);
  if (!existsSync(p)) return [`capability index missing: ${INDEX_REL}（运行 node bin/capindex.mjs）`];
  if (readFileSync(p, 'utf8') !== renderCapabilityIndex(root)) {
    return [`capability index out of date: ${INDEX_REL}（运行 node bin/capindex.mjs）`];
  }
  return [];
}
