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
async function clickAndConfirm(page, button, accept) {
  page.once('dialog', (dialog) => accept ? dialog.accept() : dialog.dismiss());
  await button.click();
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
    await page.getByRole('button', {name: /^私有笔记/}).click();
    const note = page.getByRole('textbox', {name: '这篇文章的私有笔记'});
    assert.equal(await note.inputValue(), '账号 A 的私有笔记');
    await note.fill('账号 A 尚未保存的草稿');
    page.once('dialog', (dialog) => dialog.dismiss());
    assert.equal(await page.evaluate(() => window.dispatchEvent(new CustomEvent('reader:before-signout', {cancelable: true}))), false, 'Unsaved notes cancel sign-out');
    assert.equal((await state(page)).clients.length, 1, 'Declining sign-out preserves the authenticated client');
    assert.equal(await note.inputValue(), '账号 A 尚未保存的草稿');
    await page.evaluate(() => window.__readerAuth.switchSession('fixture-b', 'session-b'));
    await page.waitForFunction(() => window.__readerFixture.getState().clients.length === 2);
    await page.getByRole('button', {name: /^私有笔记/}).click();
    assert.equal(await note.inputValue(), '账号 B 的私有笔记', 'Session B never inherits session A cached private note or draft');
    let clients = (await state(page)).clients;
    assert.equal(clients[0].closed, true, 'The previous Convex client is closed');
    assert.equal(clients[1].closed, false);
    assert.equal(await page.getByText('账号 A 尚未保存的草稿', {exact: true}).count(), 0);
    await page.evaluate(() => window.__readerAuth.switchSession('fixture-b', 'session-b-new'));
    await page.waitForFunction(() => window.__readerFixture.getState().clients.length === 3);
    clients = (await state(page)).clients;
    assert.equal(clients[1].closed, true, 'Changing the session for the same account also discards its cache');
    await page.evaluate(() => window.__readerAuth.switchSession(null, null));
    await page.locator('[data-reader-root] [data-clerk-signin]').waitFor();
    await page.waitForFunction(() => window.__readerFixture.getState().clients.length === 4);
    assert.equal((await state(page)).clients[2].closed, true);
    assert.equal(await page.locator('[data-reader-article]').count(), 0, 'Anonymous state unmounts private reader UI');
    await page.getByRole('button', {name: '登录 / 注册'}).click();
    await page.locator('[data-reader-article]').waitFor();
    console.log('Reader sessions: switching accounts or sessions creates a fresh client, closes old clients and clears private drafts.');
  } finally {await accountContext.close();}

  const progressContext = await browser.newContext({viewport: {width: 1000, height: 900}, reducedMotion: 'reduce', serviceWorkers: 'block'});
  await progressContext.route('**/*', (route) => new URL(route.request().url()).origin === base.origin ? route.continue() : route.abort());
  try {
    const page = await progressContext.newPage();
    const progressWrites = async () => (await state(page)).writes.filter((write) => write.name === 'reader:saveProgress');
    const advanceSaveWindow = async () => {await page.clock.fastForward(10_100); await page.clock.runFor(100);};
    await page.goto(new URL('/tests/fixtures/reader-ui.html', base).href);
    const resume = page.getByRole('button', {name: '继续阅读 · 35%'});
    await resume.waitFor();
    await page.clock.install();
    await page.clock.runFor(100);
    await advanceSaveWindow();
    assert.equal((await progressWrites()).length, 0, 'Mount does not save or reset historical progress');

    // Programmatic scrolling and resume cannot create new read evidence.
    await page.evaluate(() => window.scrollTo(0, 1800));
    await page.waitForFunction(() => window.scrollY >= 1800);
    await advanceSaveWindow();
    assert.equal((await progressWrites()).length, 0, 'Programmatic scroll without user intent does not save progress');
    await page.evaluate(() => window.scrollTo(0, 0));
    await resume.click();
    const restored = await page.evaluate(() => {
      const article = document.querySelector('article[data-pagefind-body]').getBoundingClientRect();
      return {scrollY, expected: article.top + scrollY + (article.height - innerHeight) * .35};
    });
    assert.ok(Math.abs(restored.scrollY - restored.expected) < 2, 'Resume uses the historical percentage within the article');
    await advanceSaveWindow();
    assert.equal((await progressWrites()).length, 0, 'Continue reading restores position without falsely advancing history');

    // Playwright wheel produces trusted browser input, unlike dispatchEvent.
    await page.mouse.move(500, 450);
    await page.mouse.wheel(0, 650);
    await page.waitForFunction((before) => window.scrollY > before + 100, restored.scrollY);
    await advanceSaveWindow();
    let writes = await progressWrites();
    assert.equal(writes.length, 1, 'A real user scroll causes a throttled save');
    assert.ok(writes[0].args.progress > 35 && writes[0].args.progress < 100);
    const historical = (await state(page)).page.progress;
    assert.equal(historical, writes[0].args.progress);

    await page.mouse.wheel(0, -900);
    await page.waitForFunction((before) => window.scrollY < before, restored.scrollY + 650);
    await advanceSaveWindow();
    assert.equal((await progressWrites()).length, 1, 'Scrolling backward does not write a lower percentage');
    assert.equal((await state(page)).page.progress, historical);

    await page.evaluate(() => window.__readerFixture.remoteProgress(95));
    await page.getByText('已读 95%', {exact: true}).waitFor();
    await page.mouse.wheel(0, 250);
    await advanceSaveWindow();
    assert.equal((await progressWrites()).length, 1, 'A newer remote high-water mark suppresses lower local writes');
    assert.equal((await state(page)).page.progress, 95);

    const end = await page.evaluate(() => {
      const article = document.querySelector('article[data-pagefind-body]').getBoundingClientRect();
      return article.bottom + scrollY - innerHeight;
    });
    const currentY = await page.evaluate(() => scrollY);
    await page.mouse.wheel(0, end - currentY + 2);
    await page.waitForFunction((end) => window.scrollY >= end, end);
    await advanceSaveWindow();
    writes = await progressWrites();
    assert.equal(writes.length, 2);
    assert.equal(writes[1].args.progress, 100, 'Reading completes at the article boundary, before the comments');
    assert.equal((await state(page)).page.progress, 100);
    assert.equal(await page.evaluate(() => document.querySelector('[data-fixture-comments]').getBoundingClientRect().bottom > innerHeight), true,
      'The comments section still extends below the viewport when article progress reaches 100%');
    console.log('Reader progress: mount/programmatic/resume do not write; trusted scrolling saves, backward/remote-low writes are suppressed, and article completion excludes comments.');
  } finally {await progressContext.close();}

  for (const width of [1440, 390, 320]) {
    const context = await browser.newContext({viewport: {width, height: 900}, reducedMotion: 'reduce', serviceWorkers: 'block'});
    const errors = [];
    await context.route('**/*', (route) => new URL(route.request().url()).origin === base.origin ? route.continue() : route.abort());
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    page.on('pageerror', (error) => errors.push(error.message));
    try {
      await page.goto(new URL('/tests/fixtures/reader-ui.html', base).href);
      const article = page.locator('[data-reader-article]');
      const note = article.getByRole('textbox', {name: '这篇文章的私有笔记'});
      const save = article.getByRole('button', {name: '保存笔记', exact: true});
      const clear = article.getByRole('button', {name: '清空', exact: true});
      await article.getByRole('button', {name: '收藏这篇', exact: true}).click();
      await article.getByRole('button', {name: '已收藏', exact: true}).waitFor();
      assert.equal((await state(page)).page.bookmarked, true);
      await article.getByRole('button', {name: '已收藏', exact: true}).click();
      await article.getByRole('button', {name: '收藏这篇', exact: true}).waitFor();
      assert.equal((await state(page)).page.bookmarked, false);

      await article.getByRole('button', {name: /^私有笔记/}).click();
      assert.equal(await note.inputValue(), '云端初始笔记');
      await note.fill('本地编辑的笔记');
      await save.click();
      await article.getByRole('status').filter({hasText: '笔记已保存。'}).waitFor();
      assert.equal((await state(page)).page.note, '本地编辑的笔记');

      await note.fill('保留我的草稿');
      await page.evaluate(() => window.__readerFixture.remoteNote('另一个设备更新的内容'));
      await article.getByRole('alert').filter({hasText: '另一个页面或设备'}).waitFor();
      assert.equal(await note.inputValue(), '保留我的草稿', 'A remote conflict never replaces local input');
      assert.equal(await save.isDisabled(), true, 'Conflicting edits cannot directly overwrite the remote revision');
      assert.equal(await article.getByLabel('最新云端笔记').textContent(), '另一个设备更新的内容');
      await article.getByRole('button', {name: '已对照，保留草稿继续编辑'}).click();
      await note.fill('合并后的笔记');
      await save.click();
      await article.getByRole('status').filter({hasText: '笔记已保存。'}).waitFor();
      assert.equal((await state(page)).page.note, '合并后的笔记');

      await note.fill('清空前未保存的修改');
      await clickAndConfirm(page, clear, false);
      assert.equal(await note.inputValue(), '清空前未保存的修改');
      await page.evaluate(() => window.__readerFixture.rejectNext());
      await clickAndConfirm(page, clear, true);
      await article.getByRole('alert').filter({hasText: '笔记未能保存'}).waitFor();
      assert.equal(await note.inputValue(), '清空前未保存的修改', 'A failed clear preserves input');
      assert.equal((await state(page)).page.note, '合并后的笔记');
      await clickAndConfirm(page, clear, true);
      await article.getByRole('status').filter({hasText: '笔记已清空。'}).waitFor();
      assert.equal(await note.inputValue(), '', 'Confirmed successful clear removes the unsaved input');
      assert.equal((await state(page)).page.note, '');

      await note.fill('再次保存的笔记');
      await save.click();
      await article.getByRole('status').filter({hasText: '笔记已保存。'}).waitFor();
      await page.evaluate(() => window.__readerFixture.recreateAfterNextClear('另一设备重新创建的笔记'));
      await clickAndConfirm(page, clear, true);
      await article.getByRole('status').filter({hasText: '笔记已清空。'}).waitFor();
      assert.equal(await note.inputValue(), '另一设备重新创建的笔记', 'A delayed clear acknowledgement preserves a later remote recreation');
      await note.fill('基于最新版本继续编辑');
      await save.click();
      await article.getByRole('status').filter({hasText: '笔记已保存。'}).waitFor();
      assert.equal((await state(page)).page.note, '基于最新版本继续编辑', 'The next save uses the recreated version rather than a stale null base');
      assert.equal((await state(page)).writes.filter((write) => write.name === 'reader:saveProgress').length, 0,
        'UI interactions and mount do not write reading progress');
      assert.equal(await page.evaluate(() => localStorage.length), 0, 'Private drafts never enter localStorage');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true,
        `Article controls fit ${width}px`);
      if (width === 1440 || width === 390) await page.screenshot({path: join('/tmp', `reader-ui-article-${width}.png`)});

      await page.goto(new URL('/tests/fixtures/reader-ui.html?view=library', base).href);
      const library = page.locator('[data-reader-library]');
      assert.equal(await library.getByRole('listitem').count(), 20);
      await library.getByRole('button', {name: '加载更多'}).click();
      await page.waitForFunction(() => document.querySelectorAll('[data-reader-library] li').length === 23);
      assert.equal(await library.getByRole('button', {name: '加载更多'}).count(), 0);
      await library.getByRole('tab', {name: '私有笔记', exact: true}).click();
      assert.equal(await library.getByRole('listitem').count(), 3);
      assert.equal(await library.getByText('私有测试笔记 1，仅由内存测试数据提供。').count(), 1);
      await library.getByRole('tab', {name: '阅读进度', exact: true}).click();
      assert.equal(await library.getByRole('listitem').count(), 20);
      assert.equal(await library.getByText('已读完 ·', {exact: true}).count(), 1);
      await library.getByRole('tab', {name: '收藏', exact: true}).click();
      assert.equal(await library.getByRole('listitem').count(), 20, 'Changing tabs resets the pagination window');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true,
        `Library controls fit ${width}px`);
      if (width === 390) await page.screenshot({path: join('/tmp', 'reader-ui-library-390.png')});
      assert.deepEqual(errors, [], 'No browser runtime errors');
      console.log(`Reader UI ${width}px: bookmarks, notes, conflicts, clear confirmation/failure, pagination and overflow passed.`);
    } finally {
      await context.close();
    }
  }
} finally {
  await browser?.close();
  await server.close();
  await rm(cacheDir, {recursive: true, force: true});
}
