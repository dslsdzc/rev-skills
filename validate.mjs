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
  return { name: fm.name, description: fm.description, type: fm.type, body: m[2] };
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
  let failed = 0;
  for (const dir of readdirSync(root, { withFileTypes: true })) {
    if (!dir.isDirectory() || !dir.name.startsWith(SKILL_PREFIX)) continue;
    const { errors } = checkSkillDir(join(root, dir.name), { knownSkills: known, knownRefs });
    for (const e of errors) { console.error(`FAIL: ${e}`); failed++; }
  }
  if (failed) { console.error(`${failed} problem(s) found`); process.exit(1); }
  console.log(`OK: ${known.length} skills validated`);
}

if (process.argv[1] && process.argv[1].endsWith('validate.mjs')) main();
