import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  PRODUCTION_CONVEX_URL,
  assertPreviewDeployKey,
  assertPreviewReaderSources,
  createPreviewProcessEnv,
  readPreviewReaderConfig,
  stripAmbientProductionEnv,
  stripCloudflareCredentials,
  createPreviewConvexEnv,
  createPreviewWranglerEnv,
} from '../scripts/reader-config.mjs';

const previewKey = 'pk_test_' + Buffer.from('dev-fixture.clerk.accounts.dev$').toString('base64');
const productionKey = 'pk_live_' + Buffer.from('clerk.test.invalid$').toString('base64');
const stagingUrl = 'https://staging-fixture-123.convex.cloud';
const previewEnv = {
  PREVIEW_PUBLIC_CLERK_PUBLISHABLE_KEY: previewKey,
  PREVIEW_PUBLIC_CONVEX_URL: stagingUrl,
  PREVIEW_AI_SEARCH_PUBLIC_URL: 'https://fixture.search.ai.cloudflare.com/search',
  PREVIEW_CONVEX_DEPLOY_KEY: 'dev:staging-fixture-123|fixture-secret',
};

test('preview reader configuration requires pk_test, staging Convex and a non-production deploy key', () => {
  const { mapped, reader } = assertPreviewReaderSources(previewEnv);
  assert.equal(reader.clerkPublishableKey, previewKey);
  assert.equal(reader.convexUrl, stagingUrl);
  assert.equal(mapped.PUBLIC_CONVEX_URL, stagingUrl);
  assert.doesNotThrow(() => assertPreviewDeployKey(mapped, reader));
});

test('preview reader configuration rejects production PREVIEW_* values', () => {
  for (const [overrides, expected] of [
    [{ PREVIEW_PUBLIC_CLERK_PUBLISHABLE_KEY: productionKey }, /pk_test/],
    [{ PREVIEW_PUBLIC_CONVEX_URL: PRODUCTION_CONVEX_URL }, /must not target the production Convex deployment/],
    [{ PREVIEW_CONVEX_DEPLOY_KEY: 'prod:staging-fixture-123|fixture-secret' }, /must not be a production deploy key/],
    [{ PREVIEW_CONVEX_DEPLOY_KEY: 'prod:hushed-mallard-700|fixture-secret' }, /must not be a production deploy key/],
    [{ PREVIEW_CONVEX_DEPLOY_KEY: 'dev:other-deployment|fixture-secret' }, /same staging deployment/],
    [{ PREVIEW_AI_SEARCH_PUBLIC_URL: 'https://outside.example/search' }, /PREVIEW_AI_SEARCH_PUBLIC_URL/],
  ]) {
    assert.throws(() => assertPreviewReaderSources({ ...previewEnv, ...overrides }), new RegExp(expected));
  }
});

test('stripAmbientProductionEnv removes shared production reader values and deploy credentials', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'preview-strip-root-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, 'wrangler.jsonc'), JSON.stringify({
    vars: { PUBLIC_CLERK_PUBLISHABLE_KEY: productionKey, PUBLIC_CONVEX_URL: PRODUCTION_CONVEX_URL },
  }));
  const stripped = stripAmbientProductionEnv({
    CONVEX_DEPLOY_KEY: 'prod:hushed-mallard-700|prod-secret',
    CONVEX_DEPLOYMENT: 'prod:hushed-mallard-700',
    PUBLIC_CLERK_PUBLISHABLE_KEY: productionKey,
    PUBLIC_CONVEX_URL: PRODUCTION_CONVEX_URL,
    AI_SEARCH_PUBLIC_URL: 'https://fixture.search.ai.cloudflare.com/search',
    CLOUDFLARE_API_TOKEN: 'cf-token',
    CLERK_SECRET_KEY: 'clerk-secret',
    UNRELATED: 'keep',
  }, root);
  assert.equal(stripped.CONVEX_DEPLOY_KEY, undefined);
  assert.equal(stripped.PUBLIC_CLERK_PUBLISHABLE_KEY, undefined);
  assert.equal(stripped.PUBLIC_CONVEX_URL, undefined);
  assert.equal(stripped.AI_SEARCH_PUBLIC_URL, undefined);
  assert.equal(stripped.CLOUDFLARE_API_TOKEN, 'cf-token');
  assert.equal(stripped.CLERK_SECRET_KEY, undefined);
  assert.equal(stripped.UNRELATED, 'keep');
});

test('stripCloudflareCredentials removes Cloudflare API credentials from non-wrangler child env', () => {
  const stripped = stripCloudflareCredentials({
    CLOUDFLARE_API_TOKEN: 'cf-token',
    CLOUDFLARE_ACCOUNT_ID: 'cf-account',
    CF_API_TOKEN: 'legacy-token',
    PUBLIC_CONVEX_URL: stagingUrl,
  });
  assert.equal(stripped.CLOUDFLARE_API_TOKEN, undefined);
  assert.equal(stripped.CLOUDFLARE_ACCOUNT_ID, undefined);
  assert.equal(stripped.CF_API_TOKEN, undefined);
  assert.equal(stripped.PUBLIC_CONVEX_URL, stagingUrl);
});

test('createPreviewProcessEnv maps preview sources over stripped ambient production values', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'preview-process-root-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, 'wrangler.jsonc'), JSON.stringify({
    vars: { PUBLIC_CLERK_PUBLISHABLE_KEY: productionKey, PUBLIC_CONVEX_URL: PRODUCTION_CONVEX_URL },
  }));
  const { mapped, env } = createPreviewProcessEnv({
    ...previewEnv,
    CONVEX_DEPLOY_KEY: 'prod:hushed-mallard-700|prod-secret',
    PUBLIC_CLERK_PUBLISHABLE_KEY: productionKey,
    PUBLIC_CONVEX_URL: PRODUCTION_CONVEX_URL,
    AI_SEARCH_PUBLIC_URL: 'https://fixture.search.ai.cloudflare.com/search',
    CLOUDFLARE_API_TOKEN: 'cf-token',
  }, root);
  assert.equal(mapped.CONVEX_DEPLOY_KEY, previewEnv.PREVIEW_CONVEX_DEPLOY_KEY);
  assert.equal(env.CONVEX_DEPLOY_KEY, previewEnv.PREVIEW_CONVEX_DEPLOY_KEY);
  assert.equal(env.PUBLIC_CONVEX_URL, stagingUrl);
  assert.equal(env.PUBLIC_CLERK_PUBLISHABLE_KEY, previewKey);
  assert.equal(env.CLOUDFLARE_API_TOKEN, 'cf-token');
  assert.equal(env.PUBLIC_SITE_ENV, 'preview');
});

test('preview wrangler and convex env helpers scope Cloudflare and deploy credentials', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'preview-scope-root-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, 'wrangler.jsonc'), JSON.stringify({
    vars: { PUBLIC_CLERK_PUBLISHABLE_KEY: productionKey, PUBLIC_CONVEX_URL: PRODUCTION_CONVEX_URL },
  }));
  const ambient = {
    ...previewEnv,
    CONVEX_DEPLOY_KEY: 'prod:hushed-mallard-700|prod-secret',
    PUBLIC_CLERK_PUBLISHABLE_KEY: productionKey,
    PUBLIC_CONVEX_URL: PRODUCTION_CONVEX_URL,
    AI_SEARCH_PUBLIC_URL: 'https://fixture.search.ai.cloudflare.com/search',
    CLOUDFLARE_API_TOKEN: 'cf-token',
    CLOUDFLARE_ACCOUNT_ID: 'cf-account',
  };
  const wranglerEnv = createPreviewWranglerEnv(ambient, root);
  const convexEnv = createPreviewConvexEnv(ambient, root);
  assert.equal(wranglerEnv.CLOUDFLARE_API_TOKEN, 'cf-token');
  assert.equal(wranglerEnv.CLOUDFLARE_ACCOUNT_ID, 'cf-account');
  assert.equal(wranglerEnv.CONVEX_DEPLOY_KEY, undefined);
  assert.equal(convexEnv.CLOUDFLARE_API_TOKEN, undefined);
  assert.equal(convexEnv.CONVEX_DEPLOY_KEY, undefined);
});

test('readPreviewReaderConfig accepts development Clerk domains', () => {
  const reader = readPreviewReaderConfig({
    PUBLIC_CLERK_PUBLISHABLE_KEY: previewKey,
    PUBLIC_CONVEX_URL: stagingUrl,
    AI_SEARCH_PUBLIC_URL: previewEnv.PREVIEW_AI_SEARCH_PUBLIC_URL,
  });
  assert.equal(reader.clerkIssuerDomain, 'https://dev-fixture.clerk.accounts.dev');
});
