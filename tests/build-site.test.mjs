import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {copyFile, lstat, mkdir, mkdtemp, open, readdir, readFile, rename, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {promisify} from 'node:util';
import {buildSite, previewBuildOutput} from '../scripts/build-site.mjs';

const execute = promisify(execFile);
const asset = generation => `page.${generation.repeat(8)}.js`;
async function exists(filename) {try {await lstat(filename); return true;} catch (error) {if (error.code === 'ENOENT') return false; throw error;}}
async function put(output, filename, value) {await mkdir(path.dirname(path.join(output, filename)), {recursive: true}); await writeFile(path.join(output, filename), value);}
async function render(output, generation) {await put(output, 'index.html', `page ${generation}`); await put(output, `_astro/${asset(generation)}`, `asset ${generation}`);}
async function fixture(t, generation = 'a') {
  const root = await mkdtemp(path.join(tmpdir(), 'preview-build-test-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const dist = path.join(root, 'dist'), generated = path.join(root, '.generated');
  await mkdir(generated);
  if (generation) await render(dist, generation);
  return {root, dist, generated, manifest: path.join(generated, 'preview-assets.json')};
}
const deferred = () => {let resolve; const promise = new Promise(done => {resolve = done;}); return {promise, resolve};};
async function noScratch(generated) {assert.deepEqual((await readdir(generated)).filter(name => name.startsWith('preview-build-')), [], 'Finished or rejected builds remove their staging directory');}

test('preview keeps the complete served site available throughout build and finalization', async t => {
  const {root, dist, generated, manifest} = await fixture(t);
  const enteredBuild = deferred(), finishBuild = deferred(), enteredFinalize = deferred(), finishFinalize = deferred();
  const work = buildSite({root, build: async output => {
    assert.notEqual(output, dist);
    assert.match(path.relative(root, output), /^\.generated\/preview-build-[A-Za-z0-9]+\/dist$/);
    await render(output, 'b'); enteredBuild.resolve(); await finishBuild.promise;
  }, finalize: async output => {
    assert.equal(await readFile(path.join(output, 'index.html'), 'utf8'), 'page b');
    enteredFinalize.resolve(); await finishFinalize.promise; await put(output, 'finalized.txt', 'complete');
  }});
  try {
    await enteredBuild.promise;
    assert.equal(await readFile(path.join(dist, 'index.html'), 'utf8'), 'page a');
    assert.equal(await readFile(path.join(dist, '_astro', asset('a')), 'utf8'), 'asset a');
    finishBuild.resolve(); await enteredFinalize.promise;
    assert.equal(await readFile(path.join(dist, 'index.html'), 'utf8'), 'page a');
    assert.equal(await exists(path.join(dist, 'finalized.txt')), false);
    finishFinalize.resolve();
    assert.deepEqual(await work, {environment: 'preview', retained: 1});
    assert.equal(await readFile(path.join(dist, 'index.html'), 'utf8'), 'page b');
    assert.equal(await readFile(path.join(dist, 'finalized.txt'), 'utf8'), 'complete');
    assert.deepEqual((await readdir(path.join(dist, '_astro'))).sort(), [asset('a'), asset('b')]);
    assert.deepEqual(JSON.parse(await readFile(manifest, 'utf8')), {version: 1, current: [asset('b')]});
    await noScratch(generated);
  } finally {finishBuild.resolve(); finishFinalize.resolve(); await work.catch(() => {});}
});

test('two generations are bounded across repeated builds and new assets are never overwritten', async t => {
  const {root, dist} = await fixture(t);
  await put(dist, '_astro/shared.12345678.css', 'old shared');
  await put(dist, '_astro/source.12345678.js.map', 'source map must not survive');
  await put(dist, '_astro/not-hashed.js', 'not an immutable asset');
  await put(dist, '_astro/private/secret.12345678.js', 'private nested file');
  await put(dist, 'private/secret.12345678.js', 'outside asset directory');
  await put(dist, 'old-page/index.html', 'old page');
  await buildSite({root, build: async output => {await render(output, 'b'); await put(output, '_astro/shared.12345678.css', 'new shared');}, finalize: async () => {}});
  assert.equal(await readFile(path.join(dist, '_astro/shared.12345678.css'), 'utf8'), 'new shared');
  for (const filename of ['_astro/source.12345678.js.map', '_astro/not-hashed.js', '_astro/private/secret.12345678.js', 'private/secret.12345678.js', 'old-page/index.html']) {
    assert.equal(await exists(path.join(dist, filename)), false, 'Retention never copies non-assets or nested/private content');
  }
  await buildSite({root, build: output => render(output, 'c'), finalize: async () => {}});
  assert.deepEqual((await readdir(path.join(dist, '_astro'))).sort(), [asset('b'), asset('c'), 'shared.12345678.css'].sort());
  await buildSite({root, build: output => render(output, 'd'), finalize: async () => {}});
  assert.deepEqual((await readdir(path.join(dist, '_astro'))).sort(), [asset('c'), asset('d')]);
});

test('failed build or finalization leaves the entire old output and generation manifest unchanged', async t => {
  for (const phase of ['build', 'finalize']) {
    const {root, dist, generated, manifest} = await fixture(t);
    await writeFile(manifest, JSON.stringify({version: 1, current: [asset('a')]}));
    const previous = await readFile(manifest, 'utf8');
    await assert.rejects(buildSite({root, build: async output => {await render(output, 'b'); if (phase === 'build') throw new Error('build rejected');},
      finalize: async output => {await put(output, 'partial.xml', 'unfinished'); throw new Error('finalize rejected');}}), new RegExp(`${phase} rejected`));
    assert.equal(await readFile(path.join(dist, 'index.html'), 'utf8'), 'page a');
    assert.deepEqual(await readdir(path.join(dist, '_astro')), [asset('a')]);
    assert.equal(await exists(path.join(dist, 'partial.xml')), false);
    assert.equal(await readFile(manifest, 'utf8'), previous);
    await noScratch(generated);
  }
});

test('failed directory switch restores the old output instead of publishing a partial build', async t => {
  const {root, dist, generated} = await fixture(t);
  let renames = 0;
  await assert.rejects(buildSite({root, build: output => render(output, 'b'), finalize: async () => {}, renameDirectory: async (from, to) => {
    if (++renames === 2) throw new Error('simulated switch failure');
    await rename(from, to);
  }}), /simulated switch failure/);
  assert.equal(renames, 3, 'The failed switch performs a rollback rename');
  assert.equal(await readFile(path.join(dist, 'index.html'), 'utf8'), 'page a');
  assert.deepEqual(await readdir(path.join(dist, '_astro')), [asset('a')]);
  await noScratch(generated);
});

test('a filesystem failure during rollback preserves the complete backup for recovery', async t => {
  const {root, dist, generated} = await fixture(t);
  let renames = 0;
  await assert.rejects(buildSite({root, build: output => render(output, 'b'), finalize: async () => {}, renameDirectory: async (from, to) => {
    if (++renames >= 2) throw new Error('simulated filesystem failure');
    await rename(from, to);
  }}), /switch and rollback failed/);
  const directories = (await readdir(generated)).filter(name => name.startsWith('preview-build-'));
  assert.equal(directories.length, 1);
  assert.equal(await readFile(path.join(generated, directories[0], 'previous-dist/index.html'), 'utf8'), 'page a');
  assert.equal(await exists(dist), false, 'No incomplete output is substituted after rollback failure');
});

test('production always cleans its real output and never restores preview generations', async t => {
  const {root, dist, generated, manifest} = await fixture(t);
  await writeFile(manifest, JSON.stringify({version: 1, current: [asset('a')]}));
  await put(dist, 'old.html', 'old preview');
  assert.deepEqual(await buildSite({root, environment: 'production', build: async output => {
    assert.equal(output, dist); assert.equal(await exists(dist), false); await render(output, 'b');
  }, finalize: async output => {assert.equal(output, dist);}}), {environment: 'production', retained: 0});
  assert.deepEqual(await readdir(path.join(dist, '_astro')), [asset('b')]);
  assert.equal(await exists(path.join(dist, 'old.html')), false);
  assert.equal(await exists(manifest), false);
  await noScratch(generated);
});

test('first preview build works without existing output', async t => {
  const {root, dist, generated} = await fixture(t, null);
  assert.deepEqual(await buildSite({root, build: output => render(output, 'a'), finalize: async () => {}}), {environment: 'preview', retained: 0});
  assert.equal(await readFile(path.join(dist, 'index.html'), 'utf8'), 'page a');
  await noScratch(generated);
});

test('preview diagnostics distinguish shared assets from a missing or mismatched prior generation', async t => {
  const {root, manifest} = await fixture(t);
  const reports = [];
  const build = () => buildSite({root, build: output => render(output, 'a'), finalize: async () => {}, report: event => reports.push(event)});
  assert.equal((await build()).retained, 0);
  assert.deepEqual(reports.splice(0), [
    {phase: 'input', available: 1, previous: 1, tracked: false},
    {phase: 'built', current: 1, shared: 1, retained: 0},
  ]);
  await writeFile(manifest, JSON.stringify({version: 1, current: [asset('b')]}));
  assert.equal((await build()).retained, 0);
  assert.deepEqual(reports, [
    {phase: 'input', available: 1, previous: 0, tracked: true},
    {phase: 'built', current: 1, shared: 0, retained: 0},
  ]);
});

test('retention ignores file symlinks and rejects manifest traversal before running the build', async t => {
  const {root, dist, manifest} = await fixture(t);
  const secret = path.join(root, 'private-source'); await writeFile(secret, 'never copy');
  await symlink(secret, path.join(dist, '_astro/secret.12345678.js'));
  await buildSite({root, build: output => render(output, 'b'), finalize: async () => {}});
  assert.equal(await exists(path.join(dist, '_astro/secret.12345678.js')), false);
  assert.equal(await readFile(secret, 'utf8'), 'never copy');
  for (const current of [['../private-source'], ['subdir/file.12345678.js'], ['/tmp/file.12345678.js'], ['file.12345678.js.map'], [asset('b'), asset('b')]]) {
    await writeFile(manifest, JSON.stringify({version: 1, current}));
    let called = false;
    await assert.rejects(buildSite({root, build: async () => {called = true;}, finalize: async () => {}}), /Invalid preview asset manifest/);
    assert.equal(called, false); assert.equal(await readFile(path.join(dist, 'index.html'), 'utf8'), 'page b');
  }
});

test('symlink directories and oversized assets cannot be retained or replace the served site', async t => {
  for (const target of ['.generated', 'dist', 'dist/_astro']) {
    const {root, dist} = await fixture(t);
    const outside = path.join(root, 'outside'); await mkdir(outside); await put(outside, 'sentinel.txt', 'untouched');
    await rm(path.join(root, target), {recursive: true, force: true}); await symlink(outside, path.join(root, target));
    await assert.rejects(buildSite({root, build: output => render(output, 'b'), finalize: async () => {}}), /real directories/);
    assert.equal(await readFile(path.join(outside, 'sentinel.txt'), 'utf8'), 'untouched');
    assert.equal(await exists(path.join(outside, asset('b'))), false);
  }
  const {root, dist, generated} = await fixture(t);
  const large = await open(path.join(dist, '_astro/large.12345678.js'), 'w');
  try {await large.truncate(32 * 1024 * 1024 + 1);} finally {await large.close();}
  await assert.rejects(buildSite({root, build: output => render(output, 'b'), finalize: async () => {}}), /size limit/);
  assert.equal(await readFile(path.join(dist, 'index.html'), 'utf8'), 'page a');
  await noScratch(generated);
});

test('finalizer output override is confined to real local staging paths and forbidden in production', async t => {
  const {root, dist, generated} = await fixture(t);
  assert.equal(await previewBuildOutput(root), dist);
  const scratch = await mkdtemp(path.join(generated, 'preview-build-'));
  const output = path.join(scratch, 'dist'); await mkdir(output);
  assert.equal(await previewBuildOutput(root, output, 'preview'), output);
  await assert.rejects(previewBuildOutput(root, output, 'production'), /Production finalization/);
  for (const filename of ['../outside', 'dist', '.generated/preview-build-other/nested/dist', '.generated/other/dist', `${output}/../dist`]) {
    await assert.rejects(previewBuildOutput(root, filename, 'preview'), /Invalid preview output/);
  }
  await rm(output, {recursive: true}); await symlink(dist, output);
  await assert.rejects(previewBuildOutput(root, output, 'preview'), /real directories/);
});

test('CLI uses staged --outDir and finalizer override only for preview', async t => {
  for (const production of [false, true]) {
    const {root, dist, generated} = await fixture(t);
    await mkdir(path.join(root, 'scripts'));
    await copyFile(new URL('../scripts/build-site.mjs', import.meta.url), path.join(root, 'scripts/build-site.mjs'));
    await put(root, 'node_modules/astro/bin/astro.mjs', `
      import fs from 'node:fs/promises'; import path from 'node:path';
      const args = process.argv.slice(2); const i = args.indexOf('--outDir');
      const output = i === -1 ? path.resolve('dist') : args[i + 1];
      await fs.mkdir(path.join(output, '_astro'), {recursive:true});
      await fs.writeFile(path.join(output, 'index.html'), 'new page');
      await fs.writeFile(path.join(output, '_astro/cli.12345678.js'), 'new asset');
      await fs.writeFile('.generated/cli-args.json', JSON.stringify(args));
    `);
    await put(root, 'scripts/finalize-build.mjs', `
      import fs from 'node:fs/promises'; import path from 'node:path';
      import {previewBuildOutput} from './build-site.mjs';
      const output = await previewBuildOutput(process.cwd(), process.env.BLOG_PREVIEW_OUTPUT_DIR, process.env.PUBLIC_SITE_ENV);
      await fs.writeFile(path.join(output, 'finalized.txt'), 'complete');
      await fs.writeFile('.generated/finalize-output.json', JSON.stringify({output, override:process.env.BLOG_PREVIEW_OUTPUT_DIR}));
    `);
    await execute(process.execPath, ['scripts/build-site.mjs'], {cwd: root, env: {...process.env, PUBLIC_SITE_ENV: production ? 'production' : 'preview', BLOG_PREVIEW_OUTPUT_DIR: '/ignored-inherited-value'}});
    const args = JSON.parse(await readFile(path.join(generated, 'cli-args.json'), 'utf8'));
    assert.equal(args.includes('--outDir'), !production);
    const receipt = JSON.parse(await readFile(path.join(generated, 'finalize-output.json'), 'utf8'));
    assert.equal(Boolean(receipt.override), !production);
    assert.equal(await readFile(path.join(dist, 'finalized.txt'), 'utf8'), 'complete');
    assert.equal(await exists(path.join(dist, '_astro', asset('a'))), !production);
    await noScratch(generated);
  }
});
