#!/usr/bin/env node
// validate.mjs — 技能库结构校验器。npm test 与 CI 入口。
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFrontmatterDocument } from './lib/frontmatter.mjs';
import { collectDeclaredCapabilities, collectRegistryTags, checkCapabilityIndex } from './lib/capability-index.mjs';

export const SKILL_PREFIX = 're-';
const HERE = dirname(fileURLToPath(import.meta.url));

// 触发词双语约定（AGENTS.md）：description 须同时含 CJK 与拉丁字母，中英环境都能命中
const CJK_RE = /[㐀-䶿一-鿿぀-ヿ가-힯]/;
const LATIN_RE = /[A-Za-z]/;

export function parseFrontmatter(md) {
  const { fm, body } = parseFrontmatterDocument(md);
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
  return { name: fm.name, description: fm.description, type: fm.type, capabilities: fm.capabilities, guard: fm.guard, body };
}

// 从能力注册表（re-analyze/references/capabilities.md）解析合法标签清单
export function collectCapabilities(root) {
  return new Set(collectRegistryTags(root).keys());
}

// 路由一致性：triage/rerouting 的能力列必须在注册表内，且该行提到的技能里至少有一个真的声明了它
// （防路由与声明漂移——改了技能的 capabilities 却忘了改路由表，或反之）
export function checkRoutingCapabilities(root) {
  const errors = [];
  const registry = collectCapabilities(root);
  const declared = collectDeclaredCapabilities(root); // tag → [技能名]
  for (const rel of ['re-analyze/references/triage.md', 're-analyze/references/rerouting.md']) {
    const p = join(root, rel);
    if (!existsSync(p)) continue;
    let capCol = -1;
    const lines = readFileSync(p, 'utf8').split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line.trim().startsWith('|')) { capCol = -1; continue; }
      const cells = line.split('|').map(s => s.trim());
      if (capCol === -1) {
        // 表头：定位「需要能力」列；分隔行不参与
        const idx = cells.findIndex(c => c.includes('需要能力'));
        if (idx >= 0) capCol = idx;
        continue;
      }
      const tags = [...(cells[capCol] ?? '').matchAll(/`([a-z0-9-]+)`/g)].map(m => m[1]);
      if (!tags.length) continue;
      const skills = [...line.matchAll(/\bre-[a-z0-9-]+\b/g)].map(m => m[0]);
      for (const t of tags) {
        if (!registry.has(t)) {
          errors.push(`${rel}:${i + 1} 路由引用了未注册的能力 '${t}'`);
        } else if (!skills.some(s => (declared.get(t) ?? []).includes(s))) {
          errors.push(`${rel}:${i + 1} 路由标称能力 '${t}'，但本行技能（${skills.join(' / ') || '未列技能'}）均未声明该能力`);
        }
      }
    }
  }
  return errors;
}

// 能力标注一致性（网关选择树/工作流）：① 选择树内的技能链接必须带能力标注
// ② 标注的能力必须在注册表内，且被被标注的技能真的声明（防"标注说会 X、技能其实不会 X"）
export function checkCapabilityAnnotations(root) {
  const errors = [];
  const registry = collectCapabilities(root);
  const skillCaps = new Map();
  for (const dir of readdirSync(root, { withFileTypes: true })) {
    if (!dir.isDirectory() || !dir.name.startsWith(SKILL_PREFIX)) continue;
    const p = join(root, dir.name, 'SKILL.md');
    if (!existsSync(p)) continue;
    try {
      const fm = parseFrontmatter(readFileSync(p, 'utf8'));
      skillCaps.set(dir.name, { caps: fm.capabilities ?? [], body: fm.body });
    } catch { /* 单技能错误由 checkSkillDir 报出 */ }
  }
  for (const [name, { body }] of skillCaps) {
    // ① 标注内容：显式前缀「能力：」+ 连续标签段——括号内可再嵌 [[子技能]]（能力：`tag`），不归属外层；
    //    无前缀的括号是普通说明（如 [[re-x64dbg]]（`minidump` 命令）），不参与能力校验
    for (const m of body.matchAll(/\[\[([a-z0-9-]+)\]\]（能力：((?:`[a-z0-9-]+`[、,\s]*)+)/g)) {
      const tags = [...m[2].matchAll(/`([a-z0-9-]+)`/g)].map(x => x[1]);
      if (!tags.length) continue;
      const target = m[1];
      if (!skillCaps.has(target)) {
        errors.push(`${name}: 标注 [[${target}]] 的能力，但该技能不存在`);
        continue;
      }
      for (const t of tags) {
        if (!registry.has(t)) errors.push(`${name}: 标注了未注册的能力 '${t}'（[[${target}]]）`);
        else if (!skillCaps.get(target).caps.includes(t)) {
          errors.push(`${name}: 标注 [[${target}]] 提供 '${t}'，但该技能未声明该能力`);
        }
      }
    }
    // ② 选择树段内的技能链接必须紧跟能力标注（`[[技能]]（`tag`）`）
    let inTree = false;
    for (const line of body.split('\n')) {
      if (/^## 何时用哪个原子技能（选择树）/.test(line)) { inTree = true; continue; }
      if (inTree && /^## /.test(line)) inTree = false;
      if (!inTree) continue;
      for (const m of line.matchAll(/\[\[([a-z0-9-]+)\]\]/g)) {
        if (!skillCaps.has(m[1])) continue; // 非技能链接（references 文档如 platform-tips）不要求能力标注
        if (!line.slice(m.index + m[0].length).startsWith('（能力：`')) {
          errors.push(`${name}: 选择树内 [[${m[1]}]] 缺少能力标注（形如 [[${m[1]}]]（能力：\`能力\`））`);
        }
      }
    }
  }
  return errors;
}

// 注册表自洽：每个标签至少被一个技能声明（防悬空标签堆积——见 docs/audit）
export function checkCapabilityRegistry(root) {
  const errors = [];
  const declared = collectDeclaredCapabilities(root);
  for (const tag of [...collectCapabilities(root)].sort()) {
    if (!declared.has(tag)) errors.push(`capability registry: '${tag}' is declared by no skill (dangling tag)`);
  }
  return errors;
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
  if (!CJK_RE.test(fm.description) || !LATIN_RE.test(fm.description)) {
    errors.push(`${name}: description must contain both CJK and Latin trigger words`);
  }
  // 工具准备检查：仅原子技能（无 type 或 type: atomic）且为叶子。入口(type: entry)/网关(type: gateway)豁免
  const type = fm.type ?? 'atomic';
  if (type === 'atomic' && isLeafSkill(dir) && !fm.body.includes('## 工具准备')) {
    errors.push(`${name}: atomic skill missing '## 工具准备' section`);
  }
  if (!['atomic', 'entry', 'gateway'].includes(type)) errors.push(`${name}: invalid type '${type}' (atomic/entry/gateway)`);
  // 原子技能必须声明能力（能力层完整性：路由靠能力匹配，未声明即路由不可达）
  if (type === 'atomic' && fm.capabilities === undefined) {
    errors.push(`${name}: atomic skill must declare capabilities (see re-analyze/references/capabilities.md)`);
  }
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
  // 链接规则：技能 `[[re-xxx]]`；跨技能 references `[[re-xxx/name]]`；裸 `[[name]]` 必须落在本技能 references/ 内
  // （references 同名文件普遍——gotchas 33 个、decision-tree 13 个——裸链会歧义，故跨技能须限定前缀）
  const known = new Set(opts.knownSkills ?? []);
  const checkLinks = (text, label) => {
    for (const link of text.matchAll(/\[\[([a-z0-9-]+(?:\/[a-z0-9-]+)?)\]\]/g)) {
      const target = link[1];
      if (target.includes('/')) {
        const [owner, ref] = target.split('/');
        if (!known.has(owner) || !existsSync(join(dir, '..', owner, 'references', `${ref}.md`))) {
          errors.push(`${label}: broken [[${target}]] link（跨技能 references 须解析到 ${owner}/references/${ref}.md）`);
        }
        continue;
      }
      if (known.has(target)) continue;
      if (!existsSync(join(dir, 'references', `${target}.md`))) {
        errors.push(`${label}: broken [[${target}]] link（裸 references 链接须在本技能 references/ 内；跨技能请写 [[re-xxx/${target}]]）`);
      }
    }
  };
  checkLinks(fm.body, name);
  // references/ 内的链接同规则校验（跨技能引用多在此处）
  const refDir = join(dir, 'references');
  if (existsSync(refDir)) {
    for (const f of readdirSync(refDir)) {
      if (!f.endsWith('.md')) continue;
      checkLinks(readFileSync(join(refDir, f), 'utf8'), `${name}/references/${f}`);
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
  for (const e of checkCapabilityRegistry(root)) { console.error(`FAIL: ${e}`); failed++; }
  for (const e of checkRoutingCapabilities(root)) { console.error(`FAIL: ${e}`); failed++; }
  for (const e of checkCapabilityAnnotations(root)) { console.error(`FAIL: ${e}`); failed++; }
  for (const e of checkCapabilityIndex(root)) { console.error(`FAIL: ${e}`); failed++; }
  if (failed) { console.error(`${failed} problem(s) found`); process.exit(1); }
  console.log(`OK: ${known.length} skills validated`);
}

if (process.argv[1] && process.argv[1].endsWith('validate.mjs')) main();
