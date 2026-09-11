import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseEnv } from 'node:util';
import { publicAIEndpoint } from '../src/lib/public-ai-search-url.mjs';

const wranglerPublicNames = ['PUBLIC_CLERK_PUBLISHABLE_KEY', 'PUBLIC_CONVEX_URL'];

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
  const encoded = key.slice('pk_live_'.length).replaceAll('-', '+').replaceAll('_', '/');
  const decoded = Buffer.from(encoded, 'base64');
  assert.equal(decoded.toString('base64').replace(/=+$/, ''), encoded.replace(/=+$/, ''),
    'PUBLIC_CLERK_PUBLISHABLE_KEY must contain a valid base64 instance identifier.');
  const payload = decoded.toString('utf8');
  assert.match(payload, /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}\$$/i,
    'PUBLIC_CLERK_PUBLISHABLE_KEY must be a valid Clerk production publishable key.');
  const clerkIssuerDomain = `https://${payload.slice(0, -1).toLowerCase()}`;
  assert.ok(!clerkIssuerDomain.endsWith('.clerk.accounts.dev') && !clerkIssuerDomain.endsWith('.accounts.dev'),
    'Production Clerk configuration cannot use a development instance domain.');
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
