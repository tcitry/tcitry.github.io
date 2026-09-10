import exportedReferences from '../.generated/ai-search/references.json';
import {publicAIEndpoint} from '../src/lib/public-ai-search-url.mjs';
import type {Source, Snippet} from './assistantModel';

export type PublicSearchReference = {
  id: string; key: string; hash: string; title: string; url: string;
  updatedAt?: string; sourceKind: 'author' | 'ai-assisted';
};

const ERROR = '文章检索暂时无法完成，请稍后重试。';
const MAX_RESPONSE_BYTES = 512 * 1024;
const MIN_SCORE = 0.45;
const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;

export function publicSearchEndpoint(input: string, path: 'search' | 'chat/completions'): string {
  try { return publicAIEndpoint(input, {endpoint: path, allowChatPath: true}); }
  catch { throw new Error(ERROR); }
}

function trustedReference(value: unknown): PublicSearchReference | null {
  const ref = record(value);
  if (!ref || typeof ref.id !== 'string' || !/^[a-f0-9]{64}$/.test(ref.id)
      || ref.key !== `tcitry-blog/articles/${ref.id}.md` || typeof ref.hash !== 'string' || !/^[a-f0-9]{64}$/.test(ref.hash)
      || typeof ref.title !== 'string' || !ref.title.trim() || ref.title.length > 1000
      || typeof ref.url !== 'string' || /[\\\s\u0000-\u001f\u007f]/u.test(ref.url)
      || !['author', 'ai-assisted'].includes(String(ref.sourceKind))) return null;
  try {
    const url = new URL(ref.url);
    const pathname = decodeURIComponent(url.pathname);
    if (url.origin !== 'https://yindongliang.com' || url.href !== ref.url || url.username || url.password || url.search || url.hash
        || !/^\/(docs|posts|weekly)\/.+\/$/.test(url.pathname)
        || /[\\\u0000-\u001f\u007f]/u.test(pathname)
        || pathname.split('/').some(part => ['.', '..', 'private'].includes(part.toLowerCase()))) return null;
    return {id: ref.id, key: ref.key, hash: ref.hash, title: ref.title, url: ref.url,
      sourceKind: ref.sourceKind as PublicSearchReference['sourceKind'],
      ...(typeof ref.updatedAt === 'string' && ref.updatedAt.length <= 50 && Number.isFinite(Date.parse(ref.updatedAt)) ? {updatedAt: ref.updatedAt} : {}),
    };
  } catch { return null; }
}

/** Matching remote metadata cannot replace the locally exported article identity. */
export function validatePublicChunk(chunk: unknown, references: readonly PublicSearchReference[]): PublicSearchReference | null {
  const candidate = record(chunk);
  const item = candidate && ('item' in candidate ? record(candidate.item) : candidate);
  const metadata = record(item?.metadata);
  if (!item || !metadata || typeof item.key !== 'string') return null;
  const ref = trustedReference(references.find(reference => reference.key === item.key));
  if (!ref || metadata.content_hash !== ref.hash || metadata.canonical_url !== ref.url || metadata.source_kind !== ref.sourceKind) return null;
  return ref;
}

async function readJSON(response: Response, signal: AbortSignal): Promise<unknown> {
  const declaredLength = response.headers.get('content-length');
  if (declaredLength && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > MAX_RESPONSE_BYTES)) {
    await response.body?.cancel().catch(() => {});
    throw new Error(ERROR);
  }
  if (!response.body) throw new Error(ERROR);
  const reader = response.body.getReader();
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancel, {once: true});
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const {done, value} = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) { await reader.cancel(); throw new Error(ERROR); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {bytes.set(chunk, offset); offset += chunk.byteLength;}
    return JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes));
  } finally {
    signal.removeEventListener('abort', cancel);
    reader.releaseLock();
  }
}

export async function retrievePublicSources(endpoint: string, query: string, signal: AbortSignal, options: {
  fetcher?: typeof fetch; references?: readonly PublicSearchReference[];
} = {}): Promise<{sources: Source[]; snippets: Snippet[]; approvedReferences: PublicSearchReference[]}> {
  const url = publicSearchEndpoint(endpoint, 'search');
  if (typeof query !== 'string' || !query.trim() || query.length > 2000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(query)) throw new Error(ERROR);
  signal.throwIfAborted();
  try {
    const response = await (options.fetcher ?? fetch)(url, {
      method: 'POST', credentials: 'omit', redirect: 'error', signal,
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({query: query.trim(), ai_search_options: {
        retrieval: {retrieval_type: 'vector', max_num_results: 8, match_threshold: MIN_SCORE, return_on_failure: false},
        query_rewrite: {enabled: false}, reranking: {enabled: false}, cache: {enabled: false},
      }}),
    });
    if (signal.aborted) {await response.body?.cancel().catch(() => {}); signal.throwIfAborted();}
    if (!response.ok || response.redirected) {await response.body?.cancel().catch(() => {}); throw new Error(ERROR);}
    const body = record(await readJSON(response, signal));
    const result = record(body?.result);
    if (body?.success !== true || !Array.isArray(result?.chunks) || result.chunks.length > 50) throw new Error(ERROR);
    const references = options.references ?? exportedReferences.documents as PublicSearchReference[];
    const sources: Source[] = [];
    const snippets: Snippet[] = [];
    const approvedReferences: PublicSearchReference[] = [];
    const selected = new Map<string, {source: Source; remaining: number}>();
    let remaining = 14_000;
    for (const value of result.chunks) {
      if (!remaining || snippets.length >= 10) break;
      const chunk = record(value);
      const reference = validatePublicChunk(value, references);
      if (!reference || typeof chunk?.score !== 'number' || !Number.isFinite(chunk.score) || chunk.score < MIN_SCORE
          || typeof chunk.text !== 'string' || !chunk.text.trim()) continue;
      let entry = selected.get(reference.key);
      if (!entry) {
        if (sources.length >= 5) continue;
        const source: Source = {id: String(sources.length + 1), title: reference.title, url: reference.url, sourceKind: reference.sourceKind};
        entry = {source, remaining: 4000};
        selected.set(reference.key, entry); sources.push(source); approvedReferences.push(reference);
      }
      if (!entry.remaining) continue;
      const text = chunk.text.trim().slice(0, Math.min(entry.remaining, remaining));
      entry.remaining -= text.length; remaining -= text.length;
      snippets.push({source: entry.source.id, title: reference.title, sourceKind: reference.sourceKind, text,
        ...(reference.updatedAt ? {updatedAt: reference.updatedAt} : {}),
      });
    }
    return {sources, snippets, approvedReferences};
  } catch {
    signal.throwIfAborted();
    throw new Error(ERROR);
  }
}
