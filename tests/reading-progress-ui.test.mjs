import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('article progress stays separate from reading status', () => {
  const article = read('src/components/reader/ArticleReader.tsx');
  assert.match(article, /<ReadingProgress /);
  assert.match(article, /<ReadingMarkControl /);
  assert.match(article, /<BookmarkButton /);
  const progress = read('src/components/reader/ReadingProgress.tsx');
  assert.match(progress, /api\.reader\.getReadingProgress/);
  assert.match(progress, /api\.reader\.setReadingProgress/);
  assert.match(progress, /跳过本次/);
  assert.match(progress, />进度</);
  assert.doesNotMatch(progress, /setReadingMark|clearReadingMark|readingMarks|listReadingMarks/);
  const list = read('src/components/reader/ReadingProgressPanel.tsx');
  assert.match(list, /api\.reader\.listReadingProgress/);
  assert.match(list, /进度 \{Math\.round\(item\.progress \* 100\)\}%/);
  assert.doesNotMatch(list, /listReadingMarks|ReadingStatusMenu|item\.status|readingStatus/);
  const marks = read('src/components/reader/ReadingMarksPanel.tsx');
  assert.match(marks, /api\.reader\.listReadingMarks/);
  assert.doesNotMatch(marks, /readingProgress|listReadingProgress|item\.progress/);
  const panel = read('src/components/reader/MyPanel.tsx');
  assert.match(panel, /<ReadingMarksPanel \/>/);
  assert.match(panel, /<ReadingProgressPanel \/>/);
  assert.match(panel, /\{id: 'reading', label: '阅读'\}/);
});
