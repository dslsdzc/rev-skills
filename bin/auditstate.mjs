#!/usr/bin/env node
// bin/auditstate.mjs — 增量审查状态
//   node bin/auditstate.mjs status            列出「内容变了待复核 / 从未复核 / 已复核未变」
//   node bin/auditstate.mjs update <技能...>   回填复核记录（写入当前 hash + 日期）
//   node bin/auditstate.mjs update --all      全部标记为已复核（仅用于机制初始化）
//
// 审查波工作流：status → 只审列出的技能 → update。成本从 O(技能总数) 降到 O(变更数)。
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeStatus, markReviewed, todayISO, STATE_REL } from '../lib/review-state.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SKILLS = join(ROOT, '.claude', 'skills');
const [mode, ...rest] = process.argv.slice(2);

if (mode === 'status') {
  const { changed, unreviewed, ok, unknown } = computeStatus(ROOT, SKILLS);
  console.log(`已复核未变 ${ok.length}｜待复核（内容已变）${changed.length}｜从未复核 ${unreviewed.length}`);
  if (changed.length) {
    console.log('\n待复核（内容在复核之后又变了）——这就是下一轮审查波的工作集：');
    for (const c of changed) console.log(`  ${c.name}  上次复核 ${c.last_reviewed ?? '—'}`);
  }
  if (unreviewed.length) {
    console.log(`\n从未复核（${unreviewed.length}）：${unreviewed.map((u) => u.name).join(' ')}`);
  }
  if (unknown.length) console.log(`\nWARN: 状态里有已不存在的技能：${unknown.join(' ')}`);
} else if (mode === 'update') {
  if (!rest.length) { console.error('用法：auditstate.mjs update <技能...> | --all'); process.exit(2); }
  const names = rest[0] === '--all'
    ? [...computeStatus(ROOT, SKILLS).changed, ...computeStatus(ROOT, SKILLS).unreviewed].map((s) => s.name)
    : rest;
  const n = markReviewed(ROOT, SKILLS, names, { date: todayISO() });
  console.log(`已回填 ${n} 项 → ${STATE_REL}`);
} else {
  console.error(`未知子命令：${mode ?? '(空)'}（可用 status / update）`);
  process.exit(2);
}
