import assert from 'node:assert/strict';
import test from 'node:test';
import { assetPathname, publicURL } from '../src/lib/public-url.mjs';
import { assertSitemapLocations, canonicalLinks, routingSensitive, sitemapLocations, sitemapSample } from '../scripts/verify-deployment.mjs';

const cpp = 'https://yindongliang.com/docs/C-C%2B%2B/';
const unicode = 'https://yindongliang.com/docs/C-C%2B%2B/%E7%B3%BB%E7%BB%9F%E8%B0%83%E7%94%A8/';

test('public URLs use the spelling Workers static assets answer with 200', () => {
  assert.equal(publicURL('/docs/C-C++/'), cpp);
  assert.equal(publicURL('/docs/C-C%2B%2B/'), cpp);
  assert.equal(publicURL('/docs/C-C%2b%2b/'), cpp);
  assert.equal(publicURL('/docs/C-C++/系统调用/'), unicode);
  assert.equal(publicURL('/docs/C-C++/%E7%B3%BB%E7%BB%9F%E8%B0%83%E7%94%A8/'), unicode);
  assert.equal(publicURL('/posts/hello-world/'), 'https://yindongliang.com/posts/hello-world/');
  assert.equal(publicURL('/'), 'https://yindongliang.com/');
  assert.equal(assetPathname('/docs/C-C++/'), '/docs/C-C%2B%2B/');
});

const page = href => `<html><head><link rel="canonical" href="${href}"></head></html>`;
const pages = new Map([[cpp, page(cpp)], [unicode, page(unicode)], ['https://yindongliang.com/labs/', page('https://yindongliang.com/labs/')]]);
const canonicalOf = loc => canonicalLinks(pages.get(loc) ?? '');

test('sitemap URLs must equal their page canonical and avoid asset rewrites', () => {
  const xml = `<urlset>${[...pages.keys()].map(loc => `<url><loc>${loc}</loc></url>`).join('')}</urlset>`;
  const locations = sitemapLocations(xml);
  assert.deepEqual(locations, [...pages.keys()]);
  assertSitemapLocations(locations, { canonicalOf });
  assert.throws(() => assertSitemapLocations(['https://yindongliang.com/docs/C-C++/'], { canonicalOf: () => ['https://yindongliang.com/docs/C-C++/'] }), /rewritten by asset routing/);
  assert.throws(() => assertSitemapLocations(['https://yindongliang.com/docs/C-C%2b%2b/'], { canonicalOf: () => ['https://yindongliang.com/docs/C-C%2b%2b/'] }), /rewritten by asset routing/);
  assert.throws(() => assertSitemapLocations(['https://yindongliang.com/labs'], { canonicalOf: () => ['https://yindongliang.com/labs'] }), /trailing-slash redirect/);
  assert.throws(() => assertSitemapLocations([cpp], { canonicalOf: () => ['https://yindongliang.com/docs/C-C++/'] }), /differs from its page canonical/);
  assert.throws(() => assertSitemapLocations([cpp], { canonicalOf: () => [] }), /differs from its page canonical/);
  assert.throws(() => assertSitemapLocations([cpp, cpp], { canonicalOf }), /Duplicate sitemap URL/);
  assert.throws(() => assertSitemapLocations([cpp], { canonicalOf, redirects: [{ from: '/docs/C-C++/', to: '/' }] }), /_redirects source/);
  assert.throws(() => assertSitemapLocations(['https://example.com/'], { canonicalOf: () => ['https://example.com/'] }), /off-site/);
});

test('deployment sitemap sample always includes every routing-sensitive URL', () => {
  const plain = Array.from({ length: 200 }, (_, index) => `https://yindongliang.com/posts/${index}/`);
  const locations = [...plain.slice(0, 77), cpp, ...plain.slice(77), unicode];
  assert.equal(routingSensitive(cpp), true);
  assert.equal(routingSensitive(unicode), true);
  assert.equal(routingSensitive('https://yindongliang.com/docs/%E7%B3%BB/'), false);
  const sample = sitemapSample(locations, { size: 10 });
  assert.ok(sample.includes(cpp) && sample.includes(unicode));
  assert.ok(sample.length <= 12);
  assert.deepEqual(sitemapSample(locations, { all: true }), locations);
});
