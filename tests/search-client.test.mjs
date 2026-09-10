import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';

const bundle = await build({
  entryPoints: [new URL('../src/lib/search-client.ts', import.meta.url).pathname],
  bundle: true, platform: 'node', format: 'esm', write: false,
});
const {createSearchClient, createConfiguredSearchClient} = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const origin = 'https://example.com';
const result = (url, title = 'Article', excerpt = 'A body-only match.', more = {}) => ({
  data: async () => ({url, meta: {title}, plain_excerpt: excerpt, ...more}),
});

test('search stays unloaded for an empty query and fetches only the visible result fragments', async () => {
  let loads = 0;
  const fetched = [];
  const queries = [];
  const client = createSearchClient(async () => {
    loads++;
    return {search: async (query) => {
      queries.push(query);
      return {results: Array.from({length: 12}, (_, index) => ({data: async () => {
        fetched.push(index);
        return {url: `/posts/${index}/`, meta: {title: `Article ${index}`}, plain_excerpt: 'Search matches the body.'};
      }}))};
    }};
  }, origin);
  assert.deepEqual(await client('  '), {results: [], total: 0});
  assert.equal(loads, 0);
  const first = await client('  body  ');
  assert.equal(first.total, 12);
  assert.equal(first.results.length, 8);
  assert.deepEqual(fetched, [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.equal((await client('body', 16)).results.length, 12);
  assert.deepEqual(queries, ['body', 'body']);
  assert.equal(loads, 1);
});

test('search retains body matches, ranking and encoded URLs while emitting only display metadata', async () => {
  const client = createSearchClient(async () => ({search: async () => ({results: [
    result('/docs/%E6%96%87%E6%A1%A3/#section', '  First title  ', 'Keyword appears here.', {source: 'unpublished source path', content: 'full text', meta: {title: '  First title  ', secret: 'extra metadata'}}),
    result('/posts/second/', 'Second title'),
  ]})}), origin);
  const response = await client('Keyword');
  assert.deepEqual(response.results, [
    {url: '/docs/%E6%96%87%E6%A1%A3/#section', title: 'First title', excerpt: 'Keyword appears here.', section: '文档'},
    {url: '/posts/second/', title: 'Second title', excerpt: 'A body-only match.', section: '文章'},
  ]);
});

test('search rejects non-site and unsupported destinations and deduplicates result URLs', async () => {
  const client = createSearchClient(async () => ({search: async () => ({results: [
    result('/posts/valid/'), result('/posts/valid/'), result('https://elsewhere.example/posts/external/'),
    result('javascript:alert(1)'), result('//elsewhere.example/posts/external/'),
    result('/private/hidden/'), result('/posts/blank/', '  '), result('https://user:password@example.com/posts/credential/'),
    result('/weekly/valid/'),
  ]})}), origin);
  assert.deepEqual((await client('query', 16)).results.map((entry) => entry.url), ['/posts/valid/', '/weekly/valid/']);
});

test('a failed index load can be retried without reloading the page', async () => {
  let loads = 0;
  const client = createSearchClient(async () => {
    if (++loads === 1) throw new Error('Index unavailable');
    return {search: async () => ({results: [result('/posts/recovered/')]})};
  }, origin);
  await assert.rejects(client('first'), /Index unavailable/);
  assert.equal((await client('second')).results[0].url, '/posts/recovered/');
  assert.equal(loads, 2);
});

test('a cached fragment failure is cleared before retrying the same search', async () => {
  let fragment;
  let downloads = 0;
  let resets = 0;
  const engine = {
    search: async () => ({results: [{data: () => fragment ??= ++downloads === 1
      ? Promise.reject(new Error('Fragment temporarily unavailable'))
      : result('/posts/recovered/').data()}]}),
    destroy: async () => { resets++; fragment = undefined; },
  };
  const client = createSearchClient(async () => engine, origin);
  await assert.rejects(client('same query'), /Fragment temporarily unavailable/);
  assert.equal((await client('same query')).results[0].url, '/posts/recovered/');
  assert.equal(downloads, 2);
  assert.equal(resets, 1);
});

test('a late failed query cannot reset the engine after a newer successful query', async () => {
  let rejectOld;
  let resets = 0;
  const engine = {
    search: (query) => query === 'old' ? new Promise((_, reject) => { rejectOld = reject; })
      : Promise.resolve({results: [result('/posts/new/')]}),
    destroy: () => { resets++; },
  };
  const client = createSearchClient(async () => engine, origin);
  const old = client('old');
  await client('new');
  rejectOld(new Error('Old request failed'));
  await assert.rejects(old, /Old request failed/);
  assert.equal(resets, 0);
});

test('unconfigured local previews use Pagefind but missing production or invalid configuration remains an error', async () => {
  let loads = 0;
  const loadPagefind = async () => { loads++; return {search: async () => ({results: [result('/docs/page/')]})}; };
  const options = {siteOrigin: origin, localOrigin: 'http://127.0.0.1:4321', production: false, loadPagefind};
  const local = await createConfiguredSearchClient(options)('query');
  assert.equal(local.total, 1);
  assert.equal(local.engine, 'pagefind');
  assert.equal(loads, 1);
  for (const overrides of [{production: true}, {localOrigin: origin}]) {
    await assert.rejects(createConfiguredSearchClient({...options, ...overrides})('query'), /not configured/);
  }
  assert.throws(() => createConfiguredSearchClient({...options, endpoint: 'https://evil.example/search'}), /invalid/);
  assert.equal(loads, 1);
});

const endpoint = 'https://fixture.search.ai.cloudflare.com/search';
const references = Array.from({length: 12}, (_, index) => ({
  key: `tcitry-blog/articles/${String(index).padStart(64, '0')}.md`, hash: 'a'.repeat(64),
  url: `${origin}/docs/ai-${index}/`, title: `AI article ${index}`, section: 'docs',
}));
const successfulAI = () => Response.json({success: true, result: {chunks: references.map(reference => ({
  score: 0.8, text: 'AI retrieved passage.', item: {key: reference.key, metadata: {content_hash: reference.hash, canonical_url: reference.url}},
}))}});
function configuredFixture(search, extra = {}) {
  const calls = {requests: [], pagefind: [], loads: 0};
  const client = createConfiguredSearchClient({endpoint, siteOrigin: origin, localOrigin: origin, production: true,
    loadPagefind: async () => {
      calls.loads++;
      return {search: async query => {
        calls.pagefind.push(query);
        return {results: Array.from({length: 12}, (_, index) => result(`/docs/fulltext-${index}/`, `Full-text article ${index}`))};
      }};
    },
    fetcher: async (url, options) => {
      calls.requests.push({url, options});
      return url === endpoint ? search(JSON.parse(options.body).query, options) : Response.json({documents: references});
    }, ...extra,
  });
  return {client, calls};
}

test('healthy configured AI pagination never loads full-text search or sends credentials', async () => {
  const {client, calls} = configuredFixture(successfulAI);
  const first = await client('healthy');
  assert.equal(first.results.length, 8);
  assert.equal(first.total, 12);
  assert.equal(first.engine, 'ai-search');
  assert.equal(first.fallback, undefined);
  assert.equal((await client('healthy', 16)).results.length, 12);
  assert.equal(calls.requests.filter(call => call.url === endpoint).length, 1);
  assert.equal(calls.loads, 0);
  for (const {options} of calls.requests) {
    assert.equal(options.credentials, 'omit');
    assert.equal(new Headers(options.headers).has('Authorization'), false);
    assert.equal(new Headers(options.headers).has('Cookie'), false);
  }
});

test('only temporary HTTP and network failures activate the explicitly marked full-text fallback', async () => {
  for (const status of [429, 500, 502, 503, 504, 'network']) {
    const {client, calls} = configuredFixture(() => {
      if (status === 'network') throw new TypeError('Failed to fetch');
      return new Response('', {status});
    });
    const response = await client(`failure-${status}`);
    assert.equal(response.fallback, 'ai-unavailable', String(status));
    assert.equal(response.engine, 'pagefind', String(status));
    assert.equal(response.results.length, 8);
    assert.equal(response.total, 12);
    assert.ok(response.results.every(entry => entry.title.startsWith('Full-text article')));
    assert.equal(calls.loads, 1);
    assert.deepEqual(calls.pagefind, [`failure-${status}`]);
  }
});

test('request and protocol failures remain visible and never activate fallback', async () => {
  for (const status of [400, 401, 403, 404, 'invalid-json', 'invalid-envelope']) {
    const {client, calls} = configuredFixture(() => status === 'invalid-json'
      ? new Response('{broken', {headers: {'Content-Type': 'application/json'}})
      : status === 'invalid-envelope' ? Response.json({success: true, result: {}}) : new Response('', {status}));
    await assert.rejects(client('query'));
    assert.equal(calls.loads, 0, String(status));
  }
});

test('fallback pagination remains full-text until explicit first-page retry restores AI', async () => {
  let outage = true;
  const {client, calls} = configuredFixture(() => outage ? new Response('', {status: 503}) : successfulAI());
  assert.equal((await client('same query')).fallback, 'ai-unavailable');
  outage = false;
  const more = await client('same query', 16);
  assert.equal(more.fallback, 'ai-unavailable');
  assert.equal(more.engine, 'pagefind');
  assert.equal(more.results.length, 12);
  assert.equal(calls.requests.filter(call => call.url === endpoint).length, 1, 'Loading more never mixes a recovered AI page into full-text results');
  const retry = await client('same query', 8);
  assert.equal(retry.fallback, undefined);
  assert.equal(retry.engine, 'ai-search');
  assert.equal(retry.results.length, 8);
  assert.ok(retry.results.every(entry => entry.title.startsWith('AI article')));
  assert.equal((await client('same query', 16)).results.length, 12);
  assert.deepEqual(calls.pagefind, ['same query', 'same query']);
  assert.equal(calls.requests.filter(call => call.url === endpoint).length, 2);
});

test('a new query retries AI instead of inheriting the previous fallback engine', async () => {
  const {client, calls} = configuredFixture(query => query === 'old' ? new Response('', {status: 500}) : successfulAI());
  assert.equal((await client('old')).fallback, 'ai-unavailable');
  assert.equal((await client('new')).fallback, undefined);
  assert.deepEqual(calls.pagefind, ['old']);
});

test('timeouts fall back, but caller cancellation and superseded transport failures do not', async () => {
  const timed = configuredFixture((_query, options) => new Promise((_, reject) => {
    options.signal.addEventListener('abort', () => reject(options.signal.reason), {once: true});
  }), {timeoutMs: 5});
  assert.equal((await timed.client('timeout')).fallback, 'ai-unavailable');
  assert.deepEqual(timed.calls.pagefind, ['timeout']);
  for (const cancel of [true, false]) {
    let finishOld;
    let markReady;
    const ready = new Promise(resolve => {markReady = resolve;});
    const {client, calls} = configuredFixture(query => {
      if (query !== 'old') return successfulAI();
      markReady();
      return new Promise(resolve => {finishOld = () => resolve(new Response('', {status: 503}));});
    });
    const controller = new AbortController();
    const old = client('old', 8, controller.signal);
    await ready;
    if (cancel) controller.abort();
    await client('latest');
    finishOld();
    await assert.rejects(old, {name: 'AbortError'});
    assert.equal(calls.loads, 0, cancel ? 'Cancelled failures cannot activate fallback' : 'A superseded query cannot activate fallback even without a caller signal');
    assert.equal((await client('latest', 16)).fallback, undefined);
    assert.equal(calls.requests.filter(call => call.url === endpoint).length, 2, 'Late failures cannot replace the latest AI pagination cache');
  }
  const neverStarted = configuredFixture(successfulAI);
  await assert.rejects(neverStarted.client('cancelled', 8, AbortSignal.abort()), {name: 'AbortError'});
  assert.equal(neverStarted.calls.requests.length, 0);
  assert.equal(neverStarted.calls.loads, 0);
});
