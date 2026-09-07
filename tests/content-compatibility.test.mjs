import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { collectSources, publicSources, defaultRoute, asList } from '../scripts/legacy-content.mjs';
import { createReferenceResolver, transformLegacyMarkdown, createLegacyMarkdownRenderer } from '../src/lib/markdown.mjs';

test('public scanner cannot publish authoring folders, nested dependencies, symlinks or drafts', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'blog-content-test-'));
  try {
    const files = {
      '_index.md': '---\ntitle: Home\n---\n',
      'docs/_index.md': '---\ncascade:\n  draft: true\n---\n',
      'docs/hidden.md': '---\ntitle: Inherited draft\n---\n',
      'docs/public.md': '---\ntitle: Public\ndraft: false\n---\n',
      'docs/never.md': '---\ndraft: false\nbuild:\n  render: never\n---\n',
      'posts/public.md': '---\ntitle: Public\n---\n',
      'posts/draft.md': '---\ndraft: true\n---\n',
      'private/secret.md': '---\ntitle: Secret\n---\n',
      'docs/node_modules/readme.md': '---\ntitle: Dependency\n---\n',
      'docs/.Archive/archived.md': '---\ntitle: Archived\n---\n',
      'Agents.md': '---\ntitle: Operational instructions\n---\n',
    };
    for (const [relative, body] of Object.entries(files)) {
      await mkdir(path.dirname(path.join(directory, relative)), { recursive: true });
      await writeFile(path.join(directory, relative), body);
    }
    const records = publicSources(await collectSources(directory));
    assert.deepEqual(records.map((record) => record.source).sort(), ['_index.md', 'docs/public.md', 'posts/public.md']);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('routes preserve path case, Chinese encoding, explicit URLs and posts slugs', () => {
  assert.equal(defaultRoute({ source: 'docs/Swift/Hello 世界.md', data: {} }), '/docs/Swift/Hello-%E4%B8%96%E7%95%8C/');
  assert.equal(defaultRoute({ source: 'posts/2026/✅例子.md', data: { slug: 'My-Post' } }), '/posts/My-Post/');
  assert.equal(defaultRoute({ source: 'docs/Other.md', data: { url: '/posts/existing-path/' } }), '/posts/existing-path/');
  assert.equal(defaultRoute({ source: 'docs/Swift/_index.md', data: {} }), '/docs/Swift/');
  assert.deepEqual(asList(2026), ['2026']);
});

test('relref conversion resolves prose while preserving code and escaped examples', () => {
  const resolve = createReferenceResolver([{ source: 'docs/Swift/文章.md', url: '/posts/kept-path/' }]);
  const input = '[Read]({{< relref "docs/Swift/文章.md#heading" >}})\n`{{< relref "docs/Swift/文章.md" >}}`\n```md\n{{< relref "docs/Swift/文章.md" >}}\n```\n\\{{< relref "docs/Swift/文章.md" >}}';
  const result = transformLegacyMarkdown(input, 'about.md', resolve);
  assert.match(result, /^\[Read\]\(\/posts\/kept-path\/#heading\)/);
  assert.match(result, /`\{\{< relref "docs\/Swift\/文章\.md" >\}\}`/);
  assert.match(result, /```md\n\{\{< relref/);
  assert.match(result, /\\\{\{< relref/);
});

test('article renderer keeps math, Mermaid source, raw embeds, heading IDs and static code', async () => {
  const render = await createLegacyMarkdownRenderer();
  const result = await render('## 中文 Heading\n\n> Plain quote\n\n> [!NOTE]\n> Alert body\n\n| Left | Right |\n| :--- | ---: |\n| a | b |\n\n$x^2$\n\n```mermaid\ngraph TD\nA-->B\n```\n\n```tsx\nconst App = () => <div>Hello</div>\n```\n\n<iframe src="/demos/example/" title="Demo"></iframe>', new URL('file:///public/example.md'));
  assert.match(result.html, /class="katex"/);
  assert.match(result.html, /<blockquote class="book-hint">/);
  assert.match(result.html, /<blockquote class="book-hint note">/);
  assert.match(result.html, /<div class="table-scroll"[^>]*>/);
  assert.match(result.html, /scope="col" style="text-align: right;/);
  assert.ok(!result.html.includes('mermaid-figure'));
  assert.match(result.html, /class="mermaid"/);
  assert.match(result.html, /A--(?:>|&gt;)B/);
  assert.match(result.html, /data-blog-code-language="tsx"/);
  assert.match(result.html, /data-blog-code-fallback/);
  assert.doesNotMatch(result.html, /class="expressive-code/);
  assert.match(result.html, /<iframe src="\/demos\/example\/"/);
  assert.equal(result.headings[0].slug, '中文-heading');
});

test('generated content preserves every exported public legacy route and unique taxonomies', async () => {
  let content;
  try { content = JSON.parse(await readFile(new URL('../.generated/content.json', import.meta.url), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  const baseline = JSON.parse(await readFile(new URL('../scripts/legacy-routes.json', import.meta.url), 'utf8'));
  const urls = new Set(content.pages.map((page) => page.url));
  for (const page of baseline.pages.filter((page) => ['home', 'page', 'section'].includes(page.kind))) assert.ok(urls.has(page.url), `Missing legacy route ${page.url}`);
  assert.equal(urls.size, content.pages.length);
  for (const terms of [content.tags, content.categories]) {
    assert.equal(new Set(terms.map((term) => term.url)).size, terms.length);
    for (const term of terms) for (const id of term.pageIds) assert.ok(content.pages.some((page) => page.id === id));
  }
  const shadowed = content.pages.find((page) => page.source === 'docs/Python/语言基础/_index.md');
  assert.equal(shadowed.kind, 'section');
  assert.equal(shadowed.html, '');
  assert.deepEqual(shadowed.params.legacySuppressedSources, ['docs/Python/语言基础.md']);
  assert.equal(content.pages.find((page) => page.source === 'timeline.md').kind, 'page');
});

test('legacy math delimiters render without treating emphasis-separated currency or URLs as formulas', async () => {
  const markdown = String.raw`Inline $x^2$ and \( y^2 \).

$$
z^2
$$

\[
w^2
\]

Pro 标价为 **$10 / seat / month**，每个 seat 每月包含 **5,000 次 API calls**；超出后按 **$10 / 1,000 次**计费，解析按 **$5 / 1M tokens**计费。

A numeric formula $10 + x$ remains mathematical.

[Apple](https://developer.apple.com/documentation/swiftui/view/clipshape\(_:style:\))

Do not change inline code: \( x \) is shown below.
` + '\n`\\( raw \\)`\n\n```swift\nprint("Price: \\(value)")\n```';
  const transformed = transformLegacyMarkdown(markdown, 'fixture.md', () => null);
  const render = await createLegacyMarkdownRenderer();
  const result = await render(transformed, new URL('file:///public/fixture.md'));
  assert.match(result.html, /<strong>\$10 \/ seat \/ month<\/strong>/);
  assert.match(result.html, /<strong>\$10 \/ 1,000 次<\/strong>/);
  assert.match(result.html, /<strong>\$5 \/ 1M tokens<\/strong>/);
  assert.match(result.html, /href="https:\/\/developer\.apple\.com\/documentation\/swiftui\/view\/clipshape\(_:style:\)"/);
  assert.equal((result.html.match(/class="katex-display"/g) || []).length, 2);
  assert.match(result.html, /encoding="application\/x-tex">10 \+ x<\/annotation>/);
  assert.match(result.html, /<code>\\\( raw \\\)<\/code>/);
  assert.ok(!result.html.includes('katex-error'));
});
