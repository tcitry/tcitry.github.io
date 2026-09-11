import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

const currentPage = 'https://example.test/docs/article/?view=full#comments';
const compiled = new Map();

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

function renderPrompt(Component, auth) {
  const previousWindow = globalThis.window;
  const fixture = {auth, providers: 0, prompts: []};
  globalThis.window = {location: {href: currentPage}};
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
  }
});

test('production waits for Clerk and does not prompt authenticated accounts', async () => {
  const Component = await componentFor('production', 'pk_live_fixture');
  for (const auth of [{isLoaded: false, isSignedIn: undefined}, {isLoaded: true, isSignedIn: true}]) {
    const result = renderPrompt(Component, auth);
    assert.equal(result.providers, 1);
    assert.deepEqual(result.prompts, []);
  }
});

test('a signed-out production visitor gets one Clerk prompt returning to the current URL', async () => {
  const Component = await componentFor('production', 'pk_live_fixture');
  const result = renderPrompt(Component, {isLoaded: true, isSignedIn: false});
  assert.equal(result.providers, 1);
  assert.deepEqual(result.prompts, [{signInForceRedirectUrl: currentPage, signUpForceRedirectUrl: currentPage}]);
});
