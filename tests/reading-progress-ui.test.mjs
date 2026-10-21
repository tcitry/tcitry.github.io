import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('article progress stays separate from reading status', () => {
  const layout = read('src/layouts/BookLayout.astro');
  assert.match(layout, /<ReadingProgressIsland /);
  assert.doesNotMatch(layout, /ArticleReaderIsland/);
  const article = read('src/components/reader/ArticleReader.tsx');
  assert.match(article, /<ReadingProgress /);
  assert.doesNotMatch(article, /ReadingMarkControl/);
  assert.match(article, /<BookmarkButton /);
  const progress = read('src/components/reader/ReadingProgress.tsx');
  assert.match(progress, /api\.reader\.getReadingProgress/);
  assert.match(progress, /api\.reader\.setReadingProgress/);
  assert.match(progress, /跳过本次/);
  assert.match(progress, />进度</);
  assert.match(progress, /readingProgressFrame/);
  assert.doesNotMatch(progress, /setReadingMark|clearReadingMark|readingMarks|listReadingMarks/);
  const list = read('src/components/reader/ReadingMarksPanel.tsx');
  assert.match(list, /api\.reader\.listReadingMarks/);
  assert.match(list, /api\.reader\.listReadingProgress/);
  assert.match(list, /readingListMeta/);
  assert.doesNotMatch(list, /itemPath|sectionLabel/);
  assert.match(read('src/components/reader/ReaderPanel.module.css'), /book-menu-content/);
  const workspace = read('src/components/chat/AssistantWorkspace.tsx');
  assert.match(workspace, /<ReadingMarksPanel \/>/);
  assert.doesNotMatch(workspace, /ReadingProgressPanel/);
  assert.match(workspace, /\{id: 'reading', label: '阅读'\}/);
  const reader = read('convex/reader.ts');
  assert.match(reader, /export const listReadingMarks/);
  assert.match(reader, /export const listReadingProgress/);
  assert.doesNotMatch(reader, /listReadingEntries|mergeReadingEntries/);
  const panel = read('src/components/reader/MyPanel.tsx');
  assert.doesNotMatch(panel, /ReadingMarksPanel|ReadingProgressPanel|id: 'reading'/);
});
