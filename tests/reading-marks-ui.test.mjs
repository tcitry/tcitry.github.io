import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('article reading mark sits left of like, and bookmark stays on the comment actions row', () => {
  const layout = read('src/layouts/BookLayout.astro');
  assert.doesNotMatch(layout, /ArticleReaderIsland/);
  assert.match(layout, /<Comments[^>]*bookmarkable=\{readerArticle\}/);
  const comments = read('src/components/comments/CommentsRoot.tsx');
  const actions = comments.slice(comments.indexOf('blog-comments__article-actions'));
  const mark = actions.indexOf('<ReadingMarkControl ');
  const like = actions.indexOf('{likeButton}');
  const bookmark = actions.indexOf('<BookmarkButton ');
  assert.ok(mark >= 0 && like > mark && bookmark > like, 'Reading mark, like and bookmark stay in that order');
  const article = read('src/components/reader/ArticleReader.tsx');
  assert.doesNotMatch(article, /ReadingMarkControl/);
  assert.match(article, /<ReadingProgress /);
  assert.match(article, /<BookmarkButton /);
  assert.match(article, /data-sentry-mask data-pagefind-ignore/);
  assert.match(article, /isAuthenticated \? \{pathname\} : 'skip'/);
});

test('reading list is a top-level assistant tab with one merged row per article', () => {
  const mine = read('src/components/reader/MyPanel.tsx');
  assert.doesNotMatch(mine, /ReadingMarksPanel|id: 'reading'/);
  const workspace = read('src/components/chat/AssistantWorkspace.tsx');
  assert.match(workspace, /\{id: 'reading', label: '阅读'\}/);
  assert.match(workspace, /<ReadingMarksPanel \/>/);
  assert.doesNotMatch(workspace, /ReadingProgressPanel/);
  assert.match(read('src/scripts/assistant-ui-state.mjs'), /'reading'/);
  const list = read('src/components/reader/ReadingMarksPanel.tsx');
  assert.match(list, /api\.reader\.listReadingMarks/);
  assert.match(list, /api\.reader\.listReadingProgress/);
  assert.match(list, /usePaginatedQuery\(api\.reader\.listReadingProgress, \{\}/);
  assert.match(list, /filter \? \{status: filter\} : \{\}/);
  assert.match(list, /emptyLabel="全部状态"/);
  assert.doesNotMatch(list, /全部档次/);
  assert.match(list, /mergeReadingEntries/);
  assert.match(list, /loadMore\(20\)/);
  assert.match(list, /href=\{entry\.pathname\}/);
  assert.doesNotMatch(list, /itemPath|sectionLabel|>进度</);
  assert.doesNotMatch(list, /api\.reader\.listLibrary/);
  assert.match(read('src/components/reader/reading-list.ts'), /export function mergeReadingEntries/);
  assert.doesNotMatch(read('convex/reader.ts'), /mergeReadingEntries|listReadingEntries/);
});
