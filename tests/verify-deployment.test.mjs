import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assetReferences,
  hashedAstroAssets,
  publishedAssetPaths,
  retryUntil,
  waitForPublishedRelease,
} from '../scripts/verify-deployment.mjs';

const stalePage = '/_astro/page.NG88OkOd.js';
const livePage = '/_astro/page.D-Bdcy3v.js';
const sharedCss = '/_astro/shared.AAAAAAAA.css';
const json = body => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
const html = (assets, extras = '') => `${assets.map(asset => asset.endsWith('.css')
  ? `<link rel="stylesheet" href="${asset}">`
  : `<script type="module" src="${asset}"></script>`).join('')}${extras}`;

test('assetReferences reads hashed scripts, stylesheets and island URLs', () => {
  const refs = assetReferences(`
    <link rel="stylesheet" href="${sharedCss}">
    <link rel="modulepreload" href="${livePage}">
    <link rel="canonical" href="https://yindongliang.com/">
    <script type="module" src="${livePage}"></script>
    <img src="/logo.gif">
    <astro-island component-url="/_astro/SidebarTools.B8PHxu8Y.js" renderer-url="/_astro/client.DCBG4Bjx.js"></astro-island>
  `, '/');
  assert.deepEqual(refs.sort(), [
    '/_astro/SidebarTools.B8PHxu8Y.js',
    '/_astro/client.DCBG4Bjx.js',
    livePage,
    sharedCss,
    '/logo.gif',
  ].sort());
  assert.deepEqual(hashedAstroAssets(refs).sort(), [
    '/_astro/SidebarTools.B8PHxu8Y.js',
    '/_astro/client.DCBG4Bjx.js',
    livePage,
    sharedCss,
  ].sort());
});

test('published asset checks skip cached hashed filenames this release did not emit', () => {
  const publishedHtml = html([stalePage, sharedCss], '<link rel="icon" href="/favicon.ico">');
  const localHtml = html([livePage, sharedCss]);
  assert.deepEqual(publishedAssetPaths({ publishedHtml, localHtml, route: '/' }).sort(), [
    livePage,
    sharedCss,
    '/favicon.ico',
  ].sort());
  assert.ok(!publishedAssetPaths({ publishedHtml, localHtml, route: '/' }).includes(stalePage));
});

test('published asset checks keep this release hashed files even when live HTML is still stale', () => {
  const assets = publishedAssetPaths({
    publishedHtml: html([stalePage]),
    localHtml: html([livePage, '/_astro/BlogSearch.astro_astro_type_script_index_0_lang.D5_o2ke_.js']),
    route: '/',
  });
  assert.deepEqual(hashedAstroAssets(assets).sort(), [
    livePage,
    '/_astro/BlogSearch.astro_astro_type_script_index_0_lang.D5_o2ke_.js',
  ].sort());
});

test('retryUntil recovers from transient assertion failures and still fails persistent ones', async () => {
  const delays = [];
  let hits = 0;
  assert.equal(await retryUntil(async () => {
    hits += 1;
    if (hits < 3) {
      assert.equal(404, 200, `Asset status: ${stalePage}`);
    }
    return 'ok';
  }, { attempts: 4, delayMs: 25, sleep: async ms => { delays.push(ms); } }), 'ok');
  assert.equal(hits, 3);
  assert.deepEqual(delays, [25, 25]);

  await assert.rejects(() => retryUntil(async () => {
    assert.equal(404, 200, `Asset status: ${stalePage}`);
  }, { attempts: 3, delayMs: 0, sleep: async () => {} }), /Asset status: \/_astro\/page\.NG88OkOd\.js/);
});

test('waitForPublishedRelease waits for the marker to match this revision then still fails a stuck previous revision', async () => {
  const expected = { siteCommit: 'a'.repeat(40), contentCommit: 'b'.repeat(40) };
  const requests = [];
  let generation = 0;
  const fetchImpl = async url => {
    requests.push(String(url));
    generation += 1;
    const marker = generation < 3
      ? { siteCommit: 'c'.repeat(40), contentCommit: expected.contentCommit }
      : expected;
    return json(marker);
  };
  const marker = await waitForPublishedRelease({
    origin: 'https://yindongliang.com', expected, fetchImpl, attempts: 4, delayMs: 0, sleep: async () => {},
  });
  assert.deepEqual(marker, expected);
  assert.equal(requests.length, 3);
  assert.match(requests[0], /\/blog-release\.json\?verify=a{40}-1$/);

  const stuck = async url => {
    assert.match(String(url), /blog-release\.json\?verify=/);
    return json({ siteCommit: 'c'.repeat(40), contentCommit: expected.contentCommit });
  };
  await assert.rejects(() => waitForPublishedRelease({
    origin: 'https://yindongliang.com', expected, fetchImpl: stuck, attempts: 2, delayMs: 0, sleep: async () => {},
  }), /has not switched to this reviewed release/);
});

test('waitForPublishedRelease retries a 200 JSON body served as HTML until the JSON content type arrives', async () => {
  const expected = { siteCommit: 'a'.repeat(40), contentCommit: 'b'.repeat(40) };
  let generation = 0;
  const fetchImpl = async () => {
    generation += 1;
    if (generation < 3) {
      return new Response(JSON.stringify(expected), { status: 200, headers: { 'content-type': 'text/html' } });
    }
    return json(expected);
  };
  assert.deepEqual(await waitForPublishedRelease({
    origin: 'https://yindongliang.com', expected, fetchImpl, attempts: 4, delayMs: 0, sleep: async () => {},
  }), expected);
  assert.equal(generation, 3);
});
