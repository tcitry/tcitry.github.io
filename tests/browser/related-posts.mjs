import assert from 'node:assert/strict';
import { chromium } from 'playwright';

// Point this at an independently built preview; this test never builds content.
const base = new URL(process.env.BLOG_TEST_URL ?? 'http://127.0.0.1:4321');
const routes = ['/posts/this-blog/', '/posts/clang-struct-primer/'];
const browser = await chromium.launch({ headless: true });
let checked = 0;

async function waitForAnchorScroll(page, anchor, label) {
  let previousScroll;
  let stableSamples = 0;
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const state = await page.evaluate((id) => {
      const target = document.getElementById(id)?.getBoundingClientRect();
      return { scroll: scrollY, visible: Boolean(target && target.top < innerHeight && target.bottom > 0) };
    }, anchor);
    stableSamples = state.visible && previousScroll === state.scroll ? stableSamples + 1 : 0;
    if (stableSamples >= 2) return;
    previousScroll = state.scroll;
    // Poll from Node: the page deliberately has JavaScript disabled.
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.fail(`${label}: native anchor must scroll the related section into view and settle`);
}

try {
  for (const width of [1440, 375, 320]) {
    const context = await browser.newContext({
      javaScriptEnabled: false,
      serviceWorkers: 'block',
      viewport: { width, height: 1000 },
    });
    // Keep analytics, ads, Giscus and other external resources off the network.
    await context.route('**/*', (route) => new URL(route.request().url()).origin === base.origin
      ? route.continue()
      : route.abort());
    try {
      const page = await context.newPage();
      page.setDefaultTimeout(15000);
      for (const path of routes) {
        const label = `${path} at ${width}px without JavaScript`;
        const response = await page.goto(new URL(path, base).href, { waitUntil: 'load' });
        assert.ok(response?.ok(), `${label}: fixture page must exist`);

        const related = page.locator('section[data-related-posts]');
        assert.equal(await related.count(), 1, `${label}: one related section`);
        assert.equal(await related.isVisible(), true, `${label}: related content is server rendered`);
        assert.equal(await related.getByRole('heading', { level: 2, name: '相关阅读', exact: true }).count(), 1);
        const anchor = await related.getAttribute('id');
        assert.ok(anchor, `${label}: section has a native anchor`);
        assert.equal(await page.locator('[id]').evaluateAll((elements, id) => elements.filter((element) => element.id === id).length, anchor), 1,
          `${label}: anchor does not collide with a content heading`);

        const links = related.locator('a[data-related-post-link]');
        const count = await links.count();
        assert.ok(count >= 1 && count <= 5, `${label}: displays 1–5 recommendations`);
        const destinations = [];
        for (const link of await links.all()) {
          assert.equal(await link.isVisible(), true, `${label}: recommendation link is visible`);
          assert.ok((await link.innerText()).trim(), `${label}: recommendation has a title`);
          const href = await link.getAttribute('href');
          assert.ok(href, `${label}: recommendation has a destination`);
          const destination = new URL(href, base);
          assert.equal(destination.origin, base.origin, `${label}: recommendation stays on this site`);
          assert.notEqual(destination.pathname, path, `${label}: no self recommendation`);
          destinations.push(destination.pathname);
        }
        assert.equal(new Set(destinations).size, destinations.length, `${label}: no duplicate recommendations`);
        const dates = related.locator('time');
        assert.equal(await dates.count(), count, `${label}: every recommendation shows a date`);
        for (const date of await dates.all()) {
          assert.equal(await date.isVisible(), true, `${label}: date is visible`);
          assert.ok((await date.innerText()).trim(), `${label}: date has readable text`);
          const value = await date.getAttribute('datetime');
          assert.ok(value && Number.isFinite(Date.parse(value)), `${label}: date has a valid datetime`);
        }

        const order = await related.evaluate((section) => {
          const article = document.querySelector('article[data-pagefind-body]');
          const comments = document.querySelector('script[src^="https://giscus.app/client.js"]');
          return {
            afterArticle: Boolean(article && article.compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING),
            beforeComments: Boolean(comments && section.compareDocumentPosition(comments) & Node.DOCUMENT_POSITION_FOLLOWING),
            ignoredBySearch: Boolean(section.closest('[data-pagefind-ignore]')),
          };
        });
        assert.deepEqual(order, { afterArticle: true, beforeComments: true, ignoredBySearch: true },
          `${label}: related section follows the article, precedes Giscus and stays outside search indexing`);

        const mobile = width < 1024;
        if (mobile) {
          await page.locator('.book-header label[for="toc-control"]').click();
          assert.equal(await page.locator('#toc-control').isChecked(), true);
        }
        const toc = page.locator(mobile ? '.book-header > aside' : '.book-toc');
        const tocLink = toc.locator('a[data-related-posts-toc]');
        assert.equal(await tocLink.count(), 1, `${label}: relevant TOC contains one related link`);
        assert.equal(await tocLink.isVisible(), true, `${label}: TOC link is visible`);
        const tocHref = await tocLink.getAttribute('href');
        assert.ok(tocHref?.startsWith('#'), `${label}: TOC uses a native fragment link`);
        assert.equal(decodeURIComponent(tocHref.slice(1)), anchor, `${label}: TOC targets the unique section`);
        await tocLink.click();
        await page.waitForURL((url) => decodeURIComponent(url.hash.slice(1)) === anchor);
        await waitForAnchorScroll(page, anchor, label);
        // Without JavaScript the native checkbox stays open. Measure the actual
        // destination instead of clicking the now offscreen header during scroll.

        const layout = await related.evaluate((section) => {
          const article = document.querySelector('article[data-pagefind-body]');
          const column = article.getBoundingClientRect();
          const box = section.getBoundingClientRect();
          const rects = [...section.querySelectorAll('a[data-related-post-link]')].flatMap((link) => [...link.getClientRects()]);
          return {
            noHorizontalOverflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) <= innerWidth + 1,
            sectionInsideColumn: box.left >= column.left - 1 && box.right <= column.right + 1,
            linksInsideColumn: rects.length > 0 && rects.every((rect) => rect.left >= column.left - 1 && rect.right <= column.right + 1),
          };
        });
        assert.deepEqual(layout, { noHorizontalOverflow: true, sectionInsideColumn: true, linksInsideColumn: true },
          `${label}: related links fit within the article column`);
        console.log(`${label}: ${count} recommendations, dates, TOC anchor, placement and layout passed.`);
        checked++;
      }
    } finally {
      await context.close();
    }
  }
  console.log(`Related posts browser regression passed (${checked} page/viewport checks).`);
} finally {
  await browser.close();
}
