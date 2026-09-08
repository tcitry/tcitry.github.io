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
      ...(['event', 'replay_event'].includes(header.type)
        ? { payload: JSON.parse(body.subarray(offset, end).toString()) } : {}),
    });
    offset = end + (body[end] === 10 ? 1 : 0);
  }
  return items;
}

async function fixture({ mockSearch = false } = {}) {
  const context = await browser.newContext({
    serviceWorkers: 'block',
    viewport: { width: 1440, height: 1000 },
  });
  const events = [];
  const replays = [];
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
    if (mockSearch && url.pathname === '/pagefind/pagefind.js') {
      return route.fulfill({
        status: 200,
        contentType: 'text/javascript',
        body: `export async function search() { throw new Error('Sentry search failure fixture'); }`,
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
  return { page, events, replays, envelopeErrors, envelopeCount: () => envelopeCount,
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

  const local = await fixture();
  try {
    await local.page.goto(new URL('/', base).href, { waitUntil: 'networkidle' });
    assert.deepEqual(await clientOptions(local.page), [], 'Production assets do not initialize Sentry on localhost');
    await local.page.evaluate(() => setTimeout(() => { throw new Error('Localhost Sentry fixture must stay offline'); }, 0));
    await delay(300);
    assert.equal(local.envelopeCount(), 0, 'Localhost does not send any Sentry envelopes');
    checked++;
  } finally {
    await local.close();
  }
  console.log(`Sentry browser regression passed (${checked} checks): layout coverage, one client, uncaught and handled errors, automatic error Replay, release/path tags, private query omission and localhost gating. All telemetry was intercepted locally.`);
} finally {
  await browser.close();
}
