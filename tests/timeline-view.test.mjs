import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

const result = await build({
  entryPoints: [new URL('../src/components/book/TimelineView.tsx', import.meta.url).pathname],
  bundle: true, platform: 'node', format: 'esm', write: false, jsx: 'automatic',
  loader: {'.css': 'empty', '.module.css': 'empty'},
  plugins: [{name: 'external-packages', setup(plugin) {
    plugin.onResolve({filter: /^[^./]/}, ({path}) => ({path: import.meta.resolve(path), external: true}));
  }}],
});
const {default: TimelineView} = await import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'));

const articles = [
  ['/posts/2026/contract-testing/', '契约测试'],
  ['https://yindongliang.com/docs/agents/testing/', 'Agent 测试'],
  ['https://yindongliang.com/posts/2026/weaving/', '知识编织'],
];
const articleList = `<ul>${articles.map(([href, label]) => `<li><a href="${href}">${label}</a></li>`).join('')}</ul>`;
const primary = 'https://yindongliang.com/docs/Cloudflare/AI-Agents/cloudflare-agents-sdk-guide/';
const dayList = `<ul>
  <li><a href="https://yindongliang.com/docs/Frontend/TanStack/tanstack-ai-vs-ai-sdk/">TanStack AI 1.0 与 AI SDK 7：机制、能力与工程选型</a> — 模型接入桥接与界面消息协议对照</li>
  <li><a href="https://yindongliang.com/docs/Cloudflare/workflows-api-and-recovery/">Workflows：实例、步骤、事件与恢复 API 实战</a> — 执行步骤持久化与重放的相邻能力</li>
</ul>`;
const html = renderToStaticMarkup(createElement(TimelineView, {items: [
  {id: 'x', label: '2026-09-08', html: '<p>🐦 Posted on X</p><p><a href="https://x.com/example/status/42">https://x.com/example/status/42</a></p>'},
  {id: 'publish', label: '2026-09-08', html: `<p>📝 Published on site</p>${articleList}<p>放在同一张知识网上。</p>`},
  {id: 'weekly', label: '2026-09-09', html: `<p>📰 Weekly published</p>${articleList}`},
  {id: 'star', label: '2026-09-08', html: '<p>⭐ Starred Github Repo</p><p><a href="https://github.com/example/project">https://github.com/example/project</a></p>'},
  {id: 'publish-day', label: '2026-10-24', html: `<p>📝 Published on site</p><p><a href="${primary}">${primary}</a></p><p>用工单 T-42 串起 Cloudflare Agents SDK。</p>${dayList}`},
  {id: 'publish-caption', label: '2026-10-25', html: `<p>📝 Published on site</p><p><a href="https://example.com/primary">https://example.com/primary</a></p><p>当天说明。</p><p>关联阅读</p><ul><li><a href="https://example.com/related">相关文章</a> — 补充</li></ul>`},
  {id: 'publish-solo', label: '2026-10-26', html: '<p>📝 Published on site</p><p><a href="https://example.com/only">https://example.com/only</a></p>'},
  {id: 'plain', label: '2026-10-27', html: '<p>关联阅读</p><ul><li><a href="https://example.com/plain">普通链接</a></li></ul>'},
]}));

const itemIds = ['x', 'publish', 'weekly', 'star', 'publish-day', 'publish-caption', 'publish-solo', 'plain'];
function event(id) {
  const start = html.indexOf(`id="${id}"`);
  assert.ok(start >= 0, id);
  const next = itemIds[itemIds.indexOf(id) + 1];
  const end = next ? html.indexOf(`id="${next}"`, start + id.length) : -1;
  return html.slice(start, end === -1 ? undefined : end);
}

test('timeline hubs keep every related article link and X posts stay a single status', () => {
  const posted = event('x');
  assert.match(posted, /data-timeline-kind="x"/);
  assert.match(posted, /X 发布/);
  assert.match(posted, /1 个链接/);
  assert.doesNotMatch(posted, /篇发布|条关联|data-timeline-hub|data-timeline-related/);
  assert.match(posted, /href="https:\/\/x\.com\/example\/status\/42"/);

  const published = event('publish');
  assert.match(published, /data-timeline-kind="publish"/);
  assert.match(published, /data-timeline-hub="true"/);
  assert.match(published, /站点发布/);
  assert.match(published, /2 条关联/);
  assert.match(published, />3 条关联</);
  assert.doesNotMatch(published, /个链接|篇发布/);
  assert.match(published, /放在同一张知识网上/);
  assert.doesNotMatch(published, /<ul/);
  const weekly = event('weekly');
  assert.match(weekly, /data-timeline-kind="weekly"/);
  assert.match(weekly, /data-timeline-hub="true"/);
  assert.match(weekly, /Weekly 发布/);
  assert.match(weekly, /2 条关联/);
  assert.match(weekly, />3 条关联</);
  for (const hub of [published, weekly]) {
    assert.match(hub, /data-timeline-related=""/);
    assert.equal(hub.match(/关联阅读/g)?.length, 1);
    assert.match(hub, /data-slot="chat-source"/);
    assert.doesNotMatch(hub, /hover-card|data-timeline-related-caption/);
    for (const [href, label] of articles) {
      assert.match(hub, new RegExp(`href="${href.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`));
      assert.match(hub, new RegExp(label));
      const favicon = href.startsWith('/')
        ? '/favicon.png'
        : `https://www.google.com/s2/favicons?domain_url=${encodeURIComponent(href)}&amp;sz=64`;
      assert.match(hub, new RegExp(`src="${favicon.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`));
    }
    const entry = hub.slice(hub.indexOf('data-timeline-entry'), hub.indexOf('data-timeline-related'));
    assert.doesNotMatch(entry, /契约测试|Agent 测试|知识编织/);
  }
  const day = event('publish-day');
  assert.match(day, /data-timeline-hub="true"/);
  assert.match(day, /1 篇发布 · 2 条关联/);
  assert.match(day, />2 条关联</);
  assert.doesNotMatch(day, /个链接|data-timeline-related-caption|<ul/);
  assert.match(day, new RegExp(`href="${primary.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`));
  assert.match(day, /TanStack AI 1\.0 与 AI SDK 7：机制、能力与工程选型/);
  assert.match(day, /模型接入桥接与界面消息协议对照/);
  assert.match(day, /Workflows：实例、步骤、事件与恢复 API 实战/);
  assert.match(day, /执行步骤持久化与重放的相邻能力/);
  assert.match(day, /用工单 T-42 串起 Cloudflare Agents SDK。/);
  const dayEntry = day.slice(day.indexOf('data-timeline-entry'), day.indexOf('data-timeline-related'));
  assert.match(dayEntry, /用工单 T-42/);
  assert.doesNotMatch(dayEntry, /TanStack|Workflows/);
  const caption = event('publish-caption');
  assert.match(caption, /1 篇发布 · 1 条关联/);
  assert.match(caption, />1 条关联</);
  assert.equal(caption.match(/关联阅读/g)?.length, 1);
  assert.match(caption, /data-timeline-related=""/);
  assert.doesNotMatch(caption, /data-timeline-related-caption|<ul/);
  const captionEntry = caption.slice(caption.indexOf('data-timeline-entry'), caption.indexOf('data-timeline-related'));
  assert.doesNotMatch(captionEntry, /关联阅读/);
  assert.match(caption, /href="https:\/\/example\.com\/related"/);
  assert.match(caption, /相关文章/);
  assert.match(caption, /补充/);
  const solo = event('publish-solo');
  assert.match(solo, /1 篇发布/);
  assert.doesNotMatch(solo, /个链接|条关联|data-timeline-related/);
  const plain = event('plain');
  assert.match(plain, /1 个链接/);
  assert.doesNotMatch(plain, /data-timeline-hub|data-timeline-related|篇发布|条关联/);
  assert.match(plain, /<p>关联阅读<\/p>/);
  assert.match(plain, /<ul/);
  const starred = event('star');
  assert.match(starred, /data-timeline-kind="star"/);
  assert.match(starred, /GitHub Star/);
  assert.match(starred, /1 个链接/);
  assert.doesNotMatch(starred, /data-timeline-hub|data-timeline-related/);
  assert.equal(html.match(/<svg\b/g)?.length, 12);
});
