import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, 'dist');
const content = JSON.parse(await readFile(path.join(root, '.generated/content.json'), 'utf8'));
const routes = JSON.parse(await readFile(path.join(root, '.generated/routes.json'), 'utf8'));
const origin = 'https://yindongliang.com';
const escape = value => String(value).replace(/[<>&"']/g, char => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[char]);
const absolute = url => new URL(url, origin).href;
const destination = url => {
  const relative = decodeURIComponent(url).replace(/^\//, '');
  const target = path.resolve(output, relative);
  if (target !== output && !target.startsWith(output + path.sep)) throw new Error('Output path escapes dist');
  return target;
};
async function put(url, text) { const target = destination(url); await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, text); }
const validDate = value => value && Number.isFinite(Date.parse(value)) && Date.parse(value) > 0;
const regular = content.pages.filter(page => page.kind === 'page');
const pageById = new Map(content.pages.map(page => [page.id, page]));
const dateSort = (a, b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0);
let feedCount = 0;
async function feed(route, entries) {
  const sorted = [...entries].sort(dateSort);
  const url = route.url + 'index.xml';
  const title = route.title || "LYon's Blog";
  const items = sorted.map(page => `<item><title>${escape(page.title)}</title><link>${escape(absolute(page.url))}</link><guid isPermaLink="true">${escape(absolute(page.url))}</guid>${validDate(page.date) ? `<pubDate>${new Date(page.date).toUTCString()}</pubDate>` : ''}<description>${escape(page.summary)}</description>${page.categories.map(category => `<category>${escape(category)}</category>`).join('')}</item>`).join('\n');
  await put(url, `<?xml version="1.0" encoding="utf-8"?>\n<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel><title>${escape(title)}</title><link>${escape(absolute(route.url))}</link><description>${escape(title)}</description><language>zh-CN</language><atom:link href="${escape(absolute(url))}" rel="self" type="application/rss+xml"/>${validDate(sorted[0]?.date) ? `<lastBuildDate>${new Date(sorted[0].date).toUTCString()}</lastBuildDate>` : ''}${items}</channel></rss>\n`);
  feedCount++;
}
await feed({url:'/',title:"LYon's Blog"}, regular);
for (const route of routes.filter(route => ['section', 'term', 'taxonomy'].includes(route.kind) && !/\/page\/\d+\/$/.test(route.url))) {
  const page = pageById.get(route.id);
  const entries = route.kind === 'section'
    ? regular.filter(entry => entry.section === page?.section && (page?.url === `/${page?.section}/` || entry.url.startsWith(route.url)))
    : route.entryIds.map(id => pageById.get(id)).filter(Boolean);
  await feed({ ...route, title: page?.title || route.id }, entries);
}
const sitemap = routes.filter(route => !/\/page\/\d+\/$/.test(route.url)).map(route => {
  const page = pageById.get(route.id);
  return `<url><loc>${escape(absolute(route.url))}</loc>${validDate(page?.lastmod) ? `<lastmod>${new Date(page.lastmod).toISOString()}</lastmod>` : ''}<changefreq>weekly</changefreq><priority>0.5</priority></url>`;
});
for (const url of ['/lab/', '/lab/agent-replay/']) sitemap.push(`<url><loc>${absolute(url)}</loc></url>`);
await put('/sitemap.xml', `<?xml version="1.0" encoding="utf-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${sitemap.join('\n')}</urlset>\n`);
let redirects = 0;
const routeURLs = new Set(routes.map(route => route.url));
// macOS commonly uses a case-insensitive filesystem. Keep aliases that only differ
// in case in the host redirect manifest instead of overwriting a real HTML page.
const outputKeys = new Set(routes.map(route => decodeURIComponent(route.url).toLowerCase()));
const redirectRules = [];
const aliasEntries = content.pages.flatMap(page => page.aliases.map(alias => [alias, page.url]));
aliasEntries.push(['/page/1/', '/']);
for (const [alias, url] of aliasEntries) {
  if (routeURLs.has(alias)) continue;
  redirectRules.push(`${alias} ${url} 301`);
  const key = decodeURIComponent(alias).toLowerCase();
  if (outputKeys.has(key)) continue;
  outputKeys.add(key);
  const target = alias.endsWith('/') ? alias + 'index.html' : alias;
  const canonical = absolute(url);
  await put(target, `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="robots" content="noindex"><link rel="canonical" href="${escape(canonical)}"><meta http-equiv="refresh" content="0; url=${escape(url)}"><title>页面已迁移</title></head><body><a href="${escape(url)}">继续阅读</a></body></html>`);
  redirects++;
}
await put('/_redirects', redirectRules.join('\n') + '\n');
await writeFile(path.join(root, '.generated/build-summary.json'), JSON.stringify({ routes: routes.length, feeds: feedCount, redirects, generatedAt: new Date().toISOString() }, null, 2));
console.log(`Finalized ${routes.length} content routes, ${feedCount} feeds, sitemap and ${redirects} existing/pagination redirects.`);
