import assert from 'node:assert/strict';
import { readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { assertSealedRelease } from './release-manifest.mjs';
import { assertCorpusRelease, jsonBytes, readCorpus, sha256 } from './lib/ai-search-corpus.mjs';
import { assertPublishedCorpus } from './lib/ai-search-published.mjs';
import { AISearchAPIError, AISearchPartialError, createAISearchClient, planSync, planSummary, applySync, assertInstanceConfiguration } from './lib/ai-search-sync.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
export const DEFAULT_BEST_EFFORT_BUDGET_MS = 8 * 60 * 1000;
export const MIN_BEST_EFFORT_BUDGET_MS = 30_000;
export const MAX_BEST_EFFORT_BUDGET_MS = 30 * 60 * 1000;
export const SYNC_USAGE = 'Usage: npm run ai-search:sync -- [--dry-run | --apply] [--best-effort]';

export function parseBestEffortBudgetMs(value, fallback = DEFAULT_BEST_EFFORT_BUDGET_MS) {
  if (value == null || value === '') return fallback;
  const parsed = Number(value);
  assert.ok(Number.isInteger(parsed) && parsed >= MIN_BEST_EFFORT_BUDGET_MS && parsed <= MAX_BEST_EFFORT_BUDGET_MS,
    `AI_SEARCH_SYNC_BUDGET_MS must be an integer between ${MIN_BEST_EFFORT_BUDGET_MS} and ${MAX_BEST_EFFORT_BUDGET_MS}`);
  return parsed;
}

/** Embedders may supply a client using an explicitly authorized credential provider. */
export async function syncAISearch({ apply = false, bestEffort = false, client, directory = root, log = console.log, fetchImpl = fetch, now = Date.now } = {}) {
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
  const budgetMs = apply && bestEffort ? parseBestEffortBudgetMs(process.env.AI_SEARCH_SYNC_BUDGET_MS) : undefined;
  const deadlineAt = budgetMs == null ? undefined : now() + budgetMs;
  log(`AI Search ${apply ? 'verified sync' : 'dry run'}: ${JSON.stringify(planSummary(plan))}${bestEffort ? `; best-effort budget ${budgetMs}ms` : ''}.`);
  if (!apply) return { localOnly: false, ...planSummary(plan) };
  const beforeWrite = () => assertPublishedCorpus(corpus.manifest, { fetchImpl });
  await beforeWrite();
  const result = await applySync(client, plan, {
    beforeWrite,
    deadlineAt,
    now,
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
  const args = process.argv.slice(2);
  try {
    const apply = args.includes('--apply');
    const dryRun = args.includes('--dry-run');
    const bestEffort = args.includes('--best-effort');
    assert.ok(args.every(arg => ['--apply', '--dry-run', '--best-effort'].includes(arg)) && !(apply && dryRun) && (!bestEffort || apply), SYNC_USAGE);
    await syncAISearch({ apply, bestEffort });
  } catch (error) {
    if (error instanceof AISearchPartialError && args.includes('--best-effort')) {
      console.warn(`WARNING: ${error.message}`);
    } else {
      const known = error instanceof assert.AssertionError || error instanceof AISearchAPIError || error.message?.startsWith('AI Search');
      console.error(known ? error.message.split('\n')[0] : 'AI Search sync failed; verify the sealed production release, deployment receipt, and API credentials. No completion state was written.');
      process.exitCode = 1;
    }
  }
}
