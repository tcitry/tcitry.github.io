import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

async function packageRoot(entry) {
  let directory = path.dirname(fileURLToPath(entry));
  while (true) {
    try {
      const manifest = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'));
      if (manifest.name === '@tcitry/astro-book') return directory;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    const parent = path.dirname(directory);
    if (parent === directory) throw new Error('Cannot fingerprint the installed @tcitry/astro-book package.');
    directory = parent;
  }
}

/** Include the installed theme implementation, version and locked renderer dependencies.
 * Public package entry resolution works for tarballs and workspace development;
 * hashing its source also invalidates caches during same-version local iteration.
 */
export async function createRendererFingerprint({ compatibilityFile, themeEntryFile, dependencyLockFile }) {
  const root = await packageRoot(themeEntryFile);
  const files = [];
  async function collect(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory()) await collect(filename);
      else if (entry.isFile() && /\.(?:[cm]?js|ts|json)$/.test(entry.name)) files.push(filename);
    }
  }
  await collect(root);
  const hash = createHash('sha256');
  hash.update('astro-book-renderer-cache-v1\0');
  hash.update(await readFile(compatibilityFile));
  hash.update('\0dependency-lock\0');
  hash.update(await readFile(dependencyLockFile));
  for (const filename of files) {
    hash.update('\0' + path.relative(root, filename) + '\0');
    hash.update(await readFile(filename));
  }
  return hash.digest('hex');
}
