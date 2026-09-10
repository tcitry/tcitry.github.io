import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import {chromium} from 'playwright';

// Run real UI components against an in-memory hook fixture. No build, deploy,
// Clerk account, Convex deployment, telemetry, or production data is involved.
const root = fileURLToPath(new URL('../..', import.meta.url));
const cacheDir = await mkdtemp(join(tmpdir(), 'reader-ui-vite-'));
const server = await createServer({
  root, configFile: false, envDir: false, publicDir: false, cacheDir,
  plugins: [react(), tailwind()],
  optimizeDeps: {entries: ['tests/fixtures/reader-ui.html']},
  resolve: {alias: [
    {find: /^convex\/react$/, replacement: fileURLToPath(new URL('../fixtures/reader-convex.ts', import.meta.url))},
    {find: /^convex\/react-clerk$/, replacement: fileURLToPath(new URL('../fixtures/reader-convex-clerk.tsx', import.meta.url))},
    {find: /^@clerk\/react$/, replacement: fileURLToPath(new URL('../fixtures/reader-clerk.tsx', import.meta.url))},
  ]},
  define: {
    'import.meta.env.PUBLIC_CLERK_PUBLISHABLE_KEY': JSON.stringify('fixture-public-key'),
    'import.meta.env.PUBLIC_CONVEX_URL': JSON.stringify('https://fixture.convex.cloud'),
  },
  server: {host: '127.0.0.1', port: 0},
  logLevel: 'warn',
});
let browser;

async function state(page) {return page.evaluate(() => window.__readerFixture.getState());}
const bookmarkButton = (article, pressed) => article.getByRole('button', {name: '收藏当前文章', exact: true, ...(pressed === undefined ? {} : {pressed})});

try {
  await server.listen();
  const base = new URL(server.resolvedUrls.local[0]);
  browser = await chromium.launch({headless: true});
  const accountContext = await browser.newContext({viewport: {width: 1000, height: 900}, serviceWorkers: 'block'});
  await accountContext.route('**/*', (route) => new URL(route.request().url()).origin === base.origin ? route.continue() : route.abort());
  try {
    const page = await accountContext.newPage();
    await page.goto(new URL('/tests/fixtures/reader-ui.html?view=root', base).href);
    const article = page.locator('[data-reader-article]');
    const library = page.locator('[data-reader-library]');
    await bookmarkButton(article, true).waitFor();
    await library.getByRole('link', {name: '账号 A 的已收藏文章', exact: true}).waitFor();
    await page.evaluate(() => window.__readerAuth.switchSession('fixture-b', 'session-b'));
    await bookmarkButton(article, false).waitFor();
    await library.getByRole('link', {name: '账号 B 的收藏文章 1', exact: true}).waitFor();
    let clients = (await state(page)).clients;
    assert.equal(clients.length, 2);
    assert.equal(clients[0].closed, true, 'Changing accounts closes the old Convex client');
    assert.equal(clients[1].closed, false);
    assert.equal(await library.getByRole('link', {name: /账号 A/}).count(), 0, 'A different account never receives the prior account bookmark list');
    await bookmarkButton(article, false).click();
    await bookmarkButton(article, true).waitFor();
    await library.getByRole('link', {name: '公开测试文章', exact: true}).waitFor();
    await bookmarkButton(article, true).click();
    await bookmarkButton(article, false).waitFor();
    assert.equal(await library.getByRole('link', {name: '公开测试文章', exact: true}).count(), 0, 'Removing a bookmark updates its private list');
    await page.evaluate(() => window.__readerAuth.switchSession('fixture-b', 'session-b-new'));
    await page.waitForFunction(() => window.__readerFixture.getState().clients.length === 3);
    clients = (await state(page)).clients;
    assert.equal(clients[1].closed, true, 'A new session for the same account discards the previous client cache');
    await library.getByRole('link', {name: '账号 B 的收藏文章 1', exact: true}).waitFor();
    const beforeSignout = await state(page);
    await page.evaluate(() => window.__readerAuth.switchSession(null, null));
    await page.locator('[data-reader-root] [data-clerk-signin]').waitFor();
    await page.waitForFunction(() => window.__readerFixture.getState().clients.length === 4);
    assert.equal((await state(page)).clients[2].closed, true);
    assert.equal(await article.count(), 0, 'Sign-out unmounts private article controls');
    assert.equal(await library.count(), 0, 'Sign-out unmounts the bookmark list');
    await page.mouse.move(500, 450);
    await page.mouse.wheel(0, 650);
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')));
    const anonymous = await state(page);
    assert.equal(anonymous.queries.length, beforeSignout.queries.length, 'Anonymous state never queries private article state');
    assert.equal(anonymous.listRequests.length, beforeSignout.listRequests.length, 'Anonymous state never lists bookmarks');
    assert.equal(anonymous.writes.length, beforeSignout.writes.length, 'Anonymous scrolling never writes data');
    await page.getByRole('button', {name: '登录 / 注册'}).click();
    await library.getByRole('link', {name: '账号 A 的已收藏文章', exact: true}).waitFor();
    assert.equal(await library.getByRole('link', {name: /账号 B/}).count(), 0, 'Signing back in restores only that account bookmarks');
    console.log('Bookmarks sessions: live list changes, fresh clients on account/session changes, and anonymous state without private reads or writes.');
  } finally {await accountContext.close();}

  for (const width of [1440, 390, 320]) {
    const context = await browser.newContext({viewport: {width, height: 900}, reducedMotion: 'reduce', serviceWorkers: 'block'});
    const errors = [];
    await context.route('**/*', (route) => new URL(route.request().url()).origin === base.origin ? route.continue() : route.abort());
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    page.on('pageerror', (error) => errors.push(error.message));
    try {
      const title = 'Polar 接入指南：基础概念、Sandbox 调试与商家主体验证——用于检查窄屏下完整文章标题与收藏按钮的布局';
      const articleURL = new URL('/tests/fixtures/reader-ui.html', base);
      articleURL.searchParams.set('title', title);
      await page.goto(articleURL.href);
      const article = page.locator('[data-reader-article]');
      const bookmark = bookmarkButton(article);
      await bookmarkButton(article, false).waitFor();
      await article.getByText('当前文章', {exact: true}).waitFor();
      const currentTitle = article.getByText(title, {exact: true});
      await currentTitle.waitFor();
      const titleBox = await currentTitle.boundingBox();
      const buttonBox = await bookmark.boundingBox();
      assert.ok(titleBox && buttonBox);
      assert.ok(titleBox.x + titleBox.width <= buttonBox.x + 1, `The bookmark button sits to the right of the article title at ${width}px`);
      assert.ok(buttonBox.y < titleBox.y + titleBox.height && buttonBox.y + buttonBox.height > titleBox.y, `Title and bookmark remain in one row at ${width}px`);
      assert.ok(buttonBox.width >= 44 && buttonBox.height >= 44, `The icon retains its 44px hit target at ${width}px`);
      assert.ok(buttonBox.x >= 0 && buttonBox.x + buttonBox.width <= width, `A long title never pushes the bookmark outside ${width}px`);
      const titleHeight = await currentTitle.evaluate((element) => ({height: element.getBoundingClientRect().height, lineHeight: Number.parseFloat(getComputedStyle(element).lineHeight)}));
      assert.ok(titleHeight.height <= titleHeight.lineHeight * 2 + 1, 'The visible article title occupies at most two lines');
      if (width === 320) {
        await page.mouse.move(5, 500);
        await bookmark.hover();
        const tooltip = page.getByRole('tooltip', {name: '收藏文章', exact: true});
        await tooltip.waitFor();
        const tooltipBox = await tooltip.boundingBox();
        assert.ok(tooltipBox && tooltipBox.x >= 0 && tooltipBox.x + tooltipBox.width <= width, 'The bookmark tooltip remains visible within the narrow viewport');
        await page.mouse.move(5, 500);
        await tooltip.waitFor({state: 'hidden'});
      }
      assert.equal((await state(page)).writes.length, 0, 'Mount does not create any records');
      await page.evaluate(() => window.__readerFixture.rejectNext());
      await bookmark.click();
      await article.getByRole('alert').filter({hasText: '收藏未能保存'}).waitFor();
      assert.equal((await state(page)).page.bookmarked, false, 'A rejected write preserves the existing bookmark state');
      await bookmark.click();
      await bookmarkButton(article, true).waitFor();
      assert.equal((await state(page)).page.bookmarked, true);
      await bookmarkButton(article, true).click();
      await bookmarkButton(article, false).waitFor();
      assert.equal((await state(page)).page.bookmarked, false);
      assert.equal(await article.getByRole('textbox').count(), 0, 'There is no note editor');
      assert.equal(await article.getByRole('button', {name: /私有笔记|继续阅读/}).count(), 0, 'Only bookmark controls remain');
      const explicitWrites = (await state(page)).writes;
      assert.ok(explicitWrites.every((write) => write.name === 'reader:setBookmark'));
      assert.equal(explicitWrites.length, 3, 'Only the three explicit bookmark attempts wrote data');
      await page.clock.install();
      await page.mouse.move(width / 2, 450);
      await page.mouse.wheel(0, 650);
      await page.waitForFunction(() => window.scrollY > 0);
      await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')));
      await page.clock.fastForward(10_100);
      await page.clock.runFor(100);
      assert.equal((await state(page)).writes.length, explicitWrites.length, 'Scrolling, pagehide and elapsed timers never save reading progress');
      assert.equal(await page.evaluate(() => localStorage.length), 0, 'Private account data never enters localStorage');
      await page.evaluate(() => window.scrollTo(0, 0));
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true,
        `Article controls fit ${width}px`);
      await page.screenshot({path: join('/tmp', `reader-ui-article-${width}.png`)});
      await page.clock.resume();

      await page.goto(new URL('/tests/fixtures/reader-ui.html?view=library', base).href);
      const library = page.locator('[data-reader-library]');
      await library.getByRole('link', {name: '测试的收藏文章 1', exact: true}).waitFor();
      assert.equal(await library.getByRole('listitem').count(), 20);
      await library.getByRole('button', {name: '加载更多'}).click();
      await page.waitForFunction(() => document.querySelectorAll('[data-reader-library] li').length === 23);
      assert.equal(await library.getByRole('button', {name: '加载更多'}).count(), 0);
      assert.equal(await library.getByRole('tab').count(), 0, 'Bookmarks have no extra reading or note tabs');
      assert.equal((await state(page)).writes.length, 0, 'Opening and paginating bookmarks never writes data');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true,
        `Bookmark list fits ${width}px`);
      if (width === 390) await page.screenshot({path: join('/tmp', 'reader-ui-library-390.png')});
      assert.deepEqual(errors, [], 'No browser runtime errors');
      console.log(`Bookmarks UI ${width}px: add/remove, failure recovery, pagination, no automatic writes and no overflow passed.`);
    } finally {
      await context.close();
    }
  }
} finally {
  await browser?.close();
  await server.close();
  await rm(cacheDir, {recursive: true, force: true});
}
