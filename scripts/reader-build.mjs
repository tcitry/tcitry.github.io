import assert from 'node:assert/strict';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { loadReaderEnvironment, readProductionReaderConfig } from './reader-config.mjs';

export function readerBuildIntegration({ root, production, readerConfig }) {
  // Capture the exact values passed to vite.define now. Never reconstruct this
  // snapshot from .env files after compilation: they may have changed meanwhile.
  const captured = Object.freeze({ ...readerConfig });
  const generated = path.join(root, '.generated');
  return {
    name: 'reader-build-config',
    hooks: {
      'astro:build:start': async () => {
        await rm(path.join(generated, 'release.json'), { force: true });
        await rm(path.join(generated, 'reader-build.json'), { force: true });
      },
      'astro:build:done': async () => {
        if (!production) return;
        await mkdir(generated, { recursive: true });
        await writeFile(path.join(generated, 'reader-build.json'), JSON.stringify(captured, null, 2) + '\n');
      },
    },
  };
}

export async function assertBuiltReaderConfig(root, env = loadReaderEnvironment(root)) {
  const captured = JSON.parse(await readFile(path.join(root, '.generated/reader-build.json'), 'utf8'));
  const configured = readProductionReaderConfig(env);
  assert.ok(isDeepStrictEqual(configured, captured),
    'Production reader configuration differs from the compiled assets; rebuild before sealing.');
  return captured;
}
