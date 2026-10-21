import {createRoot} from 'react-dom/client';
import {Button} from '@heroui/react';
import ArticleReader from '../../src/components/reader/ArticleReader';
import BookmarkButton from '../../src/components/reader/BookmarkButton';
import ReaderLibrary from '../../src/components/reader/ReaderLibrary';
import ReaderRoot from '../../src/components/reader/ReaderRoot';
import ReadingMarkControl from '../../src/components/reader/ReadingMarkControl';
import ReadingMarksPanel from '../../src/components/reader/ReadingMarksPanel';
import {HeartIcon} from '../../src/components/comments/CommentIcons';
import '../../src/styles/tailwind.css';
import './reader-ui.css';

const params = new URLSearchParams(location.search);
const library = params.get('view') === 'library';
const root = params.get('view') === 'root';
const title = params.get('title') ?? '公开测试文章';
const article = <>
  <article className="book-article" data-pagefind-body>
    <h2>正文区域</h2>
    {Array.from({length: 28}, (_, i) => <p key={i}>这是公开测试文章的第 {i + 1} 段。滚动时顶部进度条只跟随当前位置。</p>)}
  </article>
  <footer data-fixture-comments>讨论区占位，测试时不请求评论服务。</footer>
</>;

if (params.get('readingList') === '1') {
  createRoot(document.getElementById('root')!).render(<main className="reading-list-fixture"><ReadingMarksPanel /></main>);
} else if (params.get('chrome') === '1') {
  createRoot(document.getElementById('root')!).render(<main className="reader-chrome">
    <aside className="book-menu">
      <div className="book-menu-content">
        <h2 className="book-brand"><a href="/"><svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><rect width="24" height="24" rx="4" fill="#111" /><path d="M6 16 V8 h3.2 a3.2 3.2 0 0 1 0 6.4 H8.2 V16 Z m2.2-4.2 h.8 a1.2 1.2 0 0 0 0-2.4 h-.8 Z" fill="#fff" /></svg><span>LYon's Blog</span></a></h2>
        <div data-sidebar-tools><button type="button" aria-label="搜索博客">Search</button></div>
      </div>
    </aside>
    <div className="book-page">
      <header className="book-header">
        <button type="button" aria-label="打开导航">菜单</button>
        <strong>{title}</strong>
        <button type="button" aria-label="打开目录">目录</button>
      </header>
      <div data-pagefind-ignore data-sentry-mask>
        <ArticleReader pathname="/docs/fixture/" title={title} />
      </div>
      {article}
      <footer className="reader-chrome-comments" data-fixture-article-actions>
        <span className="reader-chrome-comments__count">3 条评论</span>
        <div className="reader-chrome-comments__actions">
          <ReadingMarkControl pathname="/docs/fixture/" title={title} container={null} />
          <Button size="sm" variant="ghost" aria-label="喜欢这篇文章"><HeartIcon /><span>12</span></Button>
          <BookmarkButton pathname="/docs/fixture/" title={title} tooltipContainer={null} unavailableNotice={false} />
        </div>
      </footer>
    </div>
    <aside className="book-toc"><div className="book-toc-content">目录</div></aside>
  </main>);
} else createRoot(document.getElementById('root')!).render(<main id="main-content">
  <h1>{library ? '我的收藏' : '公开测试文章'}</h1>
  <div data-pagefind-ignore data-sentry-mask>
    {root ? <ReaderRoot pathname="/docs/fixture/" title={title} library /> : library ? <ReaderLibrary /> : <ArticleReader pathname="/docs/fixture/" title={title} />}
  </div>
  {!library && article}
</main>);
