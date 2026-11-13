import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { generateRouteRedirects, lowercaseRoute, STATIC_REDIRECT_LIMIT } from '../scripts/route-redirects.mjs';
import { routeRedirectResponse } from '../worker/route-redirects.mjs';
import { assertSitemapLocations } from '../scripts/verify-deployment.mjs';

const generate = (urls, aliases = []) => generateRouteRedirects(urls.map(url => ({ url })), aliases);
const hit = '/docs/Apple/SwiftUI/Method/allowsHitTesting/';
const grid = '/docs/Apple/SwiftUI/View/Grid/';

test('real canonical routes generate exact casing and Xcode redirects in both slash forms', () => {
  const { workerRules, staticRules } = generate([hit, grid, '/tags/SwiftUI/']);
  for (const from of ['/docs/apple/swiftui/method/allowshittesting/', '/docs/apple/swiftui/method/allowshittesting']) assert.equal(workerRules[from], hit);
  for (const from of ['/docs/Xcode/SwiftUI/View/Grid/', '/docs/Xcode/SwiftUI/View/Grid']) assert.equal(workerRules[from], grid);
  assert.equal(workerRules['/tags/swiftui'], '/tags/SwiftUI/');
  for (const url of [grid, '/docs/Apple/SwiftUI/Bindable/', '/docs/Xcode/SwiftUI/Bindable/', '/docs/Xcode/SwiftUI/onPreferenceChange/']) assert.ok(!Object.hasOwn(workerRules, url));
  assert.equal(staticRules.length, 0, 'Automatic rules use the Worker, leaving the static quota for aliases');
});

test('escaping preserves plus signs, Chinese, escaped separators and percent literals', () => {
  assert.equal(lowercaseRoute('/docs/C-C%2B%2B/%E7%B3%BB%E7%BB%9F/'), '/docs/c-c%2B%2B/%E7%B3%BB%E7%BB%9F/');
  const { workerRules } = generate(['/docs/C-C++/系统/', '/docs/Upper/%252B/', '/docs/Upper/A%2FB/']);
  assert.equal(workerRules['/docs/c-c%2B%2B/%E7%B3%BB%E7%BB%9F'], '/docs/C-C%2B%2B/%E7%B3%BB%E7%BB%9F/');
  // %25 remains escaped; the following literal B lowercases like other text.
  assert.equal(workerRules['/docs/upper/%252b/'], '/docs/Upper/%252B/');
  assert.equal(workerRules['/docs/upper/a%2Fb/'], '/docs/Upper/A%2FB/');
  assert.ok(!Object.hasOwn(workerRules, '/docs/upper/a/b/'));
});

test('canonical lowercase routes are protected and ambiguous destinations fail the build', () => {
  const { workerRules, skippedCanonical } = generate(['/docs/Foo/', '/docs/foo/']);
  assert.deepEqual(workerRules, {});
  assert.deepEqual(skippedCanonical, [{ from: '/docs/foo/', to: '/docs/Foo/' }]);
  assert.throws(() => generate(['/docs/FOO/', '/docs/Foo/']), /Ambiguous lowercase redirect/);
});

test('explicit aliases retain priority, deduplicate and point only to real routes', () => {
  const alias = '/docs/frontend/angular/';
  const target = '/docs/Frontend/Angular/angular/';
  const aliases = [[alias, target], [alias, target], ['/docs/Frontend/Angular/', target]];
  const { workerRules, staticRules, preservedAliases } = generate(['/docs/Frontend/Angular/', target], aliases);
  assert.equal(workerRules[alias], target);
  assert.equal(workerRules[alias.slice(0, -1)], target);
  assert.deepEqual(staticRules, [{ from: alias, to: target, status: 301 }]);
  assert.equal(preservedAliases.length, 2);
  assert.throws(() => generate([target], [[alias, '/missing/']]), /no canonical destination/);
  assert.throws(() => generate([target, '/other/'], [[alias, target], [alias, '/other/']]), /Conflicting aliases/);
});

test('Cloudflare static limits fail explicitly while large automatic maps need no truncation', () => {
  const aliases = Array.from({ length: STATIC_REDIRECT_LIMIT }, (_, i) => [`/old-${i}/`, '/']);
  assert.equal(generate(['/'], aliases).staticRules.length, STATIC_REDIRECT_LIMIT);
  assert.throws(() => generate(['/'], [...aliases, ['/one-too-many/', '/']]), /static redirect limit exceeded/);
  assert.throws(() => generate(['/'], [[`/${'x'.repeat(1000)}/`, '/']]), /line too long/);
  const result = generate(Array.from({ length: 1100 }, (_, i) => `/docs/Upper-${i}/`));
  assert.equal(Object.keys(result.workerRules).length, 2200);
  assert.equal(result.staticRules.length, 0);
});

test('Worker returns one 301 with canonical escaping and preserves queries for GET and HEAD', () => {
  const { workerRules } = generate([hit, '/docs/C-C++/系统/']);
  for (const method of ['GET', 'HEAD']) {
    const response = routeRedirectResponse(new Request('https://example.com/docs/apple/swiftui/method/allowshittesting?next=%2Ffoo%2B&x=1', { method }), workerRules);
    assert.equal(response.status, 301);
    assert.equal(response.headers.get('location'), `${hit}?next=%2Ffoo%2B&x=1`);
    assert.equal(response.body, null);
  }
  const response = routeRedirectResponse(new Request('https://example.com/docs/c-c++/系统'), workerRules);
  assert.equal(response.headers.get('location'), '/docs/C-C%2B%2B/%E7%B3%BB%E7%BB%9F/');
  assert.equal(routeRedirectResponse(new Request('https://example.com/docs/c-c%2b%2b/系统/'), workerRules).status, 301);
});

test('Worker leaves canonical, missing, malformed, inherited and non-read requests to assets', () => {
  const { workerRules } = generate([hit]);
  for (const url of [hit, '/docs/apple/missing/', '/docs/%invalid/', '/constructor', '/__proto__']) {
    assert.equal(routeRedirectResponse(new Request(`https://example.com${url}`), workerRules), null);
  }
  for (const method of ['POST', 'PUT', 'DELETE', 'OPTIONS']) {
    assert.equal(routeRedirectResponse(new Request('https://example.com/docs/apple/swiftui/method/allowshittesting', { method }), workerRules), null);
  }
});

test('Worker entry redirects before ASSETS, preserves API 404s and forwards other requests', async () => {
  // Evaluate the actual entry with a fixture map, without requiring a full site
  // build just to run unit tests. TypeScript is already a direct dev dependency.
  const source = await readFile(new URL('../worker/index.ts', import.meta.url), 'utf8');
  const { workerRules } = generate([hit, grid]);
  const entry = ts.transpileModule(source.replace(/^import .*;\n/gm, ''), { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
  const worker = Function('redirects', 'routeRedirectResponse', entry.replace('export default', 'return'))(workerRules, routeRedirectResponse);
  const calls = [];
  const assetResponse = new Response('asset', { status: 200 });
  const env = { ASSETS: { async fetch(request) { calls.push(request); return assetResponse; } } };
  const redirect = await worker.fetch(new Request('https://example.com/docs/apple/swiftui/method/allowshittesting'), env);
  assert.equal(redirect.status, 301);
  assert.equal(redirect.headers.get('location'), hit);
  const api = await worker.fetch(new Request('https://example.com/api/old'), env);
  assert.equal(api.status, 404);
  assert.equal(api.headers.get('cache-control'), 'no-store');
  assert.equal(calls.length, 0);
  for (const url of [grid, '/missing/', '/_astro/example.js']) {
    const request = new Request(`https://example.com${url}`);
    assert.equal(await worker.fetch(request, env), assetResponse);
    assert.equal(calls.at(-1), request);
  }
  const config = JSON.parse(await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
  assert.equal(config.assets.run_worker_first, true, 'Redirect lookup must precede asset HTML slash/encoding redirects');
});

test('sitemap may list only canonical targets, never a Worker redirect source', () => {
  const { workerRules } = generate([hit]);
  const redirects = Object.entries(workerRules).map(([from, to]) => ({ from, to, status: 301 }));
  const canonical = `https://yindongliang.com${hit}`;
  assertSitemapLocations([canonical], { canonicalOf: () => [canonical], redirects });
  const wrong = 'https://yindongliang.com/docs/apple/swiftui/method/allowshittesting/';
  assert.throws(() => assertSitemapLocations([wrong], { canonicalOf: () => [wrong], redirects }), /redirects source/);
});
