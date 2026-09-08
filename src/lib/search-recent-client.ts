import type {SearchEntry} from './search-types';

export async function loadRecentUpdates(signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<SearchEntry[]> {
  const response = await fetcher('/search/recent.json', {signal, cache: 'no-cache'});
  if (!response.ok) throw new Error('Recent updates are unavailable.');
  const data: unknown = await response.json();
  if (!Array.isArray(data)) throw new Error('Recent updates must be a list.');
  const seen = new Set<string>();
  const entries: SearchEntry[] = [];
  for (const value of data) {
    if (!value || typeof value !== 'object' || typeof value.url !== 'string' || typeof value.title !== 'string') continue;
    if (!/^\/(docs|posts|weekly)\//.test(value.url)) continue;
    const url = new URL(value.url, 'https://example.invalid');
    if (url.origin !== 'https://example.invalid'
      || !/^\/(docs|posts|weekly)\//.test(url.pathname) || !value.title.trim() || seen.has(value.url)) continue;
    seen.add(value.url);
    entries.push({url: value.url, title: value.title,
      ...(typeof value.updated === 'string' ? {updated: value.updated} : {}),
      ...(typeof value.section === 'string' ? {section: value.section} : {}),
    });
    if (entries.length === 6) break;
  }
  return entries;
}
