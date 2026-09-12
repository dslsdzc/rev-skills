#!/usr/bin/env node
// bin/capindex.mjs — 生成 / 校验「能力 → 技能」索引
//   node bin/capindex.mjs           重新生成 re-analyze/references/capability-index.md
//   node bin/capindex.mjs --check   只校验是否过期（npm test 已含此检查）
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { INDEX_REL, renderCapabilityIndex, checkCapabilityIndex } from '../lib/capability-index.mjs';

const SKILLS = join(dirname(fileURLToPath(import.meta.url)), '..', '.claude', 'skills');

if (process.argv.includes('--check')) {
  const errors = checkCapabilityIndex(SKILLS);
  if (errors.length) {
    for (const e of errors) console.error(`FAIL: ${e}`);
    process.exit(1);
  }
  console.log('OK: capability index up to date');
} else {
  writeFileSync(join(SKILLS, INDEX_REL), renderCapabilityIndex(SKILLS));
  console.log(`generated: .claude/skills/${INDEX_REL}`);
}
