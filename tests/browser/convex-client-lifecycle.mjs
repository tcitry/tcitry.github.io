import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {build} from 'esbuild';
import {chromium} from 'playwright';

const originalHook = `import {useEffect, useState} from 'react'; import {ConvexReactClient} from 'convex/react';
export default function useSessionConvexClient(url) {const [client] = useState(() => new ConvexReactClient(url)); useEffect(() => () => {void client.close();}, [client]); return client;}`;
async function bundle(negative = false) {
  return (await build({
    entryPoints: [new URL('../fixtures/convex-client-lifecycle.tsx', import.meta.url).pathname],
    bundle: true, platform: 'browser', format: 'esm', write: false, jsx: 'automatic',
    define: {'process.env.NODE_ENV': '"development"'},
    plugins: negative ? [{name: 'original-close-order', setup(build) {build.onLoad({filter: /useSessionConvexClient\.ts$/}, () => ({contents: originalHook, loader: 'tsx'}));}}] : [],
  })).outputFiles[0].text;
}
const [fixed, broken] = await Promise.all([bundle(), bundle(true)]);
const server = createServer((request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  if (request.url === '/fixed.js' || request.url === '/broken.js') {response.setHeader('Content-Type', 'text/javascript'); response.end(request.url === '/fixed.js' ? fixed : broken);}
  else {response.setHeader('Content-Type', 'text/html'); response.end(`<!doctype html><html><body><div id="root"></div><script type="module" src="/${request.url?.startsWith('/negative') ? 'broken' : 'fixed'}.js"></script></body></html>`);}
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
let browser;
const eventsFor = (state, client) => state.events.filter(event => event.client === client).map(event => event.type);
try {
  browser = await chromium.launch({headless: true});
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
  await page.goto(base);
  await page.waitForFunction(() => window.lifecycleFixture);
  let state = await page.evaluate(() => window.lifecycleFixture.render('alice:session-a', false));
  const first = state.current;
  state = await page.evaluate(() => window.lifecycleFixture.unmount());
  assert.deepEqual(eventsFor(state, first), ['setAuth', 'subscribe', 'unsubscribe', 'clearAuth', 'close'], 'Real child subscriptions and Clerk clearAuth complete before parent closes the client');

  state = await page.evaluate(() => window.lifecycleFixture.render('alice:session-a', true));
  const strictClient = state.current;
  assert.ok(eventsFor(state, strictClient).filter(type => type === 'setAuth').length >= 2, 'React development StrictMode really replays effects');
  assert.equal(eventsFor(state, strictClient).includes('close'), false, 'StrictMode cleanup does not close the reused client');
  state = await page.evaluate(() => window.lifecycleFixture.seed('Alice private cached data'));
  assert.equal(state.cached, 'Alice private cached data');
  state = await page.evaluate(() => window.lifecycleFixture.render('bob:session-b', true));
  const bob = state.current;
  assert.notEqual(bob, strictClient);
  assert.equal(state.cached, null, 'A new account starts with an empty real Convex query cache');
  assert.equal(eventsFor(state, strictClient).filter(type => type === 'close').length, 1);
  assert.equal(eventsFor(state, bob).includes('close'), false);
  state = await page.evaluate(() => window.lifecycleFixture.seed('Bob private cached data'));
  assert.equal(state.cached, 'Bob private cached data');
  state = await page.evaluate(() => window.lifecycleFixture.render('bob:session-b-new', true));
  assert.notEqual(state.current, bob);
  assert.equal(state.cached, null, 'A replacement session for the same account also gets an empty cache');
  assert.equal(eventsFor(state, bob).filter(type => type === 'close').length, 1);
  const last = state.current;
  state = await page.evaluate(() => window.lifecycleFixture.unmount());
  assert.equal(eventsFor(state, last).at(-1), 'close');
  assert.equal(eventsFor(state, last).filter(type => type === 'close').length, 1);
  assert.deepEqual(errors, []);

  const negative = await browser.newPage();
  await negative.goto(`${base}/negative`);
  await negative.waitForFunction(() => window.lifecycleFixture);
  await negative.evaluate(() => window.lifecycleFixture.render('alice:original', false));
  const failure = await negative.evaluate(async () => {try {await window.lifecycleFixture.unmount(); return null;} catch (error) {return error.message;}});
  assert.match(failure ?? '', /ConvexReactClient has already been closed/, 'The old synchronous cleanup reproduces the actual production SDK failure');
  console.log('Convex lifecycle: real SDK cleanup ordering, StrictMode replay, account/session cache isolation and failing original implementation passed.');
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
