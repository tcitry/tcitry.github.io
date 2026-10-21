import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import {chromium} from 'playwright';
import {herouiProAliases, installHeroUiProCssStubs} from '../fixtures/heroui-pro-test-stubs.mjs';

// Run real UI components against an in-memory hook fixture. No build, deploy,
// Clerk account, Convex deployment, telemetry, or production data is involved.
const root = fileURLToPath(new URL('../..', import.meta.url));
await installHeroUiProCssStubs();
const cacheDir = await mkdtemp(join(tmpdir(), 'reader-ui-vite-'));
const stub = fileURLToPath(new URL('../fixtures/heroui-pro-stub.tsx', import.meta.url));
const server = await createServer({
  root, configFile: false, envDir: false, publicDir: false, cacheDir,
  plugins: [react(), tailwind()],
  optimizeDeps: {entries: ['tests/fixtures/reader-ui.html']},
  resolve: {alias: [
    {find: /^convex\/react$/, replacement: fileURLToPath(new URL('../fixtures/reader-convex.ts', import.meta.url))},
    {find: /^convex\/react-clerk$/, replacement: fileURLToPath(new URL('../fixtures/reader-convex-clerk.tsx', import.meta.url))},
    {find: /^@clerk\/react$/, replacement: fileURLToPath(new URL('../fixtures/reader-clerk.tsx', import.meta.url))},
    ...herouiProAliases(stub),
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
    assert.equal(anonymous.writes.filter(write => write.name === 'reader:setReadingProgress').length, 0, 'Anonymous scrolling never records progress');
    await page.getByRole('button', {name: '登录 / 注册'}).click();
    await library.getByRole('link', {name: '账号 A 的已收藏文章', exact: true}).waitFor();
    assert.equal(await library.getByRole('link', {name: /账号 B/}).count(), 0, 'Signing back in restores only that account bookmarks');
    console.log('Bookmarks sessions: live list changes, fresh clients on account/session changes, and anonymous state without private reads or writes.');
  } finally {await accountContext.close();}

  const convexContext = await browser.newContext({viewport: {width: 1000, height: 900}, reducedMotion: 'reduce', serviceWorkers: 'block'});
  await convexContext.route('**/*', (route) => new URL(route.request().url()).origin === base.origin ? route.continue() : route.abort());
  try {
    const page = await convexContext.newPage();
    page.setDefaultTimeout(15_000);
    await page.goto(new URL('/tests/fixtures/reader-ui.html', base).href);
    const article = page.locator('[data-reader-article]');
    await bookmarkButton(article, false).waitFor();
    await page.evaluate(() => window.__readerFixture.setConvexAuth({isAuthenticated: false, isLoading: false}));
    const retry = article.getByRole('button', {name: '重试后收藏当前文章', exact: true});
    await retry.waitFor();
    assert.equal(await retry.isDisabled(), false, 'A Convex gap must not leave a dead bookmark');
    await article.getByRole('alert').filter({hasText: '登录状态尚未同步'}).waitFor();
    await retry.click();
    await bookmarkButton(article, false).waitFor();
    assert.equal(await article.getByRole('button', {name: '重试后收藏当前文章', exact: true}).count(), 0);

    await page.goto(new URL('/tests/fixtures/reader-ui.html?view=root', base).href);
    await bookmarkButton(page.locator('[data-reader-article]'), true).waitFor();
    await page.evaluate(() => window.__readerFixture.setConvexAuth({isAuthenticated: false, isLoading: false}));
    await page.getByRole('alert').filter({hasText: '收藏暂时无法同步'}).waitFor();
    assert.equal(await page.getByRole('button', {name: '重试', exact: true}).isDisabled(), false);
    assert.equal(await page.locator('[data-article-bookmark]').count(), 0, 'ReaderRoot does not keep a fake bookmark control while Convex is down');
    console.log('Bookmarks Convex gap: retry CTA instead of a silently disabled control.');
  } finally {await convexContext.close();}

  const progressContext = await browser.newContext({viewport: {width: 1000, height: 720}, serviceWorkers: 'block'});
  await progressContext.route('**/*', (route) => new URL(route.request().url()).origin === base.origin ? route.continue() : route.abort());
  try {
    const page = await progressContext.newPage();
    page.setDefaultTimeout(15_000);
    const progressURL = new URL('/tests/fixtures/reader-ui.html', base);
    progressURL.searchParams.set('progress', '0.62');
    await page.goto(progressURL.href);
    const article = page.locator('[data-reader-article]');
    const bar = page.getByRole('progressbar', {name: '进度'});
    await bar.waitFor();
    assert.equal(await article.getByRole('button', {name: '阅读标记：未标记', exact: true}).count(), 0, 'Reading status stays on the comment row, not the progress strip');
    await page.waitForFunction(() => {
      const body = document.querySelector('article');
      return window.scrollY > 400 && !!body && body.getBoundingClientRect().top < -200;
    });
    await page.evaluate(() => new Promise(resolve => queueMicrotask(resolve)));
    const restored = Number(await bar.getAttribute('aria-valuenow'));
    assert.ok(restored >= 60 && restored <= 70, `Restored progress is visible as a percent, got ${restored}`);
    const restoredBox = await bar.boundingBox();
    assert.ok(restoredBox && restoredBox.y <= 1 && restoredBox.x <= 1 && restoredBox.width >= 998, 'Restored progress strip is flush with the top and full width');
    assert.equal((await state(page)).writes.filter(write => write.name === 'reader:setReadingProgress').length, 0, 'Restoring saved progress does not write');
    await page.screenshot({path: '/opt/cursor/artifacts/reading-progress-restored.png'});
    await page.getByRole('button', {name: '跳过本次', exact: true}).click();
    await page.waitForFunction(() => window.scrollY < 40);
    assert.equal((await state(page)).writes.filter(write => write.name === 'reader:setReadingProgress').length, 0, 'Skipping this visit does not lower progress');
    assert.equal(await page.getByRole('button', {name: '跳过本次', exact: true}).count(), 0);
    await page.evaluate(() => {
      const body = document.querySelector('article');
      if (!body) throw new Error('missing article');
      const distance = Math.max(body.offsetHeight - innerHeight, 1);
      window.scrollTo(0, body.offsetTop + Math.round(distance * 0.84));
    });
    await page.waitForFunction(() => window.__readerFixture.getState().writes.some(write => write.name === 'reader:setReadingProgress' && Number(write.args.progress) >= 0.8));
    const writes = (await state(page)).writes.filter(write => write.name === 'reader:setReadingProgress');
    assert.equal(writes.length, 1, 'A later scroll records one throttled progress write');
    assert.ok(Number(writes[0].args.progress) <= 1);
    assert.equal((await state(page)).writes.some(write => String(write.name).includes('ReadingMark')), false, 'Progress never writes reading status');
    await page.screenshot({path: '/opt/cursor/artifacts/reading-progress-advanced.png'});
    const count = (await state(page)).writes.length;
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')));
    await page.waitForTimeout(1_800);
    assert.equal((await state(page)).writes.length, count, 'Scrolling back does not lower stored progress');
    assert.ok(Number(await bar.getAttribute('aria-valuenow')) >= 80, 'The progress label stays at the furthest position');
    console.log('Reading progress: restore, skip, monotonic scroll sync, and no status writes.');
  } finally {await progressContext.close();}

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
      const bar = article.getByRole('progressbar', {name: '进度'});
      await bar.waitFor();
      assert.equal(await bar.getAttribute('aria-valuenow'), '0');
      const barBox = await bar.boundingBox();
      assert.ok(barBox && barBox.y <= 1 && barBox.x <= 1 && barBox.width >= width - 2, `Progress strip is flush and full-bleed at ${width}px`);
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
      await page.evaluate(() => {
        const body = document.querySelector('article');
        if (!body) throw new Error('missing article');
        const distance = Math.max(body.offsetHeight - innerHeight, 1);
        window.scrollTo(0, body.offsetTop + Math.round(distance * 0.35));
      });
      await page.waitForFunction(() => window.__readerFixture.getState().writes.some(write => write.name === 'reader:setReadingProgress'));
      const progressWrites = (await state(page)).writes.slice(explicitWrites.length);
      assert.ok(progressWrites.length >= 1, 'Logged-in scrolling records reading progress');
      assert.ok(progressWrites.every(write => write.name === 'reader:setReadingProgress' && Number(write.args.progress) >= 0.02 && Number(write.args.progress) <= 1));
      const afterProgress = (await state(page)).writes.length;
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')));
      await page.waitForTimeout(1_800);
      assert.equal((await state(page)).writes.length, afterProgress, 'Scrolling back, pagehide and elapsed timers do not lower progress');
      assert.equal(await page.evaluate(() => localStorage.length), 0, 'Private account data never enters localStorage');
      await page.evaluate(() => window.scrollTo(0, 0));
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true,
        `Article controls fit ${width}px`);
      await page.screenshot({path: join('/tmp', `reader-ui-article-${width}.png`)});
      if (width === 390) await page.screenshot({path: '/opt/cursor/artifacts/reading-progress-article-390.png'});

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
      console.log(`Bookmarks UI ${width}px: add/remove, failure recovery, progress sync, pagination and no overflow passed.`);
    } finally {
      await context.close();
    }
  }

  const overlaps = (a, b) => Boolean(a && b && a.x < b.x + b.width - 0.5 && a.x + a.width > b.x + 0.5 && a.y < b.y + b.height - 0.5 && a.y + a.height > b.y + 0.5);
  const topHit = (page, box) => page.evaluate(({x, y}) => {
    const target = document.elementFromPoint(x, y);
    if (target?.closest('[data-reading-progress]')) return 'progress';
    if (target?.closest('.book-brand, [data-sidebar-tools], .book-header')) return 'chrome';
    return target?.tagName ?? 'none';
  }, {x: box.x + Math.min(12, box.width / 2), y: box.y + box.height / 2});

  const readingContext = await browser.newContext({viewport: {width: 420, height: 800}, serviceWorkers: 'block'});
  await readingContext.route('**/*', (route) => new URL(route.request().url()).origin === base.origin ? route.continue() : route.abort());
  try {
    const page = await readingContext.newPage();
    page.setDefaultTimeout(15_000);
    await page.goto(new URL('/tests/fixtures/reader-ui.html?readingList=1', base).href);
    const list = page.locator('[data-reading-marks]');
    await list.getByRole('link', {name: /Cloudflare OS/}).waitFor();
    assert.equal(await list.getByRole('listitem').count(), 3, 'One row per article across marks and progress');
    assert.equal(await list.getByRole('link', {name: /Cloudflare OS/}).count(), 1, 'A marked article with progress is not listed twice');
    assert.match(await list.getByRole('link', {name: /Cloudflare OS/}).innerText(), /稍后读 · 进度 100% · 2026年10月21日/);
    assert.match(await list.getByRole('link', {name: /只有阅读标记的文章/}).innerText(), /已细读 · 2026年10月20日/);
    assert.match(await list.getByRole('link', {name: /只有进度的文章/}).innerText(), /进度 42% · 2026年10月19日/);
    const visible = await list.innerText();
    assert.equal(visible.includes('/docs/'), false, 'The reading list does not show pathnames');
    assert.equal(await list.locator('.itemPath, [data-reading-progress-list]').count(), 0);
    assert.equal(await list.getByRole('heading', {name: '进度', exact: true}).count(), 0);
    assert.equal(await page.getByText('进度', {exact: true}).count(), 0, 'There is no separate progress section');
    await page.screenshot({path: '/opt/cursor/artifacts/reading-list-merged.png'});
    await list.getByRole('button', {name: '筛选阅读标记：全部档次', exact: true}).click();
    await page.getByRole('menuitemradio', {name: '稍后读', exact: true}).click();
    await page.waitForFunction(() => document.querySelectorAll('[data-reading-marks] li').length === 1);
    const filtered = await list.innerText();
    assert.match(filtered, /稍后读 · 进度 100%/);
    assert.equal(filtered.includes('只有进度的文章'), false, 'Status filter hides progress-only articles');
    assert.equal(filtered.includes('只有阅读标记的文章'), false);
    assert.equal(filtered.includes('/docs/'), false);
    console.log('Reading list: one merged row, compact meta, status filter keeps progress.');
  } finally {await readingContext.close();}

  for (const width of [1440, 390]) {
    const context = await browser.newContext({viewport: {width, height: 800}, serviceWorkers: 'block'});
    await context.route('**/*', (route) => new URL(route.request().url()).origin === base.origin ? route.continue() : route.abort());
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    try {
      const chromeURL = new URL('/tests/fixtures/reader-ui.html', base);
      chromeURL.searchParams.set('chrome', '1');
      chromeURL.searchParams.set('progress', '0.62');
      chromeURL.searchParams.set('title', 'Cloudflare OS');
      await page.goto(chromeURL.href);
      const bar = page.getByRole('progressbar', {name: '进度'});
      const skip = page.getByRole('button', {name: '跳过本次', exact: true});
      await skip.waitFor();
      await page.waitForFunction(() => window.scrollY > 400);
      const viewport = page.viewportSize();
      const barBox = await bar.boundingBox();
      assert.ok(barBox && viewport);
      assert.ok(barBox.y <= 1, `Progress strip is flush with the top at ${width}px`);
      assert.ok(barBox.x <= 1, `Progress strip starts at the left edge at ${width}px`);
      assert.ok(barBox.width >= viewport.width - 2, `Progress strip spans the viewport at ${width}px`);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForFunction(() => window.scrollY < 2);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const skipBox = await skip.boundingBox();
      assert.ok(skipBox);
      assert.ok(skipBox.x + skipBox.width >= viewport.width - 16, '跳过本次 sits on the trailing edge');
      assert.ok(skipBox.y <= 16, '跳过本次 stays on the top bar');
      if (width > 1024) {
        const brand = page.locator('.book-brand');
        const search = page.getByRole('button', {name: '搜索博客', exact: true});
        const brandBox = await brand.boundingBox();
        const searchBox = await search.boundingBox();
        assert.ok(brandBox && searchBox);
        assert.equal(overlaps(skipBox, brandBox), false, '跳过本次 does not overlap the site logo');
        assert.equal(overlaps(barBox, brandBox), false, 'The full-bleed track stays above the site logo');
        assert.equal(overlaps(skipBox, searchBox), false, '跳过本次 does not overlap search');
        assert.equal(await topHit(page, brandBox), 'chrome');
        assert.equal(await topHit(page, searchBox), 'chrome');
      } else {
        const menu = page.getByRole('button', {name: '打开导航', exact: true});
        const menuBox = await menu.boundingBox();
        assert.ok(menuBox);
        assert.equal(overlaps(skipBox, menuBox), false, '跳过本次 does not cover the mobile menu button');
        assert.equal(await topHit(page, menuBox), 'chrome');
      }
      assert.equal((await state(page)).writes.filter(write => write.name === 'reader:setReadingProgress').length, 0, 'Showing the restore control does not write');
      await page.screenshot({path: `/opt/cursor/artifacts/article-progress-bar-${width}.png`});
      await skip.click();
      await page.waitForFunction(() => window.scrollY < 40);
      assert.equal(await skip.count(), 0, 'Skip still dismisses the restore control');
      console.log(`Reading progress bar ${width}px: full-bleed top strip, skip on the trailing edge.`);
    } finally {await context.close();}
  }
} finally {
  await browser?.close();
  await server.close();
  await rm(cacheDir, {recursive: true, force: true});
}
