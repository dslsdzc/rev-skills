// lib/review-state.mjs — 审查状态：每技能一份内容 hash + 复核记录
//
// 解决的问题：审查波是全量式——每波把整批技能从头审一遍，已确认的部分被反复重审。
// 本模块把审查成本从 O(技能总数) 降到 O(变更数)：先看哪些技能的内容在复核之后又变了。
//
// 状态语义：
//   last_reviewed = null              存量技能，尚未按本机制复核
//   当前 hash ≠ 记录 hash             内容变了 → 需要复核（下一轮审查波的工作集）
//   当前 hash = 记录 hash             已复核且未再变
import { readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createHash } from 'node:crypto';

export const STATE_REL = 'docs/audit/review-state.json';

/** 技能内容 hash：目录内全部文件按相对路径排序后逐个喂入 */
export function hashSkill(dir) {
  const h = createHash('sha256');
  const files = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.md') || e.name.endsWith('.sh')) files.push(p);
    }
  };
  walk(dir);
  for (const f of files) {
    h.update(relative(dir, f).split('\\').join('/'));
    h.update('\0');
    h.update(readFileSync(f));
    h.update('\0');
  }
  return h.digest('hex').slice(0, 16);
}

export function skillDirs(skillsDir) {
  return readdirSync(skillsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name.startsWith('re-'))
    .map((e) => e.name)
    .sort();
}

export function loadState(repoRoot) {
  const p = join(repoRoot, STATE_REL);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, 'utf8'));
}

export function saveState(repoRoot, state) {
  writeFileSync(join(repoRoot, STATE_REL), JSON.stringify(state, null, 2) + '\n');
}

/**
 * 计算状态：
 *   changed   内容在复核之后又变了 → 下一轮审查波的工作集
 *   unreviewed 从未按本机制复核
 *   ok        已复核且未变
 */
export function computeStatus(repoRoot, skillsDir) {
  const state = loadState(repoRoot) ?? { skills: {} };
  const recorded = state.skills ?? {};
  const changed = [], unreviewed = [], ok = [], unknown = [];
  for (const name of skillDirs(skillsDir)) {
    const hash = hashSkill(join(skillsDir, name));
    const rec = recorded[name];
    // 无记录、或记录里 last_reviewed 为空 → 从未按本机制复核（此时 hash 是否变化无意义）
    if (!rec || !rec.last_reviewed) unreviewed.push({ name, hash });
    else if (rec.hash !== hash) changed.push({ name, hash, was: rec.hash, last_reviewed: rec.last_reviewed });
    else ok.push({ name, hash, last_reviewed: rec.last_reviewed });
  }
  for (const name of Object.keys(recorded)) {
    if (!skillDirs(skillsDir).includes(name)) unknown.push(name);   // 已删除的技能仍留在状态里
  }
  return { changed, unreviewed, ok, unknown };
}

/** 回填：记录"这些技能已复核"（写入当前 hash 与日期） */
export function markReviewed(repoRoot, skillsDir, names, { date } = {}) {
  const status = computeStatus(repoRoot, skillsDir);
  const state = loadState(repoRoot) ?? {
    '$comment': '审查状态：每技能内容 hash + 最近复核。changed = 内容在复核后又变了，即下一轮审查波的工作集。',
    skills: {},
  };
  state.skills ??= {};
  const known = new Set(skillDirs(skillsDir));
  for (const n of names) {
    if (!known.has(n)) throw new Error(`未知技能：${n}`);
    const entry = [...status.changed, ...status.ok, ...status.unreviewed].find((s) => s.name === n);
    state.skills[n] = { hash: entry.hash, last_reviewed: date, note: state.skills[n]?.note ?? '' };
  }
  // 清理已删除技能
  for (const n of Object.keys(state.skills)) if (!known.has(n)) delete state.skills[n];
  saveState(repoRoot, state);
  return names.length;
}

export function todayISO() {
  return new Date().toISOString().slice(0, 10);
}
