import {describe, expect, test} from 'vitest';
import {readingEntries, readingListMeta, type ReadingMarkRow} from './reading-list';

const day = Date.UTC(2026, 9, 21, 12);
const cloudflare = '/docs/Cloudflare/cloudflare-os-product-and-workers-architecture/';
const title = 'Cloudflare OS：产品形态、Gadgets、Gatekeepers 与 Workers 架构';

const marks: ReadingMarkRow[] = [
  {pathname: cloudflare, title, status: 'later', updatedAt: day},
  {pathname: '/docs/mark-only/', title: '只有阅读标记的文章', status: 'read', updatedAt: day - 86_400_000},
  {pathname: cloudflare, title: '较旧的标题', status: 'skimmed', updatedAt: day - 1_000},
];

describe('reading list', () => {
  test('keeps one row per pathname, newest first, without a progress percentage', () => {
    const rows = readingEntries(marks);
    expect(rows.map(row => row.pathname)).toEqual([cloudflare, '/docs/mark-only/']);
    expect(rows[0]).toEqual({pathname: cloudflare, title, status: 'later', updatedAt: day});
    expect(rows[1]).toMatchObject({status: 'read', title: '只有阅读标记的文章'});
    expect(rows[0]).not.toHaveProperty('progress');
  });

  test('meta is status and date', () => {
    const date = readingListMeta({statusLabel: null, updatedAt: day});
    expect(date).toBe('2026年10月21日');
    expect(readingListMeta({statusLabel: '稍后读', updatedAt: day})).toBe(`稍后读 · ${date}`);
    expect(readingListMeta({statusLabel: '已细读', updatedAt: day})).toBe(`已细读 · ${date}`);
    expect(readingListMeta({statusLabel: '稍后读', updatedAt: day})).not.toMatch(/进度|%/);
  });
});
