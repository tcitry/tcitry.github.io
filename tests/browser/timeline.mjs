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
      article: rect(root.closest('.book-article')),
      collection: rect(root.closest('[data-content-collection="timeline"]')),
      root: rect(root),
      items: [...root.querySelectorAll(':scope > .timeline__item')].map((item) => {
        const marker = item.querySelector('.timeline__marker');
        const connector = item.querySelector('.timeline__connector');
        const meta = item.querySelector('[data-timeline-meta]');
        const body = item.querySelector('[data-timeline-body]');
        const date = meta.querySelector('h2');
        const linksOnly = item.getAttribute('data-timeline-links-only') === 'true';
        return {
          id: item.id,
          event: rect(item),
          linksOnly,
          links: linksOnly ? [...body.querySelectorAll('a[href]')]
            .filter((anchor) => /^https?:\/\//i.test(anchor.getAttribute('href')))
            .map((anchor) => ({...rect(anchor), pointerEvents: getComputedStyle(anchor).pointerEvents})) : [],
          marker: rect(marker),
          icon: rect(marker.querySelector('svg')),
          meta: rect(meta),
          metaText: meta.innerText.trim(),
          dateText: date.innerText.trim(),
          metaChipCount: meta.querySelectorAll('.chip').length,
          body: rect(body),
          bodyCardCount: body.querySelectorAll('.card').length,
          date: rect(date),
          dateLineHeight: parseFloat(getComputedStyle(date).lineHeight),
          connector: connector && getComputedStyle(connector).display !== 'none' ? rect(connector) : null,
        };
      }),
    };
  });
  assert.ok(layout.pageOverflow <= 1, `${width}px: page has no horizontal overflow`);
  aligned(layout.collection.width, layout.article.width, 'Timeline preserves the full article width');
  aligned(layout.collection.left, layout.article.left, 'Timeline begins at the article edge');
  aligned(layout.root.width, layout.collection.width, 'Split Content does not inherit the narrow demo width');
  assert.ok(layout.items.some((item) => item.linksOnly), 'The newest Timeline exercises the compact link-only layout');
  const split = layout.collection.width >= 576;
  for (const [index, item] of layout.items.entries()) {
    aligned(item.marker.width, 22, 'Small native Timeline markers stay 22px wide');
    aligned(item.marker.width, item.marker.height, 'Timeline markers stay circular');
    assert.ok(item.icon.width > 0 && item.icon.height > 0, 'Every Timeline marker has a visible SVG icon');
    assert.ok(item.icon.width < item.marker.width && item.icon.height < item.marker.height, 'Icons fit inside their markers');
    aligned(item.marker.centerX, layout.items[0].marker.centerX, 'The chronology rail stays on one axis');
    aligned(item.marker.top + item.marker.height / 2, item.date.top + item.date.height / 2, 'Date and marker share a visual center');
    assert.ok(item.date.height <= item.dateLineHeight + 1, 'The date stays on one line');
    assert.ok(item.marker.left >= layout.root.left - 1 && item.marker.right <= layout.root.right + 1, 'The marker is not clipped on narrow screens');
    aligned(item.body.right, layout.root.right, 'Event content uses the full available content column');
    if (split) {
      assert.ok(item.meta.right <= item.marker.left, 'Desktop metadata sits to the left of the rail');
      assert.ok(item.marker.right < item.body.left, 'Desktop content sits to the right of the rail');
      assert.ok(item.body.top <= item.meta.bottom && item.meta.top <= item.body.bottom, 'Desktop metadata and content share a row');
    } else {
      aligned(item.meta.left, item.body.left, 'Mobile metadata and content use the same column');
      assert.ok(item.meta.bottom <= item.body.top + 1, 'Mobile content follows its date and metadata');
      assert.ok(item.marker.right < item.meta.left, 'Mobile metadata and content stay beside the rail');
    }
    if (item.linksOnly) {
      assert.equal(item.metaText, item.dateText, 'Link-only event metadata shows only its date');
      assert.equal(item.metaChipCount, 0, 'Link-only events omit the redundant type chip');
      assert.equal(item.bodyCardCount, 1, 'Link-only events use the same single panel as GitHub Star events');
      assert.ok(item.links.length > 0, 'Link-only events retain their original HTTP links');
      for (const link of item.links) {
        assert.ok(link.left >= item.body.left - 1 && link.right <= item.body.right + 1, 'Link rows stay inside their content column');
        assert.notEqual(link.pointerEvents, 'none', 'Link rows remain clickable');
      }
    }
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
  const markerIcons = new Set();
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
    assert.equal(await collection.locator('select').getAttribute('aria-label'), '时间线年份', 'The year selector keeps its accessible name');
    assert.equal(await collection.getByText('时间线年份', {exact: true}).count(), 0, 'The redundant visible year label is removed');
    assert.equal(await collection.getByText('浏览所有年份', {exact: true}).count(), 0, 'The duplicate year disclosure is removed');
    const events = await collection.locator('.timeline > .timeline__item').evaluateAll((items) => items.map((item) => {
      const body = item.querySelector('[data-timeline-body]');
      const entry = body?.querySelector('[data-timeline-entry]');
      const panels = [...(body?.querySelectorAll('.card') ?? [])].filter((panel) => !panel.closest('[data-timeline-entry]'));
      const icons = item.querySelectorAll('.timeline__marker svg');
      return {
        kind: item.getAttribute('data-timeline-kind'),
        metaCount: item.querySelectorAll('[data-timeline-meta]').length,
        bodyCount: item.querySelectorAll('[data-timeline-body]').length,
        entryCount: item.querySelectorAll('[data-timeline-entry]').length,
        panelCount: panels.length,
        directPanel: panels[0]?.parentElement === body,
        panelContainsEntry: panels[0]?.contains(entry),
        iconCount: icons.length,
        icon: icons[0]?.innerHTML,
      };
    }));
    for (const event of events) {
      assert.ok(event.kind, 'Every event identifies its content kind');
      assert.equal(event.metaCount, 1, 'Each event has one metadata region');
      assert.equal(event.bodyCount, 1, 'Each event has one content region');
      assert.equal(event.entryCount, 1, 'Authored event content stays together');
      assert.equal(event.panelCount, 1, 'Every event receives one shared panel');
      assert.ok(event.directPanel && event.panelContainsEntry, 'The panel directly wraps the complete event, not individual paragraphs');
      assert.equal(event.iconCount, 1, 'Each marker contains one SVG icon');
      markerIcons.add(event.icon);
    }
    assert.equal(await collection.locator('astro-island').count(), 0, 'Timeline content remains server-rendered without a React hydration boundary');
    console.log(`${year.url}: ${fidelity.ids.length} original groups and all authored content preserved in static HTML.`);
  }
  assert.ok(markerIcons.size >= 3, 'Published Timeline events use at least three distinct marker icons');
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
  for (const width of [1440, 1280, 390, 320]) {
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
      if (screenshots) {
        await page.screenshot({path: path.join(screenshots, `timeline-${width}-${colorScheme}.png`), animations: 'disabled'});
        const linkEvents = page.locator('[data-content-collection="timeline"] [data-timeline-links-only="true"]');
        assert.ok(await linkEvents.count() > 0, 'The newest Timeline includes link-only events for visual review');
        await linkEvents.first().evaluate((item) => item.scrollIntoView({block: 'start'}));
        await page.screenshot({path: path.join(screenshots, `timeline-links-${width}-${colorScheme}.png`), animations: 'disabled'});
        const samples = await linkEvents.evaluateAll((events) => {
          const counts = events.map((item) => [...item.querySelectorAll('[data-timeline-entry] a[href]')]
            .filter((anchor) => /^https?:\/\//i.test(anchor.getAttribute('href'))).length);
          return {single: counts.findIndex((count) => count === 1), multiple: counts.findIndex((count) => count > 1)};
        });
        for (const [kind, index] of Object.entries(samples)) {
          if (index <= 0) continue;
          await linkEvents.nth(index).evaluate((item) => item.scrollIntoView({block: 'start'}));
          await page.screenshot({path: path.join(screenshots, `timeline-links-${kind}-${width}-${colorScheme}.png`), animations: 'disabled'});
        }
      }
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
