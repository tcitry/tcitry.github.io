import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseEnv } from 'node:util';
import { publicAIEndpoint } from '../src/lib/public-ai-search-url.mjs';

const wranglerPublicNames = ['PUBLIC_CLERK_PUBLISHABLE_KEY', 'PUBLIC_CONVEX_URL'];
export const PRODUCTION_CONVEX_URL = 'https://hushed-mallard-700.convex.cloud';
const previewSourceNames = {
  PUBLIC_CLERK_PUBLISHABLE_KEY: 'PREVIEW_PUBLIC_CLERK_PUBLISHABLE_KEY',
  PUBLIC_CONVEX_URL: 'PREVIEW_PUBLIC_CONVEX_URL',
  AI_SEARCH_PUBLIC_URL: 'PREVIEW_AI_SEARCH_PUBLIC_URL',
  CONVEX_DEPLOY_KEY: 'PREVIEW_CONVEX_DEPLOY_KEY',
};

function wranglerPublicVars(root) {
  let config;
  try { config = JSON.parse(readFileSync(path.join(root, 'wrangler.jsonc'), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT' || error instanceof SyntaxError) return {}; throw error; }
  const vars = config?.vars && typeof config.vars === 'object' ? config.vars : {};
  return Object.fromEntries(wranglerPublicNames.filter(name => typeof vars[name] === 'string' && vars[name]).map(name => [name, vars[name]]));
}

// Follow Astro/Vite's file precedence. Keep credentials in ignored local files;
// examples use literal values so configuration never depends on shell expansion.
// Production mode also reads wrangler.jsonc vars as the committed public defaults.
export function loadReaderEnvironment(root, env = process.env, mode = 'production') {
  const loaded = mode === 'production' ? wranglerPublicVars(root) : {};
  for (const file of ['.env', '.env.local', `.env.${mode}`, `.env.${mode}.local`]) {
    try { Object.assign(loaded, parseEnv(readFileSync(path.join(root, file), 'utf8'))); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return { ...loaded, ...env };
}

export function readProductionReaderConfig(env) {
  const key = env.PUBLIC_CLERK_PUBLISHABLE_KEY;
  assert.ok(typeof key === 'string' && /^pk_live_[A-Za-z0-9+/_=-]+$/.test(key),
    'Set PUBLIC_CLERK_PUBLISHABLE_KEY to the Clerk production pk_live key; development keys cannot be published.');
  const clerkIssuerDomain = clerkIssuerFromPublishableKey(key, { production: true });
  const rawUrl = env.PUBLIC_CONVEX_URL;
  assert.ok(typeof rawUrl === 'string' && /^https:\/\/[a-z0-9]+(?:-[a-z0-9]+)*\.convex\.cloud\/?$/.test(rawUrl),
    'Set PUBLIC_CONVEX_URL to the production Convex HTTPS deployment URL (*.convex.cloud).');
  return { clerkPublishableKey: key, clerkIssuerDomain, convexUrl: rawUrl.replace(/\/$/, ''),
    aiSearchUrl: readProductionSearchURL(env) };
}

// Keep production failures at build/preflight time, before a broken anonymous
// search can be deployed. The browser adapter validates this boundary as well.
export function readProductionSearchURL(env) {
  const value = env.AI_SEARCH_PUBLIC_URL;
  const message = 'Set AI_SEARCH_PUBLIC_URL to the existing AI Search HTTPS Public endpoint origin or /search URL before a production build.';
  try { return publicAIEndpoint(value); } catch { assert.fail(message); }
}

export function assertProductionDeployKey(env, config = readProductionReaderConfig(env)) {
  const match = /^prod:([a-z0-9]+(?:-[a-z0-9]+)*)\|[A-Za-z0-9+/_=-]+$/.exec(env.CONVEX_DEPLOY_KEY ?? '');
  assert.ok(match, 'Set CONVEX_DEPLOY_KEY to a production deployment key (prod:…); dev, preview and project keys cannot deploy production.');
  assert.equal(`https://${match[1]}.convex.cloud`, config.convexUrl,
    'CONVEX_DEPLOY_KEY must target the same production deployment as PUBLIC_CONVEX_URL.');
}

export function assertClerkIssuer(issuer, config) {
  assert.ok(typeof issuer === 'string' && issuer.trim().replace(/\/$/, '') === config.clerkIssuerDomain,
    'Set CLERK_FRONTEND_API_URL in the target Convex production deployment to the Clerk production Frontend API URL matching PUBLIC_CLERK_PUBLISHABLE_KEY.');
}

export function assertConvexSearchURL(value, config) {
  const message = 'Set AI_SEARCH_PUBLIC_URL in the target Convex production deployment to the same AI Search Public endpoint as the build AI_SEARCH_PUBLIC_URL (origin, /search or /chat/completions).';
  let normalized;
  try { normalized = publicAIEndpoint(value, {allowChatPath: true}); }
  catch { assert.fail(message); }
  assert.ok(normalized === config.aiSearchUrl, message);
}

export function withoutReaderSecrets(env) {
  return Object.fromEntries(Object.entries(env).filter(([name]) => !name.startsWith('CONVEX_') && !name.startsWith('CLERK_')));
}

function clerkIssuerFromPublishableKey(key, { production }) {
  assert.ok(typeof key === 'string' && (production ? /^pk_live_/ : /^pk_test_/).test(key),
    production
      ? 'Set PUBLIC_CLERK_PUBLISHABLE_KEY to the Clerk production pk_live key; development keys cannot be published.'
      : 'Set PREVIEW_PUBLIC_CLERK_PUBLISHABLE_KEY to a Clerk development pk_test key.');
  const encoded = key.slice(production ? 'pk_live_'.length : 'pk_test_'.length).replaceAll('-', '+').replaceAll('_', '/');
  const decoded = Buffer.from(encoded, 'base64');
  assert.equal(decoded.toString('base64').replace(/=+$/, ''), encoded.replace(/=+$/, ''),
    `${production ? 'PUBLIC_CLERK_PUBLISHABLE_KEY' : 'PREVIEW_PUBLIC_CLERK_PUBLISHABLE_KEY'} must contain a valid base64 instance identifier.`);
  const payload = decoded.toString('utf8');
  assert.match(payload, /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}\$$/i,
    `${production ? 'PUBLIC_CLERK_PUBLISHABLE_KEY' : 'PREVIEW_PUBLIC_CLERK_PUBLISHABLE_KEY'} must be a valid Clerk publishable key.`);
  const clerkIssuerDomain = `https://${payload.slice(0, -1).toLowerCase()}`;
  if (production) {
    assert.ok(!clerkIssuerDomain.endsWith('.clerk.accounts.dev') && !clerkIssuerDomain.endsWith('.accounts.dev'),
      'Production Clerk configuration cannot use a development instance domain.');
  }
  return clerkIssuerDomain;
}

export function mapPreviewReaderSources(env = process.env) {
  const mapped = {};
  for (const [target, source] of Object.entries(previewSourceNames)) {
    const value = env[source];
    assert.ok(typeof value === 'string' && value.trim() && !/[\r\n\0]/.test(value),
      `Set ${source} before starting a Workers Builds preview.`);
    mapped[target] = value.trim();
  }
  return mapped;
}

export function readPreviewReaderConfig(env) {
  const key = env.PUBLIC_CLERK_PUBLISHABLE_KEY;
  assert.ok(typeof key === 'string' && /^pk_test_[A-Za-z0-9+/_=-]+$/.test(key),
    'PREVIEW_PUBLIC_CLERK_PUBLISHABLE_KEY must be a Clerk development pk_test key.');
  assert.ok(!/^pk_live_/.test(env.PUBLIC_CLERK_PUBLISHABLE_KEY ?? ''),
    'Preview builds cannot use a production Clerk publishable key.');
  const clerkIssuerDomain = clerkIssuerFromPublishableKey(key, { production: false });
  const rawUrl = env.PUBLIC_CONVEX_URL;
  assert.ok(typeof rawUrl === 'string' && /^https:\/\/[a-z0-9]+(?:-[a-z0-9]+)*\.convex\.cloud\/?$/.test(rawUrl),
    'PREVIEW_PUBLIC_CONVEX_URL must be the shared staging Convex HTTPS deployment URL (*.convex.cloud).');
  const convexUrl = rawUrl.replace(/\/$/, '');
  assert.notEqual(convexUrl, PRODUCTION_CONVEX_URL,
    'PREVIEW_PUBLIC_CONVEX_URL must not target the production Convex deployment (hushed-mallard-700).');
  return { clerkPublishableKey: key, clerkIssuerDomain, convexUrl, aiSearchUrl: readPreviewSearchURL(env) };
}

export function readPreviewSearchURL(env) {
  const value = env.AI_SEARCH_PUBLIC_URL;
  const message = 'Set PREVIEW_AI_SEARCH_PUBLIC_URL to the staging AI Search HTTPS Public endpoint origin or /search URL before a preview build.';
  try { return publicAIEndpoint(value); } catch { assert.fail(message); }
}

export function assertPreviewDeployKey(env, config = readPreviewReaderConfig(env)) {
  const key = env.CONVEX_DEPLOY_KEY ?? '';
  assert.ok(!/^prod:/.test(key), 'PREVIEW_CONVEX_DEPLOY_KEY must not be a production deploy key (prod:…).');
  const devMatch = /^dev:([a-z0-9]+(?:-[a-z0-9]+)*)\|[A-Za-z0-9+/_=-]+$/.exec(key);
  const previewMatch = /^preview:[^|]+\|[A-Za-z0-9+/_=-]+$/.exec(key);
  const projectMatch = /^project:[^|]+\|[A-Za-z0-9+/_=-]+$/.exec(key);
  assert.ok(devMatch || previewMatch || projectMatch,
    'Set PREVIEW_CONVEX_DEPLOY_KEY to a staging deployment key (dev:, preview: or project:); production keys cannot deploy previews.');
  if (devMatch) {
    assert.equal(`https://${devMatch[1]}.convex.cloud`, config.convexUrl,
      'PREVIEW_CONVEX_DEPLOY_KEY must target the same staging deployment as PREVIEW_PUBLIC_CONVEX_URL.');
  }
}

export function assertPreviewReaderSources(env = process.env) {
  const mapped = mapPreviewReaderSources(env);
  const reader = readPreviewReaderConfig(mapped);
  assertPreviewDeployKey({ ...mapped, CONVEX_DEPLOY_KEY: mapped.CONVEX_DEPLOY_KEY }, reader);
  return { mapped, reader };
}

export function assertNoProductionReaderValues(env = process.env) {
  if (typeof env.PUBLIC_CLERK_PUBLISHABLE_KEY === 'string' && /^pk_live_/.test(env.PUBLIC_CLERK_PUBLISHABLE_KEY)) {
    assert.fail('Preview Workers Builds cannot use a production Clerk publishable key. Configure PREVIEW_PUBLIC_CLERK_PUBLISHABLE_KEY instead.');
  }
  const convexUrl = env.PUBLIC_CONVEX_URL?.replace(/\/$/, '');
  if (convexUrl === PRODUCTION_CONVEX_URL) {
    assert.fail('Preview Workers Builds cannot use the production Convex URL. Configure PREVIEW_PUBLIC_CONVEX_URL instead.');
  }
  if (typeof env.CONVEX_DEPLOY_KEY === 'string' && /^prod:/.test(env.CONVEX_DEPLOY_KEY)) {
    assert.fail('Preview Workers Builds cannot use a production Convex deploy key. Configure PREVIEW_CONVEX_DEPLOY_KEY instead.');
  }
}
