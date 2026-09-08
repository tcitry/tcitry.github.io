import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { assertSealedRelease } from './release-manifest.mjs';
import { assertProductionDeployKey, readProductionReaderConfig } from './reader-config.mjs';

// Convex runs this command with its canonical URL before pushing any functions.
// Never build or invoke dependency scripts here: the CLI callback inherits its key.
try {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const manifest = JSON.parse(await readFile(new URL('../.generated/release.json', import.meta.url), 'utf8'));
  await assertSealedRelease(root, manifest);
  const config = readProductionReaderConfig(process.env);
  assertProductionDeployKey(process.env, config);
  assert.deepEqual(config, manifest.reader, 'Reader configuration changed after production verification.');
  assert.equal(process.env.CONVEX_DEPLOYMENT_URL, config.convexUrl,
    'Convex CLI target differs from the verified PUBLIC_CONVEX_URL; backend and frontend deployment stopped.');
  console.log('Convex production target matches the sealed frontend configuration.');
} catch (error) {
  console.error(error instanceof assert.AssertionError ? error.message.split('\n')[0] : 'Could not verify the Convex deployment target against the sealed release.');
  process.exitCode = 1;
}
