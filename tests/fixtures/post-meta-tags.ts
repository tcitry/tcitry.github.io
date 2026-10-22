import shell from '../../node_modules/@tcitry/astro-book/src/styles/Shell.module.css';
import reading from '../../node_modules/@tcitry/astro-book/src/styles/Reading.module.css';
import site from '../../src/styles/blog.module.css';
import '@tcitry/astro-book/styles.css';

document.documentElement.setAttribute('data-astro-book', '');
document.body.className = `${shell.shell} ${reading.reading} ${site.site}`;

const params = new URLSearchParams(location.search);
const href = (key: string) => {
  const value = params.get(key);
  if (!value) throw new Error(`Missing ${key}`);
  return value;
};

const root = document.querySelector('#root');
if (!root) throw new Error('Missing #root');

root.innerHTML = `
<div class="book-page">
  <article class="markdown" data-tag-fixture>
    <h1>Cap'n Web RPC</h1>
    <div class="post-meta post-after" data-article-meta>
      <p class="post-meta__stats">3833 字 · 2026-10-21 · ~10 min read</p>
      <p class="post-meta__tags" data-visual>
        相关标签：
        <a data-visual-tag="visited" href="${href('visitedTag')}">Cloudflare</a>,
        <a data-visual-tag="fresh" href="${href('freshTag')}">GitHub</a>,
        <a data-visual-tag="visited" href="${href('visitedTag')}">TypeScript</a>,
        <a data-visual-tag="visited" href="${href('visitedTag')}">源码分析</a>,
        <a data-visual-tag="visited" href="${href('visitedTag')}">ByAI</a>
      </p>
    </div>
    <p>正文链接：<a data-prose="visited" href="${href('visitedProse')}">已访问</a>，<a data-prose="fresh" href="${href('freshProse')}">未访问</a></p>
  </article>
</div>`;

document.documentElement.dataset.ready = 'true';
