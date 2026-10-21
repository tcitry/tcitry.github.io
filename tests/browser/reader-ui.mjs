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
const progressWrites = (pageState) => pageState.writes.filter(write => write.name === 'reader:setReadingProgress');
const progressReads = (pageState) => pageState.queries.filter(query => query.name === 'reader:getReadingProgress');

async function scrollArticleRatio(page, ratio) {
  await page.evaluate((ratio) => {
    const body = document.querySelector('article');
    if (!body) throw new Error('missing article');
    const distance = Math.max(body.offsetHeight - innerHeight, 1);
    window.scrollTo(0, body.offsetTop + Math.round(distance * ratio));
  }, ratio);
}

async function waitForTrack(page, minimum, maximum) {
  await page.waitForFunction(([minimum, maximum]) => {
    const now = Number(document.querySelector('[data-reading-progress] [role="progressbar"]')?.getAttribute('aria-valuenow'));
    return now >= minimum && now <= maximum;
  }, [minimum, maximum]);
}

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
    await page.waitForFunction(() => window.scrollY < 2);
    await waitForTrack(page, 0, 2);
    const initial = Number(await bar.getAttribute('aria-valuenow'));
    assert.ok(initial <= 2, `Saved progress does not restore the track, got ${initial}`);
    const trackBox = await bar.boundingBox();
    assert.ok(trackBox && trackBox.y <= 1 && trackBox.x <= 1 && trackBox.width >= 998, 'Progress strip is flush with the top and full width');
    assert.ok(trackBox.height <= 3, 'The track stays a 2px hairline');
    const overlay = await page.locator('[data-reading-progress]').evaluate(element => {
      const style = getComputedStyle(element);
      const track = element.querySelector('[role="progressbar"]');
      const section = element.closest('section');
      const row = section?.querySelector(':scope > div:not([data-reading-progress])');
      return {
        position: style.position,
        height: style.height,
        background: style.backgroundColor,
        trackBackground: track ? getComputedStyle(track).backgroundColor : '',
        flowGap: row && section ? row.getBoundingClientRect().top - section.getBoundingClientRect().top : -1,
      };
    });
    assert.equal(overlay.position, 'fixed', 'The progress strip overlays the viewport');
    assert.equal(overlay.height, '2px');
    assert.equal(overlay.background, 'rgba(0, 0, 0, 0)');
    assert.equal(overlay.trackBackground, 'rgba(0, 0, 0, 0)', 'The track does not paint a grey band');
    assert.ok(overlay.flowGap < 1, `The progress strip reserves layout height, gap ${overlay.flowGap}`);
    assert.equal((await page.locator('[data-reading-progress]').innerText()).trim(), '', 'The progress strip has no percentage or skip label');
    assert.equal(await page.getByRole('button', {name: '跳过本次', exact: true}).count(), 0);
    assert.equal(progressReads(await state(page)).length, 0, 'The track does not read saved progress');
    assert.equal(progressWrites(await state(page)).length, 0, 'Mounting the track does not write progress');
    await scrollArticleRatio(page, 0.84);
    await waitForTrack(page, 78, 92);
    const fillRatio = await bar.evaluate(element => {
      const track = element.getBoundingClientRect();
      const fill = element.querySelector('div')?.getBoundingClientRect();
      return track.width > 0 && fill ? fill.width / track.width : 0;
    });
    assert.ok(fillRatio >= 0.75 && fillRatio <= 0.95, `Fill follows the viewport ratio, got ${fillRatio}`);
    assert.equal(progressWrites(await state(page)).length, 0, 'Scrolling does not write reading progress');
    assert.equal((await state(page)).writes.some(write => String(write.name).includes('ReadingMark')), false, 'The track never writes reading status');
    await page.screenshot({path: '/opt/cursor/artifacts/reading-progress-scrolled.png'});
    const count = (await state(page)).writes.length;
    await page.evaluate(() => window.scrollTo(0, 0));
    await waitForTrack(page, 0, 2);
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')));
    await page.waitForTimeout(1_800);
    assert.equal((await state(page)).writes.length, count, 'Scrolling back and pagehide do not write progress');
    assert.ok(Number(await bar.getAttribute('aria-valuenow')) <= 2, 'The track follows the current position back to the top');
    assert.equal(progressReads(await state(page)).length, 0, 'The track still does not read saved progress');
    assert.equal((await page.locator('[data-reading-progress]').innerText()).trim(), '');
    console.log('Reading progress: viewport ratio only, no Convex read or write.');
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
      await scrollArticleRatio(page, 0.35);
      await waitForTrack(page, 28, 45);
      assert.equal(progressWrites(await state(page)).length, 0, 'Logged-in scrolling does not record reading progress on the article track');
      assert.equal(progressReads(await state(page)).length, 0, 'The article track does not query saved progress');
      const afterProgress = (await state(page)).writes.length;
      await page.evaluate(() => window.scrollTo(0, 0));
      await waitForTrack(page, 0, 2);
      await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')));
      await page.waitForTimeout(1_800);
      assert.equal((await state(page)).writes.length, afterProgress, 'Scrolling back and pagehide do not write progress');
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
      console.log(`Bookmarks UI ${width}px: add/remove, failure recovery, scroll indicator, pagination and no overflow passed.`);
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
    await list.getByRole('button', {name: '筛选阅读标记：全部状态', exact: true}).click();
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
      await bar.waitFor();
      assert.equal(await page.getByRole('button', {name: '跳过本次', exact: true}).count(), 0);
      assert.equal((await page.locator('[data-reading-progress]').innerText()).trim(), '');
      await page.waitForFunction(() => window.scrollY < 2);
      await waitForTrack(page, 0, 2);
      assert.equal(progressReads(await state(page)).length, 0, 'Saved progress is not loaded for the track');
      await scrollArticleRatio(page, 0.55);
      await waitForTrack(page, 48, 65);
      const viewport = page.viewportSize();
      const barBox = await bar.boundingBox();
      assert.ok(barBox && viewport);
      assert.ok(barBox.y <= 1, `Progress strip is flush with the top at ${width}px`);
      assert.ok(barBox.x <= 1, `Progress strip starts at the left edge at ${width}px`);
      assert.ok(barBox.width >= viewport.width - 2, `Progress strip spans the viewport at ${width}px`);
      assert.ok(barBox.height <= 3, `Progress strip stays a 2px hairline at ${width}px`);
      const scrolledFill = await bar.evaluate(element => {
        const track = element.getBoundingClientRect();
        const fill = element.querySelector('div')?.getBoundingClientRect();
        return track.width > 0 && fill ? fill.width / track.width : 0;
      });
      assert.ok(scrolledFill >= 0.45 && scrolledFill <= 0.7, `Fill follows the scroll ratio at ${width}px, got ${scrolledFill}`);
      await page.screenshot({path: `/opt/cursor/artifacts/article-progress-bar-${width}.png`});
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForFunction(() => window.scrollY < 2);
      await waitForTrack(page, 0, 2);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      if (width > 1024) {
        const brand = page.locator('.book-brand');
        const search = page.getByRole('button', {name: '搜索博客', exact: true});
        const brandBox = await brand.boundingBox();
        const searchBox = await search.boundingBox();
        assert.ok(brandBox && searchBox);
        assert.equal(overlaps(barBox, brandBox), false, 'The full-bleed track stays above the site logo');
        assert.equal(overlaps(barBox, searchBox), false, 'The progress track does not overlap search');
        assert.equal(await topHit(page, brandBox), 'chrome');
        assert.equal(await topHit(page, searchBox), 'chrome');
      } else {
        const menu = page.getByRole('button', {name: '打开导航', exact: true});
        const menuBox = await menu.boundingBox();
        assert.ok(menuBox);
        assert.equal(overlaps(barBox, menuBox), false, 'The progress track does not cover the mobile menu button');
        assert.equal(await topHit(page, menuBox), 'chrome');
      }
      assert.equal(progressWrites(await state(page)).length, 0, 'Scrolling the article track does not write progress');
      assert.equal(progressReads(await state(page)).length, 0, 'The article track does not read saved progress');
      const actions = page.locator('[data-fixture-article-actions]');
      const mark = actions.getByRole('button', {name: '阅读标记：未标记', exact: true});
      const like = actions.getByRole('button', {name: '喜欢这篇文章', exact: true});
      const bookmark = actions.getByRole('button', {name: '收藏当前文章', exact: true});
      await actions.scrollIntoViewIfNeeded();
      await mark.waitFor();
      const markBox = await mark.boundingBox();
      const likeBox = await like.boundingBox();
      const bookmarkBox = await bookmark.boundingBox();
      const trackBox = await bar.boundingBox();
      assert.ok(markBox && likeBox && bookmarkBox && trackBox);
      assert.ok(trackBox.y <= 1 && trackBox.width >= viewport.width - 2, 'The track stays full-bleed while comment actions are in view');
      assert.ok(markBox.y >= trackBox.height && bookmarkBox.y < viewport.height && likeBox.y < viewport.height, 'Comment actions sit below the track and in the viewport');
      assert.equal(await page.locator('[data-reading-progress]').getByRole('button').count(), 0);
      assert.equal((await page.locator('[data-reading-progress]').innerText()).includes('%'), false);
      if (Math.abs(markBox.y - bookmarkBox.y) < 16 && Math.abs(likeBox.y - bookmarkBox.y) < 16) {
        assert.ok(markBox.x + markBox.width <= likeBox.x + 1, 'Reading mark stays left of like');
        assert.ok(likeBox.x + likeBox.width <= bookmarkBox.x + 1, 'Bookmark stays right of like');
      }
      console.log(`Reading progress bar ${width}px: full-bleed top strip follows scroll, comment actions unchanged.`);
    } finally {await context.close();}
  }
} finally {
  await browser?.close();
  await server.close();
  await rm(cacheDir, {recursive: true, force: true});
}
