// lib/frontmatter.mjs — 技能 frontmatter 解析的唯一实现
//
// validate.mjs（结构校验）与 bin/convert.mjs（规则转换）共用本模块。
// 此前两边各写一套行式解析：convert 支持块标量、validate 不支持，
// 导致 104/121 个技能的 description 在 validate 侧被解析成字面量 ">"，
//「description 非空」校验形同虚设（2026-09-13 审查记录，tests/frontmatter.test.mjs 回归）。
//
// 支持的 YAML 子集（技能库实际用到的部分）：
//   - 简单 scalar：key: value
//   - 块标量：key: >（折叠为空格）/ key: |（保留换行），吸收后续缩进行
//   - 内联 flow list / 内联 JSON：key: [a, b] / key: {...}（按字符串返回，由调用方解析）
// 不支持锚点、嵌套 map、多行 flow 等其余 YAML 特性——新增 frontmatter 写法前先扩展本模块并补测试，
// 否则校验与转换会再次出现解析分歧。
// 顶格且非 `key:` 的行一律报错、不静默丢弃：块标量正文里误写顶层列表项（`- xxx`）会让
// description 被静默截断，且标准 YAML 解析器会判定整块 frontmatter 非法、丢弃整个技能
// （tests/frontmatter.test.mjs 与 tests/fixtures/bad-frontmatter 回归）。

// 拆文档：frontmatter 原文 + 正文（正文前多余空行一并去掉）
export function splitFrontmatter(md) {
  const m = md.match(/^---\n([\s\S]*?)\n---\n*([\s\S]*)$/);
  if (!m) throw new Error('missing frontmatter');
  return { raw: m[1], body: m[2] };
}

// 行式解析 frontmatter 原文 → 键值对象（值均为字符串；块标量已折叠/展开）
export function parseFrontmatterFields(raw) {
  const fm = {};
  const lines = raw.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const kv = lines[i].match(/^(\w+):\s*(.*)$/);
    if (!kv) {
      // 顶格行既不是 `key:` 也不是块标量的缩进续行——解析器看不见它，内容会被静默丢弃。
      // 实际踩过的坑：块标量正文里误写顶层列表项（`- xxx`），description 在此截断，
      // 而严格 YAML 解析器（外部消费方如 DSH）会因整块 frontmatter 报错而丢掉整个技能。
      if (lines[i].trim() !== '' && !/^\s/.test(lines[i])) {
        throw new Error(`unparsable frontmatter line ${i + 1} (not a 'key:' line nor an indented continuation): ${lines[i]}`);
      }
      continue;
    }
    const key = kv[1];
    const value = kv[2];
    if (/^[>|]/.test(value)) {
      // YAML 块标量：吸收后续缩进行（`>` 折叠为空格，`|` 保留换行）
      const folded = [];
      while (lines[i + 1] !== undefined && /^\s+/.test(lines[i + 1])) {
        folded.push(lines[++i].replace(/^\s+/, ''));
      }
      fm[key] = folded.join(value[0] === '>' ? ' ' : '\n').trim();
    } else {
      fm[key] = value;
    }
  }
  return fm;
}

// 便捷入口：一次拿到 { fm, body }
export function parseFrontmatterDocument(md) {
  const { raw, body } = splitFrontmatter(md);
  return { fm: parseFrontmatterFields(raw), body };
}
