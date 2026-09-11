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

function withPage(run) {
  const previousWindow = globalThis.window;
  globalThis.window = {location: {href: currentPage}};
  try {
    return run();
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
}

test('shared Clerk sign-in options opt into sign-in-or-up and keep OAuth transferable', async () => {
  const {panelClerkRedirect, openClerkSignIn} = await importBundle(
    new URL('../src/components/auth/clerk-signin.ts', import.meta.url),
  );
  withPage(() => {
    assert.deepEqual(panelClerkRedirect(), expectedRedirect);
    const opened = [];
    openClerkSignIn({openSignIn: (props) => opened.push(props)});
    assert.deepEqual(opened, [{...expectedRedirect, transferable: true}]);
  });
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

test('every production SignInButton and openSignIn entry uses the shared sign-in-or-up helper', async () => {
  const files = [
    'src/components/auth/clerk-signin.ts',
    'src/components/auth/SignInPanel.tsx',
    'src/components/auth/AccountButton.tsx',
    'src/components/comments/CommentsRoot.tsx',
    'src/components/reader/BookmarkButton.tsx',
  ];
  const sources = Object.fromEntries(await Promise.all(files.map(async file => [file, await readFile(file, 'utf8')])));
  const production = files.filter(file => !file.endsWith('clerk-signin.ts')).map(file => sources[file]).join('\n');
  assert.match(sources['src/components/auth/clerk-signin.ts'], /withSignUp:\s*true/);
  assert.match(sources['src/components/auth/clerk-signin.ts'], /transferable:\s*true/);
  assert.match(sources['src/components/reader/BookmarkButton.tsx'], /openClerkSignIn\(clerk\)/);
  const buttons = [...production.matchAll(/<SignInButton\b[^>]*>/g)].map(match => match[0]);
  assert.equal(buttons.length, 4);
  assert.ok(buttons.every(tag => tag.includes('{...panelClerkRedirect()}') || tag.includes('{...redirect}')),
    'SignInButton callers must spread the shared helper so withSignUp cannot be omitted');
  assert.doesNotMatch(production, /openSignIn\(/);
});
