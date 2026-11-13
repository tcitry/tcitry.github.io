import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalLink, canonicalizeHtmlLinks, publicHtmlRoutes } from '../scripts/canonical-links.mjs';
import { generateRouteRedirects } from '../scripts/route-redirects.mjs';
import { auditContentLinks } from '../scripts/internal-links.mjs';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';

const urls = ['/docs/Apple/Grid/', '/docs/C-C%2B%2B/', '/docs/%E4%B8%AD/', '/docs/%252B/', '/docs/%2F/', '/current/'];
const routes = new Set(urls);
const { workerRules } = generateRouteRedirects(urls.map(url => ({ url })), [['/old/', '/current/']]);

test('canonical links resolve exact aliases, casing, legacy prefix, slash and encoding while preserving query / fragment', () => {
  for (const href of ['/docs/apple/grid', '/docs/Xcode/Grid/', '../apple/grid', 'http://www.yindongliang.com/docs/apple/grid']) assert.equal(canonicalLink(href + '?a=1&b=2#Heading', '/docs/source/', routes, workerRules), '/docs/Apple/Grid/?a=1&b=2#Heading');
  assert.equal(canonicalLink('/old/#keep%252B', '/', routes, workerRules), '/current/#keep%252B');
  assert.equal(canonicalLink('/docs/c-c%2b%2b', '/', routes, workerRules), '/docs/C-C%2B%2B/');
  assert.equal(canonicalLink('/docs/中/', '/', routes, workerRules), null, 'URL parser already spells raw Unicode as canonical percent encoding');
  assert.equal(canonicalLink('/docs/%252B/', '/', routes, workerRules), null);
  assert.equal(canonicalLink('#heading', '/docs/C-C%2B%2B/', routes, workerRules), null, 'Same-page anchors use the public encoded base');
  assert.equal(canonicalLink('/docs/%2f', '/', routes, workerRules), '/docs/%2F/');
  for (const href of ['#Heading', '?q=1', 'mailto:x@example.com', 'https://external.test/old/', '/missing/', '/%ZZ', '/logo.gif']) assert.equal(canonicalLink(href, '/current/', routes, workerRules), null);
});

test('HTML patch changes only real anchor href attributes, keeping code, scripts, templates and surrounding bytes', () => {
  const html = '<!doctype html><html><body><nav><a class="keep" href=\'/old/?x=1&amp;y=2#h\'>Text</a></nav><pre><a href="/old/">code</a></pre><script>const s="/old/"</script><template><a href="/old/">inert</a></template></body></html>';
  const result = canonicalizeHtmlLinks(html, '/', routes, workerRules);
  assert.equal(result.changed, 1);
  assert.equal(result.html, html.replace("href='/old/?x=1&amp;y=2#h'", 'href="/current/?x=1&amp;y=2#h"'));
  assert.equal(canonicalizeHtmlLinks(result.html, '/', routes, workerRules).changed, 0);
});

test('strict audit catches redirecting navigation/body links and missing fragments after canonicalization', async t => {
  const output = await mkdtemp(path.join(tmpdir(), 'canonical-links-'));
  t.after(() => rm(output, { recursive: true, force: true }));
  await mkdir(path.join(output, 'current'), { recursive: true });
  await writeFile(path.join(output, 'current/index.html'), '<h2 id="ok">Heading</h2>');
  const redirects = Object.entries(workerRules).map(([from, to]) => ({ from, to }));
  const html = '<nav><a href="/old/#ok">old</a></nav><a href="/current#ok">slash</a><a href="/current/#missing">broken</a>';
  const run = html => auditContentLinks({ output, pages: [{ url: '/current/', html }], redirects, canonicalRoutes: urls.map(url => ({ url })) });
  assert.equal((await run(html)).errors.length, 3);
  const fixed = canonicalizeHtmlLinks(html, '/current/', routes, workerRules).html;
  assert.deepEqual((await run(fixed)).errors.map(error => error.reason), ['missing fragment: /current/#missing']);
});

test('real build inventory includes site-owned demos and encoding but excludes alias HTML and noncanonical files', async t => {
  const output = await mkdtemp(path.join(tmpdir(), 'public-routes-'));
  t.after(() => rm(output, { recursive: true, force: true }));
  for (const [directory, canonical] of [['', '/'], ['docs/C-C++', '/docs/C-C%2B%2B/'], ['demos/new', '/demos/new/'], ['old', '/docs/C-C%2B%2B/'], ['missing-canonical', null]]) {
    await mkdir(path.join(output, directory), { recursive: true });
    await writeFile(path.join(output, directory, 'index.html'), `<html><head>${canonical ? `<link href="https://yindongliang.com${canonical}" rel="canonical">` : ''}</head><body></body></html>`);
  }
  assert.deepEqual((await publicHtmlRoutes(output)).map(route => route.url).sort(), ['/', '/demos/new/', '/docs/C-C%2B%2B/']);
});

test('audit cache cannot hide an unencoded href after checking a fragment on the encoded canonical page', async t => {
  const output = await mkdtemp(path.join(tmpdir(), 'canonical-cache-'));
  t.after(() => rm(output, { recursive: true, force: true }));
  await mkdir(path.join(output, 'docs/C-C++'), { recursive: true });
  await writeFile(path.join(output, 'docs/C-C++/index.html'), '<h2 id="part">Part</h2><a href="#part">same page</a>');
  await writeFile(path.join(output, 'index.html'), '<a href="/docs/C-C++/#part">unencoded page</a>');
  const pages = [{ url: '/docs/C-C++/', html: '<a href="#part">same page</a>' }, { url: '/', html: '<a href="/docs/C-C++/#part">unencoded page</a>' }];
  const result = await auditContentLinks({ pages, output, canonicalRoutes: pages });
  assert.equal(result.checkedLinks, 2);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0].reason, /noncanonical page link/);
});
