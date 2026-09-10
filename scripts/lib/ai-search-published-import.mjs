import assert from 'node:assert/strict';
import { open, readFile, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { readCorpus, sha256, SITE_ORIGIN } from './ai-search-corpus.mjs';

const fileState = async filename => {
  const value = await stat(filename, { bigint: true });
  return { size: value.size, mtime: value.mtimeNs, ctime: value.ctimeNs, inode: value.ino };
};

/** All sources participate: a same-key manual/external item must not be overwritten. */
async function listImportItemsOnce(binding) {
  const items = [];
  const seen = new Set();
  let expected;
  for (let page = 1; page <= 10000; page++) {
    const payload = await binding.items.list({ page, per_page: 50, sort_by: 'modified_at' });
    const count = payload?.result_info?.total_count;
    assert.ok(Array.isArray(payload?.result) && Number.isInteger(count) && count >= 0,
      'AI Search bootstrap requires a complete item list');
    expected ??= count;
    assert.equal(count, expected, 'AI Search bootstrap items changed while listing; stop other importers and retry');
    for (const item of payload.result) {
      assert.ok(typeof item.id === 'string' && item.id && typeof item.key === 'string' && !seen.has(item.id),
        'AI Search bootstrap item pagination is inconsistent');
      seen.add(item.id);
      items.push(item);
    }
    assert.ok(items.length <= expected, 'AI Search bootstrap item count is inconsistent');
    if (items.length === expected) return items;
    assert.ok(payload.result.length, 'AI Search bootstrap item list is incomplete');
  }
  throw new Error('AI Search bootstrap refused an incomplete remote list');
}

export async function listImportItems(binding, { wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)) } = {}) {
  for (let attempt = 0; ; attempt++) {
    try { return await listImportItemsOnce(binding); }
    catch (error) {
      // Indexing can reorder modified_at between pages. Retry the entire read,
      // never merge partial pages or proceed with missing/duplicated items.
      if (!(error instanceof assert.AssertionError) || attempt >= 2) throw error;
      await wait(1000);
    }
  }
}

function metadata(document) {
  return { canonical_url: document.url, section: document.section, updated_at: document.updatedAt,
    source_kind: document.sourceKind, content_hash: document.hash };
}

function metadataMatches(actual, document) {
  const rfc3339 = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;
  const timestampOf = value => {
    if (typeof value !== 'string' || !rfc3339.test(value)) return NaN;
    const [year, month, day] = value.slice(0, 10).split('-').map(Number);
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    if (day > [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]) return NaN;
    return Date.parse(value);
  };
  return Object.entries(metadata(document)).every(([key, value]) => {
    if (key !== 'updated_at') return actual?.[key] === value;
    // checkConfiguration requires this exact field to be declared datetime.
    // Cloudflare returns epoch milliseconds; also accept strict RFC3339 strings.
    const timestamp = Number.isSafeInteger(actual?.[key]) ? actual[key]
      : timestampOf(actual?.[key]);
    return Number.isFinite(timestamp) && timestamp === timestampOf(value);
  });
}

function existingState(items, document) {
  const matches = items.filter(item => item.key === document.key);
  if (!matches.length) return 'missing';
  const item = matches[0];
  if (matches.length !== 1 || item.source_id !== 'builtin' || item.status !== 'completed'
    || item.next_action && item.next_action !== 'INDEX'
    || !metadataMatches(item.metadata, document)) return 'conflict';
  return 'unchanged';
}

function validateUploaded(item, document, id) {
  assert.ok(item?.id === id && item.key === document.key && item.source_id === 'builtin'
    && (!item.next_action || item.next_action === 'INDEX')
    && metadataMatches(item.metadata, document),
  'AI Search bootstrap uploaded item differs from the exact verified builtin article');
  assert.ok(['queued', 'running', 'completed'].includes(item.status),
    'AI Search bootstrap uploaded item failed indexing; submitted articles are left untouched');
  return item.status === 'completed';
}

function publicFailure(error) {
  const first = String(error?.message ?? '').split('\n')[0];
  return first.startsWith('AI Search bootstrap') ? first : 'AI Search bootstrap could not verify this public article';
}

/** Published-only is intentionally separate from production full-sync receipts/pruning. */
export async function importPublishedAISearch({ directory, apply = false, binding, connectBinding, fetchImpl, log,
  wait, polling = {}, batchSize = 50, uploadConcurrency = 3, verifyDocument, fetchPublic, checkInstance }) {
  assert.ok(Number.isInteger(batchSize) && batchSize >= 1 && batchSize <= 50, 'AI Search bootstrap batch size must be between 1 and 50');
  assert.ok(Number.isInteger(uploadConcurrency) && uploadConcurrency >= 1 && uploadConcurrency <= 3,
    'AI Search bootstrap upload concurrency must be between 1 and 3');
  const sourceFiles = ['content.json', 'ai-search/manifest.json', 'ai-search/references.json']
    .map(filename => path.join(directory, '.generated', filename));
  const states = await Promise.all(sourceFiles.map(fileState));
  const assertSnapshot = async document => {
    const current = await Promise.all(sourceFiles.map(fileState));
    assert.deepEqual(current, states, 'AI Search bootstrap local content snapshot changed; export and review again');
    if (document) {
      const bytes = await readFile(path.join(directory, '.generated/ai-search/documents', `${document.id}.md`));
      assert.equal(sha256(bytes), document.hash, 'AI Search bootstrap document changed after export');
    }
  };
  const corpus = await readCorpus(path.join(directory, '.generated/ai-search'));
  assert.match(corpus.manifest.revision?.contentCommit ?? '', /^[a-f0-9]{40}$/, 'AI Search bootstrap requires a fixed reviewed content commit');
  assert.ok(corpus.documents.length, 'AI Search bootstrap refuses an empty article export');
  const { pages } = JSON.parse(await readFile(sourceFiles[0], 'utf8'));
  const byPath = new Map(pages.map(page => [page.url, page]));
  await assertSnapshot();
  binding ??= await connectBinding?.();
  assert.ok(binding?.info && binding?.items, 'AI Search bootstrap requires the official instance binding');
  const checkConfiguration = async () => {
    const info = await binding.info();
    checkInstance(info);
    assert.ok(Array.isArray(info.custom_metadata), 'AI Search bootstrap published-only requires the existing exact metadata schema; no schema changes are allowed');
  };
  await checkConfiguration();
  await listImportItems(binding, { wait });
  const sitemap = await fetchPublic(`${SITE_ORIGIN}/sitemap.xml`, fetchImpl);
  const evidence = [];
  const excluded = [];
  let cursor = 0;
  let checked = 0;
  // Verification is read-only and bounded; upload batches below never overlap.
  const verifyNext = async () => {
    while (cursor < corpus.documents.length) {
      const document = corpus.documents[cursor++];
      const page = byPath.get(new URL(document.url).pathname);
      try {
        assert.ok(page, 'AI Search bootstrap local article is missing');
        const verified = await verifyDocument(document, page, { sitemap, fetchImpl });
        evidence.push({ document, page, verified });
      } catch (error) {
        excluded.push({ key: document.key, url: document.url, reason: publicFailure(error) });
      }
      checked++;
      if (checked % 50 === 0 || checked === corpus.documents.length) {
        log(`AI Search published-only checked ${checked}/${corpus.documents.length}: ${evidence.length} verified, ${excluded.length} unverified.`);
      }
      await wait(150);
    }
  };
  await Promise.all([verifyNext(), verifyNext(), verifyNext()]);
  await assertSnapshot();
  evidence.sort((a, b) => a.document.key.localeCompare(b.document.key));
  excluded.sort((a, b) => a.key.localeCompare(b.key));
  await checkConfiguration();
  const remote = await listImportItems(binding, { wait });
  const candidates = evidence.filter(({ document }) => existingState(remote, document) === 'missing');
  const unchanged = evidence.filter(({ document }) => existingState(remote, document) === 'unchanged').length;
  const conflictEntries = evidence.filter(({ document }) => existingState(remote, document) === 'conflict')
    .map(({ document }) => ({ key: document.key, url: document.url, reason: 'Existing item does not match the verified builtin article; left untouched.' }));
  const summary = { verified: evidence.length, unverified: excluded.length, newDocuments: candidates.length,
    unchanged, conflicts: conflictEntries.length, evidence: evidence.map(({ verified }) => verified), excluded, conflictEntries };
  log(`AI Search published-only ${apply ? 'plan' : 'dry run'}: ${summary.verified} verified, ${summary.unverified} unverified, ${summary.newDocuments} new, ${summary.unchanged} unchanged, ${summary.conflicts} existing conflicts. No overwrite, deletion or schema update is planned.`);
  const excludedCounts = new Map();
  for (const { reason } of excluded) excludedCounts.set(reason, (excludedCounts.get(reason) ?? 0) + 1);
  for (const [reason, count] of excludedCounts) log(`AI Search published-only excluded ${count}: ${reason}`);
  if (!apply) return { applied: false, ...summary };
  assert.ok(evidence.length, 'AI Search bootstrap has no verified public articles to import');

  // Prevent simultaneous invocations in this checkout. Cloudflare's Items API
  // does not document conditional creation, so another machine/dashboard must
  // also stay out of the instance for the duration of this explicit import.
  const lockPath = path.join(directory, '.generated/ai-search-published-import.lock');
  let lock;
  try { lock = await open(lockPath, 'wx', 0o600); }
  catch (error) {
    if (error.code === 'EEXIST') throw new Error('AI Search bootstrap published-only import is already locked; verify the previous importer has stopped');
    throw error;
  }
  let added = 0;
  let skipped = unchanged;
  let conflicts = conflictEntries.length;
  let uploadAttempts = 0;
  let uploadDurationMs = 0;
  const submitted = new Map();
  let pending = new Map();
  try {
    log('AI Search published-only requires this importer to be the only writer to the instance, including other checkouts and the dashboard. The Items API has no documented conditional-create option.');
    for (let offset = 0; offset < candidates.length; offset += batchSize) {
      await assertSnapshot();
      await checkConfiguration();
      const batchSitemap = await fetchPublic(`${SITE_ORIGIN}/sitemap.xml`, fetchImpl);
      const inventory = await listImportItems(binding, { wait });
      const knownIds = new Set(inventory.map(item => item.id));
      const batch = candidates.slice(offset, offset + batchSize);
      assert.equal(new Set(batch.map(({ document }) => document.key)).size, batch.length,
        'AI Search bootstrap refuses duplicate keys within an upload batch');
      let next = 0;
      let batchFailure;
      const processDocument = async ({ document, page }) => {
        await assertSnapshot(document);
        await verifyDocument(document, page, { fetchImpl, sitemap: batchSitemap });
        if (batchFailure) return;
        const state = existingState(inventory, document);
        if (state !== 'missing') {
          if (state === 'conflict') {
            conflicts++;
            conflictEntries.push({ key: document.key, url: document.url, reason: 'Item appeared or changed before this batch; left untouched.' });
          } else skipped++;
          return;
        }
        await assertSnapshot(document);
        if (batchFailure) return;
        uploadAttempts++;
        const uploadStarted = performance.now();
        const item = await binding.items.upload(document.key, document.markdown, { metadata: metadata(document) });
        assert.ok(typeof item?.id === 'string' && item.id && item.key === document.key && !knownIds.has(item.id) && !submitted.has(item.id),
          'AI Search bootstrap upload did not return the exact new article key and unique id');
        submitted.set(item.id, document);
        uploadDurationMs += performance.now() - uploadStarted;
        knownIds.add(item.id);
        inventory.push({ id: item.id, key: document.key, source_id: 'builtin', status: 'queued', metadata: metadata(document) });
        log(`AI Search published-only submitted ${submitted.size}/${candidates.length} new articles; indexing is pending, ${skipped} existing matches and ${conflicts} conflicts left untouched.`);
      };
      const uploadNext = async () => {
        while (!batchFailure && next < batch.length) {
          const entry = batch[next++];
          try { await processDocument(entry); }
          catch (error) { batchFailure ??= { error }; }
        }
      };
      // Stop taking new work after the first failure, but wait for every request
      // already started to settle and account for its acknowledgement.
      const settled = await Promise.allSettled(Array.from({ length: uploadConcurrency }, uploadNext));
      for (const result of settled) if (result.status === 'rejected') batchFailure ??= { error: result.reason };
      if (batchFailure) throw batchFailure.error;
      await assertSnapshot();
      await checkConfiguration();
      const afterBatch = await listImportItems(binding, { wait });
      const byId = new Map(afterBatch.map(item => [item.id, item]));
      pending = new Map();
      added = 0;
      for (const [id, document] of submitted) {
        assert.equal(afterBatch.filter(item => item.key === document.key).length, 1,
          'AI Search bootstrap submitted key is missing or ambiguous after the batch');
        if (validateUploaded(byId.get(id), document, id)) added++;
        else pending.set(id, document);
      }
      log(`AI Search published-only batch ${Math.floor(offset / batchSize) + 1}: ${added}/${submitted.size} indexed, ${pending.size} pending; complete remote inventory verified; ${submitted.size ? Math.round(uploadDurationMs / submitted.size) : 0} ms average upload request.`);
    }
    // Uploads have finished before any polling begins. There is never a write
    // concurrent with a paginated inventory read or an indexing status read.
    for (let attempt = 0; pending.size && attempt < (polling.maxAttempts ?? 60); attempt++) {
      await assertSnapshot();
      await checkConfiguration();
      for (const [id, document] of pending) {
        if (validateUploaded(await binding.items.info(id), document, id)) {
          pending.delete(id);
          added++;
        }
      }
      log(`AI Search published-only indexing: ${added}/${submitted.size} completed, ${pending.size} pending.`);
      if (pending.size) await wait(polling.intervalMs ?? 10000);
    }
    assert.equal(pending.size, 0, 'AI Search bootstrap indexing is still pending; submitted articles are left untouched, do not blindly repeat uploads');
    await assertSnapshot();
    log(`AI Search published-only completed: ${added} added; no existing articles or schema were changed. ${excluded.length} articles remain unverified.`);
    return { applied: true, ...summary, added, skipped, conflicts, conflictEntries };
  } catch (error) {
    log(`AI Search published-only stopped after ${uploadAttempts} upload attempts, ${submitted.size} acknowledged ids and ${added} verified indexed articles. An unacknowledged request may already have succeeded; all items are left untouched. Inspect the next dry run before retrying.`);
    throw error;
  } finally {
    await lock.close();
    await unlink(lockPath);
  }
}
