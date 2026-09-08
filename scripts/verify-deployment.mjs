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
      ? /(?:^|\s)(?:stylesheet|modulepreload|icon)(?:\s|$)/.test(attrs.rel || '') ? [attrs.href] : []
      : [attrs.src, attrs['component-url'], attrs['renderer-url'], attrs['before-hydration-url']];
    for (const value of candidates.filter(Boolean)) {
      const url = new URL(value, new URL(route, canonicalOrigin));
      if (url.origin === canonicalOrigin) assets.add(url.pathname);
    }
  }
  return [...assets];
}

export function assertGiscus(html, expected, route) {
  const scripts = [...html.matchAll(/<script\b[^>]*>/gi)].map(([tag]) => attributes(tag)).filter(tag => tag.src === 'https://giscus.app/client.js');
  assert.equal(scripts.length, expected ? 1 : 0, `Giscus eligibility: ${route}`);
  if (expected) {
    assert.equal(scripts[0]['data-mapping'], 'pathname', `Giscus mapping: ${route}`);
    assert.equal(scripts[0]['data-repo'], 'tcitry/tcitry.github.io', `Giscus repository: ${route}`);
    assert.match(html, /<footer\b[^>]*class="[^"]*\bbook-footer\b[^"]*"[^>]*>(?:(?!<\/footer>)[\s\S])*src="https:\/\/giscus\.app\/client\.js"/, `Giscus must follow navigation inside the Book footer: ${route}`);
    const footer = /<footer\b[^>]*class="[^"]*\bbook-footer\b[^"]*"[^>]*>([\s\S]*?)<\/footer>/.exec(html)[1];
    assert.ok(footer.lastIndexOf('</a>') < footer.indexOf('src="https://giscus.app/client.js"'), `Footer navigation must precede Giscus: ${route}`);
  }
}

async function main() {
  const { values } = parseArgs({ options: {
    env: { type: 'string' }, origin: { type: 'string' }, report: { type: 'string' },
    'all-routes': { type: 'boolean', default: false }, 'timeout-ms': { type: 'string', default: '30000' }, help: { type: 'boolean' },
  } });
  if (values.help) {
    console.log('Usage: node scripts/verify-deployment.mjs --env production|preview [--origin http(s)://host] [--all-routes] [--timeout-ms 30000] [--report path]\nPUBLIC_SITE_ENV and VERIFY_ORIGIN may supply --env and --origin. Production defaults to https://yindongliang.com; preview defaults to http://127.0.0.1:4321. Run after building the same revision. Loopback preview skips Cloudflare response-header, HTTP-redirect and immutable-cache checks; production checks remain strict.');
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
  selected.add('/chat/');
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
  const checks = [], results = new Map(), pending = new Map();
  async function request(route) {
    if (!pending.has(route)) pending.set(route, (async () => {
      const response = await fetch(new URL(route, origin), { redirect: 'manual', signal: AbortSignal.timeout(timeout) });
      const bytes = new Uint8Array(await response.arrayBuffer());
      assert.ok(bytes.length <= 25 * 1024 * 1024, `Response exceeds static hosting limit: ${route}`);
      const result = { route, status: response.status, headers: response.headers, body: new TextDecoder().decode(bytes), bytes: bytes.length };
      results.set(route, result); checks.push({ route, status: result.status, bytes: result.bytes });
      return result;
    })());
    return pending.get(route);
  }
  async function batches(items, check, label) {
    for (let index = 0; index < items.length; index += 4) {
      await Promise.all(items.slice(index, index + 4).map(check));
      console.log(`${label}: ${Math.min(index + 4, items.length)}/${items.length}`);
    }
  }
  const recentResponse = await request('/search/recent.json');
  assert.equal(recentResponse.status, 200, 'Recent updates endpoint status');
  assert.match(recentResponse.headers.get('content-type') || '', /application\/json/i, 'Recent updates must return JSON');
  assert.deepEqual(JSON.parse(recentResponse.body), expectedRecent, 'Recent updates must match this release');
  if (!localPreview) assert.match(recentResponse.headers.get('cache-control') || '', /\bno-cache\b/i, 'Recent updates must revalidate between releases');
  await batches([...selected], async route => {
    const response = await request(route);
    assert.equal(response.status, 200, `Page status: ${route}`);
    assert.match(response.headers.get('content-type') || '', /text\/html/i, `HTML content type: ${route}`);
    assertCanonical(response.body, route); assertHtmlIndexing(response.body, environment, route);
    if (!localPreview) assertHeaderIndexing(response.headers.get('x-robots-tag'), environment, route);
    const record = routeMap.get(route);
    assertGiscus(response.body, record?.kind === 'page' && ['docs', 'posts', 'about', 'weekly', 'links'].includes(record.type), route);
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
    const response = await request(route); assert.equal(response.status, 200, `Feed/sitemap status: ${route}`);
    assert.match(response.headers.get('content-type') || '', /(?:xml|rss)/i, `XML content type: ${route}`);
    assert.match(response.body, route === '/sitemap.xml' ? /<urlset\b/ : /<rss\b/, `XML document missing: ${route}`);
    assertXMLSiteURLs(response.body, route);
  }, 'Feeds and sitemap');
  const robots = await request('/robots.txt'); assert.equal(robots.status, 200, 'robots.txt status'); assertRobotsPolicy(robots.body, environment);
  for (const route of ['/demos/2026/cloudflare-product-map/', '/__astro-deployment-verification-missing__/']) {
    const response = await request(route); assert.equal(response.status, 404, `Must return a real HTTP 404: ${route}`);
    assert.match(response.body, /页面未找到/, `Custom 404 missing: ${route}`); assertGiscus(response.body, false, route);
    if (environment === 'preview') { assertHtmlIndexing(response.body, environment, route); if (!localPreview) assertHeaderIndexing(response.headers.get('x-robots-tag'), environment, route); }
  }
  const redirects = parseRedirects(redirectText);
  assert.ok(redirects.some(rule => rule.from === '/page/1/' && rule.to === '/'), 'Pagination redirect missing');
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
  const assets = new Set(['/pagefind/pagefind.js', '/pagefind/pagefind-worker.js', '/pagefind/pagefind-entry.json', '/logo.gif', '/book-icons/menu.svg']);
  for (const route of selected) for (const asset of assetReferences(results.get(route).body, route)) assets.add(asset);
  const entry = await request('/pagefind/pagefind-entry.json'); assert.equal(entry.status, 200, 'Pagefind entry status');
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
    const response = await request(route); assert.equal(response.status, 200, `Asset status: ${route}`);
    assert.ok(response.bytes > 0 && !/text\/html/i.test(response.headers.get('content-type') || ''), `Asset returned HTML or an empty body: ${route}`);
    if (/\.css$/.test(route)) assert.match(response.headers.get('content-type') || '', /text\/css/i, `CSS content type: ${route}`);
    if (/\.m?js$/.test(route)) assert.match(response.headers.get('content-type') || '', /(?:java|ecma)script/i, `JavaScript content type: ${route}`);
    if (!localPreview && route.startsWith('/_astro/')) assert.match(response.headers.get('cache-control') || '', /immutable/i, `Hashed asset cache policy: ${route}`);
  }, 'Static assets and search');
  const report = path.resolve(root, values.report || `.generated/deployment-verification-${environment}.json`);
  await mkdir(path.dirname(report), { recursive: true });
  await writeFile(report, JSON.stringify({ environment, origin, hostingChecks: !localPreview, expectedTheme: source, checkedAt: new Date().toISOString(), exhaustiveRoutes: values['all-routes'], checks }, null, 2));
  console.log(`Verified ${environment} at ${origin}: ${selected.size} pages, ${checkedRedirects.length} legacy HTTP redirects, ${assets.size} assets, feeds/search/Giscus/indexing and actual 404 responses. Report: ${report}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(`Deployment verification failed: ${error.message}`); process.exitCode = 1; });
}
