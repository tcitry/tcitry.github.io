import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { collectSources, matchLegacySources, resolveLegacyRoute, routeSignature } from '../scripts/legacy-content.mjs';

const record = (source, data = {}) => ({ source, data });
const legacyPage = (source, url, data = {}) => ({ source, url, parent: '/old-parent/', routeSignature: routeSignature(record(source, data)) });

test('fresh checkout filename casing preserves the six published legacy routes', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'astro-source-casing-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const spellings = [
    ['docs/Awesome/awesome Blog.md', 'docs/Awesome/Awesome Blog.md'],
    ['docs/Frontend/JavaScript/reduce.md', 'docs/Frontend/JavaScript/Reduce.md'],
    ['links/202508/Supabase.md', 'links/202508/supabase.md'],
    ['links/202508/WaveSpeed.md', 'links/202508/wavespeed.md'],
    ['links/202510/Boardmix.md', 'links/202510/boardmix.md'],
    ['links/202510/DaisyUI.md', 'links/202510/daisyUI.md'],
  ];
  for (const [, current] of spellings) {
    await mkdir(path.dirname(path.join(root, current)), { recursive: true });
    await writeFile(path.join(root, current), '---\ntitle: Example\n---\nExample.\n');
  }
  const { pages } = JSON.parse(await readFile(new URL('../scripts/legacy-routes.json', import.meta.url), 'utf8'));
  const records = await collectSources(root);
  const matches = matchLegacySources(records, pages);
  assert.equal(records.length, spellings.length);
  for (const [previous, current] of spellings) {
    const page = pages.find((page) => page.source === previous);
    assert.ok(page, `Published baseline must contain ${previous}`);
    assert.equal(matches.get(current), page);
    assert.deepEqual(resolveLegacyRoute(records.find((record) => record.source === current), matches.get(current)), { url: page.url, parent: page.parent });
  }
});

test('exact source matches win even when the case-insensitive group is ambiguous', () => {
  const records = [record('docs/Topic.md'), record('docs/topic.md')];
  const pages = [legacyPage('docs/Topic.md', '/upper/'), legacyPage('docs/topic.md', '/lower/')];
  const matches = matchLegacySources(records, pages);
  assert.equal(matches.get(records[0].source), pages[0]);
  assert.equal(matches.get(records[1].source), pages[1]);
});

test('case fallback refuses ambiguity on either the legacy or current side', () => {
  const upper = legacyPage('docs/Topic.md', '/upper/');
  const lower = legacyPage('docs/topic.md', '/lower/');
  assert.equal(matchLegacySources([record('docs/TOPIC.md')], [upper, lower]).size, 0);
  const records = [record('docs/Topic.md'), record('docs/topic.md', { draft: true })];
  const matches = matchLegacySources(records, [upper]);
  assert.equal(matches.get('docs/Topic.md'), upper);
  assert.equal(matches.has('docs/topic.md'), false);
  assert.equal(matchLegacySources(records, [legacyPage('docs/TOPIC.md', '/third/')]).size, 0);
  assert.equal(matchLegacySources([record('docs/Elsewhere.md')], [upper]).size, 0);
});

test('explicit slug and URL edits still override routes found through either source spelling', () => {
  for (const source of ['docs/Topic.md', 'docs/topic.md']) {
    const previous = legacyPage('docs/Topic.md', '/legacy/');
    for (const [data, url] of [[{ slug: 'new-topic' }, '/docs/new-topic/'], [{ url: '/new-location/' }, '/new-location/']]) {
      const current = record(source, data);
      const matches = matchLegacySources([current], [previous]);
      assert.equal(matches.get(source), previous);
      assert.deepEqual(resolveLegacyRoute(current, matches.get(source)), { url, parent: '' });
    }
  }
  const current = record('docs/topic.md');
  const previous = legacyPage('docs/Topic.md', '/explicit-before/', { url: '/explicit-before/' });
  assert.deepEqual(resolveLegacyRoute(current, matchLegacySources([current], [previous]).get(current.source)), { url: '/docs/topic/', parent: '' });
});

test('unchanged explicit routing retains its published URL and parent after a casing change', () => {
  const data = { slug: 'stable' };
  const current = record('docs/topic.md', data);
  const previous = legacyPage('docs/Topic.md', '/docs/stable/', data);
  assert.deepEqual(resolveLegacyRoute(current, matchLegacySources([current], [previous]).get(current.source)), { url: '/docs/stable/', parent: '/old-parent/' });
});
