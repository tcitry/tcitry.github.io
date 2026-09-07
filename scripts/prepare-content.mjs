import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { createRendererFingerprint } from './renderer-cache.mjs';
import { collectSources, publicSources, matchLegacySources, asList, lowerKeys, gitDates, isoDate, resolveLegacyRoute, encodeRoute, routePart } from './legacy-content.mjs';
import { createLegacyMarkdownRenderer, createReferenceResolver, transformLegacyMarkdown, plainText } from '../src/lib/markdown.mjs';

const siteRoot = fileURLToPath(new URL('../', import.meta.url));
const blogRoot = path.resolve(process.env.BLOG_DIR || path.join(homedir(), 'Blog'));
const generated = path.join(siteRoot, '.generated');
await access(blogRoot);
await mkdir(generated, { recursive: true });
const candidates = await collectSources(blogRoot);
const records = publicSources(candidates);
if (records.some((record) => /\.mdx$/i.test(record.source))) throw new Error('Blog MDX ingestion is not enabled yet. Put interactive MDX demos in src/pages/lab/ so Astro compiles their components; Blog remains read-only.');
const sources = new Map(records.map((record) => [record.source, record]));
const modificationDates = gitDates(blogRoot);
let legacy = { pages: [] };
try { legacy = JSON.parse(await readFile(new URL('./legacy-routes.json', import.meta.url), 'utf8')); } catch { /* Fresh sites use the equivalent route rules below. */ }
// Include unpublished candidates when checking ambiguity: another source must
// never inherit their legacy route just because a colliding spelling is hidden.
const legacyBySource = matchLegacySources(candidates, legacy.pages);
const warnings = [];
const collisions = [];
const skippedCount = candidates.length - records.length;
function makePage(record, legacyPage = {}) {
  const data = record.data;
  const isSection = /(?:^|\/)_(?:index)\.mdx?$/.test(record.source);
  const isHome = record.source === '_index.md';
  const kind = isHome ? 'home' : isSection ? 'section' : 'page';
  const section = isHome ? '' : record.source.includes('/') ? record.source.split('/')[0] : '';
  const title = String(data.title || legacyPage.title || path.posix.basename(isSection ? path.posix.dirname(record.source) : record.source, path.posix.extname(record.source)));
  const { url, parent } = resolveLegacyRoute(record, legacyPage);
  const date = isoDate(data.date, legacyPage.date?.startsWith('0001') ? '' : isoDate(legacyPage.date));
  const lastmod = isoDate(data.lastmod, modificationDates.get(record.source) || record.mtime || date);
  return { id: record.source, source: record.source, url, title, kind, section, type: String(data.type || section || 'page'), layout: String(data.layout || ''), date, lastmod,
    description: String(data.description || ''), summary: '', html: '', headings: [], tags: asList(data.tags), categories: asList(data.categories), aliases: asList(data.aliases).map(encodeRoute),
    weight: Number(data.weight ?? 0), hidden: data.bookhidden === true, collapse: data.bookcollapsesection === true, toc: data.booktoc !== false,
    image: String(data.image || data.cover || ''), link: String(data.link || ''), redirect: data.redirect === true, parent, wordCount: 0, params: { ...data, legacySortTitle: String(data.linktitle ?? data.title ?? legacyPage.title ?? title) } };
}
const pages = records.map((record) => makePage(record, legacyBySource.get(record.source)));
// Hugo creates top-level sections; deeper directories require an explicit _index file.
const explicitDirectories = new Set(records.filter((record) => /(?:^|\/)_index\.mdx?$/.test(record.source)).map((record) => path.posix.dirname(record.source)));
const syntheticDirectories = new Set();
for (const record of records) {
  const parts = record.source.split('/');
  for (let i = 1; i < Math.min(parts.length, 2); i++) {
    const directory = parts.slice(0, i).join('/');
    if (!explicitDirectories.has(directory)) syntheticDirectories.add(directory);
  }
}
for (const directory of syntheticDirectories) {
  const expectedURL = encodeRoute('/' + routePart(directory) + '/');
  if (pages.some((page) => page.url === expectedURL)) continue;
  const old = legacy.pages.find((page) => !page.source && page.kind === 'section' && page.url === expectedURL);
  const record = { source: directory + '/_index.md', data: { title: old?.title || path.posix.basename(directory) }, body: '', mtime: '' };
  const page = makePage(record);
  page.id = '@section:' + directory; page.source = ''; page.lastmod = ''; page.params = { synthetic: true, legacySortTitle: old?.title || record.data.title };
  if (old) { page.url = old.url; page.parent = old.parent; }
  pages.push(page);
}
if (!pages.some((page) => page.kind === 'home')) pages.push(makePage({ source: '_index.md', data: { title: "LYon's Blog" }, body: '', mtime: '' }));
const referencePages = [...pages];
// Match Hugo when an explicit branch section shadows an article at the same URL.
// The suppressed source stays auditable, but changing published content is a separate migration.
const byURL = new Map();
for (const page of [...pages]) {
  const existing = byURL.get(page.url);
  if (!existing) { byURL.set(page.url, page); continue; }
  const section = [existing, page].find((candidate) => candidate.kind === 'section');
  const article = [existing, page].find((candidate) => candidate.kind === 'page');
  if (!section || !article) throw new Error(`Conflicting public routes: ${existing.source} and ${page.source} -> ${page.url}`);
  section.params = { ...section.params, legacySuppressedSources: [article.source] };
  pages.splice(pages.indexOf(article), 1);
  byURL.set(page.url, section);
  collisions.push({ url: page.url, sources: [section.source, article.source], resolution: 'Match Hugo: publish section content only; record the article suppressed by the legacy branch bundle without publishing its body.' });
  warnings.push(`Preserved Hugo section at existing article/section route collision: ${page.url}`);
}
// Parent links are based on the content tree, even when an explicit URL relocates an article.
for (const page of pages) {
  if (page.kind === 'home') continue;
  if (!page.parent) {
    const sourceDirectory = page.kind === 'section' ? path.posix.dirname(path.posix.dirname(page.source || page.id.replace('@section:', '') + '/_index.md')) : path.posix.dirname(page.source);
    const parentSource = sourceDirectory === '.' ? '_index.md' : sourceDirectory + '/_index.md';
    page.parent = pages.find((candidate) => candidate.source === parentSource || candidate.id === '@section:' + sourceDirectory)?.url || '/';
  }
}
// Undated Hugo branch sections inherit the newest descendant date. Recompute
// this from current public sources so newly added articles can reorder parents.
for (const section of pages.filter((page) => page.kind === 'section').sort((a, b) => b.url.split('/').length - a.url.split('/').length)) {
  if (section.params.date) continue;
  const childDates = pages.filter((page) => page.parent === section.url && page !== section).map((page) => page.date).filter(Boolean).sort();
  section.date = childDates.at(-1) || '';
}
const resolve = createReferenceResolver(referencePages);
const render = await createLegacyMarkdownRenderer();
const routeHash = createHash('sha256').update(JSON.stringify(referencePages.map((page) => [page.source, page.url]))).digest('hex');
const rendererVersion = await createRendererFingerprint({
  compatibilityFile: new URL('../src/lib/markdown.mjs', import.meta.url),
  themeEntryFile: new URL(import.meta.resolve('@tcitry/astro-book/markdown')),
  dependencyLockFile: new URL('../package-lock.json', import.meta.url),
});
let oldCache = {};
try { oldCache = JSON.parse(await readFile(path.join(generated, 'render-cache.json'), 'utf8')); } catch { /* First build. */ }
const cache = {};
let renderedCount = 0;
for (const page of pages) {
  const sourceNames = page.params.compatibilitySources || (page.source ? [page.source] : []);
  const body = sourceNames.map((source) => sources.get(source)?.body ?? '').filter(Boolean).join('\n\n');
  const key = createHash('sha256').update(rendererVersion + routeHash + page.source + body).digest('hex');
  let result = oldCache[key];
  if (!result) {
    const pageWarnings = [];
    const transformed = transformLegacyMarkdown(body, page.source, resolve, pageWarnings);
    try { result = { ...await render(transformed, pathToFileURL(path.join(blogRoot, page.source || '_index.md'))), warnings: pageWarnings }; }
    catch (error) { throw new Error(`Markdown rendering failed for ${page.source}: ${error.message}`, { cause: error }); }
    renderedCount++;
  }
  cache[key] = result;
  warnings.push(...result.warnings);
  page.html = result.html;
  page.headings = result.headings;
  const plain = plainText(result.html);
  const beforeSummary = body.split('<!--more-->')[0];
  page.summary = page.description || (body.includes('<!--more-->') ? plainText((await render(transformLegacyMarkdown(beforeSummary, page.source, resolve), pathToFileURL(path.join(blogRoot, page.source || '_index.md')))).html) : Array.from(plain).slice(0, 220).join(''));
  page.wordCount = (plain.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]|[\p{L}\p{N}_]+/gu) || []).length;
}
function taxonomy(key) {
  const terms = new Map();
  for (const page of pages) page[key] = page[key].map((name) => {
    const old = legacy.pages.find((candidate) => candidate.kind === 'term' && candidate.section === key && candidate.title.toLowerCase() === name.toLowerCase());
    const url = old?.url || encodeRoute('/' + key + '/' + routePart(name) + '/');
    let term = terms.get(url);
    if (term) { if (!term.pageIds.includes(page.id)) term.pageIds.push(page.id); }
    else { term = { name, url, pageIds: [page.id] }; terms.set(url, term); }
    return term.name;
  });
  return [...terms.values()].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
}
const uniqueWarnings = [...new Set(warnings)];
const content = { pages: pages.sort((a, b) => a.url.localeCompare(b.url)), tags: taxonomy('tags'), categories: taxonomy('categories'), diagnostics: { warnings: uniqueWarnings, sourceCount: records.length } };
await writeFile(path.join(generated, 'content.json'), JSON.stringify(content));
await writeFile(path.join(generated, 'render-cache.json'), JSON.stringify(cache));
await writeFile(path.join(generated, 'content-diagnostics.json'), JSON.stringify({ publicSourceCount: records.length, excludedSourceCount: skippedCount, pageCount: pages.length, collisions, warnings: uniqueWarnings, sourceToURL: records.map((record) => ({ source: record.source, url: referencePages.find((page) => page.source === record.source)?.url })) }, null, 2) + '\n');
await writeFile(path.join(generated, 'public-assets.json'), '[]\n');
console.log(`Prepared ${pages.length} pages from ${records.length} public sources (${renderedCount} rendered, ${uniqueWarnings.length} diagnostics); Blog remains read-only.`);
