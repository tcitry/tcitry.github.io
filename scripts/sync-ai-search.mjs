import assert from 'node:assert/strict';
import { readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { assertSealedRelease } from './release-manifest.mjs';
import { assertCorpusRelease, jsonBytes, readCorpus, sha256 } from './lib/ai-search-corpus.mjs';
import { assertPublishedCorpus } from './lib/ai-search-published.mjs';
import { AISearchAPIError, createAISearchClient, planSync, planSummary, applySync, assertInstanceConfiguration } from './lib/ai-search-sync.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));

/** Embedders may supply a client using an explicitly authorized credential provider. */
export async function syncAISearch({ apply = false, client, directory = root, log = console.log, fetchImpl = fetch } = {}) {
  let corpus = await readCorpus(path.join(directory, '.generated/ai-search'));
  if (apply) {
    const releaseBytes = await readFile(path.join(directory, '.generated/release.json'));
    const release = JSON.parse(releaseBytes);
    await assertSealedRelease(directory, release);
    corpus = await assertCorpusRelease(directory, release);
    assert.deepEqual(release.aiSearch, corpus.seal, 'AI Search corpus was not sealed with this production release');
    const deployment = JSON.parse(await readFile(path.join(directory, '.generated/deployment.json'), 'utf8'));
    assert.equal(deployment.version, 1, 'A verified production deployment receipt is required before synchronization');
    assert.equal(deployment.environment, 'production', 'Only published production articles may be synchronized');
    assert.equal(deployment.releaseHash, sha256(releaseBytes), 'Deployment receipt belongs to a different release');
    assert.ok(Number.isFinite(Date.parse(deployment.verifiedAt)), 'Deployment must pass online verification before synchronization');
    assert.ok(corpus.documents.length, 'Refusing to replace the article corpus with an empty export');
  }
  if (!client) {
    if (!process.env.CLOUDFLARE_API_TOKEN || !process.env.CLOUDFLARE_ACCOUNT_ID) {
      assert.ok(!apply, 'Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN to apply the verified sync');
      log(`AI Search local dry run: ${corpus.documents.length} exported articles. Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN for a read-only remote diff.`);
      return { localOnly: true, count: corpus.documents.length };
    }
    client = createAISearchClient({ accountId: process.env.CLOUDFLARE_ACCOUNT_ID, token: process.env.CLOUDFLARE_API_TOKEN });
  }
  const instance = await client.getInstance();
  assertInstanceConfiguration(instance);
  const plan = planSync(corpus.documents, await client.listItems());
  log(`AI Search ${apply ? 'verified sync' : 'dry run'}: ${JSON.stringify(planSummary(plan))}.`);
  if (!apply) return { localOnly: false, ...planSummary(plan) };
  const beforeWrite = () => assertPublishedCorpus(corpus.manifest, { fetchImpl });
  await beforeWrite();
  const result = await applySync(client, plan, {
    beforeWrite,
    onProgress: ({ indexed, total }) => log(`AI Search indexed ${indexed}/${total} public articles.`),
    onRetryUpload: document => log(`AI Search indexing still pending for ${document.url}; retrying that article once.`),
  });
  await beforeWrite();
  const state = { version: 1, instance: 'tcitry-blog-search', gateway: 'tcitry-blog-chat', revision: corpus.manifest.revision,
    corpusHash: corpus.manifest.corpusHash, completedAt: new Date().toISOString(), ...result };
  const filename = path.join(directory, '.generated/ai-search-sync.json');
  await writeFile(filename + '.tmp', jsonBytes(state));
  await rename(filename + '.tmp', filename);
  log(`AI Search sync completed: ${result.documents.length} indexed articles; ${result.deleted} withdrawn items removed.`);
  return state;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2);
    assert.ok(args.every(arg => ['--apply', '--dry-run'].includes(arg)) && !(args.includes('--apply') && args.includes('--dry-run')), 'Usage: npm run ai-search:sync -- [--dry-run | --apply]');
    await syncAISearch({ apply: args.includes('--apply') });
  } catch (error) {
    const known = error instanceof assert.AssertionError || error instanceof AISearchAPIError || error.message?.startsWith('AI Search');
    console.error(known ? error.message.split('\n')[0] : 'AI Search sync failed; verify the sealed production release, deployment receipt, and API credentials. No completion state was written.');
    process.exitCode = 1;
  }
}
