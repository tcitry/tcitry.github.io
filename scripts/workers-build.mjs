import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { assertProductionDeployKey, loadReaderEnvironment, readProductionReaderConfig } from './reader-config.mjs';
import { assertProductionWorkersBranch } from './ci-branch.mjs';
import { BuildError, runWorkersContentBuild } from './workers-build-shared.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));

async function main() {
  assertProductionWorkersBranch();
  const siteEnvironment = process.env.PUBLIC_SITE_ENV ?? 'production';
  if (siteEnvironment !== 'production') {
    throw new BuildError('build:workers only supports PUBLIC_SITE_ENV=production. For Workers Builds previews, use npm run build:preview.');
  }
  const readerEnv = loadReaderEnvironment(root, process.env, 'production');
  const reader = readProductionReaderConfig(readerEnv);
  assertProductionDeployKey(readerEnv, reader);
  await runWorkersContentBuild({
    root,
    siteEnvironment,
    validateConfiguration: async () => {},
    npmSteps: [
      { script: 'setup' },
      { script: 'build' },
      { script: 'check' },
      { script: 'test' },
      { verifyRevisions: true, script: 'verify:release' },
    ],
    successMessage: 'Production build verified and sealed. Workers Builds can now run npm run deploy:verified without rebuilding.',
  });
}

try {
  await main();
} catch (error) {
  console.error(error instanceof BuildError || error instanceof assert.AssertionError ? error.message.split('\n')[0] : 'Workers build failed. Check the build environment.');
  process.exitCode = 1;
}
