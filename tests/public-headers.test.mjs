import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../scripts/prepare-assets.mjs', import.meta.url), 'utf8');

test('hashed Astro assets send CORS headers so Vite CSS preloads can load', () => {
  assert.match(source, /\/_astro\/\*/);
  assert.match(source, /Access-Control-Allow-Origin: \*/);
});
