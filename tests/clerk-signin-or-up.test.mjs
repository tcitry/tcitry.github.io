import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {build} from 'esbuild';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

const currentPage = 'https://example.test/docs/article/?view=full#comments';
const origin = 'https://example.test';
const expectedRedirect = {
  forceRedirectUrl: currentPage,
  signUpForceRedirectUrl: currentPage,
  withSignUp: true,
};

async function importBundle(entryUrl, plugins = []) {
  const bundle = await build({
    entryPoints: [entryUrl.pathname],
    bundle: true, platform: 'node', format: 'esm', write: false, jsx: 'automatic',
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
  try {
    return run(session);
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
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
    assert.equal(props.forceRedirectUrl, currentPage);
    assert.equal(props.signUpForceRedirectUrl, currentPage);
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
    'src/components/auth/GoogleOneTapPrompt.tsx',
    'src/components/auth/SignInPanel.tsx',
    'src/components/auth/AccountButton.tsx',
    'src/components/comments/CommentsRoot.tsx',
    'src/components/reader/BookmarkButton.tsx',
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
  assert.match(sources['src/components/auth/clerk-signin.ts'], /clerkjs/);
  assert.match(sources['src/components/auth/GoogleOneTapPrompt.tsx'], /\{...googleOneTapRedirect\(\)\}/);
  assert.match(sources['src/components/auth/GoogleOneTapPrompt.tsx'], /installGoogleOneTapSignInOrUp\(clerk\)/);
  assert.match(sources['src/components/auth/GoogleOneTapPrompt.tsx'], /rememberClerkReturnUrl\(\)/);
  assert.match(sources['src/components/auth/ClerkSignInButton.tsx'], /\{...panelClerkRedirect\(\)\}/);
  assert.match(sources['src/components/auth/ClerkSignInButton.tsx'], /onClickCapture=\{\(\) => rememberClerkReturnUrl\(window\.location\)\}/);
  assert.match(sources['src/components/auth/ClerkSignInButton.tsx'], /onPointerDownCapture=\{\(\) => rememberClerkReturnUrl\(window\.location\)\}/);
  assert.doesNotMatch(sources['src/components/auth/ClerkSignInButton.tsx'], /onClickCapture=\{rememberClerkReturnUrl\}/);
  assert.doesNotMatch(sources['src/components/auth/ClerkSignInButton.tsx'], /onPointerDownCapture=\{rememberClerkReturnUrl\}/);
  assert.match(sources['src/components/auth/BlogClerkProvider.tsx'], /restoreClerkReturnUrl\(\)/);
  assert.match(sources['src/components/reader/BookmarkButton.tsx'], /openClerkSignIn\(clerk\)/);
  assert.equal([...callers.matchAll(/<ClerkSignInButton\b/g)].length, 4);
  assert.doesNotMatch(callers, /<SignInButton\b/);
  assert.doesNotMatch(callers, /openSignIn\(/);
});
