import {selectSources} from './chat.mjs';

const headers = {'cache-control': 'no-store', 'x-content-type-options': 'nosniff'};
const encoder = new TextEncoder();
const failure = (status, message) => Response.json({message}, {status, headers});

// Compare fixed-size digests so neither the first differing byte nor token length
// controls the comparison loop. This secret is never a browser credential.
async function authorized(request, secret) {
  if (typeof secret !== 'string' || secret.length < 32) return false;
  const match = /^Bearer (\S{32,512})$/.exec(request.headers.get('authorization') || '');
  const supplied = match?.[1] ?? '';
  const [expected, actual] = await Promise.all([secret, supplied].map(async value =>
    new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)))));
  let difference = 0;
  for (let index = 0; index < expected.length; index++) difference |= expected[index] ^ actual[index];
  return Boolean(match) && difference === 0;
}

async function readQuery(request, signal) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') || '')) return {status: 415};
  if (Number(request.headers.get('content-length')) > 16_384) return {status: 413};
  const reader = request.body?.getReader();
  if (!reader) return {status: 400};
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', abort, {once: true});
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const {done, value} = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      length += value.byteLength;
      if (length > 16_384) { await reader.cancel(); return {status: 413}; }
      chunks.push(value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const body = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes));
    if (!body || Array.isArray(body) || Object.keys(body).length !== 1 || typeof body.query !== 'string'
        || !body.query.trim() || body.query.length > 2000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(body.query)) return {status: 400};
    return {query: body.query.trim()};
  } catch { return {status: signal.aborted ? 504 : 400}; }
  finally { signal.removeEventListener('abort', abort); reader.releaseLock(); }
}

export async function handleRetrieval(request, env, references) {
  if (request.method !== 'POST') return new Response(null, {status: 405, headers: {...headers, allow: 'POST'}});
  if (typeof env.RAG_BRIDGE_SECRET !== 'string' || env.RAG_BRIDGE_SECRET.length < 32) return failure(503, '文章检索尚未完成连接。');
  if (!await authorized(request, env.RAG_BRIDGE_SECRET)) return failure(401, '请求未获授权。');
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(25_000)]);
  const input = await readQuery(request, signal);
  if (input.status) return failure(input.status, '检索请求无效或已超时。');
  if (!env.BLOG_SEARCH) return failure(503, '文章检索尚未完成连接。');
  let abort;
  try {
    signal.throwIfAborted();
    const result = await Promise.race([
      env.BLOG_SEARCH.search({query: input.query, ai_search_options: {
        retrieval: {retrieval_type: 'vector', max_num_results: 8, match_threshold: 0.4, return_on_failure: false},
        query_rewrite: {enabled: false}, reranking: {enabled: false}, cache: {enabled: false},
      }}),
      new Promise((_, reject) => {
        abort = () => reject(new Error('aborted'));
        signal.addEventListener('abort', abort, {once: true});
        if (signal.aborted) abort();
      }),
    ]);
    return Response.json(selectSources(result, references), {headers});
  } catch (error) {
    const rateLimited = Number(error?.status ?? error?.statusCode) === 429;
    return failure(signal.aborted ? 504 : rateLimited ? 429 : 502, '文章检索暂时无法完成，请稍后重试。');
  } finally { if (abort) signal.removeEventListener('abort', abort); }
}
