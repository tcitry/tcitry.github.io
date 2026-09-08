import assert from 'node:assert/strict';
import { chromium } from 'playwright';

// Use an independently built preview with its Pagefind index; never build here.
const base = new URL(process.env.BLOG_TEST_URL ?? 'http://127.0.0.1:4321');
const selectors = {
  trigger: '[data-blog-search-trigger]',
  command: '[data-blog-command]',
  input: '[data-blog-search-input]',
  result: '[data-blog-search-result]',
};
const browser = await chromium.launch({ headless: true });
let checked = 0;

async function fixture(width, mockModule) {
  const context = await browser.newContext({
    serviceWorkers: 'block',
    viewport: { width, height: 900 },
  });
  // Allow only this preview. Analytics, comments and other third parties stay offline.
  await context.route('**/*', (route) => new URL(route.request().url()).origin === base.origin
    ? route.continue()
    : route.abort());
  if (mockModule) {
    await context.route('**/pagefind/pagefind.js', (route) => new URL(route.request().url()).origin === base.origin
      ? route.fulfill({ status: 200, contentType: 'text/javascript', body: mockModule })
      : route.abort());
  }
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.setDefaultNavigationTimeout(30000);
  const errors = [];
  const requests = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.origin === base.origin) requests.push(url.pathname);
  });
  const response = await page.goto(new URL('/archives/', base).href, { waitUntil: 'load' });
  assert.ok(response?.ok(), 'The archives fixture must exist');
  if (width < 768) {
    await page.locator('.book-header label[for="menu-control"]').click();
    assert.equal(await page.locator('#menu-control').isChecked(), true, 'Mobile navigation opens natively');
  }
  const trigger = page.locator(`${selectors.trigger}:visible`).first();
  await trigger.waitFor({ state: 'visible' });
  return { context, page, trigger, errors, requests };
}

async function waitState(page, state) {
  await page.waitForFunction(({ selector, state }) => document.querySelector(selector)?.getAttribute('data-search-state') === state,
    { selector: selectors.command, state });
}

async function waitInputFocus(page) {
  await page.waitForFunction((selector) => document.querySelector(selector) === document.activeElement, selectors.input);
}

// Synchronize with rendering work, including focus restoration, without a time-based sleep.
async function renderFrames(page) {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function openCommand(page, trigger, state = 'recent') {
  assert.equal(await trigger.locator('span').innerText(), 'Search');
  await trigger.click();
  await page.locator(selectors.command).waitFor({ state: 'visible' });
  assert.equal(await page.locator(selectors.command).getAttribute('aria-label'), '搜索博客');
  await waitState(page, state);
  await waitInputFocus(page);
  assert.equal(await page.locator(selectors.input).getAttribute('placeholder'), 'Search');
}

async function assertNoLegacySearch(page, requests, label) {
  assert.equal(await page.locator('#book-search-input, #search-container, #search-dialog, #search, .pagefind-ui').count(), 0,
    `${label}: the default search DOM is absent`);
  assert.equal(requests.some((path) => /\/pagefind-ui\.(?:js|css)$/.test(path)), false,
    `${label}: default PagefindUI JavaScript and CSS are not requested`);
  assert.equal(await page.evaluate(() => typeof window.PagefindUI), 'undefined', `${label}: default PagefindUI is not initialized`);
}

async function assertResults(page, label) {
  const links = page.locator(selectors.result);
  const hrefs = await links.evaluateAll((elements) => elements.map((element) => element.getAttribute('href')));
  assert.ok(hrefs.length > 0, `${label}: results are visible`);
  for (const href of hrefs) {
    assert.ok(href, `${label}: every result is a link`);
    const url = new URL(href, base);
    assert.equal(url.origin, base.origin, `${label}: result links stay on this site`);
    assert.match(url.pathname, /^\/(?:docs|posts|weekly)\//, `${label}: results stay within the searchable sections`);
  }
  assert.equal(new Set(hrefs).size, hrefs.length, `${label}: result URLs are unique`);
  for (const link of await links.all()) {
    assert.ok((await link.getAttribute('aria-label'))?.trim(), `${label}: each result has an accessible title`);
  }
}

async function assertRecent(page, label) {
  await waitState(page, 'recent');
  assert.equal(await page.locator(selectors.input).inputValue(), '');
  assert.equal(await page.locator(selectors.result).count(), 6, `${label}: six recent updates appear`);
  await assertResults(page, label);
  const dates = await page.locator(`${selectors.result} time`).evaluateAll((elements) => elements.map((element) => ({
    value: element.getAttribute('datetime'), text: element.textContent?.trim(),
  })));
  assert.equal(dates.length, 6, `${label}: recent updates include dates`);
  const timestamps = dates.map(({ value, text }) => {
    assert.ok(text, `${label}: dates have readable text`);
    assert.ok(value && Number.isFinite(Date.parse(value)), `${label}: dates have valid datetime values`);
    return Date.parse(value);
  });
  assert.deepEqual(timestamps, [...timestamps].sort((a, b) => b - a), `${label}: updates are newest first`);
}

async function assertRecentDestinations(page, label) {
  const hrefs = await page.locator(selectors.result).evaluateAll((links) => links.map((link) => link.getAttribute('href')));
  for (const href of hrefs) {
    const response = await page.request.get(new URL(href, base).href, { maxRedirects: 0 });
    assert.equal(response.status(), 200, `${label}: recent update ${href} must resolve directly to a real page`);
    assert.match(response.headers()['content-type'] ?? '', /text\/html/i, `${label}: ${href} returns HTML`);
    assert.match(await response.text(), /<main[\s>]/, `${label}: ${href} renders article content`);
    await response.dispose();
  }
}

async function assertBounds(page, label) {
  await renderFrames(page);
  const layout = await page.locator(selectors.command).evaluate((dialog) => {
    const box = dialog.getBoundingClientRect();
    const controls = [...dialog.querySelectorAll('[data-blog-search-input], button, [data-blog-search-result]')];
    return {
      documentFits: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) <= innerWidth + 1,
      dialogFits: box.width > 0 && box.left >= -1 && box.right <= innerWidth + 1 && box.top >= -1 && box.bottom <= innerHeight + 1,
      dialogDoesNotOverflow: dialog.scrollWidth <= dialog.clientWidth + 1,
      controlsFit: controls.every((control) => {
        if (!control.getClientRects().length) return true;
        const rect = control.getBoundingClientRect();
        return rect.left >= box.left - 1 && rect.right <= box.right + 1;
      }),
    };
  });
  assert.deepEqual(layout, { documentFits: true, dialogFits: true, dialogDoesNotOverflow: true, controlsFit: true },
    `${label}: the dialog, input, buttons and results fit the viewport`);
}

const mockModule = `
const trace = window.__blogSearchMock = { calls: [], settled: [], retries: 0 };
export async function search(query) {
  trace.calls.push(query);
  if (query === 'slow') await new Promise((resolve) => setTimeout(resolve, 650));
  if (query === 'retry' && ++trace.retries === 1) {
    trace.settled.push(query);
    throw new Error('Intentional search retry fixture');
  }
  trace.settled.push(query);
  return { results: [{ data: async () => ({
    url: '/posts/this-blog/',
    meta: { title: 'A body-only match: ' + query },
    plain_excerpt: 'Use &lt;Card&gt; &amp; keep &lt;img src=x onerror=alert(1)&gt; as text.',
  }) }] };
}
`;

async function waitMockResult(page, query) {
  await page.waitForFunction(({ command, result, query }) => {
    const dialog = document.querySelector(command);
    return dialog?.getAttribute('data-search-state') === 'results'
      && dialog.querySelector(result)?.getAttribute('aria-label') === `A body-only match: ${query}`;
  }, { command: selectors.command, result: selectors.result, query });
}

try {
  for (const width of [1440, 375, 320]) {
    const { context, page, trigger, errors, requests } = await fixture(width);
    const label = `Search at ${width}px`;
    try {
      await assertNoLegacySearch(page, requests, label);
      assert.equal(requests.includes('/search/recent.json'), false, `${label}: recent metadata is lazy-loaded`);
      await openCommand(page, trigger);
      await assertRecent(page, label);
      assert.equal(requests.filter((path) => path === '/search/recent.json').length, 1,
        `${label}: opening the dialog fetches the recent metadata once`);
      if (width === 1440) await assertRecentDestinations(page, label);
      await assertBounds(page, label);
      assert.equal(requests.some((path) => path.includes('/pagefind/')), false,
        `${label}: opening recent updates does not load Pagefind`);

      const input = page.locator(selectors.input);
      await input.fill('Astro');
      await waitState(page, 'results');
      await assertResults(page, `${label}, Astro query`);
      assert.ok(requests.some((path) => path.endsWith('/pagefind/pagefind.js')), `${label}: a query loads the real Pagefind module`);
      await assertBounds(page, `${label}, query results`);
      const more = page.getByRole('button', { name: '加载更多', exact: true });
      if (await more.isVisible()) {
        const before = await page.locator(selectors.result).count();
        await more.click();
        await page.waitForFunction(({ selector, before }) => document.querySelectorAll(selector).length > before,
          { selector: selectors.result, before });
        await waitState(page, 'results');
        await assertResults(page, `${label}, more results`);
        await assertBounds(page, `${label}, more results`);
      }

      // Quote the phrase: Pagefind may legitimately fuzzy-match random tokens.
      await input.fill('"zzzzcodexnomatch20260908xyz"');
      await waitState(page, 'results');
      assert.equal(await page.locator(selectors.result).count(), 0, `${label}: an unmatched query has no results`);
      assert.ok((await page.locator(selectors.command).innerText()).includes('没有找到匹配内容'), `${label}: the empty state explains the result`);
      await page.getByRole('button', { name: '清除搜索', exact: true }).click();
      await assertRecent(page, `${label}, cleared query`);
      await assertNoLegacySearch(page, requests, label);

      await page.keyboard.press('Escape');
      await page.locator(selectors.command).waitFor({ state: 'hidden' });
      await page.waitForFunction((selector) => document.activeElement?.matches(selector), selectors.trigger);
      assert.equal(await trigger.evaluate((element) => element === document.activeElement), true, `${label}: Escape restores the opening trigger`);
      await page.keyboard.press('Control+k');
      await waitState(page, 'recent');
      await waitInputFocus(page);
      await page.keyboard.press('ArrowDown');
      const focused = page.locator(`${selectors.result}[data-focused="true"]`);
      await focused.waitFor({ state: 'visible' });
      assert.equal(await focused.count(), 1, `${label}: arrow keys select one result`);
      const href = await focused.getAttribute('href');
      assert.ok(href, `${label}: keyboard selection has a destination`);
      const destination = new URL(href, base);
      const [navigationResponse] = await Promise.all([
        page.waitForResponse((response) => response.request().isNavigationRequest() && response.url() === destination.href),
        page.waitForURL((url) => url.href === destination.href, { waitUntil: 'load' }),
        page.keyboard.press('Enter'),
      ]);
      assert.equal(new URL(page.url()).href, destination.href, `${label}: Enter navigates to the focused result`);
      assert.equal(navigationResponse.status(), 200, `${label}: keyboard navigation opens an existing article`);
      assert.deepEqual(errors, [], `${label}: no browser runtime errors`);
      console.log(`${label}: recent updates, lazy search, results, clearing, keyboard navigation and layout passed.`);
      checked++;
    } finally {
      await context.close();
    }
  }

  // A slow or unavailable recent-updates feed must not block the search input.
  {
    const { context, page, trigger, errors } = await fixture(1440, mockModule);
    const recentPattern = '**/search/recent.json';
    const metadata = await context.request.get(new URL('/search/recent.json', base).href);
    assert.equal(metadata.status(), 200, 'The independently built recent metadata exists');
    const body = await metadata.body();
    await metadata.dispose();
    let releaseRecent;
    const pendingRecent = new Promise((resolve) => { releaseRecent = resolve; });
    await context.route(recentPattern, async (route) => {
      await pendingRecent;
      await route.fulfill({ status: 200, contentType: 'application/json', body });
    });
    try {
      await openCommand(page, trigger, 'recent-loading');
      const input = page.locator(selectors.input);
      await input.fill('fast');
      await waitMockResult(page, 'fast');
      await assertResults(page, 'Search while recent metadata is pending');
      const resultsBefore = await page.locator(selectors.result).evaluateAll((links) => links.map((link) => link.getAttribute('href')));
      const completed = page.waitForResponse((response) => new URL(response.url()).pathname === '/search/recent.json');
      releaseRecent();
      await completed;
      await renderFrames(page);
      assert.equal(await input.inputValue(), 'fast', 'Late recent metadata preserves the query');
      assert.equal(await page.locator(selectors.command).getAttribute('data-search-state'), 'results');
      assert.deepEqual(await page.locator(selectors.result).evaluateAll((links) => links.map((link) => link.getAttribute('href'))),
        resultsBefore, 'Late recent metadata cannot replace full-text results');
      await page.getByRole('button', { name: '清除搜索', exact: true }).click();
      await assertRecent(page, 'Recent metadata after a delayed response');
      assert.deepEqual(errors, [], 'A delayed recent feed causes no browser runtime errors');
      console.log('Recent updates: a delayed response does not block or replace full-text search.');
      checked++;
    } finally {
      releaseRecent();
      await context.close();
    }
  }

  {
    const { context, page, trigger, errors } = await fixture(375);
    const recentPattern = '**/search/recent.json';
    const failRecent = (route) => route.fulfill({ status: 502, contentType: 'application/json', body: '{}' });
    await context.route(recentPattern, failRecent);
    try {
      const originalURL = page.url();
      const documentTimeOrigin = await page.evaluate(() => performance.timeOrigin);
      await openCommand(page, trigger, 'recent-error');
      await assertBounds(page, 'Recent metadata failure at 375px');
      await page.locator(selectors.input).fill('Astro');
      await waitState(page, 'results');
      await assertResults(page, 'Search while recent metadata is unavailable');
      await page.getByRole('button', { name: '清除搜索', exact: true }).click();
      await waitState(page, 'recent-error');
      await context.unroute(recentPattern, failRecent);
      await page.getByRole('button', { name: '重试最近更新', exact: true }).click();
      await assertRecent(page, 'Recent metadata retry');
      assert.equal(page.url(), originalURL, 'Retry stays on the current page');
      assert.equal(await page.evaluate(() => performance.timeOrigin), documentTimeOrigin,
        'Retry recovers the recent feed without a page refresh');
      assert.deepEqual(errors, [], 'Recent metadata failure and retry are handled without runtime errors');
      console.log('Recent updates: failed metadata preserves full-text search and retries without refreshing.');
      checked++;
    } finally {
      await context.close();
    }
  }

  // A real failed fragment remains cached inside Pagefind unless its index is
  // reset. Exercise recovery independently of the mock module and other queries.
  {
    const { context, page, trigger, errors, requests } = await fixture(1440);
    const fragmentPattern = '**/pagefind/fragment/**';
    const blockedFragments = new Set();
    const failFragment = (route) => {
      const url = new URL(route.request().url());
      if (url.origin === base.origin) blockedFragments.add(url.pathname);
      return route.abort('failed');
    };
    try {
      await context.route(fragmentPattern, failFragment);
      const originalURL = page.url();
      const documentTimeOrigin = await page.evaluate(() => performance.timeOrigin);
      let navigations = 0;
      page.on('framenavigated', (frame) => { if (frame === page.mainFrame()) navigations++; });
      await openCommand(page, trigger);
      await page.locator(selectors.input).fill('Astro');
      await waitState(page, 'error');
      assert.ok(blockedFragments.size > 0, 'The real Astro query encounters an aborted Pagefind fragment');

      await context.unroute(fragmentPattern, failFragment);
      const [retriedFragment] = await Promise.all([
        page.waitForRequest((request) => {
          const url = new URL(request.url());
          return url.origin === base.origin && url.pathname.includes('/pagefind/fragment/');
        }),
        page.getByRole('button', { name: '重试', exact: true }).click(),
      ]);
      assert.ok(blockedFragments.has(new URL(retriedFragment.url()).pathname),
        'Retry requests a previously failed fragment again');
      await waitState(page, 'results');
      await assertResults(page, 'Real Pagefind fragment recovery');
      assert.equal(await page.locator(selectors.input).inputValue(), 'Astro', 'Retry preserves the query');
      assert.equal(page.url(), originalURL, 'Fragment recovery preserves the current page URL');
      assert.equal(navigations, 0, 'Fragment recovery does not navigate or refresh the page');
      assert.equal(await page.evaluate(() => performance.timeOrigin), documentTimeOrigin,
        'The original document survives fragment recovery');
      await assertNoLegacySearch(page, requests, 'Real Pagefind fragment recovery');
      assert.deepEqual(errors, [], 'The expected network failure is handled without browser runtime errors');
      console.log('Real Pagefind: an aborted fragment is fetched again on retry and results recover without a page refresh.');
      checked++;
    } finally {
      await context.close();
    }
  }

  const { context, page, trigger, errors, requests } = await fixture(1440, mockModule);
  try {
    await openCommand(page, trigger);
    const input = page.locator(selectors.input);
    await input.fill('slow');
    await page.waitForFunction(() => window.__blogSearchMock?.calls.includes('slow'));
    await input.fill('fast');
    await waitMockResult(page, 'fast');
    await page.waitForFunction(() => window.__blogSearchMock.settled.includes('slow'));
    await renderFrames(page);
    assert.equal(await page.locator(selectors.result).getAttribute('aria-label'), 'A body-only match: fast',
      'An older slow response cannot replace newer results');

    await input.fill('fast ');
    await waitMockResult(page, 'fast');
    assert.equal(await input.inputValue(), 'fast ', 'Trailing whitespace does not leave search loading');

    await input.fill('retry');
    await waitState(page, 'error');
    await page.getByRole('button', { name: '重试', exact: true }).click();
    await waitMockResult(page, 'retry');
    assert.equal(await page.evaluate(() => window.__blogSearchMock.retries), 2, 'Retry recovers from a rejected search');
    const result = page.locator(selectors.result);
    assert.ok((await result.innerText()).includes('Use <Card> & keep <img src=x onerror=alert(1)> as text.'),
      'Escaped entities are decoded once and displayed as readable text');
    assert.equal(await result.locator('img, script, card').count(), 0, 'Result excerpts never create HTML elements');
    assert.equal(await result.getAttribute('aria-label'), 'A body-only match: retry',
      'The Pagefind result title is preserved as the accessible link name');

    await input.focus();
    const originalURL = page.url();
    await input.dispatchEvent('compositionstart', { data: '' });
    await waitState(page, 'composing');
    await input.fill('中文输入');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Escape');
    await renderFrames(page);
    assert.equal(page.url(), originalURL, 'IME Enter does not navigate');
    assert.equal(await page.locator(selectors.command).isVisible(), true, 'IME Escape does not close search');
    assert.equal(await page.locator(selectors.command).getAttribute('data-search-state'), 'composing');
    assert.equal(await page.evaluate(() => window.__blogSearchMock.calls.includes('中文输入')), false,
      'Search waits for composition to finish');
    // Escape can natively clear a type=search input while cancelling the IME.
    // Finish that cancellation, then exercise a separate committed composition.
    await input.dispatchEvent('compositionend', { data: '' });
    await input.dispatchEvent('compositionstart', { data: '' });
    await input.fill('中文输入');
    await input.dispatchEvent('compositionend', { data: '中文输入' });
    await waitMockResult(page, '中文输入');
    await waitInputFocus(page);

    for (let cycle = 0; cycle < 3; cycle++) {
      // Both actions happen in one task, before the old close handler's focus RAF.
      await page.evaluate((triggerSelector) => {
        document.querySelector('button[aria-label="关闭搜索"]').click();
        document.querySelector(triggerSelector).click();
      }, selectors.trigger);
      await waitState(page, 'recent');
      await waitInputFocus(page);
      await renderFrames(page);
      assert.equal(await input.evaluate((element) => element === document.activeElement), true,
        `Rapid reopen ${cycle + 1}: an old focus callback cannot steal input focus`);
    }
    await assertRecent(page, 'Reopened search');
    await assertNoLegacySearch(page, requests, 'Mocked Pagefind');
    await assertBounds(page, 'Mocked Pagefind');
    assert.deepEqual(errors, [], 'Async, retry and IME interactions produce no browser runtime errors');
    console.log('Mocked Pagefind: response ordering, trailing spaces, retry, safe text, IME and reopen focus passed.');
    checked++;
  } finally {
    await context.close();
  }
  console.log(`Search browser regression passed (${checked} viewport/scenario checks).`);
} finally {
  await browser.close();
}
