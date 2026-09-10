import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {build} from 'esbuild';
import {chromium} from 'playwright';

// Exercise only the real lazy-loader boundary. The local chunk contains no
// account client or comment data, and no external service is contacted.
const bundle = await build({
  entryPoints: [new URL('../../src/scripts/blog-comments.ts', import.meta.url).pathname],
  bundle: true, platform: 'browser', format: 'esm', write: false,
  define: {'import.meta.env.DEV': 'false'},
  plugins: [{name: 'comment-chunk-fixture', setup(build) {
    build.onResolve({filter: /\/mount-comments$/}, () => ({path: '/comments-chunk.js', external: true}));
  }}],
});
const loader = bundle.outputFiles[0].text;
const chunk = `export function mountComments(host, pathname, onReady) {
  host.textContent = '评论组件已挂载';
  queueMicrotask(onReady);
  return {destroy() {host.replaceChildren();}};
}`;
const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"></head><body>
  <section id="comments" data-convex-comments data-comment-pathname="/docs/comments-fixture/">
    <h2>评论</h2><div data-comments-placeholder>
      <p role="status" data-comments-load-status>正在加载评论…</p>
      <button data-comments-retry hidden>重新加载</button><button data-comments-refresh hidden>刷新页面</button>
    </div><div data-comments-mount hidden></div>
  </section><script type="module" src="/loader.js"></script></body></html>`;
let mode = 'failed';
let pendingResponse;
const server = createServer((request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  if (request.url === '/loader.js') {
    response.setHeader('Content-Type', 'text/javascript'); response.end(loader);
  } else if (request.url === '/comments-chunk.js') {
    if (mode === 'failed') {response.statusCode = 404; response.end('Build chunk unavailable');}
    else if (mode === 'pending') pendingResponse = response;
    else {response.setHeader('Content-Type', 'text/javascript'); response.end(chunk);}
  } else {response.setHeader('Content-Type', 'text/html'); response.end(html);}
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({headless: true});
  const page = await browser.newPage({viewport: {width: 390, height: 844}});
  await page.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
  await page.goto(base);
  await page.getByRole('alert').waitFor();
  assert.match(await page.getByRole('alert').textContent(), /评论未能加载/);
  await page.getByRole('button', {name: '重新加载', exact: true}).click();
  await page.getByRole('alert').waitFor();
  assert.equal(await page.locator('[data-comments-mount]').isVisible(), false, 'A failed chunk never pretends to mount comments');

  mode = 'ready';
  await page.getByRole('button', {name: '刷新页面', exact: true}).click();
  await page.getByText('评论组件已挂载', {exact: true}).waitFor();
  assert.equal(await page.locator('[data-comments-placeholder]').isVisible(), false, 'A new document recovers from obsolete chunk URLs');
  assert.equal(await page.locator('[data-convex-comments]').getAttribute('data-comments-loaded'), 'true');

  const linkedPage = await browser.newPage();
  await linkedPage.addInitScript(() => {
    // A fragment target is absent before React mounts, so visibility alone
    // cannot reveal a notification's comment. The loader must start directly.
    window.IntersectionObserver = class {observe() {} unobserve() {} disconnect() {} takeRecords() {return [];}};
  });
  await linkedPage.goto(`${base}/#comment-notification_target`);
  await linkedPage.getByText('评论组件已挂载', {exact: true}).waitFor();
  assert.equal(await linkedPage.locator('[data-convex-comments]').getAttribute('data-comments-loaded'), 'true');
  await linkedPage.close();

  mode = 'pending';
  await page.reload();
  await page.getByRole('alert').waitFor({timeout: 20_000});
  assert.ok(pendingResponse, 'A pending chunk reached the bounded loading timeout');
  pendingResponse.setHeader('Content-Type', 'text/javascript');
  pendingResponse.end(chunk);
  await page.waitForLoadState('networkidle');
  assert.equal(await page.getByText('评论组件已挂载', {exact: true}).count(), 0, 'A late chunk cannot clear a timed-out failure');
  assert.equal(await page.getByRole('button', {name: '刷新页面', exact: true}).isVisible(), true);
  console.log('Comments loader: missing chunk, retry, document refresh, fragment target and bounded timeout passed.');
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
