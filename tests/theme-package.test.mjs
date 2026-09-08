import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { themeRelease, verifyThemePackage } from '../scripts/theme-package.mjs';

const name = '@tcitry/astro-book';
const bytes = Buffer.from('published theme fixture');
const integrity = 'sha512-' + createHash('sha512').update(bytes).digest('base64');
async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'npm-theme-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const locked = { version: '0.1.1', resolved: 'https://registry.npmjs.org/@tcitry/astro-book/-/astro-book-0.1.1.tgz', integrity };
  const manifest = { dependencies: { [name]: '0.1.1' } };
  const lock = { packages: { '': manifest, ['node_modules/' + name]: locked } };
  const save = async () => {
    await writeFile(path.join(root, 'package.json'), JSON.stringify(manifest));
    await writeFile(path.join(root, 'package-lock.json'), JSON.stringify(lock));
  };
  await save();
  return { root, locked, manifest, lock, save };
}

test('registry verification validates downloaded bytes without npm credentials or local artifacts', async t => {
  const { root, locked } = await fixture(t);
  const release = await verifyThemePackage(root, async (url, options) => {
    assert.equal(url, locked.resolved);
    assert.equal(options.headers, undefined);
    return new Response(bytes);
  });
  assert.equal(release.themeVersion, '0.1.1');
  assert.equal(release.themeIntegrity, integrity);
  await assert.rejects(verifyThemePackage(root, async () => new Response('tampered')), /integrity/);
  await assert.rejects(verifyThemePackage(root, async () => new Response('', { status: 503 })), /503/);
});

test('release input rejects local dependencies, mismatched locks and non-npm artifacts', async t => {
  const { root, locked, manifest, save } = await fixture(t);
  manifest.dependencies[name] = '^0.1.1'; await save();
  await assert.rejects(themeRelease(root), /exact npm version/);
  manifest.dependencies[name] = '0.1.1'; locked.version = '0.1.0'; await save();
  await assert.rejects(themeRelease(root), /lock version/);
  locked.version = '0.1.1'; locked.resolved = 'file:.artifacts/theme.tgz'; await save();
  await assert.rejects(themeRelease(root), /public npm tarball/);
  locked.resolved = 'https://registry.npmjs.org/@tcitry/astro-book/-/astro-book-0.1.1.tgz';
  locked.integrity = 'sha512-invalid'; await save();
  await assert.rejects(themeRelease(root), /SHA-512/);
});
