import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {chromium} from 'playwright';

const bundle = await build({
  stdin: {
    resolveDir: fileURLToPath(new URL('../..', import.meta.url)),
    contents: `
      import {clerkRouterPush, clerkRouterReplace} from './src/components/auth/clerk-navigation.ts';
      import {windowNavigate} from '@clerk/shared/internal/clerk-js/windowNavigate';
      const documentId = crypto.randomUUID();
      for (const event of ['beforeunload', 'pagehide', 'clerk:beforeunload']) {
        addEventListener(event, () => {
          const key = 'navigation-test:' + event;
          sessionStorage.setItem(key, Number(sessionStorage.getItem(key) || 0) + 1);
        });
      }
      window.navigationFixture = {
        clerkRouterPush, clerkRouterReplace, windowNavigate,
        navigate: (method, to) => ({clerkRouterPush, clerkRouterReplace})[method](to, {
          windowNavigate: destination => {
            const key = 'navigation-test:delegations';
            sessionStorage.setItem(key, Number(sessionStorage.getItem(key) || 0) + 1);
            windowNavigate(destination);
          },
        }),
        state: () => ({
          documentId, href: location.href, historyLength: history.length,
          unloads: Number(sessionStorage.getItem('navigation-test:beforeunload') || 0),
          pageHides: Number(sessionStorage.getItem('navigation-test:pagehide') || 0),
          clerkUnloads: Number(sessionStorage.getItem('navigation-test:clerk:beforeunload') || 0),
          delegations: Number(sessionStorage.getItem('navigation-test:delegations') || 0),
        }),
      };
    `,
  },
  bundle: true, platform: 'browser', format: 'esm', write: false,
});
const script = bundle.outputFiles[0].text;
const server = createServer((request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  if (request.url === '/fixture.js') {
    response.setHeader('Content-Type', 'text/javascript'); response.end(script);
  } else {
    response.setHeader('Content-Type', 'text/html');
    response.end('<!doctype html><html><body><main id="comments">Comments</main><div id="replies">Replies</div><div id="details">Details</div><script type="module" src="/fixture.js"></script></body></html>');
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const article = `${base}/article/?source=login&next=a%2Fb#comments`;
const errors = [];
let browser;
const state = page => page.evaluate(() => window.navigationFixture.state());
const settle = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
try {
  browser = await chromium.launch({headless: true});
  async function openArticle() {
    const page = await browser.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
    await page.goto(article);
    await page.waitForFunction(() => window.navigationFixture);
    return page;
  }

  const same = await openArticle();
  const initial = await state(same);
  for (const method of ['clerkRouterPush', 'clerkRouterReplace']) {
    for (const to of [article, '/article/?source=login&next=a%2Fb#comments', '../article/?source=login&next=a%2Fb#comments', '#comments']) {
      await same.evaluate(({method, to}) => window.navigationFixture.navigate(method, to), {method, to});
      await settle(same);
      assert.deepEqual(await state(same), initial, `${method} preserves the current document, query, hash and history for ${to}`);
    }
  }
  await same.evaluate(() => window.navigationFixture.windowNavigate(location.href));
  await settle(same);
  const upstream = await state(same);
  assert.deepEqual(upstream, {...initial, clerkUnloads: 1}, 'The installed Clerk default emits a synthetic unload for the same hash URL without unloading the document');
  await same.close();

  const hashes = await openArticle();
  const beforeHash = await state(hashes);
  await hashes.evaluate(() => window.navigationFixture.navigate('clerkRouterPush', '#replies'));
  await hashes.waitForURL(article.replace('#comments', '#replies'));
  await settle(hashes);
  assert.deepEqual(await state(hashes), {...beforeHash, href: article.replace('#comments', '#replies'), historyLength: beforeHash.historyLength + 1}, 'Hash push preserves the document and query while adding a history entry');
  await hashes.evaluate(() => window.navigationFixture.navigate('clerkRouterReplace', '#details'));
  await hashes.waitForURL(article.replace('#comments', '#details'));
  await settle(hashes);
  assert.deepEqual(await state(hashes), {...beforeHash, href: article.replace('#comments', '#details'), historyLength: beforeHash.historyLength + 1}, 'Hash replace preserves the document and replaces the current history entry');
  await hashes.goBack();
  assert.equal(hashes.url(), article, 'Back skips the replaced hash entry');
  await hashes.goForward();
  assert.equal(hashes.url(), article.replace('#comments', '#details'));
  await hashes.close();

  const pages = await openArticle();
  const beforePage = await state(pages);
  await pages.evaluate(() => window.navigationFixture.clerkRouterPush('../other/?from=comments#replies'));
  await pages.waitForURL(`${base}/other/?from=comments#replies`);
  await pages.waitForFunction(id => window.navigationFixture && window.navigationFixture.state().documentId !== id, beforePage.documentId);
  const pushed = await state(pages);
  assert.notEqual(pushed.documentId, beforePage.documentId, 'Cross-page push loads a real new document');
  assert.deepEqual(pushed, {...beforePage, documentId: pushed.documentId, href: `${base}/other/?from=comments#replies`, historyLength: beforePage.historyLength + 1, unloads: 1, pageHides: 1});
  await pages.evaluate(to => window.navigationFixture.clerkRouterReplace(to), `${base}/final/?from=portal#comments`);
  await pages.waitForURL(`${base}/final/?from=portal#comments`);
  await pages.waitForFunction(id => window.navigationFixture && window.navigationFixture.state().documentId !== id, pushed.documentId);
  const replaced = await state(pages);
  assert.notEqual(replaced.documentId, pushed.documentId, 'Cross-page replace loads a real new document');
  assert.deepEqual(replaced, {...pushed, documentId: replaced.documentId, href: `${base}/final/?from=portal#comments`, unloads: 2, pageHides: 2});
  await pages.goBack();
  assert.equal(pages.url(), article, 'Cross-page replace removes the intermediate page from Back history');
  await pages.close();

  for (const method of ['clerkRouterPush', 'clerkRouterReplace']) {
    for (const to of ['/other/?from=metadata#comments', '?source=returned&next=a%2Fb#comments']) {
      const delegated = await openArticle();
      const before = await state(delegated);
      const destination = new URL(to, article).href;
      await delegated.evaluate(({method, to}) => window.navigationFixture.navigate(method, to), {method, to});
      await delegated.waitForURL(destination);
      await delegated.waitForFunction(id => window.navigationFixture && window.navigationFixture.state().documentId !== id, before.documentId);
      const after = await state(delegated);
      assert.notEqual(after.documentId, before.documentId, `${method} delegates path/query changes that load a new document`);
      assert.equal(after.href, destination);
      assert.equal(after.delegations, 1, 'The SDK-provided navigator handles cross-document navigation');
      assert.equal(after.clerkUnloads, 1, 'Cross-document navigation retains the SDK unload signal');
      assert.equal(after.unloads, 1);
      assert.equal(after.pageHides, 1);
      await delegated.close();
    }
  }
  assert.deepEqual(errors, []);
  console.log('Clerk navigation: same-URL no-op, query/hash preservation, push/replace history, SDK delegation, real page unloads and upstream synthetic-unload reproduction passed.');
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
