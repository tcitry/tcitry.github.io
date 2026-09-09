import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import {chromium} from 'playwright';

const root = fileURLToPath(new URL('../..', import.meta.url));
const cacheDir = await mkdtemp(join(tmpdir(), 'chat-ui-vite-'));
const server = await createServer({
  root, configFile: false, envDir: false, publicDir: false, cacheDir,
  plugins: [react(), tailwind()],
  resolve: {alias: [
    {find: /^@clerk\/react$/, replacement: fileURLToPath(new URL('../fixtures/reader-clerk.tsx', import.meta.url))},
  ]},
  define: {
    'import.meta.env.PUBLIC_CLERK_PUBLISHABLE_KEY': JSON.stringify('fixture-public-key'),
    'import.meta.env.PUBLIC_CONVEX_URL': JSON.stringify('https://fixture.convex.cloud'),
  },
  server: {host: '127.0.0.1', port: 0},
  logLevel: 'warn',
});

async function mockChat(context) {
  await context.addInitScript(() => {
    const originalFetch = window.fetch.bind(window);
    window.__chatRequests = [];
    window.__chatAborts = 0;
    window.__chatScenario = 'stream';
    window.fetch = async (input, init) => {
      if (new URL(typeof input === 'string' ? input : input.url, location.href).pathname.replace(/\/$/, '') !== '/api/chat') {
        return originalFetch(input, init);
      }
      window.__chatRequests.push({headers: init.headers, body: JSON.parse(init.body)});
      if (window.__chatScenario === '429') {
        return new Response(JSON.stringify({message: '当前提问较多，请稍后再试。'}), {
          status: 429, headers: {'Content-Type': 'application/json', 'Retry-After': '2'},
        });
      }
      const encoder = new TextEncoder();
      let closed = false;
      let streamController;
      const signal = init.signal;
      const stream = new ReadableStream({
        start(controller) {
          streamController = controller;
          signal.addEventListener('abort', () => {
            if (closed) return;
            window.__chatAborts++;
            closed = true;
            controller.error(new DOMException('Stopped', 'AbortError'));
          }, {once: true});
        },
        cancel() { closed = true; },
      });
      function emit(event) {
        if (closed) return;
        streamController.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      }
      window.__chatFinish = () => {
        emit({type: 'text', text: '\n\n可继续阅读原文 [1]。'});
        emit({type: 'done'});
        if (!closed) { streamController.close(); closed = true; }
      };
      if (window.__chatScenario === 'empty') {
        emit({type: 'sources', sources: []});
        emit({type: 'text', text: '暂未在公开文章中找到足够的信息。'});
        emit({type: 'done'});
        streamController.close();
        closed = true;
      } else {
        emit({type: 'sources', sources: [
          {id: '1', title: 'Astro 博客的内容组织', url: 'https://yindongliang.com/posts/example/', sourceKind: 'author'},
        ]});
        emit({type: 'text', text: '博客使用 **Astro** 组织文章。[1]'});
      }
      return new Response(stream, {headers: {'Content-Type': 'application/x-ndjson; charset=utf-8'}});
    };
  });
}

let browser;
try {
  await server.listen();
  const base = new URL(server.resolvedUrls.local[0]);
  browser = await chromium.launch({headless: true});
  const context = await browser.newContext({viewport: {width: 1000, height: 900}, serviceWorkers: 'block'});
  await mockChat(context);
  await context.route('**/*', (route) => new URL(route.request().url()).origin === base.origin ? route.continue() : route.abort());
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  await page.goto(new URL('/tests/fixtures/chat-ui.html', base).href);
  const root = page.locator('[data-chat-hydrated="true"]');
  await root.waitFor();
  const launcherButton = page.locator('[data-chat-launcher]');
  await launcherButton.locator('img').waitFor();
  assert.equal(await launcherButton.getAttribute('data-signed-in'), '');
  const question = root.getByRole('textbox', {name: '向博客助手提问'});
  await question.fill('博客怎样使用 Astro？');
  await question.press('Enter');
  await root.locator('[data-message-state="pending"] strong').filter({hasText: 'Astro'}).waitFor();
  const request = await page.evaluate(() => window.__chatRequests[0]);
  assert.match(String(request.headers.Authorization || request.headers.authorization), /^Bearer /);
  await page.evaluate(() => window.__chatFinish());
  await root.locator('[data-message-state="complete"]').waitFor();
  await root.getByRole('link', {name: '[1] Astro 博客的内容组织', exact: true}).waitFor();

  await question.fill('还有哪些相关资料？');
  await question.press('Enter');
  await root.getByRole('button', {name: '停止生成', exact: true}).click();
  await root.locator('[data-message-state="stopped"]').waitFor();
  assert.equal(await page.evaluate(() => window.__chatAborts), 1);

  await page.evaluate(() => { window.__chatScenario = '429'; });
  await question.fill('重新查找相关文章');
  await question.press('Enter');
  await root.getByRole('alert').filter({hasText: '当前提问较多'}).waitFor();
  await question.fill('等待限流解除');
  await page.waitForFunction(() => !document.querySelector('button[aria-label="发送问题"]')?.disabled);
  await page.evaluate(() => { window.__chatScenario = 'empty'; });
  await question.fill('测试无匹配资料');
  await question.press('Enter');
  await root.getByText('暂未在公开文章中找到足够的信息。', {exact: true}).waitFor();

  await page.evaluate(() => window.__readerAuth.switchSession(null, null));
  await root.getByText('登录后可以向博客助手提问。回答仍然只依据已公开的文章。').waitFor();
  await root.locator('[data-clerk-signin]').waitFor();
  assert.equal(await question.count(), 0, 'Signed-out chat hides the composer');
  await page.waitForFunction(() => !document.querySelector('[data-chat-launcher][data-signed-in]'));
  assert.equal(await page.locator('[data-chat-launcher] img').count(), 0, 'Signed-out launcher restores the conversation icon');
  console.log('Chat UI fixture checks passed: Clerk bearer token, streaming, stop, 429, empty results, signed-out gate and launcher avatar.');
} finally {
  await browser?.close();
  await server.close();
  await rm(cacheDir, {recursive: true, force: true});
}
