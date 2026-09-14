import assert from 'node:assert/strict';
import {mkdir, mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import {chromium} from 'playwright';

const root = fileURLToPath(new URL('../..', import.meta.url));
const fixture = (name) => fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));
const cacheDir = await mkdtemp(join(tmpdir(), 'auth-control-'));
const screenshots = process.env.BLOG_SCREENSHOT_DIR;
const capture = async (locator, name) => {
  if (screenshots) await locator.screenshot({path: join(screenshots, name)});
};
const server = await createServer({
  root, configFile: false, envDir: false, publicDir: false, cacheDir,
  plugins: [react(), tailwind()],
  optimizeDeps: {entries: ['tests/fixtures/services-ui.tsx']},
  resolve: {alias: [
    {find: /^convex\/react$/, replacement: fixture('services-convex.tsx')},
    {find: /^convex\/react-clerk$/, replacement: fixture('services-convex.tsx')},
    {find: /^@clerk\/react$/, replacement: fixture('services-clerk.tsx')},
    {find: /^@convex-dev\/agent\/react$/, replacement: fixture('services-agent.tsx')},
  ]},
  define: {
    'import.meta.env.PUBLIC_CLERK_PUBLISHABLE_KEY': JSON.stringify('fixture-public-key'),
    'import.meta.env.PUBLIC_CONVEX_URL': JSON.stringify('https://fixture.convex.cloud'),
  },
  server: {host: '127.0.0.1', port: 0}, logLevel: 'warn',
});
let browser;
const errors = [];
try {
  await server.listen();
  if (screenshots) await mkdir(screenshots, {recursive: true});
  const base = new URL(server.resolvedUrls.local[0]);
  browser = await chromium.launch({headless: true});
  const context = await browser.newContext({viewport: {width: 480, height: 900}, reducedMotion: 'reduce', serviceWorkers: 'block'});
  await context.route('**/*', route => new URL(route.request().url()).origin === base.origin ? route.continue() : route.abort());
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  page.on('pageerror', error => errors.push(error.message));
  const state = () => page.evaluate(() => window.__services.getState());
  const comments = page.locator('.blog-comments__root');

  await page.goto(new URL('/tests/fixtures/services-ui.html?view=comments&bookmarkable=true', base).href);
  const like = comments.getByRole('button', {name: '喜欢这篇文章', exact: true});
  const bookmark = comments.getByRole('button', {name: '收藏当前文章', exact: true});
  await like.waitFor();
  await bookmark.waitFor();
  await page.evaluate(() => window.__services.setConvexAuth({isAuthenticated: false, isLoading: false}));
  const retryLike = comments.getByRole('button', {name: '重试后喜欢这篇文章', exact: true});
  const retryBookmark = comments.getByRole('button', {name: '重试后收藏当前文章', exact: true});
  await retryLike.waitFor();
  await retryBookmark.waitFor();
  assert.equal(await retryLike.isDisabled(), false, 'A Convex gap must not leave a dead like button');
  assert.equal(await retryBookmark.isDisabled(), false, 'A Convex gap must not leave a dead bookmark');
  await comments.getByRole('alert').filter({hasText: '登录状态暂时无法同步'}).waitFor();
  const retry = comments.getByRole('button', {name: '重试', exact: true});
  assert.equal(await retry.isDisabled(), false);
  await capture(comments, 'comments-convex-unavailable.png');
  const writesBefore = (await state()).writes.length;
  await retryLike.click();
  assert.equal((await state()).writes.length, writesBefore, 'Retrying like must not fake a like write');
  await comments.getByRole('button', {name: '重试后收藏当前文章', exact: true}).click();
  assert.equal((await state()).writes.length, writesBefore, 'Retrying bookmark must not fake a bookmark write');
  await page.evaluate(() => window.__services.setConvexAuth(null));
  await comments.getByRole('button', {name: '喜欢这篇文章', exact: true}).waitFor();
  await comments.getByRole('button', {name: '收藏当前文章', exact: true}).waitFor();
  await comments.getByRole('button', {name: '喜欢这篇文章', exact: true}).click();
  await page.waitForFunction(() => document.querySelector('.blog-comments__like')?.getAttribute('aria-pressed') === 'true');
  assert.ok((await state()).writes.some(write => write.name === 'comments:setLike'));

  await page.goto(new URL('/tests/fixtures/services-ui.html', base).href);
  await page.getByRole('radio', {name: '我的', exact: true}).waitFor();
  await page.evaluate(() => window.__services.setConvexAuth({isAuthenticated: false, isLoading: false}));
  await page.getByRole('alert').filter({hasText: '账户暂时无法连接'}).waitFor();
  const workspaceRetry = page.getByRole('button', {name: '重试', exact: true});
  assert.equal(await workspaceRetry.isDisabled(), false);
  await capture(page.locator('.assistant-workspace'), 'workspace-convex-unavailable.png');
  await page.evaluate(() => window.__services.setConvexAuth(null));
  await page.getByRole('radio', {name: '我的', exact: true}).waitFor();
  assert.equal(await page.getByRole('alert').filter({hasText: '账户暂时无法连接'}).count(), 0);

  assert.equal(errors.length, 0, errors.join('\n'));
  console.log('Auth control: likes, bookmarks and the assistant gate explain Convex gaps and offer retry.');
} finally {
  await browser?.close();
  await server.close();
  await rm(cacheDir, {recursive: true, force: true});
}
