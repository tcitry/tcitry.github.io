import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';

export const root = fileURLToPath(new URL('../', import.meta.url));
export const artifact = '.artifacts/tcitry-astro-book.tgz';

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

export async function cachedThemeIntegrity(directory, source, locked) {
  if (locked?.resolved !== `file:${artifact}` || !locked.integrity) return null;
  try {
    const cached = JSON.parse(await readFile(path.join(directory, 'tcitry-astro-book.source.json'), 'utf8'));
    if (['repository', 'commit', 'package'].some(key => cached[key] !== source[key])) return null;
    const bytes = await readFile(path.join(directory, 'tcitry-astro-book.tgz'));
    const integrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
    return integrity === locked.integrity && integrity === cached.integrity ? integrity : null;
  } catch (error) {
    if (error.code === 'ENOENT' || error instanceof SyntaxError) return null;
    throw error;
  }
}

export async function prepareTheme({ localDirectory, verifyLock = false } = {}) {
  const artifacts = path.join(root, '.artifacts');
  await mkdir(artifacts, { recursive: true });
  const scratch = await mkdtemp(path.join(artifacts, 'theme-build-'));
  try {
    const source = JSON.parse(await readFile(path.join(root, 'astro-book.source.json'), 'utf8'));
    if (!/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\.git$/.test(source.repository)
      || !/^[a-f0-9]{40}$/.test(source.commit)
      || source.package !== 'packages/astro-book') {
      throw new Error('astro-book.source.json must contain a public GitHub HTTPS repository, full commit SHA, and packages/astro-book.');
    }
    const lock = verifyLock ? JSON.parse(await readFile(path.join(root, 'package-lock.json'), 'utf8')) : null;
    const locked = lock?.packages['node_modules/@tcitry/astro-book'];
    if (!localDirectory && verifyLock) {
      const integrity = await cachedThemeIntegrity(artifacts, source, locked);
      if (integrity) {
        console.log(`Reusing the verified theme artifact (${source.commit.slice(0, 12)}).`);
        return { integrity, commit: source.commit };
      }
    }
    const publicEnv = { ...process.env };
    delete publicEnv.HEROUI_AUTH_TOKEN;

    let theme;
    if (localDirectory) {
      theme = path.resolve(root, localDirectory);
      console.log('Packing the explicit ASTRO_BOOK_DIR development checkout.');
    } else {
      theme = path.join(scratch, 'source');
      await mkdir(theme);
      console.log(`Fetching ${source.repository} at ${source.commit}.`);
      await run('git', ['init', '--quiet'], theme, false, publicEnv);
      // A user-level autocrlf setting must not change the pinned source bytes.
      await run('git', ['config', 'core.autocrlf', 'false'], theme, false, publicEnv);
      await run('git', ['remote', 'add', 'origin', source.repository], theme, false, publicEnv);
      await run('git', ['fetch', '--quiet', '--depth=1', 'origin', source.commit], theme, false, publicEnv);
      await run('git', ['checkout', '--quiet', '--detach', 'FETCH_HEAD'], theme, false, publicEnv);
      const head = (await run('git', ['rev-parse', 'HEAD'], theme, true, publicEnv)).trim();
      if (head !== source.commit) throw new Error('Fetched theme commit does not match astro-book.source.json.');
      await runNpm(['ci', '--include=dev', '--prefer-offline', '--no-audit', '--no-fund'], theme, false, publicEnv);
    }

    const packageDirectory = path.join(theme, source.package);
    const manifest = JSON.parse(await readFile(path.join(packageDirectory, 'package.json'), 'utf8'));
    if (manifest.name !== '@tcitry/astro-book') throw new Error('Theme source must contain the independent @tcitry/astro-book package.');
    // prepack builds the actual published CSS, JavaScript and declarations.
    const output = await runNpm(['pack', '--json', '--pack-destination', scratch], packageDirectory, true, publicEnv);
    const jsonStart = output.search(/^\s*\[\s*\{/m);
    if (jsonStart < 0) throw new Error('npm pack did not return package metadata.');
    const [packed] = JSON.parse(output.slice(jsonStart));
    if (path.basename(packed.filename) !== packed.filename) throw new Error('Invalid package filename from npm pack.');
    const built = path.join(scratch, packed.filename);
    // Different Node/zlib versions compress identical tar bytes differently.
    // Stored DEFLATE blocks avoid compression-algorithm differences; this local
    // artifact is not uploaded. Keep every npm tar entry and normalize gzip OS.
    const tarball = gzipSync(gunzipSync(await readFile(built)), { level: 0 });
    tarball[9] = 255;
    await writeFile(built, tarball);
    const integrity = `sha512-${createHash('sha512').update(tarball).digest('base64')}`;
    if (verifyLock) {
      if (locked?.resolved !== `file:${artifact}` || locked.integrity !== integrity) {
        throw new Error('Built theme does not match package-lock.json. Check the pinned source and Node/npm versions; for an intentional theme upgrade run npm run theme:sync and commit the source pin plus lockfile. setup never rewrites the lockfile.');
      }
    }
    await rename(built, path.join(root, artifact));
    if (!localDirectory) {
      await writeFile(path.join(artifacts, 'tcitry-astro-book.source.json'), JSON.stringify({ ...source, integrity }, null, 2));
    } else {
      // Explicit local development packs are never reused as a pinned CI build.
      await rm(path.join(artifacts, 'tcitry-astro-book.source.json'), { force: true });
    }
    console.log(`Prepared ${manifest.name}@${manifest.version} (${localDirectory ? 'local development' : source.commit.slice(0, 12)}).`);
    return { integrity, commit: localDirectory ? null : source.commit };
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}
