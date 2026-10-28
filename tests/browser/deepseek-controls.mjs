import assert from 'node:assert/strict';
import {chromium} from 'playwright';

const browser = await chromium.launch({headless: true, executablePath: process.env.CHROME_PATH});
const base = process.env.BLOG_TEST_URL ?? 'http://127.0.0.1:4321';

try {
  for (const width of [1440, 480, 360]) {
    const page = await browser.newPage({viewport: {width, height: 1000}, reducedMotion: 'no-preference'});
    await page.goto(new URL('/docs/AI/Agents/deepseek-harness-plugin-architecture/', base).href);
    await page.locator('#plugin-lifecycle').waitFor();
    assert.equal(await page.locator('[data-demo="deepseek-plugins"]').count(), 0);
    assert.equal(await page.locator('[aria-label="对照条件"] button').count(), 0, `${width}px scenario count`);
    for (const name of ['移除 ctx.web', '只移除 HTTP provider', '显式 dispose consumer']) {
      assert.equal(await page.getByRole('button', {name, exact: true}).count(), 0, name);
    }
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${width}px has no horizontal overflow`);
    console.log(`PASS DeepSeek controls: ${width}px has no tool-web scenario switch`);
    await page.close();
  }
} finally {
  await browser.close();
}
