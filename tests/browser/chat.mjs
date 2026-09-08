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
    // Observe renderer initialization without loading React or altering the app.
    window.__chatReactRenderers = 0;
    window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
      supportsFiber: true,
      renderers: new Map(),
      inject(renderer) {
        const id = ++window.__chatReactRenderers;
        this.renderers.set(id, renderer);
        return id;
      },
      onCommitFiberRoot() {},
      onCommitFiberUnmount() {},
      onPostCommitFiberRoot() {},
    };
    const originalFetch = window.fetch.bind(window);
    window.__chatRequests = [];
    window.__chatAborts = 0;
    window.__chatScenario = 'stream';
    window.fetch = async (input, init) => {
      if (new URL(typeof input === 'string' ? input : input.url, location.href).pathname.replace(/\/$/, '') !== '/api/chat') return originalFetch(input, init);
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

function launcher(page) {
  return page.locator('button[aria-label="打开博客助手"]');
}

function panel(page) {
  return page.locator('dialog#blog-chat-panel');
}

async function openChat(page) {
  await launcher(page).click();
  await panel(page).waitFor({state: 'visible'});
  await panel(page).locator('[data-chat-hydrated="true"]').waitFor();
  assert.equal(await panel(page).getAttribute('data-chat-loaded'), 'true', 'The first open finishes loading the chat module');
  assert.equal(await launcher(page).getAttribute('aria-expanded'), 'true', 'Launcher reports the open panel');
  assert.equal(await panel(page).getAttribute('aria-label'), '博客助手');
  return panel(page).locator('[data-chat-hydrated="true"]');
}

async function assertClosed(page, label, returnsFocus = true) {
  await panel(page).waitFor({state: 'hidden'});
  assert.equal(await launcher(page).getAttribute('aria-expanded'), 'false', `${label}: launcher reports closed panel`);
  if (returnsFocus) assert.ok(await launcher(page).evaluate((element) => element === document.activeElement), `${label}: focus returns to launcher`);
}

async function assertSidebarLayout(page, originalWidth) {
  const bounds = await panel(page).boundingBox();
  const viewport = page.viewportSize();
  const main = await page.locator('body > main').boundingBox();
  const article = await page.locator('body > main > .book-page').boundingBox();
  // The theme reserves a stable scrollbar gutter even on short pages. Its root
  // layout rectangle is the usable CSS viewport for a fixed non-modal dialog.
  const usableWidth = await page.evaluate(() => document.documentElement.getBoundingClientRect().width);
  assert.equal(await panel(page).evaluate((element) => element.matches(':modal')), false, 'Desktop sidebar is non-modal');
  assert.ok(bounds && Math.abs(bounds.y) <= 1 && Math.abs(bounds.height - viewport.height) <= 2
    && Math.abs(bounds.x + bounds.width - usableWidth) <= 2, 'Sidebar is docked to the right edge and fills viewport height');
  assert.ok(main && article && main.x + main.width <= bounds.x + 1 && article.x + article.width <= bounds.x + 1,
    'The reading layout reserves space beside the sidebar');
  if (originalWidth) assert.ok(Math.abs(originalWidth - main.width - bounds.width) <= 2, 'Opening shrinks the reading area by the sidebar width');
  for (const toc of await page.locator('.book-toc-content:visible').all()) {
    const tocBounds = await toc.boundingBox();
    assert.ok(tocBounds.x + tocBounds.width <= bounds.x + 1, 'A visible article TOC never sits behind the sidebar');
  }
  await assertFits(page, `${viewport.width}px sidebar`);
}

async function assertMobilePanel(page) {
  assert.ok(await panel(page).evaluate((element) => element.matches(':modal')), 'Mobile panel uses a modal dialog');
  const bounds = await panel(page).boundingBox();
  const viewport = page.viewportSize();
  assert.ok(bounds && Math.abs(bounds.x) <= 1 && Math.abs(bounds.y) <= 1
    && Math.abs(bounds.width - viewport.width) <= 2 && Math.abs(bounds.height - viewport.height) <= 2,
  'Mobile panel occupies the viewport');
  const close = panel(page).getByRole('button', {name: '关闭博客助手', exact: true});
  await close.focus();
  await launcher(page).evaluate((element) => element.focus());
  assert.ok(await panel(page).evaluate((element) => element.contains(document.activeElement)), 'Modal background controls cannot receive focus');
  for (const key of ['Shift+Tab', 'Tab', ...Array(12).fill('Tab')]) {
    await page.keyboard.press(key);
    // Native dialogs permit Tab to reach browser chrome; page controls outside
    // the modal must remain inert when focus is within the document.
    // Chromium can briefly expose BODY while its focus/blur events are still
    // settling after Tab reaches browser chrome. Keep the same focus invariant,
    // but wait for that native transition instead of sampling it midway through.
    await page.waitForFunction(() => {
      const dialog = document.getElementById('blog-chat-panel');
      return dialog?.contains(document.activeElement)
        || (!document.hasFocus() && document.activeElement === document.body);
    }, undefined, {timeout: 1000, polling: 25}).catch(async (error) => {
      console.error('Mobile focus state:', await page.evaluate(() => ({
        tag: document.activeElement?.tagName,
        role: document.activeElement?.getAttribute('role'),
        label: document.activeElement?.getAttribute('aria-label'),
        focused: document.hasFocus(),
        modal: document.querySelector('#blog-chat-panel')?.matches(':modal'),
      })));
      throw error;
    });
  }
  await close.focus();
  await assertFits(page, '375px modal');
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
  assert.equal(await page.getByRole('heading', {level: 1, name: '博客助手'}).count(), 1);
  assert.equal(await page.locator('.giscus').count(), 0, 'Chat page has no article comments');
  assert.equal(await launcher(page).count(), 1, 'The page has one native chat launcher');
  assert.equal(await launcher(page).getAttribute('aria-expanded'), 'false');
  assert.notEqual(await panel(page).getAttribute('data-chat-loaded'), 'true', 'Chat module has not loaded before the first open');
  const existingIslands = await page.locator('astro-island').count();
  assert.equal(await page.locator('astro-island[component-url*="chat"]').count(), 0, 'Chat has no eager island alongside the site navigation');
  assert.equal(await page.locator('[data-chat-hydrated]').count(), 0, 'Chat is not mounted before the first open');
  assert.equal(await page.evaluate(() => performance.getEntriesByType('resource').some(({name}) => /\/(?:_astro\/mount-chat\.[^/]+\.js|src\/components\/chat\/mount-chat\.tsx)$/.test(new URL(name).pathname))), false, 'Chat code stays unloaded even when navigation already uses React');
  assert.equal(await page.locator('aside a[href], nav a[href]').evaluateAll((links) => links.filter((link) => new URL(link.getAttribute('href'), location.href).pathname === '/chat/').length), 0, 'Chat has no sidebar navigation link');
  const originalReadingWidth = (await page.locator('body > main').boundingBox()).width;
  const root = await openChat(page);
  assert.ok(await page.evaluate(() => window.__chatReactRenderers > 0), 'Opening has a React renderer available for chat');
  assert.equal(await page.locator('astro-island').count(), existingIslands, 'Chat mounts directly without adding an Astro island');
  const desktopBounds = await panel(page).boundingBox();
  assert.ok(desktopBounds && Math.abs(desktopBounds.width - 440) <= 2, 'Wide desktop sidebar is 440px wide');
  await assertSidebarLayout(page, originalReadingWidth);
  const question = root.getByRole('textbox', {name: '向博客助手提问'});
  const send = root.getByRole('button', {name: '发送问题', exact: true});
  assert.ok(await send.isDisabled(), 'Empty input cannot submit');
  assert.equal(await question.getAttribute('maxlength'), '2000');
  await question.fill('关闭后继续编辑的草稿');
  await panel(page).getByRole('button', {name: '关闭博客助手', exact: true}).click();
  await assertClosed(page, 'Close button');
  assert.ok(Math.abs((await page.locator('body > main').boundingBox()).width - originalReadingWidth) <= 1, 'Closing restores the original reading width');
  await openChat(page);
  assert.equal(await question.inputValue(), '关闭后继续编辑的草稿', 'Closing and reopening preserves the draft');
  await page.keyboard.press('Escape');
  await assertClosed(page, 'Escape');
  await openChat(page);
  await page.getByRole('heading', {level: 1, name: '博客助手'}).click();
  assert.ok(await panel(page).isVisible(), 'Clicking the article keeps the desktop sidebar open');
  await page.locator('#main-content').focus();
  assert.ok(await page.locator('#main-content').evaluate((element) => element === document.activeElement), 'The reader can focus the article while chat stays open');
  assert.equal(await launcher(page).getAttribute('aria-expanded'), 'true');
  await root.getByRole('button', {name: '契约测试适合解决哪些问题？', exact: true}).click();
  assert.equal(await question.inputValue(), '契约测试适合解决哪些问题？');
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
  await question.fill('保留这个追问草稿');
  const renderers = await page.evaluate(() => window.__chatReactRenderers);
  await panel(page).getByRole('button', {name: '关闭博客助手', exact: true}).click();
  await assertClosed(page, 'Close completed conversation');
  await openChat(page);
  assert.equal(await question.inputValue(), '保留这个追问草稿');
  assert.equal(await root.locator('[data-message-state="complete"]').count(), 1, 'Reopening preserves completed answers');
  assert.equal(await page.evaluate(() => window.__chatReactRenderers), renderers, 'Reopening reuses the loaded React renderer');
  if (screenshots) {
    await page.screenshot({path: join(screenshots, 'chat-answer-desktop.png'), fullPage: true});
    await panel(page).getByRole('button', {name: '关闭博客助手', exact: true}).click();
    await page.setViewportSize({width: 375, height: 850});
    await openChat(page);
    await assertMobilePanel(page);
    await page.screenshot({path: join(screenshots, 'chat-answer-mobile.png'), fullPage: true});
    await page.keyboard.press('Escape');
    await assertClosed(page, 'Mobile Escape');
    await page.setViewportSize({width: 1440, height: 1000});
    await openChat(page);
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

  await panel(page).getByRole('button', {name: '关闭博客助手', exact: true}).click();
  await page.setViewportSize({width: 375, height: 850});
  await openChat(page);
  await assertMobilePanel(page);
  await page.emulateMedia({colorScheme: 'dark'});
  await assertFits(page, '375px dark');
  if (screenshots) await page.screenshot({path: join(screenshots, 'chat-mobile-dark.png'), fullPage: true});
  await root.getByRole('button', {name: '新对话', exact: true}).click();
  assert.equal(await root.locator('[data-message-state]').count(), 0, 'New conversation clears in-memory answers');
  assert.ok(await question.evaluate((element) => document.activeElement === element), 'New conversation returns focus to input');
  assert.equal(await question.inputValue(), '');
  await page.keyboard.press('Escape');
  await assertClosed(page, 'Mobile Escape after reset');
  await page.reload();
  assert.equal(await launcher(page).getAttribute('aria-expanded'), 'false', 'Reload starts with a closed launcher');
  assert.equal(await page.locator('[data-chat-hydrated]').count(), 0, 'Reload restores lazy initialization');
  await openChat(page);
  assert.equal(await root.locator('[data-message-state]').count(), 0, 'Reload does not persist conversation history');
  await page.keyboard.press('Escape');
  await page.goto(new URL('/archives/', base).href);
  assert.equal(await launcher(page).count(), 1, 'Launcher is also available on an existing site page');
  assert.equal(await launcher(page).getAttribute('aria-expanded'), 'false');
  await page.setViewportSize({width: 320, height: 740});
  await openChat(page);
  await assertMobilePanel(page);
  await page.keyboard.press('Escape');
  await assertClosed(page, '320px mobile Escape');
  await page.setViewportSize({width: 1440, height: 1000});
  const archivesWidth = (await page.locator('body > main').boundingBox()).width;
  await openChat(page);
  await assertSidebarLayout(page, archivesWidth);
  if (screenshots) await page.screenshot({path: join(screenshots, 'chat-sidebar-archives.png')});
  for (const width of [1280, 1024, 768, 640]) {
    await page.setViewportSize({width, height: 900});
    await assertSidebarLayout(page);
  }
  await page.setViewportSize({width: 1440, height: 1000});
  await page.keyboard.press('Escape');
  await assertClosed(page, 'Sidebar Escape restores archives');
  assert.ok(Math.abs((await page.locator('body > main').boundingBox()).width - archivesWidth) <= 1, 'Reading width is restored after responsive sidebar use');
  await page.emulateMedia({colorScheme: 'light'});
  await page.goto(new URL('/posts/this-blog/', base).href);
  await openChat(page);
  for (const width of [1920, 1680, 1440, 1280, 1024, 768, 640]) {
    await page.setViewportSize({width, height: 1000});
    await assertSidebarLayout(page);
    if (width === 1440 && screenshots) await page.screenshot({path: join(screenshots, 'chat-sidebar-article.png')});
    if (width === 768) {
      await page.locator('.book-header label[for="menu-control"]').click();
      assert.ok(await page.locator('#menu-control').isChecked(), 'The reading menu can open beside the assistant');
      const menu = await page.locator('.book-menu-content').boundingBox();
      const sidebar = await panel(page).boundingBox();
      assert.ok(menu && menu.x >= 0 && menu.x + menu.width <= sidebar.x + 1, 'The reading menu remains outside the assistant');
      await page.locator('.book-menu-overlay').click({position: {x: sidebar.x - 8, y: 80}});
      assert.equal(await page.locator('#menu-control').isChecked(), false, 'The reading menu can close without closing chat');
      await page.locator('.book-header label[for="toc-control"]').click();
      assert.ok(await page.locator('.book-header > aside').isVisible(), 'The article TOC remains available in the compact reading area');
      assert.ok(await panel(page).isVisible(), 'Article controls keep the sidebar open');
      await page.locator('.book-header label[for="toc-control"]').click();
    }
  }
  await page.setViewportSize({width: 375, height: 850});
  await assertMobilePanel(page);
  if (screenshots) await page.screenshot({path: join(screenshots, 'chat-sidebar-mobile-welcome.png')});
  await page.keyboard.press('Escape');
  await assertClosed(page, 'Mobile article close');
  assert.deepEqual(errors, [], 'No uncaught browser errors');
  console.log('Chat browser checks passed: lazy launcher, full-height docked sidebar, reserved reading space, mobile modal, focus and draft retention, streaming, sources, context, stop, 429 and Markdown safety.');
  await context.close();
} finally {
  await browser.close();
}
