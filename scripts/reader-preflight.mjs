import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { loadReaderEnvironment, readProductionReaderConfig } from './reader-config.mjs';

try {
  readProductionReaderConfig(loadReaderEnvironment(fileURLToPath(new URL('../', import.meta.url))));
  console.log('Production reader public configuration is valid. Remote Convex deployment and Clerk issuer are checked again before deployment.');
} catch (error) {
  console.error(error instanceof assert.AssertionError ? error.message.split('\n')[0] : 'Could not read the local production reader configuration.');
  process.exitCode = 1;
}
