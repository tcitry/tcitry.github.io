import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { assertNoProductionReaderValues, assertPreviewReaderSources } from './reader-config.mjs';
import { assertPreviewWorkersBranch } from './ci-branch.mjs';
import { BuildError, runWorkersContentBuild } from './workers-build-shared.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));

async function main() {
  assertPreviewWorkersBranch();
  assertNoProductionReaderValues();
  const { mapped } = assertPreviewReaderSources();
  const siteEnvironment = 'preview';
  await runWorkersContentBuild({
    root,
    siteEnvironment,
    validateConfiguration: async () => {},
    npmSteps: [
      { script: 'setup' },
      { script: 'build', env: mapped },
      { script: 'check', env: mapped },
      { script: 'test', env: mapped },
      { verifyRevisions: true, script: 'finalize-preview-build', env: mapped },
    ],
    successMessage: 'Preview build verified. Workers Builds can now run npm run deploy:preview without rebuilding.',
  });
}

try {
  await main();
} catch (error) {
  console.error(error instanceof BuildError || error instanceof assert.AssertionError ? error.message.split('\n')[0] : 'Preview build failed. Check the preview build environment.');
  process.exitCode = 1;
}
