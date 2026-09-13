// lib/skill-examples.mjs — 技能里的示例代码块：抽取与语法检查
//
// 定位：validate.mjs 只校验结构，不执行示例。本模块补上"示例至少语法正确"这一层——
// 它抓不到"命令过期"，但能抓到"照抄会立刻报错"（如把 0x4011xx 写进 python）。
//
// 依赖说明：python / shell 语法检查需要对应解释器；缺失时**跳过而非失败**，
// 因此本检查是 opt-in（npm run examples），不进 npm test 的默认路径。
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { execFileSync } from 'node:child_process';

const FENCE = /^```([A-Za-z0-9_+.-]*)\s*$/;
const PY_TAGS = new Set(['python', 'py', 'python3']);
const SH_TAGS = new Set(['sh', 'bash', 'console', 'shell', 'zsh']);

/** 抽取全部技能里的代码块 */
export function collectExamples(skillsDir) {
  const out = [];
  for (const skill of readdirSync(skillsDir, { withFileTypes: true })) {
    if (!skill.isDirectory() || !skill.name.startsWith('re-')) continue;
    walk(join(skillsDir, skill.name), skill.name, skillsDir, out);
  }
  return out;
}

function walk(dir, skill, skillsDir, out) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) { walk(p, skill, skillsDir, out); continue; }
    if (!e.name.endsWith('.md')) continue;
    const lines = readFileSync(p, 'utf8').split('\n');
    let inBlock = false, tag = '', start = 0, buf = [];
    for (let i = 0; i < lines.length; i++) {
      const m = FENCE.exec(lines[i].trim());
      if (m) {
        if (!inBlock) { inBlock = true; tag = m[1].toLowerCase(); start = i + 2; buf = []; }
        else {
          out.push({ skill, file: relative(skillsDir, p), line: start, tag, body: buf.join('\n') });
          inBlock = false;
        }
        continue;
      }
      if (inBlock) buf.push(lines[i]);
    }
  }
}

/** 去公共缩进（技能里的块常缩进在列表项下） */
export function dedent(text) {
  const lines = text.split('\n');
  const indents = lines.filter((l) => l.trim()).map((l) => l.match(/^[ \t]*/)[0].length);
  const min = indents.length ? Math.min(...indents) : 0;
  return lines.map((l) => l.slice(min)).join('\n');
}

// 调试器/解释器交互提示符
const DBG_PROMPT = /^\s*\((gdb|rr|lldb|jdb|pdb|gef|pwndbg|python3?)\)/;
// 交互式工具的启动行——配合 `> ` 行可判定整块是会话记录
const INTERACTIVE = /^(jdb|gdb|lldb|rr|jshell|frida|node|python3?)\b/;

/** 拆出 heredoc：返回 { shell, heredocs: [{lang, body}] }，heredoc 体不属于 shell 语法 */
export function splitHeredocs(text) {
  const lines = dedent(text).split('\n');
  const shell = [];
  const heredocs = [];
  let pending = null;   // { delim, lang, buf }
  for (const raw of lines) {
    const line = raw.trim();
    if (pending) {
      if (line === pending.delim) { heredocs.push({ lang: pending.lang, body: pending.buf.join('\n') }); pending = null; }
      else pending.buf.push(raw);
      continue;
    }
    const hd = /<<-?\s*'?"?([A-Za-z_][A-Za-z0-9_]*)'?"?/.exec(line);
    if (hd) {
      const delim = hd[1];
      // 语言线索：喂给解释器的 heredoc 才按对应语言检查
      const lang = /\bpython3?\b/.test(line) ? 'python'
        : /\bnode\b/.test(line) ? 'js'
          : null;
      pending = { delim, lang, buf: [] };
      shell.push(`: <<'${delim}'`);   // 用空操作占位，保持行数对齐
      continue;
    }
    shell.push(raw);
  }
  if (pending) heredocs.push({ lang: pending.lang, body: pending.buf.join('\n') });
  return { shell: shell.join('\n'), heredocs };
}

/**
 * shell 规范化：去缩进 → 拆 heredoc → 会话记录处理 → 占位符中和
 *  - **会话记录块**（有调试器提示符，或有交互式工具启动行 + `> ` 命令）：丢弃提示符行
 *  - 占位符中和：`<pid>`、`<BundleID 或 App 名>` 会被 shell 当成重定向
 */
export function normalizeShell(body) {
  const { shell } = splitHeredocs(body);
  const raw = shell.split('\n').map((l) => l.trim());
  const firstCmd = raw.find((l) => l && !l.startsWith('#'));
  const isTranscript = raw.some((l) => DBG_PROMPT.test(l))
    || (raw.some((l) => /^>\s/.test(l)) && INTERACTIVE.test(firstCmd ?? ''));
  return raw
    .filter((l) => (isTranscript ? !DBG_PROMPT.test(l) && !/^>\s/.test(l) : true))
    .map((l) => l.replace(DBG_PROMPT, '').replace(/^[$>]\s+/, ''))
    .join('\n')
    .replace(/<[^<>]*>/g, 'PLACEHOLDER');
}

function has(bin) {
  try { execFileSync('sh', ['-c', `command -v ${bin}`], { stdio: 'ignore' }); return true; }
  catch { return false; }
}

export function available() {
  return { python: has('python3'), shell: has('bash') };
}

/** 逐块语法检查；返回 {checked, errors:[{file,line,tag,msg}], skipped} */
export function checkExamples(skillsDir, { interpreters = available() } = {}) {
  const blocks = collectExamples(skillsDir);
  const errors = [];
  let checked = 0;
  const skipped = [];
  for (const b of blocks) {
    const isPy = PY_TAGS.has(b.tag);
    const isSh = SH_TAGS.has(b.tag);
    if (!isPy && !isSh) continue;
    if (isPy) {
      if (!interpreters.python) { skipped.push('python（未找到 python3）'); continue; }
      checked++;
      try {
        execFileSync('python3', ['-c', 'import sys; compile(sys.stdin.read(), "<block>", "exec")'],
          { input: dedent(b.body), stdio: ['pipe', 'ignore', 'pipe'] });
      } catch (e) {
        const msg = (e.stderr?.toString() ?? String(e)).trim().split('\n').pop();
        errors.push({ ...pick(b), msg });
      }
    } else {
      if (!interpreters.shell) { skipped.push('shell（未找到 bash）'); continue; }
      checked++;
      try {
        execFileSync('bash', ['-n'], { input: normalizeShell(b.body), stdio: ['pipe', 'ignore', 'pipe'] });
      } catch (e) {
        const msg = (e.stderr?.toString() ?? String(e)).trim().split('\n').pop();
        errors.push({ ...pick(b), msg });
      }
      // sh 块里嵌的 python heredoc 单独按 python 检查（`python3 - <<'PY'` 在技能里很常见）
      for (const hd of splitHeredocs(b.body).heredocs) {
        if (hd.lang !== 'python') continue;
        if (!interpreters.python) { skipped.push('heredoc python（未找到 python3）'); continue; }
        checked++;
        try {
          execFileSync('python3', ['-c', 'import sys; compile(sys.stdin.read(), "<heredoc>", "exec")'],
            { input: hd.body, stdio: ['pipe', 'ignore', 'pipe'] });
        } catch (e) {
          const msg = (e.stderr?.toString() ?? String(e)).trim().split('\n').pop();
          errors.push({ ...pick(b), msg: `heredoc: ${msg}` });
        }
      }
    }
  }
  return { checked, errors, skipped: [...new Set(skipped)], total: blocks.length };
}

const pick = (b) => ({ skill: b.skill, file: b.file, line: b.line, tag: b.tag });
