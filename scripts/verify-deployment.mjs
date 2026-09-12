import assert from 'node:assert/strict';
import { themeRelease } from './theme-package.mjs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const root = fileURLToPath(new URL('../', import.meta.url));
export const canonicalOrigin = 'https://yindongliang.com';
export function assertRecentUpdates(entries, routes) {
  assert.ok(Array.isArray(entries) && entries.length > 0 && entries.length <= 6, 'Recent updates must contain 1–6 public entries');
  const routeMap = new Map(routes.map(route => [route.url, route]));
  const seen = new Set();
  let previousDate = Infinity;
  for (const entry of entries) {
    assert.deepEqual(Object.keys(entry).sort(), ['section', 'title', 'updated', 'url'], 'Recent updates may expose only display metadata');
    assert.ok(typeof entry.title === 'string' && entry.title.trim(), 'Recent update title missing');
    assert.ok(['文档', '文章', '周刊'].includes(entry.section), 'Unexpected recent update section');
    const route = routeMap.get(entry.url);
    assert.ok(route?.kind === 'page' && ['docs', 'posts', 'weekly'].includes(route.type), `Recent update must target a generated article: ${entry.url}`);
    assert.ok(!seen.has(entry.url), 'Duplicate recent update');
    seen.add(entry.url);
    const date = Date.parse(entry.updated);
    assert.ok(Number.isFinite(date) && date <= previousDate, 'Recent updates must be sorted by valid update dates');
    previousDate = date;
  }
}
const modes = ['production', 'preview'];
const decodeHTML = value => value.replace(/&(?:amp|quot|apos|lt|gt|#\d+|#x[\da-f]+);/gi, entity => {
  if (entity.startsWith('&#')) return String.fromCodePoint(Number.parseInt(entity.slice(entity[2].toLowerCase() === 'x' ? 3 : 2, -1), entity[2].toLowerCase() === 'x' ? 16 : 10));
  return { '&amp;': '&', '&quot;': '"', '&apos;': "'", '&lt;': '<', '&gt;': '>' }[entity.toLowerCase()];
});
const attributes = tag => Object.fromEntries([...tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)].map(([, name, double, single, bare]) => [name.toLowerCase(), decodeHTML(double ?? single ?? bare)]));
const directives = value => String(value || '').toLowerCase().split(/[\s,;:]+/).filter(Boolean);

export function assertCanonical(html, route) {
  const links = [...html.matchAll(/<link\b[^>]*>/gi)].map(([tag]) => attributes(tag)).filter(tag => tag.rel?.split(/\s+/).includes('canonical'));
  assert.equal(links.length, 1, `Expected one canonical: ${route}`);
  assert.equal(links[0].href, new URL(route, canonicalOrigin).href, `Canonical mismatch: ${route}`);
}

export function assertHtmlIndexing(html, environment, label) {
  assert.ok(modes.includes(environment), `Unknown verification environment: ${environment}`);
  const robots = [...html.matchAll(/<meta\b[^>]*>/gi)].map(([tag]) => attributes(tag)).filter(tag => /^(robots|googlebot|bingbot)$/i.test(tag.name || ''));
  if (environment === 'production') {
    for (const tag of robots) assert.ok(!directives(tag.content).some(value => ['noindex', 'none'].includes(value)), `Production HTML blocks indexing: ${label}`);
  } else {
    assert.ok(robots.some(tag => tag.name.toLowerCase() === 'robots' && ['noindex', 'nofollow'].every(value => directives(tag.content).includes(value))), `Preview HTML permits indexing: ${label}`);
    assert.ok(!/googletagmanager\.com\/gtag\/js|pagead2\.googlesyndication\.com\/pagead\/js/.test(html), `Preview analytics/ads enabled: ${label}`);
  }
}

export function assertHeaderIndexing(value, environment, label) {
  const values = directives(value);
  if (environment === 'production') assert.ok(!values.some(value => ['noindex', 'none'].includes(value)), `Production header blocks indexing: ${label}`);
  else assert.ok(['noindex', 'nofollow'].every(value => values.includes(value)), `Preview X-Robots-Tag missing: ${label}`);
}

export function assertRobotsPolicy(text, environment) {
  const groups = [];
  let group;
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*([\w-]+)\s*:\s*(.*?)\s*$/.exec(line.split('#')[0]);
    if (!match) continue;
    const [, rawKey, value] = match, key = rawKey.toLowerCase();
    if (key === 'user-agent') {
      if (!group || group.rules.length) { group = { agents: [], rules: [] }; groups.push(group); }
      group.agents.push(value.toLowerCase());
    } else if (group && ['allow', 'disallow', 'noindex'].includes(key)) group.rules.push({ key, value });
  }
  const universal = groups.filter(group => group.agents.includes('*'));
  assert.ok(universal.length, 'robots.txt must define the public crawler policy');
  if (environment === 'production') {
    assert.ok(universal.some(group => group.rules.some(rule => rule.key === 'allow' && rule.value === '/')), 'Production robots.txt must allow the site');
    for (const group of groups.filter(group => group.agents.some(agent => ['*', 'googlebot', 'bingbot'].includes(agent)))) {
      assert.ok(!group.rules.some(rule => ['disallow', 'noindex'].includes(rule.key) && ['/', '/*'].includes(rule.value)), 'Production robots.txt blocks the site');
    }
    assert.match(text, /^Sitemap:\s*https:\/\/yindongliang\.com\/sitemap\.xml\s*$/im, 'Production robots.txt must advertise the canonical sitemap');
  } else assert.ok(universal.some(group => group.rules.some(rule => rule.key === 'disallow' && rule.value === '/')), 'Preview robots.txt must disallow the site');
}

export function assertXMLSiteURLs(xml, label) {
  const urls = [...xml.matchAll(/<(?:loc|link|guid)\b[^>]*>([^<]+)<\/(?:loc|link|guid)>/g)].map(([, value]) => decodeHTML(value.trim())).filter(value => /^https?:/.test(value));
  for (const [tag] of xml.matchAll(/<atom:link\b[^>]*>/g)) { const { href } = attributes(tag); if (href) urls.push(href); }
  assert.ok(urls.length > 0, `Missing canonical URLs: ${label}`);
  for (const url of urls) assert.equal(new URL(url).origin, canonicalOrigin, `Non-production URL in ${label}: ${url}`);
}

export function parseRedirects(text) {
  return text.split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith('#')).map(line => {
    const [from, to, status, extra] = line.split(/\s+/);
    assert.ok(from?.startsWith('/') && to?.startsWith('/') && [301, 308].includes(Number(status)) && !extra, `Unexpected redirect rule: ${line}`);
    return { from, to, status: Number(status) };
  });
}

export function assetReferences(html, route = '/') {
  const assets = new Set();
  for (const [tag] of html.matchAll(/<(?:script|link|img|astro-island)\b[^>]*>/gi)) {
    const attrs = attributes(tag);
    const candidates = /^<link\b/i.test(tag)
      ? /(?:^|\s)(?:stylesheet|modulepreload|icon|apple-touch-icon)(?:\s|$)/.test(attrs.rel || '') ? [attrs.href] : []
      : [attrs.src, attrs['component-url'], attrs['renderer-url'], attrs['before-hydration-url']];
    for (const value of candidates.filter(Boolean)) {
      const url = new URL(value, new URL(route, canonicalOrigin));
      if (url.origin === canonicalOrigin) assets.add(url.pathname);
    }
  }
  return [...assets];
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
export const publishedRetry = { attempts: 8, delayMs: 1000 };

export function hashedAstroAssets(paths) {
  return [...new Set(paths.filter(asset => asset.startsWith('/_astro/')))];
}

export function publishedAssetPaths({ publishedHtml, localHtml, route }) {
  const published = assetReferences(publishedHtml, route);
  if (localHtml == null) return published;
  const localHashed = new Set(hashedAstroAssets(assetReferences(localHtml, route)));
  const assets = [];
  const seen = new Set();
  for (const asset of published) {
    if (asset.startsWith('/_astro/') && !localHashed.has(asset)) continue;
    seen.add(asset);
    assets.push(asset);
  }
  for (const asset of localHashed) {
    if (seen.has(asset)) continue;
    seen.add(asset);
    assets.push(asset);
  }
  return assets;
}

export async function retryUntil(run, { attempts = publishedRetry.attempts, delayMs = publishedRetry.delayMs, sleep: wait = sleep, onRetry } = {}) {
  assert.ok(Number.isInteger(attempts) && attempts > 0 && Number.isInteger(delayMs) && delayMs >= 0, 'Retry budget must be a positive attempt count and non-negative delay');
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try { return await run(attempt); } catch (error) {
      lastError = error;
      if (attempt === attempts) throw error;
      onRetry?.(attempt, error);
      await wait(delayMs);
    }
  }
  throw lastError;
}

export async function waitForPublishedRelease({ origin, expected, fetchImpl = fetch, timeout = 30_000, attempts = publishedRetry.attempts, delayMs = publishedRetry.delayMs, sleep: wait = sleep, onRetry } = {}) {
  assert.match(expected?.siteCommit || '', /^[a-f0-9]{40}$/, 'Local release marker missing siteCommit');
  assert.match(expected?.contentCommit || '', /^[a-f0-9]{40}$/, 'Local release marker missing contentCommit');
  return retryUntil(async attempt => {
    const url = new URL('/blog-release.json', origin);
    url.searchParams.set('verify', `${expected.siteCommit}-${attempt}`);
    const response = await fetchImpl(url, {
      redirect: 'manual', cache: 'no-store', signal: AbortSignal.timeout(timeout),
      headers: { 'cache-control': 'no-cache' },
    });
    assert.equal(response.status, 200, 'Production release marker status');
    const marker = await response.json();
    assert.equal(marker.siteCommit, expected.siteCommit, 'Production has not switched to this reviewed release');
    assert.equal(marker.contentCommit, expected.contentCommit, 'Production content revision does not match this release');
    return marker;
  }, { attempts, delayMs, sleep: wait, onRetry });
}

export function assertComments(html, expected, route) {
  assert.ok(!/<script\b[^>]*src=["']https:\/\/giscus\.app\/client\.js/i.test(html), `Giscus must not be loaded: ${route}`);
  const markers = [...html.matchAll(/<section\b[^>]*\bdata-convex-comments(?=[\s=>])[^>]*>/gi)];
  assert.equal(markers.length, expected ? 1 : 0, `Convex comment eligibility: ${route}`);
  if (expected) {
    const attrs = attributes(markers[0][0]);
    assert.equal(attrs['data-comment-pathname'], route, `Comments must use the canonical pathname: ${route}`);
    assert.match(markers[0][0], /\bdata-pagefind-ignore(?=[\s=>])/, `Comments must stay out of article search: ${route}`);
    assert.match(markers[0][0], /\bdata-sentry-mask(?=[\s=>])/, `Comment content must be masked in monitoring: ${route}`);
    const footer = /<footer\b[^>]*class="[^"]*\bbook-footer\b[^"]*"[^>]*>([\s\S]*?)<\/footer>/.exec(html)?.[1];
    assert.ok(footer?.includes(markers[0][0]), `Comments must follow navigation inside the Book footer: ${route}`);
    assert.ok(footer.lastIndexOf('</a>') < footer.indexOf(markers[0][0]), `Footer navigation must precede comments: ${route}`);
  }
}

async function main() {
  const { values } = parseArgs({ options: {
    env: { type: 'string' }, origin: { type: 'string' }, report: { type: 'string' },
    'all-routes': { type: 'boolean', default: false }, 'timeout-ms': { type: 'string', default: '30000' }, help: { type: 'boolean' },
  } });
  if (values.help) {
    console.log('Usage: node scripts/verify-deployment.mjs --env production|preview [--origin http(s)://host] [--all-routes] [--timeout-ms 30000] [--report path]\nPUBLIC_SITE_ENV and VERIFY_ORIGIN may supply --env and --origin. Production defaults to https://yindongliang.com; preview defaults to http://127.0.0.1:4321. Run after building the same revision. Production waits for /blog-release.json, checks hashed /_astro files this release actually emitted, and retries brief CDN 404s. Loopback preview skips Cloudflare response-header, HTTP-redirect and immutable-cache checks; production checks remain strict.');
    return;
  }
  const environment = values.env || process.env.PUBLIC_SITE_ENV;
  assert.ok(modes.includes(environment), 'Specify --env production|preview or PUBLIC_SITE_ENV explicitly');
  const originURL = new URL(values.origin || process.env.VERIFY_ORIGIN || (environment === 'production' ? canonicalOrigin : 'http://127.0.0.1:4321'));
  assert.ok(['https:', 'http:'].includes(originURL.protocol) && !originURL.username && !originURL.password && originURL.pathname === '/' && !originURL.search && !originURL.hash, '--origin must be an HTTP(S) origin without credentials or a path');
  const origin = originURL.origin;
  const localPreview = environment === 'preview' && ['127.0.0.1', 'localhost', '[::1]'].includes(originURL.hostname);
  if (localPreview) console.log('Local preview: Cloudflare response headers, HTTP redirects and immutable caching require the post-deployment check.');
  const timeout = Number(values['timeout-ms']);
  assert.ok(Number.isInteger(timeout) && timeout > 0 && timeout <= 120000, '--timeout-ms must be between 1 and 120000');
  const generated = path.join(root, '.generated');
  const [content, routes, source, redirectText] = await Promise.all([
    readFile(path.join(generated, 'content.json'), 'utf8').then(JSON.parse),
    readFile(path.join(generated, 'routes.json'), 'utf8').then(JSON.parse),
    themeRelease(root),
    readFile(path.join(root, 'dist/_redirects'), 'utf8'),
  ]);
  const routeMap = new Map(routes.map(route => [route.url, route]));
  const selected = new Set(['/', '/archives/', '/modified/', '/posts/', '/weekly/', '/timeline/', '/portfolio/', '/links/', '/tags/', '/categories/', '/about/', '/docs/', '/labs/', '/labs/agent-replay/', '/demos/2026/rounded-timeline/']);
  const expectedRecent = JSON.parse(await readFile(path.join(root, 'dist/search/recent.json'), 'utf8'));
  assertRecentUpdates(expectedRecent, routes);
  for (const entry of expectedRecent) selected.add(entry.url);
  const regular = content.pages.filter(page => page.kind === 'page');
  for (const feature of ['data-blog-code-language=', 'class="katex"', 'class="mermaid"']) {
    const page = regular.find(page => page.type === 'docs' && page.html.includes(feature));
    assert.ok(page, `Missing representative article for ${feature}`); selected.add(page.url);
  }
  for (const type of ['posts', 'weekly']) { const page = regular.find(page => page.type === type); assert.ok(page, `Missing ${type} article`); selected.add(page.url); }
  const terms = [content.tags[0], content.categories[0]];
  for (const term of terms) { assert.ok(term, 'Taxonomies must not be empty'); selected.add(term.url); }
  const section = content.pages.find(page => page.kind === 'section' && page.section === 'docs' && page.url !== '/docs/');
  assert.ok(section, 'Missing docs section'); selected.add(section.url);
  if (values['all-routes']) for (const route of routes) selected.add(route.url);
  const dist = path.join(root, 'dist');
  let releaseToken = 'verify';
  if (!localPreview && environment === 'production') {
    const expected = JSON.parse(await readFile(path.join(dist, 'blog-release.json'), 'utf8'));
    await waitForPublishedRelease({
      origin, expected, timeout,
      onRetry: attempt => { if (attempt === 1) console.log('Waiting for production to switch to this release'); },
    });
    releaseToken = expected.siteCommit;
  }
  const checks = [], results = new Map(), pending = new Map(), localPages = new Map();
  async function request(route, { attempt = 0, bust = false } = {}) {
    const key = bust ? `${route}#${attempt}` : route;
    if (!pending.has(key)) pending.set(key, (async () => {
      const url = new URL(route, origin);
      if (bust) url.searchParams.set('verify', `${releaseToken}-${attempt}`);
      const response = await fetch(url, {
        redirect: 'manual', cache: 'no-store', signal: AbortSignal.timeout(timeout),
        headers: bust ? { 'cache-control': 'no-cache' } : undefined,
      });
      const bytes = new Uint8Array(await response.arrayBuffer());
      assert.ok(bytes.length <= 25 * 1024 * 1024, `Response exceeds static hosting limit: ${route}`);
      const result = { route, status: response.status, headers: response.headers, body: new TextDecoder().decode(bytes), bytes: bytes.length };
      results.set(route, result); checks.push({ route, status: result.status, bytes: result.bytes });
      return result;
    })());
    return pending.get(key);
  }
  function published(route, attempt = 1) {
    return localPreview ? request(route) : request(route, { attempt, bust: true });
  }
  async function ready(route, check) {
    return retryUntil(async attempt => check(await published(route, attempt)), {
      attempts: localPreview ? 1 : publishedRetry.attempts,
      onRetry: (attempt, error) => { if (attempt === 1) console.log(`Waiting for the published revision (${route}: ${error.message.split('\n')[0]})`); },
    });
  }
  async function batches(items, check, label) {
    for (let index = 0; index < items.length; index += 4) {
      await Promise.all(items.slice(index, index + 4).map(check));
      console.log(`${label}: ${Math.min(index + 4, items.length)}/${items.length}`);
    }
  }
  await ready('/search/recent.json', response => {
    assert.equal(response.status, 200, 'Recent updates endpoint status');
    assert.match(response.headers.get('content-type') || '', /application\/json/i, 'Recent updates must return JSON');
    assert.deepEqual(JSON.parse(response.body), expectedRecent, 'Recent updates must match this release');
    if (!localPreview) assert.match(response.headers.get('cache-control') || '', /\bno-cache\b/i, 'Recent updates must revalidate between releases');
    return response;
  });
  await batches([...selected], async route => {
    localPages.set(route, await readFile(path.join(dist, decodeURIComponent(route), 'index.html'), 'utf8'));
    const response = await ready(route, response => {
      assert.equal(response.status, 200, `Page status: ${route}`);
      return response;
    });
    assert.match(response.headers.get('content-type') || '', /text\/html/i, `HTML content type: ${route}`);
    assertCanonical(response.body, route); assertHtmlIndexing(response.body, environment, route);
    if (!localPreview) assertHeaderIndexing(response.headers.get('x-robots-tag'), environment, route);
    const record = routeMap.get(route);
    assertComments(response.body, record?.kind === 'page' && ['docs', 'posts', 'about', 'weekly', 'links'].includes(record.type), route);
    const page = content.pages.find(page => page.id === record?.id);
    for (const feature of ['data-blog-code-language=', 'class="katex"', 'class="mermaid"']) if (page?.html.includes(feature)) assert.ok(response.body.includes(feature), `Rendered feature missing (${feature}): ${route}`);
  }, 'Pages');
  const lab = results.get('/labs/').body;
  for (const marker of ['astro-island', 'AgentReplay', 'SvelteCounter', 'data-blog-code-language=', 'data-book-code-disabled']) assert.ok(lab.includes(marker), `Lab renderer missing: ${marker}`);
  const demo = results.get('/demos/2026/rounded-timeline/').body;
  assert.ok(demo.includes('data-astro-demo="/demos/2026/rounded-timeline/"'), 'Timeline demo must be generated by Astro');
  for (const title of ['确认范围', '完成设计', '实现功能', '验收验证']) assert.ok(demo.includes(title), `Timeline card missing from static HTML: ${title}`);
  assert.match(results.get('/archives/').body, /data-blog-archive-toc/);
  const feeds = new Set(['/index.xml', '/posts/index.xml', '/weekly/index.xml', '/links/index.xml', ...terms.map(term => `${term.url}index.xml`)]);
  if (values['all-routes']) for (const term of [...content.tags, ...content.categories]) feeds.add(`${term.url}index.xml`);
  await batches([...feeds, '/sitemap.xml'], async route => {
    const response = await ready(route, response => { assert.equal(response.status, 200, `Feed/sitemap status: ${route}`); return response; });
    assert.match(response.headers.get('content-type') || '', /(?:xml|rss)/i, `XML content type: ${route}`);
    assert.match(response.body, route === '/sitemap.xml' ? /<urlset\b/ : /<rss\b/, `XML document missing: ${route}`);
    assertXMLSiteURLs(response.body, route);
  }, 'Feeds and sitemap');
  const robots = await ready('/robots.txt', response => { assert.equal(response.status, 200, 'robots.txt status'); return response; }); assertRobotsPolicy(robots.body, environment);
  for (const route of ['/chat/', '/me/', '/demos/2026/cloudflare-product-map/', '/__astro-deployment-verification-missing__/']) {
    const response = await ready(route, response => { assert.equal(response.status, 404, `Must return a real HTTP 404: ${route}`); return response; });
    assert.match(response.body, /页面未找到/, `Custom 404 missing: ${route}`); assertComments(response.body, false, route);
    if (environment === 'preview') { assertHtmlIndexing(response.body, environment, route); if (!localPreview) assertHeaderIndexing(response.headers.get('x-robots-tag'), environment, route); }
  }
  const redirects = parseRedirects(redirectText);
  assert.ok(redirects.some(rule => rule.from === '/page/1/' && rule.to === '/'), 'Pagination redirect missing');
  for (const from of ['/chat/', '/me/']) assert.ok(!redirects.some(rule => rule.from === from), `Unpublished account URL does not need a redirect: ${from}`);
  const checkedRedirects = localPreview ? [] : redirects;
  await batches(checkedRedirects, async ({ from, to, status }) => {
    const response = await request(from); assert.equal(response.status, status, `Redirect status: ${from}`);
    assert.ok(response.headers.get('location'), `Redirect Location missing: ${from}`);
    assert.equal(new URL(response.headers.get('location'), origin).href, new URL(to, origin).href, `Redirect target: ${from}`);
    const destination = await request(to); assert.equal(destination.status, 200, `Redirect destination missing: ${to}`);
    assertCanonical(destination.body, to); assertHtmlIndexing(destination.body, environment, to); assertHeaderIndexing(destination.headers.get('x-robots-tag'), environment, to);
  }, 'Legacy redirects');
  for (const route of localPreview ? [] : ['/labs', '/archives', '/demos/2026/rounded-timeline']) {
    const response = await request(route); assert.equal(response.status, 307, `Trailing-slash redirect: ${route}`);
    assert.ok(response.headers.get('location'), `Trailing-slash Location missing: ${route}`);
    assert.equal(new URL(response.headers.get('location'), origin).href, `${origin}${route}/`, `Trailing-slash target: ${route}`);
  }
  const assets = new Set(['/pagefind/pagefind.js', '/pagefind/pagefind-worker.js', '/pagefind/pagefind-entry.json', '/logo.gif', '/book-icons/menu.svg', '/favicon.ico', '/apple-touch-icon.png', '/icons/menu.svg', '/katex/katex.min.css']);
  for (const route of selected) {
    for (const asset of publishedAssetPaths({ publishedHtml: results.get(route).body, localHtml: localPages.get(route), route })) assets.add(asset);
  }
  const entry = await ready('/pagefind/pagefind-entry.json', response => { assert.equal(response.status, 200, 'Pagefind entry status'); return response; });
  const index = JSON.parse(entry.body);
  assert.ok(Object.keys(index.languages || {}).length > 0, 'Pagefind languages missing');
  for (const language of Object.values(index.languages)) {
    assert.ok(language.page_count > 0 && language.hash, 'Pagefind index must contain pages');
    assets.add(`/pagefind/pagefind.${language.hash}.pf_meta`);
    assets.add(`/pagefind/wasm.${language.wasm || 'unknown'}.pagefind`);
  }
  for (const directory of ['index', 'fragment']) {
    const files = await readdir(path.join(root, 'dist/pagefind', directory));
    const sample = files.sort().find(file => file.endsWith(`.pf_${directory}`));
    assert.ok(sample, `Missing Pagefind ${directory} sample`); assets.add(`/pagefind/${directory}/${sample}`);
  }
  await batches([...assets], async route => {
    const response = await retryUntil(async attempt => {
      const response = await (localPreview ? request(route) : request(route, { attempt, bust: true }));
      assert.equal(response.status, 200, `Asset status: ${route}`);
      assert.ok(response.bytes > 0 && !/text\/html/i.test(response.headers.get('content-type') || ''), `Asset returned HTML or an empty body: ${route}`);
      if (/\.css$/.test(route)) assert.match(response.headers.get('content-type') || '', /text\/css/i, `CSS content type: ${route}`);
      if (/\.m?js$/.test(route)) assert.match(response.headers.get('content-type') || '', /(?:java|ecma)script/i, `JavaScript content type: ${route}`);
      if (!localPreview && route.startsWith('/_astro/')) assert.match(response.headers.get('cache-control') || '', /immutable/i, `Hashed asset cache policy: ${route}`);
      return response;
    }, {
      attempts: localPreview ? 1 : publishedRetry.attempts,
      onRetry: (attempt, error) => { if (attempt === 1) console.log(`Waiting for published assets (${route}: ${error.message.split('\n')[0]})`); },
    });
  }, 'Static assets and search');
  const report = path.resolve(root, values.report || `.generated/deployment-verification-${environment}.json`);
  await mkdir(path.dirname(report), { recursive: true });
  await writeFile(report, JSON.stringify({ environment, origin, hostingChecks: !localPreview, expectedTheme: source, checkedAt: new Date().toISOString(), exhaustiveRoutes: values['all-routes'], checks }, null, 2));
  console.log(`Verified ${environment} at ${origin}: ${selected.size} pages, ${checkedRedirects.length} legacy HTTP redirects, ${assets.size} assets, feeds/search/Convex comments/indexing and actual 404 responses. Report: ${report}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(`Deployment verification failed: ${error.message}`); process.exitCode = 1; });
}
