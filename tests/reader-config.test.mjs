import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { assertClerkIssuer, assertProductionDeployKey, loadReaderEnvironment, readProductionReaderConfig } from '../scripts/reader-config.mjs';

const env = {
  PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_live_' + Buffer.from('clerk.test.invalid$').toString('base64'),
  PUBLIC_CONVEX_URL: 'https://production-fixture-123.convex.cloud',
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

test('Production Clerk issuer must match the instance encoded by the public key', () => {
  const config = readProductionReaderConfig(env);
  assert.doesNotThrow(() => assertClerkIssuer('https://clerk.test.invalid/', config));
  for (const issuer of [undefined, '', 'http://clerk.test.invalid', 'https://another.test.invalid', 'https://dev-fixture.clerk.accounts.dev']) {
    assert.throws(() => assertClerkIssuer(issuer, config), /CLERK_JWT_ISSUER_DOMAIN/);
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
