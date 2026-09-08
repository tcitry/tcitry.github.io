import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { articleMarkdown, assertCorpusRelease, canonicalURL, createCorpus, jsonBytes, readCorpus, sha256 } from '../scripts/lib/ai-search-corpus.mjs';

const page = (slug, extra = {}) => ({ kind: 'page', type: 'posts', url: `/posts/${slug}/`, title: `文章 ${slug}`, html: '<p>公开正文</p>',
  tags: [], params: {}, date: '2026-08-01T00:00:00Z', lastmod: '2026-09-01T00:00:00Z', ...extra });

test('corpus exports only public independent article content and allowlisted fields', () => {
  const pages = [page('public', { source: 'private/original.md', params: { token: 'secret', linkTitle: '显示标题' } }),
    page('docs', { type: 'docs', url: '/docs/example/' }), page('weekly', { type: 'weekly', url: '/weekly/42/' }),
    page('section', { kind: 'section' }), page('hidden', { hidden: true }), page('redirect', { redirect: true }),
    page('draft', { params: { draft: 'true' } }), page('excluded', { params: { bookSearchExclude: true } }),
    page('lowercase', { params: { booksearchexclude: 'true' } }), page('false', { params: { draft: false, bookSearchExclude: 'false' } }),
    page('labs', { type: 'labs' }), page('empty', { html: '  ' }), page('ui', { html: '<script>private text</script><button>send</button>' })];
  const result = createCorpus(pages);
  assert.equal(result.documents.length, 4);
  const publicArticle = result.documents.find(document => document.url.endsWith('/public/'));
  assert.equal(publicArticle.title, '显示标题');
  assert.doesNotMatch(JSON.stringify(result), /private\/original|secret|bookSearchExclude|"params"|"source"/);
  assert.doesNotMatch(JSON.stringify(result.references), /公开正文|"markdown"/);
});

test('HTML conversion preserves code bytes, syntax, links, headings, tables and ByAi notice', () => {
  const code = '\tconst value = `<raw>`;  \n\n\n// ``` embedded fence\n';
  const html = `<h2>标题<a class="anchor" href="#heading">#</a></h2><p>正文 <code>x &lt; 2</code><a href="../next/">下一篇</a></p>
    <div data-blog-code data-blog-code-language="js"><button>复制</button><div data-blog-code-fallback><pre><code>${code.replaceAll('<', '&lt;').replaceAll('>', '&gt;')}</code></pre></div></div>
    <table><thead><tr><th>参数</th><th>含义</th></tr></thead><tbody><tr><td>limit</td><td>上限</td></tr></tbody></table>
    <div data-demo="private"><p>演示界面</p></div><p aria-hidden="true">隐藏UI</p>`;
  const { documents } = createCorpus([page('code', { html, tags: ['ByAi'] })]);
  const document = documents[0];
  assert.equal(document.sourceKind, 'ai-assisted');
  assert.match(document.markdown, /ByAi — 本文整理自与 AI 的对话/);
  assert.ok(document.markdown.includes('````js\n' + code + '````'));
  assert.match(document.markdown, /## 标题/);
  assert.match(document.markdown, /\[下一篇\]\(<https:\/\/yindongliang.com\/posts\/next\/>\)/);
  assert.match(document.markdown, /\| 参数 \| 含义 \|\n\| --- \| --- \|/);
  assert.doesNotMatch(document.markdown, /复制|演示界面|隐藏UI|class=|data-blog-code/);
  assert.equal(articleMarkdown('<p>&lt;safe&gt;</p>', document.url), '\\<safe\\>');
});

test('stable keys follow canonical encoded URLs while hash tracks public content only', () => {
  const original = page('encoded', { url: '/posts/%E4%B8%AD%E6%96%87/' });
  const first = createCorpus([original]).documents[0];
  const second = createCorpus([{ ...original, source: 'moved.md', params: { private: 'changed' } }]).documents[0];
  assert.equal(first.url, 'https://yindongliang.com/posts/%E4%B8%AD%E6%96%87/');
  assert.equal(first.id, sha256(first.url));
  assert.equal(first.key, second.key);
  assert.equal(first.hash, second.hash);
  const changed = createCorpus([{ ...original, html: '<p>新的公开正文</p>' }]).documents[0];
  assert.equal(first.key, changed.key);
  assert.notEqual(first.hash, changed.hash);
  assert.notEqual(first.key, createCorpus([{ ...original, url: '/posts/renamed/' }]).documents[0].key);
  for (const route of ['//foreign.test/posts/test/', '/posts/test/?q=x', '/posts/test/#x', '/posts/', '/labs/test/', '/posts/a\\b/', 'file:///posts/a/']) assert.throws(() => canonicalURL(route));
  assert.throws(() => createCorpus([original, { ...original, url: '/posts/中文/' }]), /Duplicate canonical/);
});

test('release sealing binds corpus bytes, references and production revisions to published pages', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ai-search-corpus-'));
  try {
    const directory = path.join(root, '.generated/ai-search');
    await mkdir(path.join(directory, 'documents'), { recursive: true });
    const revision = { siteCommit: 'a'.repeat(40), contentCommit: 'b'.repeat(40) };
    const corpus = createCorpus([page('test')], { environment: 'production', revision });
    await writeFile(path.join(directory, 'references.json'), jsonBytes(corpus.references));
    await writeFile(path.join(directory, 'manifest.json'), jsonBytes(corpus.manifest));
    const filename = path.join(directory, 'documents', `${corpus.documents[0].id}.md`);
    await writeFile(filename, corpus.documents[0].markdown);
    const release = { ...revision, assets: { 'posts/test/index.html': 'sealed' } };
    const checked = await assertCorpusRelease(root, release);
    assert.equal(checked.seal.count, 1);
    await assert.rejects(assertCorpusRelease(root, { ...release, contentCommit: 'c'.repeat(40) }), /content revision/);
    await assert.rejects(assertCorpusRelease(root, { ...release, assets: {} }), /absent/);
    await writeFile(filename, (await readFile(filename, 'utf8')) + 'changed');
    await assert.rejects(readCorpus(directory), /changed after export/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
