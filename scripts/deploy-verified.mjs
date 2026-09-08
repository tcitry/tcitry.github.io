import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { assertSealedRelease, assetHashes } from './release-manifest.mjs';
import { assertClerkIssuer, assertProductionDeployKey, loadReaderEnvironment, readProductionReaderConfig, withoutReaderSecrets } from './reader-config.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const execute = promisify(execFile);
const convexEnvFile = path.join(root, '.generated/convex-release.env');

try {
  const manifest = JSON.parse(await readFile(path.join(root, '.generated/release.json'), 'utf8'));
  const assets = await assertSealedRelease(root, manifest);
  const configured = loadReaderEnvironment(root);
  const reader = readProductionReaderConfig(configured);
  assert.deepEqual(reader, manifest.reader, 'Reader configuration changed after production verification.');
  assertProductionDeployKey(configured, reader);
  const env = withoutReaderSecrets(configured);
  await rm(path.join(root, '.generated/deployment.json'), { force: true });
  for (const name of ['BLOG_READ_TOKEN', 'BLOG_CONTENT_REPOSITORY', 'BLOG_CONTENT_COMMIT', 'HEROUI_AUTH_TOKEN', 'GITHUB_TOKEN', 'GH_TOKEN']) delete env[name];
  const convexEnv = { ...env, CONVEX_DEPLOY_KEY: configured.CONVEX_DEPLOY_KEY };
  for (const name of Object.keys(convexEnv)) {
    if (/^(?:CLOUDFLARE_|CF_)/.test(name) || /^(?:SENTRY_AUTH_TOKEN|GH_ENTERPRISE_TOKEN|GITHUB_ENTERPRISE_TOKEN|GIT_CONFIG_PARAMETERS|GIT_CONFIG_COUNT)$/.test(name)) delete convexEnv[name];
  }
  // Capture output before printing so even a CLI failure cannot echo credentials.
  const secretValues = Object.entries(configured).filter(([name, value]) => value && /(?:TOKEN|SECRET|PASSWORD|DEPLOY_KEY|ADMIN_KEY)/.test(name))
    .flatMap(([, value]) => [value, encodeURIComponent(value)]);
  const redact = value => secretValues.reduce((output, secret) => output.replaceAll(secret, '[redacted]'), String(value ?? ''));
  async function run(label, args, commandEnv, quiet = false) {
    console.log(label);
    try {
      const result = await execute(process.execPath, args, { cwd: root, env: commandEnv, maxBuffer: 32 * 1024 * 1024 });
      if (!quiet) {
        process.stdout.write(redact(result.stdout));
        process.stderr.write(redact(result.stderr));
      }
      return result.stdout;
    } catch (error) {
      if (!quiet) {
        process.stdout.write(redact(error.stdout));
        process.stderr.write(redact(error.stderr));
      }
      throw new Error(`${label} failed`);
    }
  }
  if (manifest.aiSearch) {
    assert.ok(process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CLOUDFLARE_API_TOKEN,
      'Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN with deployment and AI Search permissions before publishing. Wrangler OAuth alone does not authenticate article sync.');
    // Check remote access and metadata before changing either deployed backend.
    // The sync process receives no Convex deploy key or Clerk credentials.
    await run('Checking AI Search access and the article sync plan', ['scripts/sync-ai-search.mjs', '--dry-run'], env);
  }
  // --env-file replaces CLI deployment selection rather than supplementing it.
  // Use a short-lived, ignored file containing only the validated production key
  // so the CLI cannot reload development selection or secrets from .env.local.
  await rm(convexEnvFile, { force: true });
  await writeFile(convexEnvFile, `CONVEX_DEPLOY_KEY=${configured.CONVEX_DEPLOY_KEY}\n`, { mode: 0o600, flag: 'wx' });
  const convex = ['node_modules/convex/bin/main.js'];
  const issuer = await run('Checking the production Clerk issuer in Convex',
    [...convex, 'env', 'get', 'CLERK_JWT_ISSUER_DOMAIN', '--env-file', convexEnvFile], convexEnv, true);
  assertClerkIssuer(issuer.trim(), reader);
  await run('Deploying the verified Convex backend', [...convex, 'deploy', '--yes', '--typecheck', 'enable', '--codegen', 'disable',
    '--env-file', convexEnvFile, '--cmd', 'node scripts/verify-convex-target.mjs',
    '--cmd-url-env-var-name', 'CONVEX_DEPLOYMENT_URL'], convexEnv);
  // Backend failure stops here. Also reject any local change before Worker upload.
  await assertSealedRelease(root, manifest);
  console.log(`Deploying ${Object.keys(assets).length} sealed production assets without rebuilding.`);
  // Use the installed, lockfile-pinned CLI. Never download a different Wrangler.
  await run('Uploading the verified Worker assets', ['node_modules/wrangler/bin/wrangler.js', 'deploy'], env);
  assert.deepEqual(await assetHashes(path.join(root, 'dist')), assets,
    'Assets changed during upload. Check the active production version, then rebuild and redeploy from an isolated checkout.');
  console.log('Deployment finished; all sealed assets remained unchanged during upload.');
  await assertSealedRelease(root, manifest);
  if (manifest.aiSearch) {
    // The online release marker verifies the published revision before ingestion.
    // Sync failure leaves the site available, returns nonzero, and is retryable.
    const verificationEnv = { ...env };
    for (const name of Object.keys(verificationEnv)) {
      if (/^(?:CLOUDFLARE_|CF_)/.test(name) || /(?:TOKEN|SECRET|PASSWORD|DEPLOY_KEY|ADMIN_KEY)/.test(name)) delete verificationEnv[name];
    }
    await run('Verifying the published site', ['scripts/verify-deployment.mjs', '--env', 'production'], verificationEnv);
    await run('Verifying the published AI Search corpus and chat API', ['scripts/verify-ai-search-deployment.mjs'], verificationEnv);
    await run('Synchronizing verified published articles', ['scripts/sync-ai-search.mjs', '--apply'], env);
  }
} catch (error) {
  console.error(error instanceof assert.AssertionError ? error.message.split('\n')[0] : 'Verified deployment failed. Check the Convex/Worker deployment result; the next deployment step did not run.');
  process.exitCode = 1;
} finally {
  await rm(convexEnvFile, { force: true });
}
