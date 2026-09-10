import assert from 'node:assert/strict';
import { readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertSealedRelease } from './release-manifest.mjs';
import { sha256 } from './lib/ai-search-corpus.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const receipt = path.join(root, '.generated/deployment.json');
try {
  await rm(receipt, { force: true });
  const bytes = await readFile(path.join(root, '.generated/release.json'));
  const release = JSON.parse(bytes);
  await assertSealedRelease(root, release);
  const local = JSON.parse(await readFile(path.join(root, 'dist/blog-release.json'), 'utf8'));
  assert.equal(local.siteCommit, release.siteCommit, 'Published marker must match the sealed site revision');
  assert.equal(local.contentCommit, release.contentCommit, 'Published marker must match the sealed content revision');
  assert.equal(local.corpusHash, release.aiSearch.corpusHash, 'Published marker must match the sealed article corpus');
  const response = await fetch(`https://yindongliang.com/blog-release.json?verify=${release.siteCommit}`, { cache: 'no-store', signal: AbortSignal.timeout(15_000) });
  assert.ok(response.ok && !response.redirected, 'Production release marker is not available');
  assert.deepEqual(await response.json(), local, 'Production has not switched to this reviewed release; retry online verification before syncing');
  for (const endpoint of ['/api/chat', '/api/internal/retrieve']) {
    const response = await fetch(`https://yindongliang.com${endpoint}`, { method: 'GET', signal: AbortSignal.timeout(15_000) });
    assert.equal(response.status, 404, `Removed legacy API is still available: ${endpoint}`);
  }
  await writeFile(receipt, JSON.stringify({ version: 1, environment: 'production', releaseHash: sha256(bytes), verifiedAt: new Date().toISOString() }, null, 2) + '\n');
  console.log('Production revision and retired API routes verified; article synchronization may proceed.');
} catch (error) {
  console.error(error instanceof assert.AssertionError ? error.message.split('\n')[0] : 'Online verification failed; no AI Search sync is authorized for this release. Retry npm run verify:deployment.');
  process.exitCode = 1;
}
