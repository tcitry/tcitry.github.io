import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';

const bundle = await build({
  entryPoints: [new URL('../src/lib/search-client.ts', import.meta.url).pathname],
  bundle: true, platform: 'node', format: 'esm', write: false,
});
const {createSearchClient} = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));
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
