import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('article reader mounts before comments with independent bookmark and reading controls', () => {
  const layout = read('src/layouts/BookLayout.astro');
  assert.ok(layout.indexOf('<ArticleReaderIsland ') < layout.indexOf('<Comments '));
  assert.match(layout, /<ArticleReaderIsland[^>]+client:only="react"/);
  assert.doesNotMatch(layout, /<Comments[^>]+bookmarkable=/);
  const article = read('src/components/reader/ArticleReader.tsx');
  assert.match(article, /<ReadingMarkControl /);
  assert.match(article, /<BookmarkButton /);
  assert.match(article, /data-sentry-mask data-pagefind-ignore/);
  assert.match(article, /isAuthenticated \? \{pathname\} : 'skip'/);
});

test('personal reading list has its own segment, indexed filter and pagination', () => {
  assert.match(read('src/components/reader/MyPanel.tsx'), /\{id: 'reading', label: '阅读'\}/);
  const list = read('src/components/reader/ReadingMarksPanel.tsx');
  assert.match(list, /api.reader.listReadingMarks/);
  assert.match(list, /filter \? \{status: filter\} : \{\}/);
  assert.match(list, /loadMore\(20\)/);
  for (const field of ['title', 'pathname', 'status', 'updatedAt']) assert.ok(list.includes(`item.${field}`));
  assert.doesNotMatch(list, /api.reader.listLibrary/);
});
