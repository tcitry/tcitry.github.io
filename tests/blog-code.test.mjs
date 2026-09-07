import assert from 'node:assert/strict';
import test from 'node:test';
import {createBookProcessor} from '@tcitry/astro-book/markdown';
import {createLegacyMarkdownRenderer, rehypeBlogCodeBlocks, remarkBlogCodeSource} from '../src/lib/markdown.mjs';

const decode = (value) => value.replace(/&#(x[\da-f]+|\d+);|&(amp|lt|gt|quot);/gi, (_, numeric, named) => numeric
  ? String.fromCodePoint(numeric[0].toLowerCase() === 'x' ? parseInt(numeric.slice(1), 16) : Number(numeric))
  : ({amp: '&', lt: '<', gt: '>', quot: '"'})[named]);
const codeText = (html) => decode(html.match(/<pre\b[^>]*><code\b[^>]*>([\s\S]*?)<\/code><\/pre>/)[1]);

test('article fallback preserves terminal comments, tabs, blank lines and final newline for Pro copy', async () => {
  const render = await createLegacyMarkdownRenderer();
  const source = '\n\t# Keep this comment\n  echo "<&>"  \n\n';
  const {html} = await render('```bash\n' + source + '```');
  assert.equal(codeText(html), source);
  assert.equal((html.match(/data-blog-code-language=/g) ?? []).length, 1);
  assert.match(html, /data-blog-code-language="bash"/);
  assert.doesNotMatch(html, /expressive-code|<button|<script|astro-island/);
});

test('raw pre and unknown languages remain readable while islands and Mermaid are excluded', async () => {
  const render = await createLegacyMarkdownRenderer();
  const {html} = await render('```future-language\nunknown()\n```\n\n<pre><code>\t&lt;raw&gt;  \n</code></pre>\n\n<div data-demo="own"><pre><code>Own renderer</code></pre></div>\n\n```mermaid\ngraph TD\n A-->B\n```');
  assert.equal((html.match(/data-blog-code-language=/g) ?? []).length, 2);
  assert.match(html, /data-blog-code-language="future-language"/);
  assert.match(html, /class="mermaid" data-book-mermaid/);
  assert.match(html, /<div data-demo="own"><pre><code>Own renderer/);
  assert.match(html, /\t&#x3C;raw>  \n|\t&lt;raw&gt;  \n/);
});

test('unclosed EOF fences and empty fences do not gain a synthetic newline', async () => {
  const render = await createLegacyMarkdownRenderer();
  for (const [markdown, source] of [
    ['```ts\nconst x = 1;', 'const x = 1;'],
    ['```ts\nconst x = 1;\n', 'const x = 1;\n'],
    ['```\n```', ''], ['```\n\n```', '\n'],
    ['> ```bash\n> echo hi\n> ```', 'echo hi\n'],
  ]) assert.equal(codeText((await render(markdown)).html), source);
});

test('MDX emits the same static wrapper and keeps component-owned code independent', async () => {
  const processor = createBookProcessor({code: false, remarkPlugins: [remarkBlogCodeSource], rehypePlugins: [rehypeBlogCodeBlocks]});
  const renderer = await processor.createMdxRenderer({syntaxHighlight: false}, {optimize: false});
  const result = await renderer.process('```ts\nconst x = 1;\n```\n\n<section data-book-island><pre><code>owned</code></pre></section>\n\n$x^2$\n\n```mermaid\ngraph TD\n A-->B\n```', '/synthetic.mdx', {});
  assert.equal((result.code.match(/"data-blog-code-language"/g) ?? []).length, 1);
  assert.match(result.code, /const x = 1;\\n/);
  assert.match(result.code, /data-book-mermaid/);
  assert.match(result.code, /katex/);
  assert.doesNotMatch(result.code, /expressive-code|react-dom|BlogCodeBlock/);
});
