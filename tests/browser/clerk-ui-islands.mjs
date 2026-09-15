import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {build} from 'esbuild';
import {chromium} from 'playwright';

// Same-page One Tap + comments + assistant islands. Clerk is a local fixture so
// Account Portal / clerk-js CDN are never contacted.
const bundle = await build({
  entryPoints: [new URL('../fixtures/clerk-ui-islands.tsx', import.meta.url).pathname],
  bundle: true, platform: 'browser', format: 'esm', write: false, jsx: 'automatic',
  define: {
    'import.meta.env.DEV': 'false',
    'import.meta.env.PUBLIC_SITE_ENV': JSON.stringify('production'),
    'import.meta.env.PUBLIC_CLERK_PUBLISHABLE_KEY': JSON.stringify('pk_live_fixture'),
  },
  plugins: [{
    name: 'clerk-ui-fixture',
    setup(build) {
      build.onResolve({filter: /^@clerk\/react$/}, () => ({path: 'clerk', namespace: 'clerk-ui-fixture'}));
      build.onLoad({filter: /.*/, namespace: 'clerk-ui-fixture'}, () => ({contents: `
        export function useAuth() { return {isLoaded: true, isSignedIn: false}; }
        export function useUser() { return {isLoaded: true, isSignedIn: false, user: null}; }
        export function useClerk() { return {}; }
        export function ClerkProvider({children, Clerk}) {
          if (Clerk && (Clerk.components == null || Clerk.onComponentsReady == null)) {
            throw new Error('Clerk was not loaded with Ui components');
          }
          window.__clerkProviders = (window.__clerkProviders || 0) + 1;
          if (Clerk) window.__clerkReused = true;
          window.__clerkPassed = [...(window.__clerkPassed || []), Boolean(Clerk)];
          return children;
        }
        export function GoogleOneTap(props) {
          window.__oneTapPrompts = [...(window.__oneTapPrompts || []), props];
          return null;
        }
      `, loader: 'js'}));
    },
  }],
});
const islands = bundle.outputFiles[0].text;
const boot = `window.__clerkProviders = 0;
window.__clerkReused = false;
window.__clerkPassed = [];
window.__oneTapPrompts = [];
const {mountOneTap, mountComments, mountAssistant} = await import('/islands.js');
mountOneTap(document.getElementById('one-tap'));
await new Promise(resolve => setTimeout(resolve, 80));
mountComments(document.getElementById('comments'));
await new Promise(resolve => setTimeout(resolve, 160));
mountAssistant(document.querySelector('[data-chat-launcher-face]'), document.querySelector('[data-chat-launcher]'));
window.__islandsReady = true;`;
const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"></head><body>
  <div id="one-tap"></div>
  <section id="comments"></section>
  <button type="button" data-chat-launcher aria-label="打开博客助手"></button>
  <span data-chat-launcher-face></span>
  <script type="module" src="/boot.js"></script>
</body></html>`;

let islandDelayMs = 0;
const server = createServer((request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  if (request.url === '/boot.js') {
    response.setHeader('Content-Type', 'text/javascript');
    response.end(boot);
    return;
  }
  if (request.url === '/islands.js') {
    const send = () => {
      response.setHeader('Content-Type', 'text/javascript');
      response.end(islands);
    };
    if (islandDelayMs) setTimeout(send, islandDelayMs);
    else send();
    return;
  }
  response.setHeader('Content-Type', 'text/html');
  response.end(html);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;

async function openPage(browser, mode) {
  const page = await browser.newPage({viewport: {width: 1016, height: 800}});
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
  await page.addInitScript(kind => {
    window.Clerk = kind === 'ui'
      ? {load() {}, onComponentsReady: Promise.resolve(), components: {mount() {}}}
      : {load() {}};
  }, mode);
  await page.goto(base);
  await page.waitForFunction(() => (
    window.__islandsReady === true
    && window.__clerkProviders === 3
    && Boolean(document.querySelector('[data-island="comments"]'))
  ));
  return {page, errors};
}

let browser;
try {
  browser = await chromium.launch({headless: true});

  islandDelayMs = 240;
  const {page, errors} = await openPage(browser, 'headless');
  assert.deepEqual(errors, [], errors.join('\n'));
  assert.equal(await page.evaluate(() => window.__clerkProviders), 3, 'One Tap, comments and assistant each mount a ClerkProvider');
  assert.equal(await page.evaluate(() => window.__clerkReused), false, 'A {load}-only window.Clerk must not be passed as ClerkProvider Clerk');
  assert.deepEqual(await page.evaluate(() => window.__clerkPassed), [false, false, false]);
  assert.equal(await page.locator('[data-island="comments"]').textContent(), 'comments');
  assert.equal((await page.evaluate(() => window.__oneTapPrompts)).length, 1, 'One Tap still mounts after a headless window.Clerk stub');
  await page.close();

  islandDelayMs = 0;
  const reused = await openPage(browser, 'ui');
  assert.deepEqual(reused.errors, [], reused.errors.join('\n'));
  assert.equal(await reused.page.evaluate(() => window.__clerkProviders), 3);
  assert.equal(await reused.page.evaluate(() => window.__clerkReused), true, 'A UI-ready window.Clerk can be reused across islands');
  assert.deepEqual(await reused.page.evaluate(() => window.__clerkPassed), [true, true, true]);
  await reused.page.close();

  console.log('Clerk UI islands: headless window.Clerk is not passed; UI-ready Clerk is reused; One Tap + comments + assistant still mount under delayed chunks.');
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
