import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import worker from '../workers/index.js';
import { notifyPageView, shouldNotifyVisit, visitPayload, visitSecrets } from '../workers/visit-notify.mjs';

const wranglerSource = new URL('../wrangler.jsonc', import.meta.url);
const workerSource = new URL('../workers/index.js', import.meta.url);
const notifySource = new URL('../workers/visit-notify.mjs', import.meta.url);
const secrets = {
  VISIT_WEBHOOK_URL: 'https://example.invalid/visit',
  VISIT_WEBHOOK_AUTHORIZATION: 'Bearer test-visit-secret',
};
const browser = {
  accept: 'text/html,application/xhtml+xml;q=0.9',
  'sec-fetch-mode': 'navigate',
  'sec-fetch-dest': 'document',
  'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
};

function jsonc(text) {
  return JSON.parse(text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, ''));
}

function request(path = '/', headers = browser, method = 'GET') {
  return new Request(`https://yindongliang.com${path}`, { method, headers });
}

function html(status = 200, type = 'text/html; charset=utf-8') {
  return new Response('<html></html>', { status, headers: { 'content-type': type } });
}

async function dispatched(requestValue, env = secrets, asset = html()) {
  const pending = [];
  const calls = [];
  const ctx = { waitUntil(task) { pending.push(task); } };
  const scheduled = notifyPageView(requestValue, env, ctx, Promise.resolve(asset), async (url, init) => {
    calls.push({ url, init });
    return new Response('ok');
  });
  await Promise.all(pending);
  return { scheduled, pending, calls };
}

test('Wrangler invokes the Worker only for HTML page paths and does not store visit secrets', async () => {
  const source = await readFile(wranglerSource, 'utf8');
  const config = jsonc(source);
  assert.equal(config.name, 'tcitry-blog');
  assert.equal(config.main, 'workers/index.js');
  assert.equal(config.assets.directory, './dist');
  assert.equal(config.assets.binding, 'ASSETS');
  assert.equal(config.assets.html_handling, 'force-trailing-slash');
  assert.equal(config.assets.not_found_handling, '404-page');
  assert.deepEqual(config.assets.run_worker_first, ['/', '/*/', '!/cdn-cgi/*', '!/pagefind/*', '!/_astro/*']);
  assert.equal(config.vars, undefined);
  assert.match(source, /VISIT_WEBHOOK_URL/);
  assert.match(source, /VISIT_WEBHOOK_AUTHORIZATION/);
  assert.doesNotMatch(source, /VISIT_WEBHOOK_URL\s*=/);
  assert.doesNotMatch(source, /https:\/\/example\.invalid|Bearer |hooks\.zapier/i);
  const [workerText, notifyText] = await Promise.all([readFile(workerSource, 'utf8'), readFile(notifySource, 'utf8')]);
  assert.match(workerText, /waitUntil|notifyPageView/);
  assert.doesNotMatch(workerText + notifyText, /VISIT_WEBHOOK_URL:\s*'https?:\/\//);
});

test('Visit secrets require both an HTTPS URL and an authorization value', () => {
  assert.equal(visitSecrets({}), null);
  assert.equal(visitSecrets({ VISIT_WEBHOOK_URL: secrets.VISIT_WEBHOOK_URL }), null);
  assert.equal(visitSecrets({ VISIT_WEBHOOK_AUTHORIZATION: secrets.VISIT_WEBHOOK_AUTHORIZATION }), null);
  assert.equal(visitSecrets({ ...secrets, VISIT_WEBHOOK_URL: '  ' }), null);
  assert.equal(visitSecrets({ ...secrets, VISIT_WEBHOOK_URL: 'http://example.invalid/visit' }), null);
  assert.equal(visitSecrets({ ...secrets, VISIT_WEBHOOK_URL: 'not-a-url' }), null);
  assert.deepEqual(visitSecrets({ ...secrets, VISIT_WEBHOOK_URL: ' https://example.invalid/visit ' }), {
    url: 'https://example.invalid/visit',
    authorization: 'Bearer test-visit-secret',
  });
});

test('Page navigations notify; bots, prefetch, assets and health checks do not', () => {
  for (const path of ['/', '/posts/hello/', '/weekly/page/2/', '/docs/%E6%96%87%E6%A1%A3/']) {
    assert.equal(shouldNotifyVisit(request(path)), true, path);
  }
  assert.equal(shouldNotifyVisit(request('/', browser, 'HEAD')), false);
  assert.equal(shouldNotifyVisit(request('/', { ...browser, 'user-agent': 'Mozilla/5.0 Googlebot/2.1' })), false);
  assert.equal(shouldNotifyVisit(request('/', { ...browser, 'user-agent': 'curl/8.7.1' })), false);
  assert.equal(shouldNotifyVisit(request('/', { ...browser, 'user-agent': '' })), false);
  assert.equal(shouldNotifyVisit(request('/', { ...browser, purpose: 'prefetch' })), false);
  assert.equal(shouldNotifyVisit(request('/', { ...browser, 'sec-fetch-mode': 'no-cors', 'sec-fetch-dest': 'empty' })), false);
  assert.equal(shouldNotifyVisit(request('/_astro/page.js', browser)), false);
  assert.equal(shouldNotifyVisit(request('/pagefind/pagefind.js', browser)), false);
  assert.equal(shouldNotifyVisit(request('/cdn-cgi/trace', browser)), false);
  assert.equal(shouldNotifyVisit(request('/favicon.ico', browser)), false);
  assert.equal(shouldNotifyVisit(request('/index.xml', browser)), false);
  assert.equal(shouldNotifyVisit(request('/healthz', browser)), false);
  assert.equal(shouldNotifyVisit(request('/', { ...browser, accept: 'image/avif,image/webp' })), false);
});

test('Webhook payload is only path, optional referrer, and an ISO timestamp', () => {
  const now = new Date('2026-09-09T03:49:00.000Z');
  const withoutReferrer = visitPayload(request('/posts/hello/?utm=1', {
    ...browser,
    'user-agent': 'Mozilla/5.0 secret-ua',
    cookie: 'session=secret-cookie',
  }), now);
  assert.deepEqual(withoutReferrer, { path: '/posts/hello/', timestamp: '2026-09-09T03:49:00.000Z' });
  assert.deepEqual(Object.keys(withoutReferrer).sort(), ['path', 'timestamp']);
  const json = JSON.stringify(withoutReferrer);
  assert.doesNotMatch(json, /secret-ua|secret-cookie|utm=1|cf-connecting-ip|127\.0\.0\.1/);
  assert.deepEqual(visitPayload(request('/archives/', { ...browser, referer: 'https://news.example/item' }), now), {
    path: '/archives/',
    timestamp: '2026-09-09T03:49:00.000Z',
    referrer: 'https://news.example/item',
  });
});

test('Missing secrets or a failed webhook never block the static response', async () => {
  const page = request('/');
  const missing = await dispatched(page, {});
  assert.equal(missing.scheduled, false);
  assert.equal(missing.pending.length, 0);
  assert.deepEqual(missing.calls, []);

  const posted = await dispatched(page);
  assert.equal(posted.scheduled, true);
  assert.equal(posted.calls.length, 1);
  assert.equal(posted.calls[0].url, secrets.VISIT_WEBHOOK_URL);
  assert.equal(posted.calls[0].init.headers.authorization, secrets.VISIT_WEBHOOK_AUTHORIZATION);
  assert.equal(posted.calls[0].init.headers['content-type'], 'application/json');
  const body = JSON.parse(posted.calls[0].init.body);
  assert.deepEqual(Object.keys(body).sort(), ['path', 'timestamp']);
  assert.equal(body.path, '/');
  assert.match(body.timestamp, /^\d{4}-\d{2}-\d{2}T/);

  assert.equal((await dispatched(page, secrets, html(404))).calls.length, 0);
  assert.equal((await dispatched(page, secrets, html(200, 'text/css'))).calls.length, 0);

  const pending = [];
  notifyPageView(page, secrets, { waitUntil(task) { pending.push(task); } }, Promise.resolve(html()), async () => {
    throw new Error('webhook down');
  });
  await pending[0];
});

test('Worker fetch returns assets immediately and only waitUntil posts the visit', async () => {
  const pending = [];
  let resolveAsset;
  const assetPromise = new Promise(resolve => { resolveAsset = resolve; });
  const env = { ...secrets, ASSETS: { fetch() { return assetPromise; } } };
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return new Response('ok');
  };
  try {
    const responsePromise = worker.fetch(request('/posts/hello/'), env, {
      waitUntil(task) { pending.push(task); },
    });
    assert.equal(pending.length, 1);
    assert.equal(calls.length, 0);
    resolveAsset(html());
    const response = await responsePromise;
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /text\/html/);
    await pending[0];
    assert.equal(calls.length, 1);
    assert.equal(JSON.parse(calls[0].init.body).path, '/posts/hello/');
  } finally {
    globalThis.fetch = original;
  }

  const skipped = [];
  const empty = await worker.fetch(request('/'), { ASSETS: { fetch: () => html() } }, {
    waitUntil(task) { skipped.push(task); },
  });
  assert.equal(empty.status, 200);
  assert.deepEqual(skipped, []);
});
