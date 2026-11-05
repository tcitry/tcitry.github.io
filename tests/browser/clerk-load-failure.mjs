import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {build} from 'esbuild';
import {chromium} from 'playwright';

const config = await readFile(new URL('../../wrangler.jsonc', import.meta.url), 'utf8');
const key = process.env.PUBLIC_CLERK_PUBLISHABLE_KEY || config.match(/"PUBLIC_CLERK_PUBLISHABLE_KEY":\s*"([^"]+)"/)[1];
const bundle = await build({
  stdin: {
    contents: `import React from 'react';
      import {createRoot} from 'react-dom/client';
      import {ClerkFailed} from '@clerk/react';
      import BlogClerkProvider from './src/components/auth/BlogClerkProvider';
      createRoot(document.getElementById('auth')).render(<BlogClerkProvider>
        <ClerkFailed><p role="status">登录服务暂时无法连接，请稍后重试。</p></ClerkFailed>
      </BlogClerkProvider>);`,
    resolveDir: new URL('../../', import.meta.url).pathname, loader: 'tsx',
  },
  bundle: true, platform: 'browser', format: 'esm', write: false, jsx: 'automatic',
  define: {'import.meta.env.PUBLIC_CLERK_PUBLISHABLE_KEY': JSON.stringify(key)},
});
const server = createServer((request, response) => {
  if (request.url === '/app.js') {
    response.setHeader('Content-Type', 'text/javascript');
    response.end(bundle.outputFiles[0].text);
  } else response.end('<!doctype html><meta charset="utf-8"><main><h1>博客正文仍可阅读</h1><button onclick="this.textContent=\'操作成功\'">页面操作</button><div id="auth"></div></main><script type="module" src="/app.js"></script>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({headless: true});
  const page = await browser.newPage();
  const errors = [];
  let blocked = 0;
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    window.__unhandled = [];
    window.addEventListener('unhandledrejection', event => {
      setTimeout(() => { if (!event.defaultPrevented) window.__unhandled.push(String(event.reason)); }, 0);
    });
  });
  await page.route('https://clerk.yindongliang.com/**', route => { blocked++; return route.abort(); });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.getByRole('status').filter({hasText: '登录服务暂时无法连接'}).waitFor({timeout: 45000});
  await page.getByRole('button', {name: '页面操作'}).click();
  await page.getByRole('button', {name: '操作成功'}).waitFor();
  assert.ok(blocked > 0, 'Clerk must really attempt its script request');
  assert.deepEqual(errors, []);
  assert.deepEqual(await page.evaluate(() => window.__unhandled), []);
  await page.evaluate(() => {
    Promise.reject(new Error('ClerkJS: Network error at "https://clerk.yindongliang.com/v1/client/sessions/fixture/touch" - TypeError: Load failed'));
  });
  await page.waitForTimeout(100);
  assert.deepEqual(errors, []);
  assert.deepEqual(await page.evaluate(() => window.__unhandled), []);
  await page.screenshot({path: '/home/ubuntu/dev-133-clerk-blocked.png'});
  console.log(`Clerk blocked-request fixture: blocked=${blocked}; pageerror=0; uncancelled unhandledrejection=0; friendly fallback visible; page button usable. SDK touch rejection fixture cancelled.`);
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
