import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const result = await build({
  entryPoints: [new URL('../src/lib/search-recent.ts', import.meta.url).pathname],
  bundle: true, platform: 'node', format: 'esm', write: false,
});
const { getRecentUpdates } = await import(
  'data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64')
);
const page = (id, overrides = {}) => ({
  id, source: `docs/${id}.md`, url: `/docs/${id}/`, title: id,
  kind: 'page', type: 'docs', section: 'docs', html: '<p>Public article.</p>',
  date: '2025-01-01', lastmod: '', hidden: false, redirect: false, params: {},
  ...overrides,
});

test('recent updates rank actual changes ahead of newer publication dates', () => {
  const updated = page('updated', { date: '2012-12-23', lastmod: '2026-09-07T23:00:00+08:00' });
  const published = page('published', { date: '2026-09-07T14:00:00Z' });
  const staleLastmod = page('stale-lastmod', { date: '2026-09-06', lastmod: '2020-01-01' });
  const entries = getRecentUpdates([staleLastmod, published, updated]);
  assert.deepEqual(entries.map((entry) => entry.url), [updated.url, published.url, staleLastmod.url]);
  assert.equal(entries[0].updated, '2026-09-07T15:00:00.000Z');
  assert.equal(entries[2].updated, '2026-09-06T00:00:00.000Z');
});

test('undated documents remain eligible when they have a valid lastmod', () => {
  const undated = page('undated', { date: '', lastmod: '2026-09-07' });
  const invalidLastmod = page('invalid-lastmod', { lastmod: 'not-a-date' });
  const noDate = page('no-date', { date: '', lastmod: 'invalid' });
  const hugoSentinel = page('hugo-sentinel', { date: '0001-01-01T00:00:00Z' });
  assert.deepEqual(getRecentUpdates([noDate, invalidLastmod, hugoSentinel, undated]).map((entry) => entry.url),
    [undated.url, invalidLastmod.url]);
});

test('recent suggestions exclude unpublished, hidden, excluded and nonarticle entries', () => {
  const excluded = [
    page('section', { kind: 'section' }), page('hidden', { hidden: true }),
    page('redirect', { redirect: true }), page('draft', { params: { draft: true } }),
    page('string-draft', { params: { draft: 'true' } }),
    page('search-exclude', { params: { bookSearchExclude: true } }),
    page('lowercase-exclude', { params: { booksearchexclude: 'true' } }),
    page('empty-body', { html: ' \n ' }), page('empty-title', { title: ' ' }),
    page('links', { type: 'links', url: '/links/example/' }),
    page('timeline', { type: 'timeline', url: '/timeline/2026/' }),
    page('about', { type: 'about', url: '/about/' }),
  ];
  const visible = page('visible', { params: { draft: false, bookSearchExclude: 'false' } });
  assert.deepEqual(getRecentUpdates([...excluded, visible]).map((entry) => entry.url), [visible.url]);
});

test('recent links stay in searchable routes and reject external or malformed URLs', () => {
  const invalid = [
    'https://example.com/docs/page/', '//example.com/docs/page/', 'javascript:alert(1)',
    '/about/', '/labs/example/', '/docs/../../private/example/',
    '/docs/../about/', '/docs/%2e%2e/about/', '/docs/bad%ZZ/',
    '/docs/page/?q=1', '/docs/page/#heading', '/docs/\\example/', '/docs/with space/',
  ].map((url, index) => page(`invalid-${index}`, { url }));
  const kept = page('encoded', { url: '/docs/Swift/%E4%B8%AD%E6%96%87/' });
  assert.deepEqual(getRecentUpdates([...invalid, kept]).map((entry) => entry.url), [kept.url]);
});

test('deduplication keeps the newest entry and ties remain stable without mutating input', () => {
  const original = page('same-url', { title: 'Older', lastmod: '2024-01-01' });
  const replacement = page('replacement', { url: original.url, title: 'Newer', lastmod: '2026-01-01' });
  const a = page('a', { title: 'Equal title' });
  const b = page('b', { title: 'Equal title' });
  const candidates = [b, original, a, replacement];
  const entries = getRecentUpdates(candidates);
  assert.deepEqual(entries.map((entry) => entry.url), [original.url, a.url, b.url]);
  assert.equal(entries[0].title, 'Newer');
  assert.deepEqual(getRecentUpdates([...candidates].reverse()), entries);
  assert.deepEqual(candidates.map((entry) => entry.id), ['b', 'same-url', 'a', 'replacement']);
  assert.equal(getRecentUpdates([
    page('upper', { url: '/docs/%E4%B8%AD/' }), page('lower', { url: '/docs/%e4%b8%ad/' }),
  ]).length, 1, 'Equivalent percent encoding must not duplicate a destination');
});

test('recent entries expose only display metadata and honor book title overrides', () => {
  const privateFields = {
    source: 'authoring-only.md', html: '<p>Full article body</p>', summary: 'Full generated summary',
    description: 'Not needed for initial suggestions', params: { linktitle: '  Display title  ', internal: 'do-not-publish' },
  };
  assert.deepEqual(getRecentUpdates([page('public', privateFields)]), [{
    url: '/docs/public/', title: 'Display title', updated: '2025-01-01T00:00:00.000Z', section: '文档',
  }]);
  const typed = getRecentUpdates([
    page('post', { type: 'posts', url: '/posts/post/' }),
    page('weekly', { type: 'weekly', url: '/weekly/weekly/' }),
    page('book-title', { params: { bookTitle: 'Book title' } }),
  ]);
  assert.deepEqual(new Set(typed.map((entry) => entry.section)), new Set(['文档', '文章', '周刊']));
  assert.ok(typed.some((entry) => entry.title === 'Book title'));
});

test('the default limit is six distinct entries and nonpositive limits are empty', () => {
  const candidates = Array.from({ length: 9 }, (_, index) => page(`entry-${index}`));
  assert.equal(getRecentUpdates(candidates).length, 6);
  assert.equal(getRecentUpdates(candidates, 3).length, 3);
  assert.equal(getRecentUpdates(candidates, 2.9).length, 2);
  for (const limit of [0, -1, NaN, Infinity]) assert.deepEqual(getRecentUpdates(candidates, limit), []);
});
