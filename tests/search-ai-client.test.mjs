import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';

const bundle = await build({
  entryPoints: [new URL('../src/lib/search-ai-client.ts', import.meta.url).pathname],
  bundle: true, platform: 'node', format: 'esm', write: false,
});
const {createAISearchClient, publicSearchURL, publicSearchReferences, mapAISearchResponse, AISearchTemporaryError} = await import(
  'data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64')
);
const siteOrigin = 'https://example.com';
const endpoint = 'https://fixture.search.ai.cloudflare.com/search';
const ref = (number = 1, extra = {}) => ({
  key: `tcitry-blog/articles/${String(number).padStart(64, '0')}.md`, hash: 'a'.repeat(64),
  url: `${siteOrigin}/docs/article-${number}/`, title: `Article ${number}`, section: 'docs', ...extra,
});
const chunk = (reference = ref(), extra = {}) => ({
  score: 0.8, text: 'A relevant passage.',
  item: {key: reference.key, metadata: {content_hash: reference.hash, canonical_url: reference.url}}, ...extra,
});
const response = chunks => ({success: true, result: {chunks}});

test('public endpoint accepts configured custom and default HTTPS Search URLs without credentials', () => {
  assert.equal(publicSearchURL('https://fixture.search.ai.cloudflare.com'), endpoint);
  assert.equal(publicSearchURL(`${endpoint}/`), endpoint);
  assert.equal(publicSearchURL('https://search.example.com'), 'https://search.example.com/search');
  for (const value of [
    'http://fixture.search.ai.cloudflare.com/search', 'https://localhost/search',
    'https://fixture.search.ai.cloudflare.com.evil.example/search',
    'https://user:password@fixture.search.ai.cloudflare.com/search',
    `${endpoint}?token=secret`, `${endpoint}#part`, endpoint.replace('/search', '/chat/completions'),
    'javascript:alert(1)', '//fixture.search.ai.cloudflare.com/search',
  ]) assert.throws(() => publicSearchURL(value));
});

test('public references expose only safe article metadata without revisions or content', () => {
  const valid = ref(1, {title: '  Public title  ', updatedAt: '2026-09-01T00:00:00Z',
    source: 'unpublished-source', markdown: 'Article body', privateMetadata: 'private'});
  const invalid = [
    'https://outside.example/docs/page/', 'javascript:alert(1)', '//outside.example/docs/page/',
    'https://user:password@example.com/docs/page/', `${siteOrigin}/private/hidden/`,
    `${siteOrigin}/docs/../../private/hidden/`, `${siteOrigin}/docs/%70rivate/hidden/`,
    `${siteOrigin}/docs/hidden/?secret=1`, `${siteOrigin}/docs/hidden/#x`,
    `${siteOrigin}/docs/bad%ZZ/`, `${siteOrigin}/docs/%00/`,
    `${siteOrigin}/docs/only-one`, `${siteOrigin}/links/page/`,
  ].map((url, index) => ref(index + 2, {url}));
  assert.deepEqual(publicSearchReferences({revision: {contentCommit: 'private-revision'}, documents: [
    valid, ...invalid, ref(100, {hash: 'invalid'}), ref(101, {key: 'not-an-article'}), ref(102, {title: ' '}), valid,
  ]}, siteOrigin), [{key: valid.key, hash: valid.hash, url: valid.url, title: 'Public title', section: 'docs', updatedAt: valid.updatedAt}]);
  assert.throws(() => publicSearchReferences({documents: {}}, siteOrigin), /references/);
});

test('chunks keep ranking, deduplicate articles, verify versions and ignore invented titles', () => {
  const first = ref();
  const second = ref(2, {url: `${siteOrigin}/posts/%E4%B8%AD%E6%96%87/`, updatedAt: '2026-09-01T00:00:00Z'});
  const stale = ref(3);
  const payload = response([
    chunk(first, {text: '<img src=x onerror=alert(1)> &lt;script&gt; literal code'}),
    chunk(first, {text: 'Duplicate chunk'}), chunk(second),
    chunk(ref(999)), chunk(stale, {item: {key: stale.key, metadata: {canonical_url: stale.url, content_hash: 'b'.repeat(64), title: 'Invented'}}}),
  ]);
  assert.deepEqual(mapAISearchResponse(payload, [first, second, stale], siteOrigin), {
    results: [
      {url: '/docs/article-1/', title: first.title, section: 'docs', excerpt: '<img src=x onerror=alert(1)> &lt;script&gt; literal code'},
      {url: '/posts/%E4%B8%AD%E6%96%87/', title: second.title, section: 'posts', excerpt: 'A relevant passage.', updated: second.updatedAt},
    ], total: 2, updating: true,
  });
});

test('unsafe metadata destinations, low scores, unknown keys and nonfinite scores are discarded', () => {
  const reference = ref();
  const attacks = [
    'javascript:alert(1)', 'https://evil.example/docs/article-1/', '//evil.example/docs/article-1/',
    'https://user:password@example.com/docs/article-1/', `${siteOrigin}/docs/article-1/?redirect=evil`,
    `${siteOrigin}/private/hidden/`, `${siteOrigin}/docs/article-2/`,
  ].map(canonical_url => chunk(reference, {item: {key: reference.key, metadata: {content_hash: reference.hash, canonical_url}}}));
  assert.deepEqual(mapAISearchResponse(response([...attacks, ...[0.39, NaN, Infinity, '0.9'].map(score => chunk(reference, {score}))]), [reference], siteOrigin), {results: [], total: 0});
  assert.deepEqual(mapAISearchResponse({chunks: []}, [reference], siteOrigin), {results: [], total: 0});
});

test('snippets remove the verified corpus header and link formatting while preserving literal code', () => {
  const reference = ref();
  const text = `# Article 1\n\n原文地址：${reference.url}\n\n栏目：docs\n\n发布日期：2026-09-01T00:00:00Z\n\n来源类型：作者文章\n\n## Branches\n\nRead [the guide](https://example.com/guide/) with <img src=x onerror=alert(1)> as code.`;
  assert.equal(mapAISearchResponse(response([chunk(reference, {text})]), [reference], siteOrigin).results[0].excerpt,
    'Branches Read the guide with <img src=x onerror=alert(1)> as code.');
  const ordinary = '# Example\n\n原文地址：https://outside.example/\n\n栏目：docs\n\nBody.';
  assert.match(mapAISearchResponse(response([chunk(reference, {text: ordinary})]), [reference], siteOrigin).results[0].excerpt, /原文地址：/);
});

test('invalid response envelopes are failures rather than empty search results', () => {
  for (const value of [null, [], {}, {success: false, result: {chunks: []}}, {success: 'true', result: {chunks: []}},
    {success: true, result: {data: []}}, {success: true, result: {chunks: null}}]) {
    assert.throws(() => mapAISearchResponse(value, [ref()], siteOrigin));
  }
});

test('anonymous retrieval sends no auth, fetches references lazily and reuses chunks for pagination', async () => {
  const references = Array.from({length: 12}, (_, index) => ref(index + 1));
  const requests = [];
  const client = createAISearchClient({endpoint, siteOrigin, fetcher: async (url, options) => {
    requests.push({url, options});
    return Response.json(url === endpoint ? response(references.map(reference => chunk(reference))) : {documents: references});
  }});
  assert.deepEqual(await client('  '), {results: [], total: 0});
  assert.equal(requests.length, 0);
  const first = await client('  body  ');
  assert.equal(first.results.length, 8);
  assert.equal(first.total, 12);
  assert.equal((await client('body', 16)).results.length, 12);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].url, '/search/references.json');
  assert.equal(requests[0].options.credentials, 'omit');
  assert.equal(requests[0].options.cache, 'no-cache');
  const request = requests[1];
  assert.equal(request.url, endpoint);
  assert.equal(request.options.method, 'POST');
  assert.equal(request.options.credentials, 'omit');
  assert.equal(request.options.redirect, 'error');
  assert.deepEqual(request.options.headers, {'Content-Type': 'application/json'});
  assert.deepEqual(JSON.parse(request.options.body), {query: 'body', ai_search_options: {
    retrieval: {max_num_results: 50, match_threshold: 0.4}, query_rewrite: {enabled: false},
    reranking: {enabled: false}, cache: {enabled: false},
  }});
});

test('HTTP and protocol failures can retry the same query and never become an empty success', async () => {
  let searches = 0;
  let referenceReads = 0;
  const client = createAISearchClient({endpoint, siteOrigin, fetcher: async url => {
    if (url !== endpoint) { referenceReads++; return Response.json({documents: [ref()]}); }
    if (++searches === 1) return new Response('', {status: 429});
    if (searches === 2) return Response.json({success: false});
    return Response.json(response([chunk()]));
  }});
  await assert.rejects(client('query'), /rate limited/);
  await assert.rejects(client('query'), /failed/);
  assert.equal((await client('query')).total, 1);
  assert.equal(referenceReads, 1);
  assert.equal(searches, 3);
});

test('failed references can retry and do not issue a paid retrieval request', async () => {
  let calls = 0;
  const client = createAISearchClient({endpoint, siteOrigin, fetcher: async url => {
    calls++;
    if (calls === 1) return new Response('', {status: 503});
    return Response.json(url === endpoint ? response([]) : {documents: [ref()]});
  }});
  await assert.rejects(client('query'), /references/);
  assert.equal(calls, 1);
  assert.deepEqual(await client('query'), {results: [], total: 0});
  assert.equal(calls, 3);
});

test('cancelled late responses cannot become results or replace the latest pagination cache', async () => {
  let finishOld;
  let oldSignal;
  let started;
  const ready = new Promise(resolve => { started = resolve; });
  const first = ref();
  const latest = ref(2);
  const requests = [];
  const client = createAISearchClient({endpoint, siteOrigin, fetcher: async (url, options) => {
    if (url !== endpoint) return Response.json({documents: [first, latest]});
    const query = JSON.parse(options.body).query;
    requests.push(query);
    if (query === 'old') {
      oldSignal = options.signal;
      started();
      // Simulate a transport that resolves even after cancellation.
      return new Promise(resolve => { finishOld = () => resolve(Response.json(response([chunk(first)]))); });
    }
    return Response.json(response([chunk(latest)]));
  }});
  const controller = new AbortController();
  const old = client('old', 8, controller.signal);
  await ready;
  controller.abort();
  assert.equal(oldSignal.aborted, true);
  assert.equal((await client('new')).results[0].title, latest.title);
  finishOld();
  await assert.rejects(old, {name: 'AbortError'});
  assert.equal((await client('new', 16)).results[0].title, latest.title);
  assert.deepEqual(requests, ['old', 'new']);
});

test('timeout and already-aborted signals stop the request and allow a fresh retry', async () => {
  let calls = 0;
  const client = createAISearchClient({endpoint, siteOrigin, timeoutMs: 5, fetcher: async (url, options) => {
    calls++;
    if (calls > 1) return Response.json(url === endpoint ? response([]) : {documents: [ref()]});
    return new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), {once: true}));
  }});
  await assert.rejects(client('query'), error => error instanceof AISearchTemporaryError && /timed out/.test(error.message));
  assert.deepEqual(await client('query'), {results: [], total: 0});
  const before = calls;
  await assert.rejects(client('query', 8, AbortSignal.abort()), {name: 'AbortError'});
  assert.equal(calls, before);
});
