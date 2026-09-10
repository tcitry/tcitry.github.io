import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parse, serialize } from 'parse5';
import { articleMarkdown, canonicalURL, createCorpus, readCorpus, sha256, SITE_ORIGIN } from './lib/ai-search-corpus.mjs';
import { CUSTOM_METADATA, waitUntilIndexed } from './lib/ai-search-sync.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
export const BOOTSTRAP_PATHS = Object.freeze([
  '/docs/Agents/contract-testing-cross-platform-ai-agents/',
  '/docs/Git/git/',
  '/docs/Apple/SwiftData/DataStore/',
]);
const attribute = (node, name) => node.attrs?.find(item => item.name === name)?.value;
const textContent = node => node.nodeName === '#text' ? node.value : (node.childNodes ?? []).map(textContent).join('');
const all = (node, predicate) => [...(predicate(node) ? [node] : []), ...(node.childNodes ?? []).flatMap(child => all(child, predicate))];
const normalizedSchema = schema => schema.map(field => ({ field_name: String(field.field_name).toLowerCase(), data_type: field.data_type })).sort((a, b) => a.field_name.localeCompare(b.field_name));
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const classes = node => (attribute(node, 'class') ?? '').split(/\s+/);
const inside = (node, ancestor) => node === ancestor || Boolean(node.parentNode && inside(node.parentNode, ancestor));
const normalizedDate = value => value && !String(value).startsWith('0001') && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : '';

function verifyPublicMetadata(tree, main, article, document, page) {
  const body = all(tree, node => node.tagName === 'body');
  assert.ok(body.length === 1 && classes(body[0]).includes('book-kind-page') && classes(body[0]).includes(`book-type-${document.section}`),
    'AI Search bootstrap public article section differs from the local reviewed content');
  const ogTitles = all(tree, node => node.tagName === 'meta' && attribute(node, 'property') === 'og:title');
  assert.ok(ogTitles.length === 1 && attribute(ogTitles[0], 'content') === document.title,
    'AI Search bootstrap public display title differs from the trusted reference');
  const primaryTitles = document.section === 'docs'
    ? all(main, node => node.tagName === 'h1' && !inside(node, article))
    : (article.childNodes ?? []).filter(node => node.tagName).slice(0, 1);
  assert.ok(primaryTitles.length === 1 && primaryTitles[0].tagName === 'h1' && textContent(primaryTitles[0]).trim() === document.title,
    'AI Search bootstrap public article title differs from the trusted reference');
  let structured;
  try {
    structured = all(tree, node => node.tagName === 'script' && attribute(node, 'type') === 'application/ld+json')
      .flatMap(node => JSON.parse(textContent(node))).filter(value => value?.['@type'] === 'BlogPosting' && value.url === document.url);
  } catch { throw new Error('AI Search bootstrap public article structured metadata is invalid'); }
  assert.ok(structured.length === 1 && structured[0].headline === page.title,
    'AI Search bootstrap could not identify one public article metadata record');
  assert.equal(normalizedDate(structured[0].datePublished), document.date,
    'AI Search bootstrap public publication date differs from the local reviewed content');
  assert.equal(normalizedDate(structured[0].dateModified), normalizedDate(page.lastmod),
    'AI Search bootstrap public modification date differs from the local reviewed content');

  let tagContainers;
  if (document.section === 'docs') {
    const footers = all(main, node => node.tagName === 'h5' && classes(node).includes('post-after') && !inside(node, article));
    assert.ok(footers.length === 1 && (footers[0].parentNode.attrs ?? []).some(item => item.name === 'data-pagefind-ignore'),
      'AI Search bootstrap could not verify the public article tag container');
    // Only the article's own tag paragraph: related articles/navigation are excluded.
    tagContainers = (footers[0].parentNode.childNodes ?? []).filter(node => node.tagName === 'div')
      .flatMap(node => (node.childNodes ?? []).filter(child => child.tagName === 'p' && textContent(child).startsWith('相关标签：')));
  } else {
    tagContainers = (article.childNodes ?? []).filter(node => node.tagName === 'div'
      && ['flex', 'flex-wrap', 'gap-x-1', 'gap-y-0.5'].every(name => classes(node).includes(name)));
  }
  assert.ok(tagContainers.length <= 1 && (!(page.tags ?? []).length || tagContainers.length === 1),
    'AI Search bootstrap could not verify one public article tag container');
  const aiMarkers = tagContainers.flatMap(node => all(node, child => child.tagName === 'a'))
    .filter(node => textContent(node).trim().toLowerCase() === 'byai' || /\/tags\/byai\/$/i.test(attribute(node, 'href') ?? ''));
  assert.ok(aiMarkers.every(node => textContent(node).trim() === 'ByAI'
    && new URL(attribute(node, 'href'), SITE_ORIGIN).href === `${SITE_ORIGIN}/tags/ByAI/`),
    'AI Search bootstrap public AI attribution marker is invalid');
  assert.equal(aiMarkers.length > 0 ? 'ai-assisted' : 'author', document.sourceKind,
    'AI Search bootstrap public AI attribution differs from the local reviewed content');
}

async function fetchPublic(url, fetchImpl) {
  let response;
  try { response = await fetchImpl(url, { redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(15000), headers: { 'cache-control': 'no-cache' } }); }
  catch { throw new Error('AI Search bootstrap could not verify a public page; no sample import is allowed.'); }
  assert.ok(response.status === 200 && !response.redirected, 'AI Search bootstrap requires a public page with HTTP 200 and no redirect');
  assert.ok(!response.url || response.url === url, 'AI Search bootstrap received an unexpected public page URL');
  assert.ok(!/\b(?:noindex|none)\b/i.test(response.headers.get('x-robots-tag') ?? ''), 'AI Search bootstrap cannot import a noindex page');
  assert.ok(url.endsWith('/sitemap.xml')
    ? /^(?:application|text)\/xml\b/i.test(response.headers.get('content-type') ?? '')
    : /^text\/html\b/i.test(response.headers.get('content-type') ?? ''), 'AI Search bootstrap received an unexpected public content type');
  return response.text();
}

/** Match the live HTML body and public metadata to the exact local document bytes. */
export async function verifyBootstrapSample(document, page, { sitemap, fetchImpl = fetch } = {}) {
  assert.ok(BOOTSTRAP_PATHS.includes(new URL(document.url).pathname) && new URL(document.url).origin === SITE_ORIGIN, 'AI Search bootstrap only supports the three fixed public samples');
  return verifyPublishedDocument(document, page, { sitemap, fetchImpl });
}

/** Full-corpus import uses the same strict article checks, without expanding the default sample scope. */
export async function verifyPublishedDocument(document, page, { sitemap, fetchImpl = fetch } = {}) {
  assert.equal(document.url, canonicalURL(new URL(document.url).pathname), 'AI Search bootstrap requires a canonical public article URL');
  const regenerated = createCorpus([page]).documents[0];
  assert.ok(regenerated, 'AI Search bootstrap article is absent from the public content export');
  for (const field of ['id', 'key', 'hash', 'url', 'title', 'section', 'date', 'updatedAt', 'sourceKind']) {
    assert.equal(document[field], regenerated[field], 'AI Search bootstrap article metadata differs from the public content export');
  }
  assert.equal(sha256(document.markdown), document.hash, 'AI Search bootstrap document bytes differ from the trusted reference hash');
  assert.ok(Buffer.byteLength(document.markdown, 'utf8') <= 4 * 1024 * 1024, 'AI Search bootstrap sample exceeds the supported upload size');
  const html = await fetchPublic(document.url, fetchImpl);
  const tree = parse(html);
  const canonical = all(tree, node => node.tagName === 'link' && (attribute(node, 'rel') ?? '').toLowerCase().split(/\s+/).includes('canonical'));
  assert.ok(canonical.length === 1 && attribute(canonical[0], 'href') === document.url, 'AI Search bootstrap canonical URL differs from the trusted reference');
  const robots = all(tree, node => node.tagName === 'meta' && /^(?:robots|googlebot|bingbot)$/i.test(attribute(node, 'name') ?? ''));
  assert.ok(!robots.some(node => /\b(?:noindex|none)\b/i.test(attribute(node, 'content') ?? '')), 'AI Search bootstrap cannot import a noindex page');
  const main = all(tree, node => attribute(node, 'id') === 'main-content');
  assert.equal(main.length, 1, 'AI Search bootstrap could not identify the public article container');
  const articles = all(main[0], node => node.tagName === 'article' && (node.attrs ?? []).some(item => item.name === 'data-pagefind-body'));
  assert.equal(articles.length, 1, 'AI Search bootstrap could not identify one public article body');
  const liveBody = articleMarkdown(serialize(articles[0]), document.url);
  assert.equal(liveBody, articleMarkdown(page.html, document.url), 'AI Search bootstrap public article body differs from the local reviewed content');
  verifyPublicMetadata(tree, main[0], articles[0], document, page);
  const sitemapText = sitemap ?? await fetchPublic(`${SITE_ORIGIN}/sitemap.xml`, fetchImpl);
  const entries = [...sitemapText.matchAll(/<url>([\s\S]*?)<\/url>/g)].map(match => match[1]).filter(entry => entry.includes(`<loc>${document.url}</loc>`));
  assert.equal(entries.length, 1, 'AI Search bootstrap sample must occur exactly once in the production sitemap');
  assert.equal(entries[0].match(/<lastmod>([^<]+)<\/lastmod>/)?.[1], document.updatedAt, 'AI Search bootstrap public lastmod differs from the local reviewed content');
  return { key: document.key, url: document.url, title: document.title, hash: document.hash, bodyHash: sha256(liveBody), updatedAt: document.updatedAt };
}

function checkInstance(info) {
  assert.equal(info?.id, 'tcitry-blog-search', 'AI Search bootstrap must target the existing tcitry-blog-search instance');
  assert.equal(info.ai_gateway_id, 'tcitry-blog-chat', 'AI Search bootstrap must preserve the existing tcitry-blog-chat Gateway');
  assert.ok(!info.type && !info.source, 'AI Search bootstrap requires the existing built-in-storage instance without an external source');
  if (info.custom_metadata != null) {
    assert.ok(Array.isArray(info.custom_metadata), 'AI Search bootstrap received an invalid metadata schema');
    assert.deepEqual(normalizedSchema(info.custom_metadata), normalizedSchema(CUSTOM_METADATA), 'AI Search bootstrap refuses to replace an existing different metadata schema');
  }
}

async function listBuiltin(binding) {
  const items = [];
  const seen = new Set();
  let total;
  for (let page = 1; page <= 10000; page++) {
    const payload = await binding.items.list({ source: 'builtin', page, per_page: 50, sort_by: 'modified_at' });
    assert.ok(Array.isArray(payload.result), 'AI Search bootstrap received an invalid item list');
    const count = payload.result_info?.total_count;
    assert.ok(Number.isInteger(count) && count >= 0, 'AI Search bootstrap requires complete item pagination');
    total ??= count;
    assert.equal(count, total, 'AI Search bootstrap items changed while listing; rerun when other imports have stopped');
    for (const item of payload.result) {
      assert.ok(item.source_id === 'builtin' && typeof item.id === 'string' && !seen.has(item.id), 'AI Search bootstrap item pagination is inconsistent');
      seen.add(item.id);
      items.push(item);
    }
    assert.ok(items.length <= total, 'AI Search bootstrap item count is inconsistent');
    if (items.length === total) return items;
    assert.ok(payload.result.length, 'AI Search bootstrap item list is incomplete');
  }
  throw new Error('AI Search bootstrap refused a partial remote item list.');
}

function existingItem(items, document) {
  const matches = items.filter(item => item.key === document.key);
  assert.ok(matches.length <= 1, 'AI Search bootstrap found duplicate sample keys');
  const item = matches[0];
  if (item) {
    assert.equal(item.metadata?.content_hash, document.hash, 'AI Search bootstrap refuses to overwrite an existing sample with a different content hash');
    assert.ok(item.next_action !== 'DELETE', 'AI Search bootstrap sample is pending deletion; resolve the existing import first');
  }
  return item;
}

/** The binding is injectable; this function never reads credentials or deployment receipts. */
export async function bootstrapAISearch({ directory = root, apply = false, publishedOnly = false, binding, connectBinding, fetchImpl = fetch, log = console.log, polling, batchSize, uploadConcurrency, wait: pause = wait } = {}) {
  if (publishedOnly) {
    const { importPublishedAISearch } = await import('./lib/ai-search-published-import.mjs');
    return importPublishedAISearch({ directory, apply, binding, connectBinding, fetchImpl, log, wait: pause, polling, batchSize, uploadConcurrency,
      verifyDocument: verifyPublishedDocument, fetchPublic, checkInstance });
  }
  const corpus = await readCorpus(path.join(directory, '.generated/ai-search'));
  assert.match(corpus.manifest.revision?.contentCommit ?? '', /^[a-f0-9]{40}$/, 'AI Search bootstrap requires content exported from a fixed reviewed commit');
  const { pages } = JSON.parse(await readFile(path.join(directory, '.generated/content.json'), 'utf8'));
  const samples = BOOTSTRAP_PATHS.map(pathname => {
    const document = corpus.documents.find(item => item.url === `${SITE_ORIGIN}${pathname}`);
    const page = pages.find(item => item.url === pathname);
    assert.ok(document && page, 'AI Search bootstrap requires all three public samples in the current local corpus');
    return { document, page };
  });
  const sitemap = await fetchPublic(`${SITE_ORIGIN}/sitemap.xml`, fetchImpl);
  const evidence = [];
  for (const { document, page } of samples) evidence.push(await verifyBootstrapSample(document, page, { sitemap, fetchImpl }));
  log(`AI Search bootstrap verified ${samples.length} fixed samples against their current public pages and local hashes.`);
  if (!apply && !binding) {
    log('Dry run only. No Cloudflare binding was started and no remote configuration or items were changed.');
    return { applied: false, evidence, needsRemoteReview: true };
  }
  binding ??= await connectBinding?.();
  assert.ok(binding?.info && binding?.items, 'AI Search bootstrap requires the official instance binding');
  const info = await binding.info();
  checkInstance(info);
  const initialItems = await listBuiltin(binding);
  const plan = samples.map(sample => ({ ...sample, item: existingItem(initialItems, sample.document) }));
  log(`AI Search bootstrap plan: ${plan.filter(item => !item.item).length} new samples; ${plan.filter(item => item.item).length} existing matching samples; schema ${info.custom_metadata == null ? 'will be initialized' : 'already matches'}.`);
  if (!apply) return { applied: false, evidence, newSamples: plan.filter(item => !item.item).length, initializeSchema: info.custom_metadata == null };
  // Check all existing keys before the first write, including schema initialization.
  if (info.custom_metadata == null) {
    const latest = await binding.info();
    checkInstance(latest);
    if (latest.custom_metadata == null) await binding.update({ custom_metadata: CUSTOM_METADATA });
    const updated = await binding.info();
    checkInstance(updated);
    assert.ok(updated.custom_metadata != null, 'AI Search bootstrap metadata initialization did not complete');
  }
  let added = 0;
  let skipped = 0;
  for (const { document, page } of samples) {
    // Public pages and keys are rechecked just before every possible upload.
    await verifyBootstrapSample(document, page, { fetchImpl });
    checkInstance(await binding.info());
    let item = existingItem(await listBuiltin(binding), document);
    if (!item) {
      item = await binding.items.uploadAndPoll(document.key, document.markdown, { metadata: {
        canonical_url: document.url, section: document.section, updated_at: document.updatedAt,
        source_kind: document.sourceKind, content_hash: document.hash,
      }, pollIntervalMs: 10000, timeoutMs: 120000 });
      added++;
    } else skipped++;
    const complete = await waitUntilIndexed({ getItem: id => binding.items.get(id), wait }, item, polling);
    assert.ok(complete.source_id === 'builtin' && complete.key === document.key && complete.metadata?.content_hash === document.hash, 'AI Search bootstrap did not index the exact verified sample');
    log(`AI Search bootstrap indexed public sample: ${document.title}`);
  }
  log(`AI Search bootstrap completed: ${added} added, ${skipped} already present. No articles were deleted and no production release was deployed.`);
  return { applied: true, added, skipped, evidence };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  let worker;
  const started = performance.now();
  const reads = { count: 0, durationMs: 0 };
  try {
    const args = process.argv.slice(2);
    assert.ok(args.every(arg => ['--apply', '--dry-run', '--published-only'].includes(arg)) && !(args.includes('--apply') && args.includes('--dry-run')), 'Usage: npm run ai-search:bootstrap -- [--published-only] [--dry-run | --apply]');
    const apply = args.includes('--apply');
    const publishedOnly = args.includes('--published-only');
    await bootstrapAISearch({ apply, publishedOnly, connectBinding: async () => {
      process.env.WRANGLER_LOG = 'none';
      process.env.WRANGLER_LOG_PATH = '';
      process.env.WRANGLER_SEND_METRICS = 'false';
      process.env.WRANGLER_WRITE_LOGS = 'false';
      const { unstable_dev } = await import('wrangler');
      const session = randomUUID();
      // Node's platform proxy loses nested RPC properties such as items.list.
      // Run those operations inside a temporary local Worker. Explicit local:true
      // would disable remote bindings; omit it and use Wrangler's local default.
      worker = await unstable_dev(path.join(root, 'scripts/lib/ai-search-local-worker.mjs'), {
        config: path.join(root, 'wrangler.jsonc'), ip: '127.0.0.1', port: 0, persist: false,
        vars: { BOOTSTRAP_SESSION: session, BOOTSTRAP_READ_ONLY: apply ? '0' : '1', BOOTSTRAP_NO_SCHEMA_UPDATE: publishedOnly ? '1' : '0' }, inspect: false, logLevel: 'error',
        experimental: { disableExperimentalWarning: true, disableDevRegistry: true, watch: false },
      });
      const invoke = async (operation, ...args) => {
        const requestStarted = performance.now();
        const response = await worker.fetch('/api/bootstrap', { method: 'POST',
          headers: { 'content-type': 'application/json', 'x-bootstrap-session': session },
          body: JSON.stringify({ operation, args }),
        });
        const result = await response.json();
        if (operation === 'list') { reads.count++; reads.durationMs += performance.now() - requestStarted; }
        if (!response.ok) throw new Error(`AI Search bootstrap ${operation} failed (HTTP ${response.status}${Number.isFinite(Number(result.code)) ? `, code ${Number(result.code)}` : ''}).`);
        return result;
      };
      return { info: () => invoke('info'), update: patch => invoke('update', patch), items: {
        list: options => invoke('list', options), get: id => invoke('get', id), info: id => invoke('itemInfo', id),
        upload: (key, markdown, options) => invoke('upload', key, markdown, options),
        uploadAndPoll: (key, markdown, options) => invoke('uploadAndPoll', key, markdown, options),
      } };
    } });
  } catch (error) {
    console.error(error instanceof assert.AssertionError || error.message?.startsWith('AI Search bootstrap')
      ? error.message.split('\n')[0] : 'AI Search bootstrap failed. Check the official Wrangler connection and AI Search permissions; no production deployment or full synchronization was performed.');
    process.exitCode = 1;
  } finally {
    await worker?.stop();
    if (reads.count) console.log(`AI Search bootstrap read metrics: ${reads.count} list requests, ${Math.round(reads.durationMs / reads.count)} ms average; ${Math.round((performance.now() - started) / 1000)} seconds total.`);
  }
}
