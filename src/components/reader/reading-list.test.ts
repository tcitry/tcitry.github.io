import {describe, expect, test} from 'vitest';
import {
  canLoadReadingList,
  mergeReadingEntries,
  readingListMeta,
  shouldLoadReadingProgress,
  type ReadingMarkRow,
  type ReadingProgressRow,
} from './reading-list';

const day = Date.UTC(2026, 9, 21, 12);
const cloudflare = '/docs/Cloudflare/cloudflare-os-product-and-workers-architecture/';
const title = 'Cloudflare OS：产品形态、Gadgets、Gatekeepers 与 Workers 架构';

const marks: ReadingMarkRow[] = [
  {pathname: cloudflare, title, status: 'later', updatedAt: day},
  {pathname: '/docs/mark-only/', title: '只有阅读标记的文章', status: 'read', updatedAt: day - 86_400_000},
];
const progress: ReadingProgressRow[] = [
  {pathname: cloudflare, title: '较新的进度标题', progress: 1, updatedAt: day + 1_000},
  {pathname: '/docs/progress-only/', title: '只有进度的文章', progress: 0.42, updatedAt: day - 2 * 86_400_000},
];

describe('merged reading list', () => {
  test('keeps one row per pathname and still shows progress-only and mark-only articles', () => {
    const rows = mergeReadingEntries(marks, progress, null);
    expect(rows.map(row => row.pathname)).toEqual([
      cloudflare,
      '/docs/mark-only/',
      '/docs/progress-only/',
    ]);
    expect(rows[0]).toMatchObject({title: '较新的进度标题', status: 'later', progress: 1, updatedAt: day + 1_000});
    expect(rows[1]).toMatchObject({status: 'read', progress: null, title: '只有阅读标记的文章'});
    expect(rows[2]).toMatchObject({status: null, progress: 0.42, title: '只有进度的文章'});
  });

  test('filters on reading status and keeps progress for the matching article', () => {
    const later = mergeReadingEntries(marks, progress, 'later');
    expect(later).toHaveLength(1);
    expect(later[0]).toMatchObject({pathname: cloudflare, status: 'later', progress: 1});
    expect(mergeReadingEntries(marks, progress, 'skimmed')).toEqual([]);
    expect(mergeReadingEntries(marks, progress, 'read').map(row => row.pathname)).toEqual(['/docs/mark-only/']);
  });

  test('omits missing status or progress from the meta line', () => {
    expect(readingListMeta({statusLabel: '稍后读', progress: 1, updatedAt: day})).toBe(`稍后读 · 进度 100% · ${readingListMeta({statusLabel: null, progress: null, updatedAt: day})}`);
    expect(readingListMeta({statusLabel: '已细读', progress: null, updatedAt: day})).toBe(`已细读 · ${readingListMeta({statusLabel: null, progress: null, updatedAt: day})}`);
    expect(readingListMeta({statusLabel: null, progress: 0.42, updatedAt: day})).toBe(`进度 42% · ${readingListMeta({statusLabel: null, progress: null, updatedAt: day})}`);
    expect(readingListMeta({statusLabel: null, progress: null, updatedAt: day})).toBe('2026年10月21日');
  });

  test('loads the other list only when a filtered row can still gain progress', () => {
    expect(canLoadReadingList(null, 'Exhausted', 'CanLoadMore', false)).toBe(true);
    expect(canLoadReadingList('later', 'CanLoadMore', 'CanLoadMore', false)).toBe(true);
    expect(shouldLoadReadingProgress('later', 'CanLoadMore', 'CanLoadMore', false)).toBe(true);
    expect(canLoadReadingList('later', 'Exhausted', 'CanLoadMore', true)).toBe(true);
    expect(canLoadReadingList('later', 'Exhausted', 'CanLoadMore', false)).toBe(false);
    expect(canLoadReadingList('later', 'Exhausted', 'Exhausted', true)).toBe(false);
  });
});
