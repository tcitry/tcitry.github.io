import assert from 'node:assert/strict';
import test from 'node:test';
import {handleRetrieval} from '../worker/retrieval.mjs';

const secret = 'test-only-bridge-secret-with-at-least-32-characters';
const document = {key: 'article.md', hash: 'published-hash', title: '公开文章', url: 'https://yindongliang.com/docs/article/', sourceKind: 'author'};
const references = {documents: [document]};
const request = (body = {query: '契约测试'}, token = secret, extra = {}) => new Request('https://example.test/api/internal/retrieve', {
  method: 'POST', headers: {'content-type': 'application/json', authorization: `Bearer ${token}`}, body: JSON.stringify(body), ...extra,
});

test('retrieval bridge requires its own strong secret and never accepts a Clerk token', async () => {
  let called = false;
  const BLOG_SEARCH = {search() { called = true; throw new Error('must not call'); }};
  for (const token of ['', 'clerk-session-jwt', `${secret}x`, 'x'.repeat(secret.length)]) {
    assert.equal((await handleRetrieval(request({}, token), {RAG_BRIDGE_SECRET: secret, BLOG_SEARCH}, references)).status, 401);
  }
  assert.equal((await handleRetrieval(request(), {RAG_BRIDGE_SECRET: 'short', BLOG_SEARCH}, references)).status, 503);
  assert.equal(called, false);
});

test('retrieval validates method, shape, MIME and both declared and streamed body size', async () => {
  const env = {RAG_BRIDGE_SECRET: secret, BLOG_SEARCH: {search() { throw new Error('must not call'); }}};
  assert.equal((await handleRetrieval(new Request('https://example.test'), env, references)).status, 405);
  for (const body of [{query: ''}, {query: 'x'.repeat(2001)}, {query: 'ok', userId: 'other'}, {query: '\u0000'}, []]) {
    assert.equal((await handleRetrieval(request(body), env, references)).status, 400);
  }
  assert.equal((await handleRetrieval(request({query: 'x'.repeat(17000)}), env, references)).status, 413);
  assert.equal((await handleRetrieval(request({}, secret, {headers: {'content-type': 'text/plain', authorization: `Bearer ${secret}`}}), env, references)).status, 415);
});

test('retrieval returns only current published key and matching hash, ignoring provider citation metadata', async () => {
  let query;
  const env = {RAG_BRIDGE_SECRET: secret, BLOG_SEARCH: {async search(input) {
    query = input;
    return {chunks: [
      {item: {key: document.key, metadata: {content_hash: 'stale'}}, score: 0.9, text: 'withdrawn version'},
      {item: {key: 'private.md', metadata: {content_hash: 'published-hash'}}, score: 0.9, text: 'private content'},
      {item: {key: document.key, metadata: {content_hash: document.hash, canonical_url: 'https://attacker.test/'}}, score: 0.8, text: '公开内容'},
    ]};
  }}};
  const response = await handleRetrieval(request(), env, references);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const body = await response.json();
  assert.equal(body.sources.length, 1);
  assert.equal(body.sources[0].url, document.url);
  assert.deepEqual(body.snippets.map(item => item.text), ['公开内容']);
  assert.equal(query.query, '契约测试');
  assert.equal(query.ai_search_options.cache.enabled, false);
});

test('empty retrieval is an explicit empty result, and provider failures never disclose their body', async () => {
  assert.deepEqual(await (await handleRetrieval(request(), {RAG_BRIDGE_SECRET: secret, BLOG_SEARCH: {search: async () => ({chunks: []})}}, references)).json(), {sources: [], snippets: []});
  const result = await handleRetrieval(request(), {RAG_BRIDGE_SECRET: secret, BLOG_SEARCH: {search: async () => {throw Object.assign(new Error(secret), {status: 429});}}}, references);
  assert.equal(result.status, 429);
  assert.ok(!(await result.text()).includes(secret));
});
