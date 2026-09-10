import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import {chromium} from 'playwright';

// Real native widget and AssistantWorkspace; only a lazy module request and a
// fixture query fail. No account, cloud service, or real document is accessed.
const root = fileURLToPath(new URL('../..', import.meta.url));
const fixture = name => fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));
const cacheDir = await mkdtemp(join(tmpdir(), 'workspace-errors-'));
const server = await createServer({
  root, configFile: false, envDir: false, publicDir: false, cacheDir,
  plugins: [{name: 'workspace-role-query-failure', enforce: 'pre', async load(id) {
    if (id !== fixture('services-convex.tsx')) return;
    const source = await readFile(id, 'utf8');
    const marker = "  if (name === 'membership:getConsultationRole') return";
    assert.equal(source.split(marker).length, 2);
    return source.replace(marker, `  if (name === 'membership:getConsultationRole' && new URLSearchParams(location.search).has('failRole')) {
      throw new ConvexError('Fixture role query rejected');
    }
${marker}`);
  }}, react(), tailwind()],
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
const unexpectedErrors = [];
const tab = (page, name) => page.locator('.assistant-workspace__switcher').getByRole('radio', {name, exact: true});
try {
  await server.listen();
  const base = new URL(server.resolvedUrls.local[0]);
  browser = await chromium.launch({headless: true});
  for (const [width, failure] of [[757, 'chunk'], [375, 'chunk'], [375, 'role']]) {
    const context = await browser.newContext({viewport: {width, height: 900}, reducedMotion: 'reduce', serviceWorkers: 'block'});
    let rejectedChunks = 0;
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin !== base.origin) return route.abort();
      if (failure === 'chunk' && url.pathname === '/src/components/consultations/ConsultationsPanel.tsx') {
        rejectedChunks++;
        return route.abort('failed');
      }
      return route.continue();
    });
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    let documents = 0;
    page.on('request', request => {if (request.isNavigationRequest() && request.frame() === page.mainFrame()) documents++;});
    page.on('pageerror', error => {
      if (!/Failed to fetch dynamically imported module|Fixture role query rejected/.test(error.message)) unexpectedErrors.push(error.message);
    });
    try {
      await page.goto(new URL(`/tests/fixtures/services-ui.html?view=widget${failure === 'role' ? '&failRole=true' : ''}`, base).href);
      const launcher = page.locator('[data-chat-launcher]');
      const panel = page.locator('#blog-chat-panel');
      await launcher.click();
      const boundary = panel.locator('[data-service-boundary="failed"]');
      if (failure === 'chunk') {
        await tab(page, '我的').waitFor();
        await panel.locator('[data-reader-library]').waitFor();
        await tab(page, '咨询').click();
        await boundary.getByRole('heading', {name: '此功能暂时无法打开', exact: true}).waitFor();
        assert.equal(rejectedChunks, 1, 'The consultation module fails on its actual first lazy request');
        assert.equal(await boundary.evaluate(element => Boolean(element.closest('.assistant-workspace__view'))), true,
          'The asset failure is caught inside the selected view, below the persistent header');
        await boundary.getByRole('button', {name: '更新页面', exact: true}).waitFor();
        assert.equal(await panel.locator('[data-workspace-pin]').count(), 0, 'The removed pin control stays absent in an error state');
        await panel.locator('[data-workspace-notifications]').click();
        await panel.locator('[data-notifications]').waitFor();
        assert.equal(await boundary.count(), 0, 'Opening messages removes only the failed consultation view');
        await tab(page, '我的').click();
        await panel.locator('[data-reader-library]').waitFor();
        await tab(page, '咨询').click();
        await boundary.getByRole('heading', {name: '此功能暂时无法打开', exact: true}).waitFor();
        await page.evaluate(() => {window.dispatchEvent(new Event('online')); document.dispatchEvent(new Event('visibilitychange'));});
        await page.waitForTimeout(1_200);
        assert.equal(rejectedChunks, 1, 'A cached lazy rejection does not trigger a retry loop or another module request');
        assert.equal(await panel.locator('.assistant-workspace__switcher').isVisible(), true);
      } else {
        await boundary.getByRole('heading', {name: '此功能暂时无法打开', exact: true}).waitFor();
        await boundary.getByRole('button', {name: '重试', exact: true}).waitFor();
        assert.equal(await panel.locator('.assistant-workspace__switcher').count(), 0, 'A header query failure reaches the session boundary');
        assert.equal(await boundary.getByRole('button', {name: '关闭博客助手', exact: true}).isVisible(), true,
          'The outer session fallback preserves its explicit close action');
        assert.equal(await boundary.getByRole('button', {name: '更新页面', exact: true}).count(), 0);
        await page.waitForTimeout(1_200);
        assert.equal(await boundary.getByRole('button', {name: '关闭博客助手', exact: true}).isVisible(), true,
          'Close remains available after the bounded query retry also fails');
      }
      assert.equal(documents, 1, 'Neither lazy failure nor session query failure refreshes the document automatically');
      assert.equal(await panel.getByRole('alert').filter({hasText: 'Fixture role query rejected'}).count(), 0, 'Error details are not exposed in the product UI');
      await page.screenshot({path: join(tmpdir(), `workspace-${failure}-failure-${width}.png`)});
      await panel.getByRole('button', {name: '关闭博客助手', exact: true}).click();
      assert.equal(await panel.evaluate(element => element.open), false, 'Close works even while the selected view is failed');
      assert.equal(await launcher.evaluate(element => document.activeElement === element), true, 'Failure close returns focus to the actual launcher');
      const state = await page.evaluate(() => window.__services.getState());
      assert.equal(state.writes.filter(write => write.name !== 'membership:getMyMembership').length, 0, 'Failure recovery creates no business writes');
      assert.equal(state.clientLifecycle.some(event => ['setAuth', 'clearAuth'].includes(event.event) && event.closed), false);
      console.log(`${width}px ${failure}: scoped fallback, available controls, explicit close, no automatic reload or business writes passed.`);
    } finally {await context.close();}
  }
  assert.deepEqual(unexpectedErrors, []);
} finally {
  await browser?.close(); await server.close(); await rm(cacheDir, {recursive: true, force: true});
}
