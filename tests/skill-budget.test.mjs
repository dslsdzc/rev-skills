import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';

// 技能规模预算：SKILL.md 是**每次都会加载**的部分，references 是按需加载的。
// 所以真正需要设防的是 SKILL.md 膨胀成单体文档——references 再厚也只是"书架上多几本"。
const SKILLS = '.claude/skills';
const SKILL_MD_BUDGET = 240;   // 现行最大 210（re-iot-proto）；留一成余量，超出即提示拆分
const BRANCH_BUDGET = 600;     // 单个 references 文件的上限（现行最大 506：windows-kernel.md）

function lines(p) {
  return readFileSync(p, 'utf8').split('\n').length;
}

test(`SKILL.md 行数不超过 ${SKILL_MD_BUDGET}（超出应把细节下沉到 references）`, () => {
  const over = [];
  for (const d of readdirSync(SKILLS)) {
    const p = `${SKILLS}/${d}/SKILL.md`;
    if (!d.startsWith('re-') || !existsSync(p)) continue;
    const n = lines(p);
    if (n > SKILL_MD_BUDGET) over.push(`${d}（${n} 行）`);
  }
  assert.deepEqual(over, [], `SKILL.md 超预算——把机制细节移到 references/ 分支：\n${over.join('\n')}`);
});

test(`单个 references 分支不超过 ${BRANCH_BUDGET} 行`, () => {
  const over = [];
  for (const d of readdirSync(SKILLS)) {
    const dir = `${SKILLS}/${d}/references`;
    if (!d.startsWith('re-') || !existsSync(dir)) continue;
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.md')) continue;
      const n = lines(`${dir}/${f}`);
      if (n > BRANCH_BUDGET) over.push(`${d}/references/${f}（${n} 行）`);
    }
  }
  assert.deepEqual(over, [], `分支超长——按主题再切一层：\n${over.join('\n')}`);
});

// 反向保护：预算是"拆分信号"而不是"越短越好"——SKILL.md 必须仍然自带工具准备与操作步骤，
// 否则就是被削成了空壳（把内容全推给 references 同样会让 agent 无从下手）。
test('SKILL.md 仍自带必备章节（防止为了满足预算而削壳）', () => {
  const missing = [];
  for (const d of readdirSync(SKILLS)) {
    const p = `${SKILLS}/${d}/SKILL.md`;
    if (!d.startsWith('re-') || !existsSync(p)) continue;
    const text = readFileSync(p, 'utf8');
    const type = /^type:\s*(\w+)/m.exec(text)?.[1] ?? 'atomic';
    if (type !== 'atomic') continue;                     // 入口/网关另有一套章节规范
    for (const sec of ['## 何时使用', '## 操作步骤']) {
      if (!text.includes(sec)) missing.push(`${d}: ${sec}`);
    }
  }
  assert.deepEqual(missing, [], `原子技能缺少必备章节：\n${missing.join('\n')}`);
});
