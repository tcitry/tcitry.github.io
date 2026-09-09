import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { publishIconAliases, publishKatexAssets, resolveKatexDist } from '../scripts/lib/well-known-assets.mjs';

async function fixture(t, files) {
  const root = await mkdtemp(path.join(tmpdir(), 'well-known-assets-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const [file, body] of Object.entries(files)) {
    const target = path.join(root, file);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, body);
  }
  return root;
}

test('publishes Hugo icon URLs as the same SVG files plus the site favicon', async (t) => {
  const root = await fixture(t, {
    'output/favicon.ico': 'ico',
    'theme/menu.svg': '<svg id="menu" />',
    'theme/chevron-right.svg': '<svg id="chevron" />',
  });
  await publishIconAliases(path.join(root, 'output'), path.join(root, 'theme'));
  assert.equal(await readFile(path.join(root, 'output/icons/menu.svg'), 'utf8'), '<svg id="menu" />');
  assert.equal(await readFile(path.join(root, 'output/icons/chevron-right.svg'), 'utf8'), '<svg id="chevron" />');
  assert.equal(await readFile(path.join(root, 'output/icons/favicon.ico'), 'utf8'), 'ico');
});

test('resolves KaTeX from the published theme package', async () => {
  await access(path.join(resolveKatexDist(), 'katex.min.css'));
  await access(path.join(resolveKatexDist(), 'fonts/KaTeX_Main-Regular.woff2'));
});

test('publishes the KaTeX dist CSS, JS and fonts at the historical /katex/ URL', async (t) => {
  const root = await fixture(t, {
    'katex/katex.min.css': 'css',
    'katex/katex.min.js': 'js',
    'katex/fonts/KaTeX_Main-Regular.woff2': 'font',
    'katex/README.md': 'skip',
  });
  const output = path.join(root, 'output');
  await publishKatexAssets(output, path.join(root, 'katex'));
  assert.equal(await readFile(path.join(output, 'katex/katex.min.css'), 'utf8'), 'css');
  assert.equal(await readFile(path.join(output, 'katex/katex.min.js'), 'utf8'), 'js');
  assert.equal(await readFile(path.join(output, 'katex/fonts/KaTeX_Main-Regular.woff2'), 'utf8'), 'font');
  assert.deepEqual(await readdir(path.join(output, 'katex')), ['fonts', 'katex.min.css', 'katex.min.js']);
});
