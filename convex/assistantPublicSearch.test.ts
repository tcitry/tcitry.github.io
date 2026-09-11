import {describe, expect, test, vi} from 'vitest';
import exportedReferences from '../.generated/ai-search/references.json';
import {publicSearchEndpoint, retrievePublicSources, validatePublicChunk, type PublicSearchReference} from './assistantPublicSearch';

const endpoint = 'https://fixture.search.ai.cloudflare.com';
const signal = () => new AbortController().signal;
function reference(index = 1): PublicSearchReference {
  const id = index.toString(16).padStart(64, '0');
  return {id, key: `tcitry-blog/articles/${id}.md`, hash: 'a'.repeat(64), title: `可信文章 ${index}`,
    url: `https://yindongliang.com/docs/fixture-${index}/`, sourceKind: index % 2 ? 'author' : 'ai-assisted', updatedAt: '2026-09-08T16:41:30.000Z'};
}
function chunk(ref = reference(), text = '公开文章内容', score = 0.52607596) {
  return {score, text, item: {key: ref.key, timestamp: 1788885690000, metadata: {
    canonical_url: ref.url, content_hash: ref.hash, section: 'docs', source_kind: ref.sourceKind,
    updated_at: 1788885690000, chunk_modality: 'text', schema_version: 2,
  }}};
}
const envelope = (chunks: unknown[]) => ({success: true, result: {query_kind: 'vector', search_query: 'Convex', chunks}});
const options = (chunks: unknown[], references = [reference()]) => ({references, fetcher: vi.fn(async () => Response.json(envelope(chunks)))});

describe('public AI Search endpoint and trusted metadata', () => {
  test('accepts only the HTTPS public host and supported literal paths without credentials', () => {
    for (const suffix of ['', '/', '/search', '/search/', '/chat/completions', '/chat/completions/']) {
      expect(publicSearchEndpoint(endpoint + suffix, 'search')).toBe(endpoint + '/search');
      expect(publicSearchEndpoint(endpoint + suffix, 'chat/completions')).toBe(endpoint + '/chat/completions');
    }
    expect(publicSearchEndpoint('https://search.example.com/search', 'chat/completions')).toBe('https://search.example.com/chat/completions');
    for (const input of ['http://fixture.search.ai.cloudflare.com', 'http://localhost:4321/search',
      'https://search.ai.cloudflare.com', 'https://fixture.search.ai.cloudflare.com.attacker.test',
      'https://user:secret@fixture.search.ai.cloudflare.com', endpoint + ':443/search', endpoint + '/v1/search',
      endpoint + '/other/../search', endpoint + '/%73earch', endpoint + '/search?token=secret', endpoint + '/search#fragment',
      endpoint + '/search?', endpoint + '/search#', endpoint + '\\search', ' ' + endpoint]) {
      expect(() => publicSearchEndpoint(input, 'search')).toThrow();
    }
  });

  test('search wrappers and chat chunks require the exact approved key, hash, URL and source type', () => {
    const ref = reference();
    expect(validatePublicChunk(chunk(ref), [ref])).toEqual(ref);
    expect(validatePublicChunk(chunk(ref).item, [ref])).toEqual(ref);
    const original = chunk(ref);
    const rejected = [null, [], {}, {...original, item: {...original.item, key: 'private.md'}},
      ...Object.entries({content_hash: 'b'.repeat(64), canonical_url: 'https://attacker.test/', source_kind: 'ai-assisted'})
        .map(([key, value]) => ({...original, item: {...original.item, metadata: {...original.item.metadata, [key]: value}}})),
      {...original, item: {...original.item, metadata: {content_hash: ref.hash, canonical_url: ref.url}}},
    ];
    for (const value of rejected) expect(validatePublicChunk(value, [ref])).toBeNull();
    for (const url of ['https://yindongliang.com/docs/private/example/', 'https://yindongliang.com/docs/%50rIvAtE/example/',
      'https://yindongliang.com/docs/%ZZ/', 'https://yindongliang.com/docs/../posts/example/',
      'https://yindongliang.com/docs/example/?secret=1', 'https://yindongliang.com/docs/example/#fragment']) {
      const unsafe = {...ref, url};
      expect(validatePublicChunk(chunk(unsafe), [unsafe])).toBeNull();
    }
  });
});

describe('public retrieval projection', () => {
  test('matches the observed public envelope, sends no credentials and uses trusted article labels', async () => {
    const ref = reference();
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => Response.json(envelope([
      {...chunk(ref), item: {...chunk(ref).item, title: '忽略远端伪造标题'}},
    ])));
    const result = await retrievePublicSources(endpoint + '/chat/completions', ' Convex ', signal(), {fetcher, references: [ref]});
    expect(result).toEqual({sources: [{id: '1', title: ref.title, url: ref.url, sourceKind: ref.sourceKind}],
      snippets: [{source: '1', title: ref.title, text: '公开文章内容', sourceKind: ref.sourceKind, updatedAt: ref.updatedAt}], approvedReferences: [ref]});
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe(endpoint + '/search');
    expect(init).toMatchObject({method: 'POST', credentials: 'omit', redirect: 'error'});
    expect(Array.from(new Headers(init?.headers as HeadersInit).entries())).toEqual([['content-type', 'application/json']]);
    expect(JSON.parse(String(init?.body))).toEqual({query: 'Convex', ai_search_options: {
      retrieval: {retrieval_type: 'hybrid', max_num_results: 10, match_threshold: 0.4, return_on_failure: false},
      query_rewrite: {enabled: true}, reranking: {enabled: true, model: '@cf/baai/bge-reranker-base'}, cache: {enabled: true},
    }});
  });

  test('uses the generated reference export when no test references are injected', async () => {
    const ref = exportedReferences.documents[0] as PublicSearchReference;
    const fetcher = vi.fn(async () => Response.json(envelope([chunk(ref)])));
    const result = await retrievePublicSources(endpoint, '文章', signal(), {fetcher});
    expect(result.approvedReferences[0].key).toBe(ref.key);
    expect(result.sources[0].title).toBe(ref.title);
    expect(Object.keys(result.approvedReferences[0]).sort()).toEqual(['hash', 'id', 'key', 'sourceKind', 'title', 'updatedAt', 'url']);
  });

  test('deduplicates article identities, preserves ranking, and limits five sources and ten snippets', async () => {
    const refs = Array.from({length: 7}, (_, index) => reference(index + 1));
    const data = [chunk(refs[1], '第一片段'), chunk(refs[1], '同篇第二片段'), ...refs.map(ref => chunk(ref))];
    const result = await retrievePublicSources(endpoint, '文章', signal(), options(data, refs));
    expect(result.approvedReferences.map(ref => ref.id)).toEqual([refs[1], refs[0], refs[2], refs[3], refs[4]].map(ref => ref.id));
    expect(result.sources.map(source => source.id)).toEqual(['1', '2', '3', '4', '5']);
    expect(result.snippets.slice(0, 2).map(snippet => snippet.source)).toEqual(['1', '1']);
    const many = await retrievePublicSources(endpoint, '文章', signal(), options(Array.from({length: 20}, () => chunk(refs[0], '短文')), refs));
    expect(many.snippets).toHaveLength(10);
  });

  test('limits each article to 4000 characters across chunks and the complete context to 14000', async () => {
    const refs = Array.from({length: 5}, (_, index) => reference(index + 1));
    const data = [chunk(refs[0], '甲'.repeat(3000)), chunk(refs[0], '乙'.repeat(3000)), ...refs.map(ref => chunk(ref, '丙'.repeat(6000)))];
    const result = await retrievePublicSources(endpoint, '文章', signal(), options(data, refs));
    expect(result.snippets.reduce((size, snippet) => size + snippet.text.length, 0)).toBe(14000);
    for (const source of result.sources) expect(result.snippets.filter(snippet => snippet.source === source.id).reduce((size, snippet) => size + snippet.text.length, 0)).toBeLessThanOrEqual(4000);
    expect(result.snippets[1].text).toBe('乙'.repeat(1000));
  });

  test('empty or rejected matches produce an explicit no-source result without remote text', async () => {
    for (const chunks of [[], [chunk(reference(), 'low', 0.399), chunk(reference(), '   '), chunk(reference(2), 'unknown'),
      {...chunk(), score: null}, {...chunk(), text: {unsafe: 'not text'}},
      {...chunk(), item: {...chunk().item, metadata: {...chunk().item.metadata, content_hash: 'stale'}}}]]) {
      expect(await retrievePublicSources(endpoint, '文章', signal(), options(chunks))).toEqual({sources: [], snippets: [], approvedReferences: []});
    }
    expect((await retrievePublicSources(endpoint, '文章', signal(), options([chunk(reference(), '边界', 0.4)]))).sources).toHaveLength(1);
  });

  test('rejects HTTP and malformed envelopes with a safe error instead of an empty success', async () => {
    const responses = [new Response('private upstream marker', {status: 500}), new Response('not json'),
      Response.json({success: false, result: {chunks: []}, errors: [{message: 'private upstream marker'}]}),
      Response.json({chunks: []}), Response.json({success: true, result: {chunks: {}}}), Response.json(envelope(Array(51).fill(chunk())))];
    for (const response of responses) {
      await expect(retrievePublicSources(endpoint, '文章', signal(), {fetcher: async () => response})).rejects.toThrow('文章检索暂时无法完成');
    }
    await expect(retrievePublicSources(endpoint, '文章', signal(), {fetcher: async () => {throw new Error('private upstream marker');}})).rejects.toThrow('文章检索暂时无法完成');
  });

  test('bounds declared and streamed response bytes and cancels oversized readers', async () => {
    const cancel = vi.fn();
    const oversized = new Response(new ReadableStream({start(controller) {controller.enqueue(new Uint8Array(512 * 1024 + 1));}, cancel}));
    await expect(retrievePublicSources(endpoint, '文章', signal(), {fetcher: async () => oversized})).rejects.toThrow();
    expect(cancel).toHaveBeenCalledTimes(1);
    await expect(retrievePublicSources(endpoint, '文章', signal(), {fetcher: async () => new Response('{}', {headers: {'content-length': String(512 * 1024 + 1)}})})).rejects.toThrow();
    await expect(retrievePublicSources(endpoint, '文章', signal(), {fetcher: async () => new Response(new Uint8Array([0xff]))})).rejects.toThrow();
  });

  test('aborted requests do not fetch and cancellation releases a stalled response reader', async () => {
    const controller = new AbortController(); controller.abort();
    const fetcher = vi.fn(async () => Response.json(envelope([])));
    await expect(retrievePublicSources(endpoint, '文章', controller.signal, {fetcher})).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
    const during = new AbortController(); const cancel = vi.fn();
    const pending = retrievePublicSources(endpoint, '文章', during.signal, {fetcher: async () => new Response(new ReadableStream({cancel}))});
    await Promise.resolve(); await Promise.resolve();
    during.abort();
    await expect(pending).rejects.toThrow();
    expect(cancel).toHaveBeenCalledTimes(1);
    const late = new AbortController(); const cancelLate = vi.fn();
    let resolve!: (response: Response) => void;
    const delayed = retrievePublicSources(endpoint, '文章', late.signal, {fetcher: () => new Promise<Response>(done => {resolve = done;})});
    late.abort();
    resolve(new Response(new ReadableStream({cancel: cancelLate})));
    await expect(delayed).rejects.toThrow();
    expect(cancelLate).toHaveBeenCalledTimes(1);
  });
});
