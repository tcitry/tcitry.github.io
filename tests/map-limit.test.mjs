import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { mapLimit } from '../scripts/lib/map-limit.mjs';
import { publicURL } from '../src/lib/public-url.mjs';

const execute = promisify(execFile);
const helper = fileURLToPath(new URL('../scripts/lib/map-limit.mjs', import.meta.url));
const deployment = fileURLToPath(new URL('../scripts/verify-deployment.mjs', import.meta.url));

test('mapLimit preserves order and never exceeds the concurrency cap', async () => {
  let current = 0;
  let peak = 0;
  const results = await mapLimit(Array.from({ length: 40 }, (_, index) => index), 4, async value => {
    current += 1;
    peak = Math.max(peak, current);
    await new Promise(resolve => setTimeout(resolve, 5));
    current -= 1;
    return value * 2;
  });
  assert.equal(peak, 4);
  assert.deepEqual(results, Array.from({ length: 40 }, (_, index) => index * 2));
  assert.deepEqual(await mapLimit([], 4, () => { throw new Error('unused'); }), []);
  assert.deepEqual(await mapLimit([1, 2], 10, async value => value), [1, 2]);
  await assert.rejects(mapLimit([1], 0, async value => value), TypeError);
  await assert.rejects(mapLimit([1, 2, 3], 2, async value => {
    if (value === 2) throw new Error('bad item');
    return value;
  }), /bad item/);
});

test('bounded sitemap reads pass the canonical check under a nofile limit that rejects an unbounded read', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'sitemap-fd-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const count = 300;
  const pages = [];
  for (let index = 0; index < count; index += 1) {
    const href = publicURL(`/posts/page-${index}/`);
    const file = path.join(directory, `${index}.html`);
    await writeFile(file, `<html><head><link rel="canonical" href="${href}"></head></html>`);
    pages.push({ href, file });
  }
  const script = path.join(directory, 'read.mjs');
  await writeFile(script, `
import { readFile } from 'node:fs/promises';
import { mapLimit } from ${JSON.stringify(helper)};
import { assertSitemapLocations, canonicalLinks } from ${JSON.stringify(deployment)};
const pages = ${JSON.stringify(pages)};
const mode = process.argv[2];
if (mode === 'unbounded') {
  await Promise.all(pages.map(async page => canonicalLinks(await readFile(page.file, 'utf8'))));
  console.log('unbounded-ok');
} else {
  let current = 0, peak = 0;
  const entries = await mapLimit(pages, 16, async page => {
    current += 1;
    peak = Math.max(peak, current);
    try { return [page.href, canonicalLinks(await readFile(page.file, 'utf8'))]; }
    finally { current -= 1; }
  });
  if (peak > 16) throw new Error('peak ' + peak);
  const canonicals = new Map(entries);
  assertSitemapLocations(pages.map(page => page.href), { canonicalOf: loc => canonicals.get(loc) });
  console.log('bounded-ok ' + peak + ' ' + canonicals.size);
}
`);
  const unbounded = await runLimited(script, 'unbounded');
  assert.equal(unbounded.code, 1, unbounded.stderr);
  assert.match(`${unbounded.stderr}\n${unbounded.stdout}`, /EMFILE/);
  const bounded = await runLimited(script, 'bounded');
  assert.equal(bounded.code, 0, bounded.stderr);
  assert.match(bounded.stdout, new RegExp(`bounded-ok \\d+ ${count}`));
});

async function runLimited(script, mode) {
  try {
    const { stdout, stderr } = await execute('bash', ['-c', 'ulimit -n 128 && exec node "$1" "$2"', 'bash', script, mode], { encoding: 'utf8' });
    return { code: 0, stdout, stderr };
  } catch (error) {
    return { code: typeof error.code === 'number' ? error.code : 1, stdout: error.stdout ?? '', stderr: error.stderr ?? error.message };
  }
}
