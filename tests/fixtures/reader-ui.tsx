import {createRoot} from 'react-dom/client';
import ArticleReader from '../../src/components/reader/ArticleReader';
import ReaderLibrary from '../../src/components/reader/ReaderLibrary';
import ReaderRoot from '../../src/components/reader/ReaderRoot';
import '../../src/styles/tailwind.css';
import './reader-ui.css';

const library = new URLSearchParams(location.search).get('view') === 'library';
const root = new URLSearchParams(location.search).get('view') === 'root';
const title = new URLSearchParams(location.search).get('title') ?? '公开测试文章';

createRoot(document.getElementById('root')!).render(<main id="main-content">
  <h1>{library ? '我的收藏' : '公开测试文章'}</h1>
  <div data-pagefind-ignore data-sentry-mask>
    {root ? <ReaderRoot pathname="/docs/fixture/" title={title} library /> : library ? <ReaderLibrary /> : <ArticleReader pathname="/docs/fixture/" title={title} />}
  </div>
  {!library && <>
    <article className="book-article" data-pagefind-body>
      <h2>正文区域</h2>
      {Array.from({length: 28}, (_, i) => <p key={i}>这是公开测试文章的第 {i + 1} 段。滚动文章不会保存阅读进度。</p>)}
    </article>
    <footer data-fixture-comments>讨论区占位，测试时不请求评论服务。</footer>
  </>}
</main>);
