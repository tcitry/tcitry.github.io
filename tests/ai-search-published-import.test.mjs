import assert from 'node:assert/strict';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {bootstrapAISearch} from '../scripts/bootstrap-ai-search.mjs';
import {createCorpus, jsonBytes, sha256, SITE_ORIGIN} from '../scripts/lib/ai-search-corpus.mjs';
import {CUSTOM_METADATA} from '../scripts/lib/ai-search-sync.mjs';

async function fixture(t, {lastmod = '2026-09-08T02:59:24Z', count = 4} = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'ai-search-published-'));
  t.after(() => rm(directory, {recursive: true, force: true}));
  const paths = ['/docs/alpha/', '/posts/beta/', '/weekly/gamma/', '/docs/delta/'];
  const pages = Array.from({length: count}, (_, index) => paths[index] ?? `/docs/additional-${index}/`).map((url, index) => ({
    kind: 'page', type: 'docs', url, title: `Public article ${index}`,
    date: '2026-09-01T00:00:00Z', lastmod, tags: ['ByAI'],
    html: `<h2>Section ${index}</h2><p>Published body ${index}.</p><pre><code>const value = ${index};\n\n</code></pre>`,
    source: 'private-source-must-not-be-uploaded.md', params: {privateSetting: 'must-not-be-uploaded'},
  }));
  const livePages = structuredClone(pages);
  const corpus = createCorpus(pages, {environment: 'preview', revision: {siteCommit: 'a'.repeat(40), contentCommit: 'b'.repeat(40)}});
  const generated = path.join(directory, '.generated');
  await mkdir(path.join(generated, 'ai-search/documents'), {recursive: true});
  await writeFile(path.join(generated, 'content.json'), JSON.stringify({pages}));
  await writeFile(path.join(generated, 'ai-search/manifest.json'), jsonBytes(corpus.manifest));
  await writeFile(path.join(generated, 'ai-search/references.json'), jsonBytes(corpus.references));
  for (const document of corpus.documents) await writeFile(path.join(generated, 'ai-search/documents', `${document.id}.md`), document.markdown);
  const options = {
    mutateHTML: html => html, mutateSitemap: xml => xml,
    contentType: () => 'text/html; charset=utf-8', headerRobots: () => '',
  };
  const requests = [];
  const fetchImpl = async (url, init) => {
    requests.push(url);
    assert.equal(init.redirect, 'error');
    assert.equal(init.cache, 'no-store');
    assert.ok(init.signal instanceof AbortSignal);
    assert.equal(new Headers(init.headers).has('authorization'), false);
    if (url === `${SITE_ORIGIN}/sitemap.xml`) {
      const xml = `<urlset>${corpus.documents.map(document => `<url><loc>${document.url}</loc><lastmod>${document.updatedAt}</lastmod></url>`).join('')}</urlset>`;
      return new Response(options.mutateSitemap(xml), {headers: {'content-type': 'application/xml'}});
    }
    const page = livePages.find(page => `${SITE_ORIGIN}${page.url}` === url);
    assert.ok(page, 'Publication checks only request fixed canonical URLs in the local corpus');
    const articleMetadata = {'@type': 'BlogPosting', url, headline: page.title, datePublished: page.date, dateModified: page.lastmod};
    const tags = page.tags.length ? `<p>相关标签：${page.tags.map(tag => `<a href="/tags/${encodeURIComponent(tag)}/">${tag}</a>`).join(' ')}</p>` : '';
    const html = `<html><head><link rel="canonical" href="${url}"><meta property="og:title" content="${page.title}"><script type="application/ld+json">${JSON.stringify(articleMetadata)}</script></head><body class="book-kind-page book-type-${page.type}"><main id="main-content"><h1>${page.title}</h1><article data-pagefind-body>${page.html}</article><div data-pagefind-ignore><h5 class="post-after">文章信息</h5><div>${tags}</div></div></main></body></html>`;
    return new Response(options.mutateHTML(html, page), {headers: {
      'content-type': options.contentType(page), 'x-robots-tag': options.headerRobots(page),
    }});
  };
  return {directory, generated, corpus, pages, livePages, fetchImpl, options, requests};
}

async function rewriteLocalExport(context) {
  context.corpus = createCorpus(context.pages, {environment: 'preview', revision: context.corpus.manifest.revision});
  await writeFile(path.join(context.generated, 'content.json'), JSON.stringify({pages: context.pages}));
  await writeFile(path.join(context.generated, 'ai-search/manifest.json'), jsonBytes(context.corpus.manifest));
  await writeFile(path.join(context.generated, 'ai-search/references.json'), jsonBytes(context.corpus.references));
  for (const document of context.corpus.documents) {
    await writeFile(path.join(context.generated, 'ai-search/documents', `${document.id}.md`), document.markdown);
  }
}

const metadata = document => ({canonical_url: document.url, section: document.section,
  updated_at: document.updatedAt, source_kind: document.sourceKind, content_hash: document.hash});
const existing = (document, overrides = {}) => ({id: `existing-${document.id}`, key: document.key,
  source_id: 'builtin', status: 'completed', next_action: 'INDEX', metadata: metadata(document), ...overrides});

function fakeBinding({items = [], schema = CUSTOM_METADATA, onList, uploadBehavior, infoBehavior, storedBehavior,
  uploadLimit = 1, onRead} = {}) {
  const info = {id: 'tcitry-blog-search', ai_gateway_id: 'tcitry-blog-chat', type: null, source: null, custom_metadata: schema};
  const calls = [];
  let lists = 0;
  let activeReads = 0;
  let activeWrites = 0;
  let maxActiveWrites = 0;
  const read = async callback => {
    assert.equal(activeWrites, 0, 'Remote reads never overlap an upload');
    onRead?.();
    activeReads++;
    try {await Promise.resolve(); return await callback();} finally {activeReads--;}
  };
  return {
    data: {items, info, calls, get maxActiveWrites() {return maxActiveWrites;}},
    info: async () => read(() => {calls.push({operation: 'info'}); return structuredClone(info);}),
    update: async () => {calls.push({operation: 'update'}); throw new Error('Published import cannot modify metadata schema');},
    items: {
      list: async params => read(async () => {
        calls.push({operation: 'list', params});
        assert.equal(Object.hasOwn(params, 'source'), false, 'Every remote source participates in key conflict detection');
        const override = await onList?.(++lists, params, items);
        return override ?? {result: structuredClone(items.slice((params.page - 1) * params.per_page, params.page * params.per_page)), result_info: {total_count: items.length}};
      }),
      upload: async (key, markdown, options) => {
        assert.ok(activeWrites < uploadLimit, 'Uploads respect the configured concurrency limit');
        assert.equal(activeReads, 0, 'Uploads never overlap a paginated inventory or item-status read');
        activeWrites++;
        maxActiveWrites = Math.max(maxActiveWrites, activeWrites);
        try {
          const lastList = calls.findLastIndex(call => call.operation === 'list');
          assert.ok(lastList >= 0 && calls.slice(lastList + 1).every(call => call.operation === 'upload'),
            'Each batch starts from a complete list, followed only by upload submissions');
          calls.push({operation: 'upload', key});
          await Promise.resolve();
          assert.equal(items.some(item => item.key === key), false, 'An observed existing key is never overwritten');
          assert.doesNotMatch(markdown, /private-source|must-not-be-uploaded/);
          assert.ok(Buffer.byteLength(markdown, 'utf8') <= 4 * 1024 * 1024);
          assert.deepEqual(Object.keys(options.metadata).sort(), CUSTOM_METADATA.map(field => field.field_name).sort());
          const item = {id: `uploaded-${items.length}`, key, source_id: 'builtin', status: 'completed', next_action: 'INDEX', metadata: options.metadata};
          items.push(storedBehavior ? await storedBehavior(structuredClone(item)) : item);
          return uploadBehavior ? await uploadBehavior(item) : {id: item.id, key};
        } finally {activeWrites--;}
      },
      info: async id => read(async () => {
        calls.push({operation: 'itemInfo', id});
        const index = items.findIndex(item => item.id === id);
        const item = structuredClone(items[index]);
        const result = infoBehavior ? await infoBehavior(item) : item;
        if (index >= 0) items[index] = structuredClone(result);
        return result;
      }),
      delete: async () => {calls.push({operation: 'delete'}); throw new Error('Published import cannot delete');},
    },
  };
}

const run = (context, options = {}) => bootstrapAISearch({directory: context.directory, fetchImpl: context.fetchImpl,
  publishedOnly: true, uploadConcurrency: 1, log: () => {}, wait: async () => {}, ...options});
const writes = binding => binding.data.calls.filter(call => ['update', 'upload', 'delete'].includes(call.operation));
const articleReadCount = context => context.requests.filter(url => !url.endsWith('/sitemap.xml')).length;

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {resolve = yes; reject = no;});
  return {promise, resolve, reject};
}

test('bounded upload workers process three distinct articles while remote reads wait for every worker', {timeout: 5000}, async t => {
  const context = await fixture(t, {count: 6});
  const firstThree = deferred();
  const visits = new Map();
  let activeArticles = 0;
  let maxActiveArticles = 0;
  let started = 0;
  const binding = fakeBinding({
    uploadLimit: 3,
    onRead: () => assert.equal(activeArticles, 0, 'Inventory and schema reads wait for both fresh HTML checks and uploads'),
    uploadBehavior: async item => {
      const number = ++started;
      if (number === 3) firstThree.resolve();
      try {
        if (number <= 3) await firstThree.promise;
        return {id: item.id, key: item.key};
      } finally {activeArticles--;}
    },
  });
  const result = await run(context, {apply: true, binding, batchSize: 4, uploadConcurrency: 3,
    fetchImpl: async (url, init) => {
      if (!url.endsWith('/sitemap.xml')) {
        const count = (visits.get(url) ?? 0) + 1;
        visits.set(url, count);
        if (count > 1) {
          activeArticles++;
          maxActiveArticles = Math.max(maxActiveArticles, activeArticles);
          assert.ok(activeArticles <= 3, 'The complete fresh-HTML-to-upload operation is bounded to three articles');
        }
      }
      return context.fetchImpl(url, init);
    },
  });
  assert.equal(result.added, 6);
  assert.equal(maxActiveArticles, 3, 'The test exercises real overlap instead of passing a serialized implementation');
  assert.equal(binding.data.maxActiveWrites, 3);
  assert.equal(activeArticles, 0);
  assert.equal(new Set(writes(binding).map(call => call.key)).size, 6, 'Concurrent workers never reuse a key');
  assert.ok([...visits.values()].every(count => count === 2), 'Every submission gets its own fresh public-page check');
  assert.equal(binding.data.calls.filter(call => call.operation === 'itemInfo').length, 0);
});

test('one concurrent upload failure stops new work and waits for other acknowledgements before rejecting', {timeout: 5000}, async t => {
  const context = await fixture(t, {count: 6});
  const threeStarted = deferred();
  const gates = [];
  const logs = [];
  const settledKeys = [];
  const failure = new Error('Controlled upload failure');
  let finished = false;
  const binding = fakeBinding({uploadLimit: 3, uploadBehavior: async item => {
    const gate = deferred();
    gates.push(gate);
    if (gates.length === 3) threeStarted.resolve();
    try {await gate.promise; return {id: item.id, key: item.key};}
    finally {settledKeys.push(item.key);}
  }});
  const outcome = run(context, {apply: true, binding, batchSize: 4, uploadConcurrency: 3, log: line => logs.push(line)})
    .then(value => {finished = true; return {value};}, error => {finished = true; return {error};});
  try {
    await threeStarted.promise;
    assert.equal(writes(binding).length, 3);
    gates[0].reject(failure);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(finished, false, 'A failed upload cannot return while the other requests are in flight');
    assert.equal(writes(binding).length, 3, 'The fourth article in the same batch is never started');
    gates[1].resolve();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(finished, false, 'The remaining outstanding request must also settle');
    assert.ok(logs.some(line => line.includes('submitted 1/6')));
    gates[2].resolve();
    const result = await outcome;
    assert.equal(result.error, failure);
    assert.equal(settledKeys.length, 3);
    assert.equal(writes(binding).length, 3, 'No remaining article or next batch starts after failure');
    assert.equal(articleReadCount(context), 9, 'Only the three started jobs perform a second public-page check');
    assert.ok(logs.some(line => line.includes('submitted 2/6')));
    assert.match(logs.at(-1), /stopped after 3 upload attempts, 2 acknowledged ids and 0 verified indexed articles/);
    assert.ok(logs.every(line => !line.includes('published-only completed')));
    const lastUpload = binding.data.calls.findLastIndex(call => call.operation === 'upload');
    assert.equal(lastUpload, binding.data.calls.length - 1, 'Failure does not start post-batch inventory or indexing reads');
  } finally {
    for (const gate of gates) gate.resolve();
    await outcome;
  }
});

test('published-only dry run verifies current public pages, reports exclusions and connects only for remote reads', async t => {
  const context = await fixture(t);
  for (const modify of [
    () => {context.options.mutateHTML = (html, page) => page.url === context.pages[0].url ? html.replace('Published body 0.', 'A different live body.') : html;},
    () => {context.options.mutateHTML = (html, page) => page.url === context.pages[0].url ? html.replace('</head>', '<meta name="bingbot" content="noindex"></head>') : html;},
    () => {context.options.mutateHTML = (html, page) => page.url === context.pages[0].url ? html.replace('"datePublished":"2026-09-01T00:00:00Z"', '"datePublished":"2026-09-02T00:00:00Z"') : html;},
    () => {context.options.mutateHTML = (html, page) => page.url === context.pages[0].url ? html.replace('"dateModified":"2026-09-08T02:59:24Z"', '"dateModified":"2026-09-09T02:59:24Z"') : html;},
    () => {context.options.mutateHTML = (html, page) => page.url === context.pages[0].url ? html.replace('property="og:title" content="Public article 0"', 'property="og:title" content="Another public title"') : html;},
    () => {context.options.mutateHTML = (html, page) => page.url === context.pages[0].url ? html.replace('book-type-docs', 'book-type-posts') : html;},
    () => {context.options.contentType = page => page.url === context.pages[0].url ? 'application/json' : 'text/html; charset=utf-8';},
  ]) {
    context.options.mutateHTML = html => html;
    context.options.contentType = () => 'text/html; charset=utf-8';
    modify();
    const binding = fakeBinding();
    let connections = 0;
    const result = await run(context, {connectBinding: async () => {connections++; return binding;}});
    assert.equal(result.applied, false);
    assert.equal(result.verified, 3);
    assert.equal(result.unverified, 1);
    assert.equal(result.newDocuments, 3);
    assert.equal(result.conflicts, 0);
    assert.equal(result.unchanged, 0);
    assert.equal(result.evidence.length, 3);
    assert.equal(result.excluded.length, 1);
    assert.equal(result.excluded[0].url, `${SITE_ORIGIN}${context.pages[0].url}`);
    assert.ok(result.excluded[0].reason);
    assert.equal(connections, 1, 'Published-only dry run obtains a complete remote review');
    assert.ok(binding.data.calls.length >= 2);
    assert.ok(binding.data.calls.every(call => ['info', 'list'].includes(call.operation)));
    assert.deepEqual(writes(binding), []);
  }
  for (const name of ['release.json', 'deployment.json', 'ai-search-sync.json']) {
    await assert.rejects(readFile(path.join(context.generated, name)), {code: 'ENOENT'});
  }
  // A self-consistent manifest is not proof that its display metadata belongs
  // to the verified public article; the exporter must reproduce these fields.
  for (const field of ['sourceKind', 'section', 'date']) {
    const poisoned = await fixture(t);
    poisoned.corpus.references.documents[0][field] = 'unpublished-private-metadata';
    poisoned.corpus.manifest.corpusHash = sha256(jsonBytes(poisoned.corpus.manifest.documents));
    await writeFile(path.join(poisoned.generated, 'ai-search/manifest.json'), jsonBytes(poisoned.corpus.manifest));
    await writeFile(path.join(poisoned.generated, 'ai-search/references.json'), jsonBytes(poisoned.corpus.references));
    const binding = fakeBinding();
    const result = await run(poisoned, {binding});
    assert.equal(result.unverified, 1, `The verified exporter must reproduce the ${field} metadata`);
    assert.equal(result.newDocuments, 3);
    assert.doesNotMatch(JSON.stringify(result.excluded), /unpublished-private-metadata/, 'Exclusion reports do not echo rejected metadata values');
    assert.deepEqual(writes(binding), []);
  }
});

test('matching public bodies cannot authorize self-consistent local changes to publication dates or AI attribution', async t => {
  for (const change of [
    page => {page.date = '2026-09-02T00:00:00Z';},
    page => {page.tags = [];},
    page => {page.date = '2026-09-02T00:00:00Z'; page.tags = [];},
  ]) {
    const context = await fixture(t);
    const target = context.pages[0];
    change(target);
    await rewriteLocalExport(context);
    const binding = fakeBinding();
    const result = await run(context, {binding});
    assert.equal(result.verified, 3);
    assert.equal(result.unverified, 1);
    assert.equal(result.excluded[0].url, `${SITE_ORIGIN}${target.url}`);
    assert.equal(result.newDocuments, 3);
    assert.deepEqual(writes(binding), [], 'Local metadata alone cannot establish a public release date or source attribution');
  }
});

test('article headings and unrelated ByAI links cannot substitute for the page title or article footer tags', async t => {
  const headed = await fixture(t);
  const title = headed.pages[0].title;
  headed.pages[0].html += `<h1>${title}</h1>`;
  headed.livePages[0].html = headed.pages[0].html;
  await rewriteLocalExport(headed);
  headed.options.mutateHTML = (html, page) => page.url === headed.pages[0].url
    ? html.replace(`<h1>${title}</h1>`, '<h1>A different outer page title</h1>') : html;
  assert.equal((await run(headed, {binding: fakeBinding()})).unverified, 1, 'An h1 inside the matching body cannot impersonate the outer page title');

  const author = await fixture(t);
  author.pages[0].tags = [];
  author.livePages[0].tags = [];
  await rewriteLocalExport(author);
  author.options.mutateHTML = (html, page) => page.url === author.pages[0].url
    ? html.replace('<main id="main-content">', '<nav><a href="/tags/ByAI/">ByAI</a></nav><main id="main-content">')
      .replace('</main>', '<section data-pagefind-ignore class="related-posts"><h5>相关阅读</h5><p>相关标签：<a href="/tags/ByAI/">ByAI</a></p></section></main>') : html;
  const result = await run(author, {binding: fakeBinding()});
  assert.equal(result.unverified, 0, 'Navigation and related-post tags do not turn an author article into AI-assisted content');
  assert.equal(result.verified, 4);
  author.pages[0].tags = ['ByAI'];
  await rewriteLocalExport(author);
  const spoofed = await run(author, {binding: fakeBinding()});
  assert.equal(spoofed.unverified, 1, 'Unrelated ByAI links cannot validate a locally claimed AI-assisted source kind');
  assert.equal(spoofed.excluded[0].url, `${SITE_ORIGIN}${author.pages[0].url}`);
});

test('all existing sources and incomplete metadata become conflicts instead of overwrite candidates', async t => {
  const context = await fixture(t);
  const document = context.corpus.documents[0];
  const matching = fakeBinding({items: [existing(document)]});
  const unchanged = await run(context, {binding: matching});
  assert.equal(unchanged.unchanged, 1);
  assert.equal(unchanged.newDocuments, 3);
  for (const updated_at of [
    Date.parse(document.updatedAt),
    document.updatedAt.replace(/Z$/, '+00:00'),
    new Date(Date.parse(document.updatedAt) + 8 * 60 * 60 * 1000).toISOString().replace(/Z$/, '+08:00'),
  ]) {
    const equivalent = await run(context, {binding: fakeBinding({items: [existing(document, {metadata: {...metadata(document), updated_at}})]})});
    assert.equal(equivalent.unchanged, 1, 'Strict RFC3339 offsets and epoch milliseconds preserve the exact local ISO instant');
    assert.equal(equivalent.conflicts, 0);
  }
  for (const override of [
    {source_id: 'crawler'}, {source_id: undefined}, {status: 'error'}, {status: 'queued'},
    {next_action: 'DELETE'}, {metadata: undefined},
    ...Object.keys(metadata(document)).map(field => ({metadata: {...metadata(document), [field]: 'different'}})),
    {metadata: {content_hash: document.hash}},
    ...[Math.floor(Date.parse(document.updatedAt) / 1000), Date.parse(document.updatedAt) + 1, Number.MAX_SAFE_INTEGER + 1,
      String(Date.parse(document.updatedAt)), new Date(document.updatedAt).toUTCString(),
      document.updatedAt.replace('T', ' '), document.updatedAt.replace(/Z$/, ''), document.updatedAt.replace('.000Z', '.0000Z')]
      .map(updated_at => ({metadata: {...metadata(document), updated_at}})),
    ...['canonical_url', 'section', 'source_kind', 'content_hash'].map(field => ({metadata: {...metadata(document), [field]: [metadata(document)[field]]}})),
  ]) {
    const binding = fakeBinding({items: [existing(document, override)]});
    const result = await run(context, {binding});
    assert.equal(result.conflicts, 1, `Existing ${JSON.stringify(override)} is a conflict`);
    assert.equal(result.unchanged, 0);
    assert.equal(result.newDocuments, 3);
    assert.deepEqual(writes(binding), []);
  }
  const duplicates = fakeBinding({items: [existing(document), existing(document, {id: 'other-source', source_id: 'crawler'})]});
  const duplicateResult = await run(context, {binding: duplicates});
  assert.equal(duplicateResult.conflicts, 1, 'Multiple sources sharing a key block that document');
  assert.equal(duplicateResult.newDocuments, 3);
  assert.deepEqual(writes(duplicates), []);
  const calendar = await fixture(t, {lastmod: '2026-03-02T00:00:00Z'});
  const calendarDocument = calendar.corpus.documents[0];
  const invalidCalendar = fakeBinding({items: [existing(calendarDocument, {metadata: {
    ...metadata(calendarDocument), updated_at: '2026-02-30T00:00:00Z',
  }})]});
  const invalidDateResult = await run(calendar, {binding: invalidCalendar});
  assert.equal(invalidDateResult.conflicts, 1, 'Invalid calendar dates must not normalize into an otherwise matching RFC3339 instant');
  assert.equal(invalidDateResult.unchanged, 0);
});

test('published import requires the exact existing schema and complete stable pagination across every source', async t => {
  const context = await fixture(t);
  for (const schema of [null, [], CUSTOM_METADATA.slice(1), [...CUSTOM_METADATA, CUSTOM_METADATA[0]],
    [...CUSTOM_METADATA, {field_name: 'extra', data_type: 'text'}]]) {
    const binding = fakeBinding({schema});
    await assert.rejects(run(context, {binding}), /schema|metadata/i);
    assert.deepEqual(writes(binding), []);
  }
  const items = Array.from({length: 51}, (_, index) => ({id: `unrelated-${index}`, key: `manual-${index}.md`, source_id: index % 2 ? 'crawler' : 'builtin'}));
  const complete = fakeBinding({items});
  assert.equal((await run(context, {binding: complete})).newDocuments, 4);
  const listedPages = complete.data.calls.filter(call => call.operation === 'list').map(call => call.params.page);
  assert.ok(listedPages.length >= 2, 'The remote snapshot includes every page');
  assert.deepEqual([...new Set(listedPages)].sort(), [1, 2]);
  for (const onList of [
    (count, params) => params.page === 2 ? {result: [items[50]], result_info: {total_count: 52}} : undefined,
    (count, params) => params.page === 2 ? {result: [items[0]], result_info: {total_count: 51}} : undefined,
    (count, params) => params.page === 2 ? {result: [], result_info: {total_count: 51}} : undefined,
  ]) {
    const binding = fakeBinding({items: structuredClone(items), onList});
    await assert.rejects(run(context, {binding}), /pagination|changed|inconsistent|incomplete|partial/i);
    assert.deepEqual(binding.data.calls.filter(call => call.operation === 'list').map(call => call.params.page), [1, 2, 1, 2, 1, 2],
      'Unstable inventories receive bounded complete retries without merging partial pages');
    assert.deepEqual(writes(binding), []);
  }
  let reordered = false;
  const recovered = fakeBinding({items: structuredClone(items), onList: (count, params) => {
    if (!reordered && params.page === 2) {
      reordered = true;
      return {result: [items[0]], result_info: {total_count: 51}};
    }
  }});
  assert.equal((await run(context, {binding: recovered})).newDocuments, 4);
  assert.deepEqual(recovered.data.calls.filter(call => call.operation === 'list').slice(0, 4).map(call => call.params.page), [1, 2, 1, 2],
    'A temporary page reorder can recover only by reading a fresh complete snapshot');
  assert.deepEqual(writes(recovered), []);
});

test('apply adds only a verified missing document while preserving existing and unverified records', async t => {
  const context = await fixture(t);
  const [same, conflicting, excluded, added] = context.corpus.documents;
  context.options.mutateHTML = (html, page) => `${SITE_ORIGIN}${page.url}` === excluded.url ? html.replace('Published body', 'Changed live body') : html;
  const items = [existing(same), existing(conflicting, {source_id: 'crawler'})];
  const before = structuredClone(items);
  let polls = 0;
  const binding = fakeBinding({items, storedBehavior: item => ({...item, status: 'queued'}), infoBehavior: item => ({...item,
    status: ++polls === 1 ? 'queued' : polls === 2 ? 'running' : 'completed',
  })});
  const result = await run(context, {apply: true, binding});
  assert.equal(result.applied, true);
  assert.equal(result.added, 1);
  assert.equal(result.skipped, 1);
  assert.equal(result.conflicts, 1);
  assert.equal(result.unverified, 1);
  assert.deepEqual(writes(binding), [{operation: 'upload', key: added.key}]);
  assert.equal(polls, 3, 'Queued and running imports are verified through reads until completed without resubmission');
  assert.deepEqual(binding.data.items.slice(0, 2), before);
  assert.deepEqual(binding.data.items[2].metadata, metadata(added));
  const again = await run(context, {apply: true, binding});
  assert.equal(again.added, 0);
  assert.equal(again.skipped, 2);
  assert.equal(writes(binding).length, 1, 'Repeated apply remains idempotent for exact completed items');
  for (const name of ['release.json', 'deployment.json', 'ai-search-sync.json']) {
    await assert.rejects(readFile(path.join(context.generated, name)), {code: 'ENOENT'});
  }
});

test('changes after the initial review abort apply before uploading stale or newly nonpublic content', async t => {
  const changes = [
    async context => {context.options.mutateHTML = html => html.replace('Published body', 'Changed live body');},
    async context => {context.options.mutateSitemap = xml => xml.replaceAll('2026-09-08', '2026-09-09');},
    async context => {context.options.headerRobots = () => 'noindex';},
    async (context, binding) => {binding.data.info.custom_metadata = [];},
    ...['content.json', 'ai-search/manifest.json', 'ai-search/references.json'].map(name => async context => {
      const filename = path.join(context.generated, name);
      await writeFile(filename, (await readFile(filename, 'utf8')) + '\n');
    }),
    async context => {await writeFile(path.join(context.generated, 'ai-search/documents', `${context.corpus.documents[0].id}.md`), 'Different local bytes');},
  ];
  for (const change of changes) {
    const context = await fixture(t);
    let changed = false;
    const binding = fakeBinding({onList: async () => {
      if (!changed && articleReadCount(context) === context.corpus.documents.length) {
        changed = true;
        await change(context, binding);
      }
    }});
    await assert.rejects(run(context, {apply: true, binding}));
    assert.equal(changed, true, 'The fixture changes only after every article has passed the initial public review');
    assert.deepEqual(writes(binding), [], 'A changed publication or export blocks every upload');
  }
});

test('new key conflicts are preserved and upload or indexing failures never report a completed import', async t => {
  const context = await fixture(t);
  const target = context.corpus.documents[2];
  const concurrent = fakeBinding({onList: (count, params, items) => {
    if (items.filter(item => item.source_id === 'builtin').length >= 2 && !items.some(item => item.key === target.key)) {
      items.push(existing(target, {source_id: 'crawler'}));
    }
  }});
  const result = await run(context, {apply: true, binding: concurrent, batchSize: 2});
  assert.equal(result.conflicts, 1);
  assert.equal(result.added, 3);
  assert.equal(writes(concurrent).some(call => call.key === target.key), false, 'The next batch preserves a conflicting key discovered after the first batch');
  assert.equal(concurrent.data.calls.some(call => call.operation === 'itemInfo'), false,
    'Completed items are verified from post-batch inventory without individual polling');
  const uploadRuns = [];
  for (const call of concurrent.data.calls) {
    if (call.operation === 'upload') uploadRuns[uploadRuns.length - 1] = (uploadRuns.at(-1) ?? 0) + 1;
    else uploadRuns.push(0);
  }
  assert.equal(Math.max(...uploadRuns), 2, 'The injectable batch limit bounds uninterrupted submissions');
  assert.equal(new Set(writes(concurrent).map(call => call.key)).size, 3, 'Accepted keys stay unique within the local batch state');

  const paginated = fakeBinding({
    items: Array.from({length: 51}, (_, index) => ({id: `manual-${index}`, key: `manual-${index}.md`, source_id: index % 2 ? 'crawler' : 'builtin'})),
    storedBehavior: item => ({...item, metadata: {...item.metadata, updated_at: Date.parse(item.metadata.updated_at)}}),
  });
  assert.equal((await run(context, {apply: true, binding: paginated, batchSize: 2})).added, 4,
    'Batch receipts accept the exact epoch-millisecond datetime returned by Cloudflare');
  const listedPages = paginated.data.calls.filter(call => call.operation === 'list').map(call => call.params.page);
  assert.ok(listedPages.length >= 8, 'Both batches obtain complete inventories before and after submission');
  assert.ok(listedPages.every((page, index) => page === index % 2 + 1), 'Every paginated batch inventory restarts at page one and includes page two');
  assert.ok(paginated.data.calls.findLastIndex(call => call.operation === 'list') > paginated.data.calls.findLastIndex(call => call.operation === 'upload'),
    'The final batch also receives a complete post-upload inventory check');
  assert.equal(paginated.data.calls.some(call => call.operation === 'itemInfo'), false, 'Completed paginated batches need no per-item polling');
  assert.equal(writes(paginated).length, 4);
  for (const uploadBehavior of [
    item => ({id: item.id, key: 'different-key.md'}),
    item => ({key: item.key}),
    () => {throw new Error('Uncertain upload failure');},
  ]) {
    const binding = fakeBinding({uploadBehavior});
    await assert.rejects(run(context, {apply: true, binding}));
    assert.equal(writes(binding).length, 1, 'An uncertain or invalid submission stops the batch without retrying writes');
  }
  const duplicateId = fakeBinding({uploadBehavior: item => ({id: 'same-accepted-id', key: item.key})});
  await assert.rejects(run(context, {apply: true, binding: duplicateId, batchSize: 2}));
  assert.equal(writes(duplicateId).length, 2, 'An accepted ID cannot replace a previously submitted item in the same batch');

  for (const storedBehavior of [
    item => ({...item, source_id: 'crawler'}),
    item => ({...item, metadata: {...item.metadata, content_hash: 'different'}}),
    item => ({...item, status: 'error'}),
  ]) {
    const binding = fakeBinding({storedBehavior});
    await assert.rejects(run(context, {apply: true, binding, batchSize: 2}));
    assert.equal(writes(binding).length, 2, 'A failed post-batch inventory check stops before the next batch submits');
    assert.equal(binding.data.calls.some(call => call.operation === 'itemInfo'), false, 'A known invalid indexed result never needs further polling');
  }
  for (const infoBehavior of [
    item => ({...item, id: 'different-item'}),
    item => ({...item, source_id: 'crawler'}),
    item => ({...item, key: 'different-key.md'}),
    item => ({...item, metadata: {...item.metadata, content_hash: 'different'}}),
    item => ({...item, metadata: {...item.metadata, canonical_url: 'https://outside.example/docs/other/'}}),
    item => ({...item, status: 'error'}),
    item => ({...item, status: 'queued'}),
    () => {throw new Error('Index status unavailable');},
  ]) {
    const binding = fakeBinding({storedBehavior: item => ({...item, status: 'queued'}), infoBehavior});
    const logs = [];
    await assert.rejects(run(context, {apply: true, binding, polling: {maxAttempts: 2, intervalMs: 0}, log: line => logs.push(line)}));
    const firstInfo = binding.data.calls.findIndex(call => call.operation === 'itemInfo');
    assert.ok(firstInfo >= 0, 'The importer checks the indexed result through item info');
    assert.equal(binding.data.calls.slice(firstInfo + 1).some(call => ['upload', 'update', 'delete'].includes(call.operation)), false,
      'Failed indexing verification never triggers another write or blind retry');
    assert.equal(writes(binding).length, context.corpus.documents.length, 'Index verification follows serialized submissions');
    assert.equal(logs.some(line => /published-only completed:/.test(line)), false, 'A submission response is never reported as completed indexing');
  }
});
