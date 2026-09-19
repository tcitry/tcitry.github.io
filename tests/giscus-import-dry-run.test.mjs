import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  KNOWN_DISCUSSION_RISKS,
  buildDryRunReport,
  canonicalPathname,
  parseDiscussionPathTerms,
  pathTermsToCandidates,
  proposeDiscussionMapping,
  syntheticGithubOwner,
} from '../scripts/lib/giscus-import.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));

test('synthetic GitHub owners stay distinct from Clerk token identifiers', () => {
  assert.equal(syntheticGithubOwner(5220740), 'github:user:5220740');
});

test('discussion titles parse giscus pathname terms', () => {
  assert.deepEqual(parseDiscussionPathTerms('TabView · docs/Xcode/SwiftUI/View/TabView/ · docs/Apple/SwiftUI/Layout/TabView/'), [
    'docs/Xcode/SwiftUI/View/TabView/',
    'docs/Apple/SwiftUI/Layout/TabView/',
  ]);
  assert.deepEqual(parseDiscussionPathTerms('posts/Clash-Verge-RevClash-Party-%E4%B8%8E-Surge-Mac-6macOS-%E4%BB%A3%E7%90%86%E5%AE%A2%E6%88%B7%E7%AB%AF%E6%80%8E%E4%B9%88%E9%80%89/'), [
    'posts/Clash-Verge-RevClash-Party-%E4%B8%8E-Surge-Mac-6macOS-%E4%BB%A3%E7%90%86%E5%AE%A2%E6%88%B7%E7%AB%AF%E6%80%8E%E4%B9%88%E9%80%89/',
  ]);
});

test('canonical pathname encoding matches legacy routes', () => {
  assert.equal(
    canonicalPathname('docs/Apple/SwiftUI/Layout/TabView/'),
    '/docs/Apple/SwiftUI/Layout/TabView/',
  );
  assert.equal(
    canonicalPathname('/posts/macos-proxy-client-comparison/'),
    '/posts/macos-proxy-client-comparison/',
  );
});

test('known risks cover dual-path and mangled slug discussions', async () => {
  const legacy = JSON.parse(await readFile(path.join(root, 'scripts/legacy-routes.json'), 'utf8'));
  const site = {
    urls: new Set(legacy.pages.map(page => canonicalPathname(page.url)).filter(Boolean)),
    byTitle: new Map(),
    legacyPages: legacy.pages,
  };
  const dual = proposeDiscussionMapping({
    number: 148,
    title: 'TabView · docs/Xcode/SwiftUI/View/TabView/ · docs/Apple/SwiftUI/Layout/TabView/',
    url: 'https://github.com/tcitry/tcitry.github.io/discussions/148',
    createdAt: '2025-01-16T18:00:00Z',
    comments: { totalCount: 2, nodes: [] },
  }, site);
  assert.equal(dual.proposedPathname, '/docs/Apple/SwiftUI/Layout/TabView/');
  assert.ok(dual.risks.some(risk => risk.code === 'dual_path'));

  const mangled = proposeDiscussionMapping({
    number: 160,
    title: 'posts/Clash-Verge-RevClash-Party-%E4%B8%8E-Surge-Mac-6macOS-%E4%BB%A3%E7%90%86%E5%AE%A2%E6%88%B7%E7%AB%AF%E6%80%8E%E4%B9%88%E9%80%89/',
    url: 'https://github.com/tcitry/tcitry.github.io/discussions/160',
    createdAt: '2026-08-10T02:42:08Z',
    comments: { totalCount: 1, nodes: [] },
  }, site);
  assert.equal(mangled.proposedPathname, '/posts/macos-proxy-client-comparison/');
  assert.ok(mangled.risks.some(risk => risk.code === 'mangled_slug'));
});

test('dry-run report shape includes mapping summary', () => {
  const report = buildDryRunReport([
    {
      number: 143,
      title: '关于 · about/',
      url: 'https://github.com/tcitry/tcitry.github.io/discussions/143',
      createdAt: '2023-03-12T14:18:29Z',
      comments: { totalCount: 0, nodes: [] },
    },
  ], {
    urls: new Set(['/about/']),
    byTitle: new Map(),
    legacyPages: [],
  });
  assert.equal(report.totals.discussions, 1);
  assert.equal(report.mappings[0].proposedPathname, '/about/');
  assert.equal(pathTermsToCandidates(parseDiscussionPathTerms('关于 · about/')).length, 1);
});
