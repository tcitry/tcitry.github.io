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
const html = renderToStaticMarkup(createElement(TimelineView, {items: [
  {id: 'x', label: '2026-09-08', html: '<p>🐦 Posted on X</p><p><a href="https://x.com/example/status/42">https://x.com/example/status/42</a></p>'},
  {id: 'publish', label: '2026-09-08', html: `<p>📝 Published on site</p>${articleList}<p>放在同一张知识网上。</p>`},
  {id: 'weekly', label: '2026-09-09', html: `<p>📰 Weekly published</p>${articleList}`},
  {id: 'star', label: '2026-09-08', html: '<p>⭐ Starred Github Repo</p><p><a href="https://github.com/example/project">https://github.com/example/project</a></p>'},
]}));

function event(id) {
  const start = html.indexOf(`id="${id}"`);
  assert.ok(start >= 0, id);
  const end = html.indexOf(`id="`, start + 1);
  return html.slice(start, end === -1 ? undefined : end);
}

test('timeline hubs keep every related article link and X posts stay a single status', () => {
  const posted = event('x');
  assert.match(posted, /data-timeline-kind="x"/);
  assert.match(posted, /X 发布/);
  assert.doesNotMatch(posted, /data-timeline-hub/);
  assert.match(posted, /href="https:\/\/x\.com\/example\/status\/42"/);

  const published = event('publish');
  assert.match(published, /data-timeline-kind="publish"/);
  assert.match(published, /data-timeline-hub="true"/);
  assert.match(published, /站点发布/);
  assert.match(published, /放在同一张知识网上/);
  const weekly = event('weekly');
  assert.match(weekly, /data-timeline-kind="weekly"/);
  assert.match(weekly, /data-timeline-hub="true"/);
  assert.match(weekly, /Weekly 发布/);
  for (const hub of [published, weekly]) {
    for (const [href, label] of articles) {
      assert.match(hub, new RegExp(`href="${href.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`));
      assert.match(hub, new RegExp(label));
    }
  }
  const starred = event('star');
  assert.match(starred, /data-timeline-kind="star"/);
  assert.match(starred, /GitHub Star/);
  assert.doesNotMatch(starred, /data-timeline-hub/);
  assert.equal(html.match(/<svg\b/g)?.length, 4);
});
