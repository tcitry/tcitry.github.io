import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const page = (overrides = {}) => ({
  id: '', source: '', url: '/', title: 'Test', kind: 'page', section: 'docs', type: 'docs', layout: '',
  date: '2026-01-01T00:00:00.000Z', lastmod: '2026-01-01T00:00:00.000Z', description: '', summary: '', html: '<p>Content</p>',
  headings: [], tags: [], categories: [], aliases: [], weight: 0, hidden: false, collapse: false, toc: true,
  image: '', link: '', redirect: false, parent: '/docs/', wordCount: 1, params: {}, ...overrides,
});

async function loadSite(fixture) {
  const result = await build({
    entryPoints: [new URL('../src/lib/site.ts', import.meta.url).pathname], bundle: true, platform: 'node', format: 'esm', write: false,
    plugins: [{ name: 'fixture-content', setup(plugin) {
      plugin.onResolve({ filter: /\.generated\/content\.json$/ }, () => ({ path: 'content', namespace: 'fixture' }));
      plugin.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: JSON.stringify(fixture), loader: 'json' }));
    } }],
  });
  return import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'));
}

test('Book navigation prunes hidden branches and empty articles while retaining tagged sections', async () => {
  const fixture = {
    pages: [
      page({ id: 'home', source: '_index.md', url: '/', kind: 'home', type: '', section: '', parent: '' }),
      page({ id: 'docs', source: 'docs/_index.md', url: '/docs/', kind: 'section', parent: '/' }),
      page({ id: 'hidden', source: 'docs/Hidden/_index.md', url: '/docs/Hidden/', kind: 'section', hidden: true }),
      page({ id: 'child', source: 'docs/Hidden/child.md', url: '/docs/Hidden/child/', parent: '/docs/Hidden/' }),
      page({ id: 'empty', source: 'docs/empty.md', url: '/docs/empty/', html: '' }),
      page({ id: 'visible', source: 'docs/Visible/_index.md', url: '/docs/Visible/', kind: 'section', tags: ['Topic'] }),
    ],
    tags: [{ name: 'Topic', url: '/tags/Topic/', pageIds: ['visible'] }], categories: [], diagnostics: { warnings: [], sourceCount: 6 },
  };
  const site = await loadSite(fixture);
  assert.deepEqual(site.navigation.map((node) => node.page.id), ['visible']);
  const term = site.buildViews().find((view) => view.page.url === '/tags/Topic/');
  assert.deepEqual(term.entries.map((item) => item.id), ['visible']);
  assert.deepEqual(site.pagesForTerm(fixture.tags[0]).map((item) => item.id), ['visible']);
});

test('home lists dated docs, posts and weekly like archives and keeps 10-item pagination', async () => {
  const dated = [
    page({ id: 'doc-1', source: 'docs/a.md', url: '/docs/a/', type: 'docs', date: '2026-03-03T00:00:00.000Z' }),
    page({ id: 'post-1', source: 'posts/b.md', url: '/posts/b/', type: 'posts', section: 'posts', parent: '/posts/', date: '2026-03-02T00:00:00.000Z' }),
    page({ id: 'weekly-1', source: 'weekly/c.md', url: '/weekly/c/', type: 'weekly', section: 'weekly', parent: '/weekly/', date: '2026-03-01T00:00:00.000Z' }),
    ...Array.from({ length: 9 }, (_, index) => page({
      id: `post-extra-${index}`, source: `posts/extra-${index}.md`, url: `/posts/extra-${index}/`,
      type: 'posts', section: 'posts', parent: '/posts/',
      date: new Date(Date.UTC(2026, 1, 10 - index)).toISOString(),
    })),
  ];
  const site = await loadSite({ pages: [
    page({ id: 'home', url: '/', kind: 'home', type: '', section: '', parent: '' }),
    page({ id: 'posts', source: '', url: '/posts/', kind: 'section', type: 'posts', section: 'posts', parent: '/' }),
    page({ id: 'archives', source: '', url: '/archives/', kind: 'section', type: 'archives', section: 'archives', parent: '/' }),
    ...dated,
    page({ id: 'link', source: 'links/x.md', url: '/links/x/', type: 'links', section: 'links', date: '2026-04-01T00:00:00.000Z' }),
    page({ id: 'dateless-doc', source: 'docs/undated.md', url: '/docs/undated/', type: 'docs', date: '' }),
  ], tags: [], categories: [], diagnostics: { warnings: [], sourceCount: dated.length + 5 } });
  const views = site.buildViews();
  const home = views.filter((view) => view.page.kind === 'home');
  const homeIds = home.flatMap((view) => view.entries.map((entry) => entry.id));
  const archiveIds = views.find((view) => view.page.url === '/archives/').entries.map((entry) => entry.id);
  const expectedIds = ['doc-1', 'post-1', 'weekly-1', ...Array.from({ length: 9 }, (_, index) => `post-extra-${index}`)];
  assert.deepEqual(homeIds, expectedIds);
  assert.deepEqual(archiveIds, expectedIds);
  assert.equal(home.length, 2);
  assert.equal(home[0].entries.length, 10);
  assert.equal(home[1].entries.length, 2);
  assert.equal(home[1].page.url, '/page/2/');
  assert.deepEqual(home[0].pagination, { current: 1, total: 2, urls: ['/', '/page/2/'] });
  const posts = views.find((view) => view.page.url === '/posts/').entries.map((entry) => entry.id);
  assert.equal(posts.length, 11);
  assert.ok(posts.includes('weekly-1'));
  assert.ok(posts.every((id) => id.startsWith('post-') || id.startsWith('weekly-')));
  assert.ok(!posts.includes('doc-1') && !posts.includes('link'));
});

test('home pagination and posts archive retain articles located outside the posts content section', async () => {
  const posts = Array.from({ length: 105 }, (_, index) => page({
    id: 'post-' + index, source: `docs/post-${index}.md`, url: `/posts/post-${index}/`, type: 'posts', parent: '/docs/',
    date: new Date(Date.UTC(2025, 0, index + 1)).toISOString(),
  }));
  const site = await loadSite({ pages: [
    page({ id: 'home', url: '/', kind: 'home', type: '', section: '', parent: '' }),
    page({ id: 'posts', source: '', url: '/posts/', kind: 'section', type: 'posts', section: 'posts', parent: '/' }),
    ...posts,
  ], tags: [], categories: [], diagnostics: { warnings: [], sourceCount: 105 } });
  const views = site.buildViews();
  const home = views.filter((view) => view.page.kind === 'home');
  assert.equal(home.length, 11);
  assert.equal(home.at(-1).page.url, '/page/11/');
  assert.equal(home.flatMap((view) => view.entries).length, 105);
  assert.equal(new Set(home.flatMap((view) => view.entries.map((entry) => entry.id))).size, 105);
  assert.equal(views.find((view) => view.page.url === '/posts/').entries.length, 105);
});


test('Weekly pagination preserves every issue in date order at and beyond the 40-item boundary', async () => {
  for (const [count, sizes] of [[40, [40]], [41, [40, 1]], [80, [40, 40]]]) {
    const issues = Array.from({ length: count }, (_, index) => page({
      id: `weekly-${index}`, source: `weekly/issue-${index}.md`, url: `/weekly/issue-${index}/`,
      section: 'weekly', type: 'weekly', parent: '/weekly/',
      date: new Date(Date.UTC(2025, 0, index + 1)).toISOString(),
    }));
    const site = await loadSite({ pages: [
      page({ id: 'weekly', url: '/weekly/', kind: 'section', type: 'weekly', section: 'weekly', parent: '/', toc: false }),
      ...issues,
    ], tags: [], categories: [], diagnostics: { warnings: [], sourceCount: count + 1 } });
    const views = site.buildViews().filter((view) => view.page.kind === 'section' && view.page.type === 'weekly');
    const urls = sizes.map((_, index) => index ? `/weekly/page/${index + 1}/` : '/weekly/');
    assert.deepEqual(views.map((view) => view.entries.length), sizes, `${count} issues: no empty trailing page`);
    assert.deepEqual(views.map((view) => view.page.url), urls);
    assert.deepEqual(views.flatMap((view) => view.entries.map((issue) => issue.id)), [...issues].reverse().map((issue) => issue.id), 'Newest first, with no missing or repeated issues');
    for (const [index, view] of views.entries()) {
      assert.deepEqual(view.pagination, { current: index + 1, total: sizes.length, urls });
      assert.equal(view.page.toc, false, 'Every Weekly index keeps the layout without a TOC');
    }
  }
});

test('equal-date nested navigation follows Hugo Chinese collation and preserves empty legacy sort titles', async () => {
  const site = await loadSite({ pages: [
    page({ id: 'group', source: 'docs/Group/_index.md', url: '/docs/Group/', title: 'Group', kind: 'section' }),
    page({ id: 'chinese', source: 'docs/Group/分治.md', url: '/docs/Group/分治/', title: '分治策略', parent: '/docs/Group/' }),
    page({ id: 'ascii', source: 'docs/Group/BFS.md', url: '/docs/Group/BFS/', title: 'BFS 和 DFS', parent: '/docs/Group/' }),
    page({ id: 'untitled', source: 'docs/Group/Untitled/_index.md', url: '/docs/Group/Untitled/', title: 'Untitled', kind: 'section', parent: '/docs/Group/', params: { legacySortTitle: '' } }),
  ], tags: [], categories: [], diagnostics: { warnings: [], sourceCount: 4 } });
  assert.deepEqual(site.navigation[0].children.map((node) => node.page.id), ['untitled', 'ascii', 'chinese']);
});

test('docs root sections sort A-Z by title while nested levels keep weight, date and title order', async () => {
  const roots = ['软件工程', 'Rust', 'LLM', 'Agents', '历史', 'Linux', 'Algorithms', 'C/C++', 'Golang', 'Apple'];
  const site = await loadSite({ pages: [
    page({ id: 'docs', source: 'docs/_index.md', url: '/docs/', kind: 'section', parent: '/' }),
    ...roots.map((title, index) => page({
      id: `root-${index}`, source: `docs/${title}/_index.md`, url: `/docs/${encodeURIComponent(title)}/`, kind: 'section', title,
      weight: (index % 3) * 10, date: new Date(Date.UTC(2026, 0, 1 + index)).toISOString(),
    })),
    page({ id: 'nested-title-b', source: 'docs/Agents/b.md', url: '/docs/Agents/b/', title: 'B', parent: '/docs/Agents/', date: '2026-02-01T00:00:00.000Z' }),
    page({ id: 'nested-title-a', source: 'docs/Agents/a.md', url: '/docs/Agents/a/', title: 'A', parent: '/docs/Agents/', date: '2026-02-01T00:00:00.000Z' }),
    page({ id: 'nested-newer', source: 'docs/Agents/newer.md', url: '/docs/Agents/newer/', title: 'Z', parent: '/docs/Agents/', date: '2026-03-01T00:00:00.000Z' }),
    page({ id: 'nested-weight-20', source: 'docs/Agents/w20.md', url: '/docs/Agents/w20/', title: 'Y', parent: '/docs/Agents/', weight: 20 }),
    page({ id: 'nested-weight-10', source: 'docs/Agents/w10.md', url: '/docs/Agents/w10/', title: 'X', parent: '/docs/Agents/', weight: 10 }),
  ], tags: [], categories: [], diagnostics: { warnings: [], sourceCount: roots.length + 6 } });
  const expected = ['Agents', 'Algorithms', 'Apple', 'C/C++', 'Golang', 'Linux', 'LLM', 'Rust', '历史', '软件工程'];
  assert.deepEqual(site.navigation.map((node) => node.page.title), expected);
  const docs = site.buildViews().find((view) => view.page.url === '/docs/');
  assert.deepEqual(docs.entries.map((entry) => entry.title), expected);
  const nestedOrder = ['nested-weight-10', 'nested-weight-20', 'nested-newer', 'nested-title-a', 'nested-title-b'];
  assert.deepEqual(site.navigation.find((node) => node.page.title === 'Agents').children.map((node) => node.page.id), nestedOrder);
  const agents = site.buildViews().find((view) => view.page.url === '/docs/Agents/');
  assert.deepEqual(agents.entries.map((entry) => entry.id), nestedOrder);
});
