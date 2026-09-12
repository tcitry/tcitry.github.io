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
                export function ClerkProvider({children}) {
                  globalThis.__oneTapFixture.providers++;
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

function renderPrompt(Component, auth, clerk = {}) {
  const previousWindow = globalThis.window;
  const session = memoryStorage();
  const fixture = {auth, clerk, providers: 0, prompts: [], session};
  globalThis.window = {
    location: {href: currentPage, origin},
    sessionStorage: session,
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
  assert.equal(result.session.getItem('blog-clerk-return-url'), currentPage);
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

test('One Tap treats transferable and external_account_not_found sign-ins as first-time sign-up', async () => {
  const {googleOneTapNeedsSignUp, transferGoogleOneTapIfNeeded} = await importBundle(
    new URL('../src/components/auth/clerk-signin.ts', import.meta.url),
  );

  assert.equal(googleOneTapNeedsSignUp({status: 'complete', identifier: 'user@example.test'}), false);
  assert.equal(googleOneTapNeedsSignUp({status: 'missing_requirements', missingFields: []}), false);
  assert.equal(googleOneTapNeedsSignUp({
    status: 'needs_second_factor',
    identifier: 'user@example.test',
    firstFactorVerification: {status: 'verified', error: null},
  }), false);

  const transferable = {
    status: 'needs_identifier',
    identifier: null,
    firstFactorVerification: {status: 'transferable', error: {code: 'external_account_not_found'}},
  };
  const failed = {
    status: 'needs_identifier',
    identifier: null,
    firstFactorVerification: {status: 'failed', error: {code: 'external_account_not_found'}},
  };
  assert.equal(googleOneTapNeedsSignUp(transferable), true);
  assert.equal(googleOneTapNeedsSignUp(failed), true);

  const created = [];
  const clerk = {
    authenticateWithGoogleOneTap: async () => transferable,
    handleGoogleOneTapCallback: async () => {},
    client: {
      signUp: {
        create: async (params) => {
          created.push(params);
          return {status: 'complete', missingFields: []};
        },
      },
    },
  };
  const transferred = await transferGoogleOneTapIfNeeded(clerk, transferable, 'google-token');
  assert.deepEqual(created, [{strategy: 'google_one_tap', token: 'google-token'}]);
  assert.equal(transferred.status, 'complete');

  created.length = 0;
  clerk.client.signUp.create = async (params) => {
    created.push(params);
    if (params.strategy) throw new Error('one-tap strategy unavailable');
    return {status: 'complete', missingFields: []};
  };
  await transferGoogleOneTapIfNeeded(clerk, failed, 'google-token');
  assert.deepEqual(created, [
    {strategy: 'google_one_tap', token: 'google-token'},
    {transfer: true},
  ]);
});

test('installing One Tap sign-in-or-up transfers new Google users and keeps returning sessions', async () => {
  const {installGoogleOneTapSignInOrUp, clerkReturnUrlStorageKey} = await importBundle(
    new URL('../src/components/auth/clerk-signin.ts', import.meta.url),
  );
  const previousWindow = globalThis.window;
  const session = memoryStorage();
  globalThis.window = {location: {href: currentPage, origin}, sessionStorage: session};

  try {
    const completeSignIn = {status: 'complete', identifier: 'user@example.test', createdSessionId: 'sess_1'};
    const newUserSignIn = {
      status: 'needs_identifier',
      identifier: null,
      firstFactorVerification: {status: 'failed', error: {code: 'external_account_not_found'}},
    };
    const created = [];
    const callbacks = [];
    const clerk = {
      authenticateWithGoogleOneTap: async ({token}) => token === 'new' ? newUserSignIn : completeSignIn,
      handleGoogleOneTapCallback: async (signInOrUp, params) => {
        callbacks.push({signInOrUp, params});
        return 'handled';
      },
      client: {
        signUp: {
          create: async (params) => {
            created.push(params);
            return {status: 'complete', missingFields: []};
          },
        },
      },
    };

    installGoogleOneTapSignInOrUp(clerk);
    installGoogleOneTapSignInOrUp(clerk);

    const returning = await clerk.authenticateWithGoogleOneTap({token: 'returning'});
    assert.equal(returning, completeSignIn);
    assert.equal(session.getItem(clerkReturnUrlStorageKey), currentPage);
    await clerk.handleGoogleOneTapCallback(returning, {signInForceRedirectUrl: currentPage});
    assert.deepEqual(created, []);
    assert.deepEqual(callbacks, [{
      signInOrUp: completeSignIn,
      params: {signInForceRedirectUrl: currentPage, transferable: true},
    }]);

    callbacks.length = 0;
    const transferred = await clerk.authenticateWithGoogleOneTap({token: 'new'});
    assert.deepEqual(created, [{strategy: 'google_one_tap', token: 'new'}]);
    assert.equal(transferred.status, 'complete');
    await clerk.handleGoogleOneTapCallback(newUserSignIn, {signUpForceRedirectUrl: currentPage});
    assert.equal(callbacks[0].params.transferable, true);
    assert.equal(callbacks[0].params.continuation, 'transfer_to_sign_up');

    const nestedCreated = [];
    const nested = {
      authenticateWithGoogleOneTap: async () => newUserSignIn,
      handleGoogleOneTapCallback: async () => {},
      client: {
        signUp: {
          create: async (params) => {
            nestedCreated.push(params);
            return {status: 'complete', missingFields: []};
          },
        },
      },
    };
    installGoogleOneTapSignInOrUp({clerkjs: nested});
    await nested.authenticateWithGoogleOneTap({token: 'nested'});
    assert.deepEqual(nestedCreated, [{strategy: 'google_one_tap', token: 'nested'}]);
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test('production One Tap prompt uses shared return URL and sign-in-or-up helpers', async () => {
  const source = await readFile(new URL('../src/components/auth/GoogleOneTapPrompt.tsx', import.meta.url), 'utf8');
  assert.match(source, /\{...googleOneTapRedirect\(\)\}/);
  assert.match(source, /installGoogleOneTapSignInOrUp\(clerk\)/);
  assert.match(source, /rememberClerkReturnUrl\(\)/);
  assert.doesNotMatch(source, /signInForceRedirectUrl=\{currentPage\}/);
  assert.doesNotMatch(source, /\/sign-in/);
});
