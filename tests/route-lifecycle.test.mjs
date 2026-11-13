import test from 'node:test';
import assert from 'node:assert/strict';
import { routeLifecycle, publishedRouteHistory, validateHistory, assertPublishedHistoryRetained } from '../scripts/route-lifecycle.mjs';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { generateRouteRedirects } from '../scripts/route-redirects.mjs';
import { routeRetirementResponse } from '../worker/route-redirects.mjs';

const routes = ['/docs/Current/', '/'].map(url => ({ url }));
const history = (...paths) => ({ version: 1, paths });
const policy = (redirects = {}, retired = {}) => ({ version: 1, redirects, retired });
const move = to => ({ to, reason: 'Reviewed content migration' });

test('published URL loss blocks a build, including URLs introduced after the original migration', () => {
  const first = routeLifecycle(routes, [], policy(), history('/')).history;
  const second = routeLifecycle([...routes, { url: '/new/' }], [], policy(), first).history;
  assert.throws(() => routeLifecycle(routes, [], policy(), second), /Previously published URLs disappeared/);
  assert.ok(second.paths.includes('/new/'));
});

test('historical aliases and migrations remain protected and chains flatten directly to real canonical pages', () => {
  const initial = history('/first/', '/second/');
  const rules = policy({ '/first/': move('/second/'), '/second/': move('/docs/Current/') });
  const result = routeLifecycle(routes, [['/old-alias/', '/first/']], rules, initial);
  assert.deepEqual(result.aliases, [['/old-alias/', '/docs/Current/']]);
  const redirects = generateRouteRedirects(routes, result.aliases, result.migrations);
  for (const from of ['/first/', '/first', '/second/', '/second', '/old-alias/']) assert.equal(redirects.workerRules[from], '/docs/Current/');
  assert.equal(redirects.staticRules.length, 1, 'Only original aliases use static redirect capacity');
  assert.throws(() => routeLifecycle(routes, [], policy(), result.history), /Previously published URLs disappeared/);
});

test('cycles, missing targets, conflicting aliases, canonical shadowing and unexplained policy fail', () => {
  for (const [rules, aliases, message] of [
    [policy({ '/a/': move('/b/'), '/b/': move('/a/') }), [], /cycle/],
    [policy({ '/a/': move('/missing/') }), [], /no canonical destination/],
    [policy({ '/a/': move('/docs/Current/') }), [['/a/', '/']], /Conflicting URL migration/],
    [policy({ '/docs/Current/': move('/') }), [], /shadows a canonical/],
    [policy({ '/a/': { to: '/' } }), [], /needs a reason/],
    [policy({}, { '/': { status: 410, reason: 'retire' } }), [], /still published/],
    [policy({}, { '/old/': { status: 301, reason: 'retire' } }), [], /404\/410/],
    [policy({}, { '/old': { status: 404, reason: 'retire' }, '/old/': { status: 410, reason: 'retire' } }), [], /Conflicting retirement/],
    [policy({}, { '/api/chat': { status: 410, reason: 'retire' } }), [], /API paths/],
  ]) assert.throws(() => routeLifecycle(routes, aliases, rules, history('/')), message);
});

test('retirement cannot silently lose to an automatic lowercase or Xcode redirect', () => {
  const result = routeLifecycle(routes, [], policy({}, { '/docs/current/': { status: 410, reason: 'retire' } }), history('/'));
  assert.throws(() => generateRouteRedirects(routes, result.aliases, result.migrations, result.retired), /Retired URL would redirect/);
});

test('explicit retirement preserves history, serves 404/410 in both slash forms, and never redirects', async () => {
  const result = routeLifecycle(routes, [], policy({}, { '/deleted/': { status: 410, reason: 'Confirmed permanently removed' }, '/removed': { status: 404, reason: 'Removed without a replacement' } }), history('/deleted/', '/removed/'));
  for (const [from, status] of Object.entries(result.retired)) {
    const response = routeRetirementResponse(new Request(`https://example.com${from}`), result.retired);
    assert.equal(response.status, status); assert.equal(response.headers.get('location'), null);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(await routeRetirementResponse(new Request(`https://example.com${from}`, { method: 'HEAD' }), result.retired).text(), '');
  }
  assert.equal(routeRetirementResponse(new Request('https://example.com/deleted/', { method: 'POST' }), result.retired), null);
  assert.equal(routeRetirementResponse(new Request('https://example.com/%ZZ'), result.retired), null);
  assert.equal(routeRetirementResponse(new Request('https://example.com/toString'), result.retired), null);
});

test('history uses encoded public URLs only and preserves escaped slash / double encoding', () => {
  assert.deepEqual(validateHistory(history('/docs/C-C%2B%2B/', '/%E4%B8%AD/', '/%252B/', '/%2F/')).paths.length, 4);
  for (const url of ['//evil.test/', 'https://evil.test/', '/bad/?q=1', '/bad/#x', '/中文/', '/%2f/', '/%ZZ']) assert.throws(() => validateHistory(history(url)));
  assert.throws(() => validateHistory(history()), /must not be empty/);
});

function remote(files) {
  return async (url, options) => {
    assert.equal(new URL(url).origin, 'https://yindongliang.com');
    assert.equal(options.redirect, 'error'); assert.equal(options.cache, 'no-store');
    const filename = new URL(url).pathname;
    const value = typeof files[filename] === 'function' ? files[filename]() : files[filename];
    return value instanceof Response ? value : value === undefined ? new Response('', { status: 404 }) : new Response(typeof value === 'string' ? value : JSON.stringify(value));
  };
}

test('published manifest is authoritative; first rollout bootstraps only from a valid same-site sitemap', async () => {
  const marker = { version: 1, siteCommit: 'fixture', routeHistoryVersion: 1 };
  assert.deepEqual(await publishedRouteHistory(remote({ '/blog-release.json': marker, '/route-history.json': history('/', '/old/') })), history('/', '/old/'));
  assert.deepEqual(await publishedRouteHistory(remote({ '/blog-release.json': { version: 1 }, '/sitemap.xml': '<urlset><url><loc>https://yindongliang.com/docs/A/</loc></url></urlset>' })), history('/docs/A/'));
  await assert.rejects(publishedRouteHistory(remote({ '/blog-release.json': marker })), /refusing to reset history/);
  await assert.rejects(publishedRouteHistory(remote({ '/blog-release.json': { version: 1 }, '/sitemap.xml': '<loc>https://evil.test/</loc>' })), /off-site/);
  await assert.rejects(publishedRouteHistory(remote({ '/blog-release.json': { version: 1 }, '/route-history.json': new Response('unavailable', { status: 503 }) })), /Cannot read published/);
  await assert.rejects(publishedRouteHistory(remote({ '/blog-release.json': marker, '/route-history.json': '{}' })), /Unsupported/);
  await assert.rejects(publishedRouteHistory(remote({ '/blog-release.json': { ...marker, routeHistoryVersion: 2 } })), /Unsupported published history marker/);
});

test('publication racing a baseline read fails instead of combining different releases', async () => {
  let reads = 0;
  await assert.rejects(publishedRouteHistory(remote({ '/blog-release.json': () => ({ version: 1, siteCommit: String(reads++) }), '/route-history.json': history('/') })), /Published release changed/);
  await assert.rejects(publishedRouteHistory(async () => { throw new Error('network unavailable'); }), /network unavailable/);
});

test('deployment refuses a sealed history older than a newly published content-only release', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'route-history-deploy-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'dist'));
  await writeFile(path.join(root, 'dist/route-history.json'), JSON.stringify(history('/')));
  const fetcher = remote({ '/blog-release.json': { version: 1, routeHistoryVersion: 1 }, '/route-history.json': history('/', '/new/') });
  await assert.rejects(assertPublishedHistoryRetained(root, { 'route-history.json': 'hash' }, fetcher), /New URLs were published/);
  await writeFile(path.join(root, 'dist/route-history.json'), JSON.stringify(history('/', '/new/')));
  await assertPublishedHistoryRetained(root, { 'route-history.json': 'hash' }, fetcher);
  await assertPublishedHistoryRetained(root, {}, async () => { throw new Error('Legacy fixture must not fetch'); });
});
