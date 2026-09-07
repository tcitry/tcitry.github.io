import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { collectSources, publicSources } from '../scripts/legacy-content.mjs';
import { addSitePages } from '../scripts/site-pages.mjs';

test('site-owned navigation routes survive removal of all Markdown placeholders', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'blog-site-pages-'));
  try {
    const records = publicSources(await collectSources(directory));
    assert.deepEqual(records, []);
    const pages = addSitePages(records);
    assert.deepEqual(pages.map(({ url, title, type, layout, toc, lastmod }) => ({ url, title, type, layout, toc, lastmod })), [
      { url: '/archives/', title: 'archives', type: 'archives', layout: 'list', toc: true, lastmod: '2025-05-19T12:28:45.000Z' },
      { url: '/ghstar/', title: 'ghstar', type: 'ghstar', layout: 'list', toc: false, lastmod: '2025-08-22T07:33:40.000Z' },
      { url: '/modified/', title: 'modified', type: 'archives', layout: 'modified', toc: true, lastmod: '2025-05-21T13:50:46.000Z' },
      { url: '/portfolio/', title: 'Portfolio', type: 'portfolio', layout: 'list', toc: false, lastmod: '2025-11-19T08:55:31.000Z' },
      { url: '/timeline/', title: 'Timeline', type: 'timeline', layout: 'list', toc: true, lastmod: '2025-11-19T06:55:07.000Z' },
    ]);
    assert.equal(new Set(pages.map((page) => page.id)).size, pages.length);
    for (const page of pages) {
      assert.equal(page.kind, 'page');
      assert.equal(page.source, '');
      assert.equal(page.parent, '/');
      assert.equal(page.html, '');
      assert.equal(page.params.siteOwned, true);
      assert.deepEqual(page.aliases, []);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('site routes cannot be silently replaced by a Markdown article or section', () => {
  for (const kind of ['page', 'section']) {
    assert.throws(() => addSitePages([{ id: 'conflict', source: 'timeline/_index.md', url: '/timeline/', kind }]), /conflicts with site-owned route \/timeline\//);
  }
  const article = { id: 'timeline/2026.md', url: '/timeline/2026/', kind: 'page' };
  const pages = addSitePages([article]);
  assert.equal(pages[0], article);
  assert.equal(pages.filter((page) => page.url === '/timeline/').length, 1);
  assert.equal(pages.find((page) => page.url === '/timeline/').kind, 'page');
});
