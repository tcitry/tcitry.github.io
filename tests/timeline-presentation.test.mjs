import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';

const result = await build({
  entryPoints: [new URL('../src/components/book/timeline-presentation.ts', import.meta.url).pathname],
  bundle: true, platform: 'node', format: 'esm', write: false,
});
const {getTimelinePresentation, hubLinkLabel, splitHubRelatedReading, timelineFaviconUrl} = await import(
  'data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64')
);
const present = (html, label = '2026-09-08') => getTimelinePresentation({html, label});
const link = (url, label = url) => `<a href="${url}">${label}</a>`;
const repository = 'https://github.com/example/project';
const star = '<p>⭐ Starred Github Repo</p>';

test('pinned groups keep their priority and count links without inventing a weekday', () => {
  assert.deepEqual(present(star + `<p>${link(repository)}</p>`, 'Top 2026'), {
    kind: 'pinned', label: '置顶', linkCount: 1,
  });
  assert.equal(present('<p>置顶建议</p>', 'Top choices').kind, 'note');
});

test('an exact X post marker and a status link stay a simple post', () => {
  const marker = '<p>🐦 Posted on X</p>';
  const status = 'https://x.com/example/status/1234567890123456789';
  assert.deepEqual(present(`${marker}<p>${link(status)}</p>`), {
    kind: 'x', label: 'X 发布', linkCount: 1, weekday: '星期二',
  });
  assert.equal(present(`<blockquote>整理说明</blockquote>${marker}<p>\n${link(`${status}?s=20`)}\n</p>`).kind, 'x');
  assert.equal(present(`${marker}<p>${link('https://www.x.com/i/web/status/42')}</p>`).kind, 'x');
  assert.equal(present(`${marker}<p>${link('https://x.com/example/status/42/photo/1')}</p>`).kind, 'x');
  const listed = present(`${marker}<ul><li>${link(status)}</li><li>${link('https://example.com/extra')}</li></ul>`);
  assert.equal(listed.kind, 'x');
  assert.equal(listed.hub, undefined);
  assert.equal(listed.linkCount, 2);
  assert.equal(present(marker).kind, 'note');
  assert.equal(present(`<p>我看到了 🐦 Posted on X 字样。</p><p>${link(status)}</p>`).kind, 'link');
  assert.equal(present(`<p><code>🐦 Posted on X</code></p><p>${link(status)}</p>`).kind, 'link');
  for (const url of [
    'https://twitter.com/example/status/42',
    'https://x.com/example',
    'https://x.com/example/status/',
    'https://x.com/example/status/not-a-number',
    'http://x.com/example/status/42',
    'https://x.com.evil.example/example/status/42',
    'https://mobile.x.com/example/status/42',
  ]) assert.notEqual(present(`${marker}<p>${link(url)}</p>`).kind, 'x', url);
  assert.equal(present(`${marker}<p>${link(status)}</p><img src="cover.png">`).kind, 'x');
  assert.equal(present(marker + `<p>${link(status)}</p>`, 'Top 2026').kind, 'pinned');
  assert.equal(present(star + `<p>${link(repository)}</p>${marker}<p>${link(status)}</p>`).kind, 'star');
});

test('publish and weekly markers keep every related article as a hub', () => {
  const articles = `<ul>
    <li><a href="/posts/2026/contract-testing/">契约测试</a></li>
    <li><a href="https://yindongliang.com/docs/agents/testing/">Agent 测试</a></li>
    <li><a href="https://yindongliang.com/posts/2026/weaving/">知识编织</a></li>
    <li><p><a href="https://yindongliang.com/weekly/2026/42/">Weekly 42</a> 同一张图上的周刊。</p></li>
  </ul><p>这些链接一起读，不收成一条主链接。</p>`;
  assert.deepEqual(present(`<p>📝 Published on site</p>${articles}`), {
    kind: 'publish', label: '站点发布', linkCount: 3, weekday: '星期二', hub: true,
    publishCount: 0, relatedCount: 3,
  });
  assert.deepEqual(present('<p>\n📰 Weekly published\n</p>' + articles), {
    kind: 'weekly', label: 'Weekly 发布', linkCount: 3, weekday: '星期二', hub: true,
    publishCount: 0, relatedCount: 3,
  });
  assert.equal(hubLinkLabel(0, 3), '3 条关联');
  const bare = present('<p>📝 Published on site</p>');
  assert.equal(bare.hub, true);
  assert.equal(bare.publishCount, 0);
  assert.equal(bare.relatedCount, 0);
  assert.equal(hubLinkLabel(0, 0), undefined);
  assert.equal(present(`<p>📝 Published on site</p>${articles}<img src="map.png"><pre>snippet</pre>`).kind, 'publish');
  assert.equal(present(`<p>今天 📝 Published on site 了。</p>${articles}`).kind, 'link');
  assert.equal(present(`<p><code>📰 Weekly published</code></p>${articles}`).kind, 'link');
  assert.equal(present(articles).kind, 'link');
  assert.equal(present(`<p>📝 Published on site</p><p>📰 Weekly published</p>${articles}`).kind, 'publish');
  assert.equal(present(`<p>📝 Published on site</p>${articles}`, 'Top 2026').hub, undefined);
  assert.equal(present(star + `<p>${link(repository)}</p><p>📝 Published on site</p>${articles}`).kind, 'star');
  assert.equal(present(`<p>📝 Published on site</p>${articles}`).linksOnly, undefined);
});

test('a hub separates the primary publish URL from related list links', () => {
  const primary = 'https://yindongliang.com/docs/Cloudflare/AI-Agents/cloudflare-agents-sdk-guide/';
  const related = [
    ['https://yindongliang.com/docs/Frontend/TanStack/tanstack-ai-vs-ai-sdk/', 'TanStack AI 1.0 与 AI SDK 7：机制、能力与工程选型'],
    ['https://yindongliang.com/docs/Cloudflare/workflows-api-and-recovery/', 'Workflows：实例、步骤、事件与恢复 API 实战'],
  ];
  const html = `<p>📝 Published on site</p><p>${link(primary)}</p>` +
    '<p>用工单 T-42 串起 Cloudflare Agents SDK。</p><ul>' +
    related.map(([href, label]) => `<li>${link(href, label)} — 相邻说明</li>`).join('') +
    '</ul>';
  const published = present(html);
  assert.deepEqual(published, {
    kind: 'publish', label: '站点发布', linkCount: 3, weekday: '星期二', hub: true,
    publishCount: 1, relatedCount: 2,
  });
  assert.equal(hubLinkLabel(published.publishCount, published.relatedCount), '1 篇发布 · 2 条关联');
  const weekly = present(`<p>📰 Weekly published</p><p>${link('https://yindongliang.com/weekly/2026/42/')}</p>` +
    `<ul><li>${link(related[0][0], related[0][1])}</li></ul>`);
  assert.equal(weekly.kind, 'weekly');
  assert.equal(weekly.publishCount, 1);
  assert.equal(weekly.relatedCount, 1);
  assert.equal(hubLinkLabel(weekly.publishCount, weekly.relatedCount), '1 篇发布 · 1 条关联');

  const only = present(`<p>📝 Published on site</p><p>${link(primary)}</p><p>只有当天这一篇。</p>`);
  assert.equal(only.publishCount, 1);
  assert.equal(only.relatedCount, 0);
  assert.equal(hubLinkLabel(only.publishCount, only.relatedCount), '1 篇发布');

  const repeated = present(`<p>📝 Published on site</p><p>${link(primary)}</p><ul><li>${link(primary, '同一篇')}</li><li>${link(related[1][0], related[1][1])}</li></ul>`);
  assert.equal(repeated.linkCount, 2);
  assert.equal(repeated.publishCount, 1);
  assert.equal(repeated.relatedCount, 1);
  assert.equal(hubLinkLabel(2, 4), '2 篇发布 · 4 条关联');

  const nested = present(`<p>📝 Published on site</p><p>${link(primary)}</p><ul><li>延伸<ol><li>${link(related[0][0], related[0][1])}</li></ol></li></ul>`);
  assert.equal(nested.publishCount, 1);
  assert.equal(nested.relatedCount, 1);

  const hidden = present(`<p>📝 Published on site</p><pre><ul><li>${link('https://example.com/secret', 'secret')}</li></ul></pre><p>${link(primary)}</p>`);
  assert.equal(hidden.linkCount, 1);
  assert.equal(hidden.publishCount, 1);
  assert.equal(hidden.relatedCount, 0);
  assert.equal(present(`<p>📝 Published on site</p><p>${link(primary)}</p><ul><li>${link('/posts/older/', '站内旧文')}</li></ul>`).relatedCount, 0);
});

test('hub lists become citation sources and leave the primary HTML untouched', () => {
  const primary = `<p>📝 Published on site</p>\n<p>${link('https://example.com/a?x=1&amp;y=2')}</p>\n<p>说明 &amp; 保留。</p>`;
  const listed = `${primary}\n<ul><li>${link('https://example.com/b', '相关')}</li></ul>`;
  const split = splitHubRelatedReading(listed);
  assert.equal(split.html, `${primary}\n`);
  assert.deepEqual(split.sources, [{href: 'https://example.com/b', title: '相关'}]);

  const captioned = [
    '<p>📝 Published on site</p>',
    `<p>${link('https://example.com/post')}</p>`,
    '<p>当天说明。</p>',
    '<p>关联阅读</p>',
    `<ul><li>${link('https://example.com/related', '相关')} — 补充</li></ul>`,
  ].join('\n');
  const cited = splitHubRelatedReading(captioned);
  assert.equal(cited.html, [
    '<p>📝 Published on site</p>',
    `<p>${link('https://example.com/post')}</p>`,
    '<p>当天说明。</p>',
    '',
    '',
  ].join('\n'));
  assert.equal(cited.html.includes('关联阅读'), false);
  assert.deepEqual(cited.sources, [{href: 'https://example.com/related', title: '相关', description: '补充'}]);

  assert.deepEqual(splitHubRelatedReading('<p>\n关联阅读\n</p>\n<ul></ul>'), {
    html: '<p>\n关联阅读\n</p>\n<ul></ul>', sources: [],
  });
  assert.deepEqual(splitHubRelatedReading('<h3 id="rel">关联阅读</h3><ol><li>延伸</li></ol>'), {
    html: '<h3 id="rel">关联阅读</h3><ol><li>延伸</li></ol>', sources: [],
  });
  const anchorCaption = '<h2 id="rel"><a class="anchor" href="#rel">#</a>关联阅读</h2>' +
    `<ul><li>${link('https://example.com/a', '标题')}</li></ul>`;
  const headed = splitHubRelatedReading(anchorCaption);
  assert.equal(headed.html, '');
  assert.deepEqual(headed.sources, [{href: 'https://example.com/a', title: '标题'}]);

  const separated = splitHubRelatedReading(`<p>关联阅读</p><p>然后才是列表</p><ul><li>${link('/posts/a/', '甲')} — 说明</li></ul>`);
  assert.equal(separated.html, '<p>关联阅读</p><p>然后才是列表</p>');
  assert.deepEqual(separated.sources, [{href: '/posts/a/', title: '甲', description: '说明'}]);

  const hidden = '<pre><code><p>关联阅读</p><ul><li><a href="https://example.com/secret">secret</a></li></ul></code></pre>';
  assert.deepEqual(splitHubRelatedReading(hidden), {html: hidden, sources: []});
  const mention = `<p>说明里提到关联阅读。</p><ul><li>${link('https://example.com/x', '不是标题')}</li></ul>`;
  const mentioned = splitHubRelatedReading(mention);
  assert.equal(mentioned.html, '<p>说明里提到关联阅读。</p>');
  assert.deepEqual(mentioned.sources, [{href: 'https://example.com/x', title: '不是标题'}]);
  for (const html of ['<p title="关联阅读">正文</p><ul></ul>', '<p>关联阅读：</p><ul></ul>']) {
    assert.deepEqual(splitHubRelatedReading(html), {html, sources: []}, html);
  }

  const both = `<p>关联阅读</p><ul><li>${link('https://example.com/a', 'A')}</li></ul>` +
    `<h4>关联阅读</h4><ol><li>${link('/b', 'B')}：后记</li></ol>`;
  assert.equal(splitHubRelatedReading(both).html, '');
  assert.deepEqual(splitHubRelatedReading(both).sources, [
    {href: 'https://example.com/a', title: 'A'},
    {href: '/b', title: 'B', description: '后记'},
  ]);

  const rich = `<ul><li>${link('https://example.com/a', 'A')}<img src="x.png"></li></ul>`;
  assert.deepEqual(splitHubRelatedReading(rich), {html: rich, sources: []});
  const blank = splitHubRelatedReading(`<ul><li>${link('https://example.com/a', '  ')}</li></ul>`);
  assert.deepEqual(blank.sources, [{href: 'https://example.com/a', title: 'https://example.com/a'}]);
  const scripted = '<ul><li><a href="javascript:alert(1)">x</a></li></ul>';
  assert.deepEqual(splitHubRelatedReading(scripted), {html: scripted, sources: []});

  const nested = `<ul><li>延伸<ol><li>${link('https://example.com/a', '标题')} — 注</li></ol></li>` +
    `<li>前言 ${link('https://example.com/b', '乙')} — 后半</li></ul>`;
  assert.deepEqual(splitHubRelatedReading(nested).sources, [
    {href: 'https://example.com/a', title: '标题', description: '注'},
    {href: 'https://example.com/b', title: '乙', description: '后半'},
  ]);
  const paired = `<ul><li>${link('https://example.com/a', 'A')} — 甲 ${link('https://example.com/b', 'B')} — 乙</li></ul>`;
  assert.deepEqual(splitHubRelatedReading(paired).sources, [
    {href: 'https://example.com/a', title: 'A', description: '甲'},
    {href: 'https://example.com/b', title: 'B', description: '乙'},
  ]);

  const absolute = 'https://example.com/a';
  assert.equal(timelineFaviconUrl(absolute), `https://www.google.com/s2/favicons?domain_url=${encodeURIComponent(absolute)}&sz=64`);
  assert.equal(timelineFaviconUrl('/posts/a/'), '/favicon.png');
});

test('an exact standalone Star marker and a repository link classify a mixed daily group', () => {
  const html = '<blockquote>Agent 整理说明</blockquote>' + star +
    `<p>${link(repository)}</p><p>第一个项目含 <code>API</code> 和图片功能说明。</p>` +
    star + `<p>${link('https://github.com/example/another')}</p><p>当日随记。</p>`;
  assert.deepEqual(present(html), {kind: 'star', label: 'GitHub Star', linkCount: 2, weekday: '星期二'});
  assert.equal(present(`<p>我看到了 ⭐ Starred Github Repo 字样。</p><p>${link(repository)}</p>`).kind, 'repository');
  assert.equal(present(`${star}<p>${link('https://github.com/settings/profile')}</p>`).kind, 'link');
  assert.equal(present(star).kind, 'note');
});

test('only standalone canonical repository URLs select the repository presentation', () => {
  assert.equal(present(`<p>\n${link(repository)}\n</p>`).kind, 'repository');
  assert.equal(present(`<p>${link(repository + '/')}</p>`).kind, 'repository');
  for (const html of [
    `<p>参考 ${link(repository, 'GitHub 源码')}。</p>`,
    `<p>${link(repository, 'GitHub 源码')}</p>`,
    `<p><code>附录</code>${link(repository)}</p>`,
    `<p>${link('https://github.com/example/project/tree/main')}</p>`,
    `<p>${link('https://github.com/example/project?tab=readme-ov-file')}</p>`,
    `<p>${link('https://github.com/example/project#readme')}</p>`,
    `<p>${link('https://github.com/settings/profile')}</p>`,
    `<p>${link('https://github.com/orgs/example')}</p>`,
    `<p>${link('https://github.com/org/example')}</p>`,
    `<p>${link('https://github.com/marketplace/actions')}</p>`,
    `<p>${link('https://github.com/example')}</p>`,
    `<p>${link('https://github.com.evil.example/example/project')}</p>`,
    `<p>${link('https://www.github.com/example/project')}</p>`,
    `<p>${link('http://github.com/example/project')}</p>`,
  ]) assert.equal(present(html).kind, 'link', html);
});

test('actual media, image and code structures take priority over ordinary links', () => {
  const repo = `<p>${link(repository)}</p>`;
  assert.equal(present(repo + '<video src="clip.mp4"></video><img src="cover.png"><pre>sample</pre>').kind, 'media');
  assert.equal(present(repo + '<audio src="clip.mp3"></audio>').kind, 'media');
  assert.equal(present(repo + '<iframe src="https://example.com/embed"></iframe>').kind, 'media');
  assert.equal(present(repo + '<img src="cover.png"><pre>sample</pre>').kind, 'image');
  assert.equal(present(repo + '<pre><code>sample()</code></pre>').kind, 'code');
  assert.equal(present('<p>Image 和 Video API 用 <code>source</code> 配置。</p>').kind, 'note');
  assert.equal(present('<p>&lt;img src="image.png"&gt;</p>').kind, 'note');
  assert.equal(present('<pre>&lt;video&gt;example&lt;/video&gt;</pre>').kind, 'code');
});

test('standalone YouTube video, channel and playlist URLs identify media while preserving group priorities', () => {
  for (const url of [
    'https://www.youtube.com/@HungyiLeeNTU', 'https://www.youtube.com/@AndrejKarpathy',
    'https://youtube.com/channel/UCexample/videos', 'https://www.youtube.com/user/example',
    'https://m.youtube.com/watch?v=abcdefghijk', 'https://youtu.be/abcdefghijk?t=20',
    'https://www.youtube.com/shorts/abcdefghijk', 'https://www.youtube.com/live/abcdefghijk',
    'https://www.youtube.com/playlist?list=PL_example',
  ]) assert.equal(present(`<p>${link(url)}</p>`).kind, 'media', url);
  const channel = `<p>${link('https://www.youtube.com/@HungyiLeeNTU')}</p>`;
  assert.equal(present(channel, 'Top 2026').kind, 'pinned');
  assert.equal(present(star + `<p>${link(repository)}</p>` + channel).kind, 'star');
});

test('ordinary YouTube references, unrelated paths and lookalike domains do not identify media', () => {
  const channel = 'https://www.youtube.com/@HungyiLeeNTU';
  for (const html of [
    `<p>参考 ${link(channel)}。</p>`, `<p>${link(channel, '课程频道')}</p>`,
    `<p>${link('https://youtube.com.evil.example/@channel')}</p>`,
    `<p>${link('https://video.youtube.com/@channel')}</p>`,
    `<p>${link('https://www.youtube.com/')}</p>`,
    `<p>${link('https://www.youtube.com/account')}</p>`,
    `<p>${link('https://www.youtube.com/results?search_query=video')}</p>`,
    `<p>${link('https://www.youtube.com/watch')}</p>`,
    `<p>${link('https://www.youtube.com/playlist')}</p>`,
    `<p>${link('https://youtu.be/')}</p>`,
    `<p>${link('https://example.com/')}</p><p>视频基础设施平台，支持 YouTube。</p>`,
  ]) assert.equal(present(html).kind, 'link', html);
  assert.equal(present(`<code><p>${link(channel)}</p></code>`).kind, 'note');
});

test('code, scripts, styles, comments and templates do not supply markers or links', () => {
  const hidden = `${star}<p>${link(repository)}</p><img src="example.png">`;
  for (const tag of ['code', 'script', 'style', 'template']) {
    const presentation = present(`<${tag}>${hidden}</${tag}>`);
    assert.equal(presentation.kind, 'note', tag);
    assert.equal(presentation.linkCount, 0, tag);
  }
  assert.equal(present(`<!-- ${hidden} -->`).kind, 'note');
  assert.equal(present(`<pre>${hidden}</pre>`).linkCount, 0);
  assert.equal(present(`<p><code>⭐ Starred Github Repo</code></p><p>${link(repository)}</p>`).kind, 'repository');
});

test('external link counts use valid HTTP URLs and deduplicate normalized destinations', () => {
  const html = [
    link('https://EXAMPLE.com:443/'), link('https://example.com/'),
    link('http://example.com/'), link('https://example.com/page?a=1&amp;b=2'),
    link('/docs/example/'), link('#anchor'), link('mailto:reader@example.com'),
    link('javascript:alert(1)'), link('data:text/plain,example'), link('https://'),
    link('https://[invalid'), link('//example.com/path'),
  ].join('');
  assert.deepEqual(present(html), {kind: 'link', label: '链接收录', linkCount: 3, weekday: '星期二'});
  assert.equal(present('<p>https://example.com/ is plain text without a link.</p>').linkCount, 0);
});

test('pure text links allow ordinary paragraph and list wrappers without changing their content', () => {
  const html = `<!-- links -->\n<p>${link('https://example.com/')}<br>${link('http://example.org/', 'Example')}</p>` +
    `<ul><li>${link('https://example.com/')}</li></ul><ol><li><p>${link('http://example.org/')}</p></li></ol>`;
  assert.deepEqual(present(html), {
    kind: 'link', label: '链接收录', linkCount: 2, weekday: '星期二', linksOnly: true,
  });
  assert.equal(present(`<p>${link(repository)}</p>`).linksOnly, true);
  assert.equal(present(`<p>${link('https://www.youtube.com/@HungyiLeeNTU')}</p>`).linksOnly, true);
  assert.equal(present(html, 'Top 2026').linksOnly, undefined);
  assert.equal(present(star + `<p>${link(repository)}</p>`).linksOnly, undefined);
});

test('descriptions, richer content, empty labels and non-HTTP links exclude the pure-link layout', () => {
  const valid = `<p>${link('https://example.com/')}</p>`;
  for (const extra of [
    '<p>附上一句介绍。</p>', '说明文字', '<ul><li>说明</li></ul>',
    '<img src="cover.png">', '<video src="clip.mp4"></video>',
    '<pre>sample</pre>', '<p><code>API</code></p>', '<blockquote></blockquote>',
    '<script>console.log("example")</script>', '<style>p {color: red}</style>',
    `<p>${link('javascript:alert(1)')}</p>`, `<p>${link('mailto:reader@example.com')}</p>`,
    `<p>${link('/docs/example/')}</p>`, `<p>${link('https://')}</p>`,
    `<p>${link('https://example.org/', '')}</p>`, `<p>${link('https://example.org/', '  ')}</p>`,
    '<a>无目标</a>', `<p>${link('https://example.org/', '<code>Example</code>')}</p>`,
  ]) {
    const presentation = present(valid + extra);
    assert.equal(Object.hasOwn(presentation, 'linksOnly'), false, extra);
  }
  for (const html of ['', ' \n<!-- empty --><p><br></p>', '<p>https://example.com/</p>']) {
    assert.equal(present(html).linksOnly, undefined, html);
  }
});

test('weekdays use strictly valid UTC calendar dates without overflow', () => {
  assert.equal(present('', '2024-02-29').weekday, '星期四');
  assert.equal(present('', '2026-09-06').weekday, '星期日');
  for (const label of [
    '2026-02-29', '2026-02-30', '2026-04-31', '2026-13-01', '2026-00-01',
    '2026-01-00', '2026-01-32', '2026-9-08', '2026-09-8', '2026-09-08 extra',
    ' 2026-09-08', '0000-01-01', 'Top 2026',
  ]) assert.equal(present('', label).weekday, undefined, label);
});

test('presentation leaves the authored HTML and heading unchanged', () => {
  const item = Object.freeze({label: '2026-09-08', html: `<p>${link(repository)}</p><p>原文。</p>`});
  const before = {...item};
  getTimelinePresentation(item);
  assert.deepEqual(item, before);
});
