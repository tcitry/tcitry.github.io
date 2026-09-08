import assert from 'node:assert/strict';
import { readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assetHashes, cleanCommit, releaseInputs, releaseCorpus } from './release-manifest.mjs';
import { run } from './theme-package.mjs';
import { withoutReaderSecrets } from './reader-config.mjs';
import { assertBuiltReaderConfig } from './reader-build.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, '.generated/release.json');
try {
  // A failed verification must never leave a previously valid deployment seal.
  await rm(output, { force: true });
  assert.ok(process.env.BLOG_DIR, 'Set BLOG_DIR to the reviewed, isolated content checkout');
  const content = path.resolve(process.env.BLOG_DIR);
  const reader = await assertBuiltReaderConfig(root);
  const [inputs, contentCommit, assets] = await Promise.all([
    releaseInputs(root), cleanCommit(content), assetHashes(path.join(root, 'dist')),
  ]);
  if (process.env.BLOG_CONTENT_COMMIT) assert.equal(contentCommit, process.env.BLOG_CONTENT_COMMIT, 'Content does not match BLOG_CONTENT_COMMIT');
  const aiSearch = await releaseCorpus(root, { ...inputs, contentCommit, assets });
  const env = { ...withoutReaderSecrets(process.env), PUBLIC_SITE_ENV: 'production' };
  for (const name of Object.keys(env)) {
    if (/^(?:CLOUDFLARE_|CF_)/.test(name) || ['BLOG_READ_TOKEN', 'HEROUI_AUTH_TOKEN', 'GITHUB_TOKEN', 'GH_TOKEN'].includes(name)) delete env[name];
  }
  await run(process.execPath, ['scripts/verify-build.mjs', '--env', 'production'], root, false, env);
  const verification = JSON.parse(await readFile(path.join(root, '.generated/verification.json'), 'utf8'));
  assert.equal(verification.environment, 'production', 'Production verification did not complete');
  assert.deepEqual(await releaseInputs(root), inputs, 'Release source changed during verification');
  assert.equal(await cleanCommit(content), contentCommit, 'Content changed during verification');
  assert.deepEqual(await assetHashes(path.join(root, 'dist')), assets, 'Assets changed during verification');
  assert.deepEqual(await assertBuiltReaderConfig(root), reader, 'Reader build configuration changed during verification.');
  assert.deepEqual(await releaseCorpus(root, { ...inputs, contentCommit, assets }), aiSearch, 'AI Search corpus changed during verification');
  await writeFile(output, JSON.stringify({ version: 3, environment: 'production', ...inputs,
    contentCommit, reader, verifiedAt: verification.checkedAt, assets, ...(aiSearch ? { aiSearch } : {}) }, null, 2) + '\n');
  console.log(`Sealed ${Object.keys(assets).length} verified assets. Deploy with npm run deploy:verified; do not rebuild this directory.`);
} catch (error) {
  // Git diagnostics may include private checkout paths; keep failures generic.
  console.error(error instanceof assert.AssertionError ? error.message.split('\n')[0] : 'Could not seal the release. Check the isolated checkouts and production verification.');
  process.exitCode = 1;
}
