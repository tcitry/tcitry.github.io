import assert from 'node:assert/strict';
import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertSealedRelease, assetHashes } from './release-manifest.mjs';
import { run } from './theme-package.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
try {
  const manifest = JSON.parse(await readFile(path.join(root, '.generated/release.json'), 'utf8'));
  const assets = await assertSealedRelease(root, manifest);
  if (manifest.aiSearch) {
    assert.ok(process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CLOUDFLARE_API_TOKEN,
      'Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN with deployment and AI Search permissions before publishing. Wrangler OAuth alone does not authenticate article sync.');
    const { syncAISearch } = await import('./sync-ai-search.mjs');
    // Validate remote access and metadata before switching the public site.
    await syncAISearch({ apply: false });
  }
  await rm(path.join(root, '.generated/deployment.json'), { force: true });
  const env = { ...process.env };
  for (const name of ['BLOG_READ_TOKEN', 'BLOG_CONTENT_REPOSITORY', 'BLOG_CONTENT_COMMIT', 'HEROUI_AUTH_TOKEN', 'GITHUB_TOKEN', 'GH_TOKEN']) delete env[name];
  console.log(`Deploying ${Object.keys(assets).length} sealed production assets without rebuilding.`);
  // Use the installed, lockfile-pinned CLI. Never download a different Wrangler.
  await run(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'deploy'], root, false, env);
  assert.deepEqual(await assetHashes(path.join(root, 'dist')), assets,
    'Assets changed during upload. Check the active production version, then rebuild and redeploy from an isolated checkout.');
  console.log('Deployment finished; all sealed assets remained unchanged during upload.');
  await assertSealedRelease(root, manifest);
  if (manifest.aiSearch) {
    // The online release marker verifies the published revision before ingestion.
    // Sync failure leaves the site available, returns nonzero, and is retryable.
    await run(process.execPath, ['scripts/verify-deployment.mjs', '--env', 'production'], root, false, env);
    await run(process.execPath, ['scripts/verify-ai-search-deployment.mjs'], root, false, env);
    await run(process.execPath, ['scripts/sync-ai-search.mjs', '--apply'], root, false, env);
  }
} catch (error) {
  console.error(error instanceof assert.AssertionError ? error.message.split('\n')[0] : 'Verified deployment failed. Run npm run verify:release in the isolated release checkout and check the Wrangler output.');
  process.exitCode = 1;
}
