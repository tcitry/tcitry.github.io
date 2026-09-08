import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {join} from 'node:path';

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
  await page.locator('[data-chat-launcher]').click();
  const input = page.getByRole('textbox', {name: '向博客助手提问'});
  await input.fill('保留这段未发送的问题');
  await page.getByRole('button', {name: '我的阅读', exact: true}).click();
  await page.locator('#blog-chat-panel [data-reader-root]').waitFor();
  assert.equal(await page.locator('[data-reader-root]').count(), 1);
  assert.equal(await page.locator('[data-reader-root]').evaluate(node => Boolean(node.closest('[data-pagefind-ignore]'))), true);
  assert.equal(await page.locator('[data-reader-root]').evaluate(node => Boolean(node.closest('[data-sentry-mask]'))), true);
  assert.equal(await page.locator('#main-content [data-reader-root]').count(), 0, 'Reader tools must not change the article progress denominator');
  assert.equal(await page.locator('.book-menu a[href="/me/"]').count(), 0);
  assert.equal(await page.locator('[data-blog-chat-widget]').getAttribute('data-reader-pathname'), '/posts/this-blog/');
  await page.getByRole('button', {name: '对话', exact: true}).click();
  assert.equal(await input.inputValue(), '保留这段未发送的问题', 'Switching views retains the chat draft');
  await page.getByRole('button', {name: '我的阅读', exact: true}).click();
  for (const width of [1440, 390]) {
    await page.setViewportSize({width, height: 900});
    await page.evaluate(async () => {
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      await Promise.all(document.getAnimations().filter(animation => animation.effect?.getTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {})));
    });
    if (process.env.BLOG_SCREENSHOT_DIR) await page.screenshot({path: join(process.env.BLOG_SCREENSHOT_DIR, `assistant-reading-${width}.png`)});
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Reader toolbar fits the viewport');
  }
  await page.goto(new URL('/me/', base).href);
  await page.locator('[data-open-reading]').click();
  await page.locator('#blog-chat-panel [data-reader-root]').waitFor();
  assert.equal(await page.locator('h1').textContent(), '我的阅读');
  assert.match(await page.locator('meta[name="robots"]').getAttribute('content'), /noindex/);
  assert.equal(await page.locator('[data-giscus], .giscus').count(), 0, 'Private account page does not get a public comment thread');
  await page.goto(new URL('/docs/', base).href);
  assert.equal(await page.locator('[data-reader-root]').count(), 0, 'Section indexes do not get article tools');
  assert.deepEqual(errors, []);
  console.log('Reader public-shell browser checks passed: article placement, personal route, noindex, privacy markers and mobile width.');
} finally {await browser.close();}
