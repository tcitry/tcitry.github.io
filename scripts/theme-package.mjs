import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = fileURLToPath(new URL('../', import.meta.url));
export const themeName = '@tcitry/astro-book';

export function run(command, args, cwd = root, capture = false, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
      env: { ...env, GIT_TERMINAL_PROMPT: '0' },
    });
    let output = '';
    child.stdout?.on('data', (chunk) => { output += chunk; });
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolve(output) : reject(new Error(`${command} ${args[0]} exited ${code}`)));
  });
}

export function runNpm(args, cwd = root, capture = false, env = process.env) {
  // npm_execpath keeps child installs on the same npm version as npm run setup.
  return process.env.npm_execpath
    ? run(process.execPath, [process.env.npm_execpath, ...args], cwd, capture, env)
    : run(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, cwd, capture, env);
}

export async function themeRelease(directory = root) {
  const [manifest, lock] = await Promise.all(['package.json', 'package-lock.json'].map(file =>
    readFile(path.join(directory, file), 'utf8').then(JSON.parse)));
  const version = manifest.dependencies?.[themeName];
  assert.match(version ?? '', /^\d+\.\d+\.\d+$/, 'Theme dependency must pin an exact npm version');
  const locked = lock.packages?.['node_modules/' + themeName];
  assert.equal(lock.packages?.['']?.dependencies?.[themeName], version, 'Theme root lock must match package.json');
  assert.equal(locked?.version, version, 'Theme lock version must match package.json');
  assert.equal(locked?.resolved, `https://registry.npmjs.org/@tcitry/astro-book/-/astro-book-${version}.tgz`, 'Theme must resolve to its public npm tarball');
  assert.match(locked?.integrity ?? '', /^sha512-[A-Za-z0-9+/]{86}==$/, 'Theme lock must contain SHA-512 integrity');
  return { themeVersion: version, themeIntegrity: locked.integrity, themeResolved: locked.resolved };
}

export async function verifyThemePackage(directory = root, request = fetch) {
  const release = await themeRelease(directory);
  const response = await request(release.themeResolved, { signal: AbortSignal.timeout(60_000) });
  assert.ok(response.ok, `Theme download failed: HTTP ${response.status}`);
  const integrity = 'sha512-' + createHash('sha512').update(Buffer.from(await response.arrayBuffer())).digest('base64');
  assert.equal(integrity, release.themeIntegrity, 'Downloaded theme does not match lockfile integrity');
  console.log(`Verified ${themeName}@${release.themeVersion} from the public npm registry.`);
  return release;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await verifyThemePackage();
}
