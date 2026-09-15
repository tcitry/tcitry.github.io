import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {chromium} from 'playwright';

// Real React effects, WindowProxy identities, opener/postMessage, browser
// navigation, scroll position and window.close; only Clerk's account service
// and prebuilt UI are fixtures. All traffic stays on this local HTTP server.
const fixture = fileURLToPath(new URL('../fixtures/clerk-oauth-popup.tsx', import.meta.url));
const bundle = await build({
  entryPoints: [fixture], bundle: true, platform: 'browser', format: 'esm', write: false, jsx: 'automatic',
  define: {'import.meta.env.PUBLIC_CLERK_PUBLISHABLE_KEY': JSON.stringify('pk_test_popup_fixture')},
  plugins: [{
    name: 'clerk-oauth-popup-fixture',
    setup(build) { build.onResolve({filter: /^@clerk\/react$/}, () => ({path: fixture})); },
  }],
});
const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>OAuth popup fixture</title></head><body>
<div id="root"></div><script>window.__fixtureDocumentId = crypto.randomUUID();</script>
<script type="module">import {startFixture} from '/fixture.js'; startFixture();</script></body></html>`;
const server = createServer((request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  if (request.url === '/fixture.js') {
    response.setHeader('Content-Type', 'text/javascript');
    response.end(bundle.outputFiles[0].text);
    return;
  }
  response.setHeader('Content-Type', 'text/html');
  response.end(request.url === '/untrusted/' ? '<!doctype html><title>Other origin fixture</title>' : html);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
// Another origin served by the same local process, for a real MessageEvent
// whose source is the expected popup but whose origin is not trusted.
const foreignServer = createServer((_request, response) => {
  response.setHeader('Content-Type', 'text/html');
  response.end('<!doctype html><title>Other origin fixture</title>');
});
await new Promise(resolve => foreignServer.listen(0, '127.0.0.1', resolve));
const foreignBase = `http://127.0.0.1:${foreignServer.address().port}`;
let browser;

const state = page => page.evaluate(() => window.__oauthFixture.state());
const transfers = value => value.calls.filter(call => call.method === 'signUp.create' && call.params?.transfer);

async function newCase(scenario = 'new') {
  const context = await browser.newContext({viewport: {width: 1050, height: 800}, serviceWorkers: 'block'});
  const errors = [];
  const externalRequests = [];
  context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  await context.route('**/*', route => {
    const url = route.request().url();
    if ([base, foreignBase].includes(new URL(url).origin)) return route.continue();
    externalRequests.push(url);
    return route.abort();
  });
  const page = await context.newPage();
  page.setDefaultTimeout(10_000);
  await page.goto(`${base}/article/?case=${scenario}#comments`);
  await page.getByRole('button', {name: '登录 / 注册', exact: true}).waitFor();
  await page.evaluate(() => scrollTo(0, 1120));
  await page.getByRole('button', {name: '登录 / 注册', exact: true}).click();
  await page.getByRole('dialog', {name: 'Clerk 登录'}).waitFor();
  const before = await page.evaluate(() => ({href: location.href, scrollY, documentId: window.__fixtureDocumentId}));
  const navigations = [];
  const documentRequests = [];
  page.on('framenavigated', frame => { if (frame === page.mainFrame()) navigations.push(frame.url()); });
  page.on('request', request => {
    if (request.isNavigationRequest() && request.frame() === page.mainFrame()) documentRequests.push(request.url());
  });
  return {context, page, before, navigations, documentRequests, errors, externalRequests};
}

async function openPopup(testCase) {
  const popupPromise = testCase.page.waitForEvent('popup');
  await testCase.page.getByRole('button', {name: '使用 GitHub 继续', exact: true}).click();
  const popup = await popupPromise;
  popup.setDefaultTimeout(10_000);
  await popup.getByRole('button', {name: '授权 GitHub', exact: true}).waitFor();
  const callback = new URL(popup.url()).searchParams.get('callback');
  assert.equal(new URL(callback).origin, base);
  assert.equal(new URL(callback).pathname, '/sso-callback/');
  assert.ok(new URL(callback).searchParams.get('clerk_popup_state'), 'Every popup has a correlation nonce');
  const create = (await state(testCase.page)).calls.findLast(call => call.method === 'signIn.create');
  assert.equal(create.params.redirectUrl, callback);
  assert.equal(create.params.actionCompleteRedirectUrl, callback, 'OAuth completion must return inside the popup');
  return {popup, callback};
}

async function assertParentStable(testCase, signedIn) {
  if (signedIn) await testCase.page.locator('[data-auth-state]').filter({hasText: '已登录'}).waitFor();
  const after = await testCase.page.evaluate(() => ({href: location.href, scrollY, documentId: window.__fixtureDocumentId}));
  assert.deepEqual(after, testCase.before, 'Login must retain the parent document, article URL, comments hash, and scroll');
  assert.deepEqual(testCase.navigations, [], 'The parent must not navigate, even transiently');
  assert.deepEqual(testCase.errors, [], 'No unhandled error in either browser window');
  assert.deepEqual(testCase.externalRequests, [], 'The test must not contact Clerk, OAuth providers, or other external hosts');
  if (signedIn) assert.equal(await testCase.page.getByRole('dialog', {name: 'Clerk 登录'}).count(), 0, 'Successful OAuth dismisses the original login modal');
}

try {
  browser = await chromium.launch({headless: true});

  for (const scenario of ['new', 'returning', 'missing']) {
    const testCase = await newCase(scenario);
    try {
      const {popup} = await openPopup(testCase);
      const closed = popup.waitForEvent('close');
      await popup.getByRole('button', {name: '授权 GitHub', exact: true}).click();
      if (scenario === 'missing') {
        await popup.getByRole('textbox', {name: '用户名'}).fill('public-reader');
        assert.equal(new URL(popup.url()).origin, base);
        assert.equal(new URL(popup.url()).pathname, '/sso-callback/');
        assert.equal(await testCase.page.getByRole('textbox', {name: '用户名'}).count(), 0, 'Profile completion belongs to the popup');
        await assertParentStable(testCase, false);
        await popup.getByRole('button', {name: '完成注册', exact: true}).click();
      }
      await closed;
      await assertParentStable(testCase, true);
      const result = await state(testCase.page);
      assert.equal(transfers(result).length, scenario === 'returning' ? 0 : 1, `${scenario}: one callback owner controls account transfer`);
      assert.equal(result.calls.filter(call => call.method === 'setActive' && call.pathname === '/article/').length, 1, 'The parent activates the verified session exactly once');
    } finally { await testCase.context.close(); }
  }

  const cancelled = await newCase();
  try {
    const first = await openPopup(cancelled);
    await first.popup.close();
    await assertParentStable(cancelled, false);
    const second = await openPopup(cancelled);
    assert.notEqual(new URL(first.callback).searchParams.get('clerk_popup_state'), new URL(second.callback).searchParams.get('clerk_popup_state'), 'Retry uses a fresh transaction');
    const closed = second.popup.waitForEvent('close');
    await second.popup.getByRole('button', {name: '授权 GitHub', exact: true}).click();
    await closed;
    await assertParentStable(cancelled, true);
    assert.equal(transfers(await state(cancelled.page)).length, 1, 'Cancelling before authorization must not create an account');
  } finally { await cancelled.context.close(); }

  const blocked = await newCase();
  try {
    await blocked.page.evaluate(() => { window.__fixtureBlockPopups = true; });
    await blocked.page.getByRole('button', {name: '使用 GitHub 继续', exact: true}).click();
    await blocked.page.locator('[data-fixture-error]').filter({hasText: '登录弹窗被浏览器拦截'}).waitFor();
    assert.equal((await state(blocked.page)).calls.filter(call => call.method === 'signIn.create').length, 0, 'A blocked window cannot begin OAuth');
    await assertParentStable(blocked, false);
    await blocked.page.evaluate(() => { window.__fixtureBlockPopups = false; });
    const {popup} = await openPopup(blocked);
    const closed = popup.waitForEvent('close');
    await popup.getByRole('button', {name: '授权 GitHub', exact: true}).click();
    await closed;
    await assertParentStable(blocked, true);
  } finally { await blocked.context.close(); }

  const retrySync = await newCase();
  try {
    await retrySync.page.evaluate(() => { window.__fixtureRejectReload = true; });
    const {popup} = await openPopup(retrySync);
    await popup.getByRole('button', {name: '授权 GitHub', exact: true}).click();
    await popup.getByRole('button', {name: '重试同步', exact: true}).waitFor();
    await assertParentStable(retrySync, false);
    assert.equal((await state(retrySync.page)).calls.filter(call => call.method === 'setActive' && call.pathname === '/article/').length, 0, 'Failed server refresh must not activate the parent');
    await retrySync.page.evaluate(() => { window.__fixtureRejectReload = false; });
    const closed = popup.waitForEvent('close');
    await popup.getByRole('button', {name: '重试同步', exact: true}).click();
    await closed;
    await assertParentStable(retrySync, true);
    assert.equal(transfers(await state(retrySync.page)).length, 1, 'Retrying session synchronization must not create another account');
  } finally { await retrySync.context.close(); }

  const forged = await newCase();
  try {
    const {popup, callback} = await openPopup(forged);
    const providerUrl = popup.url();
    const nonce = new URL(callback).searchParams.get('clerk_popup_state');
    const complete = {type: 'blog-clerk-oauth:complete', state: nonce, sessionId: 'sess_fixture'};
    // Correct origin and transaction, wrong WindowProxy.
    await forged.page.evaluate(message => window.postMessage(message, location.origin), complete);
    // Correct origin and WindowProxy, wrong transaction.
    await popup.evaluate(({message, origin}) => window.opener.postMessage({...message, state: 'wrong-nonce'}, origin), {message: complete, origin: base});
    // Correct WindowProxy and transaction, genuinely different local origin.
    await popup.goto(`${foreignBase}/untrusted/`);
    await popup.evaluate(({message, origin}) => window.opener.postMessage(message, origin), {message: complete, origin: base});
    // Returning to the provider also gives the queued postMessage tasks time to run.
    await popup.goto(providerUrl);
    await popup.getByRole('button', {name: '授权 GitHub', exact: true}).waitFor();
    const rejected = await state(forged.page);
    assert.equal(rejected.calls.filter(call => ['client.reload', 'setActive', 'closeSignIn', 'closeSignUp'].includes(call.method)).length, 0, 'Untrusted messages cannot synchronize a session or dismiss the modal');
    await assertParentStable(forged, false);
    const closed = popup.waitForEvent('close');
    await popup.getByRole('button', {name: '授权 GitHub', exact: true}).click();
    await closed;
    await assertParentStable(forged, true);
  } finally { await forged.context.close(); }

  const pending = await newCase();
  try {
    const {popup, callback} = await openPopup(pending);
    const nonce = new URL(callback).searchParams.get('clerk_popup_state');
    await popup.evaluate(() => {
      window.__fixtureMessages = [];
      window.addEventListener('message', event => window.__fixtureMessages.push(event.data));
    });
    for (const sessionState of [
      {sessionStatus: 'pending', currentTask: null},
      {sessionStatus: 'active', currentTask: {key: 'choose-organization'}},
    ]) {
      await pending.page.evaluate(nextSession => {
        const key = 'clerk-oauth-popup-fixture';
        const account = JSON.parse(localStorage.getItem(key));
        Object.assign(account, nextSession, {sessionId: 'sess_fixture'});
        localStorage.setItem(key, JSON.stringify(account));
      }, sessionState);
      await popup.evaluate(({state, origin}) => {
        window.__fixtureMessages = [];
        window.opener.postMessage({type: 'blog-clerk-oauth:complete', state, sessionId: 'sess_fixture'}, origin);
      }, {state: nonce, origin: base});
      await popup.waitForFunction(() => window.__fixtureMessages.some(message => message.type === 'blog-clerk-oauth:error'));
      assert.equal(await popup.evaluate(() => window.__fixtureMessages.some(message => message.type === 'blog-clerk-oauth:ack')), false, 'A pending session/task must not be acknowledged');
      assert.equal((await state(pending.page)).calls.filter(call => call.method === 'setActive').length, 0, 'A pending session/task must not be activated');
      await assertParentStable(pending, false);
      assert.equal(popup.isClosed(), false, 'The popup remains available to finish the required step');
    }
    await popup.close();
  } finally { await pending.context.close(); }

  // A direct callback without an opener must still support full-page OAuth,
  // while avoiding the previous provider-effect + callback-effect double jump.
  const fallback = await newCase('returning');
  try {
    await fallback.page.evaluate(() => {
      const key = 'clerk-oauth-popup-fixture';
      const account = JSON.parse(localStorage.getItem(key));
      account.signInStatus = 'complete';
      account.verificationStatus = 'verified';
      account.sessionId = 'sess_fixture';
      localStorage.setItem(key, JSON.stringify(account));
    });
    const expected = fallback.before.href;
    await fallback.page.goto(`${base}/sso-callback/`);
    await fallback.page.waitForURL(expected);
    await fallback.page.locator('[data-auth-state]').filter({hasText: '已登录'}).waitFor();
    // The public SDK activates the session and reloads its force callback URL
    // before exposing the session to React. Only the final article return is
    // owned by our callback; this SDK reload must never produce a home detour.
    assert.deepEqual(fallback.documentRequests, [`${base}/sso-callback/`, `${base}/sso-callback/`, expected.split('#')[0]], 'Independent callback returns to the saved article exactly once, after the SDK confirmation reload');
    assert.equal(fallback.navigations.at(-1), expected, 'The final URL retains the comment hash');
    assert.equal(transfers(await state(fallback.page)).length, 0);
    assert.deepEqual(fallback.errors, []);
    assert.deepEqual(fallback.externalRequests, []);
  } finally { await fallback.context.close(); }

  console.log('Clerk OAuth popup: new/returning users, profile completion, blocked/cancelled popup retry, synchronization retry, message authentication, pending-session rejection, preserved parent URL/hash/scroll, and single article-return fallback passed.');
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  foreignServer.closeAllConnections();
  await new Promise(resolve => foreignServer.close(resolve));
}
