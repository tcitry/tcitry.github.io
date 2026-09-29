import assert from 'node:assert/strict';
import { readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveWorkersBranch } from './ci-branch.mjs';
import { createPreviewProcessEnv, readPreviewReaderConfig, stripCloudflareCredentials } from './reader-config.mjs';
import { cleanCommit } from './release-manifest.mjs';
import { run } from './theme-package.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, '.generated/preview-build.json');

try {
  await rm(output, { force: true });
  assert.ok(process.env.BLOG_DIR, 'Set BLOG_DIR to the reviewed, isolated content checkout');
  const { mapped, env: previewEnv } = createPreviewProcessEnv(process.env, root);
  const reader = readPreviewReaderConfig(mapped);
  const env = stripCloudflareCredentials(previewEnv);
  for (const name of ['BLOG_READ_TOKEN', 'HEROUI_AUTH_TOKEN', 'GITHUB_TOKEN', 'GH_TOKEN', 'CONVEX_DEPLOY_KEY']) delete env[name];
  await run(process.execPath, ['scripts/verify-build.mjs', '--env', 'preview'], root, false, env);
  const verification = JSON.parse(await readFile(path.join(root, '.generated/verification.json'), 'utf8'));
  assert.equal(verification.environment, 'preview', 'Preview verification did not complete');
  const [siteCommit, release] = await Promise.all([
    cleanCommit(root),
    readFile(path.join(root, 'dist/blog-release.json'), 'utf8').then(JSON.parse),
  ]);
  assert.equal(process.env.BLOG_CONTENT_COMMIT, release.contentCommit, 'Preview content commit does not match the built release marker');
  await writeFile(output, JSON.stringify({
    version: 1,
    environment: 'preview',
    branch: resolveWorkersBranch(),
    siteCommit,
    contentCommit: release.contentCommit,
    reader,
    verifiedAt: verification.checkedAt,
  }, null, 2) + '\n');
  console.log(`Preview build sealed for branch ${resolveWorkersBranch() ?? '(unknown)'}. Deploy with npm run deploy:preview; do not rebuild this directory.`);
} catch (error) {
  console.error(error instanceof assert.AssertionError ? error.message.split('\n')[0] : 'Could not seal the preview build. Check the isolated checkout and preview verification.');
  process.exitCode = 1;
}
