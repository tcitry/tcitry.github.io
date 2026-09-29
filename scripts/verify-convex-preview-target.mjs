import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { assertPreviewDeployKey, readPreviewReaderConfig } from './reader-config.mjs';

try {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const manifest = JSON.parse(await readFile(path.join(root, '.generated/preview-build.json'), 'utf8'));
  assert.equal(manifest.environment, 'preview', 'Preview Convex deploy requires a sealed preview build.');
  const config = readPreviewReaderConfig(process.env);
  assertPreviewDeployKey(process.env, config);
  assert.deepEqual(config, manifest.reader, 'Reader configuration changed after preview verification.');
  assert.equal(process.env.CONVEX_DEPLOYMENT_URL, config.convexUrl,
    'Convex CLI target differs from the verified PREVIEW_PUBLIC_CONVEX_URL; backend and frontend deployment stopped.');
  console.log('Convex preview target matches the sealed frontend configuration.');
} catch (error) {
  console.error(error instanceof assert.AssertionError ? error.message.split('\n')[0] : 'Could not verify the Convex preview deployment target against the sealed preview build.');
  process.exitCode = 1;
}
