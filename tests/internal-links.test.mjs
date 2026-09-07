import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { auditContentLinks } from '../scripts/internal-links.mjs';

async function fixture(t, files = {}) {
  const output = await mkdtemp(path.join(tmpdir(), 'blog-internal-links-'));
  t.after(() => rm(output, { recursive: true, force: true }));
  for (const [file, html] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(output, file)), { recursive: true });
    await writeFile(path.join(output, file), html);
  }
  return output;
}
const page = html => ({ source: 'docs/source.md', url: '/docs/source/', html });

test('reports Markdown file links, unpublished downloads and obsolete routes', async t => {
  const output = await fixture(t, { 'docs/排列组合/index.html': '', 'labs/index.html': '' });
  const result = await auditContentLinks({ output, pages: [page(`
    <a href="排列组合.md">排列组合</a>
    <a href="/scripts/upload-r2-image.py" download>下载脚本</a>
    <a href="/lab/">演示</a>
    <a href="/docs/排列组合/">修复后的文章</a>
    <a href="/labs/">修复后的演示</a>
  `)] });
  assert.equal(result.checkedLinks, 5);
  assert.equal(result.checkedPages, 1);
  assert.deepEqual(result.errors.map(error => error.href), ['排列组合.md', '/scripts/upload-r2-image.py', '/lab/']);
  assert.ok(result.errors.every(error => error.source === 'docs/source.md' && error.reason.startsWith('missing target:')));
});

test('accepts published files, encoded paths and both literal and decoded Chinese footnote IDs', async t => {
  const output = await fixture(t, {
    'docs/数学/index.html': '<h2 id="排列组合">标题</h2><sup id="fn:%E8%AF%B4%E6%98%8E">脚注</sup><a name="legacy"></a>',
    'scripts/upload-r2-image.py': 'print("hello")',
  });
  const { errors, checkedLinks } = await auditContentLinks({ output, pages: [page(`
    <a href="/docs/%E6%95%B0%E5%AD%A6/#%E6%8E%92%E5%88%97%E7%BB%84%E5%90%88">中文标题</a>
    <a href="/docs/数学/#fn:%E8%AF%B4%E6%98%8E">中文脚注</a>
    <a href="/docs/数学/#legacy">旧式锚点</a>
    <a href="https://www.yindongliang.com/docs/数学/?a=1&amp;b=2#legacy">www</a>
    <a href="/scripts/upload-r2-image.py?download=1#anything" download>下载脚本</a>
  `)] });
  assert.equal(checkedLinks, 5);
  assert.deepEqual(errors, []);
});

test('ignores external theme sites, non-HTTP links and code examples', async t => {
  const output = await fixture(t);
  const { errors, checkedLinks } = await auditContentLinks({ output, pages: [page(`
    <a href="https://tcitry.github.io/astro-book/missing/">主题</a>
    <a href="//example.com/missing/">外站</a>
    <a href="https://yindongliang.com.example.com/missing/">外站</a>
    <a href="mailto:test@example.com">邮箱</a>
    <a href="tel:123">电话</a>
    <pre><code><a href="/example/">代码示例</a></code></pre>
    <code><a href="/inline-example/">内联示例</a></code>
    <pre>&lt;a href="/escaped-example/"&gt;代码&lt;/a&gt;</pre>
    <script>const example = '<a href="/script-example/">';</script>
    <template><a href="/inactive-example/">未激活模板</a></template>
    <!-- <a href="/comment-example/">注释</a> -->
  `)] });
  assert.equal(checkedLinks, 0);
  assert.deepEqual(errors, []);
});

test('checks local and cross-page fragments while allowing browser top and text fragments', async t => {
  const output = await fixture(t, {
    'docs/source/index.html': '<h2 id="local">Local</h2>',
    'target/index.html': '<h2 id="heading">Heading</h2>',
  });
  const { errors } = await auditContentLinks({ output, pages: [page(`
    <a href="#local">local</a><a href="#missing">missing local</a>
    <a href="/target/#missing">missing cross-page</a>
    <a href="/target/#heading:~:text=Heading">heading with text directive</a>
    <a href="/target/#:~:text=Heading">text directive</a>
    <a href="#">empty</a><a href="">same page</a><a href="#TOP">top</a>
  `)] });
  assert.deepEqual(errors.map(error => error.href), ['#missing', '/target/#missing']);
  assert.ok(errors.every(error => error.reason.startsWith('missing fragment:')));
});

test('follows redirect chains and inherited fragments, and reports cycles and missing destinations', async t => {
  const output = await fixture(t, { 'current/index.html': '<h2 id="section">Section</h2>' });
  const redirects = [
    { from: '/旧址/', to: '/older/' }, { from: '/older/', to: '/current/' },
    { from: '/replace/', to: '/current/#section' },
    { from: '/cycle-a/', to: '/cycle-b/' }, { from: '/cycle-b/', to: '/cycle-a/' },
    { from: '/broken/', to: '/gone/' },
  ];
  const { errors } = await auditContentLinks({ output, redirects, pages: [page(`
    <a href="/%E6%97%A7%E5%9D%80/#section">valid alias</a>
    <a href="/旧址/#missing">invalid inherited fragment</a>
    <a href="/replace/#missing">replacement fragment</a>
    <a href="/cycle-a/">cycle</a><a href="/broken/">broken redirect</a>
  `)] });
  assert.deepEqual(errors.map(error => error.reason), [
    'missing fragment: /current/#missing', 'redirect cycle', 'missing target: /gone/',
  ]);
});

test('preserves path case and rejects encoded traversal and symlinks outside output', async t => {
  const output = await fixture(t, { 'Docs/Article/index.html': '' });
  await symlink(tmpdir(), path.join(output, 'outside'));
  const { errors } = await auditContentLinks({ output, pages: [page(`
    <a href="/Docs/Article/">correct case</a>
    <a href="/docs/article/">wrong case</a>
    <a href="/%2e%2e%2foutside.txt">escape</a>
    <a href="/outside/anything">symlink</a>
  `)] });
  assert.equal(errors.length, 3);
  assert.equal(errors[0].reason, 'missing target: /docs/article/');
  assert.equal(errors[1].reason, 'path escapes output');
  assert.equal(errors[2].reason, 'missing target: /outside/anything');
});
