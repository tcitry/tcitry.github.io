// Establish global layer order before lazily loaded component style sheets.
import '../../src/styles/tailwind.css';
import '../../src/styles/chat-widget.css';
import '../../src/components/comments/comments.css';
import './services-ui.css';
import {createRoot} from 'react-dom/client';
import AssistantWorkspace from '../../src/components/chat/AssistantWorkspace';

const params = new URLSearchParams(location.search);
const root = document.getElementById('root')!;
const view = params.get('view') ?? (location.pathname === '/docs/services-fixture/' ? 'comments' : null);
if (view === 'panel') {
  const widget = document.createElement('div');
  widget.className = 'blog-chat-widget';
  const panel = document.createElement('dialog');
  panel.className = 'blog-chat-widget__panel';
  root.className = 'blog-chat-widget__mount';
  document.body.append(widget);
  widget.append(panel);
  panel.append(root);
  document.body.classList.add('blog-chat-layout');
  if (matchMedia('(max-width: 639px)').matches) panel.showModal();
  else {
    document.documentElement.classList.add('blog-chat-sidebar-open');
    panel.show();
  }
}
if (params.get('anonymous') === 'true') {
  (window as unknown as {__readerAuth: {switchSession: (userId: null, sessionId: null) => void}}).__readerAuth.switchSession(null, null);
}
if (view === 'widget') {
  // Exercise the real native launcher script and React mount through navigation.
  root.innerHTML = `<main><h1>公开文章测试</h1></main>
    <div class="blog-chat-widget" data-blog-chat-widget data-reader-pathname="/docs/services-fixture/" data-reader-title="公开文章测试">
      <button class="blog-chat-widget__launcher" data-chat-launcher aria-label="打开博客助手" aria-expanded="false" hidden>打开</button>
      <button class="blog-chat-widget__expand" type="button" aria-label="展开博客助手" aria-haspopup="dialog" aria-expanded="false" aria-controls="blog-chat-panel" data-chat-expand hidden>
        <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m12.5 5-5 5 5 5" /></svg>
        <span class="blog-chat-widget__tooltip" aria-hidden="true">展开侧栏</span>
      </button>
      <dialog id="blog-chat-panel" class="blog-chat-widget__panel" aria-label="博客助手">
        <div class="blog-chat-widget__mount" data-chat-mount>
          <button data-chat-close aria-label="关闭博客助手">关闭</button>
          <p data-chat-load-status role="status">正在打开博客助手…</p><button data-chat-retry hidden>重新加载</button>
        </div>
      </dialog>
    </div>`;
  if (params.get('articleNavigation') === 'true') {
    const navigation = document.createElement('nav');
    navigation.setAttribute('aria-label', '侧栏测试文章导航');
    for (const page of ['a', 'b']) {
      const link = document.createElement('a');
      link.href = `/docs/navigation-fixture-${page}/?view=widget&articleNavigation=true`;
      link.textContent = `前往测试文章 ${page.toUpperCase()}`;
      navigation.append(link);
    }
    root.querySelector('main')!.append(navigation);
    const comments = document.createElement('section');
    comments.dataset.fixtureArticleFooter = '';
    comments.style.cssText = 'margin:16px;width:min(400px,calc(100vw - 32px))';
    root.querySelector('main')!.append(comments);
    void import('../../src/components/comments/CommentsRoot').then(({default: CommentsRoot}) => {
      createRoot(comments).render(<CommentsRoot pathname="/docs/services-fixture/" title="公开文章测试" bookmarkable />);
    });
  }
  if (params.get('search') === 'true') {
    const trigger = document.createElement('button');
    trigger.type = 'button'; trigger.textContent = '搜索博客';
    trigger.setAttribute('data-blog-search-trigger', '');
    trigger.setAttribute('aria-label', '搜索博客');
    const searchHost = document.createElement('div');
    searchHost.setAttribute('data-blog-search-root', '');
    root.querySelector('main')!.append(trigger);
    root.append(searchHost);
    void Promise.all([import('../../src/scripts/blog-chat'), import('../../src/scripts/blog-search')])
      .then(() => {document.documentElement.dataset.searchChatReady = 'true';});
  } else void import('../../src/scripts/blog-chat');
} else {
  if (view === 'comments') {
    void import('../../src/components/comments/CommentsRoot').then(async ({default: CommentsRoot}) => {
      const comments = <CommentsRoot pathname="/docs/services-fixture/" />;
      if (params.get('bookStyles') === 'true') {
        // Exercise the real public theme stylesheet and BookLayout's footer
        // nesting, including a scrolled article above the mounted comments.
        await import('@tcitry/astro-book/styles.css');
        document.documentElement.setAttribute('data-astro-book', '');
        document.documentElement.dataset.bookTheme = 'light';
        createRoot(root).render(<main className="services-comments"><div className="book-page">
          <div id="main-content" className="markdown" style={{minHeight: '380px'}}><h1>公开文章测试</h1><p>文章正文与评论共用真实博客样式。</p></div>
          <footer className="book-footer"><nav aria-label="文章导航"><a href="#main-content">返回文章</a></nav>
            <section className="blog-comments" id="comments"><h2>评论</h2>{comments}</section>
          </footer>
        </div></main>);
      } else createRoot(root).render(<main className="services-comments"><h1>公开文章测试</h1>{comments}</main>);
    });
  } else {
    createRoot(root).render(<main className="services-workspace"><AssistantWorkspace onClose={() => {}} onReady={() => {}} pathname="/docs/services-fixture/" title="公开文章测试" /></main>);
  }
}
