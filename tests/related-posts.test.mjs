import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const result = await build({
  entryPoints: [new URL('../src/lib/related-posts.ts', import.meta.url).pathname],
  bundle: true, platform: 'node', format: 'esm', write: false,
});
const { getRelatedPosts, getRelatedPostsAnchor } = await import(
  'data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64')
);
const post = (id, overrides = {}) => ({
  id, url: `/posts/${id}/`, title: id, kind: 'page', type: 'posts', section: 'posts',
  date: '2025-01-01', tags: ['Astro'], categories: ['2025'], headings: [],
  hidden: false, redirect: false, params: {}, ...overrides,
});

test('related posts prefer shared topics, then publication date, with stable ties', () => {
  const current = post('current', { tags: ['Astro', 'Blog'] });
  const both = post('two-topics', { tags: ['Blog', 'Astro'], date: '2020-01-01' });
  const newer = post('newer', { date: '2026-01-01' });
  const a = post('a');
  const b = post('b');
  const candidates = [b, current, newer, a, both];
  assert.deepEqual(getRelatedPosts(current, candidates).map((p) => p.id), ['two-topics', 'newer', 'a', 'b']);
  assert.deepEqual(getRelatedPosts(current, [...candidates].reverse()), getRelatedPosts(current, candidates));
  assert.deepEqual(candidates.map((p) => p.id), ['b', 'current', 'newer', 'a', 'two-topics'], 'Do not mutate the shared content collection');
});

test('editorial labels and publication years do not create unrelated recommendations', () => {
  const current = post('current', { tags: ['Astro', 'Recommended', 'ByAI'] });
  const unrelated = post('unrelated', { tags: ['Swift', 'Recommended', 'ByAI'] });
  const sameYear = post('same-year', { tags: [] });
  assert.deepEqual(getRelatedPosts(current, [unrelated, sameYear]), []);
  assert.deepEqual(getRelatedPosts(post('untagged', { tags: ['Recommended'] }), [current]), []);
});

test('specific shared subjects rank above a common tag when overlap counts tie', () => {
  const current = post('current', { tags: ['Blog', 'Life'] });
  const blog = post('blog', { tags: ['Blog'], date: '2015-01-01' });
  const life = Array.from({ length: 7 }, (_, i) => post(`life-${i}`, { tags: ['Life'], date: '2026-01-01' }));
  const related = getRelatedPosts(current, [...life, blog]);
  assert.equal(related[0].id, 'blog', 'A recent general-interest article must not displace the specific shared topic');
  assert.equal(related.length, 5);
});

test('topic spelling is normalized and repeated tags do not inflate relevance', () => {
  const current = post('current', { tags: ['ASTRO', 'Blog'] });
  const repeated = post('repeated', { tags: ['astro', ' Astro ', 'ＡＳＴＲＯ'], date: '2026-01-01' });
  const both = post('both', { tags: ['astro', 'blog'], date: '2020-01-01' });
  assert.deepEqual(getRelatedPosts(current, [repeated, both]).map((p) => p.id), ['both', 'repeated']);
});

test('only public posts are eligible, including posts stored inside docs', () => {
  const current = post('current');
  const excluded = [
    current, post('same-url', { url: current.url }), post('docs', { type: 'docs' }),
    post('section', { kind: 'section' }), post('hidden', { hidden: true }),
    post('draft', { params: { draft: true } }), post('string-draft', { params: { draft: 'true' } }),
    post('redirect', { redirect: true }),
  ];
  const visible = post('nested', { section: 'docs' });
  assert.deepEqual(getRelatedPosts(current, [...excluded, visible]), [visible]);
  for (const page of excluded.filter((p) => p !== current && p.url !== current.url)) {
    assert.deepEqual(getRelatedPosts(page, [visible]), [], `No related section for ${page.id}`);
  }
});

test('recommendations contain at most five distinct article URLs', () => {
  const current = post('current');
  const candidates = Array.from({ length: 8 }, (_, i) => post(`post-${i}`));
  const duplicate = post('duplicate', { url: candidates[0].url });
  const related = getRelatedPosts(current, [...candidates, duplicate]);
  assert.equal(related.length, 5);
  assert.equal(new Set(related.map((p) => p.url)).size, 5);
});

test('the related section anchor does not shadow an existing article heading', () => {
  const current = post('current', { headings: [{ slug: 'related-posts' }, { slug: 'related-posts-2-heading' }] });
  assert.equal(getRelatedPostsAnchor(current), 'related-posts-3');
  assert.equal(getRelatedPostsAnchor(post('plain')), 'related-posts');
});
