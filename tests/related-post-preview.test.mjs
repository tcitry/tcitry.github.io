import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const result = await build({
  entryPoints: [new URL('../src/lib/related-post-preview.ts', import.meta.url).pathname],
  bundle: true, platform: 'node', format: 'esm', write: false,
});
const { getRelatedPostDescription, getRelatedPostPreview } = await import(
  'data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64')
);
const post = (overrides = {}) => ({
  title: 'Article', url: '/posts/article/', date: '2025-01-02', description: '',
  html: '', summary: 'Flattened heading and Mermaid source must not become the preview.',
  tags: [], params: {}, ...overrides,
});

test('article previews choose prose instead of headings, code, diagrams or editorial disclosures', () => {
  const article = post({ html: `
    <h2>Heading that should not be repeated as the summary</h2>
    <p>AI 参与说明：Codex 协助更新本文，正文内容保持原有表述。</p>
    <pre class="mermaid">flowchart LR; a --&gt; b;</pre>
    <table><tr><td><p>A table paragraph is not a suitable introduction.</p></td></tr></table>
    <p hidden>A hidden paragraph must not be exposed in the preview.</p>
    <section data-footnotes><p>Footnote text must not become an article preview.</p></section>
    <p>Build a <a href="/docs/">static blog</a> with <code>Astro</code> &amp; useful article previews.</p>
    <p>Later paragraphs should not be appended.</p>
  ` });
  assert.equal(getRelatedPostDescription(article), 'Build a static blog with Astro & useful article previews.');
});

test('an explicit description takes priority and markup is converted to plain text', () => {
  assert.equal(getRelatedPostDescription(post({
    description: '<strong>A concise</strong> introduction &amp; context.',
    html: '<p>A much longer paragraph that would otherwise be selected.</p>',
  })), 'A concise introduction & context.');
});

test('previews skip complete editorial notes, including follow-up revision records', () => {
  const introduction = 'Markdown、Obsidian、Git 与 Codex 协作仍是作者端的基础，站点现已迁移到 Astro。';
  for (const disclosure of [
    '说明：本文由 Codex 根据公开资料辅助生成，属于 AI 生成/整理内容，非作者原创。',
    'AI 参与说明（Agent：Codex）：本文由 Codex 协助梳理、资料校验和撰写。',
  ]) {
    assert.equal(getRelatedPostDescription(post({ html: `
      <blockquote class="book-hint"><p>${disclosure}</p>
      <p>2026-09-07 修订（Agent：Codex）：补充迁移后的架构和发布边界，保留原始撰写阶段的信息。</p>
      <p>本次模型与 reasoning effort 未取得运行记录，请读者自行甄别。</p></blockquote>
      <p>${introduction}</p>
    ` })), introduction);
  }
  assert.equal(getRelatedPostDescription(post({ html: `
    <p>2026-09-07 修订（Agent：Codex）：补充迁移后的架构和发布边界。</p>
    <p>${introduction}</p>
  ` })), introduction);
});

test('previews retain meaningful scope notes and prose about AI tools', () => {
  for (const introduction of [
    '适用范围：本文讨论 Vite、Webpack 等能处理 CSS 与静态资源导入的 Web 构建工具。',
    '本文记录 2020 年使用的历史方案，当前站点的技术架构已经发生变化。',
    '本文使用 ChatGPT 生成一个简单的示例，说明如何把对话结果转换为结构化数据。',
  ]) {
    assert.equal(getRelatedPostDescription(post({ html: `
      <blockquote class="book-hint"><p>${introduction}</p></blockquote>
      <p>Later paragraphs should not replace a useful introduction.</p>
    ` })), introduction);
  }
});

test('code-only and title-only articles omit the preview instead of using a noisy fallback', () => {
  assert.equal(getRelatedPostDescription(post({ html: '<pre><code>const value = "some code";</code></pre>' })), '');
  const title = 'A sufficiently long article title that must not be repeated';
  assert.equal(getRelatedPostDescription(post({ title, html: `<p>${title}</p><p>Short label</p>` })), '');
});

test('preview data retains native URLs, limits Unicode prose, and shows only shared topic labels', () => {
  const current = post({ tags: [' Blog ', 'Recommended', 'Astro', 'Tools'] });
  const article = post({
    title: '  A long article title  ', tags: ['blog', 'ASTRO', 'TOOLS', 'Recommended'],
    html: `<p>${'内容📖'.repeat(70)}</p>`,
  });
  const preview = getRelatedPostPreview(article, current);
  assert.equal(preview.title, 'A long article title');
  assert.equal(preview.href, '/posts/article/');
  assert.equal(preview.dateLabel, '2025-01-02');
  assert.equal([...preview.description].length, 121);
  assert.ok(preview.description.endsWith('…'));
  assert.deepEqual(preview.topics, ['Blog', 'Astro']);
});
