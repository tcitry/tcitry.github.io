import type {SearchEntry, SearchResponse} from './search-types';

interface PagefindData {
  url: string;
  meta?: {title?: string};
  excerpt?: string;
  plain_excerpt?: string;
}
export interface PagefindModule {
  search(query: string): Promise<{results: {data(): Promise<PagefindData>}[]}>;
  destroy?(): void | Promise<void>;
}

const sectionLabels: Record<string, string> = {docs: '文档', posts: '文章', weekly: '周刊'};

function resultEntry(data: PagefindData, origin: string): SearchEntry | undefined {
  const url = new URL(data.url, origin);
  const section = url.pathname.split('/')[1];
  const pathname = decodeURIComponent(url.pathname);
  if (url.origin !== origin || url.username || url.password || !sectionLabels[section]
    || /[\\\u0000-\u001f\u007f]/u.test(pathname)
    || pathname.split('/').some(part => ['.', '..', 'private'].includes(part.toLowerCase()))) return;
  const title = data.meta?.title?.trim();
  if (!title) return;
  // Even plain_excerpt retains Pagefind's escaped angle brackets. Decode once
  // in an inert document, then let React render text instead of inserting HTML.
  const source = data.plain_excerpt ?? data.excerpt ?? '';
  const excerpt = /[<&]/.test(source)
    ? new DOMParser().parseFromString(source, 'text/html').body.textContent ?? '' : source;
  return {url: url.pathname + url.search + url.hash, title, excerpt, section: sectionLabels[section]};
}

/** Fetch only the visible result fragments; Pagefind retains its own ranking. */
export function createSearchClient(load: () => Promise<PagefindModule>, origin: string) {
  let library: Promise<PagefindModule> | undefined;
  let resetting = Promise.resolve();
  let generation = 0;
  return async (query: string, limit = 8): Promise<SearchResponse> => {
    const request = ++generation;
    const term = query.trim();
    if (!term) return {results: [], total: 0};
    const count = Math.max(1, Math.floor(limit));
    const pending = library ??= resetting.then(load);
    let engine: PagefindModule | undefined;
    try {
      engine = await pending;
      const response = await engine.search(term);
      const entries = await Promise.all(response.results.slice(0, count).map((result) => result.data()));
      const seen = new Set<string>();
      const results = entries.flatMap((entry) => {
        let item: SearchEntry | undefined;
        try { item = resultEntry(entry, origin); } catch { return []; }
        if (!item || seen.has(item.url)) return [];
        seen.add(item.url);
        return [item];
      });
      return {results, total: response.results.length};
    } catch (error) {
      // Pagefind caches rejected index/fragment promises. Reinitializing clears
      // them; a late failure must not reset an engine used by a newer query.
      if (request === generation && library === pending) {
        library = undefined;
        resetting = Promise.resolve().then(() => engine?.destroy?.()).catch(() => {});
      }
      throw error;
    }
  };
}

export interface SearchClientOptions {
  endpoint?: string;
  siteOrigin?: string;
  localOrigin: string;
  production?: boolean;
  loadPagefind: () => Promise<PagefindModule>;
  fetcher?: typeof fetch;
  timeoutMs?: number;
}

export function createConfiguredSearchClient(options: SearchClientOptions) {
  const pagefind = createSearchClient(options.loadPagefind, options.localOrigin);
  return async (query: string, limit?: number, signal?: AbortSignal): Promise<SearchResponse> => {
    signal?.throwIfAborted();
    const result = await pagefind(query, limit);
    signal?.throwIfAborted();
    return {...result, engine: 'pagefind' as const};
  };
}

let search: ReturnType<typeof createConfiguredSearchClient> | undefined;
export function searchContent(query: string, limit = 8, signal?: AbortSignal): Promise<SearchResponse> {
  search ??= createConfiguredSearchClient({
    localOrigin: window.location.origin,
    loadPagefind: async () => {
      const path = `${import.meta.env.BASE_URL.replace(/\/$/, '')}/pagefind/pagefind.js`;
      return import(/* @vite-ignore */ path) as Promise<PagefindModule>;
    },
  });
  return search(query, limit, signal);
}
