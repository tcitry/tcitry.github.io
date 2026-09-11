import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import {chromium} from 'playwright';

// Exercise the real command, lazy launcher and AI Search adapter without a full
// blog build, Clerk login, real AI requests, index uploads or remote mutations.
const root = fileURLToPath(new URL('../..', import.meta.url));
const cacheDir = await mkdtemp(join(tmpdir(), 'search-ai-vite-'));
const endpoint = 'https://search.example.com/search';
const site = 'https://example.com';
const hash = 'a'.repeat(64);
const documents = [
  {key: 'docs/fixture.txt', hash, url: `${site}/docs/fixture/`, title: '正文里的安全结果', section: 'docs'},
  {key: 'posts/fast.txt', hash, url: `${site}/posts/fast/`, title: '最新查询结果', section: 'posts'},
  {key: 'weekly/slow.txt', hash, url: `${site}/weekly/slow/`, title: '较早的慢查询结果', section: 'weekly'},
  {key: 'docs/stale.txt', hash, url: `${site}/docs/stale/`, title: '不匹配的旧内容', section: 'docs'},
  {key: 'docs/external.txt', hash, url: 'https://outside.example/docs/external/', title: '外站地址', section: 'docs'},
  {key: 'docs/script.txt', hash, url: 'javascript:alert(1)', title: '脚本地址', section: 'docs'},
].map((document, index) => ({...document, key: `tcitry-blog/articles/${String(index).repeat(64)}.md`}));
const chunk = (index, text = '与当前查询相关的公开文章内容。', overrides = {}) => ({
  score: 0.8, text,
  item: {key: documents[index].key, metadata: {content_hash: documents[index].hash, canonical_url: documents[index].url}},
  ...overrides,
});
const payload = chunks => JSON.stringify({success: true, result: {chunks}});
const server = await createServer({
  root, configFile: false, envDir: false, publicDir: false, cacheDir,
  plugins: [react(), tailwind()],
  optimizeDeps: {entries: ['tests/fixtures/search-ai.html']},
  define: {
    'import.meta.env.AI_SEARCH_PUBLIC_URL': JSON.stringify(endpoint),
    'import.meta.env.SITE': JSON.stringify(site),
  },
  server: {host: '127.0.0.1', port: 0}, logLevel: 'warn',
});
let browser;
const errors = [];
const calls = page => page.evaluate(() => window.__searchAi.calls);
const results = page => page.locator('[data-blog-search-result]');
const input = page => page.locator('[data-blog-search-input]');
const command = page => page.locator('[data-blog-command]');
const waitState = (page, state) => page.locator(`[data-blog-command][data-search-state="${state}"]`).waitFor();
async function assertEngine(page, engine) {
  const source = page.locator('[data-search-engine]');
  assert.equal(await source.count(), 1, 'Completed search identifies exactly one actual result engine');
  assert.equal(await source.getAttribute('data-search-engine'), engine);
  assert.equal(await source.innerText(), engine === 'ai-search' ? '基于 Cloudflare AI Search' : '基于 Pagefind · 全文搜索');
}

async function installRoutes(context, base) {
  const network = {requests: [], pagefind: [], outside: [], retries: 0, references: 0};
  const delayed = new Set();
  await context.addCookies([{name: 'unrelated-session', value: 'fixture-cookie', domain: new URL(endpoint).hostname, path: '/', secure: true, sameSite: 'None'}]);
  await context.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === base.origin && url.pathname.startsWith('/pagefind/')) {
      network.pagefind.push(url.pathname);
      assert.equal(url.pathname, '/pagefind/pagefind.js');
      await route.fulfill({contentType: 'application/javascript', body: `
        export async function search(query) {
          window.__searchAi.pagefindCalls.push(query);
          return {results: Array.from({length: 12}, (_, index) => ({data: async () => ({
            url: '/docs/fulltext-' + (index + 1) + '/',
            meta: {title: '全文结果 ' + (index + 1)}, plain_excerpt: '全文索引匹配：' + query,
          })}))};
        }
      `});
    } else if (url.href === endpoint) {
      const headers = {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type'};
      if (request.method() === 'OPTIONS') {await route.fulfill({status: 204, headers}); return;}
      const body = request.postDataJSON();
      const query = body.query ?? body.messages?.at(-1)?.content;
      network.requests.push({method: request.method(), url: request.url(), headers: request.headers(), body, query});
      const respond = async () => {
        if (query === 'network-failure') {
          await route.abort('failed');
        } else if ((query === 'retry' && network.retries++ === 0) || query === 'slow-failure-ignored') {
          await route.fulfill({status: 503, headers, contentType: 'application/json', body: JSON.stringify({success: false})});
        } else if (query === 'rate-limited' || query === 'server-failure' || query === 'bad-request') {
          await route.fulfill({status: query === 'rate-limited' ? 429 : query === 'server-failure' ? 500 : 400, headers, contentType: 'application/json', body: JSON.stringify({success: false})});
        } else if (query === 'invalid-response') {
          await route.fulfill({status: 200, headers, contentType: 'application/json', body: JSON.stringify({success: true, result: {}})});
        } else {
          const chunks = query === 'empty' ? []
            : query === 'safe' ? [
              chunk(0, 'Keep <img src=x onerror="window.__searchInjected=true"> and <script>window.__searchInjected=true</script> as literal text.'),
              chunk(0, 'Duplicate fragment from the same document.'),
              chunk(3, 'Old content must stay hidden.', {item: {key: documents[3].key, metadata: {content_hash: 'b'.repeat(64), canonical_url: documents[3].url}}}),
              chunk(4), chunk(5),
              chunk(0, 'Changed canonical origin.', {item: {key: documents[0].key, metadata: {content_hash: hash, canonical_url: 'https://outside.example/docs/fixture/'}}}),
              chunk(0, 'Unknown document.', {item: {key: 'unknown.txt', metadata: {content_hash: hash, canonical_url: documents[0].url}}}),
            ]
            : query.startsWith('slow') ? [chunk(2)]
            : [chunk(1, `查询结果：${query}`)];
          await route.fulfill({status: 200, headers, contentType: 'application/json', body: payload(chunks)});
        }
      };
      if (query.startsWith('slow')) {
        const timer = setTimeout(() => {delayed.delete(timer); void respond().catch(() => {});}, 1000);
        delayed.add(timer);
      } else await respond();
    } else if (url.origin !== base.origin) {
      network.outside.push(url.href);
      await route.abort();
    } else if (url.pathname === '/search/references.json') {
      network.references += 1;
      await route.fulfill({contentType: 'application/json', body: JSON.stringify({documents})});
    } else if (url.pathname === '/search/recent.json') {
      await route.fulfill({contentType: 'application/json', body: JSON.stringify([{url: '/docs/fixture/', title: documents[0].title, section: 'docs', updated: '2026-09-10T00:00:00Z'}])});
    } else if (/^\/(docs|posts|weekly)\//.test(url.pathname)) {
      await route.fulfill({contentType: 'text/html; charset=utf-8', body: '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>目标文章</title><body><h1>目标文章</h1></body></html>'});
    } else await route.continue();
  });
  return {network, cleanup: () => {for (const timer of delayed) clearTimeout(timer);}};
}

try {
  await server.listen();
  const base = new URL(server.resolvedUrls.local[0]);
  browser = await chromium.launch({headless: true});
  for (const width of [1440, 320]) {
    const context = await browser.newContext({viewport: {width, height: 900}, reducedMotion: 'reduce', serviceWorkers: 'block'});
    const {network, cleanup} = await installRoutes(context, base);
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    page.on('pageerror', error => errors.push(error.message));
    try {
      const url = new URL('/tests/fixtures/search-ai.html', base).href;
      await page.goto(url);
      await page.waitForFunction(() => document.documentElement.dataset.searchFixtureReady === 'true');
      const trigger = page.locator('[data-blog-search-trigger]');
      await trigger.click();
      await waitState(page, 'recent');
      assert.equal(await page.locator('[data-search-engine]').count(), 0, 'Recent updates are not attributed to a search engine');
      assert.equal(network.requests.length, 0, 'Opening anonymous search does not issue an empty remote search');
      assert.equal(network.references, 0, 'The full public reference list is lazy until the first query');
      await input(page).fill('safe');
      await waitState(page, 'results');
      assert.equal(await results(page).count(), 1, 'Only a current, same-site whitelisted document survives malformed sources and duplicate chunks');
      assert.equal(await results(page).first().getAttribute('href'), '/docs/fixture/');
      assert.match(await results(page).textContent(), /Keep.*literal text/);
      assert.equal(await results(page).locator('img, script').count(), 0, 'HTML-looking snippets render as text, never HTML nodes');
      assert.equal(await page.evaluate(() => window.__searchInjected), undefined);
      assert.deepEqual(network.pagefind, [], 'Successful AI retrieval never loads Pagefind');
      await assertEngine(page, 'ai-search');
      assert.equal(await page.getByRole('button', {name: '重试 AI 搜索', exact: true}).count(), 0);
      const box = await command(page).boundingBox();
      assert.ok(box && box.x >= 0 && box.x + box.width <= width + 1 && box.y >= 0 && box.y + box.height <= 901, `Search fits the ${width}px viewport`);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
      assert.equal(await command(page).evaluate(element => element.scrollWidth > element.clientWidth + 1), false);

      if (width === 1440) {
        await input(page).fill('debounce-draft');
        await page.waitForTimeout(60);
        await input(page).fill('debounce-final');
        await waitState(page, 'results');
        assert.equal(network.requests.some(request => request.query === 'debounce-draft'), false, 'Rapid edits cancel the pending debounce before it contacts AI Search');
        assert.equal(network.requests.at(-1).query, 'debounce-final');
        await input(page).fill('empty');
        await waitState(page, 'results');
        assert.equal(await results(page).count(), 0);
        await page.getByText('没有找到匹配内容，试试其他关键词。', {exact: true}).waitFor();
        await assertEngine(page, 'ai-search');
        await input(page).fill('retry');
        await waitState(page, 'results');
        await page.getByText('AI 搜索暂不可用，当前显示全文搜索结果', {exact: true}).waitFor();
        assert.equal(await results(page).count(), 8);
        assert.ok((await results(page).allTextContents()).every(text => text.includes('全文结果')));
        await assertEngine(page, 'pagefind');
        const remoteBeforePage = network.requests.length;
        await page.getByRole('button', {name: '加载更多', exact: true}).click();
        await waitState(page, 'results');
        assert.equal(await results(page).count(), 12);
        await assertEngine(page, 'pagefind');
        assert.equal(network.requests.length, remoteBeforePage, 'Pagination remains in the actual full-text engine after AI fallback');
        assert.deepEqual(await page.evaluate(() => window.__searchAi.pagefindCalls), ['retry', 'retry']);
        await page.getByRole('button', {name: '重试 AI 搜索', exact: true}).click();
        await waitState(page, 'results');
        assert.equal(network.retries, 2);
        assert.equal(await results(page).count(), 1);
        assert.match(await results(page).textContent(), /最新查询结果/);
        await assertEngine(page, 'ai-search');
        assert.equal(await page.getByText('AI 搜索暂不可用，当前显示全文搜索结果', {exact: true}).count(), 0, 'A successful explicit retry restores the AI engine and clears the fallback notice');
        for (const query of ['rate-limited', 'server-failure', 'network-failure']) {
          await input(page).fill(query);
          await waitState(page, 'results');
          await page.getByText('AI 搜索暂不可用，当前显示全文搜索结果', {exact: true}).waitFor();
          assert.equal(await results(page).count(), 8);
          assert.equal((await page.evaluate(() => window.__searchAi.pagefindCalls)).at(-1), query);
        }
        const fallbackBeforeErrors = await page.evaluate(() => window.__searchAi.pagefindCalls.length);
        await input(page).fill('bad-request');
        await waitState(page, 'error');
        assert.equal(await results(page).count(), 0, 'A 400 response remains an explicit request error');
        assert.equal(await page.locator('[data-search-engine]').count(), 0, 'A failed new query cannot claim the previous result source');
        await input(page).fill('invalid-response');
        await waitState(page, 'error');
        assert.equal(await results(page).count(), 0, 'Malformed API responses remain explicit errors');
        assert.equal(await page.evaluate(() => window.__searchAi.pagefindCalls.length), fallbackBeforeErrors, 'Non-temporary failures are never hidden behind full-text results');

        await input(page).fill('slow');
        await page.waitForFunction(() => window.__searchAi.calls.some(call => call.query === 'slow'));
        assert.equal(await page.locator('[data-search-engine]').count(), 0, 'A pending new query has no completed result source');
        await input(page).fill('fast');
        await waitState(page, 'results');
        await page.waitForFunction(() => window.__searchAi.calls.find(call => call.query === 'slow')?.aborted);
        assert.match(await results(page).textContent(), /最新查询结果/);
        await input(page).fill('slow-ignored');
        await page.waitForFunction(() => window.__searchAi.calls.some(call => call.query === 'slow-ignored'));
        await input(page).fill('latest');
        await waitState(page, 'results');
        await page.waitForFunction(() => window.__searchAi.calls.find(call => call.query === 'slow-ignored')?.settled);
        assert.match(await results(page).textContent(), /最新查询结果/);
        assert.doesNotMatch(await results(page).textContent(), /较早的慢查询结果/);
        assert.equal((await calls(page)).find(call => call.query === 'slow-ignored').aborted, true, 'The replaced query is cancelled even when the transport disregards cancellation');
        const fallbackBeforeCancel = await page.evaluate(() => window.__searchAi.pagefindCalls.length);
        await input(page).fill('slow-failure-ignored');
        await page.waitForFunction(() => window.__searchAi.calls.some(call => call.query === 'slow-failure-ignored'));
        await input(page).fill('newest-after-failure');
        await waitState(page, 'results');
        await page.waitForFunction(() => window.__searchAi.calls.find(call => call.query === 'slow-failure-ignored')?.settled);
        assert.equal(await page.evaluate(() => window.__searchAi.pagefindCalls.length), fallbackBeforeCancel, 'A cancelled old request that later returns 503 never starts Pagefind');
        assert.match(await results(page).textContent(), /最新查询结果/);
        assert.equal(await page.getByRole('button', {name: '重试 AI 搜索', exact: true}).count(), 0);

        await input(page).fill('');
        await waitState(page, 'recent');
        assert.equal(await page.locator('[data-search-engine]').count(), 0, 'Clearing search removes the last result source');
        const beforeComposition = network.requests.length;
        await input(page).dispatchEvent('compositionstart');
        await input(page).fill('中文');
        await waitState(page, 'composing');
        await input(page).press('Enter');
        await input(page).press('Escape');
        await page.waitForTimeout(250);
        assert.equal(network.requests.length, beforeComposition, 'Uncommitted IME text never starts an AI request');
        assert.equal(await command(page).count(), 1, 'IME Enter and Escape do not activate a result or close the command');
        // Native Escape may clear type=search while cancelling an IME. Finish
        // cancellation, then separately commit a composition as a real IME does.
        await input(page).dispatchEvent('compositionend', {data: ''});
        await input(page).dispatchEvent('compositionstart', {data: ''});
        await input(page).fill('中文');
        await input(page).dispatchEvent('compositionend', {data: '中文'});
        await waitState(page, 'results');
        assert.equal(network.requests.at(-1).query, '中文');
      }

      if (width === 320) {
        await input(page).fill('retry');
        await waitState(page, 'results');
        await page.getByText('AI 搜索暂不可用，当前显示全文搜索结果', {exact: true}).waitFor();
        assert.equal(await results(page).count(), 8);
        await assertEngine(page, 'pagefind');
        const source = await page.locator('[data-search-engine]').boundingBox();
        assert.ok(source && source.x >= 0 && source.x + source.width <= width + 1, 'The engine label fits 320px');
        const notice = await page.locator('[data-search-fallback]').boundingBox();
        const retry = await page.getByRole('button', {name: '重试 AI 搜索', exact: true}).boundingBox();
        assert.ok(notice && retry && notice.x >= 0 && notice.x + notice.width <= width + 1 && retry.x + retry.width <= width + 1,
          'The full-text engine notice and AI retry remain usable at 320px');
        assert.equal(await command(page).evaluate(element => element.scrollWidth > element.clientWidth + 1), false);
        await page.screenshot({path: join(tmpdir(), 'search-ai-fallback-320.png'), fullPage: true});
        await page.getByRole('button', {name: '重试 AI 搜索', exact: true}).click();
        await waitState(page, 'results');
        assert.equal(await results(page).count(), 1);
        await assertEngine(page, 'ai-search');
      }

      assert.ok((await calls(page)).every(call => call.credentials === 'omit'), 'Every remote search explicitly omits credentials');
      await input(page).press('Escape');
      await command(page).waitFor({state: 'hidden'});
      await page.waitForFunction(() => document.activeElement?.matches('[data-blog-search-trigger]'));
      await page.keyboard.press('Control+k');
      await input(page).waitFor();
      await page.waitForFunction(() => document.activeElement?.matches('[data-blog-search-input]'));
      await input(page).fill('navigate');
      await waitState(page, 'results');
      await input(page).press('ArrowDown');
      await input(page).press('Enter');
      await page.waitForURL(new URL('/posts/fast/', base).href);
      await page.getByRole('heading', {name: '目标文章'}).waitFor();

      assert.ok(network.requests.length > 0);
      for (const request of network.requests) {
        assert.equal(request.method, 'POST');
        assert.equal(request.url, endpoint);
        assert.equal(request.headers.authorization, undefined, 'Anonymous search never sends an Authorization header');
        assert.equal(request.headers.cookie, undefined, 'AI Search receives no browser session cookie');
        assert.equal(request.body.ai_search_options.retrieval.max_num_results, 50);
        assert.equal(request.body.ai_search_options.query_rewrite.enabled, false);
        assert.equal(request.body.ai_search_options.reranking.enabled, false);
        assert.equal(request.body.ai_search_options.cache.enabled, false);
      }
      assert.deepEqual(network.pagefind, ['/pagefind/pagefind.js'], 'The Pagefind module is lazy and reused only after temporary AI failures');
      assert.deepEqual(network.outside, [], 'Only fixture AI Search and local assets are contacted');
      console.log(`Anonymous AI Search ${width}px: explicit custom HTTPS endpoint, safe source mapping, plain-text snippets, keyboard navigation and viewport checks passed.`);
    } finally {cleanup(); await context.close();}
  }
  assert.deepEqual(errors, [], 'No uncaught browser errors');
  console.log('AI Search temporary fallback/retry, engine-stable pagination, cancellation, stale-response ordering and IME checks passed. No live service was contacted.');
} finally {
  await browser?.close();
  await server.close();
  await rm(cacheDir, {recursive: true, force: true});
}
