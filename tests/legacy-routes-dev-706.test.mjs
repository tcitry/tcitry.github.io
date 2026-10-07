import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { matchLegacySources, resolveLegacyRoute } from '../scripts/legacy-content.mjs';

const legacy = JSON.parse(await readFile(new URL('../scripts/legacy-routes.json', import.meta.url), 'utf8'));
const bySource = new Map(legacy.pages.filter(page => page.source).map(page => [page.source, page]));

const moved = [
  ['docs/Agents/AI 代写代码之后：如何获得学习收获与保持竞争力.md', 'posts/2026/AI 代写代码之后：如何获得学习收获与保持竞争力.md', 'ai-assisted-understanding-and-verification'],
  ['docs/软件工程/笔记方法论：flomo 卡片笔记体系整理.md', 'posts/2026/笔记方法论：flomo 卡片笔记体系整理.md', 'flomo-note-taking-methodology'],
];

test('DEV-706 remaps standalone docs to posts/2026', () => {
  for (const [oldSource, newSource, slug] of moved) {
    assert.ok(!bySource.has(oldSource));
    const page = bySource.get(newSource);
    assert.ok(page);
    assert.equal(page.url, `/posts/${slug}/`);
    assert.equal(page.section, 'posts');
    assert.equal(page.parent, '/posts/');
  }
});

test('DEV-706 post sources resolve to posts URLs', () => {
  const records = moved.map(([, source, slug]) => ({ source, data: { slug } }));
  const matches = matchLegacySources(records, legacy.pages);
  for (const [i, record] of records.entries()) {
    assert.equal(resolveLegacyRoute(record, matches.get(record.source)).url, `/posts/${moved[i][2]}/`);
  }
});
