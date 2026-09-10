import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import {buildSite} from '../scripts/build-site.mjs';

const execute = promisify(execFile);
const repository = fileURLToPath(new URL('../', import.meta.url));

test('real Astro and astro-book build into staging while the served generation stays readable', {timeout: 90_000}, async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'preview-real-astro-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  await symlink(path.join(repository, 'node_modules'), path.join(root, 'node_modules'));
  await mkdir(path.join(root, 'src/pages'), {recursive: true});
  await writeFile(path.join(root, 'package.json'), JSON.stringify({type: 'module'}));
  await writeFile(path.join(root, 'astro.config.mjs'), `
import {defineConfig} from 'astro/config';
import astroBook from '@tcitry/astro-book';
import assert from 'node:assert/strict';
import {appendFile, readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root = fileURLToPath(new URL('.', import.meta.url));
async function observe(phase) {
  const expected = JSON.parse(process.env.PREVIEW_EXPECTED_ASSETS || '{}');
  for (const [name, content] of Object.entries(expected)) {
    assert.equal(await readFile(path.join(root, 'dist/_astro', name), 'utf8'), content,
      phase + ': the served asset remains readable during the real build');
  }
  await appendFile(path.join(root, 'observations.jsonl'), JSON.stringify({phase, checked: Object.keys(expected).length}) + '\\n');
}
export default defineConfig({
  site: 'https://example.test', output: 'static',
  integrations: [astroBook({search: {glob: '**/*.html', rootSelector: 'main'}}), {
    name: 'assert-served-output', hooks: {
      'astro:build:start': () => observe('start'),
      'astro:build:done': () => observe('done'),
    },
  }],
});
`);
  await writeFile(path.join(root, 'src/pages/index.astro'), `<html lang="en"><head><title>Preview</title></head><body><main><h1>Preview article</h1><button id="lazy">Open</button></main><script>
document.getElementById('lazy').addEventListener('click', async () => {
  const {message} = await import('../lazy'); document.getElementById('lazy').textContent = message;
});
</script></body></html>`);

  const dist = path.join(root, 'dist');
  let expected = {};
  const generations = [];
  for (const generation of ['a', 'b', 'c']) {
    const reports = [];
    await writeFile(path.join(root, 'src/lazy.ts'), `export const message = 'Preview generation ${generation}';`);
    const result = await buildSite({root, environment: 'preview', report: event => reports.push(event),
      build: async output => {
        const {stdout} = await execute(process.execPath, [path.join(repository, 'node_modules/astro/bin/astro.mjs'), 'build', '--outDir', output], {
          cwd: root, timeout: 25_000, maxBuffer: 1024 * 1024,
          env: {...process.env, PUBLIC_SITE_ENV: 'preview', ASTRO_TELEMETRY_DISABLED: '1', PREVIEW_EXPECTED_ASSETS: JSON.stringify(expected)},
        });
        assert.match(stdout, /Pagefind indexed 1 HTML page/, 'The installed theme completes its real search build hook');
        assert.ok(stdout.includes(`${output}/`), 'Astro reports the controlled staging output');
      },
      finalize: async output => {
        // The real theme has finalized the Pagefind assets in the staging dir.
        assert.ok((await readdir(path.join(output, 'pagefind'))).includes('pagefind.js'));
        for (const [name, content] of Object.entries(expected)) {
          assert.equal(await readFile(path.join(dist, '_astro', name), 'utf8'), content);
        }
      },
    });
    const manifest = JSON.parse(await readFile(path.join(root, '.generated/preview-assets.json'), 'utf8'));
    assert.equal(reports[0].phase, 'input');
    assert.equal(reports[0].previous, Object.keys(expected).length, 'The input count describes the generation present before Astro starts');
    assert.equal(reports[1].phase, 'built');
    assert.equal(reports[1].current, manifest.current.length);
    assert.equal(reports[1].shared + reports[1].retained, reports[0].previous);
    const current = Object.fromEntries(await Promise.all(manifest.current.map(async name => [name, await readFile(path.join(dist, '_astro', name), 'utf8')])));
    assert.ok(manifest.current.some(name => name.startsWith('lazy.')), 'The real build emits a hashed lazy chunk');
    assert.ok(Object.values(current).some(content => content.includes(`Preview generation ${generation}`)));
    if (generation === 'a') assert.equal(result.retained, 0);
    else {
      assert.ok(result.retained > 0, 'Changing the real lazy import retains the preceding generation');
      for (const [name, content] of Object.entries(expected)) assert.equal(await readFile(path.join(dist, '_astro', name), 'utf8'), content);
    }
    generations.push(manifest.current);
    if (generation === 'c') {
      const names = await readdir(path.join(dist, '_astro'));
      for (const oldest of generations[0].filter(name => !generations[1].includes(name) && !generations[2].includes(name))) {
        assert.equal(names.includes(oldest), false, 'The third build removes assets exclusive to the first generation');
      }
    }
    t.diagnostic(`${generation}: emitted ${manifest.current.length}, retained ${result.retained}`);
    expected = current;
  }
  const observations = (await readFile(path.join(root, 'observations.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  assert.deepEqual(observations.map(item => item.phase), ['start', 'done', 'start', 'done', 'start', 'done']);
  assert.ok(observations.slice(2).every(item => item.checked > 0), 'Both real Astro build hooks checked the old assets in subsequent builds');
});
