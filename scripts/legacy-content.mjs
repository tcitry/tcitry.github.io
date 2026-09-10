import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import YAML from 'yaml';

export const PUBLIC_SECTIONS = ['docs', 'posts', 'weekly', 'links', 'timeline'];
export const CONTENT_DENIED = /^(?:private|draft|drafts|template|templates|skills|demo|demos|test|tests|node_modules)$/i;
export const ROOT_PAGES = new Set(['_index', 'about', 'archives', 'modified', 'portfolio', 'timeline', 'ghstar'].flatMap(name => [name + '.md', name + '.mdx']));
export const lowerKeys = (value) => Object.fromEntries(Object.entries(value ?? {}).map(([key, item]) => [key.toLowerCase(), item]));
export const asList = (value) => [...new Set((value == null ? [] : Array.isArray(value) ? value : [value]).map(String).map((v) => v.trim()).filter(Boolean))];
export function frontmatter(text, source = '') {
  const match = text.replace(/^\uFEFF/, '').match(/^---\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)\s*(?:\r?\n|$)/);
  if (!match) return { data: {}, body: text, raw: '' };
  try { return { data: lowerKeys(YAML.parse(match[1], { uniqueKeys: false }) ?? {}), body: text.slice(match[0].length), raw: match[0] }; }
  catch (error) { throw new Error(`Invalid frontmatter: ${source}: ${error.message}`); }
}
export async function collectSources(root) {
  const output = [];
  async function walk(relative) {
    let entries;
    try { entries = await readdir(path.join(root, relative), { withFileTypes: true }); }
    catch (error) { if (error.code === 'ENOENT') return; throw error; }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      if (entry.name.startsWith('.') || CONTENT_DENIED.test(entry.name) || entry.isSymbolicLink()) continue;
      const name = path.posix.join(relative, entry.name);
      if (entry.isDirectory()) await walk(name);
      else if (/\.mdx?$/i.test(entry.name)) output.push(name);
    }
  }
  for (const section of PUBLIC_SECTIONS) await walk(section);
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (entry.isFile() && ROOT_PAGES.has(entry.name)) output.push(entry.name);
  }
  const records = [];
  for (const source of output.sort()) {
    const file = path.join(root, source);
    const parsed = frontmatter(await readFile(file, 'utf8'), source);
    records.push({ source, ...parsed, mtime: (await stat(file)).mtime.toISOString() });
  }
  return records;
}
function cascadeFor(data, source) {
  const cascades = Array.isArray(data.cascade) ? data.cascade : data.cascade ? [data.cascade] : [];
  let inherited = {};
  for (const item of cascades) {
    const normalized = lowerKeys(item);
    const target = lowerKeys(normalized._target);
    if (target.path) {
      const expression = new RegExp('^' + String(target.path).replace(/\*\*/g, '\u0000').replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*').replace(/\u0000/g, '.*') + '$');
      if (!expression.test('/' + source.replace(/(?:\/)?_?index\.mdx?$|\.mdx?$/i, ''))) continue;
    }
    const { _target, ...params } = normalized;
    inherited = { ...inherited, ...params };
  }
  return inherited;
}
export function publicSources(records) {
  const bySource = new Map(records.map((record) => [record.source, record]));
  return records.flatMap((record) => {
    const parts = record.source.split('/');
    let inherited = {};
    const ancestors = ['_index.md', '_index.mdx'];
    for (let i = 1; i < parts.length; i++) for (const extension of ['md', 'mdx']) ancestors.push(parts.slice(0, i).join('/') + '/_index.' + extension);
    for (const ancestor of ancestors) {
      const parent = bySource.get(ancestor);
      if (parent) inherited = { ...inherited, ...cascadeFor(parent.data, record.source) };
    }
    const data = { ...inherited, ...record.data };
    const publishDate = isoDate(data.publishdate, isoDate(data.date));
    const expiryDate = isoDate(data.expirydate);
    if (publishDate && new Date(publishDate).valueOf() > Date.now() || expiryDate && new Date(expiryDate).valueOf() <= Date.now()) return [];
    const build = lowerKeys(data.build ?? data._build);
    if (data.draft === true || data.draft === 'true' || build.render === 'never' || build.render === false || build.list === 'never' && build.render === 'never') return [];
    return [{ ...record, data }];
  });
}
export function matchLegacySources(records, legacyPages) {
  const fold = source => source.toLowerCase().replace(/\.mdx$/, '.md');
  const exact = new Map();
  const legacyByFold = new Map();
  const currentCounts = new Map();
  for (const page of legacyPages) {
    if (!page.source) continue;
    exact.set(page.source, page);
    const key = fold(page.source);
    // A null entry marks an ambiguous legacy spelling, including duplicates.
    legacyByFold.set(key, legacyByFold.has(key) ? null : page);
  }
  for (const record of records) {
    const key = fold(record.source);
    currentCounts.set(key, (currentCounts.get(key) ?? 0) + 1);
  }
  const matches = new Map();
  for (const record of records) {
    const key = fold(record.source);
    const page = exact.get(record.source) ?? (currentCounts.get(key) === 1 ? legacyByFold.get(key) : undefined);
    if (page) matches.set(record.source, page);
  }
  return matches;
}
export function gitDates(root) {
  const dates = new Map();
  try {
    const output = execFileSync('git', ['-C', root, 'log', '-z', '--format=%x00commit:%ct%x00', '--name-only', '--', ...PUBLIC_SECTIONS, ...ROOT_PAGES], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    let date = '';
    let firstPath = false;
    for (const field of output.split('\0')) {
      const commit = field.match(/^commit:(-?\d+)$/);
      if (commit) {
        date = new Date(Number(commit[1]) * 1000).toISOString();
        firstPath = true;
      } else if (field) {
        // -z preserves literal filenames. Only the first path after a pretty
        // header has Git's extra newline separator; never trim the path itself.
        const source = firstPath && field.startsWith('\n') ? field.slice(1) : field;
        firstPath = false;
        if (source && date && !dates.has(source)) dates.set(source, date);
      }
    }
  } catch { /* Local source folders without Git use their file modification times. */ }
  return dates;
}
export function isoDate(value, fallback = '') {
  if (value == null || value === '') return fallback;
  const date = new Date(value instanceof Date ? value : String(value));
  return Number.isNaN(date.valueOf()) ? fallback : date.toISOString();
}
export const encodeRoute = (url) => '/' + String(url).replace(/^\/+/, '').split('/').map((part) => { try { return encodeURIComponent(decodeURIComponent(part)); } catch { return encodeURIComponent(part); } }).join('/');
export function routePart(value) {
  return String(value).normalize('NFC').replace(/\s/g, '-').replace(/[?#%]/g, '').replace(/\/{2,}/g, '/');
}
export function defaultRoute(record) {
  const { data, source } = record;
  if (data.url) return encodeRoute(String(data.url).replace(/\/?$/, String(data.url).match(/\.[a-z0-9]+$/i) ? '' : '/'));
  if (/^_index\.mdx?$/.test(source)) return '/';
  const index = /(?:^|\/)_(?:index)\.mdx?$/.test(source);
  let target = source.replace(/\.mdx?$/i, '').replace(/\/_index$/, '');
  if (source.startsWith('posts/') && !index) target = 'posts/' + (data.slug || path.posix.basename(target));
  else if (data.slug && !index) target = path.posix.join(path.posix.dirname(target), String(data.slug));
  return encodeRoute('/' + routePart(target) + '/');
}
export function routeSignature(record) {
  return JSON.stringify({ url: record.data.url ?? null, slug: record.data.slug ?? null });
}
export function resolveLegacyRoute(record, legacyPage = {}) {
  const sameRoute = legacyPage.routeSignature === routeSignature(record);
  return { url: sameRoute ? legacyPage.url : defaultRoute(record), parent: sameRoute ? legacyPage.parent : '' };
}
