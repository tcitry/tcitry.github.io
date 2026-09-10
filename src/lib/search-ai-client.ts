import type {SearchEntry, SearchResponse} from './search-types';
import {publicAIEndpoint} from './public-ai-search-url.mjs';

export interface SearchReference {
  key: string;
  hash: string;
  url: string;
  title: string;
  section: string;
  updatedAt?: string;
}

const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const hashPattern = /^[a-f0-9]{64}$/;
const keyPattern = /^tcitry-blog\/articles\/[a-f0-9]{64}\.md$/;

/** Public Search only: credentials and other API paths are configuration errors. */
export function publicSearchURL(value: string): string {
  return publicAIEndpoint(value);
}

/** Canonical destinations must belong to this site's public article sections. */
function articleURL(value: unknown, origin: string): URL | undefined {
  if (typeof value !== 'string' || /[\\\s\u0000-\u001f\u007f]/u.test(value)) return;
  try {
    const url = new URL(value);
    const pathname = decodeURIComponent(url.pathname);
    if (url.origin !== origin || !['https:', 'http:'].includes(url.protocol) || url.username || url.password
      || url.search || url.hash || !/^\/(docs|posts|weekly)\/.+\/$/.test(url.pathname)
      || /[\\\u0000-\u001f\u007f]/u.test(pathname) || pathname.split('/').some(part => ['.', '..', 'private'].includes(part.toLowerCase()))) return;
    return url;
  } catch { return; }
}

/** Also used by the static endpoint to expose only public reference metadata. */
export function publicSearchReferences(value: unknown, siteOrigin: string): SearchReference[] {
  const data = record(value);
  if (!Array.isArray(data?.documents)) throw new Error('Search references are unavailable.');
  const origin = new URL(siteOrigin).origin;
  const seen = new Set<string>();
  return data.documents.flatMap((item): SearchReference[] => {
    const ref = record(item);
    const url = articleURL(ref?.url, origin);
    if (!ref || !url || typeof ref.key !== 'string' || !keyPattern.test(ref.key)
      || typeof ref.hash !== 'string' || !hashPattern.test(ref.hash)
      || typeof ref.title !== 'string' || !ref.title.trim() || seen.has(ref.key)) return [];
    seen.add(ref.key);
    return [{key: ref.key, hash: ref.hash, url: url.href, title: ref.title.trim(), section: url.pathname.split('/')[1],
      ...(typeof ref.updatedAt === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(ref.updatedAt)
        && Number.isFinite(Date.parse(ref.updatedAt)) ? {updatedAt: ref.updatedAt} : {}),
    }];
  });
}

function textExcerpt(value: unknown, canonical: string): string {
  if (typeof value !== 'string') return '';
  const lines = value.slice(0, 16000).split(/\r?\n/);
  let start = 0;
  const heading = lines.findIndex(line => line.trim());
  const address = lines.findIndex((line, index) => index > heading && line.trim());
  // The corpus prepends this known metadata header. Hide it only when it
  // identifies the verified article; keep ordinary body text and code intact.
  if (heading >= 0 && /^# /.test(lines[heading]) && lines[address]?.trim() === `原文地址：${canonical}`) {
    start = address + 1;
    while (start < lines.length && (!lines[start].trim() || /^(栏目|发布日期|更新日期|来源类型)：/.test(lines[start]))) start++;
  }
  return lines.slice(start).join('\n').replace(/^\s*#{1,6}\s+/gm, '')
    .replace(/\[([^\]\n]+)\]\(<?https?:\/\/[^\s)>]+>?\)/g, '$1')
    .replace(/\s+/gu, ' ').trim().slice(0, 320);
}

export function mapAISearchResponse(value: unknown, references: SearchReference[], siteOrigin: string): SearchResponse {
  const data = record(value);
  // The public endpoint uses the REST envelope; the direct result shape also
  // occurs in binding responses and is useful for independently tested adapters.
  if (!data || data.success === false || ('success' in data && data.success !== true)) throw new Error('AI Search failed.');
  const result = 'result' in data ? record(data.result) : data;
  if (!Array.isArray(result?.chunks)) throw new Error('AI Search returned an invalid response.');
  const trusted = new Map(references.map(ref => [ref.key, ref]));
  const origin = new URL(siteOrigin).origin;
  const seen = new Set<string>();
  let updating = false;
  const results: SearchEntry[] = [];
  for (const value of result.chunks.slice(0, 50)) {
    const chunk = record(value);
    const item = record(chunk?.item);
    const metadata = record(item?.metadata);
    const ref = typeof item?.key === 'string' ? trusted.get(item.key) : undefined;
    if (!ref || typeof chunk?.score !== 'number' || !Number.isFinite(chunk.score) || chunk.score < 0.4) continue;
    const url = articleURL(metadata?.canonical_url, origin);
    const target = articleURL(ref.url, origin);
    if (!url || !target || url.href !== target.href) continue;
    if (metadata?.content_hash !== ref.hash) { updating = true; continue; }
    const key = decodeURI(target.pathname);
    if (seen.has(key)) continue;
    seen.add(key);
    // Render untrusted chunk content as a React text node. Never parse it as
    // HTML or use Markdown/innerHTML; code and markup remain literal text.
    const excerpt = textExcerpt(chunk.text, target.href);
    results.push({url: target.pathname, title: ref.title, section: target.pathname.split('/')[1], excerpt,
      ...(ref.updatedAt ? {updated: ref.updatedAt} : {}),
    });
  }
  return {results, total: results.length, ...(updating ? {updating: true} : {})};
}

interface AISearchOptions {
  endpoint: string;
  siteOrigin: string;
  referencesURL?: string;
  fetcher?: typeof fetch;
  timeoutMs?: number;
}

/** Only transport outages may switch a configured search to the local index. */
export class AISearchTemporaryError extends Error {
  constructor(message: string) {super(message); this.name = 'AISearchTemporaryError';}
}

function requireResponse(response: Response, message: string) {
  if (response.ok) return;
  if (response.status === 429 || response.status >= 500) throw new AISearchTemporaryError(message);
  throw new Error(message);
}

/** Search is anonymous and retrieval-only; Clerk/session data never leaves here. */
export function createAISearchClient({endpoint, siteOrigin, referencesURL = '/search/references.json', fetcher = fetch, timeoutMs = 15000}: AISearchOptions) {
  const url = publicSearchURL(endpoint);
  const origin = new URL(siteOrigin).origin;
  let references: SearchReference[] | undefined;
  let cached: {query: string; response: SearchResponse} | undefined;
  let generation = 0;
  return async (query: string, limit = 8, signal?: AbortSignal): Promise<SearchResponse> => {
    const request = ++generation;
    signal?.throwIfAborted();
    const term = query.trim();
    if (!term) return {results: [], total: 0};
    const count = Number.isFinite(limit) ? Math.min(50, Math.max(1, Math.floor(limit))) : 8;
    const visible = (response: SearchResponse) => ({...response, results: response.results.slice(0, count)});
    if (count > 8 && cached?.query === term) return visible(cached.response);
    const controller = new AbortController();
    const ensureCurrent = () => {
      signal?.throwIfAborted();
      if (request !== generation) throw new DOMException('Search superseded.', 'AbortError');
      controller.signal.throwIfAborted();
    };
    const transport = async <T,>(operation: () => Promise<T>): Promise<T> => {
      try {return await operation();}
      catch (error) {
        // Fetch uses TypeError for network/CORS failures, including interrupted
        // response bodies. Parsing/configuration errors are never downgraded.
        if (error instanceof TypeError) throw new AISearchTemporaryError('AI Search is unreachable.');
        throw error;
      }
    };
    const cancel = () => controller.abort(signal?.reason);
    signal?.addEventListener('abort', cancel, {once: true});
    const timeout = setTimeout(() => controller.abort(new DOMException('Search timed out.', 'TimeoutError')), timeoutMs);
    try {
      if (!references) {
        const response = await transport(() => fetcher(referencesURL, {signal: controller.signal, cache: 'no-cache', credentials: 'omit', redirect: 'error'}));
        requireResponse(response, 'Search references are unavailable.');
        const data: unknown = await transport(() => response.json());
        ensureCurrent();
        references = publicSearchReferences(data, origin);
      }
      ensureCurrent();
      const response = await transport(() => fetcher(url, {
        method: 'POST', signal: controller.signal, credentials: 'omit', redirect: 'error',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({query: term, ai_search_options: {
          retrieval: {max_num_results: 50, match_threshold: 0.4},
          query_rewrite: {enabled: false}, reranking: {enabled: false}, cache: {enabled: false},
        }}),
      }));
      requireResponse(response, response.status === 429 ? 'AI Search is rate limited.' : 'AI Search is unavailable.');
      const data: unknown = await transport(() => response.json());
      ensureCurrent();
      const result = mapAISearchResponse(data, references, origin);
      // Only cache a successful query for its local "load more" action. Failed
      // and cancelled requests can always be retried without refreshing.
      cached = {query: term, response: result};
      return visible(result);
    } catch (error) {
      signal?.throwIfAborted();
      if (request !== generation) throw new DOMException('Search superseded.', 'AbortError');
      if (controller.signal.aborted && controller.signal.reason?.name === 'TimeoutError') {
        throw new AISearchTemporaryError('AI Search timed out.');
      }
      throw error;
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', cancel);
    }
  };
}
