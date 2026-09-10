import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createBookProcessor } from '@tcitry/astro-book/markdown';
import { prepareMdx, syncMdxModules } from '../scripts/lib/mdx-content.mjs';
import { collectSources, publicSources, defaultRoute, matchLegacySources, resolveLegacyRoute, routeSignature } from '../scripts/legacy-content.mjs';
import { createReferenceResolver, createLegacyMarkdownRenderer, rehypeBlogCodeBlocks, remarkBlogCodeSource } from '../src/lib/markdown.mjs';

const source = 'docs/Agents/example.mdx';
const resolve = createReferenceResolver([{ source: 'docs/Agents/overview.md', url: '/docs/Agents/overview/' }, { source, url: '/docs/Agents/example/' }]);

test('MDX metadata retains nested prose, tables, headings, math and exact code without importing components or indexing props', async () => {
  const input = `import Chart from '@/components/demos/Chart';

export const data = [{ label: 'PROP_ONLY', value: 18 }];

## 同名标题

<div class="reader-table">

| 类型 | 数量 |
| --- | --- |
| 完成 | 18 |

</div>

<details>
<summary>展开说明</summary>

## 同名标题

[参考]({{< relref "docs/Agents/overview.md" >}})

</details>

<Chart client:visible initialData={data} />

$x_{1}^{2}$

\`\`\`mermaid
flowchart TB
  A[输入] --> B[图表]
\`\`\`

\`\`\`jsx
const label = '<Chart value={18} />';
\`\`\`
`;
  const prepared = prepareMdx(input, source, resolve);
  assert.match(prepared.compiledSource, /<Chart client:visible initialData=\{data\} \/>/);
  assert.match(prepared.compiledSource, /\[参考\]\(\/docs\/Agents\/overview\/\)/);
  assert.doesNotMatch(prepared.prose, /PROP_ONLY|import Chart|export const data|initialData/);
  assert.match(prepared.prose, /const label = '<Chart value=\{18\} \/>';/);
  assert.match(prepared.prose, /展开说明/);
  const render = await createLegacyMarkdownRenderer();
  const metadata = await render(prepared.prose, new URL('file:///fixture/example.mdx'));
  assert.deepEqual(metadata.headings.map(heading => heading.slug), ['同名标题', '同名标题-1']);
  assert.match(metadata.html, /<table>/);
  assert.match(metadata.html, /class="katex"/);
  assert.match(metadata.html, /class="mermaid"/);
  assert.match(metadata.html, /data-blog-code-language="jsx"/);

  const native = await createBookProcessor({ code: false, remarkPlugins: [remarkBlogCodeSource], rehypePlugins: [rehypeBlogCodeBlocks] }).createMdxRenderer({ syntaxHighlight: false }, { srcDir: new URL('../src/', import.meta.url), sourcemap: false });
  const compiled = await native.process(prepared.compiledSource, '/fixture/example.mdx', {});
  for (const heading of metadata.headings) assert.ok(compiled.code.includes(`"slug": "${heading.slug}"`));
  assert.match(compiled.code, /data-blog-code-language/);
  assert.match(compiled.code, /mermaid/);
  assert.match(compiled.code, /katex/);
  assert.equal(compiled.astroMetadata.hydratedComponents.length, 1);
});

test('legacy comments become MDX comments while examples, JavaScript and attributes stay exact', () => {
  const prepared = prepareMdx(`export const label = '<!-- string -->';

Before

<!--more-->

<span title="<!-- attribute -->">After</span>

\`<!-- inline -->\`

\`\`\`html
<!-- fence -->
\`\`\`

<!-- hidden implementation note -->`, source, resolve);
  assert.match(prepared.compiledSource, /\{\/\*more\*\/\}/);
  assert.match(prepared.prose, /Before\s+<!--more-->\s+After/);
  for (const comment of ['string', 'attribute', 'inline', 'fence']) assert.ok(prepared.compiledSource.includes(`<!-- ${comment} -->`));
  assert.doesNotMatch(prepared.prose, /hidden implementation note|string|attribute/);
});

test('MDX permits site component imports and data exports, rejects alternate import paths and dynamic imports', () => {
  assert.doesNotThrow(() => prepareMdx("import Chart from '@/components/demos/Chart.tsx';\n\nexport const counts = [18, 12];\n\n<Chart data={counts} />", source, resolve));
  for (const target of ['../private/secret.mdx', '/etc/file', '@/components/../private/data', '@/components/Private/data', '@/components/.env', '@/components/node_modules/secret', '@/components/%2e%2e/secret', '@/components//secret', 'node:fs', 'react', 'https://example.com/widget.js']) {
    assert.throws(() => prepareMdx(`import Chart from '${target}';\n\n<Chart />`, source, resolve), /Unsupported MDX import/);
    assert.throws(() => prepareMdx(`export { default as Chart } from '${target}';`, source, resolve), /Unsupported MDX import/);
  }
  assert.throws(() => prepareMdx("export const x = import('@/components/Chart');", source, resolve), /Dynamic imports/);
  assert.throws(() => prepareMdx("<Chart value={import('@/components/Chart')} />", source, resolve), /Dynamic imports/);
});

test('only public MDX modules are staged; deleted, newly drafted and symlinked sources cannot survive a refresh', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'blog-mdx-'));
  const output = path.join(root, 'generated');
  try {
    const fixtures = {
      'about.mdx': '---\ntitle: About\n---\nAbout',
      'docs/_index.mdx': '---\ncascade:\n  draft: true\n---\n',
      'docs/inherited.mdx': 'Inherited draft',
      'docs/public.mdx': '---\ndraft: false\n---\n## Public',
      'posts/draft.mdx': '---\ndraft: true\n---\nDRAFT_ONLY',
      'docs/Private/secret.mdx': 'SECRET_ONLY',
      'docs/nested/pRiVaTe/secret.mdx': 'SECRET_NESTED',
    };
    for (const [file, text] of Object.entries(fixtures)) { await mkdir(path.dirname(path.join(root, file)), { recursive: true }); await writeFile(path.join(root, file), text); }
    await symlink(path.join(root, 'docs/Private/secret.mdx'), path.join(root, 'posts/symlink.mdx'));
    const records = publicSources(await collectSources(root));
    assert.deepEqual(records.map(record => record.source).sort(), ['about.mdx', 'docs/public.mdx']);
    const modules = records.map(record => prepareMdx(record.body, record.source, () => null));
    await syncMdxModules(output, modules);
    assert.equal((await readdir(output)).length, 2);
    assert.match(await readFile(path.join(output, modules[1].filename), 'utf8'), /Public/);
    await syncMdxModules(output, modules.slice(0, 1));
    assert.deepEqual(await readdir(output), [modules[0].filename]);
    await syncMdxModules(output, []);
    assert.deepEqual(await readdir(output), []);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('MDX references and a Markdown-to-MDX migration preserve canonical routes', () => {
  assert.equal(resolve('example.mdx#section', 'docs/Agents/overview.md'), '/docs/Agents/example/#section');
  assert.equal(resolve('docs/Agents/example', 'about.md'), '/docs/Agents/example/');
  assert.equal(resolve('overview.md', source), '/docs/Agents/overview/');
  assert.equal(defaultRoute({ source: '_index.mdx', data: {} }), '/');
  const record = { source, data: { slug: 'example' } };
  const legacy = { source: source.replace(/mdx$/, 'md'), url: '/docs/Agents/example/', parent: '/docs/Agents/', routeSignature: routeSignature(record) };
  const matched = matchLegacySources([record], [legacy]);
  assert.deepEqual(resolveLegacyRoute(record, matched.get(source)), { url: legacy.url, parent: legacy.parent });
});
