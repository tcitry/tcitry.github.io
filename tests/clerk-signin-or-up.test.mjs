import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {build} from 'esbuild';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

const currentPage = 'https://example.test/docs/article/?view=full#comments';
const currentPageWithoutHash = 'https://example.test/docs/article/?view=full';
const origin = 'https://example.test';
const expectedRedirect = {
  forceRedirectUrl: currentPageWithoutHash,
  signUpForceRedirectUrl: currentPageWithoutHash,
  withSignUp: true,
  oauthFlow: 'popup',
};

async function importBundle(entryUrl, plugins = [], define = {}) {
  const bundle = await build({
    entryPoints: [entryUrl.pathname],
    bundle: true, platform: 'node', format: 'esm', write: false, jsx: 'automatic',
    define,
    plugins: [...plugins, {
      name: 'css-stub',
      setup(plugin) {
        plugin.onLoad({filter: /\.css$/}, () => ({contents: 'export default {};', loader: 'js'}));
      },
    }, {
      name: 'external-react',
      setup(plugin) {
        plugin.onResolve({filter: /^react($|\/)/}, ({path}) => ({path: import.meta.resolve(path), external: true}));
      },
    }],
  });
  return import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));
}

function memoryStorage() {
  const values = new Map();
  return {
    values,
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => { values.set(key, String(value)); },
    removeItem: key => { values.delete(key); },
  };
}

function withPage(run, href = currentPage) {
  const previousWindow = globalThis.window;
  const session = memoryStorage();
  globalThis.window = {
    location: {href, origin: new URL(href).origin},
    sessionStorage: session,
  };
  const restore = () => {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  };
  try {
    const result = run(session);
    if (result && typeof result.then === 'function') return result.finally(restore);
    restore();
    return result;
  } catch (error) {
    restore();
    throw error;
  }
}

test('shared Clerk sign-in options opt into sign-in-or-up and keep OAuth transferable', async () => {
  const {panelClerkRedirect, openClerkSignIn, clerkReturnUrlStorageKey} = await importBundle(
    new URL('../src/components/auth/clerk-signin.ts', import.meta.url),
  );
  withPage(session => {
    assert.deepEqual(panelClerkRedirect(), expectedRedirect);
    assert.equal(session.getItem(clerkReturnUrlStorageKey), null,
      'building redirect props must not persist a return URL during signed-out render');
    const opened = [];
    openClerkSignIn({openSignIn: (props) => opened.push(props)});
    assert.deepEqual(opened, [{...expectedRedirect, transferable: true}]);
    assert.equal(session.getItem(clerkReturnUrlStorageKey), currentPage);
  });
});

test('force redirect URLs drop the hash so Account Portal query strings stay intact', async () => {
  const {clerkForceRedirectUrl, panelClerkRedirect, rememberClerkReturnUrl, clerkReturnUrlStorageKey} = await importBundle(
    new URL('../src/components/auth/clerk-signin.ts', import.meta.url),
  );
  withPage(session => {
    assert.equal(clerkForceRedirectUrl(), currentPageWithoutHash);
    assert.deepEqual(panelClerkRedirect(), expectedRedirect);
    rememberClerkReturnUrl();
    assert.equal(session.getItem(clerkReturnUrlStorageKey), currentPage,
      'return URL restore still keeps the comment hash');
  });
});

test('callback CAPTCHA host remains visible when an existing container was hidden', async () => {
  const {ensureClerkCaptchaElement} = await importBundle(
    new URL('../src/components/auth/clerk-signin.ts', import.meta.url),
  );
  const body = {children: [], appendChild(node) { this.children.push(node); return node; }};
  const doc = {
    body,
    getElementById: id => body.children.find(node => node.id === id) || null,
    createElement: () => ({
      id: '', attrs: {},
      style: {removeProperty(name) { delete this[name]; }},
      removeAttribute(name) { delete this.attrs[name]; },
    }),
  };
  assert.equal(ensureClerkCaptchaElement(doc), true);
  const captcha = doc.getElementById('clerk-captcha');
  captcha.attrs.hidden = '';
  captcha.style.display = 'none';
  assert.equal(ensureClerkCaptchaElement(doc), false);
  assert.equal(captcha.attrs.hidden, undefined);
  assert.equal(captcha.style.display, undefined);
  assert.equal(body.children.length, 1);
});

test('OAuth callback URLs keep successful and incomplete attempts in the same-origin callback', async () => {
  const {clerkSsoCallbackPath, clerkSsoCallbackUrl, isClerkSsoCallbackHref, ssoCallbackHandlerProps} = await importBundle(
    new URL('../src/components/auth/clerk-signin.ts', import.meta.url),
  );
  assert.equal(clerkSsoCallbackPath, '/sso-callback/');
  withPage(() => {
    const callback = 'https://example.test/sso-callback/';
    assert.equal(clerkSsoCallbackUrl(), callback);
    assert.deepEqual(ssoCallbackHandlerProps(), {
      transferable: true,
      signInForceRedirectUrl: callback,
      signUpForceRedirectUrl: callback,
      signInUrl: `${callback}#/`,
      signUpUrl: `${callback}#/create`,
      firstFactorUrl: `${callback}#/factor-one`,
      secondFactorUrl: `${callback}#/factor-two`,
      resetPasswordUrl: `${callback}#/reset-password`,
      continueSignUpUrl: `${callback}#/create/continue`,
      verifyEmailAddressUrl: `${callback}#/create/verify-email-address`,
      verifyPhoneNumberUrl: `${callback}#/create/verify-phone-number`,
      signInProtectCheckUrl: `${callback}#/protect-check`,
      signUpProtectCheckUrl: `${callback}#/create/protect-check`,
    });
    for (const candidate of [callback, '/sso-callback', `${callback}?nonce=test#/create/continue`]) {
      assert.equal(isClerkSsoCallbackHref(candidate, {href: currentPage, origin}), true, candidate);
    }
    for (const candidate of [
      'https://evil.test/sso-callback/', '//evil.test/sso-callback/',
      'http://example.test/sso-callback/', 'https://example.test/docs/',
      'https://example.test/sso-callback/extra/', 'https://accounts.example.test/sign-in',
    ]) {
      assert.equal(isClerkSsoCallbackHref(candidate, {href: currentPage, origin}), false, candidate);
    }
  });
  withPage(() => {
    const callback = 'https://example.test/sso-callback/?clerk_popup_state=attempt-123';
    assert.equal(clerkSsoCallbackUrl(), callback);
    const props = ssoCallbackHandlerProps();
    for (const [key, value] of Object.entries(props)) {
      if (key === 'transferable') continue;
      const url = new URL(value);
      assert.equal(url.origin, origin);
      assert.equal(url.pathname, '/sso-callback/');
      assert.equal(url.searchParams.get('clerk_popup_state'), 'attempt-123', key);
      assert.equal(url.searchParams.has('untrusted'), false, key);
    }
  }, 'https://example.test/sso-callback/?clerk_popup_state=attempt-123&untrusted=ignored#/create/continue');
});

test('full-page callback fallback restores the original page once when no popup is involved', async () => {
  const {finishClerkSsoCallback, rememberClerkReturnUrl, clerkReturnUrlStorageKey} = await importBundle(
    new URL('../src/components/auth/clerk-signin.ts', import.meta.url),
  );
  const replaced = [];
  const session = memoryStorage();
  const callbackLocation = {
    href: 'https://example.test/sso-callback/?rotating_token_nonce=n',
    origin,
    replace: url => replaced.push(url),
  };
  rememberClerkReturnUrl({href: currentPage, origin}, session);
  assert.equal(finishClerkSsoCallback(callbackLocation, session), 'return');
  assert.deepEqual(replaced, [currentPage]);
  assert.equal(session.getItem(clerkReturnUrlStorageKey), null);
  replaced.length = 0;
  assert.equal(finishClerkSsoCallback(callbackLocation, memoryStorage()), 'home');
  assert.deepEqual(replaced, ['https://example.test/']);
});

test('auth watchers leave transfer and navigation to the callback owner across resource updates', async () => {
  const {watchClerkAuthSession, rememberClerkReturnUrl} = await importBundle(
    new URL('../src/components/auth/clerk-signin.ts', import.meta.url),
  );
  const transfers = [];
  const navigations = [];
  const listeners = new Set();
  const originalRedirect = async params => params;
  let signIn = {
    status: 'needs_identifier',
    firstFactorVerification: {status: 'transferable', error: {code: 'external_account_not_found'}},
    authenticateWithRedirect: originalRedirect,
  };
  const clerk = {
    client: {
      get signIn() { return signIn; },
      signUp: {create: async params => { transfers.push(params); }},
    },
    setActive: async params => { navigations.push(params); },
    openSignIn: props => { navigations.push(props); },
    addListener(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  await withPage(async session => {
    globalThis.window.location.replace = url => navigations.push(url);
    rememberClerkReturnUrl({href: 'https://example.test/another-page/', origin}, session);
    const stopSignedOut = watchClerkAuthSession(clerk, false);
    assert.notEqual(signIn.authenticateWithRedirect, originalRedirect);
    signIn = {...signIn, authenticateWithRedirect: originalRedirect};
    for (const listener of listeners) listener();
    assert.notEqual(signIn.authenticateWithRedirect, originalRedirect,
      'a newly supplied Clerk resource must receive the adapter');
    const stopSignedIn = watchClerkAuthSession(clerk, true);
    for (const listener of listeners) listener();
    await Promise.resolve();
    assert.deepEqual(transfers, [], 'watchers must never issue their own sign-up transfer');
    assert.deepEqual(navigations, [], 'watchers must not navigate or activate sessions');
    assert.equal(globalThis.window.location.href, currentPage, 'the article query and hash stay intact');
    stopSignedOut();
    stopSignedIn();
    assert.equal(listeners.size, 0);
  });
});

test('callback effects share one SDK transfer and route through the most recently mounted consumer', async () => {
  const {runClerkSsoCallback} = await importBundle(
    new URL('../src/components/auth/clerk-signin.ts', import.meta.url),
  );
  const invocations = [];
  const navigations = [];
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const clerk = {
    handleRedirectCallback: async (props, navigate) => {
      invocations.push(props);
      await gate;
      await navigate(props.continueSignUpUrl);
      return 'completed';
    },
  };
  await withPage(async () => {
    const first = runClerkSsoCallback(clerk, async url => navigations.push(['unmounted', url]));
    await Promise.resolve();
    const second = runClerkSsoCallback(clerk, async url => navigations.push(['current', url]));
    assert.equal(first, second, 'a remount must share the in-flight SDK call');
    assert.equal(invocations.length, 1);
    release();
    assert.equal(await first, 'completed');
    assert.deepEqual(navigations, [['current', 'https://example.test/sso-callback/#/create/continue']]);
    assert.equal(runClerkSsoCallback(clerk, async () => {}), first,
      'completed effects must not consume the OAuth transfer again');
    await Promise.resolve();
    assert.equal(invocations.length, 1);
  }, 'https://example.test/sso-callback/');
});

test('callback execution bypasses the React proxy and shares the raw runtime promise and errors', async () => {
  const {runClerkSsoCallback} = await importBundle(
    new URL('../src/components/auth/clerk-signin.ts', import.meta.url),
  );
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let runtimeCalls = 0;
  let proxyCalls = 0;
  const navigations = [];
  const expectedError = new Error('OAuth transfer rejected');
  const runtime = {
    async handleRedirectCallback(props, navigate) {
      runtimeCalls += 1;
      await gate;
      await navigate(props.continueSignUpUrl);
      throw expectedError;
    },
  };
  const createProxy = () => ({
    clerkjs: runtime,
    // @clerk/react 6.15.1 forwards only params, returns immediately and swallows
    // the SDK rejection. Calling this wrapper would bypass the callback UI.
    async handleRedirectCallback(params) {
      proxyCalls += 1;
      runtime.handleRedirectCallback(params).catch(() => {});
    },
  });
  await withPage(async () => {
    const first = runClerkSsoCallback(createProxy(), async url => navigations.push(['old', url]));
    let settled = false;
    void first.then(() => { settled = true; }, () => { settled = true; });
    await Promise.resolve();
    const second = runClerkSsoCallback(createProxy(), async url => navigations.push(['current', url]));
    assert.equal(second, first, 'different React proxies for one Clerk runtime share the same SDK execution');
    assert.equal(runtimeCalls, 1);
    assert.equal(proxyCalls, 0, 'the lossy React wrapper must not run');
    assert.equal(settled, false, 'the actual SDK request is still pending');
    release();
    await assert.rejects(first, error => error === expectedError);
    await assert.rejects(second, error => error === expectedError);
    assert.equal(settled, true);
    assert.deepEqual(navigations, [['current', 'https://example.test/sso-callback/#/create/continue']]);
  }, 'https://example.test/sso-callback/');
});

test('SsoCallback renders transfer status or the combined continuation UI from callback state', async () => {
  globalThis.__ssoCallbackFixture = {signIns: [], session: null, auth: {isLoaded: true, isSignedIn: false}};
  const {default: SsoCallback} = await importBundle(
    new URL('../src/components/auth/SsoCallback.tsx', import.meta.url),
    [{
      name: 'sso-callback-fixture',
      setup(build) {
        build.onResolve({filter: /^@clerk\/react$/}, () => ({path: 'clerk', namespace: 'sso-callback-fixture'}));
        build.onLoad({filter: /.*/, namespace: 'sso-callback-fixture'}, () => ({
          contents: `
            export function useAuth() { return globalThis.__ssoCallbackFixture.auth; }
            export function useSession() { return {session: globalThis.__ssoCallbackFixture.session}; }
            export function useClerk() { return {}; }
            export function ClerkProvider({children}) { return children; }
            export function ClerkLoaded({children}) { return children; }
            export function ClerkLoading() { return null; }
            export function ClerkFailed() { return null; }
            export function SignIn(props) {
              globalThis.__ssoCallbackFixture.signIns.push(props);
              return null;
            }
          `,
        }));
      },
    }],
    {'import.meta.env.PUBLIC_CLERK_PUBLISHABLE_KEY': JSON.stringify('pk_test_fixture')},
  );
  try {
    withPage(() => {
      globalThis.window.location.hash = '';
      const html = renderToStaticMarkup(createElement(SsoCallback));
      assert.match(html, /Completing sign-in…/);
      assert.match(html, /id="clerk-captcha"/);
      assert.doesNotMatch(html, /<a\b[^>]*href="\/"/, 'The callback does not offer a Home detour');
      assert.equal(globalThis.__ssoCallbackFixture.signIns.length, 0);
      globalThis.__ssoCallbackFixture.session = {id: 'sess_active', status: 'active', currentTask: null};
      const completed = renderToStaticMarkup(createElement(SsoCallback));
      assert.match(completed, /Signed in\. Returning to your page…/);
      assert.doesNotMatch(completed, /<a\b[^>]*href="\/"/);
      globalThis.window.opener = {closed: false};
      const popupCompleted = renderToStaticMarkup(createElement(SsoCallback));
      assert.match(popupCompleted, /Signed in\. This window will close automatically\./);
      assert.doesNotMatch(popupCompleted, /<a\b[^>]*href="\/"/);
    }, 'https://example.test/sso-callback/');
    withPage(() => {
      globalThis.window.location.hash = '#/create/continue';
      globalThis.__ssoCallbackFixture.session = null;
      renderToStaticMarkup(createElement(SsoCallback));
      assert.deepEqual(globalThis.__ssoCallbackFixture.signIns, [{
        routing: 'hash', withSignUp: true, oauthFlow: 'redirect',
        forceRedirectUrl: 'https://example.test/sso-callback/?clerk_popup_state=attempt-123',
        signUpForceRedirectUrl: 'https://example.test/sso-callback/?clerk_popup_state=attempt-123',
      }]);
    }, 'https://example.test/sso-callback/?clerk_popup_state=attempt-123#/create/continue');
  } finally {
    delete globalThis.__ssoCallbackFixture;
  }
});

test('return URL helper stores, reads, clears and restores only same-origin pages', async () => {
  const {
    rememberClerkReturnUrl, readClerkReturnUrl, clearClerkReturnUrl, restoreClerkReturnUrl,
    clerkReturnUrlStorageKey,
  } = await importBundle(new URL('../src/components/auth/clerk-signin.ts', import.meta.url));

  const labs = 'https://example.test/labs/?tab=demos#grid';
  const home = 'https://example.test/';
  const session = memoryStorage();
  const replaced = [];
  const location = {href: labs, origin, replace: url => replaced.push(url)};

  rememberClerkReturnUrl(location, session);
  assert.equal(readClerkReturnUrl(session), labs);
  clearClerkReturnUrl(session);
  assert.equal(readClerkReturnUrl(session), null);
  assert.equal(session.values.size, 0);

  rememberClerkReturnUrl(location, session);
  const homeLocation = {href: home, origin, replace: url => replaced.push(url)};
  assert.equal(restoreClerkReturnUrl(homeLocation, session), true);
  assert.deepEqual(replaced, [labs]);
  assert.equal(readClerkReturnUrl(session), null);

  replaced.length = 0;
  rememberClerkReturnUrl(location, session);
  assert.equal(restoreClerkReturnUrl(location, session), false, 'already on the stored page');
  assert.deepEqual(replaced, []);
  assert.equal(session.getItem(clerkReturnUrlStorageKey), null);
});

test('return URL restore rejects open redirects and blocked storage', async () => {
  const {rememberClerkReturnUrl, restoreClerkReturnUrl, clerkReturnUrlStorageKey} = await importBundle(
    new URL('../src/components/auth/clerk-signin.ts', import.meta.url),
  );
  const replaced = [];
  const home = {href: 'https://example.test/', origin, replace: url => replaced.push(url)};

  const foreign = memoryStorage();
  foreign.setItem(clerkReturnUrlStorageKey, 'https://evil.test/phish');
  assert.equal(restoreClerkReturnUrl(home, foreign), false);

  const relative = memoryStorage();
  relative.setItem(clerkReturnUrlStorageKey, '/labs/?tab=demos#grid');
  assert.equal(restoreClerkReturnUrl(home, relative), true);
  assert.deepEqual(replaced, ['https://example.test/labs/?tab=demos#grid']);

  for (const candidate of [
    'https://example.test.evil.test/labs/',
    'https://evil.test/labs/',
    '//evil.test/labs/',
    'javascript:alert(1)',
    'data:text/html,phish',
    'https://user:pass@example.test/labs/',
    'https://example.test@evil.test/labs/',
    'http://example.test/labs/',
    `https://example.test/${'a'.repeat(3000)}`,
    'https://example.test/labs/\nhttps://evil.test/',
    '',
    'not a url',
  ]) {
    const session = memoryStorage();
    session.setItem(clerkReturnUrlStorageKey, candidate);
    replaced.length = 0;
    assert.equal(restoreClerkReturnUrl(home, session), false, candidate);
    assert.deepEqual(replaced, []);
    assert.equal(session.getItem(clerkReturnUrlStorageKey), null, 'invalid values must be cleared');
  }

  const blocked = {
    getItem() { throw new Error('blocked'); },
    setItem() { throw new Error('blocked'); },
    removeItem() { throw new Error('blocked'); },
  };
  assert.doesNotThrow(() => rememberClerkReturnUrl(home, blocked));
  assert.doesNotThrow(() => restoreClerkReturnUrl(home, blocked));
});

test('rememberClerkReturnUrl ignores click events that lack a page href', async () => {
  const {rememberClerkReturnUrl, clerkReturnUrlStorageKey} = await importBundle(
    new URL('../src/components/auth/clerk-signin.ts', import.meta.url),
  );
  withPage(session => {
    rememberClerkReturnUrl({type: 'click', currentTarget: {}, preventDefault() {}});
    assert.equal(session.getItem(clerkReturnUrlStorageKey), null,
      'capture events must not be treated as a return URL location');
    rememberClerkReturnUrl();
    assert.equal(session.getItem(clerkReturnUrlStorageKey), currentPage);
  });
});

test('ClerkSignInButton capture handlers persist window.location instead of the event', async () => {
  globalThis.__clerkSignInSpans = [];
  const {default: ClerkSignInButton} = await importBundle(
    new URL('../src/components/auth/ClerkSignInButton.tsx', import.meta.url),
    [{
      name: 'clerk-signin-button-fixture',
      setup(build) {
        build.onResolve({filter: /^@clerk\/react$/}, () => ({path: 'clerk', namespace: 'signin-button-fixture'}));
        build.onLoad({filter: /.*/, namespace: 'signin-button-fixture'}, () => ({
          contents: `
            export function SignInButton(props) {
              return props.children ?? null;
            }
          `,
        }));
      },
    }, {
      name: 'capture-jsx',
      setup(plugin) {
        plugin.onResolve({filter: /^react\/jsx-runtime$/}, () => ({path: 'jsx', namespace: 'capture-jsx'}));
        plugin.onLoad({filter: /.*/, namespace: 'capture-jsx'}, () => ({
          contents: `
            import {createElement, Fragment} from 'react';
            export {Fragment};
            export function jsx(type, props, key) {
              if (type === 'span' && props?.onClickCapture) {
                globalThis.__clerkSignInSpans.push(props);
              }
              return createElement(type, key == null ? props : {...props, key});
            }
            export const jsxs = jsx;
          `,
        }));
      },
    }],
  );
  withPage(session => {
    renderToStaticMarkup(createElement(ClerkSignInButton, null, '登录 / 注册'));
    assert.equal(globalThis.__clerkSignInSpans.length, 1);
    const props = globalThis.__clerkSignInSpans[0];
    const event = {type: 'click', currentTarget: {}, preventDefault() {}};
    props.onClickCapture(event);
    assert.equal(session.getItem('blog-clerk-return-url'), currentPage);
    session.removeItem('blog-clerk-return-url');
    props.onPointerDownCapture(event);
    assert.equal(session.getItem('blog-clerk-return-url'), currentPage);
  });
  delete globalThis.__clerkSignInSpans;
});

test('SignInPanel modal entry spreads the shared sign-in-or-up options', async () => {
  globalThis.__clerkSignInFixture = {buttons: []};
  const {default: SignInPanel} = await importBundle(
    new URL('../src/components/auth/SignInPanel.tsx', import.meta.url),
    [{
      name: 'clerk-signin-fixture',
      setup(build) {
        build.onResolve({filter: /^@clerk\/react$/}, () => ({path: 'clerk', namespace: 'signin-fixture'}));
        build.onResolve({filter: /^@heroui\//}, () => ({path: 'heroui', namespace: 'signin-fixture'}));
        build.onResolve({filter: /^@heroui-pro\//}, () => ({path: 'heroui-pro', namespace: 'signin-fixture'}));
        build.onLoad({filter: /.*/, namespace: 'signin-fixture'}, ({path}) => {
          if (path === 'clerk') return {
            contents: `
              export function ClerkLoaded({children}) { return children; }
              export function ClerkLoading() { return null; }
              export function ClerkFailed() { return null; }
              export function SignInButton(props) {
                globalThis.__clerkSignInFixture.buttons.push(props);
                return props.children ?? null;
              }
            `,
          };
          if (path === 'heroui-pro') return {
            contents: `
              const EmptyState = Object.assign(({children}) => children, {
                Header: ({children}) => children,
                Title: ({children}) => children,
                Description: ({children}) => children,
                Content: ({children}) => children,
              });
              export {EmptyState};
            `,
          };
          return {
            contents: `
              export function Button({children}) { return children ?? null; }
              export function Spinner() { return null; }
            `,
          };
        });
      },
    }],
  );
  withPage(session => {
    const {clerkReturnUrlStorageKey} = {clerkReturnUrlStorageKey: 'blog-clerk-return-url'};
    renderToStaticMarkup(createElement(SignInPanel, {
      title: '登录后继续', description: '使用同一个账户。', action: true,
    }));
    assert.equal(globalThis.__clerkSignInFixture.buttons.length, 1);
    const props = globalThis.__clerkSignInFixture.buttons[0];
    assert.equal(props.mode, 'modal');
    assert.equal(props.withSignUp, true);
    assert.equal(props.oauthFlow, 'popup');
    assert.equal(props.forceRedirectUrl, currentPageWithoutHash);
    assert.equal(props.signUpForceRedirectUrl, currentPageWithoutHash);
    assert.equal(session.getItem(clerkReturnUrlStorageKey), null,
      'rendering the signed-out button must not overwrite a stored return URL');
  });
  delete globalThis.__clerkSignInFixture;
});

test('anonymous bookmark sign-in uses the shared helper instead of a bare openSignIn', async () => {
  const {default: BookmarkButton} = await importBundle(
    new URL('../src/components/reader/BookmarkButton.tsx', import.meta.url),
    [{
      name: 'bookmark-signin-fixture',
      setup(build) {
        build.onResolve({filter: /^@clerk\/react$/}, () => ({path: 'clerk', namespace: 'bookmark-fixture'}));
        build.onResolve({filter: /^convex\/react$/}, () => ({path: 'convex', namespace: 'bookmark-fixture'}));
        build.onResolve({filter: /convex\/_generated\/api$/}, () => ({path: 'api', namespace: 'bookmark-fixture'}));
        build.onResolve({filter: /^@heroui\/react$/}, () => ({path: 'heroui', namespace: 'bookmark-fixture'}));
        build.onResolve({filter: /^@gravity-ui\/icons$/}, () => ({path: 'icons', namespace: 'bookmark-fixture'}));
        build.onLoad({filter: /.*/, namespace: 'bookmark-fixture'}, ({path}) => ({
          contents: {
            clerk: `
              export function useAuth() { return {isLoaded: true, userId: null}; }
              export function useClerk() {
                return {openSignIn: (props) => { globalThis.__bookmarkSignIn.opened.push(props); }};
              }
            `,
            convex: `
              export function useConvexAuth() { return {isAuthenticated: false, isLoading: false}; }
              export function useQuery() { return undefined; }
              export function useMutation() { return async () => {}; }
            `,
            api: 'export const api = {reader: {getPage: "reader:getPage", setBookmark: "reader:setBookmark"}};',
            heroui: `
              export function Button({onPress}) {
                globalThis.__bookmarkSignIn.press = onPress;
                return null;
              }
              export function Spinner() { return null; }
              export function Tooltip({children}) { return children; }
              Tooltip.Content = () => null;
            `,
            icons: 'export function Bookmark() { return null; } export function BookmarkFill() { return null; }',
          }[path],
        }));
      },
    }],
  );
  withPage(session => {
    globalThis.__bookmarkSignIn = {opened: [], press: undefined};
    renderToStaticMarkup(createElement(BookmarkButton, {
      pathname: '/docs/article/', title: '文章', tooltipContainer: null,
    }));
    assert.equal(typeof globalThis.__bookmarkSignIn.press, 'function');
    globalThis.__bookmarkSignIn.press();
    assert.deepEqual(globalThis.__bookmarkSignIn.opened, [{...expectedRedirect, transferable: true}]);
    assert.equal(session.getItem('blog-clerk-return-url'), currentPage);
    delete globalThis.__bookmarkSignIn;
  });
});

test('every production SignInButton and openSignIn entry uses the shared sign-in-or-up helper', async () => {
  const files = [
    'src/components/auth/clerk-signin.ts',
    'src/components/auth/ClerkSignInButton.tsx',
    'src/components/auth/BlogClerkProvider.tsx',
    'src/components/auth/SsoCallback.tsx',
    'src/components/auth/GoogleOneTapPrompt.tsx',
    'src/components/auth/SignInPanel.tsx',
    'src/components/auth/AccountButton.tsx',
    'src/components/comments/CommentsRoot.tsx',
    'src/components/reader/BookmarkButton.tsx',
    'src/pages/sso-callback.astro',
  ];
  const sources = Object.fromEntries(await Promise.all(files.map(async file => [file, await readFile(file, 'utf8')])));
  const callers = [
    sources['src/components/auth/SignInPanel.tsx'],
    sources['src/components/auth/AccountButton.tsx'],
    sources['src/components/comments/CommentsRoot.tsx'],
    sources['src/components/reader/BookmarkButton.tsx'],
  ].join('\n');
  assert.match(sources['src/components/auth/clerk-signin.ts'], /withSignUp:\s*true/);
  assert.match(sources['src/components/auth/clerk-signin.ts'], /transferable:\s*true/);
  assert.match(sources['src/components/auth/clerk-signin.ts'], /rememberClerkReturnUrl\(\)/);
  assert.match(sources['src/components/auth/clerk-signin.ts'], /continuation:\s*'transfer_to_sign_up'/);
  assert.match(sources['src/components/auth/clerk-signin.ts'], /googleOneTapRejectedNeedsSignUp/);
  assert.match(sources['src/components/auth/clerk-signin.ts'], /clerkjs/);
  assert.match(sources['src/components/auth/clerk-signin.ts'], /clerkSsoCallbackPath = '\/sso-callback\/'/);
  assert.match(sources['src/components/auth/clerk-signin.ts'], /installOAuthSsoCallback/);
  assert.match(sources['src/components/auth/clerk-signin.ts'], /watchClerkAuthSession/);
  assert.match(sources['src/components/auth/clerk-signin.ts'], /addListener/);
  assert.match(sources['src/components/auth/GoogleOneTapPrompt.tsx'], /\{...googleOneTapRedirect\(\)\}/);
  assert.match(sources['src/components/auth/GoogleOneTapPrompt.tsx'], /installGoogleOneTapSignInOrUp\(clerk\)/);
  assert.doesNotMatch(sources['src/components/auth/GoogleOneTapPrompt.tsx'], /rememberClerkReturnUrl\(\)/);
  assert.match(sources['src/components/auth/ClerkSignInButton.tsx'], /\{...panelClerkRedirect\(\)\}/);
  assert.match(sources['src/components/auth/ClerkSignInButton.tsx'], /onClickCapture=\{\(\) => rememberClerkReturnUrl\(window\.location\)\}/);
  assert.match(sources['src/components/auth/ClerkSignInButton.tsx'], /onPointerDownCapture=\{\(\) => rememberClerkReturnUrl\(window\.location\)\}/);
  assert.doesNotMatch(sources['src/components/auth/ClerkSignInButton.tsx'], /onClickCapture=\{rememberClerkReturnUrl\}/);
  assert.doesNotMatch(sources['src/components/auth/ClerkSignInButton.tsx'], /onPointerDownCapture=\{rememberClerkReturnUrl\}/);
  assert.match(sources['src/components/auth/BlogClerkProvider.tsx'], /watchClerkAuthSession\(clerk, Boolean\(isSignedIn\)\)/);
  assert.match(sources['src/components/auth/BlogClerkProvider.tsx'], /clerkForceRedirectUrl\(\)/);
  assert.match(sources['src/components/auth/BlogClerkProvider.tsx'], /afterSignOutUrl=\{currentPage\}/);
  assert.match(sources['src/components/auth/BlogClerkProvider.tsx'], /const currentPage = window\.location\.href/);
  assert.match(sources['src/pages/sso-callback.astro'], /SsoCallback client:only="react"/);
  assert.match(sources['src/pages/sso-callback.astro'], /slot="fallback"/);
  assert.doesNotMatch(sources['src/pages/sso-callback.astro'], /<SsoCallback client:load/);
  assert.doesNotMatch(sources['src/pages/sso-callback.astro'], /\/sign-in/);
  await assert.rejects(readFile(new URL('../src/pages/sign-in.astro', import.meta.url)), {code: 'ENOENT'});
  assert.match(sources['src/components/auth/clerk-signin.ts'], /from '@clerk\/shared\/types'/);
  assert.doesNotMatch(sources['src/components/auth/clerk-signin.ts'], /strategy\?: string/);
  assert.doesNotMatch(sources['src/components/auth/clerk-signin.ts'], /setAttribute\('hidden'/);
  assert.match(sources['src/components/reader/BookmarkButton.tsx'], /openClerkSignIn\(clerk\)/);
  assert.equal([...callers.matchAll(/<ClerkSignInButton\b/g)].length, 4);
  assert.doesNotMatch(callers, /<SignInButton\b/);
  assert.doesNotMatch(callers, /openSignIn\(/);
});
