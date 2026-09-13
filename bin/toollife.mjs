#!/usr/bin/env node
// bin/toollife.mjs — 第三方命令/API 生命周期检查
//   node bin/toollife.mjs check        一致性 + 时效报告（CI 用，死条目即失败）
//   node bin/toollife.mjs candidates   列出技能里出现但未登记的命令候选
//   node bin/toollife.mjs stale        列出距上次核验超期的登记项
//   node bin/toollife.mjs smoke        本机探测（仅报告，CI 机器未必装这些工具）
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkRegister, REGISTER_REL, smokeProbe, daysSince } from '../lib/tool-register.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SKILLS = join(ROOT, '.claude', 'skills');
const mode = process.argv[2] ?? 'check';

if (mode === 'check') {
  const { errors, warnings, stale, pending, candidates, register } = checkRegister(ROOT, SKILLS);
  for (const e of errors) console.error(`FAIL: ${e}`);
  const verified = register.tools.filter((t) => t.last_verified).length;
  console.log(`登记 ${register.tools.length} 项｜已核验 ${verified}｜超期 ${stale.length}｜待核验积压 ${pending.length}`);
  if (stale.length) {
    console.log(`\n超期（≥180 天未复核，${stale.length} 项）——进入下一轮审查波：`);
    for (const s of stale.slice(0, 20)) console.log(`  ${s.name}  上次核验 ${s.last_verified}（${s.days} 天前）`);
    if (stale.length > 20) console.log(`  …另有 ${stale.length - 20} 项`);
  }
  if (pending.length) {
    console.log(`\n待核验积压（已登记、尚未核验当前 CLI/API 形态，${pending.length} 项）：`);
    console.log(`  ${pending.slice(0, 30).join(' ')}${pending.length > 30 ? ` …另有 ${pending.length - 30} 项` : ''}`);
  }
  if (candidates.length) {
    console.log(`\n未登记候选（${candidates.length} 项，确认后加入 ${REGISTER_REL} 或加入 ignore）：`);
    console.log(`  ${candidates.join(' ')}`);
  }
  for (const w of warnings) console.warn(`WARN: ${w}`);
  if (errors.length) process.exit(1);
  console.log('\nOK: tool register consistent');
} else if (mode === 'candidates') {
  const { candidates } = checkRegister(ROOT, SKILLS);
  console.log(candidates.join('\n'));
} else if (mode === 'stale') {
  const { register } = checkRegister(ROOT, SKILLS);
  const rows = register.tools
    .map((t) => ({ name: t.name, v: t.last_verified, d: t.last_verified ? daysSince(t.last_verified) : null }))
    .filter((r) => r.v === null || r.d >= 180)
    .sort((a, b) => (b.d ?? Infinity) - (a.d ?? Infinity));
  for (const r of rows) console.log(`${r.name}\t${r.v ?? '未核验'}\t${r.d ?? '-'}`);
  console.log(`\n共 ${rows.length} 项待核验/超期`);
} else if (mode === 'smoke') {
  const { register } = checkRegister(ROOT, SKILLS);
  const names = register.tools.filter((t) => t.kind === 'cli').map((t) => t.name);
  const res = smokeProbe(names);
  const miss = res.filter((r) => !r.present).map((r) => r.name);
  console.log(`本机存在 ${res.length - miss.length}/${res.length}｜缺失：${miss.join(' ') || '无'}`);
  console.log('（仅报告：CI 机器不必装这些工具，本模式不参与判定）');
} else {
  console.error(`未知子命令：${mode}（可用 check / candidates / stale / smoke）`);
  process.exit(2);
}
