import assert from 'node:assert/strict';
import {chromium} from 'playwright';

const browser = await chromium.launch({headless: true, executablePath: process.env.CHROME_PATH});
const errors = [];
const path = '/docs/AI/Agents/deepseek-harness-plugin-architecture/';
const removedScenarios = ['移除 ctx.web', '只移除 HTTP provider', '显式 dispose consumer'];

async function open(options = {}) {
  const context = await browser.newContext({viewport: {width: 1280, height: 1100}, reducedMotion: 'no-preference', ...options});
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(new URL(path, process.env.BLOG_TEST_URL ?? 'http://127.0.0.1:4321').href, {waitUntil: 'domcontentloaded'});
  await page.locator('#plugin-lifecycle').waitFor();
  return {context, page};
}

try {
  const scene = await open();
  assert.equal(await scene.page.locator('[data-demo="deepseek-plugins"]').count(), 0);
  assert.equal(await scene.page.locator('[aria-label="对照条件"] button').count(), 0);
  for (const name of removedScenarios) {
    assert.equal(await scene.page.getByRole('button', {name, exact: true}).count(), 0, name);
  }
  assert.equal(await scene.page.locator('.mermaid svg').count(), 4);
  assert.equal(await scene.page.locator('.mermaid-error').count(), 0);
  await scene.context.close();

  const small = await open({viewport: {width: 390, height: 844}, reducedMotion: 'reduce', colorScheme: 'light'});
  assert.equal(await small.page.locator('[aria-label="对照条件"] button').count(), 0);
  assert.ok(await small.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'phone has no horizontal overflow');
  await small.context.close();
  assert.deepEqual(errors, []);
  console.log('DeepSeek article: tool-web Anatomy scenario switch is absent; four Mermaid figures and phone layout still hold.');
} finally {
  await browser.close();
}
