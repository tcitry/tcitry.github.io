// Establish global layer order before lazily loaded component style sheets.
import '../../src/styles/tailwind.css';
import '../../src/styles/chat-widget.css';
import '../../src/components/comments/comments.css';
import './services-ui.css';
import {createRoot} from 'react-dom/client';
import AssistantWorkspace from '../../src/components/chat/AssistantWorkspace';
import CommentsRoot from '../../src/components/comments/CommentsRoot';

const params = new URLSearchParams(location.search);
const root = document.getElementById('root')!;
if (params.get('view') === 'panel') {
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
if (params.get('view') === 'widget') {
  // Exercise the real native launcher script and React mount through navigation.
  root.innerHTML = `<main><h1>公开文章测试</h1></main>
    <div class="blog-chat-widget" data-blog-chat-widget data-reader-pathname="/docs/services-fixture/" data-reader-title="公开文章测试">
      <button class="blog-chat-widget__launcher" data-chat-launcher aria-label="打开博客助手" aria-expanded="false" hidden>打开</button>
      <dialog id="blog-chat-panel" class="blog-chat-widget__panel" aria-label="博客助手">
        <div class="blog-chat-widget__mount" data-chat-mount>
          <button data-chat-close aria-label="关闭博客助手">关闭</button>
          <p data-chat-load-status role="status">正在打开博客助手…</p><button data-chat-retry hidden>重新加载</button>
        </div>
      </dialog>
    </div>`;
  void import('../../src/scripts/blog-chat');
} else {
  createRoot(root).render(params.get('view') === 'comments'
    ? <main className="services-comments"><h1>公开文章测试</h1><CommentsRoot pathname="/docs/services-fixture/" /></main>
    : <main className="services-workspace"><AssistantWorkspace onClose={() => {}} onReady={() => {}} pathname="/docs/services-fixture/" title="公开文章测试" /></main>);
}
