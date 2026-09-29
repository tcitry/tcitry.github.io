import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { assertPreviewReaderSources, stripAmbientProductionEnv } from './reader-config.mjs';
import { assertPreviewWorkersBranch } from './ci-branch.mjs';
import { BuildError, runWorkersContentBuild } from './workers-build-shared.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));

async function main() {
  assertPreviewWorkersBranch();
  const { mapped } = assertPreviewReaderSources();
  const { CONVEX_DEPLOY_KEY: _deployKey, ...readerBuildEnv } = mapped;
  const siteEnvironment = 'preview';
  await runWorkersContentBuild({
    root,
    siteEnvironment,
    validateConfiguration: async () => {},
    sanitizeBaseEnv: base => stripAmbientProductionEnv(base, root),
    npmSteps: [
      { script: 'setup' },
      { script: 'build', env: readerBuildEnv },
      { script: 'check', env: readerBuildEnv },
      { script: 'test' },
      { verifyRevisions: true, script: 'finalize-preview-build', env: readerBuildEnv },
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
