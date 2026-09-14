import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

const result = await build({
  entryPoints: [new URL('../src/components/book/WeeklyCardsView.tsx', import.meta.url).pathname],
  bundle: true, platform: 'node', format: 'esm', write: false, jsx: 'automatic', loader: {'.css': 'empty'},
  plugins: [{name: 'external-packages', setup(plugin) {
    plugin.onResolve({filter: /^[^./]/}, ({path}) => ({path: import.meta.resolve(path), external: true}));
  }}],
});
const {default: WeeklyCardsView} = await import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'));
const items = [
  {href: '/weekly/2026/2026-w36/', label: '2026-W36', description: '封面说明', image: {src: '/logo.gif', alt: '2026-W36'}, dateLabel: '2026.09.07'},
  {href: '/weekly/2026/2026-w35/', label: '2026-W35', image: {src: '/logo.gif', alt: '2026-W35'}, dateLabel: '2026.08.31'},
];
const html = renderToStaticMarkup(createElement(WeeklyCardsView, {items}));

test('Weekly list renders cover cards without search or compact-list chrome', () => {
  assert.match(html, /data-content-collection="weekly"/);
  assert.match(html, /weekly-card/);
  assert.match(html, /href="\/weekly\/2026\/2026-w36\/"/);
  assert.match(html, /本页 2 期/);
  assert.doesNotMatch(html, /找一期想读的周刊/);
  assert.doesNotMatch(html, /按标题、封面说明或日期搜索/);
  assert.doesNotMatch(html, /紧凑列表/);
  assert.doesNotMatch(html, /搜索本页周刊/);
  assert.doesNotMatch(html, /data-weekly-view/);
  assert.doesNotMatch(html, /aria-label="周刊展示方式"/);
});
