// lib/tool-register.mjs — 第三方命令/API 清单：抽取、比对、时效
//
// 用途：领域知识比工具操作层稳定——技能里的**命令/API 会随上游版本漂移**，
// 而 validate.mjs 只校验结构，不执行示例、也不检查命令是否还存在。
// 本模块提供「登记表 + 候选发现 + 时效报告」的最小骨架（与增量审查机制共用状态模型）。
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

export const REGISTER_REL = 'docs/audit/tool-register.json';

// shell 关键字 / 控制结构 / heredoc 定界符——不是第三方工具
const SHELL_WORDS = new Set([
  'for', 'if', 'while', 'until', 'do', 'done', 'then', 'else', 'elif', 'fi', 'case', 'esac',
  'function', 'export', 'set', 'unset', 'source', 'local', 'return', 'exit', 'break', 'continue',
  'cd', 'echo', 'printf', 'true', 'false', 'test', 'read', 'eval', 'exec', 'shift', 'trap', 'wait',
  'PY', 'EOF', 'SH', 'BASH', 'END', 'JSON', 'PYTHON',
]);

// 常见 shell 内建/基础工具：登记表不收录（噪音大、无生命周期风险）
export const BASE_UTILS = new Set([
  'ls', 'cat', 'cp', 'mv', 'rm', 'mkdir', 'rmdir', 'touch', 'ln', 'chmod', 'chown', 'pwd', 'tee',
  'head', 'tail', 'wc', 'sort', 'uniq', 'cut', 'tr', 'sed', 'awk', 'grep', 'egrep', 'find', 'xargs',
  'which', 'whereis', 'env', 'date', 'sleep', 'kill', 'ps', 'top', 'df', 'du', 'mount', 'umount',
  'sha256sum', 'md5sum', 'sha1sum', 'base64', 'xxd', 'od', 'stat', 'file', 'strings', 'diff', 'patch',
  'tar', 'gzip', 'gunzip', 'zcat', 'unzip', 'zip', 'curl', 'wget', 'ssh', 'scp', 'rsync', 'nc', 'netcat',
  'sudo', 'su', 'git', 'make', 'cmake', 'gcc', 'clang', 'python', 'python3', 'pip', 'pip3', 'node', 'npm',
  'apt', 'apt-get', 'dnf', 'yum', 'pacman', 'brew', 'choco', 'pipx', 'podman',
]);

// 只抽显式标注为 shell 的代码块——未标注块里混着 python / C / 伪代码，
// 会把 print、import、struct 字段名等当成"命令"，噪音量级大一个数量级。
const SHELL_TAGS = new Set(['sh', 'bash', 'console', 'shell', 'zsh']);

/** 抽取代码块中出现的「命令首 token」 */
export function extractCommands(markdown) {
  const out = [];
  const fence = /^```([A-Za-z]*)\s*$/;
  let inBlock = false;
  let tag = '';
  let skipUntil = null;   // heredoc 定界符
  for (const raw of markdown.split('\n')) {
    const trimmed = raw.trim();
    const m = fence.exec(trimmed);
    if (m) {
      if (!inBlock) { inBlock = true; tag = m[1].toLowerCase(); skipUntil = null; }
      else { inBlock = false; tag = ''; skipUntil = null; }
      continue;
    }
    if (!inBlock) continue;
    if (!SHELL_TAGS.has(tag)) continue;
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//')) continue;
    if (skipUntil) { if (trimmed === skipUntil) skipUntil = null; continue; }
    const hd = /<<-?\s*'?"?([A-Za-z_][A-Za-z0-9_]*)'?"?/.exec(trimmed);
    if (hd) { skipUntil = hd[1]; continue; }
    // 去提示符 / 环境变量赋值前缀 / sudo，取首 token
    const stripped = trimmed
      .replace(/^(\$|>|#)\s*/, '')
      .replace(/^(\w+=\S*\s+)+/, '')
      .replace(/^(sudo|doas)\s+/, '');
    const tok = /^([A-Za-z][A-Za-z0-9_.+-]*)/.exec(stripped);
    if (!tok) continue;
    const cmd = tok[1];
    if (SHELL_WORDS.has(cmd) || BASE_UTILS.has(cmd) || cmd.length < 2) continue;
    out.push(cmd);
  }
  return out;
}

/** 扫描技能目录，返回 cmd → 技能名集合 */
export function collectFromSkills(skillsDir) {
  const map = new Map();
  const walk = (dir, owner) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p, owner ?? e.name);
      else if (e.name.endsWith('.md')) {
        const skill = owner ?? e.name.replace(/\.md$/, '');
        for (const cmd of extractCommands(readFileSync(p, 'utf8'))) {
          if (!map.has(cmd)) map.set(cmd, new Set());
          map.get(cmd).add(skill);
        }
      }
    }
  };
  for (const e of readdirSync(skillsDir, { withFileTypes: true })) {
    if (e.isDirectory() && e.name.startsWith('re-')) walk(join(skillsDir, e.name), e.name);
  }
  return map;
}

export function loadRegister(repoRoot) {
  const p = join(repoRoot, REGISTER_REL);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, 'utf8'));
}

export function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export function daysSince(iso) {
  const t = Date.parse(`${iso}T00:00:00Z`);
  if (Number.isNaN(t)) return Infinity;
  return Math.floor((Date.now() - t) / 86400000);
}

/** 一致性检查：返回 {errors, warnings, stale, candidates} */
export function checkRegister(repoRoot, skillsDir, { staleDays = 180 } = {}) {
  const errors = [];
  const warnings = [];
  const register = loadRegister(repoRoot);
  if (!register) {
    return { errors: [`找不到登记表 ${REGISTER_REL}`], warnings: [], stale: [], candidates: [], register: null };
  }
  if (!Array.isArray(register.tools)) {
    return { errors: [`${REGISTER_REL} 缺少 tools 数组`], warnings: [], stale: [], candidates: [], register };
  }
  const seen = new Set();
  for (const t of register.tools) {
    if (!t.name) errors.push('登记项缺少 name');
    if (seen.has(t.name)) errors.push(`登记项重复：${t.name}`);
    seen.add(t.name);
    // last_verified 为 null = 已登记但尚未核验当前 CLI/API 形态（允许，且会被计入待核验）
    if (t.last_verified !== null && !/^\d{4}-\d{2}-\d{2}$/.test(t.last_verified ?? '')) {
      errors.push(`登记项 ${t.name} 的 last_verified 须为 YYYY-MM-DD 或 null`);
    }
    if (t.last_verified && !t.source) warnings.push(`登记项 ${t.name} 已标核验日期但未记录来源（source）`);
  }

  const used = collectFromSkills(skillsDir);
  // 死条目：登记了却已无技能引用
  for (const t of register.tools) {
    if (!used.has(t.name)) errors.push(`死条目：登记为在用，但技能里已找不到 ${t.name}`);
  }
  // 候选：技能里出现但未登记（且不在忽略名单）
  const ignore = new Set(register.ignore ?? []);
  const candidates = [...used.keys()].filter((c) => !seen.has(c) && !ignore.has(c)).sort();
  // 时效：已核验的超期 → stale；从未核验的 → pending（待核验积压，与 stale 分开统计）
  const stale = [];
  const pending = [];
  for (const t of register.tools) {
    if (!t.last_verified) { pending.push(t.name); continue; }
    const days = daysSince(t.last_verified);
    if (days >= staleDays) stale.push({ name: t.name, last_verified: t.last_verified, days });
  }
  stale.sort((a, b) => b.days - a.days);
  pending.sort();

  return { errors, warnings, stale, pending, candidates, register, used };
}

/** 本机探测：仅报告，不参与 CI 判定（CI 机器未必装这些工具） */
export function smokeProbe(names) {
  return names.map((n) => {
    try {
      execFileSync('sh', ['-c', `command -v ${n}`], { stdio: 'ignore' });
      return { name: n, present: true };
    } catch {
      return { name: n, present: false };
    }
  });
}
