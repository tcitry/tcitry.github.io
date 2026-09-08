import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';

const result = await build({
  entryPoints: [new URL('../src/components/book/timeline-presentation.ts', import.meta.url).pathname],
  bundle: true, platform: 'node', format: 'esm', write: false,
});
const {getTimelinePresentation} = await import(
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
