import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { articleCover } from '../src/components/book/article-cover.mjs';

const weekly = {
  type: 'weekly',
  kind: 'page',
  title: '实时系统与工程调研',
  image: 'https://cdn.yindongliang.com/2026/weekly-2026-w40-20261004-cover.png',
};

test('detail pages use the frontmatter cover that weekly cards already show', () => {
  assert.deepEqual(articleCover(weekly), {
    src: 'https://cdn.yindongliang.com/2026/weekly-2026-w40-20261004-cover.png',
    alt: '实时系统与工程调研',
  });
  assert.deepEqual(articleCover({ ...weekly, image: '  /covers/weekly.png  ' }), {
    src: '/covers/weekly.png',
    alt: weekly.title,
  });
  assert.equal(articleCover({ ...weekly, image: '' }), null);
  assert.equal(articleCover({ ...weekly, image: '   ' }), null);
  assert.equal(articleCover({ title: '文档', type: 'docs', image: '/figures/a.png' })?.src, '/figures/a.png');
});

test('PostMeta renders the cover after the meta block, matching theme ArticleMeta', async () => {
  const source = await readFile(new URL('../src/components/book/PostMeta.astro', import.meta.url), 'utf8');
  assert.match(source, /const cover = articleCover\(page\)/);
  const metaEnd = source.indexOf('</div>');
  const cover = source.indexOf('<p class="post-cover"><img src={cover.src} alt={cover.alt} loading="lazy" /></p>');
  assert.ok(metaEnd > 0 && cover > metaEnd, 'cover image stays outside the meta flex box');
});
