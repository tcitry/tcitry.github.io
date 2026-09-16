import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {build} from 'esbuild';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

const currentPage = 'https://example.test/docs/article/?view=full#comments';
const nonce = 'b8188ec9-f1a8-4cb3-9cc5-040166ab890b';

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

function withPage(run, href = currentPage) {
  const previousWindow = globalThis.window;
  const storage = new Map();
  globalThis.window = {
    location: {href, origin: new URL(href).origin, pathname: new URL(href).pathname},
    sessionStorage: {getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value)},
  };
  try { return run(); }
  finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
}

test('the shared login helper delegates to the auth window without changing the article URL', async () => {
  globalThis.__authWindowCalls = [];
  const {openClerkSignIn, googleOneTapRedirect} = await importBundle(
    new URL('../src/components/auth/clerk-signin.ts', import.meta.url),
    [{name: 'auth-window-fixture', setup(build) {
      build.onResolve({filter: /\/clerk-auth-window$/}, () => ({path: 'auth-window', namespace: 'auth-window-fixture'}));
      build.onLoad({filter: /.*/, namespace: 'auth-window-fixture'}, () => ({contents: `
        export function authWindowState() { return undefined; }
        export function authWindowUrl() { throw new Error('not a callback'); }
        export function openClerkAuthWindow(...args) { globalThis.__authWindowCalls.push(args); }
      `}));
    }}],
  );
  try {
    withPage(() => {
      const clerk = {};
      const onError = () => {};
      openClerkSignIn(clerk, onError);
      assert.deepEqual(globalThis.__authWindowCalls, [[clerk, onError]]);
      assert.equal(window.location.href, currentPage);
      assert.deepEqual(googleOneTapRedirect(), {signInForceRedirectUrl: currentPage, signUpForceRedirectUrl: currentPage});
    });
  } finally { delete globalThis.__authWindowCalls; }
});

test('callback fallback avoids a sign-in loop and otherwise preserves query strings and hashes', async () => {
  const {clerkSignInPath, clerkAfterAuthFallbackUrl} = await importBundle(
    new URL('../src/components/auth/clerk-signin.ts', import.meta.url),
  );
  assert.equal(clerkSignInPath, '/sso-callback/');
  for (const suffix of ['', '/', '?intent=signIn#/create/sso-callback', '/?sign_up_force_redirect_url=%2Fdocs%2Farticle%2F%23comments#/create/continue']) {
    withPage(() => {
      assert.equal(clerkAfterAuthFallbackUrl(), '/');
    }, `https://example.test/sso-callback${suffix}`);
  }
  withPage(() => {
    assert.equal(clerkAfterAuthFallbackUrl(), `https://example.test/sso-callback/?auth_window=${nonce}`);
  }, `https://example.test/sso-callback/?auth_window=${nonce}#/create/continue`);
  for (const href of [currentPage, 'https://example.test/?view=full#top', 'https://example.test/sso-callback/extra/#comments']) {
    assert.equal(clerkAfterAuthFallbackUrl({href}), href);
  }
});

test('callback delegates sign-in, sign-up and continuation to the official combined component', async () => {
  globalThis.__nativeSignIns = [];
  const {default: SsoCallback} = await importBundle(
    new URL('../src/components/auth/SsoCallback.tsx', import.meta.url),
    [{
      name: 'native-callback-fixture',
      setup(build) {
        build.onResolve({filter: /^@clerk\/react$/}, () => ({path: 'clerk', namespace: 'native-callback-fixture'}));
        build.onLoad({filter: /.*/, namespace: 'native-callback-fixture'}, () => ({contents: `
          export function ClerkProvider({children}) { return children; }
          export function ClerkLoaded({children}) { return children; }
          export function ClerkLoading() { return null; }
          export function ClerkFailed() { return null; }
          export function useSession() { return {session: globalThis.__callbackSession ?? null}; }
          export function SignIn(props) {
            globalThis.__nativeSignIns.push(props);
            return null;
          }
        `}));
      },
    }],
    {'import.meta.env.PUBLIC_CLERK_PUBLISHABLE_KEY': JSON.stringify('pk_test_fixture')},
  );
  try {
    for (const hash of ['', '#/sso-callback', '#/create/sso-callback', '#/create/continue']) {
      withPage(() => {
        const html = renderToStaticMarkup(createElement(SsoCallback));
        assert.doesNotMatch(html, /<a\b[^>]*href="\/"/);
        assert.deepEqual(globalThis.__nativeSignIns.at(-1), {routing: 'hash', withSignUp: true, oauthFlow: 'redirect'},
          'OAuth must navigate inside the existing auth window, never open a nested provider popup');
      }, `https://example.test/sso-callback/?intent=signIn${hash}`);
    }
    withPage(() => {
      renderToStaticMarkup(createElement(SsoCallback));
      const completion = `https://example.test/sso-callback/?auth_window=${nonce}`;
      assert.deepEqual(globalThis.__nativeSignIns.at(-1), {
        routing: 'hash', withSignUp: true, oauthFlow: 'redirect',
        forceRedirectUrl: completion, signUpForceRedirectUrl: completion,
      });
    }, `https://example.test/sso-callback/?auth_window=${nonce}#/create/continue`);
    globalThis.__callbackSession = {id: 'session_verified', status: 'active', currentTask: null};
    withPage(() => {
      const html = renderToStaticMarkup(createElement(SsoCallback));
      assert.match(html, /You&#x27;re signed in/);
      assert.match(html, /Connecting to your original tab/);
      assert.doesNotMatch(html, /<a\b/);
    }, `https://example.test/sso-callback/?auth_window=${nonce}`);
  } finally {
    delete globalThis.__nativeSignIns;
    delete globalThis.__callbackSession;
  }
});

test('the existing login button opens the auth window directly from the button press', async () => {
  globalThis.__authEntry = {clerk: {}, opened: []};
  const {default: ClerkSignInButton} = await importBundle(
    new URL('../src/components/auth/ClerkSignInButton.tsx', import.meta.url),
    [authEntryFixture()],
  );
  try {
    withPage(() => {
      let onPress;
      function Button(props) { onPress = props.onPress; return props.children; }
      assert.equal(renderToStaticMarkup(createElement(ClerkSignInButton, null, createElement(Button, null, 'Sign in'))), 'Sign in');
      assert.equal(globalThis.__authEntry.opened.length, 0, 'Rendering must not open a window');
      onPress();
      assert.equal(globalThis.__authEntry.opened.length, 1);
      assert.equal(globalThis.__authEntry.opened[0][0], globalThis.__authEntry.clerk);
      assert.equal(typeof globalThis.__authEntry.opened[0][1], 'function', 'Popup errors must reach the button feedback');
      assert.equal(window.location.href, currentPage);
    });
  } finally { delete globalThis.__authEntry; }
});

function authEntryFixture() {
  return {name: 'auth-entry-fixture', setup(build) {
    build.onResolve({filter: /^@clerk\/react$/}, () => ({path: 'clerk', namespace: 'auth-entry-fixture'}));
    build.onResolve({filter: /\/clerk-signin$/}, () => ({path: 'entry', namespace: 'auth-entry-fixture'}));
    build.onLoad({filter: /.*/, namespace: 'auth-entry-fixture'}, ({path}) => ({contents: path === 'clerk' ? `
      export function useClerk() { return globalThis.__authEntry.clerk; }
      export function ClerkLoaded({children}) { return children; }
      export function ClerkLoading() { return null; }
      export function ClerkFailed() { return null; }
    ` : `export function openClerkSignIn(...args) { globalThis.__authEntry.opened.push(args); }`}));
  }};
}

test('anonymous bookmarks use the same auth window helper and error feedback', async () => {
  const {default: BookmarkButton} = await importBundle(
    new URL('../src/components/reader/BookmarkButton.tsx', import.meta.url),
    [{
      name: 'bookmark-signin-fixture',
      setup(build) {
        build.onResolve({filter: /^@clerk\/react$/}, () => ({path: 'clerk', namespace: 'bookmark-fixture'}));
        build.onResolve({filter: /\/clerk-signin$/}, () => ({path: 'entry', namespace: 'bookmark-fixture'}));
        build.onResolve({filter: /^convex\/react$/}, () => ({path: 'convex', namespace: 'bookmark-fixture'}));
        build.onResolve({filter: /convex\/_generated\/api$/}, () => ({path: 'api', namespace: 'bookmark-fixture'}));
        build.onResolve({filter: /^@heroui\/react$/}, () => ({path: 'heroui', namespace: 'bookmark-fixture'}));
        build.onResolve({filter: /^@gravity-ui\/icons$/}, () => ({path: 'icons', namespace: 'bookmark-fixture'}));
        build.onLoad({filter: /.*/, namespace: 'bookmark-fixture'}, ({path}) => ({
          contents: {
            clerk: `
              export function useAuth() { return {isLoaded: true, userId: null}; }
              export function useClerk() {
                return globalThis.__bookmarkSignIn.clerk;
              }
            `,
            entry: `export function openClerkSignIn(...args) { globalThis.__bookmarkSignIn.opened.push(args); }`,
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
  withPage(() => {
    globalThis.__bookmarkSignIn = {clerk: {}, opened: [], press: undefined};
    renderToStaticMarkup(createElement(BookmarkButton, {
      pathname: '/docs/article/', title: '文章', tooltipContainer: null,
    }));
    assert.equal(typeof globalThis.__bookmarkSignIn.press, 'function');
    globalThis.__bookmarkSignIn.press();
    assert.equal(globalThis.__bookmarkSignIn.opened.length, 1);
    assert.equal(globalThis.__bookmarkSignIn.opened[0][0], globalThis.__bookmarkSignIn.clerk);
    assert.equal(typeof globalThis.__bookmarkSignIn.opened[0][1], 'function');
    delete globalThis.__bookmarkSignIn;
  });
});

test('production entries keep native OAuth ownership and the existing One Tap adapter', async () => {
  const files = [
    'src/components/auth/clerk-signin.ts',
    'src/components/auth/clerk-auth-window.ts',
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
  assert.match(sources['src/components/auth/GoogleOneTapPrompt.tsx'], /\{...googleOneTapRedirect\(\)\}/);
  assert.match(sources['src/components/auth/GoogleOneTapPrompt.tsx'], /installGoogleOneTapSignInOrUp\(clerk\)/);
  assert.match(sources['src/components/auth/clerk-signin.ts'], /continuation:\s*'transfer_to_sign_up'/);
  const authHost = ['clerk-signin.ts', 'ClerkSignInButton.tsx', 'BlogClerkProvider.tsx', 'SsoCallback.tsx']
    .map(file => sources[`src/components/auth/${file}`]).join('\n');
  assert.doesNotMatch(authHost, /clerk_popup_state|startClerkOAuthPopup|installOAuthSsoCallback|runClerkSsoCallback|watchClerkAuthSession|rememberClerkReturnUrl/);
  assert.doesNotMatch(sources['src/components/auth/SsoCallback.tsx'], /handleRedirectCallback|setActive|authenticateWith|signUp\.create/,
    'The callback observes the official session without owning OAuth transfer or account creation');
  assert.doesNotMatch(sources['src/components/auth/clerk-auth-window.ts'], /authenticateWith|signUp\.create|signIn\.create/);
  assert.match(sources['src/components/auth/SsoCallback.tsx'], /oauthFlow="redirect"/);
  assert.match(sources['src/pages/sso-callback.astro'], /SsoCallback client:only="react"/);
  assert.match(sources['src/pages/sso-callback.astro'], /slot="fallback"/);
  for (const removed of ['sign-in.astro', 'sign-up.astro', 'auth-test.astro']) {
    await assert.rejects(readFile(new URL('../src/pages/' + removed, import.meta.url)), {code: 'ENOENT'});
  }
  assert.match(sources['src/components/reader/BookmarkButton.tsx'], /openClerkSignIn\(clerk,\s*setError\)/);
  assert.equal([...callers.matchAll(/<ClerkSignInButton\b/g)].length, 4);
  assert.doesNotMatch(callers, /<SignInButton\b/);
  assert.doesNotMatch(callers, /openSignIn\(/);
});
