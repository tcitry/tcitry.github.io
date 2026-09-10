import {spawn} from 'node:child_process';
import {constants} from 'node:fs';
import {lstat, mkdir, mkdtemp, open, readdir, rename, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const MAX_FILES = 10_000;
const MAX_FILE_BYTES = 32 * 1024 * 1024;
const MAX_RETAINED_BYTES = 128 * 1024 * 1024;
// Retention never traverses directories or copies source maps, HTML, metadata,
// environment files, or any other content outside Astro's flat asset directory.
const assetName = name => typeof name === 'string' && name.length <= 255
  && /^[A-Za-z0-9_-][A-Za-z0-9._-]*\.[A-Za-z0-9_-]{8,}\.(?:js|css|woff2?|ttf|otf|eot|svg|png|jpe?g|gif|webp|avif|ico|wasm|mp4|webm|mp3|ogg)$/i.test(name);

async function statIfPresent(filename) {
  try {return await lstat(filename);} catch (error) {if (error.code === 'ENOENT') return null; throw error;}
}
async function directory(filename, {create = false, optional = false} = {}) {
  if (create) await mkdir(filename, {recursive: true});
  const stat = await statIfPresent(filename);
  if (!stat && optional) return false;
  if (!stat?.isDirectory() || stat.isSymbolicLink()) throw new Error('Build output and cache directories must be real directories.');
  return true;
}
async function readRegular(filename, limit) {
  const handle = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > limit) throw new Error('Preview asset or manifest exceeds the regular-file size limit.');
    const bytes = await handle.readFile();
    if (bytes.length > limit) throw new Error('Preview asset or manifest grew beyond its size limit.');
    return bytes;
  } finally {await handle.close();}
}
async function assets(output) {
  if (!await directory(output, {optional: true})) return [];
  const target = path.join(output, '_astro');
  if (!await directory(target, {optional: true})) return [];
  const names = [];
  for (const entry of await readdir(target, {withFileTypes: true})) {
    if (entry.isFile() && assetName(entry.name)) names.push(entry.name);
  }
  if (names.length > MAX_FILES) throw new Error('Too many preview assets to retain safely.');
  return names.sort();
}
async function previousGeneration(output, manifest) {
  const available = await assets(output);
  const stat = await statIfPresent(manifest);
  if (!stat) return {names: available, available: available.length, tracked: false};
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Preview asset manifest must be a regular file.');
  let value;
  try {value = JSON.parse((await readRegular(manifest, 4 * 1024 * 1024)).toString('utf8'));}
  catch (cause) {throw new Error('Invalid preview asset manifest.', {cause});}
  if (value?.version !== 1 || !Array.isArray(value.current) || value.current.length > MAX_FILES
    || value.current.some(name => !assetName(name)) || new Set(value.current).size !== value.current.length) {
    throw new Error('Invalid preview asset manifest.');
  }
  const current = new Set(value.current);
  return {names: available.filter(name => current.has(name)), available: available.length, tracked: true};
}
async function retainAssets(source, target, names) {
  if (!names.length) return 0;
  await directory(source);
  await directory(path.join(source, '_astro'));
  const destination = path.join(target, '_astro');
  await directory(destination, {create: true});
  let total = 0, retained = 0;
  for (const name of names) {
    const filename = path.join(destination, name);
    const existing = await statIfPresent(filename);
    if (existing) {
      if (!existing.isFile() || existing.isSymbolicLink()) throw new Error('A new preview asset is not a regular file.');
      continue; // Never replace a file emitted by the new build.
    }
    const bytes = await readRegular(path.join(source, '_astro', name), MAX_FILE_BYTES);
    total += bytes.length;
    if (total > MAX_RETAINED_BYTES) throw new Error('Previous preview assets exceed the retention size limit.');
    await writeFile(filename, bytes, {flag: 'wx'});
    retained++;
  }
  return retained;
}

/** The finalizer accepts only an existing staging directory owned by this wrapper. */
export async function previewBuildOutput(root, value, environment) {
  if (!value) {
    const output = path.join(root, 'dist');
    await directory(output, {optional: true});
    return output;
  }
  if (environment === 'production') throw new Error('Production finalization cannot use a preview output directory.');
  if (typeof value !== 'string' || value.includes('\\') || value.split('/').includes('..')) throw new Error('Invalid preview output directory.');
  const output = path.resolve(root, value);
  const relative = path.relative(root, output).split(path.sep).join('/');
  if (!/^\.generated\/preview-build-[A-Za-z0-9]+\/dist$/.test(relative)) throw new Error('Invalid preview output directory.');
  await directory(path.join(root, '.generated'));
  await directory(path.dirname(output));
  await directory(output);
  return output;
}

/** Keep the served preview untouched until both the build and finalizer succeed. */
export async function buildSite({root, environment = process.env.PUBLIC_SITE_ENV, build, finalize, renameDirectory = rename, report = () => {}}) {
  root = path.resolve(root);
  const output = path.join(root, 'dist');
  const generated = path.join(root, '.generated');
  await directory(generated, {create: true});
  const hadOutput = await directory(output, {optional: true});
  const manifest = path.join(generated, 'preview-assets.json');

  if (environment === 'production') {
    // Production remains a clean build in its independently reviewed checkout.
    await rm(manifest, {force: true});
    await rm(output, {recursive: true, force: true});
    await build(output);
    await finalize(output);
    return {environment: 'production', retained: 0};
  }

  const previous = await previousGeneration(output, manifest);
  report({phase: 'input', available: previous.available, previous: previous.names.length, tracked: previous.tracked});
  const scratch = await mkdtemp(path.join(generated, 'preview-build-'));
  const staging = path.join(scratch, 'dist');
  const backup = path.join(scratch, 'previous-dist');
  let preserveScratch = false;
  try {
    await build(staging);
    await directory(staging);
    await finalize(staging);
    const current = await assets(staging); // Capture before adding the old assets.
    const currentSet = new Set(current);
    const shared = previous.names.filter(name => currentSet.has(name)).length;
    const retained = await retainAssets(output, staging, previous.names);
    report({phase: 'built', current: current.length, shared, retained});
    const nextManifest = path.join(scratch, 'manifest.json');
    await writeFile(nextManifest, JSON.stringify({version: 1, current}) + '\n', {flag: 'wx'});
    let movedOld = false, published = false;
    try {
      if (hadOutput) {await renameDirectory(output, backup); movedOld = true;}
      await renameDirectory(staging, output); published = true;
      await rename(nextManifest, manifest);
    } catch (error) {
      try {
        if (published) await renameDirectory(output, staging);
        if (movedOld) await renameDirectory(backup, output);
      } catch (rollback) {
        // Preserve scratch/previous-dist when filesystem failure prevents
        // rollback, so the previous complete output remains recoverable.
        preserveScratch = true;
        throw new AggregateError([error, rollback], 'Preview switch and rollback failed; the previous output is preserved in the preview build cache.');
      }
      throw error;
    }
    return {environment: 'preview', retained};
  } finally {
    // A backup left after failed rollback is deliberately retained. Successful
    // publication or rollback has already consumed it or can remove it safely.
    if (!preserveScratch) await rm(scratch, {recursive: true, force: true});
  }
}

function run(root, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {cwd: root, env, stdio: 'inherit'});
    child.once('error', reject);
    child.once('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`Build step failed${signal ? ` (${signal})` : ` with exit code ${code}`}.`)));
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const env = {...process.env};
  delete env.BLOG_PREVIEW_OUTPUT_DIR;
  try {
    const result = await buildSite({root, environment: env.PUBLIC_SITE_ENV,
      report: progress => console.log(progress.phase === 'input'
        ? `Preview input: ${progress.available} served Astro assets; ${progress.previous} previous-generation candidates (${progress.tracked ? 'tracked manifest' : 'first-build inventory'}).`
        : `Preview assets: ${progress.current} emitted; ${progress.shared} shared with the previous generation; ${progress.retained} older assets retained.`),
      build: output => run(root, [path.join(root, 'node_modules/astro/bin/astro.mjs'), 'build',
        ...(env.PUBLIC_SITE_ENV === 'production' ? [] : ['--outDir', output])], env),
      finalize: output => run(root, [path.join(root, 'scripts/finalize-build.mjs')], env.PUBLIC_SITE_ENV === 'production'
        ? env : {...env, BLOG_PREVIEW_OUTPUT_DIR: output}),
    });
    if (result.environment === 'preview') console.log(`Preview switched after build completion; retained ${result.retained} previous-generation Astro assets.`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
