import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {build} from 'esbuild';
import {chromium} from 'playwright';

// Real blog-chat loader and native host. The chat module is a local stub so
// HeroUI Pro / Clerk / Convex are never imported.
const bundle = await build({
  entryPoints: [new URL('../../src/scripts/blog-chat.ts', import.meta.url).pathname],
  bundle: true, platform: 'browser', format: 'esm', write: false,
  define: {
    'import.meta.env.DEV': 'false',
    'import.meta.env.PUBLIC_CLERK_PUBLISHABLE_KEY': JSON.stringify(''),
  },
  plugins: [{name: 'chat-chunk-fixture', setup(build) {
    build.onResolve({filter: /\/mount-chat$/}, () => ({path: '/chat-chunk.js', external: true}));
    build.onResolve({filter: /\/mount-launcher$/}, () => ({path: '/launcher-chunk.js', external: true}));
    build.onResolve({filter: /\/monitoring$/}, () => ({path: '/monitoring.js', external: true}));
  }}],
});
const loader = bundle.outputFiles[0].text;
const chunk = `export function mountChat(host, onClose, onReady) {
  host.replaceChildren();
  const workspace = document.createElement('div');
  workspace.className = 'assistant-workspace';
  const input = document.createElement('textarea');
  input.setAttribute('aria-label', '向 AI 博客助手提问');
  workspace.append(input);
  host.append(workspace);
  queueMicrotask(onReady);
  return {requestPrompt(text) { input.value = text; }, destroy() { host.replaceChildren(); }};
}`;
const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"></head><body>
  <button type="button" data-blog-search-trigger>搜索</button>
  <div class="blog-chat-widget" data-blog-chat-widget>
    <button class="blog-chat-widget__launcher" type="button" aria-label="打开博客助手" aria-haspopup="dialog" aria-expanded="false" aria-controls="blog-chat-panel" data-chat-launcher hidden>打开</button>
    <button class="blog-chat-widget__expand" type="button" aria-label="展开博客助手" aria-haspopup="dialog" aria-expanded="false" aria-controls="blog-chat-panel" data-chat-expand hidden>展开</button>
    <dialog id="blog-chat-panel" class="blog-chat-widget__panel" aria-label="博客助手" data-chat-loaded="false">
      <div class="blog-chat-widget__mount" data-chat-mount>
        <div class="blog-chat-widget__loading-header"><strong>博客助手</strong>
          <button type="button" aria-label="关闭博客助手" data-chat-close>关闭</button>
        </div>
        <div class="blog-chat-widget__loading">
          <p role="status" data-chat-load-status>正在打开博客助手…</p>
          <button type="button" data-chat-retry hidden>重新加载</button>
          <button type="button" data-chat-refresh hidden>刷新页面</button>
        </div>
      </div>
    </dialog>
  </div>
  <script type="module" src="/loader.js"></script>
</body></html>`;

let mode = 'pending';
let pending;
const server = createServer((request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  if (request.url === '/loader.js') {
    response.setHeader('Content-Type', 'text/javascript'); response.end(loader);
  } else if (request.url === '/monitoring.js') {
    response.setHeader('Content-Type', 'text/javascript'); response.end('export function captureFeatureError() {}');
  } else if (request.url === '/chat-chunk.js') {
    if (mode === 'missing') {response.statusCode = 404; response.end('missing');}
    else if (mode === 'pending') pending = response;
    else {response.setHeader('Content-Type', 'text/javascript'); response.end(chunk);}
  } else {response.setHeader('Content-Type', 'text/html'); response.end(html);}
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({headless: true});
  const page = await browser.newPage({viewport: {width: 1016, height: 800}});
  await page.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
  await page.goto(base);
  await page.locator('[data-chat-launcher]').waitFor({state: 'visible'});

  await page.evaluate(() => document.dispatchEvent(new CustomEvent('blog:ask-ai', {detail: {prompt: '用这个问题问 AI'}})));
  await page.waitForFunction(() => document.querySelector('#blog-chat-panel')?.open === true);
  await page.waitForFunction(() => document.querySelector('[data-chat-load-status]')?.textContent.includes('正在打开'));
  const prevented = await page.evaluate(() => {
    const event = new Event('vite:preloadError', {cancelable: true});
    Object.defineProperty(event, 'payload', {value: new Error('Unable to preload CSS for /_astro/mount-chat.css')});
    window.dispatchEvent(event);
    return event.defaultPrevented;
  });
  assert.equal(prevented, true, 'A CSS preload error must not reject the assistant import');
  assert.ok(pending, 'Ask AI waits on the real mount-chat request');
  pending.setHeader('Content-Type', 'text/javascript');
  pending.end(chunk);
  pending = undefined;
  await page.locator('.assistant-workspace').waitFor();
  await page.waitForFunction(() => document.querySelector('textarea[aria-label="向 AI 博客助手提问"]')?.value === '用这个问题问 AI');
  assert.equal(await page.getByText('助手未能加载').count(), 0, 'Ask AI must not stay on the load-failure shell');
  assert.equal(await page.locator('#blog-chat-panel').getAttribute('data-chat-loaded'), 'true');

  mode = 'missing';
  await page.reload();
  await page.locator('[data-chat-launcher]').waitFor({state: 'visible'});
  await page.evaluate(() => document.dispatchEvent(new CustomEvent('blog:ask-ai', {detail: {prompt: '缺失 chunk 时应提示刷新'}})));
  await page.getByRole('status').filter({hasText: '若页面刚更新，请刷新后再试'}).waitFor();
  assert.equal(await page.getByRole('button', {name: '重新加载', exact: true}).isVisible(), true);
  assert.equal(await page.getByRole('button', {name: '刷新页面', exact: true}).isVisible(), true);
  assert.equal(await page.getByText('检查网络后重试').count(), 0, 'A missing chunk is not reported as a silent network failure');
  console.log('Ask AI loader: CSS preload is cancelled, the chat UI mounts with the prompt, and a missing chunk asks for a refresh.');
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
