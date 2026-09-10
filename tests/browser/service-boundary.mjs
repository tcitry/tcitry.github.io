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
const cacheDir = await mkdtemp(join(tmpdir(), 'service-boundary-vite-'));
const routePath = '/service-boundary-fixture/';
const html = '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><label>页面草稿<input aria-label="页面草稿" value="保留页面草稿"></label><div id="root"></div><script type="module" src="/tests/fixtures/service-boundary.tsx"></script></body></html>';
const server = await createServer({
  root, configFile: false, envDir: false, publicDir: false, cacheDir,
  plugins: [{name: 'service-boundary-fixture', configureServer(vite) {
    vite.middlewares.use(async (request, response, next) => {
      if (request.url !== routePath) return next();
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end(await vite.transformIndexHtml(routePath, html));
    });
  }}, react(), tailwind()],
  optimizeDeps: {entries: ['tests/fixtures/service-boundary.tsx']},
  server: {host: '127.0.0.1', port: 0}, logLevel: 'warn',
});
let browser;
const delay = 347;
const pauseForRetry = delay + 200;
const snapshot = page => page.evaluate(() => window.__serviceBoundary.snapshot());
const mount = (page, options = {}) => page.evaluate(options => window.__serviceBoundary.mount(options), {autoRetryDelayMs: delay, ...options});
const waitCaught = (page, count) => page.waitForFunction(count => window.__serviceBoundary.snapshot().caught === count, count);
const retry = page => page.getByRole('button', {name: '重试', exact: true});
const close = page => page.getByRole('button', {name: '关闭博客助手', exact: true});
async function assertFallback(page, asset = false) {
  assert.equal(await page.getByRole('alert').count(), 1, 'One controlled service error is shown');
  assert.equal(await page.getByRole('heading', {name: '此功能暂时无法打开', exact: true}).count(), 1);
  assert.equal(await retry(page).count(), asset ? 0 : 1);
  assert.equal(await page.getByRole('button', {name: '更新页面', exact: true}).count(), asset ? 1 : 0);
  assert.equal(await close(page).count(), 1);
  assert.equal((await page.locator('body').innerText()).includes('fixture-private-service-detail'), false, 'Raw service errors are not exposed');
}
async function recoveryEvents(page) {
  await page.evaluate(() => {
    for (let index = 0; index < 4; index++) {
      window.__serviceBoundary.connectivity(false);
      window.__serviceBoundary.connectivity(true);
      window.__serviceBoundary.visibility('hidden');
      window.__serviceBoundary.visibility('visible');
    }
  });
}

try {
  await server.listen();
  const base = new URL(server.resolvedUrls.local[0]);
  browser = await chromium.launch({headless: true});
  const context = await browser.newContext({viewport: {width: 390, height: 844}, reducedMotion: 'reduce', serviceWorkers: 'block'});
  const external = [];
  let documents = 0;
  await context.route('**/*', route => {
    const request = route.request();
    if (new URL(request.url()).origin !== base.origin) {external.push(request.url()); return route.abort();}
    if (request.isNavigationRequest()) documents++;
    return route.continue();
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.setDefaultTimeout(10000);
  await page.goto(new URL(routePath, base).href);
  await page.waitForFunction(() => window.__serviceBoundary);
  const bootId = (await snapshot(page)).bootId;

  // The child keeps throwing during React's failed-render replay and becomes
  // available only after the error is actually caught by the real boundary.
  await mount(page, {mode: 'transient'});
  await waitCaught(page, 1);
  await page.getByRole('region', {name: '服务内容'}).waitFor();
  assert.equal((await snapshot(page)).caught, 1);
  assert.equal((await snapshot(page)).timerFired, 1);
  assert.equal(await page.getByRole('alert').count(), 0);
  console.log('Service boundary: transient service failure recovers with one automatic retry.');

  await mount(page, {mode: 'persistent'});
  await waitCaught(page, 2);
  await assertFallback(page);
  await page.waitForTimeout(pauseForRetry * 2);
  assert.equal((await snapshot(page)).caught, 2, 'A persistent failure cannot enter a timed retry loop');
  assert.equal((await snapshot(page)).timerFired, 1);
  await recoveryEvents(page);
  await page.waitForTimeout(pauseForRetry);
  assert.equal((await snapshot(page)).caught, 2, 'Connectivity and visibility share the already-spent timer budget');

  await retry(page).click();
  await waitCaught(page, 3);
  await recoveryEvents(page);
  await page.waitForTimeout(pauseForRetry);
  assert.equal((await snapshot(page)).caught, 3, 'Manual retry does not replenish the automatic retry budget');
  await assertFallback(page);
  await page.getByRole('textbox', {name: '页面草稿', exact: true}).fill('手动恢复前的页面内容');
  await page.evaluate(() => window.__serviceBoundary.setFailure(false));
  await retry(page).click();
  await page.getByRole('region', {name: '服务内容'}).waitFor();
  assert.equal((await snapshot(page)).mounts, 1, 'Manual retry mounts service content again');
  assert.equal(await page.getByRole('textbox', {name: '页面草稿', exact: true}).inputValue(), '手动恢复前的页面内容');
  assert.equal((await snapshot(page)).bootId, bootId);
  assert.equal(documents, 1, 'Retry keeps the current document instead of reloading it');
  console.log('Service boundary: persistent failure keeps close/manual controls; manual recovery preserves the page and automatic budget.');

  // An online event may spend the one retry before its timer. Later events and
  // the original timer must not cause a third capture.
  await mount(page, {mode: 'persistent', autoRetryDelayMs: 917});
  await waitCaught(page, 1);
  await recoveryEvents(page);
  await waitCaught(page, 2);
  await page.waitForTimeout(1100);
  assert.equal((await snapshot(page)).caught, 2);
  assert.equal((await snapshot(page)).timerFired, 0, 'Event recovery cancels the scheduled retry');
  assert.equal((await snapshot(page)).pendingTimers, 0);
  await close(page).click();
  assert.equal((await snapshot(page)).closes, 1);
  assert.equal(await page.locator('#root').textContent(), '');
  await recoveryEvents(page);
  await page.waitForTimeout(100);
  assert.equal((await snapshot(page)).caught, 2, 'A closed boundary no longer responds to recovery events');
  console.log('Service boundary: online/visibility recovery shares one retry, and closing remains available after failure.');

  await page.evaluate(() => window.__serviceBoundary.connectivity(false));
  await mount(page, {mode: 'persistent'});
  await waitCaught(page, 1);
  await page.waitForTimeout(pauseForRetry);
  assert.equal((await snapshot(page)).caught, 1, 'An initially offline view waits for connectivity');
  assert.equal((await snapshot(page)).pendingTimers, 0);
  await page.evaluate(() => {
    window.__serviceBoundary.visibility('hidden');
    window.__serviceBoundary.connectivity(true);
  });
  await page.waitForTimeout(100);
  assert.equal((await snapshot(page)).caught, 1, 'A hidden view does not retry on the online event');
  await page.evaluate(() => window.__serviceBoundary.visibility('visible'));
  await waitCaught(page, 2);
  await recoveryEvents(page);
  await page.waitForTimeout(pauseForRetry);
  assert.equal((await snapshot(page)).caught, 2, 'Visibility recovery alone spends the same one-time budget');
  assert.equal((await snapshot(page)).timerFired, 0);
  console.log('Service boundary: offline and hidden views wait; becoming visible triggers only one recovery.');

  await mount(page, {mode: 'persistent'});
  await waitCaught(page, 1);
  await page.evaluate(() => window.__serviceBoundary.visibility('hidden'));
  await page.waitForTimeout(pauseForRetry);
  assert.equal((await snapshot(page)).timerFired, 1);
  assert.equal((await snapshot(page)).caught, 1, 'A scheduled retry cannot remount a view that became hidden');
  await page.evaluate(() => window.__serviceBoundary.visibility('visible'));
  await waitCaught(page, 2);
  await recoveryEvents(page);
  await page.waitForTimeout(pauseForRetry);
  assert.equal((await snapshot(page)).caught, 2, 'Waiting while hidden preserves, but does not replenish, the one retry budget');

  await mount(page, {mode: 'persistent'});
  await waitCaught(page, 2);
  await page.evaluate(() => window.__serviceBoundary.changeView('view-b', 'healthy'));
  await page.getByRole('region', {name: '服务内容'}).waitFor();
  assert.equal(await page.getByRole('alert').count(), 0, 'Changing resetKey clears the failed view');
  await page.evaluate(() => {window.__serviceBoundary.setFailure(true); window.__serviceBoundary.rerender();});
  await waitCaught(page, 4);
  await page.waitForTimeout(pauseForRetry);
  assert.equal((await snapshot(page)).caught, 4, 'A different view receives exactly one fresh retry budget');
  assert.equal((await snapshot(page)).timerFired, 2);
  console.log('Service boundary: resetKey clears the old failure and gives the next view one retry.');

  await mount(page, {mode: 'persistent', autoRetryDelayMs: 917, canClose: false});
  await waitCaught(page, 1);
  assert.equal(await close(page).count(), 0, 'An embedded boundary does not invent a close action');
  assert.equal((await snapshot(page)).pendingTimers, 1);
  await page.evaluate(() => window.__serviceBoundary.unmount());
  assert.equal((await snapshot(page)).pendingTimers, 0, 'Unmount clears the pending retry timer immediately');
  assert.equal((await snapshot(page)).timerCleared, 1);
  await recoveryEvents(page);
  await page.waitForTimeout(1100);
  assert.equal((await snapshot(page)).caught, 1);
  assert.equal((await snapshot(page)).timerFired, 0, 'No retry callback fires after unmount');
  console.log('Service boundary: unmount clears retries and listeners.');

  for (const assetErrorStyle of ['chromium', 'webkit', 'firefox']) {
    await mount(page, {mode: 'asset-failure', assetErrorStyle});
    await waitCaught(page, 1);
    await assertFallback(page, true);
    await page.getByText('页面内容可能已更新，请更新页面后重新打开此功能。', {exact: true}).waitFor();
    assert.equal((await snapshot(page)).lazyLoads, 1, 'The real lazy import factory ran once');
    assert.equal((await snapshot(page)).pendingTimers, 0, 'A rejected lazy import does not schedule automatic recovery');
    await recoveryEvents(page);
    await page.waitForTimeout(pauseForRetry * 2);
    assert.equal((await snapshot(page)).caught, 1, 'Timer and browser recovery events cannot remount a cached lazy rejection');
    assert.equal((await snapshot(page)).timerFired, 0);
    await page.evaluate(() => window.__serviceBoundary.rerender());
    await recoveryEvents(page);
    await page.waitForTimeout(pauseForRetry);
    const state = await snapshot(page);
    assert.equal(state.caught, 1, 'Rerendering and repeated recovery events cannot loop a cached rejection');
    assert.equal(state.lazyLoads, 1);
    assert.equal(state.pendingTimers, 0);
    assert.equal(state.timerFired, 0);
    assert.equal(state.mounts, 0);
    assert.deepEqual(state.warnings, [['[Account service] View failed.', {category: 'asset_load_failed'}]], 'Development diagnostics contain only the safe category, not the import error or stack');
    assert.doesNotMatch(await page.locator('body').innerHTML(), /assets\.example\.com|private-fixture-chunk|fixture-secret/);
    assert.equal(state.bootId, bootId);
    assert.equal(await page.getByRole('textbox', {name: '页面草稿', exact: true}).inputValue(), '手动恢复前的页面内容');
    await close(page).click();
    assert.equal((await snapshot(page)).closes, 1, 'The user can close a failed lazy view');
    assert.equal(await page.locator('#root').textContent(), '');
  }
  assert.equal(documents, 1, 'Service retries, asset failures and closing never reload implicitly');
  await mount(page, {mode: 'asset-failure'});
  await waitCaught(page, 1);
  await assertFallback(page, true);
  await Promise.all([
    page.waitForEvent('load'),
    page.getByRole('button', {name: '更新页面', exact: true}).click(),
  ]);
  await page.waitForFunction(previous => window.__serviceBoundary && window.__serviceBoundary.snapshot().bootId !== previous, bootId);
  assert.equal(documents, 2, 'Only the explicit update-page action reloads the current document');
  assert.equal(await page.getByRole('textbox', {name: '页面草稿', exact: true}).inputValue(), '保留页面草稿');
  assert.deepEqual(external, [], 'The fixture never contacts an external endpoint');
  assert.deepEqual(errors, [], 'Caught service failures produce no uncaught page error');
  console.log('Service boundary: real React.lazy rejection stays bounded for Chromium/WebKit/Firefox error messages, with safe diagnostics and close; only explicit update-page reloads, and no external request occurs.');
} finally {
  await browser?.close();
  await server.close();
  await rm(cacheDir, {recursive: true, force: true});
}
