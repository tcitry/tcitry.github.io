import {publicSearchReferences} from './search-ai-client';

export interface ArticleTitleItem {pathname: string; title?: string}

export function articleTitleKey(pathname: string) {
  let decoded = pathname;
  try {decoded = decodeURIComponent(pathname);} catch { /* A broken legacy escape must not break the personal panel. */ }
  return decoded.replace(/\/+$/, '') || '/';
}

export function preferredArticleTitle(item: ArticleTitleItem, current?: ArticleTitleItem) {
  const title = item.title?.trim();
  if (title && articleTitleKey(title) !== articleTitleKey(item.pathname)) return title;
  if (current && articleTitleKey(current.pathname) === articleTitleKey(item.pathname)) {
    const currentTitle = current.title?.trim();
    if (currentTitle && articleTitleKey(currentTitle) !== articleTitleKey(item.pathname)) return currentTitle;
  }
  return undefined;
}

export function articleTitleFallback(pathname: string) {
  const last = articleTitleKey(pathname).split('/').filter(Boolean).at(-1) ?? '';
  return last.replace(/[-_]+/g, ' ').replace(/[\u0000-\u001f\u007f]/g, '').trim() || '查看文章';
}

// Only public reference metadata is cached. No Clerk token, private record or
// article body is sent or retained here, and concurrent panels share one read.
export function createArticleTitleLookup(siteOrigin: string, fetcher: typeof fetch = fetch) {
  let request: Promise<ReadonlyMap<string, string>> | undefined;
  return () => request ??= (async () => {
    try {
      const response = await fetcher('/search/references.json', {credentials: 'omit', redirect: 'error', cache: 'no-cache', signal: AbortSignal.timeout(10_000)});
      if (!response.ok) return new Map<string, string>();
      const value: unknown = await response.json();
      return new Map(publicSearchReferences(value, siteOrigin).map(item => [articleTitleKey(new URL(item.url).pathname), item.title]));
    } catch {return new Map<string, string>();}
  })();
}
