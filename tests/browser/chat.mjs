import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {chromium} from 'playwright';

const base = process.env.BLOG_TEST_URL ?? 'http://127.0.0.1:4321';
const screenshots = process.env.BLOG_SCREENSHOT_DIR;
const browser = await chromium.launch({headless: true});
const errors = [];

// Inject a streaming transport at the browser boundary. Requests never leave the
// page; the actual React input, incremental decoder, Markdown and sources run.
async function mockChat(context) {
  await context.addInitScript(() => {
    const originalFetch = window.fetch.bind(window);
    window.__chatRequests = [];
    window.__chatAborts = 0;
    window.__chatScenario = 'stream';
    window.fetch = async (input, init) => {
      if (new URL(typeof input === 'string' ? input : input.url, location.href).pathname !== '/api/chat') return originalFetch(input, init);
      window.__chatRequests.push(JSON.parse(init.body));
      if (window.__chatScenario === '429') return new Response(JSON.stringify({message: '当前提问较多，请稍后再试。'}), {status: 429, headers: {'Content-Type': 'application/json', 'Retry-After': '2'}});
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
        const bytes = encoder.encode(`${JSON.stringify(event)}\n`);
        // Byte-sized frames also split UTF-8 sequences and NDJSON boundaries.
        for (let index = 0; index < bytes.length; index += 7) streamController.enqueue(bytes.slice(index, index + 7));
      }
      window.__chatFinish = () => {
        emit({type: 'text', text: '\n\n可继续阅读原文 [1]。\n\n[不可信链接](https://example.com/unsafe) ![远程图片](https://example.com/tracker.png)\n\n<script>window.__chatInjected = true</script>'});
        emit({type: 'done'});
        if (!closed) { streamController.close(); closed = true; }
      };
      if (window.__chatScenario === 'stream-error') {
        emit({type: 'error', message: '模型暂时繁忙，请稍后重试。', retryAfter: 2});
        streamController.close();
        closed = true;
      } else if (window.__chatScenario === 'empty') {
        emit({type: 'sources', sources: []});
        emit({type: 'text', text: '暂未在公开文章中找到足够的信息。'});
        emit({type: 'done'});
        streamController.close();
        closed = true;
      } else {
        emit({type: 'sources', sources: [
          {id: '1', title: 'Astro 博客的内容组织', url: 'https://yindongliang.com/posts/example/', sourceKind: 'author'},
          {id: '2', title: '相关 AI 对话整理', url: 'https://yindongliang.com/docs/ByAI/example/', sourceKind: 'ai-assisted'},
        ]});
        emit({type: 'text', text: '博客使用 **Astro** 组织文章，并在构建时生成页面。[1]'});
      }
      return new Response(stream, {headers: {'Content-Type': 'application/x-ndjson; charset=utf-8'}});
    };
  });
}

async function assertFits(page, label) {
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${label}: page has no horizontal overflow`);
  const input = await page.getByRole('textbox', {name: '向博客助手提问'}).boundingBox();
  assert.ok(input && input.width >= 180, `${label}: composer remains usable`);
  const counter = await page.locator('.blog-chat__input-help').boundingBox();
  assert.ok(counter && counter.y >= input.y + input.height - 1, `${label}: toolbar does not overlap the input`);
}

try {
  if (screenshots) await mkdir(screenshots, {recursive: true});
  const context = await browser.newContext({viewport: {width: 1440, height: 1000}, reducedMotion: 'reduce', permissions: ['clipboard-read', 'clipboard-write']});
  await context.route(/https:\/\/(?:giscus\.app|www\.googletagmanager\.com|pagead2\.googlesyndication\.com)\//, (route) => route.abort());
  await mockChat(context);
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(new URL('/chat/', base).href);
  const root = page.locator('[data-chat-hydrated="true"]');
  await root.waitFor();
  assert.equal(await page.getByRole('heading', {level: 1, name: '博客助手'}).count(), 1);
  assert.equal(await page.locator('.giscus').count(), 0, 'Chat page has no article comments');
  await assertFits(page, 'desktop');
  const question = root.getByRole('textbox', {name: '向博客助手提问'});
  const send = root.getByRole('button', {name: '发送问题', exact: true});
  assert.ok(await send.isDisabled(), 'Empty input cannot submit');
  assert.equal(await question.getAttribute('maxlength'), '2000');
  await root.getByRole('button', {name: '博客中有哪些关于 Astro 的文章？', exact: true}).click();
  assert.equal(await question.inputValue(), '博客中有哪些关于 Astro 的文章？');
  assert.ok(await question.evaluate((element) => document.activeElement === element), 'Choosing a suggestion focuses the composer');
  await question.press('Shift+Enter');
  assert.match(await question.inputValue(), /\n/);
  assert.equal(await page.evaluate(() => window.__chatRequests.length), 0, 'Shift+Enter adds a line without sending');
  await question.fill('博客怎样使用 Astro？');
  await question.press('Enter');
  await root.locator('[data-message-state="pending"] strong').filter({hasText: 'Astro'}).waitFor();
  assert.equal(await root.getAttribute('data-chat-status'), 'streaming', 'Partial answer appears while the response is open');
  assert.ok(await root.getByRole('button', {name: '停止生成', exact: true}).isVisible());
  const source = root.getByRole('link', {name: '[1] Astro 博客的内容组织', exact: true});
  await source.waitFor();
  assert.equal(await source.getAttribute('href'), 'https://yindongliang.com/posts/example/');
  assert.equal(await source.getAttribute('target'), '_blank');
  assert.ok((await source.boundingBox()).height >= 44, 'Source card has a readable touch target');
  assert.equal(await root.locator('.blog-chat__sources .disclosure__heading').evaluate((element) => getComputedStyle(element, '::before').content), 'none', 'Book heading prefix does not leak into source disclosure');
  assert.ok(await root.getByText('AI 整理', {exact: true}).isVisible());
  assert.ok(await root.getByRole('button', {name: '新对话', exact: true}).isDisabled());
  await page.evaluate(() => window.__chatFinish());
  await root.locator('[data-message-state="complete"]').waitFor();
  await root.getByText('可继续阅读原文 [1]。', {exact: true}).waitFor();
  assert.equal(await root.locator('a[href*="example.com"]').count(), 0, 'Unretrieved model links cannot become clickable citations');
  assert.equal(await root.locator('img[src*="example.com"]').count(), 0, 'Model-generated image URLs are not fetched');
  assert.equal(await page.evaluate(() => window.__chatInjected), undefined, 'Markdown does not execute raw HTML');
  if (screenshots) {
    await page.screenshot({path: join(screenshots, 'chat-answer-desktop.png'), fullPage: true});
    await page.setViewportSize({width: 375, height: 850});
    await assertFits(page, '375px answer');
    await page.screenshot({path: join(screenshots, 'chat-answer-mobile.png'), fullPage: true});
    await page.setViewportSize({width: 1440, height: 1000});
  }
  await root.getByLabel('复制回答和出处', {exact: true}).click();
  await page.waitForFunction(async () => (await navigator.clipboard.readText()).includes('[1] Astro 博客的内容组织 https://yindongliang.com/posts/example/'));

  await question.fill('还有哪些相关资料？');
  await question.press('Enter');
  await root.locator('[data-message-state="pending"]').waitFor();
  assert.deepEqual((await page.evaluate(() => window.__chatRequests[1].messages)).map((message) => message.role), ['user', 'assistant', 'user'], 'A follow-up includes the completed turn');
  await root.getByRole('button', {name: '停止生成', exact: true}).click();
  await root.locator('[data-message-state="stopped"]').waitFor();
  assert.equal(await page.evaluate(() => window.__chatAborts), 1, 'Stop aborts the ongoing transport');
  assert.ok(await root.getByText('已停止生成。当前回答可能不完整。', {exact: true}).isVisible());

  await page.evaluate(() => { window.__chatScenario = '429'; });
  await question.fill('重新查找相关文章');
  await question.press('Enter');
  await root.getByRole('alert').filter({hasText: '当前提问较多'}).waitFor();
  assert.deepEqual((await page.evaluate(() => window.__chatRequests[2].messages)).map((message) => message.role), ['user', 'assistant', 'user'], 'Stopped responses are omitted from later context');
  await question.fill('等待限流解除');
  assert.ok(await send.isDisabled(), 'Retry-After temporarily disables new requests');
  await page.waitForFunction(() => !document.querySelector('button[aria-label="发送问题"]')?.disabled);

  await page.evaluate(() => { window.__chatScenario = 'stream-error'; });
  await send.click();
  await root.getByRole('alert').filter({hasText: '模型暂时繁忙'}).waitFor();
  await question.fill('测试无匹配资料');
  await page.waitForFunction(() => !document.querySelector('button[aria-label="发送问题"]')?.disabled);
  await page.evaluate(() => { window.__chatScenario = 'empty'; });
  await send.click();
  await root.getByText('暂未在公开文章中找到足够的信息。', {exact: true}).waitFor();
  assert.equal(await root.locator('[data-message-state="complete"]').last().getByRole('link').count(), 0, 'No-results answer does not fabricate sources');
  if (screenshots) await page.screenshot({path: join(screenshots, 'chat-desktop.png'), fullPage: true});

  await page.setViewportSize({width: 375, height: 850});
  await assertFits(page, '375px');
  await page.emulateMedia({colorScheme: 'dark'});
  await assertFits(page, '375px dark');
  if (screenshots) await page.screenshot({path: join(screenshots, 'chat-mobile-dark.png'), fullPage: true});
  await root.getByRole('button', {name: '新对话', exact: true}).click();
  assert.equal(await root.locator('[data-message-state]').count(), 0, 'New conversation clears in-memory answers');
  assert.ok(await question.evaluate((element) => document.activeElement === element), 'New conversation returns focus to input');
  assert.equal(await question.inputValue(), '');
  await page.reload();
  await root.waitFor();
  assert.equal(await root.locator('[data-message-state]').count(), 0, 'Reload does not persist conversation history');
  assert.deepEqual(errors, [], 'No uncaught browser errors');
  console.log('Chat browser checks passed: streaming, sources, context, stop, 429, Markdown safety, keyboard, mobile, in-memory history.');
  await context.close();
} finally {
  await browser.close();
}
