import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';

const bundle = await build({
  entryPoints: [new URL('../src/lib/search-recent-client.ts', import.meta.url).pathname],
  bundle: true, platform: 'node', format: 'esm', write: false,
});
const {loadRecentUpdates} = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));

test('recent metadata is revalidated on every open and a failed request can be retried', async () => {
  const signal = new AbortController().signal;
  let requests = 0;
  const fetcher = async (url, options) => {
    assert.equal(url, '/search/recent.json');
    assert.equal(options.cache, 'no-cache');
    assert.equal(options.signal, signal);
    return ++requests === 1 ? new Response('', {status: 503}) : Response.json([{url: '/posts/example/', title: 'Example'}]);
  };
  await assert.rejects(loadRecentUpdates(signal, fetcher), /unavailable/);
  assert.deepEqual(await loadRecentUpdates(signal, fetcher), [{url: '/posts/example/', title: 'Example'}]);
  assert.deepEqual(await loadRecentUpdates(signal, fetcher), [{url: '/posts/example/', title: 'Example'}]);
  assert.equal(requests, 3);
});

test('recent metadata keeps six safe unique destinations and only public display fields', async () => {
  const payload = [
    {url: 'https://outside.example/posts/no/', title: 'Outside'},
    {url: '//outside.example/posts/no/', title: 'Outside'},
    {url: '/private/hidden/', title: 'Hidden'},
    {url: '/posts/../../private/hidden/', title: 'Escaped'},
    {url: '/posts/blank/', title: ' '},
    {url: '/docs/%E4%B8%AD%E6%96%87/', title: '中文', updated: '2026-09-08T00:00:00Z', section: '文档', source: 'unpublished source path', html: 'Full content'},
    {url: '/docs/%E4%B8%AD%E6%96%87/', title: 'Duplicate'},
    ...Array.from({length: 8}, (_, i) => ({url: `/weekly/${i}/`, title: `Weekly ${i}`})),
  ];
  const entries = await loadRecentUpdates(new AbortController().signal, async () => Response.json(payload));
  assert.equal(entries.length, 6);
  assert.deepEqual(entries[0], {url: '/docs/%E4%B8%AD%E6%96%87/', title: '中文', updated: '2026-09-08T00:00:00Z', section: '文档'});
  assert.equal(entries[5].url, '/weekly/4/');
});

test('a malformed metadata response rejects while an empty recent list is valid', async () => {
  const signal = new AbortController().signal;
  await assert.rejects(loadRecentUpdates(signal, async () => Response.json({error: 'unavailable'})), /must be a list/);
  assert.deepEqual(await loadRecentUpdates(signal, async () => Response.json([])), []);
});
