import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import {chromium} from 'playwright';

// Real search launcher, command modal, handoff event, native assistant host and
// AgentChat. Only authentication, storage and public search responses are local.
const root = fileURLToPath(new URL('../..', import.meta.url));
const fixture = name => fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));
const cacheDir = await mkdtemp(join(tmpdir(), 'search-chat-vite-'));
const endpoint = 'https://fixture.search.ai.cloudflare.com/search';
const server = await createServer({
  root, configFile: false, envDir: false, publicDir: false, cacheDir,
  plugins: [react(), tailwind()],
  optimizeDeps: {entries: ['tests/fixtures/services-ui.html']},
  resolve: {alias: [
    {find: /^convex\/react$/, replacement: fixture('services-convex.tsx')},
    {find: /^convex\/react-clerk$/, replacement: fixture('services-convex.tsx')},
    {find: /^@clerk\/react$/, replacement: fixture('services-clerk.tsx')},
    {find: /^@convex-dev\/agent\/react$/, replacement: fixture('services-agent.tsx')},
  ]},
  define: {
    'import.meta.env.PUBLIC_CLERK_PUBLISHABLE_KEY': JSON.stringify('fixture-public-key'),
    'import.meta.env.PUBLIC_CONVEX_URL': JSON.stringify('https://fixture.convex.cloud'),
    'import.meta.env.PUBLIC_AI_SEARCH_URL': JSON.stringify(endpoint),
    'import.meta.env.SITE': JSON.stringify('https://yindongliang.com'),
  },
  server: {host: '127.0.0.1', port: 0}, logLevel: 'warn',
});
let browser;
const errors = [];
const scope = process.env.SEARCH_CHAT_TEST_SCOPE ?? 'all';
assert.ok(['all', 'accounts'].includes(scope), 'SEARCH_CHAT_TEST_SCOPE must be all or accounts');
const state = page => page.evaluate(() => window.__services.getState());
const tab = (page, name) => page.locator('.assistant-workspace__switcher').getByRole('radio', {name, exact: true});
const input = page => page.getByRole('textbox', {name: '向 AI 博客助手提问', exact: true});
const search = page => page.getByRole('dialog', {name: '搜索博客', exact: true});
const panel = page => page.locator('#blog-chat-panel');
const searchTrigger = page => page.locator('[data-blog-search-trigger]');
const ask = page => page.locator('[data-search-ask-ai]');
const frames = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve)))));

async function isolated(base, width, {anonymous = false, delayMount = false} = {}) {
  const context = await browser.newContext({viewport: {width, height: 900}, reducedMotion: 'reduce', serviceWorkers: 'block'});
  const publicRequests = [], outside = [];
  let release;
  const gate = new Promise(resolve => {release = resolve;});
  let held = 0;
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.href === endpoint) {
      const headers = {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type'};
      if (request.method() === 'OPTIONS') {await route.fulfill({status: 204, headers}); return;}
      publicRequests.push({headers: request.headers(), body: request.postDataJSON()});
      await route.fulfill({headers, contentType: 'application/json', body: JSON.stringify({success: true, result: {chunks: []}})});
    } else if (url.origin !== base.origin) {
      outside.push(url.href); await route.abort();
    } else if (url.pathname === '/search/recent.json') {
      await route.fulfill({contentType: 'application/json', body: '[]'});
    } else if (url.pathname === '/search/references.json') {
      await route.fulfill({contentType: 'application/json', body: JSON.stringify({documents: []})});
    } else {
      if (delayMount && url.pathname === '/src/components/chat/mount-chat.tsx') {held++; await gate;}
      await route.continue();
    }
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(new URL(`/tests/fixtures/services-ui.html?view=widget&search=true${anonymous ? '&anonymous=true' : ''}`, base).href);
  await page.waitForFunction(() => document.documentElement.dataset.searchChatReady === 'true');
  return {context, page, publicRequests, outside, release, held: () => held};
}

async function question(page, text) {
  await searchTrigger(page).click();
  await search(page).waitFor();
  await page.locator('[data-blog-search-input]').fill(text);
  await ask(page).waitFor();
  const box = await ask(page).boundingBox();
  assert.ok(box && box.x >= 0 && box.x + box.width <= page.viewportSize().width + 1, 'The search-to-chat action fits the search modal');
  await ask(page).click();
  await search(page).waitFor({state: 'detached'});
  assert.equal(await panel(page).evaluate(element => element.open), true, 'Search hands off to an open assistant');
}

async function prefilled(page, text) {
  await input(page).waitFor();
  await page.waitForFunction(value => document.querySelector('textarea[aria-label="向 AI 博客助手提问"]')?.value === value, text);
  assert.equal(await tab(page, 'AI 对话').getAttribute('aria-checked'), 'true');
  await frames(page);
  assert.equal(await input(page).evaluate(element => document.activeElement === element), true, 'The composer keeps focus after search teardown and assistant loading');
  assert.equal(await search(page).count(), 0);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Handoff does not create horizontal overflow');
}

async function noSend(page, network) {
  assert.deepEqual((await state(page)).writes.filter(write => write.name !== 'membership:getMyMembership'), [], 'Prefill, replacement and dismissal never send, create a conversation or write business data');
  assert.deepEqual(network.outside, [], 'No real cloud or third-party endpoint is contacted');
  for (const request of network.publicRequests) {
    assert.equal(request.headers.authorization, undefined);
    assert.equal(request.headers.cookie, undefined);
  }
}

try {
  await server.listen();
  const base = new URL(server.resolvedUrls.local[0]);
  browser = await chromium.launch({headless: true});
  if (scope === 'all') {
  for (const width of [1016, 440, 320]) {
    const run = await isolated(base, width);
    const {page, context} = run;
    try {
      const first = 'Convex 如何保存 <草稿> 和多轮对话？';
      await question(page, `  ${first}  `);
      await prefilled(page, first);
      assert.equal(await input(page).locator('script, img').count(), 0);
      const saved = await page.evaluate(() => ({session: Object.values(sessionStorage), local: Object.values(localStorage)}));
      assert.ok([...saved.session, ...saved.local].every(value => !value.includes(first)), 'Search text stays in page memory, never browser storage');
      await noSend(page, run);
      await page.keyboard.press('Escape');
      await panel(page).waitFor({state: 'hidden'});
      await question(page, '第二个搜索问题：应当保留现有草稿');
      const pending = page.getByRole('group', {name: '待使用的搜索问题', exact: true});
      await pending.waitFor();
      assert.equal(await input(page).inputValue(), first, 'A search handoff never silently replaces an existing draft');
      await pending.getByRole('button', {name: '保留草稿', exact: true}).click();
      await pending.waitFor({state: 'detached'});
      await prefilled(page, first);
      await page.keyboard.press('Escape');
      await panel(page).waitFor({state: 'hidden'});
      const replacement = '用户明确确认后使用的新搜索问题';
      await question(page, replacement);
      await pending.waitFor();
      assert.equal(await input(page).inputValue(), first);
      await pending.getByRole('button', {name: '使用搜索问题', exact: true}).click();
      await pending.waitFor({state: 'detached'});
      await prefilled(page, replacement);
      await page.screenshot({path: join(tmpdir(), `search-chat-prefill-${width}.png`), fullPage: true});
      await noSend(page, run);
      await page.reload();
      await input(page).waitFor();
      assert.equal(await input(page).inputValue(), '', 'Reloading may restore the AI view but never restores the private search draft');
      await noSend(page, run);
      console.log(`Search to AI ${width}px: real modal/event/native host handoff, composer focus, explicit draft replacement, no automatic send and no stored prompt.`);
    } catch (error) {
      await page.screenshot({path: join(tmpdir(), `search-chat-failure-${width}.png`), fullPage: true}); throw error;
    } finally {await context.close();}
  }

  const anonymous = await isolated(base, 320, {anonymous: true});
  try {
    const {page} = anonymous;
    const prompt = '登录前只留在本页的搜索问题';
    await question(page, prompt);
    const gate = page.locator('.assistant-workspace__view');
    await gate.getByRole('heading', {name: '登录后继续', exact: true}).waitFor();
    assert.equal(await input(page).count(), 0, 'Anonymous readers see only the login gate');
    assert.equal(await tab(page, 'AI 对话').getAttribute('aria-checked'), 'true');
    assert.deepEqual((await state(page)).requests, [], 'An anonymous handoff executes no private Convex query');
    assert.deepEqual((await state(page)).writes, [], 'An anonymous handoff executes no Convex mutation or action');
    await gate.getByRole('button', {name: '登录 / 注册', exact: true}).click();
    await prefilled(page, prompt);
    await noSend(page, anonymous);
    await page.evaluate(() => window.__readerAuth.switchSession('fixture-b', 'session-handoff-b'));
    await input(page).waitFor();
    assert.equal(await input(page).inputValue(), '', 'A new account cannot inherit a consumed search prompt');
    await noSend(page, anonymous);
    console.log('Anonymous search handoff: no private Convex operations, local sign-in returns the prompt without sending, and account changes clear the draft.');
  } finally {await anonymous.context.close();}

  for (const mode of ['closed', 'reopened', 'latest']) {
    const run = await isolated(base, 320, {delayMount: true});
    try {
      const {page} = run;
      await question(page, '应当丢弃的延迟搜索请求');
      await page.waitForFunction(() => document.querySelector('[data-chat-load-status]')?.textContent.includes('正在打开'));
      assert.equal(run.held(), 1, 'The real mount-chat module request is held at the network boundary');
      await page.keyboard.press('Escape');
      await panel(page).waitFor({state: 'hidden'});
      if (mode === 'reopened') await page.locator('[data-chat-launcher]').click();
      if (mode === 'latest') await question(page, '只采用最后一次搜索交接');
      run.release();
      await page.locator('.assistant-workspace__switcher').waitFor({state: 'attached'});
      if (mode === 'closed') {
        assert.equal(await panel(page).evaluate(element => element.open), false, 'A dismissed pending load never reopens the assistant');
        await page.locator('[data-chat-launcher]').click();
      }
      await input(page).waitFor();
      if (mode === 'latest') await prefilled(page, '只采用最后一次搜索交接');
      else assert.equal(await input(page).inputValue(), '', 'A dismissed handoff cannot reappear in a later opening while its module was loading');
      assert.equal(await page.getByRole('group', {name: '待使用的搜索问题', exact: true}).count(), 0, 'Canceled handoffs cannot create a stale draft replacement prompt');
      await noSend(page, run);
      console.log(`Delayed search handoff ${mode}: real chunk loading, close/reopen and latest-request isolation without sends.`);
    } catch (error) {
      await run.page.screenshot({path: join(tmpdir(), `search-chat-delayed-${mode}-failure.png`), fullPage: true}); throw error;
    } finally {run.release(); await run.context.close();}
  }
  }
  for (const viaSignout of [false, true]) {
    const run = await isolated(base, 320);
    try {
      const {page} = run;
      await question(page, '账号 A 已有的未发送草稿');
      await prefilled(page, '账号 A 已有的未发送草稿');
      await page.keyboard.press('Escape');
      await panel(page).waitFor({state: 'hidden'});
      await question(page, '账号 A 仍未确认采用的新搜索问题');
      await page.getByRole('group', {name: '待使用的搜索问题', exact: true}).waitFor();
      if (viaSignout) {
        await page.evaluate(() => window.__readerAuth.switchSession(null, null));
        await page.locator('.assistant-workspace__view').getByRole('heading', {name: '登录后继续', exact: true}).waitFor();
      }
      await page.evaluate(() => window.__readerAuth.switchSession('fixture-b', 'session-pending-search-b'));
      await input(page).waitFor();
      await frames(page);
      assert.equal(await input(page).inputValue(), '', 'An unconfirmed search prompt from the previous account is never consumed by a new account');
      assert.equal(await page.getByRole('group', {name: '待使用的搜索问题', exact: true}).count(), 0);
      await noSend(page, run);
      console.log(`Pending search prompt account isolation ${viaSignout ? 'after sign-out' : 'direct switch'}: both the draft and unconfirmed replacement are discarded.`);
    } catch (error) {
      await run.page.screenshot({path: join(tmpdir(), `search-chat-pending-account-${viaSignout}-failure.png`), fullPage: true}); throw error;
    } finally {await run.context.close();}
  }
  const heldSend = await isolated(base, 320);
  try {
    const {page} = heldSend;
    await question(page, '仅在内存夹具中手动发送的测试问题');
    await prefilled(page, '仅在内存夹具中手动发送的测试问题');
    await page.evaluate(() => window.__services.holdNextAiSend());
    await page.getByRole('button', {name: '发送问题', exact: true}).click();
    await page.waitForFunction(() => window.__services.getState().writes.some(write => write.name === 'assistant:sendMessage'));
    const explicitWrites = (await state(page)).writes.filter(write => write.name !== 'membership:getMyMembership');
    assert.equal(explicitWrites.length, 1);
    assert.equal(explicitWrites[0].name, 'assistant:sendMessage');
    assert.equal(explicitWrites[0].userId, 'fixture-a');
    await page.keyboard.press('Escape');
    await panel(page).waitFor({state: 'hidden'});
    await question(page, '等待原账号发送完成的新搜索问题');
    await frames(page);
    assert.equal(await input(page).inputValue(), '仅在内存夹具中手动发送的测试问题', 'A pending send holds off consuming a new search prompt');
    await page.evaluate(() => window.__readerAuth.switchSession('fixture-b', 'session-held-send-b'));
    await input(page).waitFor();
    await frames(page);
    assert.equal(await input(page).inputValue(), '', 'A request awaiting the previous account’s send cannot prefill a new account');
    await page.evaluate(() => window.__services.releaseAiSend());
    await frames(page);
    assert.equal(await input(page).inputValue(), '', 'Late completion of the previous account’s mutation cannot deliver its pending search prompt');
    assert.deepEqual((await state(page)).writes.filter(write => write.name !== 'membership:getMyMembership'), explicitWrites, 'Only the explicitly clicked fixture send runs; neither handoff nor account changes send again');
    assert.deepEqual(heldSend.outside, []);
    console.log('Held fixture send: pending handoff is isolated from account changes and late completion, with exactly one explicit local send.');
  } catch (error) {
    await heldSend.page.screenshot({path: join(tmpdir(), 'search-chat-held-send-failure.png'), fullPage: true}); throw error;
  } finally {
    await heldSend.page.evaluate(() => window.__services.releaseAiSend()).catch(() => {});
    await heldSend.context.close();
  }
  assert.deepEqual(errors, [], 'No browser runtime errors');
} finally {
  await browser?.close();
  await server.close();
  await rm(cacheDir, {recursive: true, force: true});
}
