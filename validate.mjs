#!/usr/bin/env node
// validate.mjs — 技能库结构校验器。npm test 与 CI 入口。
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SKILL_PREFIX = 're-';
const HERE = dirname(fileURLToPath(import.meta.url));

export function parseFrontmatter(md) {
  const m = md.match(/^---\n([\s\S]*?)\n---\n*([\s\S]*)$/);
  if (!m) throw new Error('missing frontmatter');
  const fm = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^(\w+):\s*(.*)$/);
    if (kv) fm[kv[1]] = kv[2];
  }
  if (!fm.name) throw new Error('frontmatter missing name');
  if (!fm.description) throw new Error('frontmatter missing description');
  // capabilities: [a, b] YAML list → 数组；无字段 → undefined
  if (fm.capabilities !== undefined) {
    const m2 = fm.capabilities.match(/^\[\s*([a-z0-9-]+(?:\s*,\s*[a-z0-9-]+)*)\s*\]$/);
    fm.capabilities = m2 ? m2[1].split(',').map(s => s.trim()) : null; // null = 非法写法
  }
  // guard: {"require_authorization": true, "forbidden": ["tag1", "tag2"]} — 机器可读安全前置声明（JSON 格式）
  if (fm.guard !== undefined) {
    try { fm.guard = JSON.parse(fm.guard); }
    catch { fm.guard = null; } // null = 非法 JSON
  }
  return { name: fm.name, description: fm.description, type: fm.type, capabilities: fm.capabilities, guard: fm.guard, body: m[2] };
}

// 从能力注册表（re-analyze/references/capabilities.md）解析合法标签清单
export function collectCapabilities(root) {
  const p = join(root, 're-analyze', 'references', 'capabilities.md');
  if (!existsSync(p)) return new Set();
  const text = readFileSync(p, 'utf8');
  const set = new Set();
  for (const line of text.split('\n')) {
    const m = line.match(/^-\s+`([a-z0-9-]+)`/);
    if (m) set.add(m[1]);
  }
  return set;
}

export function isLeafSkill(dir) {
  return !readdirSync(dir, { withFileTypes: true })
    .some(e => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'references');
}

export function collectSkills(root) {
  return readdirSync(root, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => e.name);
}

// references/*.md 文件名（去扩展名）也作为合法 [[链接]] 目标，如 [[platform-tips]]
export function collectReferences(root) {
  const refs = new Set();
  for (const dir of readdirSync(root, { withFileTypes: true })) {
    if (!dir.isDirectory() || !dir.name.startsWith(SKILL_PREFIX)) continue;
    const refDir = join(root, dir.name, 'references');
    if (!existsSync(refDir)) continue;
    for (const f of readdirSync(refDir)) {
      if (f.endsWith('.md')) refs.add(f.replace(/\.md$/, ''));
    }
  }
  return refs;
}

export function checkSkillDir(dir, opts = {}) {
  const errors = [];
  const name = dir.split(/[\\/]/).pop();
  const mdPath = join(dir, 'SKILL.md');
  if (!existsSync(mdPath)) { errors.push(`SKILL.md missing in ${name}`); return { errors }; }
  let fm;
  try { fm = parseFrontmatter(readFileSync(mdPath, 'utf8')); }
  catch (e) { errors.push(`${name}: ${e.message}`); return { errors }; }
  if (fm.name !== name) errors.push(`${name}: frontmatter name '${fm.name}' != dir name`);
  if (!fm.description.trim()) errors.push(`${name}: empty description`);
  // 工具准备检查：仅原子技能（无 type 或 type: atomic）且为叶子。入口(type: entry)/网关(type: gateway)豁免
  const type = fm.type ?? 'atomic';
  if (type === 'atomic' && isLeafSkill(dir) && !fm.body.includes('## 工具准备')) {
    errors.push(`${name}: atomic skill missing '## 工具准备' section`);
  }
  if (!['atomic', 'entry', 'gateway'].includes(type)) errors.push(`${name}: invalid type '${type}' (atomic/entry/gateway)`);
  // capabilities 校验：有字段时必须是非空 list 且值都在注册表内
  if (fm.capabilities !== undefined) {
    const caps = opts.knownCapabilities ?? new Set();
    if (fm.capabilities === null || fm.capabilities.length === 0) {
      errors.push(`${name}: capabilities must be a non-empty list like [tag1, tag2]`);
    } else {
      for (const c of fm.capabilities) {
        if (!caps.has(c)) errors.push(`${name}: unknown capability '${c}' (see re-analyze/references/capabilities.md)`);
      }
    }
  }
  // guard 校验：有字段时必须是 {"require_authorization": bool, "forbidden": [tags]} 结构
  if (fm.guard !== undefined) {
    if (fm.guard === null || typeof fm.guard !== 'object' || Array.isArray(fm.guard)
        || typeof fm.guard.require_authorization !== 'boolean'
        || !Array.isArray(fm.guard.forbidden) || fm.guard.forbidden.some(t => typeof t !== 'string' || !t)) {
      errors.push(`${name}: guard must be {"require_authorization": bool, "forbidden": [tags]}`);
    }
  }
  const known = new Set(opts.knownSkills ?? []);
  for (const link of fm.body.matchAll(/\[\[([a-z0-9-]+)\]\]/g)) {
    if (!known.has(link[1]) && !(opts.knownRefs?.has(link[1]))) {
      errors.push(`${name}: broken [[${link[1]}]] link`);
    }
  }
  return { errors, name };
}

function main() {
  const root = join(HERE, '.claude', 'skills');
  if (!existsSync(root)) { console.error(`skills dir not found: ${root}`); process.exit(1); }
  const known = collectSkills(root);
  const knownRefs = collectReferences(root);
  const knownCapabilities = collectCapabilities(root);
  let failed = 0;
  for (const dir of readdirSync(root, { withFileTypes: true })) {
    if (!dir.isDirectory() || !dir.name.startsWith(SKILL_PREFIX)) continue;
    const { errors } = checkSkillDir(join(root, dir.name), { knownSkills: known, knownRefs, knownCapabilities });
    for (const e of errors) { console.error(`FAIL: ${e}`); failed++; }
  }
  if (failed) { console.error(`${failed} problem(s) found`); process.exit(1); }
  console.log(`OK: ${known.length} skills validated`);
}

if (process.argv[1] && process.argv[1].endsWith('validate.mjs')) main();
