import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRendererFingerprint } from '../scripts/renderer-cache.mjs';

test('render cache expires for theme implementation, version, compatibility or dependency changes', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'astro-book-render-cache-'));
  try {
    const themeRoot = path.join(root, 'theme');
    await mkdir(path.join(themeRoot, 'dist', 'markdown'), { recursive: true });
    const manifest = path.join(themeRoot, 'package.json');
    const themeEntry = path.join(themeRoot, 'dist', 'markdown', 'index.js');
    const internal = path.join(themeRoot, 'dist', 'markdown', 'plugins.js');
    const compatibility = path.join(root, 'compatibility.mjs');
    const lock = path.join(root, 'package-lock.json');
    await writeFile(manifest, JSON.stringify({ name: '@tcitry/astro-book', version: '0.1.0' }));
    await writeFile(themeEntry, 'export { render } from "./plugins.js";');
    await writeFile(internal, 'export const render = () => "first";');
    await writeFile(compatibility, 'export const transform = x => x;');
    await writeFile(lock, '{"lockfileVersion":3}');
    const fingerprint = () => createRendererFingerprint({ compatibilityFile: pathToFileURL(compatibility), themeEntryFile: pathToFileURL(themeEntry), dependencyLockFile: pathToFileURL(lock) });
    let previous = await fingerprint();
    assert.equal(previous, await fingerprint(), 'unchanged files retain their cache');
    for (const [filename, value] of [
      [internal, 'export const render = () => "updated";'],
      [manifest, JSON.stringify({ name: '@tcitry/astro-book', version: '0.2.0' })],
      [compatibility, 'export const transform = x => x.trim();'],
      [lock, '{"lockfileVersion":3,"version":"new"}'],
    ]) {
      await writeFile(filename, value);
      const next = await fingerprint();
      assert.notEqual(next, previous);
      previous = next;
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});
