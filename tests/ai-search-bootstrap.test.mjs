import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { BOOTSTRAP_PATHS, bootstrapAISearch } from '../scripts/bootstrap-ai-search.mjs';
import { createCorpus, jsonBytes, SITE_ORIGIN } from '../scripts/lib/ai-search-corpus.mjs';
import { CUSTOM_METADATA } from '../scripts/lib/ai-search-sync.mjs';

async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'ai-search-bootstrap-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const pages = [...BOOTSTRAP_PATHS, '/docs/unselected-public-article/'].map((url, index) => ({
    kind: 'page', type: 'docs', url, title: `Sample ${index}`, date: '2026-09-01T00:00:00Z', lastmod: '2026-09-08T02:59:24Z',
    tags: index === 1 ? [] : ['ByAi'], html: `<h2>Section ${index}</h2><p>Published body ${index}.</p><pre><code>const x = ${index};\n\n</code></pre>`,
    source: 'private-source-must-not-be-uploaded.md', params: { privateSetting: 'must-not-be-uploaded' },
  }));
  const corpus = createCorpus(pages, { environment: 'preview', revision: { siteCommit: 'a'.repeat(40), contentCommit: 'b'.repeat(40) } });
  const generated = path.join(directory, '.generated');
  await mkdir(path.join(generated, 'ai-search/documents'), { recursive: true });
  await writeFile(path.join(generated, 'content.json'), JSON.stringify({ pages }));
  await writeFile(path.join(generated, 'ai-search/manifest.json'), jsonBytes(corpus.manifest));
  await writeFile(path.join(generated, 'ai-search/references.json'), jsonBytes(corpus.references));
  for (const document of corpus.documents) await writeFile(path.join(generated, 'ai-search/documents', `${document.id}.md`), document.markdown);
  const sitemap = () => `<urlset>${corpus.documents.map(document => `<url><loc>${document.url}</loc><lastmod>${document.updatedAt}</lastmod></url>`).join('')}</urlset>`;
  const options = { mutateHTML: value => value, mutateSitemap: value => value, status: 200, headerRobots: '' };
  const requests = [];
  const fetchImpl = async (url, init) => {
    requests.push(url);
    assert.equal(init.redirect, 'error');
    assert.equal(init.cache, 'no-store');
    if (url === `${SITE_ORIGIN}/sitemap.xml`) return new Response(options.mutateSitemap(sitemap()), { status: options.status });
    const page = pages.find(page => `${SITE_ORIGIN}${page.url}` === url);
    assert.ok(page, 'No other URLs may be fetched');
    const html = `<html><head><link rel="canonical" href="${url}"></head><body><main id="main-content"><h1>${page.title}</h1>
      <article data-pagefind-body>${page.html}</article></main></body></html>`;
    return new Response(options.mutateHTML(html), { status: options.status, headers: { 'x-robots-tag': options.headerRobots } });
  };
  return { directory, corpus, pages, fetchImpl, options, requests };
}

function fakeBinding({ schema = null, items = [] } = {}) {
  const info = { id: 'tcitry-blog-search', ai_gateway_id: 'tcitry-blog-chat', type: null, source: null, custom_metadata: schema };
  const calls = [];
  return {
    data: { info, items, calls },
    info: async () => { calls.push('info'); return structuredClone(info); },
    update: async patch => {
      calls.push('update');
      assert.deepEqual(patch, { custom_metadata: CUSTOM_METADATA });
      info.custom_metadata = structuredClone(patch.custom_metadata);
    },
    items: {
      list: async params => {
        calls.push('list');
        assert.equal(params.source, 'builtin');
        return { result: items.slice((params.page - 1) * params.per_page, params.page * params.per_page), result_info: { total_count: items.length } };
      },
      uploadAndPoll: async (key, markdown, options) => {
        calls.push('upload');
        assert.ok(!items.some(item => item.key === key), 'Existing keys must never be overwritten');
        assert.doesNotMatch(markdown, /private-source|must-not-be-uploaded/);
        assert.equal(options.pollIntervalMs, 10000);
        assert.equal(options.timeoutMs, 120000);
        assert.deepEqual(Object.keys(options.metadata).sort(), CUSTOM_METADATA.map(field => field.field_name).sort());
        const item = { id: `sample-${items.length}`, key, source_id: 'builtin', status: 'completed', next_action: 'INDEX', metadata: options.metadata };
        items.push(item);
        return item;
      },
      get: async id => items.find(item => item.id === id),
      delete: async () => { throw new Error('Bootstrap must never delete'); },
    },
  };
}

test('bootstrap defaults to a live-page dry run and does not start Cloudflare bindings', async t => {
  const context = await fixture(t);
  let connections = 0;
  const result = await bootstrapAISearch({ ...context, log: () => {}, connectBinding: async () => { connections++; } });
  assert.equal(result.applied, false);
  assert.equal(result.evidence.length, 3);
  assert.equal(connections, 0);
  assert.equal(context.requests.length, 4);
  assert.ok(context.requests.every(url => url.endsWith('/sitemap.xml') || BOOTSTRAP_PATHS.includes(new URL(url).pathname)));
  for (const file of ['release.json', 'deployment.json', 'ai-search-sync.json']) await assert.rejects(readFile(path.join(context.directory, '.generated', file)), { code: 'ENOENT' });
});

test('bootstrap initializes only an empty schema, adds three fixed samples, then skips matching existing samples', async t => {
  const context = await fixture(t);
  const other = { id: 'unrelated', key: 'manual.md', source_id: 'builtin', status: 'completed', metadata: {} };
  const binding = fakeBinding({ items: [other] });
  const result = await bootstrapAISearch({ ...context, binding, apply: true, log: () => {} });
  assert.equal(result.added, 3);
  assert.equal(result.skipped, 0);
  assert.equal(binding.data.calls.filter(call => call === 'update').length, 1);
  assert.equal(binding.data.items.length, 4);
  assert.equal(binding.data.items[0], other);
  const expectedKeys = result.evidence.map(document => document.key).sort();
  assert.deepEqual(binding.data.items.slice(1).map(item => item.key).sort(), expectedKeys);
  const second = await bootstrapAISearch({ ...context, binding, apply: true, log: () => {} });
  assert.equal(second.added, 0);
  assert.equal(second.skipped, 3);
  assert.equal(binding.data.calls.filter(call => call === 'upload').length, 3);
  assert.equal(binding.data.calls.filter(call => call === 'update').length, 1);
  for (const file of ['release.json', 'deployment.json', 'ai-search-sync.json']) await assert.rejects(readFile(path.join(context.directory, '.generated', file)), { code: 'ENOENT' });
});

test('bootstrap refuses existing different schemas, Gateway changes, external data sources and different sample hashes before writes', async t => {
  const context = await fixture(t);
  for (const modify of [
    binding => { binding.data.info.custom_metadata = []; },
    binding => { binding.data.info.ai_gateway_id = 'another-gateway'; },
    binding => { binding.data.info.type = 'web-crawler'; binding.data.info.source = SITE_ORIGIN; },
    binding => { binding.data.items.push({ id: 'old', key: context.corpus.documents.find(item => item.url.endsWith(BOOTSTRAP_PATHS[0])).key, source_id: 'builtin', metadata: { content_hash: 'different' } }); },
  ]) {
    const binding = fakeBinding();
    modify(binding);
    await assert.rejects(bootstrapAISearch({ ...context, binding, apply: true, log: () => {} }));
    assert.ok(!binding.data.calls.some(call => ['update', 'upload'].includes(call)));
  }
});

test('a mismatched canonical, title, article body or timestamp stops bootstrap before binding setup', async t => {
  const context = await fixture(t);
  for (const mutateHTML of [
    html => html.replace('rel="canonical"', 'rel="alternate"'),
    html => html.replace('<h1>Sample 0</h1>', '<h1>Changed title</h1>'),
    html => html.replace('Published body 0.', 'Unpublished changed content.'),
  ]) {
    context.options.mutateHTML = mutateHTML;
    let connections = 0;
    await assert.rejects(bootstrapAISearch({ ...context, apply: true, log: () => {}, connectBinding: async () => { connections++; } }));
    assert.equal(connections, 0);
  }
  context.options.mutateHTML = value => value;
  context.options.mutateSitemap = xml => xml.replaceAll('2026-09-08', '2026-09-09');
  await assert.rejects(bootstrapAISearch({ ...context, log: () => {} }), /lastmod/);
});

test('noindex, redirects and changed local document bytes cannot enter bootstrap', async t => {
  const context = await fixture(t);
  context.options.headerRobots = 'noindex, nofollow';
  await assert.rejects(bootstrapAISearch({ ...context, log: () => {} }), /noindex/);
  context.options.headerRobots = '';
  context.options.status = 302;
  await assert.rejects(bootstrapAISearch({ ...context, log: () => {} }), /HTTP 200/);
  context.options.status = 200;
  const document = context.corpus.documents[0];
  await writeFile(path.join(context.directory, '.generated/ai-search/documents', `${document.id}.md`), 'unreviewed bytes');
  await assert.rejects(bootstrapAISearch({ ...context, log: () => {} }), /changed after export/);
});

test('bootstrap rechecks live content and keys just before uploads and never repairs failed index items by overwriting', async t => {
  const context = await fixture(t);
  const binding = fakeBinding({ schema: CUSTOM_METADATA });
  const originalInfo = binding.info;
  let checks = 0;
  binding.info = async () => {
    if (++checks === 2) {
      const document = context.corpus.documents.find(item => item.url.endsWith(BOOTSTRAP_PATHS[0]));
      binding.data.items.push({ id: 'concurrent', key: document.key, source_id: 'builtin', metadata: { content_hash: 'changed concurrently' } });
    }
    return originalInfo();
  };
  await assert.rejects(bootstrapAISearch({ ...context, binding, apply: true, log: () => {} }), /different content hash/);
  assert.ok(!binding.data.calls.includes('upload'));
  const failedBinding = fakeBinding({ schema: CUSTOM_METADATA, items: context.corpus.documents.filter(item => BOOTSTRAP_PATHS.includes(new URL(item.url).pathname)).map((document, index) => ({
    id: `failed-${index}`, key: document.key, source_id: 'builtin', status: 'error', metadata: { content_hash: document.hash },
  })) });
  await assert.rejects(bootstrapAISearch({ ...context, binding: failedBinding, apply: true, log: () => {} }), /indexing failed/);
  assert.ok(!failedBinding.data.calls.includes('upload'));
});
