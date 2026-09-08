import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { assetHashes, releaseInputs, releaseCorpus, assertSealedRelease } from '../scripts/release-manifest.mjs';
import { createCorpus, jsonBytes, sha256 } from '../scripts/lib/ai-search-corpus.mjs';
import { assertPublishedCorpus } from '../scripts/lib/ai-search-published.mjs';
import { CUSTOM_METADATA, applySync, createAISearchClient, planSync } from '../scripts/lib/ai-search-sync.mjs';
import { syncAISearch } from '../scripts/sync-ai-search.mjs';

const execute = promisify(execFile);
const page = slug => ({ kind: 'page', type: 'posts', url: `/posts/${slug}/`, title: slug, html: '<p>Published fixture content.</p>', date: '2026-09-01' });
const remoteItem = document => ({ id: document.id, key: document.key, source_id: 'builtin', metadata: { content_hash: document.hash }, next_action: 'INDEX', status: 'completed' });

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'ai-search-release-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const folder of ['.generated/ai-search/documents', 'dist/posts/one', 'scripts/lib', 'worker', 'node_modules']) await mkdir(path.join(root, folder), { recursive: true });
  for (const script of ['theme-package.mjs', 'release-manifest.mjs', 'verify-ai-search-deployment.mjs', 'lib/ai-search-corpus.mjs']) await copyFile(new URL(`../scripts/${script}`, import.meta.url), path.join(root, 'scripts', script));
  await symlink(fileURLToPath(new URL('../node_modules/parse5', import.meta.url)), path.join(root, 'node_modules/parse5'));
  await writeFile(path.join(root, '.gitignore'), '.generated/\ndist/\nnode_modules/\n');
  await writeFile(path.join(root, 'wrangler.jsonc'), JSON.stringify({ name: 'fixture', main: 'worker/index.ts', assets: { directory: './dist' } }));
  await writeFile(path.join(root, 'worker/index.ts'), 'import references from "../.generated/ai-search/references.json";\nexport default references;\n');
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ type: 'module', dependencies: { '@tcitry/astro-book': '0.1.1' } }));
  await writeFile(path.join(root, 'package-lock.json'), JSON.stringify({ packages: {
    '': { dependencies: { '@tcitry/astro-book': '0.1.1' } },
    'node_modules/@tcitry/astro-book': { version: '0.1.1', resolved: 'https://registry.npmjs.org/@tcitry/astro-book/-/astro-book-0.1.1.tgz', integrity: 'sha512-' + 'A'.repeat(86) + '==' },
  } }));
  const reader = {
    clerkPublishableKey: 'pk_live_' + Buffer.from('clerk.test.invalid$').toString('base64'),
    clerkIssuerDomain: 'https://clerk.test.invalid', convexUrl: 'https://production-fixture-123.convex.cloud',
  };
  await writeFile(path.join(root, '.generated/reader-build.json'), jsonBytes(reader));
  const git = args => execute('git', ['-C', root, '-c', 'user.name=AI Search Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args]);
  await git(['init', '--quiet']);
  await git(['add', '.']);
  await git(['commit', '--quiet', '-m', 'Fixture']);
  const inputs = await releaseInputs(root);
  const corpus = createCorpus([page('one')], { environment: 'production', revision: { siteCommit: inputs.siteCommit, contentCommit: 'b'.repeat(40) } });
  await writeFile(path.join(root, '.generated/ai-search/manifest.json'), jsonBytes(corpus.manifest));
  await writeFile(path.join(root, '.generated/ai-search/references.json'), jsonBytes(corpus.references));
  for (const document of corpus.documents) await writeFile(path.join(root, '.generated/ai-search/documents', document.id + '.md'), document.markdown);
  await writeFile(path.join(root, 'dist/posts/one/index.html'), '<html>Published fixture content.</html>');
  const marker = { version: 1, ...corpus.manifest.revision, corpusHash: corpus.manifest.corpusHash, environment: 'production' };
  await writeFile(path.join(root, 'dist/blog-release.json'), JSON.stringify(marker));
  const release = { version: 3, environment: 'production', ...inputs, contentCommit: corpus.manifest.revision.contentCommit, reader, assets: await assetHashes(path.join(root, 'dist')) };
  release.aiSearch = await releaseCorpus(root, release);
  const releaseBytes = jsonBytes(release);
  await writeFile(path.join(root, '.generated/release.json'), releaseBytes);
  const receipt = { version: 1, environment: 'production', releaseHash: sha256(releaseBytes), verifiedAt: '2026-09-01T00:00:00Z' };
  const receiptFile = path.join(root, '.generated/deployment.json');
  await writeFile(receiptFile, jsonBytes(receipt));
  return { root, corpus, release, marker, receipt, receiptFile };
}

test('Worker releases seal imported generated references and fail closed when those bytes change', async t => {
  const context = await fixture(t);
  await assertSealedRelease(context.root, context.release);
  const file = path.join(context.root, '.generated/ai-search/references.json');
  const changed = structuredClone(context.corpus.references);
  changed.documents[0].title = 'Unreviewed title';
  await writeFile(file, jsonBytes(changed));
  await assert.rejects(assertSealedRelease(context.root, context.release), /references differ/);
  await writeFile(file, jsonBytes(context.corpus.references));
  await assert.rejects(assertSealedRelease(context.root, { ...context.release, aiSearch: undefined }), /corpus changed/);
});

test('online verification does not leave a receipt for a different production revision or an unrouted chat API', async t => {
  const context = await fixture(t);
  const preload = path.join(context.root, '.generated/mock-fetch.mjs');
  await writeFile(preload, `import { readFileSync } from 'node:fs';
globalThis.fetch = async url => {
  if (url.includes('/blog-release.json')) {
    const marker = JSON.parse(readFileSync('dist/blog-release.json', 'utf8'));
    if (process.env.FIXTURE_BAD_MARKER) marker.siteCommit = 'c'.repeat(40);
    return new Response(JSON.stringify(marker));
  }
  if (url.endsWith('/api/chat')) return new Response('', {status: process.env.FIXTURE_BAD_CHAT ? 200 : 405});
  throw new Error('Unexpected network request in test');
};\n`);
  async function run(extra) {
    return execute(process.execPath, ['--import', preload, 'scripts/verify-ai-search-deployment.mjs'], { cwd: context.root, env: { ...process.env, ...extra } });
  }
  for (const env of [{ FIXTURE_BAD_MARKER: '1' }, { FIXTURE_BAD_CHAT: '1' }]) {
    await writeFile(context.receiptFile, jsonBytes(context.receipt));
    await assert.rejects(run(env));
    await assert.rejects(readFile(context.receiptFile), { code: 'ENOENT' });
  }
  await run({});
  const receipt = JSON.parse(await readFile(context.receiptFile, 'utf8'));
  assert.equal(receipt.releaseHash, context.receipt.releaseHash);
});

test('a valid historical local receipt cannot let an old release overwrite the current index', async t => {
  const context = await fixture(t);
  let writes = 0;
  const client = { getInstance: async () => ({ ai_gateway_id: 'tcitry-blog-chat', custom_metadata: CUSTOM_METADATA }), listItems: async () => [],
    upload: async () => { writes++; }, deleteItem: async () => { writes++; } };
  await assert.rejects(syncAISearch({ apply: true, client, directory: context.root, log: () => {},
    fetchImpl: async () => new Response(JSON.stringify({ ...context.marker, contentCommit: 'c'.repeat(40) })) }), /no longer the current production/);
  assert.equal(writes, 0);
  await assert.rejects(readFile(path.join(context.root, '.generated/ai-search-sync.json')), { code: 'ENOENT' });
  await writeFile(context.receiptFile, jsonBytes({ ...context.receipt, releaseHash: 'wrong' }));
  let fetches = 0;
  await assert.rejects(syncAISearch({ apply: true, client, directory: context.root, log: () => {}, fetchImpl: async () => { fetches++; } }), /different release/);
  assert.equal(fetches, 0);
  assert.equal(writes, 0);
});

test('sync checks publication again before deletion and before writing a completed state', async t => {
  const context = await fixture(t);
  let fetches = 0;
  let writes = 0;
  const completion = path.join(context.root, '.generated/ai-search-sync.json');
  await writeFile(completion, '{"previous":"successful state"}\n');
  const client = { getInstance: async () => ({ ai_gateway_id: 'tcitry-blog-chat', custom_metadata: CUSTOM_METADATA }), listItems: async () => [],
    upload: async document => { writes++; return remoteItem(document); }, wait: async () => {} };
  await assert.rejects(syncAISearch({ apply: true, client, directory: context.root, log: () => {}, fetchImpl: async () => {
    fetches++;
    return new Response(JSON.stringify(fetches < 3 ? context.marker : { ...context.marker, corpusHash: 'changed' }));
  } }), /no longer the current production/);
  assert.equal(writes, 1);
  assert.equal(await readFile(completion, 'utf8'), '{"previous":"successful state"}\n');
  const removed = createCorpus([page('removed')]).documents[0];
  let checks = 0;
  let deletes = 0;
  await assert.rejects(applySync({ upload: async document => remoteItem(document), wait: async () => {}, deleteItem: async () => { deletes++; } },
    planSync(context.corpus.documents, [remoteItem(removed)]), { beforeWrite: async () => { if (++checks === 2) throw new Error('Deployment changed'); } }), /Deployment changed/);
  assert.equal(deletes, 0);
});

test('mutation retries recheck publication after a gateway cooldown', async () => {
  const document = createCorpus([page('one')]).documents[0];
  let attempts = 0;
  const client = createAISearchClient({ accountId: 'a'.repeat(32), token: 'fixture-only', intervalMs: 0, wait: async () => {},
    fetchImpl: async () => { attempts++; return new Response('cooldown', { status: 429 }); } });
  await assert.rejects(client.upload(document, { beforeRetry: async () => { throw new Error('New deployment'); } }), /New deployment/);
  assert.equal(attempts, 1);
});

test('production marker verification refuses redirects, previews and request failures', async () => {
  const manifest = createCorpus([page('one')], { environment: 'production', revision: { siteCommit: 'a'.repeat(40), contentCommit: 'b'.repeat(40) } }).manifest;
  await assert.rejects(assertPublishedCorpus(manifest, { fetchImpl: async () => { throw new Error('network'); } }), /could not verify/);
  await assert.rejects(assertPublishedCorpus(manifest, { fetchImpl: async () => new Response('{}', { status: 302 }) }), /available production/);
  await assert.rejects(assertPublishedCorpus({ ...manifest, environment: 'preview' }), /Only production/);
});
