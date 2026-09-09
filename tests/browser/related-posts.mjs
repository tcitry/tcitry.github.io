import assert from 'node:assert/strict';
import { chromium } from 'playwright';

// Point this at an independently built preview; this test never builds content.
const base = new URL(process.env.BLOG_TEST_URL ?? 'http://127.0.0.1:4321');
const routes = ['/posts/this-blog/', '/posts/pulumi-all-apply/', '/posts/clang-struct-primer/'];
const browser = await chromium.launch({ headless: true });
let checked = 0;

try {
  for (const width of [1440, 375, 320]) {
    const context = await browser.newContext({
      javaScriptEnabled: false,
      serviceWorkers: 'block',
      viewport: { width, height: 1000 },
    });
    // Keep analytics, ads, comments and other external resources off the network.
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
        assert.ok(count >= 1 && count <= 6 && count !== 5, `${label}: displays six or four recommendations, or a smaller relevant set`);
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
          assert.equal(await link.locator('.card').count(), 1, `${label}: recommendation uses a static HeroUI card`);
          const title = link.getByRole('heading', { level: 3 });
          assert.equal(await title.count(), 1, `${label}: card title is a heading`);
          assert.equal(await link.getAttribute('aria-labelledby'), await title.getAttribute('id'), `${label}: link name is its article title`);
          const summaries = link.locator('.card__description');
          assert.ok(await summaries.count() <= 1);
          for (const summary of await summaries.all()) {
            assert.ok(!/^AI\s*参与说明/.test((await summary.innerText()).trim()), `${label}: summary omits editorial disclosure`);
            assert.equal(await summary.evaluate((node) => getComputedStyle(node).webkitLineClamp), '2');
          }
          assert.ok(await link.locator('.chip').count() <= 2, `${label}: topic labels stay compact`);
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
          const comments = document.querySelector('[data-convex-comments]');
          return {
            afterArticle: Boolean(article && article.compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING),
            beforeComments: Boolean(comments && section.compareDocumentPosition(comments) & Node.DOCUMENT_POSITION_FOLLOWING),
            ignoredBySearch: Boolean(section.closest('[data-pagefind-ignore]')),
          };
        });
        assert.deepEqual(order, { afterArticle: true, beforeComments: true, ignoredBySearch: true },
          `${label}: related section follows the article, precedes comments and stays outside search indexing`);

        const toc = page.locator('.book-toc, .book-header > aside');
        assert.equal(await toc.locator(`a[href="#${anchor}"]`).count(), 0, `${label}: recommendations are not article TOC entries`);
        assert.equal(await page.locator('[data-related-posts-toc]').count(), 0);
        await related.scrollIntoViewIfNeeded();

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
        if (count > 1) {
          const first = await links.nth(0).boundingBox();
          const second = await links.nth(1).boundingBox();
          assert.ok(first && second);
          if (width === 1440) {
            assert.ok(Math.abs(first.y - second.y) <= 1 && second.x > first.x + first.width, `${label}: two columns on desktop`);
          } else {
            assert.ok(Math.abs(first.x - second.x) <= 1 && second.y >= first.y + first.height, `${label}: one column on mobile`);
          }
        }
        console.log(`${label}: ${count} cards, dates, article-only TOC, placement and layout passed.`);
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
