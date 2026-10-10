#!/usr/bin/env node
// bin/dsh.mjs — rev-skills 的 DSH（DeepSeek Harness）适配 CLI
//
// 为什么单独做一层：DSH 的技能发现与 Claude Code 有一处关键差别——**不合法的技能文件会被
// 静默跳过**（只写一条日志 warning）。技能目录里一个坏 frontmatter 不会让会话报错，只会让
// 该技能从目录里消失，因此需要一个独立闸口把这类文件点名。
//
// 子命令（零依赖，只用 node: 内置模块，ESM，Node >=22）：
//   check [--dir <skillsRoot>] [--json]   按 DSH 发现规则校验技能根
//   preset spec                           打印 DSH 预设 bundle 的安装输入（只打印，不安装）
//   preset status [--profile-dir <dir>] [--json]   只读检查 profile 是否已启用该 bundle
//   preset install [--apply] [--profile-dir <dir>] [--force]
//   preset uninstall [--apply] [--profile-dir <dir>]
//
// 约定：所有会改文件的逻辑都写成纯函数（applyProfileEdits / removeProfileEdits），
// 写入只在 CLI 层发生，且默认 dry-run。本工具**不启动任何子进程**（不调用 pnpm）。
//
// 诚实边界：本文件只按下方 DSH_CHECKS 列出的规则做**行级**判定，不做完整 YAML 校验
// （DSH 内部用完整 YAML 解析器）。`--json` 的 checks 字段逐条列出实际做了哪些检查。

import { readFileSync, writeFileSync, copyFileSync, existsSync, readdirSync, renameSync, statSync, rmSync } from 'node:fs';
import { join, dirname, resolve, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { parseFrontmatterFields } from '../lib/frontmatter.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const REPO_ROOT = resolve(__dirname, '..');
export const BUNDLE_DIR = join(REPO_ROOT, 'dsh');
export const DEFAULT_SKILLS_ROOT = join(REPO_ROOT, '.claude', 'skills');

export const BUNDLE_PACKAGE = 'rev-skills-dsh-preset';
export const PRESET_ID = 'rev-skills';
export const PROFILE_BACKUP = 'package.json.rev-skills.bak';

// DSH 的技能名文法（@deepseek-ai/dsh-skill 的 SKILL_NAME）
export const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
// 标准预设的工具结果裁剪阈值（thresholdChars）——超过只告警，不是错误
export const PRUNE_THRESHOLD_CHARS = 8192;

// 实际执行的检查项清单：`--json` 逐条透出，避免让人以为做了完整 YAML 校验
export const DSH_CHECKS = [
  '布局：只扫一层，识别 <root>/<name>/SKILL.md（目录 bundle）与 <root>/<name>.md（平铺文件），嵌套 **/SKILL.md 不识别',
  '目录 bundle 必须含 SKILL.md',
  'frontmatter 首行是裸 "---"（允许行尾 CR；BOM 开头会失败）',
  'frontmatter 有闭合的 "---" 行',
  'frontmatter 不含 tab 字符',
  'frontmatter 顶层是 key: value 映射（优先用仓库解析子集；它只认 \\w+ 键，遇到 DSH 的连字符键时回落放宽键文法的行级复核。完整 YAML 语义未校验）',
  'name 存在且非空',
  'name 等于目录名（平铺文件等于去扩展名的文件名）',
  'name 匹配 ^[a-z0-9]+(?:-[a-z0-9]+)*$',
  'description 存在且非空',
  '闭合行之后的正文非空',
  'disable-model-invocation / user-invocable 只接受 DSH 布尔文法（驼峰 legacy 键报错）',
  `SKILL.md 超过 ${PRUNE_THRESHOLD_CHARS} 字符时告警（工具结果裁剪阈值，不阻塞发现；计数按检出文件字符数，CRLF 结账会多算换行前的 CR）`,
];

const INVOCATION_BOOL_KEYS = ['disable-model-invocation', 'user-invocable'];
const LEGACY_INVOCATION_KEYS = ['disableModelInvocation', 'modelInvocable', 'userInvocable'];
const TRUE_WORDS = new Set(['true', 'yes', 'on', '1']);
const FALSE_WORDS = new Set(['false', 'no', 'off', '0']);

// 放宽键文法的行级解析（只在本文件内用）。仓库的 lib/frontmatter.mjs 只认 \w+ 键，
// 而 DSH 的 disable-model-invocation / user-invocable 带连字符：那几个键在那里会被判成
// 「顶格游离行」，若直接采信就会把完全合法的技能误报成非法。DSH 用的是完整 YAML 解析器，
// 连字符键是合法 YAML，所以这里回落到与仓库解析器同语义、但键文法放宽到 [A-Za-z0-9_-]+ 的复核。
const LOOSE_KEY = /^([A-Za-z0-9_-]+):[ \t]?(.*)$/;
function parseLooseFrontmatter(raw) {
  const fm = {};
  const lines = raw.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue;
    if (/^\s/.test(line)) continue; // 缩进续行由块标量消费，游离的缩进行按仓库解析器语义忽略
    const kv = LOOSE_KEY.exec(line);
    if (!kv) throw new Error(`顶层第 ${i + 1} 行不是 "key: value" 映射行：${line.slice(0, 60)}`);
    const value = kv[2];
    if (/^[>|][+-]?$/.test(value.trim())) {
      const folded = [];
      while (lines[i + 1] !== undefined && /^\s+/.test(lines[i + 1])) {
        const cont = lines[++i].replace(/^\s+/, '');
        if (cont.trim() !== '') folded.push(cont);
      }
      fm[kv[1]] = folded.join(value.trim()[0] === '>' ? ' ' : '\n').trim();
    } else {
      fm[kv[1]] = value.trim();
    }
  }
  return fm;
}

// 先交仓库解析器（与 validate.mjs 同一套语义），失败时用放宽键文法的复核兜底
function parseFrontmatterForDsh(raw) {
  try {
    return { fm: parseFrontmatterFields(raw), fallback: false };
  } catch (repoError) {
    try {
      return { fm: parseLooseFrontmatter(raw), fallback: true, repoError };
    } catch {
      throw repoError;
    }
  }
}

// ---------- 技能检查 ----------

function entryKind(dir, dirent) {
  if (dirent.isSymbolicLink()) {
    // install --target dsh --link 会产生符号链接/目录联接，按目标类型判定
    try {
      const st = statSync(join(dir, dirent.name));
      return st.isDirectory() ? 'dir' : st.isFile() ? 'file' : 'other';
    } catch { return 'other'; }
  }
  return dirent.isDirectory() ? 'dir' : dirent.isFile() ? 'file' : 'other';
}

// 单文件检查 → { errors, warnings, chars, bodyChars }
export function checkSkillFile(file, expectedName) {
  const errors = [];
  const warnings = [];
  const push = (code, message) => errors.push({ file, name: expectedName ?? null, code, message });
  const text = readFileSync(file, 'utf8');
  const chars = text.length;
  // DSH 的分界行判定容忍行尾 CR，YAML 解析器也不在乎 CRLF；解析与正文计数统一在 LF 归一化后的
  // 文本上做，这样检查结果与结账方式（Windows 上 core.autocrlf=true 会写出 CRLF）无关。
  const src = text.replace(/\r\n?/g, '\n');
  const bail = () => ({ errors, warnings, chars, bodyChars: 0 });

  const lines = src.split('\n');
  const opening = lines[0] ?? '';
  if (opening !== '---') {
    const bom = text.startsWith('\uFEFF') ? '（文件以 BOM 开头，DSH 的首行判定会失败）' : '';
    push('opening-delimiter', `首行不是裸 "---"${bom}，实际是 ${JSON.stringify(opening.slice(0, 40))}`);
    return bail();
  }

  let close = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === '---') { close = i; break; }
  }
  if (close < 0) {
    push('closing-delimiter', 'frontmatter 缺少闭合的 "---" 行');
    return bail();
  }

  const raw = lines.slice(1, close).join('\n');
  const bodyChars = lines.slice(close + 1).join('\n').trim().length;

  if (raw.includes('\t')) push('tab-in-frontmatter', 'frontmatter 含 tab 字符（YAML 不允许用 tab 缩进）');

  let fm = null;
  if (raw.trim() === '') {
    push('empty-frontmatter', 'frontmatter 块为空，YAML 解析结果是 null 而不是映射');
  } else {
    try {
      fm = parseFrontmatterForDsh(raw).fm;
    } catch (e) {
      push('frontmatter-not-mapping', `${e.message}（按仓库解析子集判定；完整 YAML 语义未校验）`);
    }
  }

  const name = typeof fm?.name === 'string' ? fm.name.trim() : '';
  const description = typeof fm?.description === 'string' ? fm.description.trim() : '';

  if (!name) push('name-missing', 'frontmatter 缺少非空的 name');
  else {
    if (!SKILL_NAME_PATTERN.test(name)) push('name-invalid', `name "${name}" 不符合 ^[a-z0-9]+(?:-[a-z0-9]+)*$`);
    if (expectedName !== undefined && expectedName !== null && name !== expectedName) {
      push('name-mismatch', `name "${name}" 与目录/文件名 "${expectedName}" 不一致`);
    }
  }
  if (!description) push('description-missing', 'frontmatter 缺少非空的 description');
  if (bodyChars === 0) push('empty-body', '闭合 "---" 之后的正文为空');

  for (const key of LEGACY_INVOCATION_KEYS) {
    if (fm && Object.hasOwn(fm, key)) {
      const canonical = key === 'userInvocable' ? 'user-invocable' : 'disable-model-invocation';
      push('legacy-invocation-key', `frontmatter 字段 "${key}" 不被支持，DSH 要求写成 "${canonical}"`);
    }
  }
  for (const key of INVOCATION_BOOL_KEYS) {
    if (!fm || !Object.hasOwn(fm, key)) continue;
    const v = String(fm[key]).trim().toLowerCase();
    if (v !== '' && !TRUE_WORDS.has(v) && !FALSE_WORDS.has(v)) {
      push('invalid-invocation-value', `frontmatter 字段 "${key}" 的值 ${JSON.stringify(fm[key])} 不是 DSH 接受的布尔写法`);
    }
  }

  if (chars > PRUNE_THRESHOLD_CHARS) {
    warnings.push({
      file, name: expectedName ?? name ?? null, code: 'prune-threshold', chars, bodyChars,
      message: `SKILL.md ${chars} 字符 > ${PRUNE_THRESHOLD_CHARS}，被标准预设加载时可能被裁剪（正文 ${bodyChars} 字符）`,
    });
  }
  return { errors, warnings, chars, bodyChars };
}

// 校验整个技能根 → { ok, root, total, errors[], warnings[], skills[], skipped[], checks[] }
export function checkSkills(root) {
  const errors = [];
  const warnings = [];
  const skills = [];
  const skipped = [];
  const base = { root, checks: DSH_CHECKS };

  if (!existsSync(root)) {
    return {
      ...base, ok: false, total: 0, errors: [{ file: root, name: null, code: 'root-missing', message: `技能根不存在：${root}` }],
      warnings: [], skills: [], skipped,
    };
  }

  const entries = readdirSync(root, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const e of entries) {
    if (e.name.startsWith('.')) { skipped.push(e.name); continue; }
    const full = join(root, e.name);
    const kind = entryKind(root, e);

    let file = null;
    let name = null;
    let layout = null;
    if (kind === 'dir') {
      layout = 'bundle';
      name = e.name;
      file = join(full, 'SKILL.md');
      if (!existsSync(file)) {
        errors.push({ file: full, name, code: 'missing-skill-md', message: `目录 bundle 缺 SKILL.md：${full}` });
        skills.push({ name, layout, file: null, chars: 0, bodyChars: 0 });
        continue;
      }
    } else if (kind === 'file' && e.name.endsWith('.md')) {
      layout = 'flat';
      name = e.name.slice(0, -3);
      file = full;
    } else {
      skipped.push(e.name);
      continue;
    }

    const r = checkSkillFile(file, name);
    errors.push(...r.errors);
    warnings.push(...r.warnings);
    skills.push({ name, layout, file, chars: r.chars, bodyChars: r.bodyChars });
  }

  return { ...base, ok: errors.length === 0, total: skills.length, errors, warnings, skills, skipped };
}

// ---------- profile 状态 ----------

// 默认 profile 目录：$DSH_PROFILE_DIR → $DSH_HOME/profiles/desktop → ~/.dsh/profiles/desktop
export function resolveProfileDir(explicit, env = process.env) {
  if (explicit) return resolve(explicit);
  if (env.DSH_PROFILE_DIR) return env.DSH_PROFILE_DIR;
  const home = env.DSH_HOME || join(homedir(), '.dsh');
  return join(home, 'profiles', 'desktop');
}

export function linkSpec(bundleDir) {
  return `link:${resolve(bundleDir).split(sep).join('/')}`;
}

function normalizeSpecPath(spec) {
  if (typeof spec !== 'string' || spec.trim() === '') return null;
  const m = /^(?:link|file):(.*)$/i.exec(spec.trim());
  const p = (m ? m[1] : spec).trim();
  if (!p) return null;
  const abs = isAbsolute(p) ? p : resolve(p);
  const norm = abs.split(/[\\/]+/).join('/').replace(/\/+$/, '');
  return process.platform === 'win32' ? norm.toLowerCase() : norm;
}

export function dependencyMatchesBundle(spec, bundleDir) {
  const a = normalizeSpecPath(spec);
  if (a === null) return false;
  return a === normalizeSpecPath(resolve(bundleDir));
}

// 在 Cordis 补丁文本里找预设行：行形如 `id: <名字>`（可带 `- ` 前缀、可带引号）
// 同时接受 Loader 行 id（preset-<id>）与 config.id（<id>）
export function findPresetRow(text, id = PRESET_ID) {
  const lines = String(text).split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = /^\s*(?:-\s*)?id:\s*['"]?([^'"\s#]+)['"]?\s*$/.exec(lines[i]);
    if (!m) continue;
    if (m[1] === id || m[1] === `preset-${id}`) {
      return { line: i + 1, id: m[1], text: lines[i].trim() };
    }
  }
  return null;
}

// 只读：profile 与 bundle 的一致性快照（测试直接用它，不需要真实 profile）
export function readProfileState(profileDir = resolveProfileDir(), bundleDir = BUNDLE_DIR) {
  const profileFile = join(profileDir, 'package.json');
  const bundleFile = join(bundleDir, 'package.json');
  const state = {
    profileDir, profileFile, profileExists: existsSync(profileFile), profileError: null, pkg: null,
    bundleDir, bundleFile, bundleExists: existsSync(bundleFile), bundleError: null,
    bundleName: BUNDLE_PACKAGE, patchFile: null, patchExists: false,
    presetRowFound: false, presetRow: null,
    bundles: [], listedInBundles: false, dependencyEntry: null, dependencyMatchesBundle: false,
    ok: false,
  };

  if (!state.profileExists) state.profileError = `profile package.json 不存在：${profileFile}`;
  else {
    try { state.pkg = JSON.parse(readFileSync(profileFile, 'utf8')); }
    catch (e) { state.profileError = `profile package.json 不是合法 JSON：${e.message}`; }
  }

  if (state.bundleExists) {
    let bp = null;
    try { bp = JSON.parse(readFileSync(bundleFile, 'utf8')); }
    catch (e) { state.bundleError = `bundle package.json 不是合法 JSON：${e.message}`; }
    const rel = bp?.dsh?.bundle?.patch;
    state.patchFile = join(bundleDir, typeof rel === 'string' && rel.trim() !== '' ? rel : 'cordis.patch.yml');
  } else {
    state.bundleError = `bundle 不存在：${bundleFile}`;
    state.patchFile = join(bundleDir, 'cordis.patch.yml');
  }
  state.patchExists = existsSync(state.patchFile);
  if (state.patchExists) {
    state.presetRow = findPresetRow(readFileSync(state.patchFile, 'utf8'), PRESET_ID);
    state.presetRowFound = state.presetRow !== null;
  }

  const bundles = state.pkg?.dsh?.profile?.bundles;
  state.bundles = Array.isArray(bundles) ? bundles : [];
  state.listedInBundles = state.bundles.includes(BUNDLE_PACKAGE);
  const dep = state.pkg?.dependencies?.[BUNDLE_PACKAGE];
  state.dependencyEntry = typeof dep === 'string' ? dep : null;
  state.dependencyMatchesBundle = dependencyMatchesBundle(state.dependencyEntry, bundleDir);
  state.ok = state.bundleExists && state.listedInBundles && state.dependencyEntry !== null
    && state.presetRowFound && state.dependencyMatchesBundle;
  return state;
}

// ---------- profile 编辑（纯函数，不碰文件） ----------

function clone(v) { return JSON.parse(JSON.stringify(v)); }

function snapshot(pkg, bundleName) {
  return {
    bundles: Array.isArray(pkg?.dsh?.profile?.bundles) ? [...pkg.dsh.profile.bundles] : [],
    dependency: typeof pkg?.dependencies?.[bundleName] === 'string' ? pkg.dependencies[bundleName] : null,
  };
}

// 追加 bundle：bundles 去重追加、依赖设为 link:<绝对路径>。幂等。
export function applyProfileEdits(pkg, bundleDir = BUNDLE_DIR, bundleName = BUNDLE_PACKAGE) {
  const before = snapshot(pkg, bundleName);
  const next = clone(pkg ?? {});
  if (next.dsh === undefined || next.dsh === null || typeof next.dsh !== 'object') next.dsh = {};
  if (next.dsh.profile === undefined || next.dsh.profile === null || typeof next.dsh.profile !== 'object') next.dsh.profile = {};
  const bundles = Array.isArray(next.dsh.profile.bundles) ? next.dsh.profile.bundles : [];
  if (!bundles.includes(bundleName)) bundles.push(bundleName);
  next.dsh.profile.bundles = bundles;
  if (next.dependencies === undefined || next.dependencies === null || typeof next.dependencies !== 'object') next.dependencies = {};
  next.dependencies[bundleName] = linkSpec(bundleDir);
  const after = snapshot(next, bundleName);
  return { next, before, after, changed: before.bundles.join('\n') !== after.bundles.join('\n') || before.dependency !== after.dependency };
}

// 移除 bundle：从 bundles 删名、删依赖键。幂等。不改 dsh.profile 的其它键。
export function removeProfileEdits(pkg, bundleName = BUNDLE_PACKAGE) {
  const before = snapshot(pkg, bundleName);
  const next = clone(pkg ?? {});
  if (Array.isArray(next.dsh?.profile?.bundles)) {
    next.dsh.profile.bundles = next.dsh.profile.bundles.filter((x) => x !== bundleName);
  }
  if (next.dependencies && typeof next.dependencies === 'object') delete next.dependencies[bundleName];
  const after = snapshot(next, bundleName);
  return { next, before, after, changed: before.bundles.join('\n') !== after.bundles.join('\n') || before.dependency !== after.dependency };
}

function detectIndent(text) {
  const m = /^([ \t]+)"/m.exec(String(text));
  return m ? m[1] : '  ';
}

// 原子写：先写临时文件再改名，避免半截文件
function writeFileAtomic(file, text) {
  const tmp = `${file}.rev-skills.tmp`;
  try {
    writeFileSync(tmp, text);
    renameSync(tmp, file);
  } catch (e) {
    try { rmSync(tmp, { force: true }); } catch { /* 临时文件清理失败不掩盖原错误 */ }
    throw e;
  }
}

export function serializeProfile(pkg, originalText) {
  return `${JSON.stringify(pkg, null, detectIndent(originalText))}\n`;
}

// ---------- 预设 bundle 的本地解析 ----------

export function readBundleManifest(bundleDir = BUNDLE_DIR) {
  const file = join(bundleDir, 'package.json');
  if (!existsSync(file)) return { file, exists: false, manifest: null, error: `bundle 不存在：${file}` };
  try { return { file, exists: true, manifest: JSON.parse(readFileSync(file, 'utf8')), error: null }; }
  catch (e) { return { file, exists: true, manifest: null, error: `bundle package.json 不是合法 JSON：${e.message}` }; }
}

// 本地解析预设实际挂载的技能根。补丁里的 `!!js` 表达式按「REV_SKILLS_DIR → DSH 用户根 →
// 包解析」顺序取第一个「存在且至少含一个 re- 条目」的候选；这里复现可在本机判定的那几项
// （包解析那两项需要先安装依赖，标记为不可本地判定），并按同一判据选出生效项。
export function resolveLocalSkillRoot(env = process.env, repoRoot = REPO_ROOT) {
  const candidates = [];
  const add = (source, root, resolvable = true) => {
    if (!root) return;
    const exists = existsSync(root);
    candidates.push({ source, root, exists, skills: exists ? countSkills(root) : null, resolvable });
  };
  const rev = env.REV_SKILLS_DIR;
  add('REV_SKILLS_DIR → <dir>/.claude/skills', rev ? join(rev, '.claude', 'skills') : null);
  add('REV_SKILLS_DIR（直接指向技能根）', rev || null);
  const dshHome = env.DSH_HOME || join(homedir(), '.dsh');
  add('$DSH_HOME/skills（无环境变量时的最终回落）', join(dshHome, 'skills'));
  add('仓库技能根 <repo>/.claude/skills（补丁里由 bundle/.. 解析得到）', join(repoRoot, '.claude', 'skills'));
  candidates.push({ source: '从 rev-skills / rev-skills-dsh-preset 的 package.json 反解', root: null, exists: null, skills: null, resolvable: false });
  const active = candidates.find((c) => c.resolvable && c.exists && (c.skills ?? 0) > 0) ?? null;
  return { candidates, active };
}

function countSkills(root) {
  if (!existsSync(root)) return null;
  try { return readdirSync(root).filter((n) => n.startsWith('re-')).length; }
  catch { return null; }
}

// ---------- CLI ----------

const USAGE = `用法：
  node bin/dsh.mjs check [--dir <skillsRoot>] [--json]
      按 DSH 技能发现规则校验技能根（默认 ${DEFAULT_SKILLS_ROOT}）
  node bin/dsh.mjs preset spec
      打印 DSH 预设 bundle（${BUNDLE_DIR}）的安装输入：bundle 绝对路径、profile package.json 编辑、等价 pnpm 命令
  node bin/dsh.mjs preset status [--profile-dir <dir>] [--json]
      只读检查 profile 是否已启用该 bundle（默认 $DSH_PROFILE_DIR → $DSH_HOME/profiles/desktop → ~/.dsh/profiles/desktop）
  node bin/dsh.mjs preset install [--profile-dir <dir>] [--force] [--apply]
      默认 dry-run 只打印将要做的编辑；--apply 才写文件（先备份 ${PROFILE_BACKUP}）
  node bin/dsh.mjs preset uninstall [--profile-dir <dir>] [--apply]
      默认 dry-run；--apply 删除 bundles 与依赖项，存在备份时从备份还原

本工具只读写 JSON 文件，不启动任何子进程（不调用 pnpm），也不会改动技能目录。`;

function parseArgs(argv) {
  const opts = { dir: null, profileDir: null, json: false, apply: false, force: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dir') opts.dir = argv[++i];
    else if (a === '--profile-dir') opts.profileDir = argv[++i];
    else if (a === '--json') opts.json = true;
    else if (a === '--apply') opts.apply = true;
    else if (a === '--force') opts.force = true;
    else if (a === '--help' || a === '-h') opts.help = true;
    else return { error: `未知参数：${a}` };
  }
  return opts;
}

function runCheck(opts) {
  const root = opts.dir ? resolve(opts.dir) : DEFAULT_SKILLS_ROOT;
  const result = checkSkills(root);
  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
    return result.ok ? 0 : 1;
  }
  console.log(`skills root: ${result.root}`);
  for (const w of result.warnings) console.log(`WARN: ${w.file} — ${w.message}`);
  if (!result.ok) {
    for (const e of result.errors) console.error(`FAIL: ${e.file} — ${e.message}`);
    console.error(`FAIL: ${result.errors.length} error(s) / ${result.total} skills checked, ${result.warnings.length} warning(s)`);
    return 1;
  }
  console.log(`OK: ${result.total} skills DSH-compatible (${result.warnings.length} warning(s))`);
  return 0;
}

function printEdits(before, after) {
  console.log(`dsh.profile.bundles:`);
  console.log(`  before: ${JSON.stringify(before.bundles)}`);
  console.log(`  after:  ${JSON.stringify(after.bundles)}`);
  console.log(`dependencies["${BUNDLE_PACKAGE}"]:`);
  console.log(`  before: ${JSON.stringify(before.dependency)}`);
  console.log(`  after:  ${JSON.stringify(after.dependency)}`);
}

function runSpec() {
  const bundle = readBundleManifest();
  const patchRel = typeof bundle.manifest?.dsh?.bundle?.patch === 'string' ? bundle.manifest.dsh.bundle.patch : './cordis.patch.yml';
  const patchFile = resolve(BUNDLE_DIR, patchRel);
  const spec = linkSpec(BUNDLE_DIR);
  const local = resolveLocalSkillRoot();

  console.log('## DSH 预设安装输入');
  console.log(`bundle 绝对路径（DSH 插件管理器「安装 bundle」字段填这一行）：`);
  console.log(`  ${resolve(BUNDLE_DIR)}`);
  console.log(`bundle package.json: ${bundle.file}（${bundle.exists ? '存在' : '缺失'}）`);
  if (bundle.error) console.log(`  note: ${bundle.error}`);
  console.log(`包名: ${BUNDLE_PACKAGE}`);
  console.log(`补丁文件: ${patchFile}（${existsSync(patchFile) ? '存在' : '缺失'}）`);
  console.log(`预设行: Loader id preset-${PRESET_ID} / config.id ${PRESET_ID}`);
  console.log('');
  console.log('profile package.json 需要追加的编辑（等价 JSON 片段）：');
  console.log(JSON.stringify({
    dsh: { profile: { bundles: [`...（保留现有项）`, BUNDLE_PACKAGE] } },
    dependencies: { [BUNDLE_PACKAGE]: spec },
  }, null, 2));
  console.log('');
  console.log('等价的 pnpm 命令（在 profile 目录执行；bundles 清单仍需上面的编辑或插件管理器 toggle）：');
  console.log(`  pnpm add "${spec}"`);
  console.log('');
  console.log(`REV_SKILLS_DIR: ${process.env.REV_SKILLS_DIR || '未设置（设置后是补丁里的第一优先候选）'}`);
  console.log('预设技能根候选（补丁 !!js 的取用顺序；生效项 = 第一个存在且含 re- 条目的候选）：');
  for (const c of local.candidates) {
    if (!c.resolvable) { console.log(`  - ${c.source}（需要先安装依赖，本工具不代跑 pnpm）`); continue; }
    const mark = local.active && local.active.root === c.root ? ' ← 生效' : '';
    const state = c.exists ? `存在，re- 技能 ${c.skills}` : '不存在';
    console.log(`  - ${c.source} → ${c.root}（${state}）${mark}`);
  }
  if (local.active) console.log(`生效技能根：${local.active.root}`);
  else console.log('生效技能根：无可判定候选（补丁会把该预设的技能目录解析为空，DSH 会回落到 $DSH_HOME/skills）');
  console.log('本命令只打印，不安装、不写任何文件。');
  return 0;
}

function printStatus(state) {
  console.log(`[preset status] profile: ${state.profileDir}`);
  console.log(`  profile package.json: ${state.profileExists ? '存在' : '缺失'}${state.profileError ? `（${state.profileError}）` : ''}`);
  console.log(`  bundle package.json: ${state.bundleExists ? '存在' : '缺失'}${state.bundleError ? `（${state.bundleError}）` : ''}`);
  console.log(`  补丁文件: ${state.patchFile}（${state.patchExists ? '存在' : '缺失'}）`);
  console.log(`  预设行 id: ${PRESET_ID}: ${state.presetRowFound ? `存在（第 ${state.presetRow.line} 行：${state.presetRow.id}）` : '缺失'}`);
  console.log(`  dsh.profile.bundles 含 ${BUNDLE_PACKAGE}: ${state.listedInBundles ? '是' : '否'}（现有 ${state.bundles.length} 项）`);
  console.log(`  dependencies["${BUNDLE_PACKAGE}"]: ${state.dependencyEntry === null ? '缺失' : JSON.stringify(state.dependencyEntry)}`);
  console.log(`  依赖指向本 bundle: ${state.dependencyMatchesBundle ? '是' : '否'}`);
  if (state.ok) console.log('OK: 已安装且一致');
  else console.log(`未安装或不一致：${[!state.bundleExists && 'bundle 缺失', !state.presetRowFound && '补丁缺预设行', !state.listedInBundles && 'bundles 未列出', state.dependencyEntry === null && '依赖缺失', state.dependencyEntry !== null && !state.dependencyMatchesBundle && '依赖不指向本 bundle', state.profileError && 'profile 不可读'].filter(Boolean).join(' / ')}`);
}

function runStatus(opts) {
  const state = readProfileState(resolveProfileDir(opts.profileDir));
  if (opts.json) { console.log(JSON.stringify(state, null, 2)); return state.ok ? 0 : 1; }
  printStatus(state);
  return state.ok ? 0 : 1;
}

function loadProfileForWrite(profileDir) {
  const profileFile = join(profileDir, 'package.json');
  if (!existsSync(profileFile)) return { error: `profile package.json 不存在：${profileFile}` };
  const text = readFileSync(profileFile, 'utf8');
  try { return { profileFile, text, pkg: JSON.parse(text) }; }
  catch (e) { return { error: `profile package.json 不是合法 JSON：${e.message}` }; }
}

function runInstall(opts) {
  const profileDir = resolveProfileDir(opts.profileDir);
  const loaded = loadProfileForWrite(profileDir);
  if (loaded.error) { console.error(`ERROR: ${loaded.error}`); return 1; }
  const bundleFile = join(BUNDLE_DIR, 'package.json');
  if (!existsSync(bundleFile)) { console.error(`ERROR: bundle 不存在：${bundleFile}`); return 1; }

  const edits = applyProfileEdits(loaded.pkg, BUNDLE_DIR);
  const backupFile = join(profileDir, PROFILE_BACKUP);
  const manualStep = `在 profile 目录（${profileDir}）执行 pnpm install（或改用 GUI 插件管理器安装依赖），然后重启 DSH`;

  if (!opts.apply) {
    if (opts.json) {
      console.log(JSON.stringify({ applied: false, dryRun: true, profileFile: loaded.profileFile, backupFile, before: edits.before, after: edits.after, manualStep }, null, 2));
      return 0;
    }
    console.log('[preset install] dry-run：未写任何文件');
    console.log(`profile: ${loaded.profileFile}`);
    printEdits(edits.before, edits.after);
    console.log(`加 --apply 才会写入（写入前备份到 ${PROFILE_BACKUP}）`);
    return 0;
  }

  const backupExisted = existsSync(backupFile);
  if (backupExisted && !opts.force) {
    console.error(`ERROR: 备份已存在，拒绝覆盖：${backupFile}（确认后可加 --force）`);
    return 1;
  }
  try {
    if (!backupExisted) copyFileSync(loaded.profileFile, backupFile);
    writeFileAtomic(loaded.profileFile, serializeProfile(edits.next, loaded.text));
  } catch (e) {
    console.error(`ERROR: 写入失败，package.json 未被修改：${e.message}`);
    return 1;
  }
  if (opts.json) {
    console.log(JSON.stringify({ applied: true, profileFile: loaded.profileFile, backupFile, backupExisted, before: edits.before, after: edits.after, manualStep }, null, 2));
    return 0;
  }
  console.log(`[preset install] profile: ${loaded.profileFile}`);
  printEdits(edits.before, edits.after);
  console.log(`已写入 ${loaded.profileFile}；备份 ${backupFile}`);
  console.log(`后续手动步骤：${manualStep}。`);
  return 0;
}

function runUninstall(opts) {
  const profileDir = resolveProfileDir(opts.profileDir);
  const loaded = loadProfileForWrite(profileDir);
  if (loaded.error) { console.error(`ERROR: ${loaded.error}`); return 1; }

  const backupFile = join(profileDir, PROFILE_BACKUP);
  const backupExists = existsSync(backupFile);
  let backupText = null;
  if (backupExists) {
    backupText = readFileSync(backupFile, 'utf8');
    try { JSON.parse(backupText); }
    catch (e) { console.error(`ERROR: 备份不是合法 JSON，未改动任何文件：${backupFile}（${e.message}）`); return 1; }
  }

  const edits = removeProfileEdits(loaded.pkg);
  const manualStep = `在 profile 目录（${profileDir}）执行 pnpm install（或改用 GUI 插件管理器）并重启 DSH，使移除生效`;
  const plan = { applied: opts.apply, profileFile: loaded.profileFile, backupFile, restoreFromBackup: backupExists, before: edits.before, after: edits.after, manualStep };

  if (!opts.apply) {
    if (opts.json) { console.log(JSON.stringify({ ...plan, dryRun: true }, null, 2)); return 0; }
    console.log('[preset uninstall] dry-run：未写任何文件');
    console.log(`profile: ${loaded.profileFile}`);
    printEdits(edits.before, edits.after);
    console.log(backupExists ? `把 ${PROFILE_BACKUP} 的内容还原回 package.json（备份保留）` : '没有备份，按上面的 after 写回');
    console.log('加 --apply 才会写入');
    return 0;
  }

  try {
    writeFileAtomic(loaded.profileFile, backupExists ? backupText : serializeProfile(edits.next, loaded.text));
  } catch (e) {
    console.error(`ERROR: 写入失败，package.json 未被修改：${e.message}`);
    return 1;
  }
  if (opts.json) { console.log(JSON.stringify(plan, null, 2)); return 0; }
  console.log(`[preset uninstall] profile: ${loaded.profileFile}`);
  printEdits(edits.before, edits.after);
  console.log(backupExists ? `还原来源：${backupFile}（备份保留）` : '没有备份，按上面的 after 写回');
  console.log(`已写入 ${loaded.profileFile}`);
  console.log(`后续手动步骤：${manualStep}。`);
  return 0;
}

function main(argv) {
  const cmd = argv[0];
  if (cmd === undefined) {
    console.error(USAGE);
    return 1;
  }
  if (cmd === '--help' || cmd === '-h') {
    console.log(USAGE);
    return 0;
  }
  if (cmd === 'check') {
    const opts = parseArgs(argv.slice(1));
    if (opts.error) { console.error(`ERROR: ${opts.error}`); console.error(USAGE); return 1; }
    return runCheck(opts);
  }
  if (cmd === 'preset') {
    const sub = argv[1];
    if (!['spec', 'status', 'install', 'uninstall'].includes(sub)) {
      console.error(`ERROR: 未知子命令：${`preset ${sub ?? ''}`.trim()}`);
      console.error(USAGE);
      return 1;
    }
    const opts = parseArgs(argv.slice(2));
    if (opts.error) { console.error(`ERROR: ${opts.error}`); console.error(USAGE); return 1; }
    if (sub === 'spec') return runSpec();
    if (sub === 'status') return runStatus(opts);
    if (sub === 'install') return runInstall(opts);
    return runUninstall(opts);
  }
  console.error(`ERROR: 未知子命令：${cmd}`);
  console.error(USAGE);
  return 1;
}

if (process.argv[1] && process.argv[1].endsWith('dsh.mjs')) {
  try { process.exitCode = main(process.argv.slice(2)); }
  catch (e) { console.error(`ERROR: ${e.message}`); process.exitCode = 1; }
}
