import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {parseFragment} from 'parse5';

const result = await build({
  entryPoints: [new URL('../src/components/book/WeeklyPagination.tsx', import.meta.url).pathname],
  bundle: true, platform: 'node', format: 'esm', write: false, jsx: 'automatic', loader: {'.css': 'empty'},
  plugins: [{name: 'external-packages', setup(plugin) {
    plugin.onResolve({filter: /^[^./]/}, ({path}) => ({path: import.meta.resolve(path), external: true}));
  }}],
});
const {default: WeeklyPagination} = await import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'));
const nodes = (node) => [node, ...(node.childNodes ?? []).flatMap(nodes)];
const attr = (node, name) => node.attrs?.find((item) => item.name === name)?.value;
const render = (current, urls) => nodes(parseFragment(renderToStaticMarkup(createElement(WeeklyPagination, {current, urls}))));

test('Weekly pagination renders real links and disabled boundaries without client JavaScript', () => {
  const urls = ['/weekly/', '/weekly/page/2/'];
  for (const current of [1, 2]) {
    const rendered = render(current, urls);
    const links = rendered.filter((node) => node.tagName === 'a');
    assert.deepEqual([...new Set(links.map((node) => attr(node, 'href')))], urls);
    assert.ok(links.every((node) => attr(node, 'role') !== 'button'), 'Archive URLs retain normal link semantics');
    const active = rendered.filter((node) => attr(node, 'aria-current') === 'page');
    assert.equal(active.length, 1);
    assert.equal(attr(active[0], 'href'), urls[current - 1]);
    const boundary = rendered.filter((node) => node.tagName === 'button');
    assert.equal(boundary.length, 1);
    assert.equal(attr(boundary[0], 'disabled'), '');
    assert.equal(attr(boundary[0], 'aria-label'), current === 1 ? '上一页' : '下一页');
    assert.equal(attr(links.find((node) => attr(node, 'rel')), 'rel'), current === 1 ? 'next' : 'prev');
  }
});

test('Long Weekly archives retain first, current and last page navigation in a bounded page window', () => {
  const urls = Array.from({length: 25}, (_, index) => index ? `/weekly/page/${index + 1}/` : '/weekly/');
  for (const current of [1, 2, 13, 24, 25]) {
    const rendered = render(current, urls);
    const pageLinks = rendered.filter((node) => node.tagName === 'a' && !attr(node, 'rel'));
    const destinations = pageLinks.map((node) => attr(node, 'href'));
    assert.ok(destinations.length <= 5, 'The navigation does not grow with the archive');
    for (const href of [urls[0], urls[current - 1], urls.at(-1)]) assert.ok(destinations.includes(href));
    assert.ok(pageLinks.every((node) => urls.includes(attr(node, 'href'))));
  }
  assert.equal(render(1, ['/weekly/']).filter((node) => node.tagName === 'nav').length, 0);
});
