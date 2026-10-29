import assert from 'node:assert/strict';
import {mkdtemp, mkdir, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import {chromium} from 'playwright';

// The real search dialog against a local Pagefind stand-in. No blog build, AI endpoint, or content checkout.
const root = fileURLToPath(new URL('../..', import.meta.url));
const cacheDir = await mkdtemp(join(tmpdir(), 'search-panel-vite-'));
const server = await createServer({
  root, configFile: false, envDir: false, publicDir: false, cacheDir,
  plugins: [react(), tailwind()],
  optimizeDeps: {entries: ['tests/fixtures/search-panel.html']},
  server: {host: '127.0.0.1', port: 0}, logLevel: 'warn',
});
const pagefindModule = `
  const sections = ['docs', 'posts', 'weekly'];
  export async function search(query) {
    const trace = window.__searchPanel;
    trace.calls.push(query);
    if (trace.calls.length > 1) await new Promise((resolve) => setTimeout(resolve, 250));
    return {results: Array.from({length: 20}, (_, index) => ({data: async () => ({
      url: '/' + sections[index % 3] + '/item-' + (index + 1) + '/',
      meta: {title: '结果 ' + (index + 1)},
      plain_excerpt: '摘要 ' + query,
    })}))};
  }
`;
let browser;
const errors = [];

async function saveShot(page, name) {
  if (!process.env.SEARCH_ARTIFACTS) return;
  await mkdir(process.env.SEARCH_ARTIFACTS, {recursive: true});
  await page.screenshot({path: join(process.env.SEARCH_ARTIFACTS, name)});
}

try {
  await server.listen();
  const base = new URL(server.resolvedUrls.local[0]);
  browser = await chromium.launch({headless: true});
  for (const width of [1440, 390]) {
    const context = await browser.newContext({viewport: {width, height: 900}, reducedMotion: 'reduce', serviceWorkers: 'block'});
    await context.addInitScript(() => { window.__searchPanel = {calls: []}; });
    await context.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.origin === base.origin && url.pathname === '/pagefind/pagefind.js') {
        await route.fulfill({contentType: 'application/javascript', body: pagefindModule});
      } else if (url.origin === base.origin && url.pathname === '/search/recent.json') {
        await route.fulfill({contentType: 'application/json', body: JSON.stringify([
          {url: '/docs/fixture/', title: '最近的文档', section: 'docs', updated: '2026-09-10T00:00:00Z'},
        ])});
      } else if (url.origin !== base.origin) {
        await route.abort();
      } else await route.continue();
    });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    page.on('pageerror', (error) => errors.push(error.message));
    try {
      await page.goto(new URL('/tests/fixtures/search-panel.html', base).href);
      await page.waitForFunction(() => document.documentElement.dataset.searchFixtureReady === 'true');
      await page.locator('[data-blog-search-trigger]').click();
      await page.locator('[data-blog-command][data-search-state="recent"]').waitFor();
      assert.equal(await page.locator('[data-search-kind]').getAttribute('data-search-kind'), '文档');
      assert.match(await page.locator('[data-search-kind]').evaluate((element) => element.className), /chip--accent/);

      await page.locator('[data-blog-search-input]').fill('cloudflare');
      await page.locator('[data-blog-command][data-search-state="results"]').waitFor();
      await page.waitForFunction(() => document.querySelectorAll('[data-blog-search-result]').length === 8);
      assert.equal(await page.getByRole('button', {name: '加载更多', exact: true}).count(), 0);
      assert.match(await page.locator('[data-search-status]').innerText(), /找到 20 条结果，已显示 8 条/);
      const kinds = await page.locator('[data-search-kind]').evaluateAll((nodes) => nodes.map((node) => ({
        label: node.getAttribute('data-search-kind'),
        className: node.className,
        background: getComputedStyle(node).backgroundColor,
      })));
      assert.deepEqual(kinds.map((kind) => kind.label), ['文档', '文章', '周刊', '文档', '文章', '周刊', '文档', '文章']);
      assert.ok(kinds[0].className.includes('chip--accent') && kinds[0].className.includes('chip--sm') && kinds[0].className.includes('chip--soft'));
      assert.ok(kinds[1].className.includes('chip--success'));
      assert.ok(kinds[2].className.includes('chip--warning'));
      assert.equal(new Set(kinds.slice(0, 3).map((kind) => kind.background)).size, 3, 'each result kind uses a different chip color');
      const placement = await page.locator('[data-blog-search-result]').first().evaluate((row) => {
        const chip = row.querySelector('[data-search-kind]');
        const title = row.querySelector('[data-search-title]');
        const chipBox = chip.getBoundingClientRect();
        const titleBox = title.getBoundingClientRect();
        return {
          chipBeforeTitle: chipBox.right <= titleBox.left + 1,
          sameRow: chipBox.top < titleBox.bottom && titleBox.top < chipBox.bottom,
        };
      });
      assert.deepEqual(placement, {chipBeforeTitle: true, sameRow: true});
      const footer = await page.evaluate(() => {
        const footerNode = document.querySelector('[data-search-status]').parentElement;
        const statusBox = document.querySelector('[data-search-status]').getBoundingClientRect();
        const askBox = document.querySelector('[data-search-ask-ai]').getBoundingClientRect();
        const footerBox = footerNode.getBoundingClientRect();
        return {
          askLeft: askBox.left - footerBox.left,
          statusRight: footerBox.right - statusBox.right,
          sameRow: askBox.top < statusBox.bottom && statusBox.top < askBox.bottom,
        };
      });
      assert.ok(footer.askLeft <= 28, `Ask AI stays left (${footer.askLeft}px)`);
      assert.ok(footer.statusRight <= 28, `result count stays right (${footer.statusRight}px)`);
      if (width >= 768) assert.equal(footer.sameRow, true);
      await saveShot(page, `search-panel-${width}.png`);

      const loading = page.locator('[data-search-loading-more]');
      const sawLoading = loading.waitFor({state: 'visible'});
      await page.locator('[data-search-results]').evaluate((list) => {
        list.scrollTop = list.scrollHeight;
        list.dispatchEvent(new Event('scroll'));
      });
      await sawLoading;
      assert.match(await page.locator('[data-search-status]').innerText(), /已显示 8 条/);
      await page.locator('[data-search-results]').evaluate((list) => {
        list.scrollTop = list.scrollHeight;
        list.dispatchEvent(new Event('scroll'));
      });
      await page.waitForFunction(() => document.querySelectorAll('[data-blog-search-result]').length === 16);
      assert.equal(await page.evaluate(() => window.__searchPanel.calls.length), 2, 'a second scroll while the next page is loading does not start another request');
      assert.match(await page.locator('[data-search-status]').innerText(), /已显示 16 条/);
      await saveShot(page, `search-panel-more-${width}.png`);

      await page.locator('[data-search-results]').evaluate((list) => {
        list.scrollTop = list.scrollHeight;
        list.dispatchEvent(new Event('scroll'));
      });
      await page.waitForFunction(() => document.querySelectorAll('[data-blog-search-result]').length === 20);
      assert.match(await page.locator('[data-search-status]').innerText(), /^找到 20 条结果$/);
      assert.equal(await loading.count(), 0);
      const calls = await page.evaluate(() => window.__searchPanel.calls.length);
      await page.locator('[data-search-results]').evaluate((list) => {
        list.scrollTop = list.scrollHeight;
        list.dispatchEvent(new Event('scroll'));
      });
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.equal(await page.evaluate(() => window.__searchPanel.calls.length), calls, 'scrolling after the last page does not fetch again');
      assert.equal(await page.getByRole('button', {name: '加载更多', exact: true}).count(), 0);
      console.log(`Search panel at ${width}px: chips, footer, and infinite scroll passed.`);
    } finally {
      await context.close();
    }
  }
  assert.deepEqual(errors, [], 'No uncaught browser errors');
} finally {
  await browser?.close();
  await server.close();
  await rm(cacheDir, {recursive: true, force: true});
}
