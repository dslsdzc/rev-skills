import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

// DSH bundle 的守卫测试：package.json 的 `dsh.bundle`、补丁里唯一一行 preset 声明、子插件
// 包名白名单、不继承默认技能根的 skill-filesystem 配置与 REV_SKILLS_DIR 覆盖逻辑、文件卫生。
// 不断言技能计数：预设必须与技能增删解耦（技能数由 tests/counts.test.mjs 看住）。

const DSH_DIR = fileURLToPath(new URL('../dsh/', import.meta.url));
const PACKAGE_FILE = join(DSH_DIR, 'package.json');
const PATCH_FILE = join(DSH_DIR, 'cordis.patch.yml');

const PATCH_TEXT = readPatchText();
// 顶层是 `- insert:` 一行，其值才是插入的行列表
const TOP = parseYaml(PATCH_TEXT);
const ROWS = nodeSeq(nodeMap(TOP.value[0]).get('insert'));
assert.equal(ROWS.length, 1, '补丁顶层应是一条 insert 行');
const PRESET_ROW = ROWS[0];
const PRESET_CONFIG = nodeMap(PRESET_ROW.value.get('config'));
// 子插件清单；分组（cordis:group）的 config 本身又是一层子清单
const PLUGINS = nodeSeq(PRESET_CONFIG.get('plugins'));

// 补丁允许出现的全部子插件包名（含 cordis 内置的分组标记）。写死在此处，包名拼错即红。
const ALLOWED_PACKAGES = new Set([
  'cordis:group',
  '@deepseek-ai/dsh-persona',
  '@deepseek-ai/dsh-agent-instructions',
  '@deepseek-ai/dsh-tool-bash',
  '@deepseek-ai/dsh-tool-pwsh',
  '@deepseek-ai/dsh-tool-fs',
  '@deepseek-ai/dsh-tool-fs-search',
  '@deepseek-ai/dsh-tool-jobs',
  '@deepseek-ai/dsh-command-goal',
  '@deepseek-ai/dsh-tool-goal',
  '@deepseek-ai/dsh-compaction-basic',
  '@deepseek-ai/dsh-command-compact',
  '@deepseek-ai/dsh-compaction-tool-result-pruner',
  '@deepseek-ai/dsh-tool-subagent-control',
  '@deepseek-ai/dsh-tool-subagent-control/list-agents',
  '@deepseek-ai/dsh-tool-subagent',
  '@deepseek-ai/dsh-workflow-ptc',
  '@deepseek-ai/dsh-tool-workflow',
  '@deepseek-ai/dsh-tool-ask-user',
  '@deepseek-ai/dsh-tool-todo',
  '@deepseek-ai/dsh-tool-web',
  '@deepseek-ai/dsh-skill-filesystem',
  '@deepseek-ai/dsh-tool-skill',
  '@deepseek-ai/dsh-tool-present',
  '@deepseek-ai/dsh-plugin-manager/tools',
]);

// 官方已发布的 preset id：本 bundle 不得与之冲突（Duplicate preset IDs fail declaration loading）。
const SHIPPED_PRESET_IDS = ['standard', 'minimal', 'ptc', 'cordis'];

function readPatchText() {
  // 统一成 LF：文件本身必须已是 LF（有单独用例断言）
  return readFileSync(PATCH_FILE, 'utf8').replace(/\r\n/g, '\n');
}

// 覆盖本补丁用到的 YAML 子集：映射、序列、块标量、`!!js` 标量。缩进为空格。
// 一切值都包成带 type 的节点，map/seq 的类型不会在传递中丢失。
function parseYaml(text) {
  const lines = text.split('\n').filter((l) => l.trim() !== '' && !l.trimStart().startsWith('#'));
  let i = 0;

  const indentOf = (l) => l.length - l.trimStart().length;
  const unquote = (s) => {
    if (s.startsWith('"')) return JSON.parse(s);
    if (s.startsWith("'")) return s.slice(1, -1);
    return s;
  };
  const scalar = (raw) => {
    const s = raw.trim();
    const js = /^!!js\s+([\s\S]+)$/.exec(s);
    if (js) return { type: 'scalar', value: { js: unquote(js[1].trim()) } };
    if (s.startsWith('"') || s.startsWith("'")) return { type: 'scalar', value: unquote(s) };
    if (s === 'true') return { type: 'scalar', value: true };
    if (s === 'false') return { type: 'scalar', value: false };
    if (/^-?\d+$/.test(s)) return { type: 'scalar', value: Number(s) };
    return { type: 'scalar', value: s };
  };

  const parseBlock = () => {
    const ind = indentOf(lines[i]);
    if (lines[i].slice(ind).startsWith('- ')) return parseSeq(ind);
    return parseMap(ind);
  };

  // `key: value`：值是同行标量、块标量（`>` / `|`）、或更深缩进的子块（映射 / 序列）
  const parseEntry = (key, raw, ind, map) => {
    if (/^[>|][+-]?$/.test(raw)) {
      const block = [];
      while (i < lines.length && indentOf(lines[i]) > ind) {
        block.push(lines[i].trim());
        i++;
      }
      map.set(key, { type: 'scalar', value: raw.startsWith('>') ? block.join(' ') : block.join('\n') });
      return;
    }
    if (raw !== '') {
      map.set(key, scalar(raw));
      return;
    }
    map.set(key, i < lines.length && indentOf(lines[i]) > ind ? parseBlock() : scalar(''));
  };

  // 序列项为 `- key: value`（可带同层后续键）或 `- 标量`
  const parseSeq = (ind) => {
    const items = [];
    while (i < lines.length) {
      const d = indentOf(lines[i]);
      if (d !== ind || !lines[i].slice(d).startsWith('- ')) break;
      const rest = lines[i].slice(d + 2);
      const m = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(rest);
      i++;
      if (!m) {
        items.push(scalar(rest));
        continue;
      }
      const map = new Map();
      parseEntry(m[1], m[2], d, map);
      while (i < lines.length && indentOf(lines[i]) > d) {
        const cd = indentOf(lines[i]);
        const cm = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(lines[i].slice(cd));
        assert.ok(cm, `补丁行无法解析为键值：${JSON.stringify(lines[i])}`);
        i++;
        parseEntry(cm[1], cm[2], cd, map);
      }
      items.push({ type: 'map', value: map });
    }
    return { type: 'seq', value: items };
  };

  const parseMap = (ind) => {
    const map = new Map();
    while (i < lines.length) {
      const d = indentOf(lines[i]);
      if (d !== ind) break;
      const m = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(lines[i].slice(d));
      if (!m) break;
      i++;
      parseEntry(m[1], m[2], ind, map);
    }
    return { type: 'map', value: map };
  };

  return parseBlock();
}

function nodeValue(node) {
  return node && node.type === 'scalar' ? node.value : undefined;
}
function nodeMap(node) {
  return node && node.type === 'map' ? node.value : undefined;
}
function nodeSeq(node) {
  return node && node.type === 'seq' ? node.value : undefined;
}
function collectPlugins(nodes) {
  const out = [];
  const walk = (list) => {
    for (const n of list) {
      if (!n || n.type !== 'map') continue;
      const name = nodeValue(n.value.get('name'));
      if (name) out.push({ id: nodeValue(n.value.get('id')), name, configNode: n.value.get('config') });
      const children = nodeSeq(n.value.get('config'));
      if (children) walk(children);
    }
  };
  walk(nodes);
  return out;
}
function allPlugins() {
  return collectPlugins(PLUGINS);
}
function findPlugin(name) {
  return allPlugins().filter((p) => p.name === name);
}
// skill-filesystem 的 rev-skills 技能根表达式（唯一一项 customSkillDirs）
function skillRootExpr() {
  const sf = findPlugin('@deepseek-ai/dsh-skill-filesystem');
  assert.equal(sf.length, 1, `应有且只有一个 skill-filesystem 行，实际 ${sf.length}`);
  return nodeValue(nodeSeq(nodeMap(sf[0].configNode).get('customSkillDirs'))[0]).js;
}

function mutateEnv(vars, fn) {
  const saved = vars.map((k) => [k, process.env[k]]);
  for (const [k, v] of vars) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return fn();
  } finally {
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

function evalExpr(expr, baseUrl, opts = {}) {
  // 未提供的变量一律删除（而不是置空串）：置空串会让 DSH_HOME 回落到真实用户目录
  const env = { REV_SKILLS_DIR: opts.revSkillsDir, DSH_HOME: opts.dshHome };
  return mutateEnv(Object.keys(env).map((k) => [k, env[k]]), () => {
    const fn = new Function('baseUrl', 'require', 'ctx', `return (${expr});`);
    return fn(baseUrl, createRequire(baseUrl), undefined);
  });
}

test('dsh/package.json 是合法 bundle 清单', () => {
  const pkg = JSON.parse(readFileSync(PACKAGE_FILE, 'utf8'));
  assert.equal(pkg.name, 'rev-skills-dsh-preset');
  assert.match(pkg.version, /^\d+\.\d+\.\d+/);
  assert.equal(pkg.license, 'Apache-2.0');
  assert.equal(pkg.type, 'module');
  assert.ok(typeof pkg.description === 'string' && pkg.description.trim().length > 0, 'description 应非空');
  assert.deepEqual(pkg.dependencies, undefined, 'bundle 不得有运行时依赖（技能目录在运行时解析）');
  const rel = pkg.dsh?.bundle?.patch;
  assert.equal(typeof rel, 'string', 'dsh.bundle.patch 必须存在');
  const abs = join(DSH_DIR, rel);
  assert.ok(existsSync(abs), `dsh.bundle.patch 指向不存在的文件：${rel}`);
  assert.ok(abs.startsWith(DSH_DIR), 'dsh.bundle.patch 必须落在 dsh/ 目录内');
  assert.ok(Array.isArray(pkg.files) && pkg.files.length > 0);
  for (const f of pkg.files) {
    assert.ok(existsSync(join(DSH_DIR, f)), `files 里列了未随包发布的文件：${f}`);
  }
  for (const key of ['main', 'exports', 'bin']) {
    assert.equal(pkg[key], undefined, `${key} 不得指向未随包发布的文件`);
  }
});

test('dsh/LICENSE 是仓库根 LICENSE 的 Apache-2.0 正文', () => {
  const license = readFileSync(join(DSH_DIR, 'LICENSE'), 'utf8');
  assert.ok(license.includes('Apache License'), 'LICENSE 应含 Apache License 标题行');
  assert.ok(license.includes('Version 2.0, January 2004'), 'LICENSE 应是 Apache-2.0 全文');
  assert.ok(license.includes('END OF TERMS AND CONDITIONS'), 'LICENSE 应是全文而非节选');
  assert.ok(!license.includes('\r'), 'LICENSE 应是 LF 行尾，与 dsh/ 其余文件一致');
  // 与仓库根 LICENSE 逐行同源（行尾差异允许：本文件统一成 LF）
  const root = readFileSync(join(DSH_DIR, '..', 'LICENSE'), 'utf8');
  const norm = (t) => t.replace(/\r\n/g, '\n');
  assert.equal(norm(license), norm(root), 'LICENSE 内容应与仓库根 LICENSE 一致');
});

test('补丁里只有一行 preset 声明，身份与官方内置 preset 不冲突', () => {
  assert.ok(PRESET_ROW.value.has('id'), 'preset 行应有 Loader 寻址用的 id');
  assert.equal(nodeValue(PRESET_ROW.value.get('name')), '@deepseek-ai/dsh-agent-preset');
  const cfg = PRESET_CONFIG;
  assert.ok(cfg instanceof Map, 'preset 行的 config 应是映射');
  const id = nodeValue(cfg.get('id'));
  assert.equal(id, 'rev-skills');
  assert.ok(!SHIPPED_PRESET_IDS.includes(id), `config.id 与官方内置 preset 冲突：${id}`);
  assert.ok(!SHIPPED_PRESET_IDS.includes(nodeValue(PRESET_ROW.value.get('id'))), 'Loader 行 id 不应复用官方值');
  const order = nodeValue(cfg.get('order'));
  assert.ok(Number.isInteger(order) && order > 0, 'order 应是正整数');
  for (const key of ['name', 'description']) {
    const v = nodeValue(cfg.get(key));
    assert.ok(typeof v === 'string' && v.trim().length > 0, `config.${key} 应非空`);
  }
});

test('补丁引用的子插件包名都在白名单内', () => {
  const plugins = allPlugins();
  assert.ok(plugins.length > 10, `补丁应插入完整插件清单，实际 ${plugins.length} 项`);
  const unknown = plugins.filter((p) => !ALLOWED_PACKAGES.has(p.name)).map((p) => `${p.id} -> ${p.name}`);
  assert.deepEqual(unknown, [], `出现白名单外的包名（疑似拼写错误）：\n${unknown.join('\n')}`);
  const ids = plugins.map((p) => p.id);
  assert.ok(ids.every((id) => typeof id === 'string' && id.length > 0), '每个子插件行都应有 id');
  assert.equal(new Set(ids).size, ids.length, `行 id 重复：${ids.join(', ')}`);
});

test('skill-filesystem 行不继承默认技能根、只声明本库技能根，并支持 REV_SKILLS_DIR 覆盖', () => {
  const sf = findPlugin('@deepseek-ai/dsh-skill-filesystem');
  const cfg = nodeMap(sf[0].configNode);
  assert.ok(cfg instanceof Map, 'skill-filesystem 行应有 config');
  assert.equal(
    nodeValue(cfg.get('includeDefaultRoots')),
    false,
    '必须显式关闭默认技能根：该提供方只贡献 customSkillDirs 这一层，不继承项目与用户技能根',
  );
  const dirs = nodeSeq(cfg.get('customSkillDirs'));
  assert.ok(Array.isArray(dirs) && dirs.length === 1, 'customSkillDirs 应只有一项（本库技能根）');
  const expr = skillRootExpr();
  assert.ok(typeof expr === 'string' && expr.trim().length > 0, '技能根应是 !!js 求值表达式');
  assert.ok(expr.includes('REV_SKILLS_DIR'), '表达式应支持 REV_SKILLS_DIR 覆盖');
  assert.ok(expr.includes('DSH_HOME'), '表达式应回落到 DSH 用户技能根（DSH_HOME）');
  assert.ok(expr.includes('node:os'), 'DSH 用户根应由 node:os 推出（os.homedir）');
  assert.ok(expr.includes('rev-skills/package.json'), '表达式应支持从 rev-skills 包解析');
  assert.ok(expr.includes('rev-skills-dsh-preset/package.json'), '表达式应支持从本 bundle 包解析');
  assert.ok(
    /(\.claude['"]?\s*,\s*['"]skills|\.claude\/skills)/.test(expr),
    '.claude 与 skills 应拼成同一个技能根',
  );
  assert.ok(expr.includes('existsSync'), '候选目录应用 fs.existsSync 校验存在性');
  assert.ok(expr.includes('readdirSync'), '候选目录应用目录列举校验（至少含一个 re- 条目）');
  assert.ok(
    ['node:path', 'node:fs', 'node:module'].every((m) => expr.includes(m)),
    '表达式应通过 process.getBuiltinModule 取 node:path / node:fs / node:module',
  );
  for (const skill of ['re-analyze', 're-kernel', 're-game']) {
    assert.ok(!expr.includes(skill), '技能根表达式不得硬编码技能名');
  }
});

test('技能根分辨率按「环境变量 -> DSH 用户根 -> 包解析」优先级回落', () => {
  const expr = skillRootExpr();
  // fileURLToPath 会保留末尾分隔符（`.../skills/`），resolve 归一化后再比较
  const repoSkills = resolve(fileURLToPath(new URL('../.claude/skills/', import.meta.url)));
  const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));

  // 1) REV_SKILLS_DIR 为仓库根 -> 展开成 <dir>/.claude/skills
  const viaEnvRoot = evalExpr(expr, PACKAGE_FILE, { revSkillsDir: repoRoot, dshHome: '' });
  assert.equal(viaEnvRoot, repoSkills);
  // 2) REV_SKILLS_DIR 直接指向技能根 -> 原样使用
  const viaEnvDir = evalExpr(expr, PACKAGE_FILE, { revSkillsDir: repoSkills, dshHome: '' });
  assert.equal(viaEnvDir, repoSkills);

  // 3) 无环境变量且包未安装 -> 回落到 <DSH_HOME>/skills
  const home = join(tmpdir(), 'dsh-preset-test-home');
  const homeSkills = join(home, 'skills');
  mkdirSync(join(homeSkills, 're-test'), { recursive: true });
  writeFileSync(join(homeSkills, 're-test', 'SKILL.md'), 'x');
  try {
    const viaHome = evalExpr(expr, PACKAGE_FILE, { revSkillsDir: '', dshHome: home });
    assert.equal(viaHome, homeSkills);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }

  // 4) 包已安装且 DSH 用户根为空 -> 从包的 package.json 反解 skills 目录
  const app = mkdtempSync(join(tmpdir(), 'dsh-preset-app-'));
  const fakeRepo = join(app, 'node_modules', 'rev-skills');
  const fakeKeys = join(fakeRepo, '.claude', 'skills', 're-fake');
  mkdirSync(fakeKeys, { recursive: true });
  mkdirSync(join(app, 'node_modules', 'rev-skills-dsh-preset'), { recursive: true });
  writeFileSync(join(fakeRepo, 'package.json'), '{}');
  writeFileSync(join(app, 'node_modules', 'rev-skills-dsh-preset', 'package.json'), '{}');
  writeFileSync(join(fakeKeys, 'SKILL.md'), 'x');
  try {
    const baseUrl = join(app, 'node_modules', 'rev-skills-dsh-preset', 'package.json');
    // DSH_HOME 指向一个不存在的目录，确保回落到包解析候选
    const viaPkg = evalExpr(expr, baseUrl, { revSkillsDir: '', dshHome: join(app, 'empty-dsh-home') });
    assert.equal(viaPkg, join(fakeRepo, '.claude', 'skills'));
  } finally {
    rmSync(app, { recursive: true, force: true });
  }
});

test('补丁文件卫生：无 tab、逐行 LF、值里无未引号的冒号空格', () => {
  const raw = readFileSync(PATCH_FILE, 'utf8');
  assert.ok(!raw.includes('\t'), '补丁不得含 tab 字符');
  assert.ok(!raw.includes('\r'), '补丁必须是 LF 行尾（不得出现 CR）');
  assert.ok(raw.endsWith('\n'), '补丁应以换行结束');
  // 未加引号的 `key: value` 行里，值本身不得含 ": "（会被 YAML 误解析为嵌套映射）
  const bad = raw
    .split('\n')
    .filter((l) => l.includes(': '))
    .filter((l) => {
      const rest = l.slice(l.indexOf(': ') + 2);
      return !/^[>|][+-]?$/.test(rest.trim()) && rest.includes(': ');
    });
  assert.deepEqual(bad, [], `这些行的标量值里含 ": "，需加引号：\n${bad.join('\n')}`);
});

test('补丁与技能清单解耦，且不写文件', () => {
  const raw = PATCH_FILE && PATCH_TEXT;
  // 技能名硬编码检查：排除包名与 frontmatter 语义下的 re- 前缀出现在 YAML 值里的情况
  const names = raw.split('\n').filter((l) => /(^|[^a-zA-Z0-9-])re-[a-z0-9-]+/.test(l) && !l.includes('@deepseek-ai/'));
  assert.deepEqual(names, [], `补丁不得硬编码技能名（预设需与技能数解耦）：\n${names.join('\n')}`);
  for (const re of [/writeFile\w*/, /appendFile\w*/, /\bmkdir\w*/, /\bunlink\w*/, /\brmSync\b/, /\bcreateWriteStream\b/]) {
    assert.ok(!re.test(raw), `补丁不得写文件，命中 ${re}`);
  }
  const repoSkills = fileURLToPath(new URL('../.claude/skills/', import.meta.url));
  assert.ok(existsSync(repoSkills), '技能根必须真实存在，否则预设挂载空目录');
  const entries = readdirSync(repoSkills).filter((e) => e.startsWith('re-'));
  assert.ok(entries.length > 0, '.claude/skills 下应有 re- 技能目录');
  assert.ok(entries.includes('re-analyze'), '入口技能 re-analyze 应存在');
});
