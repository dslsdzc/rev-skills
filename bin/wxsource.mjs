#!/usr/bin/env node
// 看雪论坛 / 微信公众号技术文章源获取工具（方案1：直接抓取官方论坛源）
//
// 背景：看雪学苑公众号文章均为看雪论坛（bbs.kanxue.com）帖子转载，微信侧无官方
// API 可枚举他人公众号文章，因此直接抓论坛列表即等价于公众号选文源。
//
// 子命令：
//   kanxue list [--board 名|--id N] [--pages N] [--md]  论坛文章列表（默认全站）
//   kanxue thread <帖子ID> [--md]                       单篇帖子标题/作者/正文
//   wechat <文章URL> [--md]                             微信文章抓取（备用渠道）
//
// 输出默认 JSON（结构化，便于管道/喂给 AI）；--md 输出 markdown（便于直接入库）。
// 零依赖（Node >=18 内置 fetch）。导出纯函数供 tests/wxsource.test.mjs 测试。

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

// 版块名（中文/英文别名）→ forum id（首页导航实测确认；未知版块用 --id 指定）
const BOARDS = {
  home: null, // 全站首页
  ai: 170, 'ai-help': 170, 'ai助力安全': 170, 'ai 助力安全': 170,
  'ai-self': 168, 'ai自身安全': 168, 'ai 自身安全': 168,
  'ai-platform': 123, 'ai平台与数据安全': 123,
  re: 4, 逆向工程: 4, 软件逆向: 4,
  ctf: 37, 'ctf对抗': 37,
  crypto: 132, 密码应用: 132, 密码算法: 132,
  tools: 10, 安全工具: 10,
  harmony: 178, 鸿蒙: 178,
  android: 161, 'android安全': 161,
  iot: 128, 'iot安全': 128,
  ios: 166, 'ios安全': 166,
  coding: 41, 编程技术: 41,
  unpack: 88, 加壳脱壳: 88,
  vuln: 150, 二进制漏洞: 150,
  pwn: 171,
  web: 151, 'web安全': 151,
  translate: 32, 外文翻译: 32,
};

export const BASE = 'https://bbs.kanxue.com';

// ---------- 网络 ----------

export async function fetchText(url, { retries = 1 } = {}) {
  for (let i = 0; ; i++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20000);
    try {
      const res = await fetch(url, {
        headers: { 'user-agent': UA, 'accept-language': 'zh-CN,zh;q=0.9' },
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
      return await res.text();
    } catch (e) {
      if (i >= retries) throw e;
    } finally {
      clearTimeout(timer);
    }
  }
}

// ---------- HTML → 简化 markdown 文本 ----------

export function htmlToText(html) {
  let s = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|section|li|h[1-6]|pre|tr|blockquote)>/gi, '\n')
    .replace(/<img[^>]*>/gi, '[图片]')
    .replace(/<code[^>]*>/gi, '`')
    .replace(/<\/code>/gi, '`')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, '');
  s = s
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  return s.replace(/\n{3,}/g, '\n\n').replace(/[ \t]+\n/g, '\n').trim();
}

// ---------- 看雪论坛列表解析 ----------

// 首页聚合列表：<a class="bbs_home_page_list_title" href="thread-292402.htm" title="...">标题</a>
export function parseKanxueHomeList(html) {
  const items = [];
  const re =
    /<a[^>]*class="[^"]*bbs_home_page_list_title[^"]*"[^>]*href="(thread-\d+\.htm)"[^>]*title="([^"]*)"[^>]*>[\s\S]*?<\/a>/g;
  for (const m of html.matchAll(re)) {
    items.push({ url: `${BASE}/${m[1]}`, title: m[2].trim() || htmlToText(m[0]) });
  }
  return items;
}

// 分类页（xiuno）：<tr class="thread ..." data-tid="292346"> 行内标题 + 作者
export function parseForumList(html) {
  const items = [];
  const re = /<tr[^>]*class="thread[^"]*"[^>]*data-tid="(\d+)"[\s\S]*?<\/tr>/g;
  for (const m of html.matchAll(re)) {
    const tid = m[1];
    const t = m[0].match(/<a href="thread-\d+\.htm"[^>]*>([^<]{4,120})<\/a>/);
    const au = [...m[0].matchAll(/<a href="user-home-\d+\.htm"[^>]*>([^<]{2,40})<\/a>/g)].at(-1);
    if (!t) continue;
    items.push({
      url: `${BASE}/thread-${tid}.htm`,
      title: htmlToText(t[1]),
      author: au ? htmlToText(au[1]) : undefined,
    });
  }
  return items;
}

// ---------- 看雪帖子正文解析 ----------

export function parseThread(html) {
  const title = html.match(/<title>([^<]*)</)?.[1]?.replace(/-[^-]*-看雪安全社区.*$/, '').trim();
  const author = html.match(/<a href="user-home-\d+\.htm"[^>]*title="([^"]+)"[^>]*>/)?.[1] ||
    html.match(/user-home-\d+\.htm"[^>]*>([^<]{2,40})<\/a>/)?.[1];
  // 正文：优先取第一条消息（isfirst=1，markdown 或富文本类型均可），终止于下一条消息
  const first =
    html.match(/<div class="message[^"]*"[^>]*isfirst="1"[^>]*>([\s\S]*?)<\/div>\s*<div class="message/) ||
    html.match(/<div class="message[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<div class="message/) ||
    html.match(/<div class="message[^"]*"[^>]*isfirst="1"[^>]*>([\s\S]*)/) ||
    html.match(/<div class="message[^"]*"[^>]*>([\s\S]*)/);
  return { title: title || undefined, author, body: htmlToText(first ? first[1] : '') };
}

// ---------- 微信文章解析（备用渠道） ----------

export function parseWechat(html) {
  const meta = (prop) => html.match(new RegExp(`<meta property="${prop}" content="([^"]*)"`))?.[1];
  const title = meta('og:title');
  const author = meta('og:article:author') || meta('og:description');
  const body = html.match(/<div[^>]*id="js_content"[^>]*>([\s\S]*?)(?:<\/div>\s*<script|$)/)?.[1] || '';
  return { title, author, body: htmlToText(body) };
}

// ---------- CLI ----------

function usage() {
  console.log(`看雪/微信技术文章源获取工具

用法:
  wxsource.mjs kanxue list [--board 名|--id N] [--pages N] [--md]
      论坛文章列表（默认全站首页；--md 输出 markdown 列表）
      内置版块: ${Object.keys(BOARDS).filter((k) => BOARDS[k]).join(' / ')}
  wxsource.mjs kanxue thread <帖子ID> [--md]
      单篇帖子标题/作者/正文（帖子ID 如 292402）
  wxsource.mjs wechat <文章URL> [--md]
      微信文章抓取（备用渠道，公众号内容 = 论坛转载）

输出默认 JSON（{url,title,author,body} 结构），--md 输出 markdown。`);
}

function argVal(args, name, fallback) {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback;
}
function has(args, name) {
  return args.includes(name);
}

async function main(argv) {
  const args = argv.slice(2);
  if (args.length === 0 || has(args, '-h') || has(args, '--help')) return usage();

  const md = has(args, '--md');
  const cmd = args[0];

  if (cmd === 'kanxue' && args[1] === 'list') {
    const board = argVal(args, '--board', 'home');
    const boardId = argVal(args, '--id', null) ?? BOARDS[board];
    const pages = parseInt(argVal(args, '--pages', '1'), 10);
    if (boardId === undefined && board !== 'home')
      throw new Error(`未知版块 "${board}"，用 --id 指定 forum 编号，或见 -h 的版块列表`);
    const urls = [];
    for (let p = 1; p <= pages; p++) {
      const url = boardId ? `${BASE}/forum-${boardId}${p > 1 ? '-' + p : ''}.htm` : `${BASE}/`;
      const html = await fetchText(url);
      const items = boardId ? parseForumList(html) : parseKanxueHomeList(html);
      urls.push(...items);
    }
    if (md) {
      console.log(`## 看雪 ${board} 文章列表\n`);
      for (const it of urls) console.log(`- [${it.title}](${it.url})` + (it.author ? ` — ${it.author}` : ''));
    } else {
      console.log(JSON.stringify(urls, null, 2));
    }
  } else if (cmd === 'kanxue' && args[1] === 'thread') {
    const id = args[2];
    if (!id) throw new Error('缺少帖子ID，如: kanxue thread 292402');
    const html = await fetchText(`${BASE}/thread-${id}.htm`);
    const t = parseThread(html);
    if (md) {
      console.log(`# ${t.title}\n\n作者: ${t.author ?? '未知'}\n\n${t.body}`);
    } else {
      console.log(JSON.stringify({ url: `${BASE}/thread-${id}.htm`, ...t }, null, 2));
    }
  } else if (cmd === 'wechat') {
    const url = args[1];
    if (!url) throw new Error('缺少微信文章 URL');
    const html = await fetchText(url);
    const a = parseWechat(html);
    if (md) {
      console.log(`# ${a.title ?? '未知'}\n\n作者: ${a.author ?? '未知'}\n\n${a.body}`);
    } else {
      console.log(JSON.stringify({ url, ...a }, null, 2));
    }
  } else {
    usage();
    process.exitCode = 1;
  }
}

if (process.argv[1]?.endsWith('wxsource.mjs')) {
  main(process.argv).catch((e) => {
    console.error(`错误: ${e.message}`);
    process.exitCode = 1;
  });
}
