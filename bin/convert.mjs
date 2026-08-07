// bin/convert.mjs — SKILL.md → 规则文件转换器
import { readdirSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export function skillDirs(skillsRoot) {
  return readdirSync(skillsRoot, { withFileTypes: true })
    .filter(e => e.isDirectory() && e.name.startsWith('re-'))
    .map(e => join(skillsRoot, e.name));
}

export function readSkill(dir) {
  const md = readFileSync(join(dir, 'SKILL.md'), 'utf8');
  const m = md.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  const fm = {};
  for (const line of (m?.[1] ?? '').split('\n')) {
    const kv = line.match(/^(\w+):\s*(.*)$/);
    if (kv) fm[kv[1]] = kv[2];
  }
  return { name: fm.name, description: fm.description, body: m?.[2] ?? md };
}

const HERE = dirname(fileURLToPath(import.meta.url));

export function convertAll(type, destDir) {
  // 初版：cursor/windsurf 每技能一文件；copilot 聚合单文件
  const skills = skillDirs(join(HERE, '..', '.claude', 'skills'))
    .map(readSkill);
  mkdirSync(destDir, { recursive: true });
  const files = [];
  if (type === 'cursor') {
    for (const s of skills) {
      const p = join(destDir, `${s.name}.mdc`);
      writeFileSync(p, `---\ndescription: ${s.description}\nglobs: **/*\n---\n\n${s.body}`);
      files.push(p);
    }
  } else if (type === 'windsurf') {
    for (const s of skills) {
      const p = join(destDir, `${s.name}.md`);
      writeFileSync(p, `# ${s.name}\n\n${s.description}\n\n${s.body}`);
      files.push(p);
    }
  } else if (type === 'copilot') {
    const p = join(destDir, 'copilot-instructions.md');
    const head = '# 逆向工程技能库（AI 助手指令）\n\n本文件由技能库自动聚合生成，作为分析时的知识参考。\n\n';
    writeFileSync(p, head + skills.map(s =>
      `## ${s.name}\n\n${s.description}\n\n${s.body}`).join('\n\n---\n\n'));
    files.push(p);
  } else {
    throw new Error(`unknown rule type: ${type}`);
  }
  return files;
}
