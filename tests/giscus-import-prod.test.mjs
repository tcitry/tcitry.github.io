import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  APPROVED_PATHNAME_OVERRIDES,
  buildProductionImportPlan,
  canonicalPathname,
  isApprovedForImport,
  resolveImportPathname,
} from '../scripts/lib/giscus-import.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));

test('approved overrides lock pathname for discussions 148 and 160', async () => {
  const legacy = JSON.parse(await readFile(path.join(root, 'scripts/legacy-routes.json'), 'utf8'));
  const site = {
    urls: new Set(legacy.pages.map(page => canonicalPathname(page.url)).filter(Boolean)),
    byTitle: new Map(),
    legacyPages: legacy.pages,
  };
  const plan = buildProductionImportPlan([
    {
      number: 148,
      title: 'TabView · docs/Xcode/SwiftUI/View/TabView/ · docs/Apple/SwiftUI/Layout/TabView/',
      url: 'https://github.com/tcitry/tcitry.github.io/discussions/148',
      createdAt: '2025-01-16T18:00:00Z',
      comments: {
        totalCount: 1,
        nodes: [{
          databaseId: 1,
          createdAt: '2025-01-16T18:00:01Z',
          url: 'https://github.com/tcitry/tcitry.github.io/discussions/148#discussioncomment-1',
          author: { login: 'reader', databaseId: 42 },
          body: 'question',
          replies: { totalCount: 0, nodes: [] },
        }],
      },
    },
    {
      number: 160,
      title: 'posts/Clash-Verge-RevClash-Party-%E4%B8%8E-Surge-Mac-6macOS-%E4%BB%A3%E7%90%86%E5%AE%A2%E6%88%B7%E7%AB%AF%E6%80%8E%E4%B9%88%E9%80%89/',
      url: 'https://github.com/tcitry/tcitry.github.io/discussions/160',
      createdAt: '2026-08-10T02:42:08Z',
      comments: {
        totalCount: 1,
        nodes: [{
          databaseId: 2,
          createdAt: '2026-08-10T02:42:09Z',
          url: 'https://github.com/tcitry/tcitry.github.io/discussions/160#discussioncomment-2',
          author: { login: 'tcitry', databaseId: 5220740 },
          body: 'note',
          replies: { totalCount: 0, nodes: [] },
        }],
      },
    },
  ], site);
  assert.equal(plan.totals.approvedDiscussions, 2);
  assert.equal(plan.totals.commentsAndReplies, 2);
  assert.deepEqual(plan.pathnameOverrides, APPROVED_PATHNAME_OVERRIDES);
  assert.equal(plan.rows[0].pathname, APPROVED_PATHNAME_OVERRIDES[148]);
  assert.equal(plan.rows[1].pathname, APPROVED_PATHNAME_OVERRIDES[160]);
  assert.equal(plan.rows[0].owner, 'github:user:42');
});

test('non-overridden mappings require zero risks', () => {
  const ready = {
    discussionNumber: 149,
    proposedPathname: '/posts/review-2024/',
    risks: [],
    comments: [{ externalId: '1', owner: 'github:user:1', body: 'hi', createdAt: '2025-01-01T00:00:00Z' }],
  };
  const risky = { ...ready, discussionNumber: 999, risks: [{ code: 'unknown_path' }] };
  assert.equal(isApprovedForImport(ready), true);
  assert.equal(isApprovedForImport(risky), false);
  assert.equal(resolveImportPathname(ready), '/posts/review-2024/');
});
