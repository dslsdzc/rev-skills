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
  const lines = (m?.[1] ?? '').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const kv = lines[i].match(/^(\w+):\s*(.*)$/);
    if (!kv) continue;
    if (/^[>|]/.test(kv[2])) {
      // YAML 块标量（折叠 > / 字面 |）：吸收后续缩进行为实际值
      const folded = [];
      while (lines[i + 1] !== undefined && /^\s+/.test(lines[i + 1])) {
        folded.push(lines[++i].replace(/^\s+/, ''));
      }
      fm[kv[1]] = folded.join(kv[2][0] === '>' ? ' ' : '\n').trim();
    } else {
      fm[kv[1]] = kv[2];
    }
  }
  return { name: fm.name, description: fm.description, body: m?.[2] ?? md };
}

// parseSkill：readSkill 的别名，保持调用方兼容
export function parseSkill(dir) { return readSkill(dir); }

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
      writeFileSync(p, `---\ndescription: ${JSON.stringify(s.description)}\nglobs: **/*\n---\n\n${s.body}`);
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

// —— 追加到 convert.mjs 末尾 ——
function cli() {
  const args = process.argv.slice(2);
  const type = args[args.indexOf('--target') + 1];
  const out = args[args.indexOf('--out') + 1];
  if (!type || !out) { console.error('usage: node bin/convert.mjs --target cursor|copilot|windsurf --out <dir>'); process.exit(1); }
  const files = convertAll(type, out);
  console.log(`generated ${files.length} file(s) in ${out}`);
}
if (process.argv[1] && process.argv[1].endsWith('convert.mjs')) cli();
