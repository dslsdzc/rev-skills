#!/usr/bin/env node
// bin/install.mjs — rev-skills 多工具安装器
import { cpSync, rmSync, symlinkSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { convertAll } from './convert.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const SKILLS_SRC = join(__dirname, '..', '.claude', 'skills');

const TARGETS = {
  claude:   { mode: 'native', places: { global: '~/.claude/skills', project: '.claude/skills' } },
  gemini:   { mode: 'native', places: { global: '~/.gemini/skills', project: '.gemini/skills' } },
  cline:    { mode: 'native', places: { project: '.claude/skills' } },
  codex:    { mode: 'native', places: { global: '~/.codex/skills', project: '.codex/skills' } },
  cursor:   { mode: 'rule',   places: { project: '.cursor/rules' }, ruleType: 'cursor' },
  copilot:  { mode: 'rule',   places: { project: '.github' }, ruleType: 'copilot' },
  windsurf: { mode: 'rule',   places: { project: '.windsurf/rules' }, ruleType: 'windsurf' },
};

function expandHome(p) { return p.replace(/^~/, process.env.HOME ?? process.env.USERPROFILE ?? '.'); }
function ask(q) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(res => rl.question(q, a => { rl.close(); res(a.trim()); }));
}

export function planFor(target, scope, opts) {
  const t = TARGETS[target];
  if (!t) throw new Error(`unknown target: ${target} (valid: ${Object.keys(TARGETS).join(', ')}, all)`);
  if (t.mode === 'native') {
    if (!t.places[scope]) throw new Error(`target ${target} does not support --${scope}`);
    const dest = expandHome(t.places[scope]);
    const names = readdirSync(SKILLS_SRC);
    return { mode: 'native', dest, names, link: opts.link };
  }
  if (t.mode === 'rule') {
    if (scope !== 'project') throw new Error(`target ${target} only supports --project`);
    return { mode: 'rule', dest: expandHome(t.places.project), ruleType: t.ruleType };
  }
}

async function installTarget(target, scope, opts) {
  const plan = planFor(target, scope, opts);
  if (plan.mode === 'native') {
    const conflicts = plan.names.filter(n => existsSync(join(plan.dest, n)));
    const selfDestructive = resolve(plan.dest) === resolve(SKILLS_SRC);
    if (!opts.dryRun) {
      mkdirSync(plan.dest, { recursive: true });
      for (const n of plan.names) {
        const src = join(SKILLS_SRC, n), dst = join(plan.dest, n);
        if (existsSync(dst)) {
          if (opts.force && selfDestructive) {
            console.log(`WARN: dest == source, skipping destructive overwrite for ${n}`);
            continue;
          }
          if (opts.force) rmSync(dst, { recursive: true, force: true });
          else { console.log(`SKIP ${n}: exists at ${dst} (use --force to overwrite)`); continue; }
        }
        if (plan.link && !opts.dryRun) {
          try { symlinkSync(src, dst, 'dir'); }
          catch { cpSync(src, dst, { recursive: true }); console.log(`LINK failed for ${n}, copied instead`); }
        } else cpSync(src, dst, { recursive: true });
      }
    }
    console.log(`[${target}] plan: ${plan.names.length} skills → ${plan.dest}${opts.link ? ' (symlink)' : ''}${conflicts.length ? `, ${conflicts.length} conflict(s): ${conflicts.join(', ')}` : ''}`);
    console.log(`[${target}] verify: Claude Code 中运行 /skills 查看，或 ls ${plan.dest}`);
  } else {
    const files = opts.dryRun ? [] : convertAll(plan.ruleType, plan.dest);
    console.log(`[${target}] plan: convert ${readdirSync(SKILLS_SRC).length} skills → ${plan.dest}`);
    if (files.length) console.log(`[${target}] generated: ${files.join(', ')}`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const opts = {
    target: 'claude', scope: null, dryRun: false, link: false, force: false,
    yes: false, uninstall: args[0] === 'uninstall',
  };
  for (let i = opts.uninstall ? 1 : 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--global') opts.scope = 'global';
    else if (a === '--project') opts.scope = 'project';
    else if (a === '--target') opts.target = args[++i] ?? 'claude';
    else if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--link') opts.link = true;
    else if (a === '--force') opts.force = true;
    else if (a === '--yes') opts.yes = true;
  }
  const targets = opts.target === 'all' ? Object.keys(TARGETS) : [opts.target];
  if (opts.uninstall) {
    for (const t of targets) {
      const scope = opts.scope ?? 'project';
      const plan = planFor(t, scope, opts);
      if (plan.mode === 'rule') { console.log(`[${t}] uninstall: remove ${plan.dest} manually (converted rules are plain files)`); continue; }
      if (!opts.dryRun) { for (const n of readdirSync(SKILLS_SRC)) rmSync(join(plan.dest, n), { recursive: true, force: true }); }
      console.log(`[${t}] removed skills from ${plan.dest}`);
    }
    return;
  }
  for (const t of targets) {
    if (!TARGETS[t]) throw new Error(`unknown target: ${t} (valid: ${Object.keys(TARGETS).join(', ')}, all)`);
    let scope = opts.scope;
    if (!scope) {
      const tDef = TARGETS[t];
      const hasGlobal = 'global' in tDef.places, hasProject = 'project' in tDef.places;
      scope = hasGlobal && hasProject ? (opts.yes ? 'global' : await ask(`[${t}] 安装到全局还是项目？(global/project) `)) : (hasGlobal ? 'global' : 'project');
    }
    await installTarget(t, scope, opts);
  }
}

if (process.argv[1] && process.argv[1].endsWith('install.mjs')) {
  main().catch(e => { console.error(`ERROR: ${e.message}`); process.exit(1); });
}
