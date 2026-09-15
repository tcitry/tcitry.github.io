import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {build} from 'esbuild';
import {chromium} from 'playwright';

// Real blog-chat close/focus behavior. The chat island is a stub so HeroUI Pro
// is never imported; CSS tooltips still come from the widget stylesheet.
const css = await readFile(new URL('../../src/styles/chat-widget.css', import.meta.url));
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
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'assistant-workspace__close';
  close.setAttribute('aria-label', '关闭博客助手');
  close.addEventListener('click', onClose);
  workspace.append(close);
  host.append(workspace);
  queueMicrotask(onReady);
  return {requestPrompt() {}, destroy() { host.replaceChildren(); }};
}`;
const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>:root{--color-link:#0055bb}</style><style>${css}</style></head><body>
  <div class="blog-chat-widget" data-blog-chat-widget>
    <button class="blog-chat-widget__launcher" type="button" aria-label="打开博客助手" aria-haspopup="dialog" aria-expanded="false" aria-controls="blog-chat-panel" data-chat-launcher hidden>打开<span class="blog-chat-widget__tooltip" aria-hidden="true">博客助手</span></button>
    <button class="blog-chat-widget__expand" type="button" aria-label="展开博客助手" aria-haspopup="dialog" aria-expanded="false" aria-controls="blog-chat-panel" data-chat-expand hidden>展开<span class="blog-chat-widget__tooltip" aria-hidden="true">展开侧栏</span></button>
    <dialog id="blog-chat-panel" class="blog-chat-widget__panel" aria-label="博客助手" data-chat-loaded="false">
      <div class="blog-chat-widget__mount" data-chat-mount>
        <button type="button" aria-label="关闭博客助手" data-chat-close>关闭</button>
        <p role="status" data-chat-load-status>正在打开博客助手…</p>
      </div>
    </dialog>
  </div>
  <script type="module" src="/loader.js"></script>
</body></html>`;

const server = createServer((request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  if (request.url === '/loader.js') {
    response.setHeader('Content-Type', 'text/javascript'); response.end(loader);
  } else if (request.url === '/monitoring.js') {
    response.setHeader('Content-Type', 'text/javascript'); response.end('export function captureFeatureError() {}');
  } else if (request.url === '/chat-chunk.js') {
    response.setHeader('Content-Type', 'text/javascript'); response.end(chunk);
  } else {response.setHeader('Content-Type', 'text/html'); response.end(html);}
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const tooltipHidden = element => {
  const style = getComputedStyle(element);
  return style.visibility === 'hidden' || Number(style.opacity) === 0;
};
let browser;
try {
  browser = await chromium.launch({headless: true});
  const page = await browser.newPage({viewport: {width: 1016, height: 800}});
  await page.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
  await page.goto(base);
  const expand = page.locator('[data-chat-expand]');
  const panel = page.locator('#blog-chat-panel');
  const close = panel.getByRole('button', {name: '关闭博客助手', exact: true});
  const tooltip = expand.locator('.blog-chat-widget__tooltip');
  await expand.waitFor({state: 'visible'});

  await expand.click();
  await page.locator('.assistant-workspace').waitFor();
  assert.equal(await close.evaluate(element => element.matches(':focus-visible')), false,
    'Pointer expand does not leave a keyboard focus ring on the collapse handle');
  assert.equal(await close.evaluate(element => {
    element.setAttribute('data-focus-visible', 'true');
    element.setAttribute('data-focus', 'true');
    const style = getComputedStyle(element);
    element.removeAttribute('data-focus-visible');
    element.removeAttribute('data-focus');
    return style.outlineStyle === 'none';
  }), true, 'HeroUI data-focus leftover on the collapse handle does not paint a box');
  await close.click();
  await panel.waitFor({state: 'hidden'});
  assert.equal(await expand.evaluate(element => element.matches(':focus-visible')), false,
    'Pointer close does not leave a keyboard focus ring on the expand handle');
  await page.mouse.move(20, 150);
  assert.equal(await tooltip.evaluate(tooltipHidden), true, 'Expand tooltip hides after the pointer leaves');

  await expand.click();
  await page.locator('.assistant-workspace').waitFor();
  await page.keyboard.press('Escape');
  await panel.waitFor({state: 'hidden'});
  assert.equal(await expand.evaluate(element => document.activeElement === element && element.matches(':focus-visible')), true,
    'Escape restores accessible focus to the expand handle');
  await page.mouse.move(20, 150);
  await page.waitForFunction(() => {
    const element = document.querySelector('[data-chat-expand] .blog-chat-widget__tooltip');
    const style = element && getComputedStyle(element);
    return style?.visibility === 'visible' && Number(style.opacity) >= .99;
  });
  assert.equal(await expand.evaluate(element => document.activeElement === element && element.matches(':focus-visible')), true,
    'Keyboard focus still shows the expand tooltip after the pointer leaves');

  await expand.click();
  await page.locator('.assistant-workspace').waitFor();
  await close.focus();
  await page.keyboard.press('Enter');
  await panel.waitFor({state: 'hidden'});
  assert.equal(await expand.evaluate(element => document.activeElement === element && element.matches(':focus-visible')), true,
    'Keyboard activation of close restores accessible focus to the opener');

  console.log('Assistant edge focus: pointer close has no sticky focus tooltip; Escape and Enter restore keyboard focus.');
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
