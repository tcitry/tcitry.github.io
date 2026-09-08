import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

export async function cleanCommit(directory) {
  const git = args => execute('git', ['-C', directory, ...args], { encoding: 'utf8' });
  const [head, status] = await Promise.all([
    git(['rev-parse', 'HEAD']), git(['status', '--porcelain', '--untracked-files=normal']),
  ]);
  assert.match(head.stdout.trim(), /^[a-f0-9]{40}$/, 'Release source must have a full Git commit');
  assert.equal(status.stdout.trim(), '', 'Release source must be a clean, isolated checkout');
  return head.stdout.trim();
}

export async function assetHashes(directory) {
  assert.ok((await lstat(directory)).isDirectory(), 'Release assets must be a real directory');
  const hashes = {};
  async function walk(current) {
    const entries = await readdir(current, { withFileTypes: true });
    entries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    for (const entry of entries) {
      assert.ok(!entry.isSymbolicLink(), 'Release assets must not contain symlinks');
      const file = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(file);
      else {
        assert.ok(entry.isFile(), 'Release assets must contain only regular files');
        hashes[path.relative(directory, file).split(path.sep).join('/')] = sha256(await readFile(file));
      }
    }
  }
  await walk(directory);
  assert.ok(Object.keys(hashes).length, 'Release assets must not be empty');
  return hashes;
}

export async function releaseInputs(root) {
  const [siteCommit, config, source] = await Promise.all([
    cleanCommit(root), readFile(path.join(root, 'wrangler.jsonc')),
    readFile(path.join(root, 'astro-book.source.json'), 'utf8').then(JSON.parse),
  ]);
  assert.match(source.commit, /^[a-f0-9]{40}$/, 'Release theme must have a pinned commit');
  return { siteCommit, themeCommit: source.commit, wranglerHash: sha256(config) };
}

// Static-only fixtures/releases remain supported. A Worker that imports the
// generated public references must seal those bytes along with its assets.
export async function releaseCorpus(root, release) {
  const config = JSON.parse(await readFile(path.join(root, 'wrangler.jsonc'), 'utf8'));
  if (config.main !== 'worker/index.ts') return null;
  const { assertCorpusRelease } = await import('./lib/ai-search-corpus.mjs');
  return (await assertCorpusRelease(root, release)).seal;
}

export async function assertSealedRelease(root, manifest) {
  assert.equal(manifest.version, 2, 'Unsupported release manifest; rebuild and verify with the current production release scripts');
  assert.equal(manifest.environment, 'production', 'Only a verified production release can deploy');
  assert.match(manifest.contentCommit, /^[a-f0-9]{40}$/, 'Release must record its reviewed content commit');
  const inputs = await releaseInputs(root);
  for (const key of Object.keys(inputs)) assert.equal(manifest[key], inputs[key], `Release ${key} changed after verification`);
  const reader = JSON.parse(await readFile(path.join(root, '.generated/reader-build.json'), 'utf8'));
  assert.deepEqual(reader, manifest.reader, 'Reader build configuration changed after verification');
  const assets = await assetHashes(path.join(root, 'dist'));
  assert.deepEqual(assets, manifest.assets, 'Release assets changed after verification; rebuild and verify in an isolated checkout');
  const aiSearch = await releaseCorpus(root, manifest);
  if (aiSearch) assert.deepEqual(manifest.aiSearch, aiSearch, 'AI Search corpus changed after verification');
  return assets;
}
