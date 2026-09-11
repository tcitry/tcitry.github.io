import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const loginFiles = [
  'src/components/auth/SignInPanel.tsx',
  'src/components/auth/AccountButton.tsx',
  'src/components/comments/CommentsRoot.tsx',
  'src/components/reader/BookmarkButton.tsx',
];

test('panelClerkRedirect only returns current-page redirect URLs', async () => {
  const source = await readFile('src/components/auth/SignInPanel.tsx', 'utf8');
  const helper = source.match(/export function panelClerkRedirect\(\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(helper, 'panelClerkRedirect must live in SignInPanel');
  assert.match(helper, /forceRedirectUrl:\s*window\.location\.href/);
  assert.match(helper, /signUpForceRedirectUrl:\s*window\.location\.href/);
  assert.equal([...helper.matchAll(/:/g)].length, 2, 'helper must only set the two redirect fields');
});

test('production SignInButton and openSignIn entries do not opt into sign-in-or-up', async () => {
  const sources = Object.fromEntries(await Promise.all(
    loginFiles.map(async file => [file, await readFile(file, 'utf8')]),
  ));
  const production = Object.values(sources).join('\n');
  assert.doesNotMatch(production, /withSignUp/);
  assert.doesNotMatch(production, /transferable/);
  assert.match(sources['src/components/reader/BookmarkButton.tsx'], /openSignIn\(panelClerkRedirect\(\)\)/);
  const buttons = [...production.matchAll(/<SignInButton\b[^>]*>/g)].map(match => match[0]);
  assert.equal(buttons.length, 4);
  assert.ok(buttons.every(tag => tag.includes('{...panelClerkRedirect()}') || tag.includes('{...redirect}')),
    'SignInButton callers must spread panelClerkRedirect()');
});
