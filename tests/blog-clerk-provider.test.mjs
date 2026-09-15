import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {build} from 'esbuild';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

const bundle = await build({
  entryPoints: [new URL('../src/components/auth/BlogClerkProvider.tsx', import.meta.url).pathname],
  bundle: true, platform: 'node', format: 'esm', write: false, jsx: 'automatic',
  define: {
    'import.meta.env.PUBLIC_CLERK_PUBLISHABLE_KEY': JSON.stringify('pk_test_fixture'),
  },
  plugins: [{
    name: 'external-react',
    setup(build) {
      build.onResolve({filter: /^react($|\/)/}, ({path}) => ({path: import.meta.resolve(path), external: true}));
    },
  }, {
    name: 'clerk-fixture',
    setup(build) {
      build.onResolve({filter: /^@clerk\/react$/}, () => ({path: 'clerk', namespace: 'clerk-fixture'}));
      build.onLoad({filter: /.*/, namespace: 'clerk-fixture'}, () => ({
        contents: `
          export function ClerkProvider({children, Clerk, ...options}) {
            globalThis.__clerkProviders += 1;
            globalThis.__clerkOptions.push(options);
            if (Clerk && (Clerk.components == null || Clerk.onComponentsReady == null)) {
              throw new Error('Clerk was not loaded with Ui components');
            }
            if (Clerk) globalThis.__clerkReused = true;
            return children;
          }
        `,
      }));
    },
  }],
});
const {default: BlogClerkProvider} = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));

function uiClerk() {
  return {load() {}, onComponentsReady: Promise.resolve(), components: {}};
}

function withWindow(clerk, run, href = 'https://example.test/docs/') {
  const previousWindow = globalThis.window;
  globalThis.window = {location: {href}, ...(clerk ? {Clerk: clerk} : {})};
  globalThis.__clerkProviders = 0;
  globalThis.__clerkReused = false;
  globalThis.__clerkOptions = [];
  try {
    return run();
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
    delete globalThis.__clerkProviders;
    delete globalThis.__clerkReused;
    delete globalThis.__clerkOptions;
  }
}

test('BlogClerkProvider cannot prerender: it reads window during render', () => {
  const previousWindow = globalThis.window;
  delete globalThis.window;
  try {
    assert.throws(
      () => renderToStaticMarkup(createElement(BlogClerkProvider, null, createElement('span', null, 'ok'))),
      error => error instanceof ReferenceError && /window is not defined/.test(error.message),
    );
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test('nested BlogClerkProvider does not mount a second ClerkProvider', () => {
  withWindow(undefined, () => {
    const html = renderToStaticMarkup(createElement(BlogClerkProvider, null, createElement(BlogClerkProvider, null, createElement('span', null, 'ok'))));
    assert.match(html, /ok/);
    assert.equal(globalThis.__clerkProviders, 1);
  });
});

test('a window.Clerk with UI components is reused instead of loading clerk-js twice', () => {
  withWindow(uiClerk(), () => {
    renderToStaticMarkup(createElement(BlogClerkProvider, null, createElement('span', null, 'ok')));
    assert.equal(globalThis.__clerkProviders, 1);
    assert.equal(globalThis.__clerkReused, true);
  });
});

test('window.Clerk with only load is not passed to ClerkProvider', () => {
  withWindow({load() {}}, () => {
    renderToStaticMarkup(createElement(BlogClerkProvider, null, createElement('span', null, 'ok')));
    assert.equal(globalThis.__clerkProviders, 1);
    assert.equal(globalThis.__clerkReused, false);
  });
});

test('window.Clerk without load is not passed to ClerkProvider', () => {
  withWindow({version: 'fixture'}, () => {
    renderToStaticMarkup(createElement(BlogClerkProvider, null, createElement('span', null, 'ok')));
    assert.equal(globalThis.__clerkProviders, 1);
    assert.equal(globalThis.__clerkReused, false);
  });
});

test('window.Clerk with load but no UI components is not passed to ClerkProvider', () => {
  withWindow({load() {}, onComponentsReady: Promise.resolve()}, () => {
    renderToStaticMarkup(createElement(BlogClerkProvider, null, createElement('span', null, 'ok')));
    assert.equal(globalThis.__clerkProviders, 1);
    assert.equal(globalThis.__clerkReused, false);
  });
});

test('separate comment, One Tap and assistant trees do not reuse a headless window.Clerk', () => {
  withWindow({load() {}}, () => {
    for (const label of ['one-tap', 'comments', 'assistant']) {
      renderToStaticMarkup(createElement(BlogClerkProvider, null, createElement('span', null, label)));
    }
    assert.equal(globalThis.__clerkProviders, 3);
    assert.equal(globalThis.__clerkReused, false);
  });
});

test('provider configures one native combined sign-in root and retains the article hash', () => {
  const href = 'https://example.test/docs/article/?view=full#comments';
  const clerk = uiClerk();
  const nativePopup = async () => {};
  clerk.client = {signIn: {authenticateWithPopup: nativePopup}, signUp: {authenticateWithPopup: nativePopup}};
  withWindow(clerk, () => {
    renderToStaticMarkup(createElement(BlogClerkProvider, null, createElement('span', null, 'ok')));
    const [options] = globalThis.__clerkOptions;
    assert.equal(options.signInUrl, '/sso-callback/');
    assert.equal(Object.hasOwn(options, 'signUpUrl'), false, 'A separate sign-up URL would split the native combined flow');
    assert.equal(options.signInFallbackRedirectUrl, href);
    assert.equal(options.signUpFallbackRedirectUrl, href);
    assert.equal(options.afterSignOutUrl, href);
    assert.equal(clerk.client.signIn.authenticateWithPopup, nativePopup);
    assert.equal(clerk.client.signUp.authenticateWithPopup, nativePopup);
  }, href);
});

test('provider callback fallback points home instead of restarting sign-in', () => {
  for (const href of [
    'https://example.test/sso-callback',
    'https://example.test/sso-callback/?intent=signIn#/create/sso-callback',
  ]) {
    withWindow(undefined, () => {
      renderToStaticMarkup(createElement(BlogClerkProvider, null, createElement('span', null, 'ok')));
      const [options] = globalThis.__clerkOptions;
      assert.equal(options.signInFallbackRedirectUrl, '/');
      assert.equal(options.signUpFallbackRedirectUrl, '/');
    }, href);
  }
});

test('BlogClerkProvider types reused window.Clerk as ClerkProvider Clerk prop', async () => {
  const provider = await readFile(new URL('../src/components/auth/BlogClerkProvider.tsx', import.meta.url), 'utf8');
  const types = await readFile(new URL('../src/components/auth/blog-clerk-provider.types.ts', import.meta.url), 'utf8');
  assert.match(provider, /import \{ClerkProvider\} from '@clerk\/react'/);
  assert.match(provider, /import type \{BrowserClerk, ClerkProp\} from '@clerk\/react'/);
  assert.match(provider, /value is BrowserClerk/);
  assert.match(provider, /loadedClerkInstance\(\): ClerkProp/);
  assert.match(provider, /clerk\.onComponentsReady != null/);
  assert.match(provider, /clerk\.components != null/);
  assert.doesNotMatch(provider, /HeadlessBrowserClerk/);
  assert.doesNotMatch(provider, /Clerk\?: \{load\?: unknown\}/);
  assert.match(types, /@ts-expect-error incomplete window\.Clerk is not assignable to ClerkProvider's Clerk prop/);
  assert.match(types, /rejectedWeakClerk: ClerkProp = weakClerk/);
  assert.match(types, /acceptedUiClerk: ClerkProp = uiClerk/);
  assert.doesNotMatch(provider, /useEffect|watchClerkAuthSession|authenticateWithPopup/);
});
