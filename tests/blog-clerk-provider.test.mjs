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
          export function useAuth() { return {isLoaded: true, isSignedIn: true}; }
          export function ClerkProvider({children, Clerk}) {
            globalThis.__clerkProviders += 1;
            if (Clerk) globalThis.__clerkReused = true;
            return children;
          }
        `,
      }));
    },
  }],
});
const {default: BlogClerkProvider} = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));

test('nested BlogClerkProvider does not mount a second ClerkProvider', () => {
  const previousWindow = globalThis.window;
  globalThis.window = {location: {href: 'https://example.test/docs/'}};
  globalThis.__clerkProviders = 0;
  globalThis.__clerkReused = false;
  try {
    const html = renderToStaticMarkup(createElement(BlogClerkProvider, null, createElement(BlogClerkProvider, null, createElement('span', null, 'ok'))));
    assert.match(html, /ok/);
    assert.equal(globalThis.__clerkProviders, 1);
  } finally {
    globalThis.window = previousWindow;
    delete globalThis.__clerkProviders;
    delete globalThis.__clerkReused;
  }
});

test('a loaded window.Clerk is reused instead of loading clerk-js twice', () => {
  const previousWindow = globalThis.window;
  const loaded = {load() {}};
  globalThis.window = {location: {href: 'https://example.test/docs/'}, Clerk: loaded};
  globalThis.__clerkProviders = 0;
  globalThis.__clerkReused = false;
  try {
    renderToStaticMarkup(createElement(BlogClerkProvider, null, createElement('span', null, 'ok')));
    assert.equal(globalThis.__clerkProviders, 1);
    assert.equal(globalThis.__clerkReused, true);
  } finally {
    globalThis.window = previousWindow;
    delete globalThis.__clerkProviders;
    delete globalThis.__clerkReused;
  }
});

test('window.Clerk without load is not passed to ClerkProvider', () => {
  const previousWindow = globalThis.window;
  globalThis.window = {location: {href: 'https://example.test/docs/'}, Clerk: {version: 'fixture'}};
  globalThis.__clerkProviders = 0;
  globalThis.__clerkReused = false;
  try {
    renderToStaticMarkup(createElement(BlogClerkProvider, null, createElement('span', null, 'ok')));
    assert.equal(globalThis.__clerkProviders, 1);
    assert.equal(globalThis.__clerkReused, false);
  } finally {
    globalThis.window = previousWindow;
    delete globalThis.__clerkProviders;
    delete globalThis.__clerkReused;
  }
});

test('BlogClerkProvider types reused window.Clerk as ClerkProvider Clerk prop', async () => {
  const provider = await readFile(new URL('../src/components/auth/BlogClerkProvider.tsx', import.meta.url), 'utf8');
  const types = await readFile(new URL('../src/components/auth/blog-clerk-provider.types.ts', import.meta.url), 'utf8');
  assert.match(provider, /import type \{ClerkProp, HeadlessBrowserClerk\} from '@clerk\/react'/);
  assert.match(provider, /value is HeadlessBrowserClerk/);
  assert.match(provider, /loadedClerkInstance\(\): ClerkProp/);
  assert.doesNotMatch(provider, /Clerk\?: \{load\?: unknown\}/);
  assert.match(types, /@ts-expect-error incomplete window\.Clerk is not assignable to ClerkProvider's Clerk prop/);
  assert.match(types, /rejectedWeakClerk: ClerkProp = weakClerk/);
});
