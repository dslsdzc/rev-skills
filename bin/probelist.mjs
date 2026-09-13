#!/usr/bin/env node
// bin/probelist.mjs — 由登记表生成 probe.sh 的工具清单
//   node bin/probelist.mjs           重新生成（写入 probe.sh 的 GENERATED-TOOLS 块）
//   node bin/probelist.mjs --check   只校验是否与登记表一致（npm test 已含）
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeProbeBlock, checkProbeBlock, probeToolNames, PROBE_REL } from '../lib/probe-tools.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

if (process.argv.includes('--check')) {
  const errors = checkProbeBlock(ROOT);
  if (errors.length) {
    for (const e of errors) console.error(`FAIL: ${e}`);
    process.exit(1);
  }
  console.log(`OK: probe 工具清单与登记表一致（${probeToolNames(ROOT).length} 项）`);
} else {
  const changed = writeProbeBlock(ROOT);
  console.log(`${changed ? 'updated' : 'unchanged'}: ${PROBE_REL}（${probeToolNames(ROOT).length} 项）`);
}
