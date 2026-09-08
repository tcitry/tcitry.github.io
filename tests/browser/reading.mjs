import assert from 'node:assert/strict';
import { chromium } from 'playwright';

// Run against dev as well as preview: a static build cannot expose Vite's
// missing React preamble or unbundled Mermaid CommonJS dependencies.
const base = process.env.BLOG_TEST_URL ?? 'http://127.0.0.1:4321';
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({
    permissions: ['clipboard-read', 'clipboard-write'],
    viewport: { width: 1440, height: 1000 },
  });
  await context.route(/https:\/\/(?:giscus\.app|www\.googletagmanager\.com|pagead2\.googlesyndication\.com)\//, (route) => route.abort());
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('response', (response) => {
    if (response.url().startsWith(base) && response.status() >= 400) {
      errors.push(`${response.status()} ${response.url()}`);
    }
  });
  const routes = ['/posts/this-blog/', '/docs/Agents/CLI/deepseek-harness-dsh-plugin-agent-architecture/'];
  for (const route of routes) {
    await page.goto(new URL(route, base).href);
    await page.locator('[data-reader-root]').waitFor();
    assert.equal(await page.locator('#main-content astro-island').count(), 0, 'Article code rendering loads independently of the sidebar and reader islands');
    const diagrams = page.locator('pre.mermaid');
    assert.ok(await diagrams.count() > 0, `${route} has Mermaid source`);
    await page.waitForFunction(() => [...document.querySelectorAll('pre.mermaid')].every((diagram) => diagram.querySelector('svg')));
    assert.equal(await page.locator('[data-book-mermaid-error]').count(), 0);

    const blocks = page.locator('[data-blog-code]');
    assert.ok(await blocks.count() > 0, `${route} has code blocks`);
    for (const block of await blocks.all()) {
      await block.scrollIntoViewIfNeeded();
      await block.locator('[data-blog-pro-code]').waitFor();
      assert.equal(await block.locator('[data-blog-code-fallback]').isVisible(), false);
      assert.equal(await block.locator('[data-book-code-copy]').count(), 0, 'Only the Pro component owns code copying');
      const source = await block.locator('[data-blog-code-fallback] pre').textContent();
      await block.getByRole('button', { name: '复制代码', exact: true }).click();
      assert.equal(await page.evaluate(() => navigator.clipboard.readText()), source);
    }
    const diagram = diagrams.first();
    const source = await diagram.getAttribute('data-book-mermaid-source');
    await diagram.locator('xpath=..').locator('[data-book-code-copy]').click();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), source);
    console.log(`${route}: ${await blocks.count()} Pro code blocks and ${await diagrams.count()} Mermaid diagrams rendered; source copying passed.`);
  }
  const checkSidebarRows = async (navigation) => {
    const offsets = await navigation.evaluate((nav) => {
      const textRect = (node) => { const range = document.createRange(); range.selectNodeContents(node); return range.getBoundingClientRect(); };
      return [...nav.querySelectorAll('li')].filter((item) => item.querySelector(':scope > a') && item.querySelector(':scope > span')).map((item) => {
        const label = textRect(item.querySelector(':scope > a'));
        const count = textRect(item.querySelector(':scope > span'));
        return Math.abs(label.y + label.height / 2 - count.y - count.height / 2);
      });
    });
    assert.ok(offsets.length > 0);
    assert.ok(offsets.every((offset) => offset <= 1), 'Sidebar labels and counts align vertically');
  };
  for (const route of ['/links/', '/archives/', '/tags/']) {
    await page.goto(new URL(route, base).href);
    await checkSidebarRows(page.locator('.book-toc nav').first());
    if (route === '/links/') {
      assert.equal(await page.locator('.book-toc p a').evaluate((link) => getComputedStyle(link).display), 'inline', 'RSS stays within the summary paragraph');
    }
  }
  for (const width of [375, 320]) {
    await page.setViewportSize({ width, height: 850 });
    await page.goto(new URL('/links/', base).href);
    await page.locator('.book-header label[for="toc-control"]').click();
    await checkSidebarRows(page.locator('.book-header > aside nav').first());
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Mobile Links has no horizontal overflow');
  }
  console.log('Links, archive and tag sidebar alignment passed; RSS is inline and mobile Links fits 375px/320px.');
  assert.deepEqual(errors, [], 'No browser runtime or local module errors');
} finally {
  await browser.close();
}
