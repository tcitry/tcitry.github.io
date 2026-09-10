import { access, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { parseArgs } from 'node:util';
import { parse, parseFragment } from 'parse5';
import { assertCanonical, assertComments, assertHeaderIndexing, assertHtmlIndexing, assertRecentUpdates, assertRobotsPolicy, assertXMLSiteURLs, assetReferences, parseRedirects } from './verify-deployment.mjs';
import { auditContentLinks } from './internal-links.mjs';
const root = fileURLToPath(new URL('../', import.meta.url)), output = path.join(root, 'dist');
const { values } = parseArgs({ options: { env: { type: 'string' }, help: { type: 'boolean' } } });
if (values.help) { console.log('Usage: node scripts/verify-build.mjs [--env production|preview]\nDefaults to PUBLIC_SITE_ENV, then preview.'); process.exit(0); }
const environment = values.env || process.env.PUBLIC_SITE_ENV || 'preview';
assert.ok(['production', 'preview'].includes(environment), 'Verification environment must be production or preview');
const content = JSON.parse(await readFile(path.join(root, '.generated/content.json'), 'utf8'));
assert.deepEqual(content.diagnostics.warnings.filter(warning => warning.startsWith('Unresolved relref')), [], 'Every prose relref must resolve before publishing');
const routes = JSON.parse(await readFile(path.join(root, '.generated/routes.json'), 'utf8'));
assertRecentUpdates(JSON.parse(await readFile(path.join(output, 'search/recent.json'), 'utf8')), routes);
const legacy = JSON.parse(await readFile(path.join(root, 'scripts/legacy-routes.json'), 'utf8'));
const htmlPath = url => path.join(output, decodeURIComponent(url), 'index.html');
const assets = new Set();
const headerRules = [];
for (const line of (await readFile(path.join(output, '_headers'), 'utf8')).split(/\r?\n/)) {
  if (!line.trim() || line.trim().startsWith('#')) continue;
  if (!/^\s/.test(line)) {
    const pattern = line.trim().split('*').map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*');
    headerRules.push({ pattern: new RegExp(`^${pattern}$`), robots: [] });
  } else if (/^\s*x-robots-tag:/i.test(line)) {
    assert.ok(headerRules.length, 'Header rule must have a path');
    headerRules.at(-1).robots.push(line.slice(line.indexOf(':') + 1).trim());
  }
}
function checkPage(html, url) {
  assertCanonical(html, url);
  assertHtmlIndexing(html, environment, url);
  assertHeaderIndexing(headerRules.filter(rule => rule.pattern.test(url)).flatMap(rule => rule.robots).join(', '), environment, url);
  for (const asset of assetReferences(html, url)) assets.add(asset);
}
const attributes = node => Object.fromEntries((node.attrs || []).map(({ name, value }) => [name, value]));
function descendants(node) {
  return [node, ...(node.childNodes || []).flatMap(descendants)];
}
function textContent(node, proseOnly = false) {
  if (['script', 'style', 'template', ...(proseOnly ? ['pre', 'code'] : [])].includes(node.tagName)) return '';
  return node.nodeName === '#text' ? node.value : (node.childNodes || []).map(child => textContent(child, proseOnly)).join(' ');
}
const normalizeText = value => value.replace(/\s+/g, ' ').trim();
function assertMdxPage(html, page) {
  const nodes = descendants(parse(html));
  const bodies = nodes.filter(node => Object.hasOwn(attributes(node), 'data-blog-mdx'));
  assert.equal(bodies.length, 1, `Blog MDX must render exactly one article body: ${page.url}`);
  const body = bodies[0];
  assert.equal(body.tagName, 'article', `Blog MDX must retain the article container: ${page.url}`);
  assert.ok(Object.hasOwn(attributes(body), 'data-pagefind-body'), `Blog MDX must retain its search boundary: ${page.url}`);
  const bodyNodes = descendants(body);
  const actualText = normalizeText(textContent(body));
  assert.ok(actualText, `Blog MDX must have server-rendered content: ${page.url}`);
  assert.ok(page.html?.trim(), `Blog MDX must have searchable metadata prose: ${page.url}`);
  // Compare original prose segments, allowing components to add their own text.
  const metadata = descendants(parseFragment(page.html));
  const samples = metadata.filter(node => node.tagName === 'p').flatMap(node => descendants(node))
    .filter(node => node.nodeName === '#text').map(node => normalizeText(node.value)).filter(text => text.length >= 32).slice(0, 3);
  for (const sample of samples) assert.ok(actualText.includes(sample), `Blog MDX lost its static article prose: ${page.url}`);
  for (const heading of page.headings) {
    const matches = bodyNodes.filter(node => /^h[1-6]$/.test(node.tagName || '') && attributes(node).id === heading.slug);
    assert.equal(matches.length, 1, `Blog MDX heading must match metadata exactly once (${heading.slug}): ${page.url}`);
  }
  // Code examples may intentionally contain shortcodes or module declarations.
  const prose = textContent(body, true);
  assert.doesNotMatch(prose, /\{\{[<%]\s*relref\b/, `Blog MDX contains an unresolved prose relref: ${page.url}`);
  assert.doesNotMatch(prose, /\bimport\s+[^;\n]{1,160}\s+from\s+['"]@\/components\//, `Blog MDX exposed its module source as prose: ${page.url}`);
  if (page.params?.slug === 'lieflat-charts-best-practices') {
    const demos = bodyNodes.filter(node => attributes(node)['data-demo'] === 'lieflat-tick-rows');
    assert.equal(demos.length, 1, 'The Lieflat article must embed its Tick Rows example exactly once');
    assert.ok(bodyNodes.some(node => node.tagName === 'astro-island' && descendants(node).includes(demos[0])), 'Tick Rows must retain its hydrated island');
    assert.ok(!bodyNodes.some(node => node.tagName === 'iframe'), 'The Lieflat article must render its example inline');
    const chart = descendants(demos[0]);
    const rows = chart.filter(node => Object.hasOwn(attributes(node), 'data-chart-row'));
    assert.deepEqual(rows.map(node => Number(attributes(node)['data-value'])), [18, 12, 6, 4], 'Tick Rows must retain the four teaching-data counts before hydration');
    assert.equal(new Set(rows.map(node => attributes(node)['data-name']).filter(Boolean)).size, 4, 'Tick Rows must label all four categories');
    for (const row of rows) {
      assert.equal(descendants(row).filter(node => Object.hasOwn(attributes(node), 'data-tick')).length, Number(attributes(row)['data-value']), 'Each Tick Rows mark must encode exactly one completed task');
    }
    assert.equal(chart.filter(node => Object.hasOwn(attributes(node), 'data-tick')).length, 40, 'Tick Rows must render all 40 data marks on the server');
    for (const type of ['f2', 'l14', 'f12']) {
      assert.equal(bodyNodes.filter(node => attributes(node)['data-demo'] === `lieflat-${type}`).length, 1, `Lieflat ${type} must appear exactly once`);
      assert.equal(bodyNodes.filter(node => attributes(node).id === `lieflat-${type}`).length, 1, `Lieflat ${type} must have a stable catalog anchor`);
    }
    assert.equal(bodyNodes.filter(node => Object.hasOwn(attributes(node), 'data-daily-point')).length, 14, 'F2 must preserve all 14 daily readings');
    assert.equal(bodyNodes.filter(node => Object.hasOwn(attributes(node), 'data-unit-dot')).length, 100, 'L14 must represent exactly 100 percentage points');
    assert.equal(bodyNodes.filter(node => Object.hasOwn(attributes(node), 'data-difference-bead')).length, 21, 'F12 default differences must total 21 minutes');
  }
}
const urls = new Set(routes.map(route => route.url));
const legacyURLs = new Set(legacy.pages.map(page => page.url));
const missing = [...legacyURLs].filter(url => !urls.has(url));
assert.deepEqual(missing, [], 'Every original public route must remain available');
const counts = { routes: routes.length, originalRoutes: legacyURLs.size, comments: 0, math: 0, mermaid: 0, code: 0, blogMdx: 0 };
const pages = new Map(content.pages.map(page => [page.id, page]));
for (const route of routes) {
  const html = await readFile(htmlPath(route.url), 'utf8');
  checkPage(html, route.url);
  if (environment === 'production') {
    assert.ok(html.includes('https://www.googletagmanager.com/gtag/js?id=G-Q20952BPE6'), `Production analytics missing: ${route.url}`);
    assert.ok(html.includes('https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-1305150098246428'), `Production AdSense missing: ${route.url}`);
  }
  const expectedComments = route.kind === 'page' && ['docs', 'posts', 'about', 'weekly', 'links'].includes(route.type);
  assertComments(html, expectedComments, route.url);
  if (expectedComments) counts.comments++;
  const page = pages.get(route.id);
  if (page?.mdx) { assertMdxPage(html, page); counts.blogMdx++; }
  for (const [feature, pattern] of [['math', 'class="katex"'], ['mermaid', 'class="mermaid"'], ['code', 'data-blog-code-language=']]) {
    if (page?.html.includes(pattern)) { assert.ok(html.includes(pattern), `${feature} lost in ${route.url}`); counts[feature]++; }
  }
}
assert.equal(counts.blogMdx, content.pages.filter(page => page.mdx).length, 'Every public Blog MDX page must have a verified final route');
assert.ok(counts.code > 0, 'Article code blocks must retain static source for the blog Pro renderer');
assert.ok(counts.math > 0 && counts.mermaid > 0, 'Math and Mermaid must survive the build');
for (const url of ['/', '/archives/', '/modified/', '/posts/', '/weekly/', '/timeline/', '/portfolio/', '/links/', '/tags/', '/categories/', '/about/', '/docs/']) assert.ok(urls.has(url), `Core route missing: ${url}`);
{
  const home = await readFile(htmlPath('/'), 'utf8');
  assert.match(home, /href="\/favicon.ico"/, 'Browsers request /favicon.ico; the page must name that file');
  assert.match(home, /href="\/apple-touch-icon.png"/, 'iOS requests /apple-touch-icon.png; the page must name that file');
}
const archives = await readFile(htmlPath('/archives/'), 'utf8');
const archiveTOCs = [...archives.matchAll(/<nav\b[^>]*\bdata-blog-archive-toc(?=[\s=>])[^>]*>([\s\S]*?)<\/nav>/g)];
assert.ok(archiveTOCs.length > 0, 'Archives must render its local year navigation');
const archiveHeadings = new Set([...archives.matchAll(/<h1\b[^>]*\bid="([^"]+)"/g)].map((match) => match[1]));
for (const [, navigation] of archiveTOCs) {
  const links = [...navigation.matchAll(/<a\b[^>]*\bhref="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(links.length, content.categories.length, 'Archives must retain every category in its year navigation');
  for (const term of content.categories) {
    assert.ok(links.includes(`#${term.name}`), `Archives category must scroll within the page: ${term.name}`);
    assert.ok(archiveHeadings.has(term.name), `Archives category has no matching heading ID: ${term.name}`);
  }
}
for (const url of ['/index.xml', '/posts/index.xml', '/weekly/index.xml', '/links/index.xml', '/sitemap.xml', '/robots.txt', '/404.html', '/favicon.ico', '/apple-touch-icon.png', '/icons/menu.svg', '/icons/chevron-right.svg', '/icons/favicon.ico', '/katex/katex.min.css', '/katex/katex.min.js', '/katex/fonts/KaTeX_Main-Regular.woff2', '/pagefind/pagefind.js', '/pagefind/pagefind-entry.json', '/pagefind/pagefind-worker.js', '/demos/2026/rounded-timeline/index.html', '/labs/index.html', '/labs/agent-replay/index.html']) await access(path.join(output, url));
assertRobotsPolicy(await readFile(path.join(output, 'robots.txt'), 'utf8'), environment);
const sitemap = await readFile(path.join(output, 'sitemap.xml'), 'utf8');
assert.match(sitemap, /<urlset\b/); assertXMLSiteURLs(sitemap, 'sitemap.xml');
for (const url of [...urls].filter(url => !/\/page\/\d+\/$/.test(url))) assert.ok(sitemap.includes(`<loc>https://yindongliang.com${url}</loc>`), `Canonical route missing from sitemap: ${url}`);
const notFound = await readFile(path.join(output, '404.html'), 'utf8');
assert.match(notFound, /页面未找到/); assertComments(notFound, false, '/404.html');
for (const asset of assetReferences(notFound, '/404.html')) assets.add(asset);
await assert.rejects(access(path.join(output, 'demos/2026/cloudflare-product-map')), { code: 'ENOENT' }, 'Removed demo assets must not be republished');
{
  const url = '/demos/2026/rounded-timeline/';
  const html = await readFile(htmlPath(url), 'utf8');
  assert.ok(html.includes(`data-astro-demo="${url}"`), `Demo must come from its Astro route, not an old copied artifact: ${url}`);
  checkPage(html, url); assertComments(html, false, url);
  for (const title of ['确认范围', '完成设计', '实现功能', '验收验证']) assert.ok(html.includes(title), `Timeline card must be present before JavaScript: ${title}`);
}
const feeds = new Set(['/index.xml', '/posts/index.xml', '/weekly/index.xml', '/links/index.xml']);
{
  const url = '/demos/2026/threejs-basics/';
  const html = await readFile(htmlPath(url), 'utf8');
  checkPage(html, url); assertComments(html, false, url);
  assert.ok(html.includes(`data-astro-demo="${url}"`), 'Three.js demo must use its Astro route');
  assert.ok(html.includes('data-demo="threejs-basics"'), 'Three.js scene markup must survive the build');
  assert.ok(html.includes('<noscript>'), 'The 3D demo must explain how to continue without JavaScript');
  assert.ok(!html.includes('cdn.jsdelivr.net'), 'The 3D demo must use bundled local dependencies');
  assert.ok(sitemap.includes(`<loc>https://yindongliang.com${url}</loc>`), 'Three.js demo is discoverable in sitemap');
}
for (const term of [...content.tags, ...content.categories]) { assert.ok(urls.has(term.url), `Taxonomy page missing: ${term.url}`); feeds.add(`${term.url}index.xml`); }
for (const url of feeds) {
  const xml = await readFile(path.join(output, decodeURIComponent(url)), 'utf8');
  assert.match(xml, /<rss\b[^>]*version="2\.0"/); assertXMLSiteURLs(xml, url);
}
const redirects = parseRedirects(await readFile(path.join(output, '_redirects'), 'utf8'));
const links = await auditContentLinks({ pages: content.pages, output, redirects, site: 'https://yindongliang.com' });
assert.deepEqual(links.errors, [], 'Every internal article link and fragment must have a published destination');
assert.ok(redirects.some(rule => rule.from === '/page/1/' && rule.to === '/'), 'First-page redirect missing');
for (const rule of redirects) { assert.ok(!urls.has(rule.from), `Redirect shadows a canonical route: ${rule.from}`); assert.ok(urls.has(rule.to), `Redirect has no destination: ${rule.from}`); }
for (const page of content.pages) for (const alias of page.aliases) {
  if (!urls.has(alias)) assert.ok(redirects.some(rule => rule.from === alias && rule.to === page.url), `Legacy alias redirect missing: ${alias}`);
}
const searchEntry = JSON.parse(await readFile(path.join(output, 'pagefind/pagefind-entry.json'), 'utf8'));
assert.ok(Object.keys(searchEntry.languages || {}).length > 0, 'Search index must contain a language');
let indexedPages = 0;
for (const language of Object.values(searchEntry.languages)) {
  assert.ok(language.page_count > 0 && language.hash, 'Search index must contain pages'); indexedPages += language.page_count;
  await access(path.join(output, `pagefind/pagefind.${language.hash}.pf_meta`));
  await access(path.join(output, `pagefind/wasm.${language.wasm || 'unknown'}.pagefind`));
}
for (const directory of ['index', 'fragment']) assert.ok((await readdir(path.join(output, 'pagefind', directory))).length > 0, `Pagefind ${directory} files missing`);
// Unpublished account pages were removed; the shared circle is the only entry.
for (const url of ['/chat/', '/me/']) {
  await assert.rejects(access(htmlPath(url)), {code: 'ENOENT'}, `Removed account page must not be generated: ${url}`);
  assert.ok(!redirects.some(rule => rule.from === url), `Unpublished account URL does not need a redirect: ${url}`);
  assert.ok(!sitemap.includes(`<loc>https://yindongliang.com${url}</loc>`), `Removed account URL is excluded from sitemap: ${url}`);
}
const lab = await readFile(path.join(output, 'labs/index.html'), 'utf8');
checkPage(lab, '/labs/');
const replay = await readFile(path.join(output, 'labs/agent-replay/index.html'), 'utf8');
checkPage(replay, '/labs/agent-replay/'); assertComments(replay, false, '/labs/agent-replay/');
assert.match(lab, /astro-island/); assert.match(lab, /AgentReplay/); assert.match(lab, /SvelteCounter/); assert.match(lab, /katex/);
assert.match(lab, /data-demo="heroui-pro-showcase"/, 'Labs must render the Pro component showcase');
assert.match(lab, /<h1[^>]*>Labs<\/h1>/, 'Labs title must match its navigation entry');
const labsTOC = lab.match(/<nav id="TableOfContents">([\s\S]*?)<\/nav>/)?.[1];
assert.ok(labsTOC, 'Labs must retain its section table of contents');
const labsAnchors = [...labsTOC.matchAll(/href="#([^"]+)"/g)];
assert.ok(labsAnchors.length > 0, 'Labs TOC must contain section links');
for (const [, anchor] of labsAnchors) {
  assert.ok(lab.includes(`id="${decodeURIComponent(anchor)}"`), `Labs TOC target missing: ${anchor}`);
}
for (const anchor of ['replay', 'try-it']) {
  assert.ok(replay.includes(`href="#${anchor}"`) && replay.includes(`id="${anchor}"`), `Replay TOC target missing: ${anchor}`);
}
assert.match(lab, /data-blog-code-language=/, 'Native MDX must use the same progressive code renderer');
assert.match(lab, /data-book-code-disabled/, 'The theme must not add a second ordinary code frame');
assertComments(lab, false, '/labs/');
for (const url of assets) {
  const target = path.resolve(output, `.${decodeURIComponent(url)}`);
  assert.ok(target.startsWith(output + path.sep), `Asset reference escapes dist: ${url}`);
  assert.ok((await stat(target)).isFile(), `Referenced asset missing: ${url}`);
}
const errors = [];
async function inspect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink() || /^(private|node_modules|\.git|\.obsidian)$/i.test(entry.name)) errors.push(path.relative(output, path.join(directory, entry.name)));
    if (entry.isDirectory()) await inspect(path.join(directory, entry.name));
    else if (entry.isFile()) assert.ok((await stat(path.join(directory, entry.name))).size <= 25 * 1024 * 1024, `Asset exceeds static hosting limit: ${entry.name}`);
  }
}
await inspect(output); assert.deepEqual(errors, [], 'Only public generated artifacts can be deployed');
await writeFile(path.join(root, '.generated/verification.json'), JSON.stringify({ environment, ...counts, contentLinks: links.checkedLinks, feeds: feeds.size, redirects: redirects.length, assets: assets.size, indexedPages, checkedAt: new Date().toISOString() }, null, 2));
console.log(`Verified ${counts.routes} rendered routes; all ${counts.originalRoutes} original URLs retained; ${counts.comments} Convex comment pages, ${counts.math} math pages, ${counts.mermaid} Mermaid pages, ${counts.code} code pages, ${counts.blogMdx} imported Blog MDX pages. ${links.checkedLinks} internal article links, ${feeds.size} feeds, ${redirects.length} redirects, ${assets.size} assets, search, existing demos, MDX/React/Svelte and ${environment} indexing policy passed.`);
