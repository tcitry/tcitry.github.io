import assert from 'node:assert/strict';
import {mkdir, readFile} from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright';

const base = process.env.BLOG_TEST_URL ?? 'http://127.0.0.1:4321';
const screenshots = process.env.BLOG_SCREENSHOT_DIR;
const content = JSON.parse(await readFile('.generated/content.json', 'utf8'));
const years = content.pages
  .filter((page) => page.kind === 'page' && page.type === 'timeline' && /^timeline\//.test(page.source) && page.date >= '2000')
  .sort((a, b) => b.date.localeCompare(a.date));
assert.ok(years.length > 0, 'The content fixture must contain a published timeline year');
const browser = await chromium.launch({headless: true});
const errors = [];
const aligned = (a, b, label) => assert.ok(Math.abs(a - b) <= 1, `${label}: ${a} vs ${b}`);

async function makeContext(options = {}) {
  const context = await browser.newContext({viewport: {width: 1440, height: 1000}, reducedMotion: 'reduce', ...options});
  await context.route(/https:\/\/(?:giscus\.app|www\.googletagmanager\.com|pagead2\.googlesyndication\.com)\//, (route) => route.abort());
  return context;
}

async function makePage(context) {
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('response', (response) => {
    if (new URL(response.url()).origin === new URL(base).origin && response.status() >= 400) errors.push(`${response.status()} ${response.url()}`);
  });
  return page;
}

async function assertGeometry(page, width) {
  const layout = await page.locator('[data-content-collection="timeline"] .timeline').evaluate((root) => {
    const rect = (node) => {const box = node.getBoundingClientRect(); return {left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width, height: box.height, centerX: box.left + box.width / 2};};
    return {
      pageOverflow: document.documentElement.scrollWidth - innerWidth,
      root: rect(root),
      items: [...root.querySelectorAll(':scope > .timeline__item')].map((item) => {
        const marker = item.querySelector('.timeline__marker');
        const connector = item.querySelector('.timeline__connector');
        return {marker: rect(marker), date: rect(item.querySelector('h2')), connector: connector && getComputedStyle(connector).display !== 'none' ? rect(connector) : null};
      }),
    };
  });
  assert.ok(layout.pageOverflow <= 1, `${width}px: page has no horizontal overflow`);
  for (const [index, item] of layout.items.entries()) {
    assert.ok(item.marker.width >= 20 && item.marker.width <= 36, 'The native Timeline marker remains visible at a readable size');
    aligned(item.marker.width, item.marker.height, 'Timeline markers stay circular');
    aligned(item.marker.centerX, layout.items[0].marker.centerX, 'The chronology rail stays on one axis');
    aligned(item.marker.top + item.marker.height / 2, item.date.top + item.date.height / 2, 'Date and marker share a visual center');
    assert.ok(item.marker.left >= layout.root.left - 1 && item.marker.right <= layout.root.right + 1, 'The marker is not clipped on narrow screens');
    if (index === layout.items.length - 1) {
      assert.equal(item.connector, null, 'The final event has no dangling connector');
    } else {
      assert.ok(item.connector?.width > 0, 'Consecutive events have a visible connector');
      aligned(item.connector.centerX, item.marker.centerX, 'The connector runs through the marker center');
      aligned(item.connector.top, item.marker.bottom, 'The connector starts beneath the marker');
      aligned(item.connector.bottom, layout.items[index + 1].marker.top, 'The connector reaches the following event without a gap or overshoot');
    }
  }
}

try {
  if (screenshots) await mkdir(screenshots, {recursive: true});
  // Compare SSR event content with the imported Blog HTML before any code or
  // image enhancement runs. The existing h2-based parser excludes a preface.
  const staticContext = await makeContext({javaScriptEnabled: false});
  const staticPage = await makePage(staticContext);
  for (const year of years.slice(0, 2)) {
    await staticPage.goto(new URL(year.url, base).href);
    const collection = staticPage.locator('[data-content-collection="timeline"]');
    const fidelity = await collection.evaluate((root, source) => {
      const sourceDocument = new DOMParser().parseFromString(source, 'text/html');
      const headings = [...sourceDocument.body.querySelectorAll('h2')];
      const first = headings[0];
      while (sourceDocument.body.firstChild && sourceDocument.body.firstChild !== first) sourceDocument.body.firstChild.remove();
      const ids = headings.map((heading) => heading.id);
      headings.forEach((heading) => heading.remove());
      const rendered = document.createElement('div');
      for (const entry of root.querySelectorAll('[data-timeline-entry]')) rendered.insertAdjacentHTML('beforeend', entry.innerHTML);
      const snapshot = (node) => ({
        text: node.textContent.replace(/\s+/g, ' ').trim(),
        links: [...node.querySelectorAll('a[href]')].map((link) => link.getAttribute('href')),
        media: [...node.querySelectorAll('img, video, iframe, source')].map((item) => [item.tagName, item.getAttribute('src'), item.getAttribute('srcset'), item.getAttribute('alt')]),
        code: [...node.querySelectorAll('pre code')].map((code) => code.textContent),
      });
      return {expected: snapshot(sourceDocument.body), actual: snapshot(rendered), ids, renderedIds: [...root.querySelectorAll('.timeline > .timeline__item')].map((item) => item.id)};
    }, year.html);
    assert.deepEqual(fidelity.actual, fidelity.expected, `${year.url}: authored text, links, media and exact code survive the Timeline layout`);
    assert.deepEqual(fidelity.renderedIds, fidelity.ids, `${year.url}: original ordering, Top entry and date IDs survive`);
    assert.equal(await collection.locator('select').count(), 1, 'Only one year selector is shown');
    assert.equal(await collection.getByText('浏览所有年份', {exact: true}).count(), 0, 'The duplicate year disclosure is removed');
    assert.equal(await collection.locator('.timeline .card').count(), 0, 'The chronology is not wrapped in a stack of event cards');
    assert.equal(await collection.locator('astro-island').count(), 0, 'Timeline content remains server-rendered without a React hydration boundary');
    console.log(`${year.url}: ${fidelity.ids.length} original groups and all authored content preserved in static HTML.`);
  }
  await staticContext.close();

  const context = await makeContext({permissions: ['clipboard-read', 'clipboard-write']});
  const page = await makePage(context);
  await page.goto(new URL('/timeline/', base).href);
  const selector = page.locator('[data-timeline-year-select]');
  assert.equal(await selector.inputValue(), years[0].url, 'The Timeline entry opens the newest year');
  assert.deepEqual(await selector.locator('option').evaluateAll((options) => options.map((option) => option.value)), years.map((year) => year.url), 'Every published year is available in the selector');
  for (const year of years.slice(1, 2)) {
    await page.locator('[data-timeline-year-select]').selectOption(year.url);
    await page.waitForURL(new URL(year.url, base).href);
    assert.equal(await page.locator('[data-timeline-year-select]').inputValue(), year.url);
  }
  if (years.length > 1) {
    await page.locator('[data-timeline-year-select]').selectOption(years[0].url);
    await page.waitForURL(new URL(years[0].url, base).href);
  }
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({width, height: 1000});
    await page.goto(new URL(years[0].url, base).href);
    await assertGeometry(page, width);
    const items = page.locator('[data-content-collection="timeline"] .timeline > .timeline__item');
    for (const index of [...new Set([0, Math.min(1, await items.count() - 1), await items.count() - 1])]) {
      const target = items.nth(index);
      const id = await target.getAttribute('id');
      await target.locator('h2 a').click();
      assert.equal(decodeURIComponent(new URL(page.url()).hash.slice(1)), id, 'Date permalink retains its exact anchor');
      const bounds = await target.boundingBox();
      assert.ok(bounds.y >= -1 && bounds.y < 1000, 'Clicking the date brings its event into view');
    }
    for (const colorScheme of ['light', 'dark']) {
      await page.emulateMedia({colorScheme});
      await page.goto(new URL(years[0].url, base).href);
      await assertGeometry(page, width);
      await page.locator('[data-timeline-year-select]').focus();
      await page.keyboard.press('Tab');
      assert.ok(await page.locator('[data-content-collection="timeline"] h2 a:focus-visible').count() > 0, 'Date links have keyboard focus');
      if (screenshots) await page.screenshot({path: path.join(screenshots, `timeline-${width}-${colorScheme}.png`), animations: 'disabled'});
    }
    console.log(`${width}px: default Timeline rail, connectors, date anchors and both themes fit.`);
  }
  const code = page.locator('[data-timeline-entry] [data-blog-code]').first();
  if (await code.count()) {
    await code.scrollIntoViewIfNeeded();
    await code.locator('[data-blog-pro-code]').waitFor();
    const expected = await code.locator('[data-blog-code-fallback] pre').textContent();
    await code.getByRole('button', {name: '复制代码', exact: true}).click();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), expected, 'Timeline code retains the shared code renderer and exact copying');
  }
  assert.deepEqual(errors, [], 'No Timeline runtime errors or missing local modules');
} finally {
  await browser.close();
}
