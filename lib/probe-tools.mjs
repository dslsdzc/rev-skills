// lib/probe-tools.mjs — probe.sh 的工具清单：由登记表生成（单一事实源）
//
// 背景：probe.sh 曾硬编码 19 个工具，而登记表已有 140 项——环境里装了什么
// 是 agent 判断"优先用什么"的依据，硬编码清单会随登记表增长而失同步。
// 做法与能力索引同构：登记表是源，probe.sh 里的清单是生成物，`--check` 校验新鲜度。
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export const REGISTER_REL = 'docs/audit/tool-register.json';
export const PROBE_REL = '.claude/skills/re-analyze/references/probe.sh';
export const BEGIN = '# >>> GENERATED-TOOLS';
export const END = '# <<< GENERATED-TOOLS';

/** 从登记表取要探测的工具名（忽略名单之外的 cli 项，按名排序） */
export function probeToolNames(repoRoot) {
  const reg = JSON.parse(readFileSync(join(repoRoot, REGISTER_REL), 'utf8'));
  const ignore = new Set(reg.ignore ?? []);
  return reg.tools
    .map((t) => t.name)
    .filter((n) => !ignore.has(n))
    .sort((a, b) => a.localeCompare(b));
}

/** 生成标记块（含换行） */
export function renderBlock(names) {
  return [
    `${BEGIN}（源：${REGISTER_REL}；改清单请改登记表后跑 node bin/probelist.mjs）`,
    '# shellcheck disable=SC2034',
    `PROBE_TOOLS="${names.join(' ')}"`,
    END,
  ].join('\n');
}

/** 替换 probe.sh 里的标记块；返回是否发生变化 */
export function writeProbeBlock(repoRoot) {
  const p = join(repoRoot, PROBE_REL);
  const text = readFileSync(p, 'utf8');
  const block = renderBlock(probeToolNames(repoRoot));
  const re = new RegExp(`^${BEGIN}[\\s\\S]*?^${END}$`, 'm');
  if (!re.test(text)) throw new Error(`${PROBE_REL} 里找不到 GENERATED-TOOLS 标记块`);
  const next = text.replace(re, block);
  if (next === text) return false;
  writeFileSync(p, next);
  return true;
}

/** 校验 probe.sh 的清单是否与登记表一致 */
export function checkProbeBlock(repoRoot) {
  const p = join(repoRoot, PROBE_REL);
  if (!existsSync(p)) return [`找不到 ${PROBE_REL}`];
  const text = readFileSync(p, 'utf8');
  const re = new RegExp(`^${BEGIN}[\\s\\S]*?^${END}$`, 'm');
  const m = re.exec(text);
  if (!m) return [`${PROBE_REL} 里找不到 GENERATED-TOOLS 标记块`];
  const expected = renderBlock(probeToolNames(repoRoot));
  if (m[0] !== expected) {
    return [`${PROBE_REL} 的工具清单与登记表不一致——跑 node bin/probelist.mjs 重新生成`];
  }
  return [];
}
