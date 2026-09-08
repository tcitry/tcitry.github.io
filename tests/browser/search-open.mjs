import assert from 'node:assert/strict';
import {chromium} from 'playwright';

const base = new URL(process.env.BLOG_TEST_URL ?? 'http://127.0.0.1:4321');
const browser = await chromium.launch({headless: true});
try {
  const page = await browser.newPage();
  const failures = [];
  page.on('pageerror', error => failures.push(error.message));
  page.on('requestfailed', request => {
    // Closing search or navigating deliberately aborts its recent-items fetch.
    if (new URL(request.url()).origin === base.origin && request.resourceType() === 'script') {
      failures.push(`${request.url()}: ${request.failure()?.errorText}`);
    }
  });
  page.on('response', response => {
    if (new URL(response.url()).origin === base.origin && response.status() >= 400) failures.push(`${response.status()} ${response.url()}`);
  });
  for (const path of ['/', '/timeline/']) {
    await page.goto(new URL(path, base).href);
    await page.locator('[data-blog-search-trigger]:visible').click();
    try {
      await page.locator('[data-blog-search-input]').waitFor({state: 'visible', timeout: 10000});
      await page.locator('[data-blog-search-input]').press('Escape');
      await page.locator('[data-blog-search-input]').waitFor({state: 'detached'});
    } catch (error) {
      throw new Error(`Search did not open on ${path}:\n${failures.join('\n')}`, {cause: error});
    }
  }
  assert.deepEqual(failures, []);
  console.log('Search opens and closes on the home and timeline pages.');
} finally {
  await browser.close();
}
