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
  return { name: fm.name, description: fm.description, body: m[2] };
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
  if (isLeafSkill(dir) && !fm.body.includes('## 工具准备')) errors.push(`${name}: leaf skill missing '## 工具准备' section`);
  const known = new Set(opts.knownSkills ?? []);
  for (const link of fm.body.matchAll(/\[\[([a-z0-9-]+)\]\]/g)) {
    if (!known.has(link[1])) errors.push(`${name}: broken [[${link[1]}]] link`);
  }
  return { errors, name };
}

function main() {
  const root = join(HERE, '.claude', 'skills');
  if (!existsSync(root)) { console.error(`skills dir not found: ${root}`); process.exit(1); }
  const known = collectSkills(root);
  let failed = 0;
  for (const dir of readdirSync(root, { withFileTypes: true })) {
    if (!dir.isDirectory() || !dir.name.startsWith(SKILL_PREFIX)) continue;
    const { errors } = checkSkillDir(join(root, dir.name), { knownSkills: known });
    for (const e of errors) { console.error(`FAIL: ${e}`); failed++; }
  }
  if (failed) { console.error(`${failed} problem(s) found`); process.exit(1); }
  console.log(`OK: ${known.length} skills validated`);
}

if (process.argv[1] && process.argv[1].endsWith('validate.mjs')) main();
