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
const successChunk = `export function mountChat(host, onClose, onReady) {
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
const throwOnceChunk = `let mounts = 0;
export function mountChat(host, onClose, onReady) {
  mounts += 1;
  if (mounts === 1) throw new TypeError('Minified React error #310');
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
const asyncErrorChunk = `export function mountChat(host, onClose, onReady, ui = {}) {
  host.replaceChildren();
  queueMicrotask(() => ui.onMountError?.(new TypeError("Cannot read properties of undefined (reading 'useAuth')")));
  return {requestPrompt() {}, destroy() { host.replaceChildren(); }};
}`;
const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"></head><body>
  <button type="button" data-blog-search-trigger>搜索</button>
  <div class="blog-chat-widget" data-blog-chat-widget>
    <button class="blog-chat-widget__launcher" type="button" aria-label="打开博客助手" aria-haspopup="dialog" aria-expanded="false" aria-controls="blog-chat-panel" data-chat-launcher hidden>打开<span data-chat-launcher-face></span></button>
    <button class="blog-chat-widget__expand" type="button" aria-label="展开博客助手" aria-haspopup="dialog" aria-expanded="false" aria-controls="blog-chat-panel" data-chat-expand hidden>展开</button>
    <dialog id="blog-chat-panel" class="blog-chat-widget__panel" aria-label="博客助手" data-chat-loaded="false">
      <template data-chat-load-template>
        <div class="blog-chat-widget__loading-header"><strong>博客助手</strong>
          <button type="button" aria-label="关闭博客助手" data-chat-close>关闭</button>
        </div>
        <div class="blog-chat-widget__loading">
          <p role="status" data-chat-load-status>正在打开博客助手…</p>
          <p data-chat-load-detail hidden></p>
          <button type="button" data-chat-retry hidden>重新加载</button>
          <button type="button" data-chat-refresh hidden>刷新页面</button>
        </div>
      </template>
      <div class="blog-chat-widget__mount" data-chat-mount>
        <div class="blog-chat-widget__loading-header"><strong>博客助手</strong>
          <button type="button" aria-label="关闭博客助手" data-chat-close>关闭</button>
        </div>
        <div class="blog-chat-widget__loading">
          <p role="status" data-chat-load-status>正在打开博客助手…</p>
          <p data-chat-load-detail hidden></p>
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
    else if (mode === 'throw-once') {response.setHeader('Content-Type', 'text/javascript'); response.end(throwOnceChunk);}
    else if (mode === 'async-error') {response.setHeader('Content-Type', 'text/javascript'); response.end(asyncErrorChunk);}
    else {response.setHeader('Content-Type', 'text/javascript'); response.end(successChunk);}
  } else {response.setHeader('Content-Type', 'text/html'); response.end(html);}
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const chunk = successChunk;
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

  mode = 'throw-once';
  await page.reload();
  await page.locator('[data-chat-launcher]').waitFor({state: 'visible'});
  await page.evaluate(() => document.dispatchEvent(new CustomEvent('blog:ask-ai', {detail: {prompt: '首次挂载失败后应重试'}})));
  await page.locator('.assistant-workspace').waitFor();
  await page.waitForFunction(() => document.querySelector('textarea[aria-label="向 AI 博客助手提问"]')?.value === '首次挂载失败后应重试');
  assert.equal(await page.getByText('助手未能打开').count(), 0, 'A transient mount throw must not keep the failure shell after retry');

  mode = 'async-error';
  await page.reload();
  await page.locator('[data-chat-launcher]').waitFor({state: 'visible'});
  await page.evaluate(() => document.dispatchEvent(new CustomEvent('blog:ask-ai', {detail: {prompt: '导入成功但 React 未挂上'}})));
  await page.getByRole('status').filter({hasText: '助手未能打开，请重试'}).waitFor();
  assert.equal(await page.locator('[data-chat-load-detail]').evaluate(element => element.textContent), "Cannot read properties of undefined (reading 'useAuth')");
  assert.equal(await page.getByRole('button', {name: '重新加载', exact: true}).isVisible(), true);
  assert.equal(await page.getByText('检查网络后重试').count(), 0, 'A React mount failure is not reported as a silent network failure');

  mode = 'missing';
  await page.reload();
  await page.locator('[data-chat-launcher]').waitFor({state: 'visible'});
  await page.evaluate(() => document.dispatchEvent(new CustomEvent('blog:ask-ai', {detail: {prompt: '缺失 chunk 时应提示刷新'}})));
  await page.getByRole('status').filter({hasText: '若页面刚更新，请刷新后再试'}).waitFor();
  assert.equal(await page.getByRole('button', {name: '重新加载', exact: true}).isVisible(), true);
  assert.equal(await page.getByRole('button', {name: '刷新页面', exact: true}).isVisible(), true);
  assert.equal(await page.getByText('检查网络后重试').count(), 0, 'A missing chunk is not reported as a silent network failure');

  mode = 'ok';
  await page.setViewportSize({width: 320, height: 720});
  await page.reload();
  await page.locator('[data-chat-launcher]').waitFor({state: 'visible'});
  await page.evaluate(() => {
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
      configurable: true,
      value() {
        throw new DOMException('The document already has an open modal dialog', 'InvalidStateError');
      },
    });
  });
  await page.evaluate(() => document.dispatchEvent(new CustomEvent('blog:ask-ai', {detail: {prompt: '移动端 showModal 失败仍应打开'}})));
  await page.waitForFunction(() => document.querySelector('#blog-chat-panel')?.open === true);
  await page.locator('.assistant-workspace').waitFor();
  await page.waitForFunction(() => document.querySelector('textarea[aria-label="向 AI 博客助手提问"]')?.value === '移动端 showModal 失败仍应打开');
  assert.equal(await page.getByText('助手未能加载').count(), 0);
  console.log('Ask AI loader: CSS preload is cancelled, mount retries once, React mount errors are distinct from network, a missing chunk asks for a refresh, and a mobile showModal failure still opens the assistant.');
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}

const signedInBundle = await build({
  entryPoints: [new URL('../../src/scripts/blog-chat.ts', import.meta.url).pathname],
  bundle: true, platform: 'browser', format: 'esm', write: false, jsx: 'automatic',
  define: {
    'import.meta.env.DEV': 'false',
    'import.meta.env.PUBLIC_CLERK_PUBLISHABLE_KEY': JSON.stringify('pk_test_fixture'),
  },
  plugins: [{name: 'signed-in-island-fixture', setup(build) {
    build.onResolve({filter: /^@clerk\/react$/}, () => ({path: 'clerk', namespace: 'signed-in-clerk'}));
    build.onLoad({filter: /.*/, namespace: 'signed-in-clerk'}, () => ({contents: `
      import {useRef} from 'react';
      export function ClerkProvider({children}) {
        const counted = useRef(false);
        if (!counted.current) {
          counted.current = true;
          window.__clerkProviders = (window.__clerkProviders || 0) + 1;
        }
        return children;
      }
      export function useAuth() { return {isLoaded: true, isSignedIn: true, userId: 'user-a', sessionId: 'session-a'}; }
      export function useUser() { return {isLoaded: true, user: {id: 'user-a', firstName: 'A', lastName: 'B'}}; }
      export function UNSAFE_PortalProvider({children}) { return children; }
    `, loader: 'js', resolveDir: new URL('../../', import.meta.url).pathname}));
    build.onResolve({filter: /\/AssistantWorkspace$/}, () => ({path: new URL('../fixtures/assistant-workspace-stub.tsx', import.meta.url).pathname}));
    build.onResolve({filter: /\/monitoring$/}, () => ({path: '/monitoring.js', external: true}));
  }}],
});
const signedInLoader = signedInBundle.outputFiles[0].text;
const signedHtml = html.replace('<script type="module" src="/loader.js"></script>', '<script type="module" src="/signed-loader.js"></script>');
const signedServer = createServer((request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  if (request.url === '/signed-loader.js') {
    response.setHeader('Content-Type', 'text/javascript'); response.end(signedInLoader);
  } else if (request.url === '/monitoring.js') {
    response.setHeader('Content-Type', 'text/javascript'); response.end('export function captureFeatureError() {}');
  } else {response.setHeader('Content-Type', 'text/html'); response.end(signedHtml);}
});
await new Promise(resolve => signedServer.listen(0, '127.0.0.1', resolve));
const signedBase = `http://127.0.0.1:${signedServer.address().port}`;
let signedBrowser;
try {
  signedBrowser = await chromium.launch({headless: true});
  const page = await signedBrowser.newPage({viewport: {width: 1016, height: 800}});
  await page.route('**/*', route => new URL(route.request().url()).origin === signedBase ? route.continue() : route.abort());
  await page.goto(signedBase);
  await page.locator('[data-chat-launcher]').waitFor({state: 'visible'});
  await page.waitForFunction(() => document.querySelector('[data-chat-launcher]')?.hasAttribute('data-signed-in'));
  await page.evaluate(() => document.dispatchEvent(new CustomEvent('blog:ask-ai', {detail: {prompt: '已登录问 AI'}})));
  await page.locator('.assistant-workspace').waitFor();
  await page.waitForFunction(() => document.querySelector('textarea[aria-label="向 AI 博客助手提问"]')?.value === '已登录问 AI');
  const providers = await page.evaluate(() => window.__clerkProviders);
  assert.equal(providers, 1, 'Ask AI must reuse the signed-in launcher ClerkProvider instead of creating a second tree');
  assert.equal(await page.getByText('助手未能加载').count(), 0);
  console.log('Ask AI signed-in island: launcher ClerkProvider is reused and the prompt still mounts.');
} finally {
  await signedBrowser?.close();
  signedServer.closeAllConnections();
  await new Promise(resolve => signedServer.close(resolve));
}
