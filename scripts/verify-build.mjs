import { access, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const root = fileURLToPath(new URL('../', import.meta.url)), output = path.join(root, 'dist');
const content = JSON.parse(await readFile(path.join(root, '.generated/content.json'), 'utf8'));
const routes = JSON.parse(await readFile(path.join(root, '.generated/routes.json'), 'utf8'));
const legacy = JSON.parse(await readFile(path.join(root, 'scripts/legacy-routes.json'), 'utf8'));
const production = process.env.PUBLIC_SITE_ENV === 'production';
const htmlPath = url => path.join(output, decodeURIComponent(url), 'index.html');
const urls = new Set(routes.map(route => route.url));
const legacyURLs = new Set(legacy.pages.map(page => page.url));
const missing = [...legacyURLs].filter(url => !urls.has(url));
assert.deepEqual(missing, [], 'Every original public route must remain available');
const counts = { routes: routes.length, originalRoutes: legacyURLs.size, comments: 0, math: 0, mermaid: 0, code: 0 };
const pages = new Map(content.pages.map(page => [page.id, page]));
for (const route of routes) {
  const html = await readFile(htmlPath(route.url), 'utf8');
  assert.ok(html.includes(`href="https://yindongliang.com${route.url}"`), `Canonical mismatch: ${route.url}`);
  if (!production) {
    assert.match(html, /name="robots" content="noindex, nofollow"/, `Preview indexable: ${route.url}`);
    assert.ok(!html.includes('googletagmanager.com/gtag/js'), `Preview analytics: ${route.url}`);
  }
  const expectedComments = route.kind === 'page' && ['docs', 'posts', 'about', 'weekly', 'links'].includes(route.type);
  assert.equal(html.includes('src="https://giscus.app/client.js"'), expectedComments, `Giscus eligibility: ${route.url}`);
  if (expectedComments) { assert.match(html, /data-mapping="pathname"/); counts.comments++; }
  const page = pages.get(route.id);
  for (const [feature, pattern] of [['math', 'class="katex"'], ['mermaid', 'class="mermaid"'], ['code', 'data-blog-code-language=']]) {
    if (page?.html.includes(pattern)) { assert.ok(html.includes(pattern), `${feature} lost in ${route.url}`); counts[feature]++; }
  }
}
assert.ok(counts.code > 0, 'Article code blocks must retain static source for the blog Pro renderer');
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
for (const url of ['/index.xml', '/posts/index.xml', '/weekly/index.xml', '/sitemap.xml', '/robots.txt', '/404.html', '/pagefind/pagefind.js', '/demos/2026/rounded-timeline/index.html', '/lab/index.html', '/lab/agent-replay/index.html']) await access(path.join(output, url));
await assert.rejects(access(path.join(output, 'demos/2026/cloudflare-product-map')), { code: 'ENOENT' }, 'Removed demo assets must not be republished');
{
  const url = '/demos/2026/rounded-timeline/';
  const html = await readFile(htmlPath(url), 'utf8');
  assert.ok(html.includes(`data-astro-demo="${url}"`), `Demo must come from its Astro route, not an old copied artifact: ${url}`);
  assert.ok(html.includes(`href="https://yindongliang.com${url}"`), `Demo canonical mismatch: ${url}`);
  if (!production) assert.match(html, /name="robots" content="noindex, nofollow"/, `Preview demo indexable: ${url}`);
  for (const title of ['确认范围', '完成设计', '实现功能', '验收验证']) assert.ok(html.includes(title), `Timeline card must be present before JavaScript: ${title}`);
}
for (const term of [...content.tags, ...content.categories]) await access(path.join(output, decodeURIComponent(term.url), 'index.xml'));
const lab = await readFile(path.join(output, 'lab/index.html'), 'utf8');
assert.match(lab, /astro-island/); assert.match(lab, /AgentReplay/); assert.match(lab, /SvelteCounter/); assert.match(lab, /katex/);
assert.match(lab, /data-blog-code-language=/, 'Native MDX must use the same progressive code renderer');
assert.match(lab, /data-book-code-disabled/, 'The theme must not add a second ordinary code frame');
assert.ok(!lab.includes('giscus.app/client.js'), 'Lab must not create legacy comment mappings');
const errors = [];
async function inspect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink() || /^(private|node_modules|\.git|\.obsidian)$/i.test(entry.name)) errors.push(path.relative(output, path.join(directory, entry.name)));
    if (entry.isDirectory()) await inspect(path.join(directory, entry.name));
    else if (entry.isFile()) assert.ok((await stat(path.join(directory, entry.name))).size <= 25 * 1024 * 1024, `Asset exceeds static hosting limit: ${entry.name}`);
  }
}
await inspect(output); assert.deepEqual(errors, [], 'Only public generated artifacts can be deployed');
await writeFile(path.join(root, '.generated/verification.json'), JSON.stringify({ ...counts, checkedAt: new Date().toISOString() }, null, 2));
console.log(`Verified ${counts.routes} rendered routes; all ${counts.originalRoutes} original URLs retained; ${counts.comments} Giscus pages, ${counts.math} math pages, ${counts.mermaid} Mermaid pages, ${counts.code} code pages. Feeds, search, existing demos, MDX/React/Svelte and preview indexing policy passed.`);
