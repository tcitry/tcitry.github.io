import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { SITE_ORIGIN } from './ai-search-corpus.mjs';

/** A local receipt is historical evidence; every sync write also needs current publication evidence. */
export async function assertPublishedCorpus(manifest, { fetchImpl = fetch } = {}) {
  assert.equal(manifest.environment, 'production', 'Only production corpus markers may authorize synchronization');
  const expected = { version: 1, ...manifest.revision, corpusHash: manifest.corpusHash, environment: 'production' };
  let response;
  try {
    response = await fetchImpl(`${SITE_ORIGIN}/blog-release.json?verify=sync-${randomUUID()}`, {
      cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15000), headers: { 'cache-control': 'no-cache' },
    });
  } catch { throw new Error('AI Search sync could not verify the current production release; no further writes are allowed.'); }
  assert.ok(response.ok && !response.redirected, 'AI Search sync requires an available production release marker');
  let marker;
  try { marker = await response.json(); } catch { throw new Error('AI Search sync received an invalid production release marker.'); }
  assert.deepEqual(marker, expected, 'AI Search sync source is no longer the current production release; stop this old release and use the current deployment');
}
