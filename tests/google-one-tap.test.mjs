import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {build} from 'esbuild';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

const currentPage = 'https://example.test/docs/article/?view=full#comments';
const origin = 'https://example.test';
const compiled = new Map();

async function importBundle(entryUrl) {
  const bundle = await build({
    entryPoints: [entryUrl.pathname],
    bundle: true, platform: 'node', format: 'esm', write: false, jsx: 'automatic',
  });
  return import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));
}

async function componentFor(siteEnvironment, publishableKey) {
  const key = `${siteEnvironment}:${publishableKey}`;
  if (!compiled.has(key)) {
    compiled.set(key, (async () => {
      const bundle = await build({
        entryPoints: [new URL('../src/components/auth/GoogleOneTapPrompt.tsx', import.meta.url).pathname],
        bundle: true, platform: 'node', format: 'esm', write: false, jsx: 'automatic',
        define: {
          'import.meta.env.PUBLIC_SITE_ENV': JSON.stringify(siteEnvironment),
          'import.meta.env.PUBLIC_CLERK_PUBLISHABLE_KEY': JSON.stringify(publishableKey),
        },
        plugins: [{
          name: 'external-react',
          setup(build) {
            build.onResolve({filter: /^react($|\/)/}, ({path}) => ({path: import.meta.resolve(path), external: true}));
          },
        }, {
          name: 'clerk-one-tap-fixture',
          setup(build) {
            build.onResolve({filter: /^@clerk\/react$/}, () => ({path: 'clerk', namespace: 'one-tap-fixture'}));
            build.onLoad({filter: /.*/, namespace: 'one-tap-fixture'}, () => ({
              contents: `
                export function useUser() { return globalThis.__oneTapFixture.auth; }
                export function useAuth() { return globalThis.__oneTapFixture.auth; }
                export function useClerk() { return globalThis.__oneTapFixture.clerk; }
                export function ClerkProvider({children, Clerk}) {
                  if (Clerk && (Clerk.components == null || Clerk.onComponentsReady == null)) {
                    throw new Error('Clerk was not loaded with Ui components');
                  }
                  globalThis.__oneTapFixture.providers++;
                  if (Clerk) globalThis.__oneTapFixture.reused = true;
                  return children;
                }
                export function GoogleOneTap(props) {
                  globalThis.__oneTapFixture.prompts.push(props);
                  return null;
                }
              `,
            }));
          },
        }],
      });
      return (await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'))).default;
    })());
  }
  return compiled.get(key);
}

function memoryStorage() {
  const values = new Map();
  return {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => { values.set(key, String(value)); },
    removeItem: key => { values.delete(key); },
  };
}

function renderPrompt(Component, auth, clerk = {}, windowClerk) {
  const previousWindow = globalThis.window;
  const session = memoryStorage();
  const fixture = {auth, clerk, providers: 0, prompts: [], session, reused: false};
  globalThis.window = {
    location: {href: currentPage, origin},
    sessionStorage: session,
    ...(windowClerk ? {Clerk: windowClerk} : {}),
  };
  globalThis.__oneTapFixture = fixture;
  try {
    renderToStaticMarkup(createElement(Component));
    return fixture;
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
    delete globalThis.__oneTapFixture;
  }
}

test('local preview, development keys and missing configuration never start One Tap', async () => {
  for (const [environment, key] of [['preview', 'pk_live_fixture'], ['production', 'pk_test_fixture'], ['production', '']]) {
    const Component = await componentFor(environment, key);
    const result = renderPrompt(Component, {isLoaded: true, isSignedIn: false});
    assert.equal(result.providers, 0);
    assert.deepEqual(result.prompts, []);
    assert.equal(result.session.getItem('blog-clerk-return-url'), null);
  }
});

test('production waits for Clerk and does not prompt authenticated accounts', async () => {
  const Component = await componentFor('production', 'pk_live_fixture');
  for (const auth of [{isLoaded: false, isSignedIn: undefined}, {isLoaded: true, isSignedIn: true}]) {
    const result = renderPrompt(Component, auth);
    assert.equal(result.providers, 1);
    assert.deepEqual(result.prompts, []);
    assert.equal(result.session.getItem('blog-clerk-return-url'), null,
      'must not persist a return URL before Clerk is loaded or while signed in');
  }
});

test('a signed-out production visitor gets one Clerk prompt returning to the current URL', async () => {
  const Component = await componentFor('production', 'pk_live_fixture');
  const result = renderPrompt(Component, {isLoaded: true, isSignedIn: false});
  assert.equal(result.providers, 1);
  assert.deepEqual(result.prompts, [{signInForceRedirectUrl: currentPage, signUpForceRedirectUrl: currentPage}]);
  assert.equal(result.session.getItem('blog-clerk-return-url'), null,
    'signed-out render must not overwrite a stored return URL if Account Portal lands on /');
});

test('production One Tap does not pass a headless window.Clerk into ClerkProvider', async () => {
  const Component = await componentFor('production', 'pk_live_fixture');
  const result = renderPrompt(Component, {isLoaded: true, isSignedIn: false}, {}, {load() {}});
  assert.equal(result.providers, 1);
  assert.equal(result.reused, false);
  assert.deepEqual(result.prompts, [{signInForceRedirectUrl: currentPage, signUpForceRedirectUrl: currentPage}]);
});

test('shared One Tap redirect options match the current page without a hosted sign-in URL', async () => {
  const {googleOneTapRedirect} = await importBundle(
    new URL('../src/components/auth/clerk-signin.ts', import.meta.url),
  );
  const previousWindow = globalThis.window;
  globalThis.window = {location: {href: currentPage, origin}, sessionStorage: memoryStorage()};
  try {
    assert.deepEqual(googleOneTapRedirect(), {
      signInForceRedirectUrl: currentPage,
      signUpForceRedirectUrl: currentPage,
    });
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test('rendering One Tap leaves native authentication and callback methods untouched', async () => {
  const Component = await componentFor('production', 'pk_live_fixture');
  const authenticate = async () => { throw new Error('The host must not start authentication during render'); };
  const callback = async () => { throw new Error('The host must not run a callback during render'); };
  const create = async () => { throw new Error('The host must not create or transfer accounts'); };
  const native = Object.freeze({
    load() {}, components: {}, onComponentsReady: Promise.resolve(),
    authenticateWithGoogleOneTap: authenticate,
    handleGoogleOneTapCallback: callback,
    client: Object.freeze({signUp: Object.freeze({create})}),
  });
  const proxy = Object.freeze({
    authenticateWithGoogleOneTap: authenticate,
    handleGoogleOneTapCallback: callback,
    client: native.client,
    clerkjs: native,
  });
  for (let render = 0; render < 2; render++) {
    const result = renderPrompt(Component, {isLoaded: true, isSignedIn: false}, proxy, native);
    assert.equal(result.reused, true);
    assert.deepEqual(result.prompts, [{signInForceRedirectUrl: currentPage, signUpForceRedirectUrl: currentPage}]);
    for (const clerk of [proxy, native]) {
      assert.equal(clerk.authenticateWithGoogleOneTap, authenticate);
      assert.equal(clerk.handleGoogleOneTapCallback, callback);
      assert.equal(clerk.client.signUp.create, create);
    }
  }
});

test('One Tap mounts the official component without account creation or authentication overrides', async () => {
  const [prompt, shared] = await Promise.all([
    readFile(new URL('../src/components/auth/GoogleOneTapPrompt.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/auth/clerk-signin.ts', import.meta.url), 'utf8'),
  ]);
  assert.match(prompt, /<GoogleOneTap \{\.\.\.googleOneTapRedirect\(\)\} \/>/);
  assert.doesNotMatch(prompt, /useClerk|installGoogleOneTapSignInOrUp|rememberClerkReturnUrl/);
  assert.doesNotMatch(prompt + shared,
    /sign(?:In|Up)\.create|transfer_to_sign_up|transferGoogleOneTap|googleOneTapNeedsSignUp|authenticateWithGoogleOneTap\s*=|handleGoogleOneTapCallback\s*=|authenticateWith(?:Popup|Redirect)\s*=/,
    'Clerk owns new-user transfer, authentication and callback handling');
  assert.doesNotMatch(prompt, /\/sign-in/);
});
