import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';

// 计数散落多处，历史上漏同步过 5 处（见 CLAUDE.md「同步计数与导航」）。
// 本测试把那份人工清单变成检查：新技能增删后，任何一处没跟上都会红。
const SKILLS_DIR = '.claude/skills';

function actualCounts() {
  let atomic = 0, gateway = 0, entry = 0;
  let total = 0;
  for (const d of readdirSync(SKILLS_DIR)) {
    if (!d.startsWith('re-') || !existsSync(`${SKILLS_DIR}/${d}/SKILL.md`)) continue;
    total++;
    const m = /^type:\s*(\w+)/m.exec(readFileSync(`${SKILLS_DIR}/${d}/SKILL.md`, 'utf8'));
    const kind = m ? m[1] : 'atomic';
    if (kind === 'gateway') gateway++;
    else if (kind === 'entry') entry++;
    else atomic++;
  }
  return { total, atomic, gateway, entry };
}

// file → [正则, 期望口径, 说明]；正则第 1 个捕获组是要比对的数字
const SITES = [
  ['README.md', /^(\d+) 个逆向工程技能/m, 'total', '首段技能总数'],
  ['README.md', /^## 技能导航（(\d+)）/m, 'total', '技能导航标题'],
  ['README.md', /^入口 → (\d+) 大类网关 → (\d+) 原子技能/m, 'gateway+atomic', '前言'],
  ['README_EN.md', /^(\d+) reverse engineering skills/m, 'total', '首段技能总数'],
  ['README_EN.md', /^## Skill map \((\d+)\)/m, 'total', 'Skill map 标题'],
  ['README_EN.md', /^Entry → (\d+) category gateways → (\d+) atomic skills/m, 'gateway+atomic', '前言'],
  ['AGENTS.md', /^本仓库是通用逆向工程 AI 技能库（(\d+) 个技能）/m, 'total', '首段技能总数'],
  ['AGENTS.md', /^- 原子技能（(\d+)）/m, 'atomic', '原子技能行'],
  ['CLAUDE.md', /^通用逆向工程 AI 技能库（(\d+) 个技能）/m, 'total', '仓库性质段'],
  ['CLAUDE.md', /OK: (\d+) skills validated/, 'total', '校验输出示例'],
  ['CLAUDE.md', /原子技能（type: atomic，(\d+) 个）/m, 'atomic', '架构图'],
  ['package.json', /"description":\s*"[^"]*?(\d+) 个技能/, 'total', 'npm 描述'],
  ['.claude-plugin/marketplace.json', /"description":\s*"[^"]*?(\d+) 个技能/, 'total', '插件市场描述'],
];

test('各处的技能计数与实际目录一致', () => {
  const c = actualCounts();
  const bad = [];
  for (const [file, re, kind, label] of SITES) {
    const text = readFileSync(file, 'utf8');
    const m = re.exec(text);
    if (!m) { bad.push(`${file}（${label}）：找不到计数，模式可能已失效`); continue; }
    const nums = m.slice(1).map(Number);
    const want = kind === 'total' ? [c.total]
      : kind === 'atomic' ? [c.atomic]
        : [c.gateway, c.atomic];
    nums.forEach((n, i) => {
      if (n !== want[i]) bad.push(`${file}（${label}）：写的是 ${n}，实际 ${want[i]}`);
    });
  }
  assert.deepEqual(bad, [], `计数不同步：\n${bad.join('\n')}`);
});

test('README / README_EN 的网关行引用的技能都存在', () => {
  const missing = [];
  for (const file of ['README.md', 'README_EN.md']) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(/`(re-[a-z0-9-]+)`/g)) {
      if (!existsSync(`${SKILLS_DIR}/${m[1]}/SKILL.md`)) missing.push(`${file}: ${m[1]}`);
    }
  }
  assert.deepEqual(missing, [], `引用了不存在的技能：\n${missing.join('\n')}`);
});

test('每个技能都在 README 中至少出现一次', () => {
  const readme = readFileSync('README.md', 'utf8');
  const absent = readdirSync(SKILLS_DIR)
    .filter((d) => d.startsWith('re-') && existsSync(`${SKILLS_DIR}/${d}/SKILL.md`))
    .filter((d) => !readme.includes(d));
  assert.deepEqual(absent, [], `README 未提及：${absent.join(' ')}`);
});
