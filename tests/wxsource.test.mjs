import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  htmlToText,
  parseKanxueHomeList,
  parseForumList,
  parseThread,
  parseWechat,
  BASE,
} from '../bin/wxsource.mjs';

// 以下片段取自 2026-08 实抓的 bbs.kanxue.com 页面（仅保留关键结构）

test('htmlToText 转换段落/代码/图片/实体', () => {
  const html =
    '<p>第一段 <code>vmwrite(x)</code> 结束</p><p><img src="a.jpg"></p><pre>int x = 1;</pre><p>a&amp;b &lt;c&gt; &nbsp;</p>';
  const t = htmlToText(html);
  assert.match(t, /第一段 `vmwrite\(x\)` 结束/);
  assert.match(t, /\[图片\]/);
  assert.match(t, /int x = 1;/);
  assert.match(t, /a&b <c>/);
});

test('parseKanxueHomeList 首页聚合列表', () => {
  const html = `
  <a class="bbs_home_page_list_title" href="thread-292402.htm" title="[原创] 我把散装逆向经验压成了一套 Agent 作战系统：r0crawl_skills 全面介绍">[原创] 我把散装逆向经验压成了一套 Agent 作战系统：r0crawl_skills 全面介绍</a>
  <a class="bbs_home_page_list_title" href="thread-292370.htm" title="[原创]代码虚拟化面对AI时代的冲击即将彻底被击溃">[原创]代码虚拟化面对AI时代的冲击即将彻底被击溃</a>`;
  const items = parseKanxueHomeList(html);
  assert.equal(items.length, 2);
  assert.equal(items[0].url, `${BASE}/thread-292402.htm`);
  assert.match(items[0].title, /r0crawl_skills/);
});

test('parseForumList 分类页 xiuno 列表', () => {
  const html = `
  <table class="table threadlist"><tbody>
    <tr class="thread top_3" data-tid="292346">
      <td class="td-subject px-3"><div class="subject">
        <a href="thread-292346.htm" style="vertical-align: middle;">[公告] 2026 KCTF 攻击方规则发布</a>
      </div></td>
      <td><div class="col px-0"><a href="user-home-37853.htm" style="color: #999999;" class="username hidden-sm hidden-md">@ninebell</a></div></td>
    </tr>
    <tr class="thread" data-tid="292331">
      <td class="td-subject px-3"><div class="subject">
        <a href="thread-292331.htm" style="vertical-align: middle;">[原创]某商业级加固 Native Loader 逆向分析</a>
      </div></td>
      <td><div class="col px-0"><a href="user-home-1001878.htm" style="color: #999999;" class="username hidden-sm hidden-md">只会逆一点点</a></div></td>
    </tr>
  </tbody></table>`;
  const items = parseForumList(html);
  assert.equal(items.length, 2);
  assert.equal(items[0].title, '[公告] 2026 KCTF 攻击方规则发布');
  assert.equal(items[0].author, '@ninebell');
  assert.equal(items[0].url, `${BASE}/thread-292346.htm`);
  assert.equal(items[1].author, '只会逆一点点');
});

test('parseThread 帖子页标题/作者/正文', () => {
  const html = `
  <title>[原创] 实战帖子标题-软件逆向-看雪安全社区｜专业技术交流与安全研究论坛</title>
  <a href="user-home-1001878.htm" title="只会逆一点点">头像</a>
  <div class="message message_md_type" isfirst="1">
    <p>正文第一段 <code>mov eax, 0xCC</code></p><p><img src="x.png"></p>
  </div>
  <div class="message mt-2 break-all message_rich_type">
    <p>二楼回帖，不应被提取</p>
  </div>`;
  const t = parseThread(html);
  assert.equal(t.title, '[原创] 实战帖子标题');
  assert.equal(t.author, '只会逆一点点');
  assert.match(t.body, /正文第一段 `mov eax, 0xCC`/);
  assert.match(t.body, /\[图片\]/);
  assert.doesNotMatch(t.body, /二楼回帖/);
});

test('parseThread 富文本类型正文（message_rich_type）', () => {
  const html = `
  <title>[原创] TikTok X-Dynosaur 恐龙算法-逆向工程-看雪安全社区</title>
  <div class="message message_rich_type" isfirst="1">
    <p>富文本正文 <b>加粗</b> 内容</p>
    <p><code>X-Dynosaur</code> 算法分析</p>
  </div>`;
  const t = parseThread(html);
  assert.equal(t.title, '[原创] TikTok X-Dynosaur 恐龙算法');
  assert.match(t.body, /富文本正文 加粗 内容/);
  assert.match(t.body, /`X-Dynosaur` 算法分析/);
});

test('parseWechat 微信文章 og meta + js_content', () => {
  const html = `
  <meta property="og:title" content="基于VT EPT的无痕断点无痕hook原理及其应用">
  <meta property="og:article:author" content="只会逆一点点">
  <div id="js_content" class="rich_media_content">
    <p>正文第一句</p><p><code>vmexit</code> 触发</p>
  </div>
  <script>var t=1;</script>`;
  const a = parseWechat(html);
  assert.equal(a.title, '基于VT EPT的无痕断点无痕hook原理及其应用');
  assert.equal(a.author, '只会逆一点点');
  assert.match(a.body, /正文第一句/);
  assert.match(a.body, /`vmexit` 触发/);
});
