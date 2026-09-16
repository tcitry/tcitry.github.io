import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {build} from 'esbuild';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

const currentPage = 'https://example.test/docs/article/?view=full#comments';
const expectedRedirect = {
  forceRedirectUrl: currentPage,
  signUpForceRedirectUrl: currentPage,
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

function withPage(run, href = currentPage) {
  const previousWindow = globalThis.window;
  globalThis.window = {location: {href, origin: new URL(href).origin}};
  try { return run(); }
  finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
}

test('native modal options preserve the complete article URL and comment hash', async () => {
  const {panelClerkRedirect, openClerkSignIn} = await importBundle(
    new URL('../src/components/auth/clerk-signin.ts', import.meta.url),
  );
  withPage(() => {
    assert.deepEqual(panelClerkRedirect(), expectedRedirect);
    const opened = [];
    openClerkSignIn({openSignIn: props => opened.push(props)});
    assert.deepEqual(opened, [{...expectedRedirect, transferable: true}]);
  });
});

test('callback fallback avoids a sign-in loop and otherwise preserves query strings and hashes', async () => {
  const {clerkSignInPath, clerkAfterAuthFallbackUrl, panelClerkRedirect} = await importBundle(
    new URL('../src/components/auth/clerk-signin.ts', import.meta.url),
  );
  assert.equal(clerkSignInPath, '/sso-callback/');
  for (const suffix of ['', '/', '?intent=signIn#/create/sso-callback', '/?sign_up_force_redirect_url=%2Fdocs%2Farticle%2F%23comments#/create/continue']) {
    withPage(() => {
      assert.equal(clerkAfterAuthFallbackUrl(), '/');
      assert.deepEqual(panelClerkRedirect(), {...expectedRedirect, forceRedirectUrl: '/', signUpForceRedirectUrl: '/'});
    }, `https://example.test/sso-callback${suffix}`);
  }
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
        assert.deepEqual(globalThis.__nativeSignIns.at(-1), {routing: 'hash', withSignUp: true, oauthFlow: 'popup'},
          'The host must not override native continuation redirects');
      }, `https://example.test/sso-callback/?intent=signIn${hash}`);
    }
  } finally { delete globalThis.__nativeSignIns; }
});

test('ClerkSignInButton delegates its modal and full return URL to the official button', async () => {
  globalThis.__nativeSignInButtons = [];
  const {default: ClerkSignInButton} = await importBundle(
    new URL('../src/components/auth/ClerkSignInButton.tsx', import.meta.url),
    [{
      name: 'native-signin-button-fixture',
      setup(build) {
        build.onResolve({filter: /^@clerk\/react$/}, () => ({path: 'clerk', namespace: 'native-signin-button-fixture'}));
        build.onLoad({filter: /.*/, namespace: 'native-signin-button-fixture'}, () => ({contents: `
          export function SignInButton(props) {
            globalThis.__nativeSignInButtons.push(props);
            return props.children;
          }
        `}));
      },
    }],
  );
  try {
    withPage(() => {
      const html = renderToStaticMarkup(createElement(ClerkSignInButton, null, 'Sign in'));
      assert.equal(html, 'Sign in', 'No capture wrapper or separate return-URL storage is needed');
      assert.deepEqual(globalThis.__nativeSignInButtons, [{...expectedRedirect, mode: 'modal', children: 'Sign in'}]);
    });
  } finally { delete globalThis.__nativeSignInButtons; }
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
  withPage(() => {
    renderToStaticMarkup(createElement(SignInPanel, {
      title: '登录后继续', description: '使用同一个账户。', action: true,
    }));
    assert.equal(globalThis.__clerkSignInFixture.buttons.length, 1);
    const props = globalThis.__clerkSignInFixture.buttons[0];
    assert.equal(props.mode, 'modal');
    assert.equal(props.withSignUp, true);
    assert.equal(props.oauthFlow, 'popup');
    assert.equal(props.forceRedirectUrl, currentPage);
    assert.equal(props.signUpForceRedirectUrl, currentPage);
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
  withPage(() => {
    globalThis.__bookmarkSignIn = {opened: [], press: undefined};
    renderToStaticMarkup(createElement(BookmarkButton, {
      pathname: '/docs/article/', title: '文章', tooltipContainer: null,
    }));
    assert.equal(typeof globalThis.__bookmarkSignIn.press, 'function');
    globalThis.__bookmarkSignIn.press();
    assert.deepEqual(globalThis.__bookmarkSignIn.opened, [{...expectedRedirect, transferable: true}]);
    delete globalThis.__bookmarkSignIn;
  });
});

test('production entries keep native OAuth and One Tap ownership', async () => {
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
  assert.match(sources['src/components/auth/GoogleOneTapPrompt.tsx'], /\{...googleOneTapRedirect\(\)\}/);
  assert.doesNotMatch(sources['src/components/auth/GoogleOneTapPrompt.tsx'], /installGoogleOneTapSignInOrUp|useClerk/);
  assert.doesNotMatch(sources['src/components/auth/clerk-signin.ts'], /transfer_to_sign_up|signUp\.create|authenticateWithGoogleOneTap\s*=|handleGoogleOneTapCallback\s*=/);
  const authHost = ['clerk-signin.ts', 'ClerkSignInButton.tsx', 'BlogClerkProvider.tsx', 'SsoCallback.tsx']
    .map(file => sources[`src/components/auth/${file}`]).join('\n');
  assert.doesNotMatch(authHost, /clerk_popup_state|startClerkOAuthPopup|installOAuthSsoCallback|runClerkSsoCallback|watchClerkAuthSession|rememberClerkReturnUrl/);
  assert.doesNotMatch(sources['src/components/auth/SsoCallback.tsx'], /useEffect|handleRedirectCallback|setActive/,
    'The callback host adds no second effect or transfer owner around the native flow');
  assert.match(sources['src/pages/sso-callback.astro'], /SsoCallback client:only="react"/);
  assert.match(sources['src/pages/sso-callback.astro'], /slot="fallback"/);
  for (const removed of ['sign-in.astro', 'sign-up.astro', 'auth-test.astro']) {
    await assert.rejects(readFile(new URL('../src/pages/' + removed, import.meta.url)), {code: 'ENOENT'});
  }
  assert.match(sources['src/components/reader/BookmarkButton.tsx'], /openClerkSignIn\(clerk\)/);
  assert.equal([...callers.matchAll(/<ClerkSignInButton\b/g)].length, 4);
  assert.doesNotMatch(callers, /<SignInButton\b/);
  assert.doesNotMatch(callers, /openSignIn\(/);
});
