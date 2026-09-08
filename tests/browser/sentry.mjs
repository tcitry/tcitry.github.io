import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

// Use an independently built production preview; never build or send telemetry here.
const base = new URL(process.env.BLOG_TEST_URL ?? 'http://127.0.0.1:4321');
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname), 'BLOG_TEST_URL must be a local preview');
const canonical = new URL('https://yindongliang.com');
const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
let checked = 0;

// Envelopes may include binary Replay recordings. Respect item byte lengths
// instead of trying to parse the complete request as newline-delimited JSON.
function envelopeItems(body) {
  const items = [];
  let offset = body.indexOf(10) + 1;
  assert.ok(offset > 0, 'Sentry envelope has a header');
  while (offset < body.length) {
    const lineEnd = body.indexOf(10, offset);
    if (lineEnd < 0) break;
    const header = JSON.parse(body.subarray(offset, lineEnd).toString());
    offset = lineEnd + 1;
    let end = typeof header.length === 'number' ? offset + header.length : body.indexOf(10, offset);
    if (end < 0) end = body.length;
    items.push({
      type: header.type,
      bytes: end - offset,
      ...(['event', 'replay_event', 'trace_metric'].includes(header.type)
        ? { payload: JSON.parse(body.subarray(offset, end).toString()) } : {}),
    });
    offset = end + (body[end] === 10 ? 1 : 0);
  }
  return items;
}

async function fixture({ mockSearch = false, searchModule } = {}) {
  const context = await browser.newContext({
    serviceWorkers: 'block',
    viewport: { width: 1440, height: 1000 },
  });
  const events = [];
  const replays = [];
  const metrics = [];
  const metricContainers = [];
  const envelopeErrors = [];
  let envelopeCount = 0;
  let closing = false;
  await context.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.hostname.endsWith('.sentry.io') && /^\/api\/\d+\/envelope\/$/.test(url.pathname)) {
      const headers = { 'access-control-allow-origin': canonical.origin };
      if (request.method() === 'OPTIONS') {
        return route.fulfill({ status: 204, headers: { ...headers,
          'access-control-allow-methods': 'POST, OPTIONS',
          'access-control-allow-headers': request.headers()['access-control-request-headers'] ?? '*',
        } });
      }
      envelopeCount++;
      try {
        const items = envelopeItems(request.postDataBuffer() ?? Buffer.alloc(0));
        events.push(...items.filter((item) => item.type === 'event').map((item) => item.payload));
        for (const item of items.filter((item) => item.type === 'trace_metric')) {
          metricContainers.push(item.payload);
          metrics.push(...item.payload.items);
        }
        const recordingBytes = items.filter((item) => item.type === 'replay_recording').reduce((sum, item) => sum + item.bytes, 0);
        replays.push(...items.filter((item) => item.type === 'replay_event')
          .map((item) => ({ event: item.payload, recordingBytes })));
      } catch (error) {
        envelopeErrors.push(error.message);
      }
      // Acknowledge locally so retries cannot leak fixtures into a real project.
      return route.fulfill({ status: 200, headers, contentType: 'application/json', body: '{}' });
    }
    if (url.origin !== canonical.origin && url.origin !== base.origin) return route.abort();
    if ((mockSearch || searchModule) && url.pathname === '/pagefind/pagefind.js') {
      return route.fulfill({
        status: 200,
        contentType: 'text/javascript',
        body: searchModule ?? `export async function search() { throw new Error('Sentry search failure fixture'); }`,
      });
    }
    if (url.origin === base.origin) return route.continue();
    // Keep the canonical address in Chromium while fetching only local assets.
    const local = new URL(url.pathname + url.search, base);
    try {
      const response = await route.fetch({ url: local.href, maxRedirects: 0 });
      await route.fulfill({ response });
    } catch (error) {
      // Closing a finished fixture also cancels pending local asset responses.
      if (!closing) throw error;
    }
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.setDefaultNavigationTimeout(30000);
  return { page, events, replays, metrics, metricContainers, envelopeErrors, envelopeCount: () => envelopeCount,
    close: async () => { closing = true; await context.close(); },
  };
}

// Inspect the SDK's own registry. Production code does not expose a test API.
async function clientOptions(page) {
  return page.evaluate(() => {
    const clients = new Set();
    for (const registry of Object.values(window.__SENTRY__ ?? {})) {
      if (!registry || typeof registry !== 'object') continue;
      for (const scope of [registry.defaultCurrentScope, registry.stack?.getScope?.()]) {
        const client = scope?.getClient?.();
        if (client) clients.add(client);
      }
    }
    return [...clients].map((client) => {
      const options = client.getOptions();
      return {
        enabled: options.enabled !== false && Boolean(client.getDsn()),
        environment: options.environment,
        release: options.release,
        sendDefaultPii: options.sendDefaultPii,
        tracesSampleRate: options.tracesSampleRate,
        replaysSessionSampleRate: options.replaysSessionSampleRate,
        replaysOnErrorSampleRate: options.replaysOnErrorSampleRate,
      };
    });
  });
}

async function waitClient(page) {
  await page.waitForFunction(() => Object.values(window.__SENTRY__ ?? {}).some((registry) =>
    registry && typeof registry === 'object'
      && (registry.defaultCurrentScope?.getClient?.() || registry.stack?.getScope?.()?.getClient?.())));
}

async function flush(page) {
  await page.evaluate(async () => {
    const clients = new Set();
    for (const registry of Object.values(window.__SENTRY__ ?? {})) {
      if (!registry || typeof registry !== 'object') continue;
      for (const scope of [registry.defaultCurrentScope, registry.stack?.getScope?.()]) {
        const client = scope?.getClient?.();
        if (client) clients.add(client);
      }
    }
    await Promise.all([...clients].map((client) => client.flush(5000)));
  });
}

function metricAttributes(metric) {
  return Object.fromEntries(Object.entries(metric.attributes ?? {}).map(([name, attribute]) => [name, attribute.value]));
}

function metricCount(current, name, attributes = {}) {
  return current.metrics.filter((metric) => metric.name === name
    && Object.entries(attributes).every(([key, value]) => metricAttributes(metric)[key] === value))
    .reduce((total, metric) => total + metric.value, 0);
}

async function waitMetric(current, name, attributes = {}) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    await flush(current.page);
    assert.deepEqual(current.envelopeErrors, [], 'Intercepted metric envelopes are readable');
    const metric = current.metrics.find((metric) => metric.name === name
      && Object.entries(attributes).every(([key, value]) => metricAttributes(metric)[key] === value));
    if (metric) return metric;
    await delay(25);
  }
  assert.fail(`Expected ${name} metric did not arrive at the local interceptor`);
}

function assertMetrics(current, path) {
  assert.ok(current.metricContainers.length > 0, `${path}: the SDK sent metric envelopes`);
  for (const container of current.metricContainers) {
    assert.equal(container.version, 2, `${path}: current metric envelope format`);
    assert.deepEqual(container.ingest_settings, { infer_ip: 'never', infer_user_agent: 'never' },
      `${path}: Metrics does not request IP or user-agent inference`);
  }
  for (const metric of current.metrics) {
    const attributes = metricAttributes(metric);
    assert.equal(metric.type, 'counter', `${metric.name}: usage is recorded as a counter`);
    assert.equal(metric.value, 1, `${metric.name}: each action contributes one count`);
    assert.equal(attributes.page_path, path, `${metric.name}: pathname identifies the source page`);
    assert.equal(attributes['sentry.environment'], 'production', `${metric.name}: production environment`);
    assert.ok(attributes['sentry.release'], `${metric.name}: release identifies the build`);
    assert.equal(attributes['user.email'], undefined, `${metric.name}: no user email`);
    assert.equal(attributes['user.id'], undefined, `${metric.name}: no user identifier`);
  }
}

async function renderFrames(page) {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function waitEvent(fixture, predicate) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    assert.deepEqual(fixture.envelopeErrors, [], 'Intercepted Sentry envelopes are readable');
    const event = fixture.events.find(predicate);
    if (event) return event;
    await delay(25);
  }
  assert.fail('Expected Sentry error envelope did not arrive at the local interceptor');
}

async function waitReplay(fixture, event) {
  // The SDK tags errors with replayId and uses replay_id in replay_event.
  const replayId = event.tags?.replayId;
  assert.match(replayId ?? '', /^[a-f0-9]{32}$/, 'The error is linked to a Replay session');
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    assert.deepEqual(fixture.envelopeErrors, [], 'Replay envelopes are readable');
    const replay = fixture.replays.find(({ event: replay }) => replay.replay_id === replayId
      && replay.error_ids?.includes(event.event_id));
    if (replay) {
      assert.ok(replay.recordingBytes > 0, 'Error Replay includes a nonempty replay_recording item');
      return;
    }
    // Permit the normal minimum Replay duration and deferred flush; do not
    // call Replay.flush(), which would mask broken automatic error recording.
    await delay(50);
  }
  assert.fail('Automatic error Replay did not arrive at the local interceptor');
}

function exceptionMessage(event, message) {
  return event.exception?.values?.some((value) => value.value === message);
}

function assertEvent(event, path, release) {
  assert.equal(event.environment, 'production', `${path}: production environment`);
  assert.equal(event.release, release, `${path}: release matches the initialized client`);
  assert.ok(event.release?.trim(), `${path}: release is defined`);
  assert.equal(event.tags?.site, 'tcitry-blog', `${path}: site tag`);
  assert.equal(event.tags?.page_path, path, `${path}: pathname tag`);
  assert.equal(event.request?.url, new URL(path, canonical).href, `${path}: request URL contains no query or fragment`);
  assert.equal(event.user?.email, undefined, `${path}: no email`);
  assert.equal(event.user?.ip_address, undefined, `${path}: no default IP`);
}

try {
  for (const path of ['/', '/labs/', '/labs/agent-replay/', '/demos/2026/rounded-timeline/', '/demos/2026/threejs-basics/']) {
    const current = await fixture();
    try {
      const response = await current.page.goto(new URL(`${path}?sentry_test_source=private-fixture#private-fragment`, canonical).href,
        { waitUntil: 'load' });
      assert.ok(response?.ok(), `${path}: production page exists`);
      await waitClient(current.page);
      const clients = await clientOptions(current.page);
      assert.equal(clients.length, 1, `${path}: exactly one Sentry client is initialized`);
      assert.equal(clients[0].enabled, true);
      assert.equal(clients[0].environment, 'production');
      assert.equal(clients[0].sendDefaultPii, false);
      assert.equal(clients[0].tracesSampleRate, 0.1);
      assert.equal(clients[0].replaysSessionSampleRate, 0);
      assert.equal(clients[0].replaysOnErrorSampleRate, 1);
      const message = `Sentry uncaught browser fixture ${path}`;
      await current.page.evaluate((message) => {
        setTimeout(() => { throw new Error(message); }, 0);
      }, message);
      const event = await waitEvent(current, (event) => exceptionMessage(event, message));
      await flush(current.page);
      assertEvent(event, path, clients[0].release);
      assert.ok(event.exception.values.some((value) => value.mechanism?.handled === false), `${path}: the uncaught failure is unhandled`);
      assert.equal(current.events.filter((event) => exceptionMessage(event, message)).length, 1, `${path}: uncaught failure is reported once`);
      if (path === '/') await waitReplay(current, event);
      checked++;
    } finally {
      await current.close();
    }
  }

  const search = await fixture({ mockSearch: true });
  try {
    await search.page.goto(new URL('/archives/?sentry_test_source=private-fixture', canonical).href, { waitUntil: 'load' });
    await waitClient(search.page);
    await search.page.locator('[data-blog-search-trigger]:visible').first().click();
    const input = search.page.locator('[data-blog-search-input]');
    await input.waitFor({ state: 'visible' });
    const query = 'private-search-query-20260908';
    await input.fill(query);
    await search.page.waitForFunction(() => document.querySelector('[data-blog-command]')?.getAttribute('data-search-state') === 'error');
    const event = await waitEvent(search, (event) => exceptionMessage(event, 'Sentry search failure fixture'));
    await flush(search.page);
    const clients = await clientOptions(search.page);
    assertEvent(event, '/archives/', clients[0].release);
    assert.equal(event.tags?.feature, 'search');
    assert.equal(event.tags?.operation, 'query');
    assert.ok(event.exception.values.every((value) => value.mechanism?.handled !== false), 'Search failure is handled by the UI');
    assert.equal(search.events.filter((event) => exceptionMessage(event, 'Sentry search failure fixture')).length, 1,
      'One failed query is reported exactly once');
    assert.equal(JSON.stringify(search.events).includes(query), false, 'Search input is absent from error envelopes');
    checked++;
  } finally {
    await search.close();
  }

  const portfolio = await fixture();
  try {
    await portfolio.page.goto(new URL('/portfolio/?source=private-project-source#private-fragment', canonical).href,
      { waitUntil: 'load' });
    await waitClient(portfolio.page);
    const links = portfolio.page.locator('a[data-analytics-project][data-analytics-placement]');
    const entries = await links.evaluateAll((elements) => elements.map((element) => ({
      project_id: element.dataset.analyticsProject,
      placement: element.dataset.analyticsPlacement,
      href: element.href,
      target: element.target,
      visible: (() => {
        const box = element.getBoundingClientRect();
        const width = Math.max(0, Math.min(box.right, innerWidth) - Math.max(box.left, 0));
        const height = Math.max(0, Math.min(box.bottom, innerHeight) - Math.max(box.top, 0));
        return box.width > 0 && box.height > 0 && width * height >= box.width * box.height / 2;
      })(),
    })));
    assert.ok(entries.length > 4, 'The real Portfolio has enough entries to exercise offscreen impressions');
    const firstVisibleIndex = entries.findIndex((entry) => entry.visible);
    assert.ok(firstVisibleIndex >= 0, 'At least one project entrance is visible initially');
    const firstVisible = entries[firstVisibleIndex];
    await waitMetric(portfolio, 'project_cta_view', {
      project_id: firstVisible.project_id, placement: firstVisible.placement,
    });
    assert.ok(metricCount(portfolio, 'project_cta_view') < entries.length,
      'Opening Portfolio does not count every offscreen project entrance as viewed');

    const lastIndex = entries.length - 1;
    const last = entries[lastIndex];
    const lastAttributes = { project_id: last.project_id, placement: last.placement };
    assert.equal(last.visible, false, 'The final real Portfolio link starts offscreen');
    assert.equal(metricCount(portfolio, 'project_cta_view', lastAttributes), 0,
      'An offscreen project entrance has no impression');
    // A brief scroll past an entrance must not satisfy the one-second exposure.
    await links.nth(lastIndex).scrollIntoViewIfNeeded();
    await renderFrames(portfolio.page);
    await links.nth(firstVisibleIndex).scrollIntoViewIfNeeded();
    await delay(1100);
    await flush(portfolio.page);
    assert.equal(metricCount(portfolio, 'project_cta_view', lastAttributes), 0,
      'Passing an entrance for less than one second does not count an impression');

    await links.nth(lastIndex).scrollIntoViewIfNeeded();
    await waitMetric(portfolio, 'project_cta_view', lastAttributes);
    assert.equal(metricCount(portfolio, 'project_cta_view', lastAttributes), 1,
      'A project entrance viewed for a full second counts once');
    await links.nth(firstVisibleIndex).scrollIntoViewIfNeeded();
    await renderFrames(portfolio.page);
    await links.nth(lastIndex).scrollIntoViewIfNeeded();
    await delay(1100);
    await flush(portfolio.page);
    assert.equal(metricCount(portfolio, 'project_cta_view', lastAttributes), 1,
      'Scrolling away and back does not duplicate an entrance impression');

    assert.equal(last.target, '_blank', 'The last real project opens separately and preserves the source page');
    await links.nth(lastIndex).click();
    await waitMetric(portfolio, 'project_click', lastAttributes);
    assert.equal(metricCount(portfolio, 'project_click', lastAttributes), 1, 'A real project click is counted once');
    const click = portfolio.metrics.find((metric) => metric.name === 'project_click');
    assert.equal(metricAttributes(click).target_path, new URL(last.href).pathname,
      'Project clicks record the linked path');
    await links.nth(lastIndex).focus();
    await portfolio.page.keyboard.press('Enter');
    await flush(portfolio.page);
    assert.equal(metricCount(portfolio, 'project_click', lastAttributes), 2, 'Keyboard activation counts one additional project click');
    await links.nth(lastIndex).click({ button: 'middle' });
    await flush(portfolio.page);
    assert.equal(metricCount(portfolio, 'project_click', lastAttributes), 3, 'Opening a project with the middle button counts once');
    assertMetrics(portfolio, '/portfolio/');
    assert.equal(JSON.stringify(portfolio.metricContainers).includes('private-project-source'), false,
      'Source query parameters are absent from project metrics');
    assert.equal(JSON.stringify(portfolio.metricContainers).includes('private-fragment'), false,
      'Source fragments are absent from project metrics');
    checked++;
  } finally {
    await portfolio.close();
  }

  const article = await fixture();
  try {
    const response = await article.page.goto(new URL('/posts/this-blog/', canonical).href, { waitUntil: 'load' });
    assert.ok(response?.ok(), 'The real site introduction article exists');
    await waitClient(article.page);
    const projectLinks = article.page.locator('article.markdown a[data-analytics-project="github/tcitry/tcitry.github.io"]');
    assert.ok(await projectLinks.count() > 1, 'The existing article mentions the site project more than once');
    const placements = await projectLinks.evaluateAll((elements) => elements.map((element) => element.dataset.analyticsPlacement));
    assert.ok(placements.every((placement) => placement === 'article_link'), 'Known project links in an article are classified as article links');
    const reference = article.page.locator('article.markdown a[href="https://docs.astro.build/en/concepts/islands/"]');
    assert.equal(await reference.count(), 1, 'The existing article also links to ordinary third-party documentation');
    assert.equal(await reference.getAttribute('data-analytics-project'), null,
      'Ordinary external references are not classified as project entrances');
    const attributes = { project_id: 'github/tcitry/tcitry.github.io', placement: 'article_link' };
    await projectLinks.first().scrollIntoViewIfNeeded();
    await waitMetric(article, 'project_cta_view', attributes);
    await projectLinks.last().scrollIntoViewIfNeeded();
    await delay(1100);
    await flush(article.page);
    assert.equal(metricCount(article, 'project_cta_view', attributes), 1,
      'Repeated mentions of the same project and article placement count one impression');
    await projectLinks.first().click({ button: 'middle' });
    await waitMetric(article, 'project_click', attributes);
    assert.equal(metricCount(article, 'project_click', attributes), 1, 'A real article project link produces one click metric');
    assertMetrics(article, '/posts/this-blog/');
    checked++;
  } finally {
    await article.close();
  }

  const demo = await fixture();
  try {
    await demo.page.goto(new URL('/labs/?source=private-demo-source#private-fragment', canonical).href,
      { waitUntil: 'load' });
    await waitClient(demo.page);
    const increment = demo.page.locator('[data-testid="svelte-increment"]');
    await increment.scrollIntoViewIfNeeded();
    await demo.page.waitForFunction(() => !document.querySelector('[data-testid="svelte-increment"]')?.disabled);
    await flush(demo.page);
    assert.equal(metricCount(demo, 'demo_start'), 0,
      'Loading, scrolling to and hydrating real demos do not count as using them');
    await increment.click();
    await demo.page.waitForFunction(() => document.querySelector('[data-testid="svelte-count"]')?.textContent === '1');
    await waitMetric(demo, 'demo_start', { demo_id: 'svelte-counter' });
    await increment.click();
    await demo.page.waitForFunction(() => document.querySelector('[data-testid="svelte-count"]')?.textContent === '2');
    await flush(demo.page);
    assert.equal(metricCount(demo, 'demo_start', { demo_id: 'svelte-counter' }), 1,
      'Multiple real operations count one demo start per document');
    assertMetrics(demo, '/labs/');
    assert.equal(JSON.stringify(demo.metricContainers).includes('private-demo-source'), false,
      'Source query parameters are absent from demo metrics');
    checked++;
  } finally {
    await demo.close();
  }

  const usage = await fixture({ searchModule: `
    export async function search(query) {
      return { results: query === 'private-empty-query' ? [] : [{ data: async () => ({
        url: '/posts/this-blog/?source=private-result-query#private-result-fragment',
        meta: { title: 'A local Metrics search fixture' },
        plain_excerpt: 'A local result; no private search input is included in its text.',
      }) }] };
    }
  ` });
  try {
    await usage.page.goto(new URL('/archives/?source=private-search-source', canonical).href, { waitUntil: 'load' });
    await waitClient(usage.page);
    await flush(usage.page);
    assert.equal(metricCount(usage, 'search_open'), 0, 'Page load does not count as opening search');
    await usage.page.locator('[data-blog-search-trigger]:visible').first().click();
    const input = usage.page.locator('[data-blog-search-input]');
    await input.waitFor({ state: 'visible' });
    await waitMetric(usage, 'search_open');
    assert.equal(metricCount(usage, 'search_open'), 1, 'Opening the real search dialog counts once');
    assert.equal(metricCount(usage, 'search_query'), 0, 'Recent updates are not counted as a submitted query');

    await input.fill('private-empty-query');
    await usage.page.waitForFunction(() => document.querySelector('[data-blog-command]')?.getAttribute('data-search-state') === 'results');
    await waitMetric(usage, 'search_query', { result_count: 0 });
    const query = 'private-search-query-20260908';
    await input.fill(query);
    await usage.page.locator('[data-blog-search-result]').waitFor({ state: 'visible' });
    await waitMetric(usage, 'search_query', { result_count: 1 });
    assert.equal(metricCount(usage, 'search_query'), 2, 'Each completed distinct query counts once, including no results');
    await input.fill(query + ' ');
    await renderFrames(usage.page);
    await usage.page.waitForFunction(() => document.querySelector('[data-blog-command]')?.getAttribute('data-search-state') === 'results');
    await flush(usage.page);
    assert.equal(metricCount(usage, 'search_query'), 2, 'Adding trailing whitespace does not count the same query twice');
    assertMetrics(usage, '/archives/');

    await Promise.all([
      usage.page.waitForURL((url) => url.pathname === '/posts/this-blog/', { waitUntil: 'load' }),
      usage.page.locator('[data-blog-search-result]').click(),
    ]);
    const resultClick = await waitMetric(usage, 'search_result_click', { target_path: '/posts/this-blog/', source: 'results' });
    assert.equal(metricCount(usage, 'search_result_click'), 1, 'A real result click counts once while navigation still works');
    assert.equal(metricAttributes(resultClick).page_path, '/archives/', 'Result clicks retain the source page through navigation');
    const serialized = JSON.stringify(usage.metricContainers);
    for (const privateValue of [query, 'private-empty-query', 'private-search-source', 'private-result-query', 'private-result-fragment']) {
      assert.equal(serialized.includes(privateValue), false, 'Search text and URL parameters are absent from all metric payloads');
    }
    checked++;
  } finally {
    await usage.close();
  }

  const keyboardSearch = await fixture();
  try {
    await keyboardSearch.page.goto(new URL('/archives/?source=private-keyboard-source', canonical).href,
      { waitUntil: 'load' });
    await waitClient(keyboardSearch.page);
    await keyboardSearch.page.locator('[data-blog-search-trigger]:visible').first().click();
    await keyboardSearch.page.waitForFunction(() => document.querySelector('[data-blog-command]')?.getAttribute('data-search-state') === 'recent');
    await keyboardSearch.page.waitForFunction(() => document.querySelector('[data-blog-search-input]') === document.activeElement);
    await keyboardSearch.page.keyboard.press('ArrowDown');
    const focused = keyboardSearch.page.locator('[data-blog-search-result][data-focused="true"]');
    await focused.waitFor({ state: 'visible' });
    const href = await focused.getAttribute('href');
    assert.ok(href, 'The focused real recent result has a destination');
    const destination = new URL(href, canonical);
    await Promise.all([
      keyboardSearch.page.waitForURL((url) => url.href === destination.href, { waitUntil: 'load' }),
      keyboardSearch.page.keyboard.press('Enter'),
    ]);
    const recentClick = await waitMetric(keyboardSearch, 'search_result_click', {
      target_path: destination.pathname, source: 'recent',
    });
    assert.equal(metricAttributes(recentClick).page_path, '/archives/', 'Keyboard navigation keeps the search source page');
    assert.equal(metricCount(keyboardSearch, 'search_result_click'), 1, 'Enter activates one recent result and records one click');
    assert.equal(metricCount(keyboardSearch, 'search_query'), 0, 'Choosing a recent article does not count as a full-text query');
    assert.equal(JSON.stringify(keyboardSearch.metricContainers).includes('private-keyboard-source'), false,
      'Keyboard navigation metrics omit source URL parameters');
    checked++;
  } finally {
    await keyboardSearch.close();
  }

  const local = await fixture();
  try {
    await local.page.goto(new URL('/labs/', base).href, { waitUntil: 'networkidle' });
    assert.deepEqual(await clientOptions(local.page), [], 'Production assets do not initialize Sentry on localhost');
    await local.page.locator('[data-testid="svelte-increment"]').scrollIntoViewIfNeeded();
    await local.page.waitForFunction(() => !document.querySelector('[data-testid="svelte-increment"]')?.disabled);
    await local.page.locator('[data-testid="svelte-increment"]').click();
    await local.page.waitForFunction(() => document.querySelector('[data-testid="svelte-count"]')?.textContent === '1');
    await local.page.evaluate(() => setTimeout(() => { throw new Error('Localhost Sentry fixture must stay offline'); }, 0));
    await delay(300);
    assert.equal(local.envelopeCount(), 0, 'Localhost does not send any Sentry envelopes');
    checked++;
  } finally {
    await local.close();
  }
  console.log(`Sentry browser regression passed (${checked} checks): layout coverage, errors and Replay, release/path tags, project impressions and clicks, real demo usage, search metrics and privacy, and localhost gating. All telemetry was intercepted locally.`);
} finally {
  await browser.close();
}
