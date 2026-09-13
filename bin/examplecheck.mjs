#!/usr/bin/env node
// bin/examplecheck.mjs — 技能示例代码块语法检查（opt-in，不进 npm test）
//   node bin/examplecheck.mjs          检查 python / shell 块的语法
//   node bin/examplecheck.mjs --json   机器可读输出
//
// 说明：需要 python3 / bash；缺失时对应部分跳过而非失败（见 lib/skill-examples.mjs 顶部注释）。
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkExamples, available } from '../lib/skill-examples.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SKILLS = join(ROOT, '.claude', 'skills');
const asJson = process.argv.includes('--json');

const interpreters = available();
const { checked, errors, skipped, total } = checkExamples(SKILLS, { interpreters });

if (asJson) {
  console.log(JSON.stringify({ checked, total, skipped, errors }, null, 2));
} else {
  console.log(`代码块 ${total} 个｜已检查 ${checked} 个（python3=${interpreters.python ? '有' : '无'} bash=${interpreters.shell ? '有' : '无'}）`);
  for (const s of skipped) console.log(`  跳过：${s}`);
  if (errors.length) {
    console.log('');
    for (const e of errors) console.log(`FAIL: ${e.file}:${e.line} [${e.tag}] ${e.msg}`);
  } else {
    console.log('OK: 示例语法检查通过');
  }
}
if (errors.length) process.exit(1);
