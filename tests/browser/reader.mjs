import assert from 'node:assert/strict';
import {chromium} from 'playwright';

const base = process.env.BLOG_TEST_URL ?? 'http://127.0.0.1:4321';
const browser = await chromium.launch({headless: true});
try {
  const context = await browser.newContext({viewport: {width: 1440, height: 1000}});
  await context.route(/https:\/\/(?:giscus\.app|www\.googletagmanager\.com|pagead2\.googlesyndication\.com)\//, route => route.abort());
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.setDefaultTimeout(20_000);
  await page.goto(new URL('/posts/this-blog/', base).href);
  await page.locator('[data-reader-root]').waitFor();
  assert.equal(await page.locator('[data-reader-root]').count(), 1);
  assert.equal(await page.locator('[data-reader-root]').evaluate(node => Boolean(node.closest('[data-pagefind-ignore]'))), true);
  assert.equal(await page.locator('[data-reader-root]').evaluate(node => Boolean(node.closest('[data-sentry-mask]'))), true);
  assert.equal(await page.locator('#main-content [data-reader-root]').count(), 0, 'Reader tools must not change the article progress denominator');
  assert.ok(await page.locator('a[href="/me/"]').count() > 0);
  for (const width of [1440, 390]) {
    await page.setViewportSize({width, height: 900});
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Reader toolbar fits the viewport');
  }
  await page.goto(new URL('/me/', base).href);
  await page.locator('[data-reader-root]').waitFor();
  assert.equal(await page.locator('h1').textContent(), '我的阅读');
  assert.match(await page.locator('meta[name="robots"]').getAttribute('content'), /noindex/);
  assert.equal(await page.locator('[data-giscus], .giscus').count(), 0, 'Private account page does not get a public comment thread');
  await page.goto(new URL('/docs/', base).href);
  assert.equal(await page.locator('[data-reader-root]').count(), 0, 'Section indexes do not get article tools');
  assert.deepEqual(errors, []);
  console.log('Reader public-shell browser checks passed: article placement, personal route, noindex, privacy markers and mobile width.');
} finally {await browser.close();}
