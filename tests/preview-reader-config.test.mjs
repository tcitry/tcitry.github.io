import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PRODUCTION_CONVEX_URL,
  assertNoProductionReaderValues,
  assertPreviewDeployKey,
  assertPreviewReaderSources,
  readPreviewReaderConfig,
} from '../scripts/reader-config.mjs';

const previewKey = 'pk_test_' + Buffer.from('dev-fixture.clerk.accounts.dev$').toString('base64');
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

test('preview reader configuration rejects production values', () => {
  for (const [overrides, expected] of [
    [{ PREVIEW_PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_live_' + Buffer.from('clerk.test.invalid$').toString('base64') }, /pk_test/],
    [{ PREVIEW_PUBLIC_CONVEX_URL: PRODUCTION_CONVEX_URL }, /must not target the production Convex deployment/],
    [{ PREVIEW_CONVEX_DEPLOY_KEY: 'prod:staging-fixture-123|fixture-secret' }, /must not be a production deploy key/],
    [{ PREVIEW_CONVEX_DEPLOY_KEY: 'prod:hushed-mallard-700|fixture-secret' }, /must not be a production deploy key/],
    [{ PREVIEW_CONVEX_DEPLOY_KEY: 'dev:other-deployment|fixture-secret' }, /same staging deployment/],
    [{ PREVIEW_AI_SEARCH_PUBLIC_URL: 'https://outside.example/search' }, /PREVIEW_AI_SEARCH_PUBLIC_URL/],
  ]) {
    assert.throws(() => assertPreviewReaderSources({ ...previewEnv, ...overrides }), new RegExp(expected));
  }
});

test('preview guardrails reject shared production environment variables', () => {
  assert.throws(() => assertNoProductionReaderValues({
    PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_live_' + Buffer.from('clerk.test.invalid$').toString('base64'),
  }), /production Clerk publishable key/);
  assert.throws(() => assertNoProductionReaderValues({ PUBLIC_CONVEX_URL: PRODUCTION_CONVEX_URL }), /production Convex URL/);
  assert.throws(() => assertNoProductionReaderValues({ CONVEX_DEPLOY_KEY: 'prod:hushed-mallard-700|secret' }), /production Convex deploy key/);
  assert.doesNotThrow(() => assertNoProductionReaderValues({ PUBLIC_CONVEX_URL: stagingUrl }));
});

test('readPreviewReaderConfig accepts development Clerk domains', () => {
  const reader = readPreviewReaderConfig({
    PUBLIC_CLERK_PUBLISHABLE_KEY: previewKey,
    PUBLIC_CONVEX_URL: stagingUrl,
    AI_SEARCH_PUBLIC_URL: previewEnv.PREVIEW_AI_SEARCH_PUBLIC_URL,
  });
  assert.equal(reader.clerkIssuerDomain, 'https://dev-fixture.clerk.accounts.dev');
});
