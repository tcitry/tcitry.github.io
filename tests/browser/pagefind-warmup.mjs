import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {build} from 'esbuild';
import {chromium} from 'playwright';

// Homepage idle warmup must call the same Pagefind module search uses, and must
// not request query index or fragment chunks. The mock init stands in for
// Pagefind 1.5's init(), which starts worker, wasm and metadata loading.
const browserBundle = await build({
  entryPoints: [new URL('../fixtures/pagefind-warmup-browser.ts', import.meta.url).pathname],
  bundle: true, platform: 'browser', format: 'esm', write: false,
  define: {'import.meta.env.BASE_URL': '"/"'},
});
const script = browserBundle.outputFiles[0].text;
const requests = [];
const server = createServer((request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1');
  requests.push(url.pathname);
  if (url.pathname === '/warmup.js') {
    response.writeHead(200, {'content-type': 'text/javascript; charset=utf-8'});
    response.end(script);
    return;
  }
  if (url.pathname === '/pagefind/pagefind.js') {
    response.writeHead(200, {'content-type': 'text/javascript; charset=utf-8'});
    response.end(`
      export function init() { globalThis.__pfInits = (globalThis.__pfInits || 0) + 1; }
      export function search() {
        globalThis.__pfSearches = (globalThis.__pfSearches || 0) + 1;
        return Promise.resolve({results: []});
      }
    `);
    return;
  }
  const home = url.pathname === '/';
  response.writeHead(200, {'content-type': 'text/html; charset=utf-8'});
  response.end(`<!doctype html><html lang="zh-CN"><head><title>${home ? 'home' : 'post'}</title></head><body><script type="module" src="/warmup.js"></script></body></html>`);
});
const port = await new Promise((resolve) => {
  server.listen(0, '127.0.0.1', () => resolve(server.address().port));
});
const browser = await chromium.launch({headless: true});
try {
  const absent = await browser.newPage();
  await absent.goto(`http://127.0.0.1:${port}/posts/`, {waitUntil: 'load'});
  const initsOffHome = await absent.evaluate(() => new Promise((resolve) => {
    const finish = () => resolve(globalThis.__pfInits || 0);
    if (typeof requestIdleCallback === 'function') requestIdleCallback(() => setTimeout(finish, 0), {timeout: 500});
    else setTimeout(finish, 250);
  }));
  assert.equal(initsOffHome, 0, 'Pages other than the homepage do not start Pagefind');
  assert.equal(requests.includes('/pagefind/pagefind.js'), false);

  await absent.evaluate(() => {
    history.pushState({}, '', '/');
    document.dispatchEvent(new Event('astro:page-load'));
  });
  await absent.waitForFunction(() => globalThis.__pfInits === 1);
  const searched = await absent.evaluate(() => window.__searchContent('正文'));
  assert.equal(searched.engine, 'pagefind');
  assert.equal(searched.total, 0);
  assert.equal(await absent.evaluate(() => globalThis.__pfSearches), 1);
  assert.equal(await absent.evaluate(() => globalThis.__pfInits), 1);
  assert.deepEqual(requests.filter((path) => path.startsWith('/pagefind/')), ['/pagefind/pagefind.js']);

  const home = await browser.newPage();
  await home.goto(`http://127.0.0.1:${port}/`, {waitUntil: 'load'});
  await home.waitForFunction(() => globalThis.__pfInits === 1);
  const direct = await home.evaluate(() => window.__searchContent('首页'));
  assert.equal(direct.engine, 'pagefind');
  assert.equal(await home.evaluate(() => globalThis.__pfSearches), 1);
  await home.close();
  await absent.close();

  const pagefindRequests = requests.filter((path) => path.startsWith('/pagefind/'));
  assert.ok(pagefindRequests.length >= 1 && pagefindRequests.every((path) => path === '/pagefind/pagefind.js'));
  assert.equal(requests.some((path) => path.includes('/fragment') || path.includes('/pagefind/index/') || path.endsWith('.pf_meta')), false);
  console.log('Homepage idle warmup calls Pagefind init once per page and leaves query chunks unloaded.');
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
