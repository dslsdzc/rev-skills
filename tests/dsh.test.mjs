import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  checkSkills, checkSkillFile, applyProfileEdits, removeProfileEdits, readProfileState,
  findPresetRow, dependencyMatchesBundle, resolveProfileDir, resolveLocalSkillRoot, linkSpec,
  SKILL_NAME_PATTERN, PRUNE_THRESHOLD_CHARS, BUNDLE_PACKAGE, PRESET_ID, BUNDLE_DIR,
  DEFAULT_SKILLS_ROOT, PROFILE_BACKUP,
} from '../bin/dsh.mjs';

// 夹具放在 tests/fixtures-dsh/ 而不是 tests/fixtures/dsh-*/：tests/validate.test.mjs 的
// collectSkills 断言了 tests/fixtures/ 一级目录的完整名单，往里加目录会让那条断言变红，
// 而那个文件不在本任务的改动范围内。细节见 tests/fixtures-dsh/README.md。
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');
const CLI = join(REPO, 'bin', 'dsh.mjs');
const FIX = join(HERE, 'fixtures-dsh');

function runCli(args) {
  return spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', cwd: REPO });
}

function withTempDir(prefix, fn) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  try { return fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}

const writeJson = (file, obj) => writeFileSync(file, `${JSON.stringify(obj, null, 2)}\n`);
const skillFile = (name, extra = '') => `---\nname: ${name}\ndescription: 夹具技能。fixture skill.${extra}\ntype: atomic\n---\n\n## 什么时候用\n\n夹具正文。\n`;
const bundleExists = existsSync(join(BUNDLE_DIR, 'package.json'));

// ---------- checkSkills：真实技能根 ----------

test('checkSkills：真实技能根 0 错误，超阈值告警与目录实测一致', () => {
  const r = checkSkills(DEFAULT_SKILLS_ROOT);
  assert.deepEqual(r.errors, [], `真实技能根不应有错误：${JSON.stringify(r.errors.slice(0, 3))}`);
  assert.equal(r.ok, true);

  // 技能数与告警名单都从目录实测推导（技能数会变，阈值不会）
  const dirs = readdirSync(DEFAULT_SKILLS_ROOT, { withFileTypes: true }).filter((e) => e.isDirectory());
  assert.equal(r.total, dirs.length);
  assert.equal(r.skills.length, dirs.length);

  const over = dirs
    .map((e) => ({ name: e.name, chars: readFileSync(join(DEFAULT_SKILLS_ROOT, e.name, 'SKILL.md'), 'utf8').length }))
    .filter((x) => x.chars > PRUNE_THRESHOLD_CHARS);
  assert.ok(over.length > 0, '本库确实存在超过 8192 字符的技能，告警路径才有覆盖');
  assert.deepEqual(r.warnings.map((w) => w.name).sort(), over.map((x) => x.name).sort());
  for (const w of r.warnings) {
    assert.equal(w.code, 'prune-threshold');
    assert.equal(w.chars, readFileSync(w.file, 'utf8').length);
    assert.ok(w.chars > PRUNE_THRESHOLD_CHARS);
    assert.ok(w.bodyChars > 0);
  }
  // 超阈值只告警：这些技能仍在 skills 列表里，且没有任何一条因此变成错误
  const worst = over.sort((a, b) => b.chars - a.chars)[0];
  assert.equal(r.skills.find((s) => s.name === worst.name).layout, 'bundle');
  assert.equal(r.errors.some((e) => e.name === worst.name), false);
});

test('checkSkills：技能根不存在报 root-missing 而不是静默通过', () => {
  const r = checkSkills(join(FIX, 'no-such-root'));
  assert.equal(r.ok, false);
  assert.equal(r.total, 0);
  assert.deepEqual(r.errors.map((e) => e.code), ['root-missing']);
});

// ---------- CRLF 回归（Windows core.autocrlf=true 的结账） ----------

test('checkSkillFile/checkSkills：CRLF 文件必须 0 错误', () => {
  withTempDir('dsh-crlf-', (dir) => {
    const root = join(dir, 'skills');
    mkdirSync(join(root, 're-crlf'), { recursive: true });
    const crlf = skillFile('re-crlf').replace(/\n/g, '\r\n');
    assert.ok(crlf.includes('\r\n'), '夹具必须是真正的 CRLF 字节');
    const file = join(root, 're-crlf', 'SKILL.md');
    writeFileSync(file, crlf);
    assert.deepEqual(checkSkillFile(file, 're-crlf').errors, []);
    const r = checkSkills(root);
    assert.equal(r.ok, true, `CRLF 技能根不应报错：${JSON.stringify(r.errors)}`);
    assert.equal(r.total, 1);

    // 块标量 + CRLF：description 仍要解析出来（不能被 \r 截断成空）
    writeFileSync(file, '---\r\nname: re-crlf\r\ndescription: >\r\n  CRLF 折行描述。folded description\r\n---\r\n\r\n## 正文\r\n\r\n正文\r\n');
    assert.deepEqual(checkSkillFile(file, 're-crlf').errors, []);
    assert.equal(checkSkills(root).total, 1);

    // BOM 是真故障，仍须点名（BOM 会让首行 != "---"）
    writeFileSync(file, `\uFEFF${crlf}`);
    assert.deepEqual(checkSkillFile(file, 're-crlf').errors.map((e) => e.code), ['opening-delimiter']);
  });
});

// ---------- 错误类夹具 ----------

test('checkSkills：夹具覆盖全部错误类，合法夹具不误报', () => {
  const r = checkSkills(join(FIX, 'check-errors'));
  assert.equal(r.ok, false);
  assert.equal(r.total, 14);

  const codes = [...new Set(r.errors.map((e) => e.code))].sort();
  assert.deepEqual(codes, [
    'closing-delimiter', 'description-missing', 'empty-body', 'empty-frontmatter', 'frontmatter-not-mapping',
    'invalid-invocation-value', 'legacy-invocation-key', 'missing-skill-md', 'name-invalid', 'name-mismatch',
    'name-missing', 'opening-delimiter', 'tab-in-frontmatter',
  ]);

  // 合法对照：re-ok；re-hyphen-keys 是「仓库解析器只认 \w+ 键」那条误报的回归
  for (const name of ['re-ok', 're-hyphen-keys']) {
    assert.deepEqual(r.errors.filter((e) => e.name === name), [], `${name} 是合法夹具，不应报错`);
  }
  // 目录里没有 SKILL.md：报 missing-skill-md，占位 README.md 不能被当成技能
  assert.ok(r.errors.some((e) => e.code === 'missing-skill-md' && e.name === 're-no-skill-md'));
  assert.equal(r.skills.find((s) => s.name === 're-no-skill-md').file, null);
  // 隐藏项与非 .md 文件进 skipped，不计入技能
  assert.deepEqual([...r.skipped].sort(), ['.hidden', 'notes.txt']);
  // re-tabs 夹具必须真的含 TAB，否则这条用例是空转
  assert.ok(readFileSync(join(FIX, 'check-errors', 're-tabs', 'SKILL.md'), 'utf8').includes('\t'), 're-tabs 夹具必须含真实 TAB');
  // 每条错误都带文件路径
  for (const e of r.errors) assert.ok(typeof e.file === 'string' && e.file.length > 0, `错误缺文件路径：${JSON.stringify(e)}`);
});

test('checkSkills：平铺形态按文件名判名字，超阈值只告警不报错', () => {
  const flat = checkSkills(join(FIX, 'flat-root'));
  assert.equal(flat.ok, false);
  assert.deepEqual(flat.skills.map((s) => s.layout).sort(), ['flat', 'flat']);
  assert.deepEqual(flat.errors.map((e) => [e.name, e.code]), [['Not-Kebab', 'name-invalid']]);
  assert.equal(flat.errors[0].file, join(FIX, 'flat-root', 'Not-Kebab.md'));

  const long = checkSkills(join(FIX, 'long'));
  assert.equal(long.ok, true, '超阈值不是错误');
  assert.deepEqual(long.errors, []);
  assert.deepEqual(long.warnings.map((w) => w.code), ['prune-threshold']);
  assert.equal(long.warnings[0].chars, readFileSync(join(FIX, 'long', 're-long', 'SKILL.md'), 'utf8').length);
  assert.ok(long.warnings[0].chars > PRUNE_THRESHOLD_CHARS);
});

test('技能名文法与常量：kebab-case 正则与裁剪阈值', () => {
  assert.equal(SKILL_NAME_PATTERN.test('re-analyze'), true);
  assert.equal(SKILL_NAME_PATTERN.test('re-Bad_Name'), false);
  assert.equal(SKILL_NAME_PATTERN.test('re--x'), false);
  assert.equal(SKILL_NAME_PATTERN.test('re-'), false);
  assert.equal(PRUNE_THRESHOLD_CHARS, 8192);
  assert.equal(BUNDLE_PACKAGE, 'rev-skills-dsh-preset');
  assert.equal(PRESET_ID, 'rev-skills');
});

// ---------- CLI：check ----------

test('CLI check：通过时打印 OK 汇总行并退出 0，--json 可解析', () => {
  const text = runCli(['check']);
  assert.equal(text.status, 0, `stderr: ${text.stderr}`);
  const summary = text.stdout.split('\n').find((l) => l.startsWith('OK: '));
  assert.ok(summary, `缺少 OK 汇总行：\n${text.stdout}`);
  assert.match(summary, /^OK: \d+ skills DSH-compatible \(\d+ warning\(s\)\)$/);

  const dirs = readdirSync(DEFAULT_SKILLS_ROOT, { withFileTypes: true }).filter((e) => e.isDirectory()).length;
  const json = runCli(['check', '--json']);
  assert.equal(json.status, 0);
  const obj = JSON.parse(json.stdout);
  assert.equal(obj.ok, true);
  assert.equal(obj.total, dirs);
  assert.deepEqual(obj.errors, []);
  assert.equal(obj.warnings.length > 0, true);
  assert.equal(obj.checks.length > 0, true, '--json 应逐条列出实际做了哪些检查');
});

test('CLI check：有错时逐条打到 stderr 并退出 1', () => {
  const r = runCli(['check', '--dir', join(FIX, 'check-errors')]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /^FAIL: .+ — /m);
  assert.match(r.stderr, /FAIL: \d+ error\(s\) \/ 14 skills checked/);
  assert.ok(r.stdout.includes('skills root: '), '根路径应在 stdout 上给出');

  const json = runCli(['check', '--dir', join(FIX, 'check-errors'), '--json']);
  assert.equal(json.status, 1);
  const obj = JSON.parse(json.stdout);
  assert.equal(obj.ok, false);
  assert.equal(obj.total, 14);
  assert.equal(obj.errors.length > 0, true);

  const missing = runCli(['check', '--dir', join(FIX, 'no-such-root'), '--json']);
  assert.equal(missing.status, 1);
  assert.equal(JSON.parse(missing.stdout).errors[0].code, 'root-missing');
});

test('CLI：未知子命令/参数打印用法到 stderr 并退出 1；--help 退出 0', () => {
  for (const args of [[], ['frobnicate'], ['preset'], ['preset', 'bogus'], ['check', '--nope']]) {
    const r = runCli(args);
    assert.equal(r.status, 1, `${JSON.stringify(args)} 应退出 1`);
    assert.equal(r.stdout.trim(), '', `${JSON.stringify(args)} 的用法不应写到 stdout`);
    assert.match(r.stderr, /用法：/, `${JSON.stringify(args)} 应打印用法`);
  }
  const help = runCli(['--help']);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /用法：/);
});

// ---------- CLI：preset spec ----------

test('CLI preset spec：打印 bundle 绝对路径、profile 编辑与等价 pnpm 命令', () => {
  const r = runCli(['preset', 'spec']);
  assert.equal(r.status, 0, `stderr: ${r.stderr}`);
  assert.ok(r.stdout.includes(resolve(BUNDLE_DIR)), '应给出 bundle 绝对路径');
  assert.ok(r.stdout.includes(BUNDLE_PACKAGE));
  assert.ok(r.stdout.includes('dependencies'));
  assert.ok(r.stdout.includes(`pnpm add "${linkSpec(BUNDLE_DIR)}"`));
  assert.ok(r.stdout.includes('REV_SKILLS_DIR'), '应给出技能根覆盖结果');
  assert.ok(r.stdout.includes('.claude'), '技能根解析结果里应有仓库技能目录');
});

// ---------- profile 状态与编辑（纯函数） ----------

test('readProfileState：合成 profile/bundle 下逐项判定一致', () => {
  withTempDir('dsh-state-', (dir) => {
    const profileDir = join(dir, 'profile');
    const bundleDir = join(dir, 'bundle');
    mkdirSync(profileDir, { recursive: true });
    mkdirSync(bundleDir, { recursive: true });
    writeFileSync(join(bundleDir, 'cordis.patch.yml'), '- insert:\n    - id: preset-rev-skills\n      config:\n        id: rev-skills\n');
    writeFileSync(join(bundleDir, 'package.json'), JSON.stringify({ name: BUNDLE_PACKAGE, dsh: { bundle: { patch: './cordis.patch.yml' } } }));

    // 未安装
    writeJson(join(profileDir, 'package.json'), { name: 'p', dependencies: {}, dsh: { profile: { bundles: ['@deepseek-ai/dsh-base'] } } });
    const before = readProfileState(profileDir, bundleDir);
    assert.equal(before.ok, false);
    assert.equal(before.bundleExists, true);
    assert.equal(before.presetRowFound, true);
    assert.equal(before.presetRow.line, 2);
    assert.equal(before.listedInBundles, false);
    assert.equal(before.dependencyEntry, null);
    assert.deepEqual(before.bundles, ['@deepseek-ai/dsh-base']);

    // 已安装且一致
    const edited = applyProfileEdits(before.pkg, bundleDir);
    writeFileSync(join(profileDir, 'package.json'), `${JSON.stringify(edited.next, null, 2)}\n`);
    const after = readProfileState(profileDir, bundleDir);
    assert.equal(after.ok, true);
    assert.equal(after.listedInBundles, true);
    assert.equal(after.dependencyEntry, `link:${bundleDir.split('\\').join('/')}`);
    assert.equal(after.dependencyMatchesBundle, true);

    // profile 不可读 / 缺 bundle
    writeFileSync(join(profileDir, 'package.json'), '{ not json');
    const broken = readProfileState(profileDir, bundleDir);
    assert.equal(broken.ok, false);
    assert.match(broken.profileError, /不是合法 JSON/);
    const noBundle = readProfileState(profileDir, join(dir, 'nope'));
    assert.equal(noBundle.bundleExists, false);
    assert.equal(noBundle.ok, false);
    assert.equal(noBundle.patchExists, false);
  });
});

test('applyProfileEdits / removeProfileEdits：幂等、不改原对象、保留其它键', () => {
  const base = {
    name: 'p',
    dependencies: { other: '1.0.0' },
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base'] } },
  };
  const a1 = applyProfileEdits(base, BUNDLE_DIR);
  assert.deepEqual(a1.before, { bundles: ['@deepseek-ai/dsh-base'], dependency: null });
  assert.deepEqual(a1.after.bundles, ['@deepseek-ai/dsh-base', BUNDLE_PACKAGE]);
  assert.equal(a1.after.dependency, linkSpec(BUNDLE_DIR));
  assert.equal(a1.changed, true);
  assert.deepEqual(base.dsh.profile.bundles, ['@deepseek-ai/dsh-base'], '纯函数不得改原对象');

  // 幂等：再应用一次结果逐字节相同
  const a2 = applyProfileEdits(a1.next, BUNDLE_DIR);
  assert.equal(a2.changed, false);
  assert.deepEqual(a2.next, a1.next);

  // 其它依赖与未知键保留
  assert.equal(a1.next.dependencies.other, '1.0.0');
  assert.equal(a1.next.name, 'p');

  // 反向：删干净且幂等
  const r1 = removeProfileEdits(a1.next);
  assert.deepEqual(r1.next.dsh.profile.bundles, ['@deepseek-ai/dsh-base']);
  assert.equal(Object.hasOwn(r1.next.dependencies, BUNDLE_PACKAGE), false);
  assert.equal(r1.next.dependencies.other, '1.0.0');
  const r2 = removeProfileEdits(r1.next);
  assert.equal(r2.changed, false);
  assert.deepEqual(r2.next, r1.next);

  // 空 profile 也能应用（缺 dsh / dependencies 时补齐）
  const fresh = applyProfileEdits({}, BUNDLE_DIR);
  assert.deepEqual(fresh.next.dsh.profile.bundles, [BUNDLE_PACKAGE]);
  assert.deepEqual(fresh.next.dependencies, { [BUNDLE_PACKAGE]: linkSpec(BUNDLE_DIR) });
});

test('findPresetRow / dependencyMatchesBundle / resolveProfileDir', () => {
  const patch = '# comment\n- insert:\n    - id: preset-rev-skills\n      config:\n        id: rev-skills\n';
  assert.deepEqual(findPresetRow(patch, PRESET_ID), { line: 3, id: 'preset-rev-skills', text: '- id: preset-rev-skills' });
  assert.equal(findPresetRow('- id: other\n', PRESET_ID), null);
  assert.equal(findPresetRow("- insert:\n    - id: 'rev-skills'\n", PRESET_ID).line, 2);
  assert.equal(findPresetRow('- id: preset-rev-skills-extra\n', PRESET_ID), null);

  const dir = BUNDLE_DIR;
  assert.equal(dependencyMatchesBundle(`link:${dir.split('\\').join('/')}`, dir), true);
  assert.equal(dependencyMatchesBundle(dir, dir), true);
  assert.equal(dependencyMatchesBundle(`file:${dir}`, dir), true);
  assert.equal(dependencyMatchesBundle('link:/somewhere/else', dir), false);
  assert.equal(dependencyMatchesBundle(undefined, dir), false);
  assert.equal(dependencyMatchesBundle('', dir), false);

  assert.equal(resolveProfileDir('/tmp/x', {}), resolve('/tmp/x'));
  assert.equal(resolveProfileDir(null, { DSH_PROFILE_DIR: '/p1', DSH_HOME: '/h' }), '/p1');
  assert.equal(resolveProfileDir(null, { DSH_HOME: '/h' }), join('/h', 'profiles', 'desktop'));
  assert.match(resolveProfileDir(null, {}), /profiles[\\/]desktop$/);
});

test('resolveLocalSkillRoot：REV_SKILLS_DIR 按补丁的优先级覆盖', () => {
  withTempDir('dsh-root-', (dir) => {
    const repoLike = join(dir, 'repo');
    mkdirSync(join(repoLike, '.claude', 'skills', 're-x'), { recursive: true });
    writeFileSync(join(repoLike, '.claude', 'skills', 're-x', 'SKILL.md'), skillFile('re-x'));

    // 指向仓库根 → 展开成 <dir>/.claude/skills
    const viaRoot = resolveLocalSkillRoot({ REV_SKILLS_DIR: repoLike, DSH_HOME: join(dir, 'nope') }, repoLike);
    assert.equal(viaRoot.active.root, join(repoLike, '.claude', 'skills'));
    assert.equal(viaRoot.active.skills, 1);

    // 直接指向技能根 → 原样使用
    const skillsDir = join(repoLike, '.claude', 'skills');
    const viaDir = resolveLocalSkillRoot({ REV_SKILLS_DIR: skillsDir, DSH_HOME: join(dir, 'nope') }, repoLike);
    assert.equal(viaDir.active.root, skillsDir);

    // 无环境变量且 DSH 用户根为空 → 回落到仓库技能根
    const viaRepo = resolveLocalSkillRoot({ DSH_HOME: join(dir, 'nope') }, repoLike);
    assert.equal(viaRepo.active.root, skillsDir);

    // DSH 用户根存在且含 re- 条目 → 优先于仓库根（与补丁候选顺序一致）
    const homeSkills = join(dir, 'home', 'skills');
    mkdirSync(join(homeSkills, 're-y'), { recursive: true });
    writeFileSync(join(homeSkills, 're-y', 'SKILL.md'), skillFile('re-y'));
    const viaHome = resolveLocalSkillRoot({ DSH_HOME: join(dir, 'home') }, repoLike);
    assert.equal(viaHome.active.root, homeSkills);

    // 候选里带出「需要先装依赖才能判定」的包解析项
    assert.equal(viaHome.candidates.some((c) => c.resolvable === false), true);
  });
});

// ---------- CLI：preset status ----------

test('CLI preset status：一致时退出 0，未安装时退出 1，--json 可解析', () => {
  withTempDir('dsh-status-', (dir) => {
    const profileDir = join(dir, 'profile');
    mkdirSync(profileDir, { recursive: true });
    const profileFile = join(profileDir, 'package.json');

    // 未安装
    writeJson(profileFile, { name: 'p', dependencies: {}, dsh: { profile: { bundles: ['@deepseek-ai/dsh-base'] } } });
    const off = runCli(['preset', 'status', '--profile-dir', profileDir, '--json']);
    assert.equal(off.status, 1);
    const offObj = JSON.parse(off.stdout);
    assert.equal(offObj.ok, false);
    assert.equal(offObj.listedInBundles, false);
    assert.equal(offObj.dependencyEntry, null);
    assert.equal(offObj.bundleExists, bundleExists);
    assert.equal(offObj.profileDir, resolve(profileDir));

    // 已安装且一致（真的 bundle + 真的补丁行）
    const pkg = JSON.parse(readFileSync(profileFile, 'utf8'));
    const edited = applyProfileEdits(pkg, BUNDLE_DIR);
    writeFileSync(profileFile, `${JSON.stringify(edited.next, null, 2)}\n`);
    const on = runCli(['preset', 'status', '--profile-dir', profileDir, '--json']);
    assert.equal(on.status, 0, `stderr: ${on.stderr}`);
    const onObj = JSON.parse(on.stdout);
    assert.equal(onObj.ok, true);
    assert.equal(onObj.listedInBundles, true);
    assert.equal(onObj.dependencyMatchesBundle, true);
    assert.equal(onObj.presetRowFound, true, 'bundle 补丁里应有 config.id: rev-skills 的预设行');
    assert.ok(onObj.presetRow.line > 0);

    // 文本形态同样给出判定行
    const text = runCli(['preset', 'status', '--profile-dir', profileDir]);
    assert.equal(text.status, 0);
    assert.match(text.stdout, /OK: 已安装且一致/);

    // profile 不可读 → 退出 1 且带原因
    writeFileSync(profileFile, '{ not json');
    const broken = runCli(['preset', 'status', '--profile-dir', profileDir, '--json']);
    assert.equal(broken.status, 1);
    assert.match(JSON.parse(broken.stdout).profileError, /不是合法 JSON/);
  });
});

// ---------- CLI：preset install / uninstall ----------

test('CLI preset install：dry-run 不写文件，--apply 写前备份且幂等', () => {
  assert.equal(bundleExists, true, '本任务交付了 dsh/ bundle，install 用例依赖它');
  withTempDir('dsh-install-', (dir) => {
    const profileFile = join(dir, 'package.json');
    const backupFile = join(dir, PROFILE_BACKUP);
    const original = `${JSON.stringify({ name: 'p', dependencies: {}, dsh: { profile: { bundles: ['@deepseek-ai/dsh-base'] } } }, null, 2)}\n`;
    writeFileSync(profileFile, original);

    // dry-run：内容逐字节不变，且打印 before/after
    const dry = runCli(['preset', 'install', '--profile-dir', dir]);
    assert.equal(dry.status, 0, `stderr: ${dry.stderr}`);
    assert.equal(readFileSync(profileFile, 'utf8'), original);
    assert.equal(existsSync(backupFile), false);
    assert.match(dry.stdout, /before: /);
    assert.match(dry.stdout, /after:  /);
    assert.ok(dry.stdout.includes(BUNDLE_PACKAGE));
    assert.ok(dry.stdout.includes(`link:${resolve(BUNDLE_DIR).split('\\').join('/')}`));

    // --apply：写入 + 备份 + 打出剩余手动步骤（pnpm install + 重启）
    const app = runCli(['preset', 'install', '--profile-dir', dir, '--apply']);
    assert.equal(app.status, 0, `stderr: ${app.stderr}`);
    assert.equal(readFileSync(backupFile, 'utf8'), original, '备份必须是写入前的原文');
    const written = readFileSync(profileFile, 'utf8');
    const edited = JSON.parse(written);
    assert.deepEqual(edited.dsh.profile.bundles, ['@deepseek-ai/dsh-base', BUNDLE_PACKAGE]);
    assert.equal(edited.dependencies[BUNDLE_PACKAGE], `link:${resolve(BUNDLE_DIR).split('\\').join('/')}`);
    assert.match(app.stdout, /pnpm install/);
    assert.match(app.stdout, /重启 DSH/);

    // 备份已存在 → 拒绝覆盖且不改文件
    const again = runCli(['preset', 'install', '--profile-dir', dir, '--apply']);
    assert.equal(again.status, 1);
    assert.match(again.stderr, /拒绝覆盖/);
    assert.equal(readFileSync(profileFile, 'utf8'), written);

    // --force：允许覆盖备份，且结果幂等（已装好就不再变）
    const forced = runCli(['preset', 'install', '--profile-dir', dir, '--apply', '--force']);
    assert.equal(forced.status, 0, `stderr: ${forced.stderr}`);
    assert.equal(readFileSync(profileFile, 'utf8'), written);
    assert.equal(readFileSync(backupFile, 'utf8'), original, '--force 只覆盖备份，不应污染备份内容');

    // 应用后再 dry-run：after 与现状一致
    const dry2 = runCli(['preset', 'install', '--profile-dir', dir]);
    assert.equal(dry2.status, 0);
    assert.equal(readFileSync(profileFile, 'utf8'), written);
  });
});

test('CLI preset uninstall：dry-run 不写，--apply 从备份还原并保留备份', () => {
  withTempDir('dsh-uninstall-', (dir) => {
    const profileFile = join(dir, 'package.json');
    const backupFile = join(dir, PROFILE_BACKUP);
    const original = `${JSON.stringify({ name: 'p', dependencies: { other: '1.0.0' }, dsh: { profile: { bundles: ['@deepseek-ai/dsh-base'] } } }, null, 2)}\n`;
    const installed = { name: 'p', dependencies: { other: '1.0.0', [BUNDLE_PACKAGE]: linkSpec(BUNDLE_DIR) }, dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', BUNDLE_PACKAGE] } } };

    // 已安装 + 有备份：dry-run 不写
    writeJson(profileFile, installed);
    writeFileSync(backupFile, original);
    const dry = runCli(['preset', 'uninstall', '--profile-dir', dir]);
    assert.equal(dry.status, 0, `stderr: ${dry.stderr}`);
    assert.equal(readFileSync(profileFile, 'utf8'), `${JSON.stringify(installed, null, 2)}\n`);
    assert.match(dry.stdout, /备份保留/);
    assert.match(dry.stdout, /before: /);
    assert.match(dry.stdout, /after:  /);

    // --apply：从备份还原原文，且备份保留
    const un = runCli(['preset', 'uninstall', '--profile-dir', dir, '--apply']);
    assert.equal(un.status, 0, `stderr: ${un.stderr}`);
    assert.equal(readFileSync(profileFile, 'utf8'), original, '有备份时应从备份还原原文');
    assert.equal(existsSync(backupFile), true, '还原后备份要保留');

    // 幂等：再卸一次不改文件
    writeJson(profileFile, installed);
    const un2 = runCli(['preset', 'uninstall', '--profile-dir', dir, '--apply', '--json']);
    assert.equal(un2.status, 0, `stderr: ${un2.stderr}`);
    assert.equal(readFileSync(profileFile, 'utf8'), original);
    assert.equal(JSON.parse(un2.stdout).restoreFromBackup, true);

    // 无备份时按编辑结果写回：只去掉 bundle 行与依赖键，其它键原样保留
    rmSync(backupFile, { force: true });
    writeJson(profileFile, installed);
    const noBak = runCli(['preset', 'uninstall', '--profile-dir', dir, '--apply']);
    assert.equal(noBak.status, 0, `stderr: ${noBak.stderr}`);
    const cleaned = JSON.parse(readFileSync(profileFile, 'utf8'));
    assert.deepEqual(cleaned.dsh.profile.bundles, ['@deepseek-ai/dsh-base']);
    assert.equal(Object.hasOwn(cleaned.dependencies, BUNDLE_PACKAGE), false);
    assert.equal(cleaned.dependencies.other, '1.0.0');
    assert.equal(existsSync(backupFile), false);

    // 备份内容本身不可解析时：拒绝并保持文件不变（无部分写）
    const brokenBak = join(dir, PROFILE_BACKUP);
    writeFileSync(brokenBak, '{ not json');
    const beforeBroken = readFileSync(profileFile, 'utf8');
    const refused = runCli(['preset', 'uninstall', '--profile-dir', dir, '--apply']);
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /备份不是合法 JSON/);
    assert.equal(readFileSync(profileFile, 'utf8'), beforeBroken);
  });
});

test('CLI preset install/uninstall：profile 不可读时退出 1 且不产生任何写入', () => {
  withTempDir('dsh-partial-', (dir) => {
    const profileFile = join(dir, 'package.json');
    const broken = '{ "name": "p", ';
    writeFileSync(profileFile, broken);
    for (const sub of ['install', 'uninstall']) {
      const r = runCli(['preset', sub, '--profile-dir', dir, '--apply']);
      assert.equal(r.status, 1, `${sub} 应退出 1`);
      assert.match(r.stderr, /不是合法 JSON|不存在/);
      assert.equal(readFileSync(profileFile, 'utf8'), broken, `${sub} 不得改动文件`);
      assert.equal(existsSync(join(dir, PROFILE_BACKUP)), false, `${sub} 不得留下备份`);
      assert.equal(existsSync(`${profileFile}.rev-skills.tmp`), false, `${sub} 不得留下临时文件`);
    }
    // profile 根本不存在：同样退出 1 且什么都不建
    const empty = join(dir, 'nope');
    mkdirSync(empty);
    const r = runCli(['preset', 'install', '--profile-dir', empty, '--apply']);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /不存在/);
    assert.deepEqual(readdirSync(empty), []);
  });
});
