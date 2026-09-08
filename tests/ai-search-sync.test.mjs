import assert from 'node:assert/strict';
import test from 'node:test';
import { createCorpus } from '../scripts/lib/ai-search-corpus.mjs';
import { applySync, createAISearchClient, planSync, retryDelay, assertInstanceConfiguration, CUSTOM_METADATA } from '../scripts/lib/ai-search-sync.mjs';

const documents = createCorpus(['one', 'two'].map(slug => ({ kind: 'page', type: 'posts', url: `/posts/${slug}/`, title: slug, html: '<p>hello</p>', date: '2026-09-01', tags: [] }))).documents;
const item = (document, extra = {}) => ({ id: document.id, key: document.key, source_id: 'builtin', status: 'completed', next_action: 'INDEX', metadata: { content_hash: document.hash }, ...extra });
const ok = result => new Response(JSON.stringify({ success: true, result }), { headers: { 'content-type': 'application/json' } });
const options = { accountId: 'a'.repeat(32), token: 'test-only-secret', intervalMs: 0, wait: async () => {} };

test('remote plan handles updates and withdrawals only inside the managed builtin namespace', () => {
  const [first, second] = documents;
  const remote = [item(first), item(second), { ...item(second), id: 'manual', key: 'manual.md' }, { ...item(second), id: 'external', source_id: 'r2:other' }];
  const plan = planSync([first], remote);
  assert.equal(plan.unchanged.length, 1);
  assert.equal(plan.deletes.length, 1);
  assert.equal(plan.deletes[0].id, second.id);
  assert.equal(planSync([{ ...first, hash: 'changed' }], remote).uploads.length, 1);
  assert.equal(planSync([first], [item(first, { status: 'running' })]).waiting.length, 1);
  assert.equal(planSync([first], [item(first, { status: 'error' })]).uploads.length, 1);
  assert.equal(planSync([first], [item(first, { next_action: 'DELETE' })]).uploads.length, 1);
});

test('list follows all pages and refuses inconsistent snapshots before planning deletion', async () => {
  const pages = [];
  const client = createAISearchClient({ ...options, fetchImpl: async url => {
    const parsed = new URL(url);
    const page = Number(parsed.searchParams.get('page'));
    pages.push(page);
    assert.equal(parsed.searchParams.get('source'), 'builtin');
    assert.equal(parsed.searchParams.get('per_page'), '50');
    return new Response(JSON.stringify({ success: true, result: [item(documents[page - 1])], result_info: { total_count: 2, page } }));
  } });
  assert.equal((await client.listItems()).length, 2);
  assert.deepEqual(pages, [1, 2]);
  let calls = 0;
  const broken = createAISearchClient({ ...options, fetchImpl: async () => new Response(JSON.stringify({ success: true, result: [item(documents[0])], result_info: { total_count: ++calls === 1 ? 2 : 3 } })) });
  await assert.rejects(broken.listItems(), /changed while listing/);
});

test('429 honors bounded Retry-After and masks provider messages and credentials', async () => {
  const delays = [];
  let calls = 0;
  const client = createAISearchClient({ ...options, wait: async delay => delays.push(delay), fetchImpl: async () => {
    if (++calls < 3) return new Response('rate limited', { status: 429, headers: { 'Retry-After': '3' } });
    return ok(item(documents[0]));
  } });
  assert.equal((await client.getItem('id')).status, 'completed');
  assert.deepEqual(delays, [3000, 3000]);
  const failure = createAISearchClient({ ...options, fetchImpl: async () => new Response(JSON.stringify({ errors: [{ code: 1001, message: 'test-only-secret' }] }), { status: 429 }) });
  await assert.rejects(failure.getItem('id'), error => !error.message.includes('test-only-secret') && /429/.test(error.message));
  assert.equal(retryDelay('120', 0), null);
  assert.equal(retryDelay('invalid', 2), 8000);
  assert.equal(retryDelay('Thu, 01 Jan 1970 00:00:04 GMT', 0, 1000), 3000);
});

test('uploads carry only five declared fields with a stable filename and fresh retry bodies', async () => {
  const [document] = documents;
  let body;
  const client = createAISearchClient({ ...options, fetchImpl: async (url, init) => {
    assert.ok(url.endsWith('/items'));
    assert.equal(init.method, 'POST');
    assert.equal(init.redirect, 'error');
    body = init.body;
    return ok(item(document));
  } });
  await client.upload(document);
  assert.equal(body.get('file').name, document.key);
  assert.equal(await body.get('file').text(), document.markdown);
  assert.equal(body.get('wait_for_completion'), 'true');
  assert.deepEqual(Object.keys(JSON.parse(body.get('metadata'))).sort(), CUSTOM_METADATA.map(field => field.field_name).sort());
  assertInstanceConfiguration({ ai_gateway_id: 'tcitry-blog-chat', custom_metadata: CUSTOM_METADATA });
  assert.throws(() => assertInstanceConfiguration({ ai_gateway_id: 'another-gateway', custom_metadata: CUSTOM_METADATA }), /tcitry-blog-chat Gateway/);
  assert.throws(() => assertInstanceConfiguration({ ai_gateway_id: 'tcitry-blog-chat', custom_metadata: CUSTOM_METADATA.slice(1) }), /canonical_url/);
});

test('failed or pending indexing prevents deletions and does not return completed state', async () => {
  const [first, second] = documents;
  let deleted = 0;
  const client = { upload: async document => item(document, { status: 'error' }), deleteItem: async () => deleted++, wait: async () => {} };
  await assert.rejects(applySync(client, planSync([first], [item(second)])), /indexing failed/);
  assert.equal(deleted, 0);
  client.upload = async document => item(document, { status: 'running' });
  client.getItem = async () => item(first, { status: 'running' });
  await assert.rejects(applySync(client, planSync([first], [item(second)]), { polling: { attempts: 1, pollMs: 0 } }), /still pending/);
  assert.equal(deleted, 0);
});

test('successful sync waits for indexing then confirms removed items disappear', async () => {
  const [first, second] = documents;
  const calls = [];
  const client = {
    upload: async document => { calls.push('upload'); return item(document, { status: 'running' }); },
    getItem: async id => { calls.push('get'); return id === first.id ? item(first) : null; },
    deleteItem: async () => calls.push('delete'), wait: async () => {},
  };
  const result = await applySync(client, planSync([first], [item(second)]));
  assert.equal(result.documents.length, 1);
  assert.equal(result.deleted, 1);
  assert.deepEqual(calls, ['upload', 'get', 'delete', 'get']);
});
