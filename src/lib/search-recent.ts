import { bookTitle, param } from '../components/book/helpers';
import type { ContentPage } from './types';
import type { SearchEntry } from './search-types';

const sections: Record<string, string> = { docs: '文档', posts: '文章', weekly: '周刊' };
const enabled = (value: unknown) => value === true || typeof value === 'string' && value.trim().toLowerCase() === 'true';
const timestamp = (value: string): number | undefined => {
  if (!value || value.startsWith('0001')) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

function routeKey(value: string): string | undefined {
  if (!value.startsWith('/') || value.startsWith('//') || /[\\\s\u0000-\u001f\u007f]/u.test(value)) return undefined;
  try {
    const url = new URL(value, 'https://search.invalid');
    if (url.origin !== 'https://search.invalid' || url.search || url.hash || !/^\/(?:docs|posts|weekly)\//.test(url.pathname)) return undefined;
    // Decode only for deduplication. Returned links retain their canonical spelling.
    return decodeURI(url.pathname);
  } catch {
    return undefined;
  }
}

/** Initial suggestions use public article metadata independently of the search backend. */
export function getRecentUpdates(pages: ContentPage[], limit = 6): SearchEntry[] {
  const count = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 0;
  if (!count) return [];

  const ranked = pages.flatMap((page) => {
    if (page.kind !== 'page' || !Object.hasOwn(sections, page.type) || page.hidden || page.redirect
      || enabled(param(page, 'draft')) || enabled(param(page, 'bookSearchExclude')) || !page.html.trim()) return [];
    const key = routeKey(page.url);
    const title = bookTitle(page).trim();
    const date = timestamp(page.date);
    const lastmod = timestamp(page.lastmod);
    if (!key || !title || date === undefined && lastmod === undefined) return [];
    const updated = Math.max(date ?? -Infinity, lastmod ?? -Infinity);
    return [{ key, updated, entry: {
      url: page.url, title, updated: new Date(updated).toISOString(), section: sections[page.type],
    } }];
  }).sort((a, b) => b.updated - a.updated || a.entry.title.localeCompare(b.entry.title, 'zh-CN')
    || a.entry.url.localeCompare(b.entry.url));

  const seen = new Set<string>();
  return ranked.filter(({ key }) => {
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, count).map(({ entry }) => entry);
}
