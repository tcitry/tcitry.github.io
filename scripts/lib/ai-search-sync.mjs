import assert from 'node:assert/strict';
import { MANAGED_PREFIX } from './ai-search-corpus.mjs';

export const CUSTOM_METADATA = [
  { field_name: 'canonical_url', data_type: 'text' },
  { field_name: 'section', data_type: 'text' },
  { field_name: 'updated_at', data_type: 'datetime' },
  { field_name: 'source_kind', data_type: 'text' },
  { field_name: 'content_hash', data_type: 'text' },
];
const managedKey = key => typeof key === 'string' && new RegExp(`^${MANAGED_PREFIX}[a-f0-9]{64}\\.md$`).test(key);
const isManaged = item => item.source_id === 'builtin' && managedKey(item.key);
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

export class AISearchAPIError extends Error {
  constructor(status, code = '') {
    super(`AI Search request failed (HTTP ${status}${code ? `, code ${code}` : ''}).`);
    this.status = status;
  }
}

export function retryDelay(retryAfter, attempt, now = Date.now()) {
  const seconds = Number(retryAfter);
  const parsed = retryAfter && !Number.isFinite(seconds) ? Date.parse(retryAfter) - now : seconds * 1000;
  const suggested = retryAfter && Number.isFinite(parsed) ? Math.max(0, parsed) : 2000 * 2 ** attempt;
  // A very long server cooldown is a stop signal, not permission to retry early.
  return suggested > 60000 ? null : Math.max(1000, suggested);
}

/** 429, 500, 502, 503, 504, and Cloudflare AI Search 7001 Internal Error; still bounded by maxAttempts and Retry-After. */
export function isRetryableAISearchFailure(status, code = '') {
  return [429, 500, 502, 503, 504].includes(Number(status)) || String(code) === '7001';
}

/** One request at a time; callers may inject auth without writing credentials to disk. */
export function createAISearchClient({ accountId, namespace = 'default', instance = 'tcitry-blog-search', token,
  authorize, fetchImpl = fetch, wait = sleep, now = Date.now, intervalMs = 1000, maxAttempts = 4 } = {}) {
  assert.match(accountId ?? '', /^[a-f0-9]{32}$/, 'Set a valid CLOUDFLARE_ACCOUNT_ID');
  assert.match(namespace, /^[a-z0-9_-]{1,64}$/, 'Invalid AI Search namespace');
  assert.match(instance, /^[a-z0-9_-]{1,64}$/, 'Invalid AI Search instance');
  assert.ok(authorize || typeof token === 'string' && token.trim(), 'Set CLOUDFLARE_API_TOKEN with AI Search Edit and Run permissions');
  assert.ok(Number.isInteger(maxAttempts) && maxAttempts >= 1 && maxAttempts <= 4, 'Retry attempts must be between one and four');
  assert.ok(intervalMs >= 0 && intervalMs <= 60000, 'Invalid AI Search request interval');
  const base = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai-search/namespaces/${namespace}/instances/${instance}`;
  let lastRequestAt = -Infinity;

  async function request(endpoint, { method = 'GET', body, allow404 = false, raw = false, beforeRetry = async () => {} } = {}) {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const pause = intervalMs - (now() - lastRequestAt);
      if (pause > 0) await wait(pause);
      if (attempt > 0) await beforeRetry();
      const headers = new Headers(authorize ? await authorize() : { Authorization: `Bearer ${token}` });
      lastRequestAt = now();
      let response;
      try {
        response = await fetchImpl(base + endpoint, { method, headers, body: typeof body === 'function' ? body() : body, redirect: 'error', signal: AbortSignal.timeout(60000) });
      } catch {
        if (attempt + 1 === maxAttempts) throw new AISearchAPIError('network');
        await wait(retryDelay(null, attempt, now()));
        continue;
      }
      if (response.status === 404 && allow404) return null;
      if (isRetryableAISearchFailure(response.status) && attempt + 1 < maxAttempts) {
        const delay = retryDelay(response.headers.get('retry-after'), attempt, now());
        await response.body?.cancel();
        if (delay === null) throw new AISearchAPIError(response.status);
        await wait(delay);
        continue;
      }
      if (raw && response.ok) return response;
      let payload;
      try { payload = await response.json(); } catch { throw new AISearchAPIError(response.status); }
      if (!response.ok || payload.success === false) {
        const code = String(payload.errors?.[0]?.code ?? '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32);
        if (isRetryableAISearchFailure(response.status, code) && attempt + 1 < maxAttempts) {
          const delay = retryDelay(response.headers.get('retry-after'), attempt, now());
          if (delay === null) throw new AISearchAPIError(response.status, code);
          await wait(delay);
          continue;
        }
        throw new AISearchAPIError(response.status, code);
      }
      return payload;
    }
    throw new AISearchAPIError('retry-limit');
  }

  return {
    async listItems() {
      const items = [];
      const ids = new Set();
      let expectedTotal;
      for (let page = 1; page <= 10000; page++) {
        const payload = await request(`/items?source=builtin&sort_by=modified_at&page=${page}&per_page=50`);
        assert.ok(Array.isArray(payload.result), 'AI Search returned an invalid item list');
        const total = payload.result_info?.total_count;
        assert.ok(Number.isInteger(total) && total >= 0, 'AI Search pagination did not provide a total count');
        if (expectedTotal === undefined) expectedTotal = total;
        assert.equal(total, expectedTotal, 'AI Search changed while listing; rerun sync to obtain a complete snapshot');
        for (const item of payload.result) {
          assert.ok(typeof item.id === 'string' && !ids.has(item.id), 'AI Search pagination repeated an item; no changes were made');
          ids.add(item.id);
          items.push(item);
        }
        assert.ok(items.length <= total, 'AI Search returned more items than its pagination total');
        if (items.length === total) return items;
        assert.ok(payload.result.length > 0, 'AI Search pagination ended before all items were returned');
      }
      throw new Error('AI Search pagination limit reached; refusing a partial sync.');
    },
    async upload(document, { beforeRetry } = {}) {
      assert.ok(managedKey(document.key), 'Refusing upload outside the managed article namespace');
      const metadata = { canonical_url: document.url, section: document.section,
        ...(document.updatedAt ? { updated_at: document.updatedAt } : {}),
        source_kind: document.sourceKind, content_hash: document.hash };
      const result = await request('/items', { method: 'POST', beforeRetry, body: () => {
        const form = new FormData();
        form.set('file', new Blob([document.markdown], { type: 'text/markdown; charset=utf-8' }), document.key);
        form.set('metadata', JSON.stringify(metadata));
        form.set('wait_for_completion', 'true');
        return form;
      } });
      assert.equal(result.result?.key, document.key, 'AI Search did not preserve the stable article key');
      assert.equal(result.result?.source_id, 'builtin', 'AI Search uploaded item has an unexpected data source');
      return result.result;
    },
    async getItem(id) {
      assert.ok(typeof id === 'string' && id, 'Invalid AI Search item ID');
      const payload = await request(`/items/${encodeURIComponent(id)}`, { allow404: true });
      return payload?.result ?? null;
    },
    async deleteItem(item, { beforeRetry } = {}) {
      assert.ok(isManaged(item), 'Refusing to delete an unmanaged AI Search item');
      await request(`/items/${encodeURIComponent(item.id)}`, { method: 'DELETE', allow404: true, beforeRetry });
    },
    async getInstance() { return (await request('')).result; },
    wait,
  };
}

export function planSync(documents, remoteItems) {
  const remote = new Map();
  for (const item of remoteItems.filter(isManaged)) {
    assert.ok(!remote.has(item.key), 'AI Search has duplicate managed object keys');
    remote.set(item.key, item);
  }
  const keys = new Set();
  const plan = { uploads: [], waiting: [], unchanged: [], deletes: [] };
  for (const document of documents) {
    assert.ok(managedKey(document.key) && !keys.has(document.key), 'Invalid or duplicate desired article key');
    keys.add(document.key);
    const item = remote.get(document.key);
    if (item?.metadata?.content_hash === document.hash && item.next_action !== 'DELETE') {
      if (item.status === 'completed') { plan.unchanged.push({ document, item }); continue; }
      if (['queued', 'running'].includes(item.status)) { plan.waiting.push({ document, item }); continue; }
    }
    plan.uploads.push({ document, item });
  }
  plan.deletes = [...remote.values()].filter(item => !keys.has(item.key));
  return plan;
}

export function planSummary(plan) {
  return { upload: plan.uploads.length, waiting: plan.waiting.length, unchanged: plan.unchanged.length, delete: plan.deletes.length };
}

export const INDEXING_PENDING_MESSAGE = 'AI Search indexing is still pending; synchronization was not marked complete. Rerun after the current job finishes.';

export async function waitUntilIndexed(client, initial, { attempts = 12, pollMs = 10000 } = {}) {
  let item = initial;
  for (let poll = 0; poll <= attempts; poll++) {
    if (item?.status === 'completed' && item.next_action !== 'DELETE') return item;
    assert.ok(item && ['queued', 'running'].includes(item.status) && item.next_action !== 'DELETE', 'AI Search indexing failed; inspect Items and rerun synchronization after fixing the error');
    if (poll === attempts) break;
    await client.wait(pollMs);
    item = await client.getItem(initial.id);
  }
  throw new Error(INDEXING_PENDING_MESSAGE);
}

function recordIndexed(indexed, document, complete) {
  assert.equal(complete.key, document.key, 'AI Search completed a different article');
  assert.equal(complete.metadata?.content_hash, document.hash, 'AI Search indexed content hash differs from the reviewed article');
  indexed.push({ key: document.key, hash: document.hash, itemId: complete.id });
}

async function waitForSubmittedDocument(client, document, initial, { polling, beforeWrite, onRetryUpload }) {
  try {
    return await waitUntilIndexed(client, initial, polling);
  } catch (error) {
    if (error?.message !== INDEXING_PENDING_MESSAGE) throw error;
    onRetryUpload?.(document);
    await beforeWrite();
    const retried = await client.upload(document, { beforeRetry: beforeWrite });
    try {
      return await waitUntilIndexed(client, retried, polling);
    } catch (retryError) {
      if (retryError?.message !== INDEXING_PENDING_MESSAGE) throw retryError;
      throw new Error(`AI Search indexing is still pending for ${document.url}; synchronization was not marked complete. Rerun after the current job finishes.`);
    }
  }
}

/** Uploads are serialized and indexed before deletions; a failure never returns a completed state. */
export async function applySync(client, plan, { onProgress = () => {}, polling, beforeWrite = async () => {}, onRetryUpload = () => {} } = {}) {
  const indexed = [...plan.unchanged.map(({ document, item }) => ({ key: document.key, hash: document.hash, itemId: item.id }))];
  const total = plan.unchanged.length + plan.waiting.length + plan.uploads.length;
  const pending = [];
  // Submit every new/changed article before polling any of them. A single
  // queued/running item must not keep the rest of the corpus unsent.
  for (const { document } of plan.uploads) {
    await beforeWrite();
    const uploaded = await client.upload(document, { beforeRetry: beforeWrite });
    if (uploaded?.status === 'completed' && uploaded.next_action !== 'DELETE') {
      recordIndexed(indexed, document, uploaded);
      onProgress({ indexed: indexed.length, total });
    } else {
      pending.push({ document, item: uploaded });
    }
  }
  pending.push(...plan.waiting);
  for (const { document, item } of pending) {
    const complete = await waitForSubmittedDocument(client, document, item, { polling, beforeWrite, onRetryUpload });
    recordIndexed(indexed, document, complete);
    onProgress({ indexed: indexed.length, total });
  }
  for (const item of plan.deletes) {
    await beforeWrite();
    await client.deleteItem(item, { beforeRetry: beforeWrite });
  }
  // Delete can be asynchronous. Do not claim success while a withdrawn item remains.
  if (plan.deletes.length) {
    const pending = new Map(plan.deletes.map(item => [item.id, item]));
    const attempts = polling?.attempts ?? 12;
    for (let poll = 0; poll <= attempts && pending.size; poll++) {
      for (const [id] of pending) if (!await client.getItem(id)) pending.delete(id);
      if (!pending.size) break;
      if (poll === attempts) throw new Error('AI Search deletions are still pending; synchronization was not marked complete.');
      await client.wait(polling?.pollMs ?? 10000);
    }
  }
  return { documents: indexed.sort((a, b) => a.key.localeCompare(b.key)), deleted: plan.deletes.length };
}

export function assertInstanceConfiguration(instance) {
  assert.ok(instance && typeof instance === 'object', 'Could not read AI Search instance configuration');
  assert.equal(instance.ai_gateway_id, 'tcitry-blog-chat', 'AI Search must remain connected to the tcitry-blog-chat Gateway');
  const metadata = instance.custom_metadata;
  assert.ok(Array.isArray(metadata), 'Configure the five AI Search custom metadata fields before synchronizing');
  for (const field of CUSTOM_METADATA) assert.ok(metadata.some(item => item.field_name?.toLowerCase() === field.field_name && item.data_type === field.data_type), `AI Search metadata field is missing or has the wrong type: ${field.field_name}`);
}
