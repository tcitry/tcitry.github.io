import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { assertClerkIssuer, assertConvexSearchURL, assertProductionDeployKey, loadReaderEnvironment, readProductionReaderConfig, readProductionSearchURL } from '../scripts/reader-config.mjs';

const env = {
  PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_live_' + Buffer.from('clerk.test.invalid$').toString('base64'),
  PUBLIC_CONVEX_URL: 'https://production-fixture-123.convex.cloud',
  AI_SEARCH_PUBLIC_URL: 'https://fixture.search.ai.cloudflare.com/search',
  CONVEX_DEPLOY_KEY: 'prod:production-fixture-123|fixture-secret',
};

test('Production reader configuration fails closed for missing keys, development keys and unsafe URLs', () => {
  assert.equal(readProductionReaderConfig(env).clerkIssuerDomain, 'https://clerk.test.invalid');
  for (const value of [undefined, '', 'pk_test_fixture', 'pk_live_not-a-key',
    env.PUBLIC_CLERK_PUBLISHABLE_KEY + '=garbage',
    'pk_live_' + Buffer.from('dev-fixture.clerk.accounts.dev$').toString('base64')]) {
    assert.throws(() => readProductionReaderConfig({ ...env, PUBLIC_CLERK_PUBLISHABLE_KEY: value }), /Clerk|CLERK/);
  }
  for (const value of [undefined, '', 'http://localhost:3210', 'https://other.example.com',
    'https://production-fixture-123.convex.cloud/api', 'https://production-fixture-123.convex.cloud?key=anything',
    'https://name:password@production-fixture-123.convex.cloud', 'https://production-fixture-123.convex.cloud\n']) {
    assert.throws(() => readProductionReaderConfig({ ...env, PUBLIC_CONVEX_URL: value }), /PUBLIC_CONVEX_URL/);
  }
});

test('Production deploy key must identify the same production deployment as the public URL', () => {
  assert.doesNotThrow(() => assertProductionDeployKey(env));
  for (const value of ['', 'dev:production-fixture-123|fixture-secret', 'preview:team:project|fixture-secret',
    'project:team:project|fixture-secret', 'prod:another-deployment|fixture-secret', 'prod:production-fixture-123|fixture-secret\n']) {
    assert.throws(() => assertProductionDeployKey({ ...env, CONVEX_DEPLOY_KEY: value }), /CONVEX_DEPLOY_KEY/);
  }
});

test('Production requires a public AI Search endpoint before compilation or deployment', () => {
  assert.equal(readProductionReaderConfig(env).aiSearchUrl, env.AI_SEARCH_PUBLIC_URL);
  assert.equal(readProductionSearchURL({...env, AI_SEARCH_PUBLIC_URL: 'https://fixture.search.ai.cloudflare.com'}), env.AI_SEARCH_PUBLIC_URL);
  assert.equal(readProductionSearchURL({...env, AI_SEARCH_PUBLIC_URL: 'https://search.example.com'}), 'https://search.example.com/search');
  for (const value of [undefined, '', ' ', '\n', 'https://fixture.search.ai.cloudflare.com/search\n',
    'http://fixture.search.ai.cloudflare.com/search', 'https://outside.example/search',
    'https://fixture.search.ai.cloudflare.com.evil.example/search', 'https://user:password@fixture.search.ai.cloudflare.com/search',
    'https://fixture.search.ai.cloudflare.com/chat/completions', 'https://fixture.search.ai.cloudflare.com/search?token=private',
    'https://fixture.search.ai.cloudflare.com/search#hash']) {
    assert.throws(() => readProductionReaderConfig({...env, AI_SEARCH_PUBLIC_URL: value}), /AI_SEARCH_PUBLIC_URL/);
  }
});

test('Production Clerk issuer must match the instance encoded by the public key', () => {
  const config = readProductionReaderConfig(env);
  assert.doesNotThrow(() => assertClerkIssuer('https://clerk.test.invalid/', config));
  for (const issuer of [undefined, '', 'http://clerk.test.invalid', 'https://another.test.invalid', 'https://dev-fixture.clerk.accounts.dev']) {
    assert.throws(() => assertClerkIssuer(issuer, config), /CLERK_FRONTEND_API_URL/);
  }
});

test('Convex public Search must match the sealed frontend instance using a supported credential-free path', () => {
  const config = readProductionReaderConfig(env);
  const origin = 'https://fixture.search.ai.cloudflare.com';
  for (const suffix of ['', '/', '/search', '/search/', '/chat/completions', '/chat/completions/']) {
    assert.doesNotThrow(() => assertConvexSearchURL(origin + suffix, config));
  }
  for (const value of [undefined, '', ' ', origin + '\n', ' ' + origin,
    'https://other.search.ai.cloudflare.com/search', 'http://fixture.search.ai.cloudflare.com/search',
    'https://fixture.search.ai.cloudflare.com.evil.test/search', 'https://-fixture.search.ai.cloudflare.com/search',
    origin + ':443/search', origin + '/other/../search', origin + '/%73earch', origin + '/v1/chat/completions',
    origin + '/search?', origin + '/search#', origin + '\\search',
    origin + '/search?token=fixture-private-value', 'https://user:fixture-private-value@fixture.search.ai.cloudflare.com/search']) {
    assert.throws(() => assertConvexSearchURL(value, config), error => {
      assert.match(error.message, /Set AI_SEARCH_PUBLIC_URL.*same AI Search Public endpoint.*build AI_SEARCH_PUBLIC_URL/);
      assert.ok(!error.message.includes('fixture-private-value'));
      return true;
    });
  }
});

test('the sealed custom domain must also be used by Convex, without implicit alias substitution', () => {
  const config = readProductionReaderConfig({...env, AI_SEARCH_PUBLIC_URL: 'https://search.example.com/search'});
  assert.doesNotThrow(() => assertConvexSearchURL('https://search.example.com/chat/completions', config));
  for (const value of ['https://other.example.com/search', env.AI_SEARCH_PUBLIC_URL, 'https://127.0.0.1/search']) {
    assert.throws(() => assertConvexSearchURL(value, config), /same AI Search Public endpoint/);
  }
});

test('Local environment files have Astro precedence with explicit process values first and separate modes', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'reader-env-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(path.join(directory, '.env'), 'VALUE=base\nBASE=base\n');
  await writeFile(path.join(directory, '.env.local'), 'VALUE=local\nLOCAL=local\n');
  await writeFile(path.join(directory, '.env.production'), 'VALUE=production\n');
  await writeFile(path.join(directory, '.env.production.local'), 'VALUE=production-local\n');
  await writeFile(path.join(directory, '.env.development.local'), 'VALUE=development-local\n');
  assert.equal(loadReaderEnvironment(directory, {}).VALUE, 'production-local');
  assert.equal(loadReaderEnvironment(directory, {}, 'development').VALUE, 'development-local');
  assert.deepEqual(loadReaderEnvironment(directory, { VALUE: 'environment' }), { VALUE: 'environment', BASE: 'base', LOCAL: 'local' });
});

test('Production mode reads committed wrangler public vars; development mode ignores them', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'reader-wrangler-env-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const key = 'pk_live_' + Buffer.from('clerk.wrangler.invalid$').toString('base64');
  await writeFile(path.join(directory, 'wrangler.jsonc'), JSON.stringify({
    vars: { PUBLIC_CLERK_PUBLISHABLE_KEY: key, PUBLIC_CONVEX_URL: 'https://hushed-mallard-700.convex.cloud' },
  }));
  assert.equal(loadReaderEnvironment(directory, {}, 'production').PUBLIC_CONVEX_URL, 'https://hushed-mallard-700.convex.cloud');
  assert.equal(loadReaderEnvironment(directory, {}, 'development').PUBLIC_CONVEX_URL, undefined);
  assert.equal(loadReaderEnvironment(directory, { PUBLIC_CONVEX_URL: 'https://other.convex.cloud' }, 'production').PUBLIC_CONVEX_URL,
    'https://other.convex.cloud');
});
