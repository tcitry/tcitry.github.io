let cleanup: (() => void) | undefined;

function initializeComments() {
  cleanup?.();
  const section = document.querySelector<HTMLElement>('[data-convex-comments]');
  const host = section?.querySelector<HTMLElement>('[data-comments-mount]');
  const placeholder = section?.querySelector<HTMLElement>('[data-comments-placeholder]');
  const status = section?.querySelector<HTMLElement>('[data-comments-load-status]');
  const retry = section?.querySelector<HTMLButtonElement>('[data-comments-retry]');
  const refresh = section?.querySelector<HTMLButtonElement>('[data-comments-refresh]');
  const pathname = section?.dataset.commentPathname;
  const title = section?.dataset.commentTitle;
  const bookmarkable = section?.dataset.commentBookmarkable === 'true';
  if (!section || !host || !placeholder || !status || !retry || !refresh || !pathname) return;

  const events = new AbortController();
  let observer: IntersectionObserver | undefined;
  let mount: ReturnType<typeof import('../components/comments/mount-comments')['mountComments']> | undefined;
  let attempt = 0;
  let loading = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function failed(request: number) {
    if (events.signal.aborted || request !== attempt) return;
    clearTimeout(timer);
    loading = false;
    host!.hidden = true;
    placeholder!.hidden = false;
    status!.textContent = '评论未能加载，请检查网络后重试。若页面刚更新，请刷新页面。';
    status!.setAttribute('role', 'alert');
    retry!.hidden = false;
    refresh!.hidden = false;
    section!.dataset.commentsLoaded = 'false';
  }

  async function load() {
    if (loading || section!.dataset.commentsLoaded === 'true') return;
    loading = true;
    const request = ++attempt;
    observer?.disconnect();
    mount?.destroy();
    mount = undefined;
    host!.hidden = true;
    placeholder!.hidden = false;
    status!.textContent = '正在加载评论…';
    status!.setAttribute('role', 'status');
    retry!.hidden = true;
    refresh!.hidden = true;
    timer = setTimeout(() => failed(request), 15_000);
    try {
      if (import.meta.env.DEV) await import('@vitejs/plugin-react/preamble');
      const {mountComments} = await import('../components/comments/mount-comments');
      if (events.signal.aborted || request !== attempt || !loading) return;
      mount = mountComments(host!, pathname!, () => {
        if (events.signal.aborted || request !== attempt || !loading) return;
        clearTimeout(timer);
        loading = false;
        placeholder!.hidden = true;
        host!.hidden = false;
        section!.dataset.commentsLoaded = 'true';
      }, () => failed(request), title, bookmarkable);
    } catch {
      failed(request);
    }
  }

  retry.addEventListener('click', () => { void load(); }, {signal: events.signal});
  refresh.addEventListener('click', () => window.location.reload(), {signal: events.signal});
  function revealCommentTarget() {
    if (!/^#comment-[a-zA-Z0-9_-]{1,80}$/.test(window.location.hash)) return false;
    section!.scrollIntoView({block: 'start'});
    void load();
    return true;
  }
  window.addEventListener('hashchange', revealCommentTarget, {signal: events.signal});
  if (!revealCommentTarget() && 'IntersectionObserver' in window) {
    observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) void load();
    }, {rootMargin: '200px'});
    observer.observe(section);
  } else if (!('IntersectionObserver' in window)) void load();

  cleanup = () => {
    events.abort();
    attempt++;
    clearTimeout(timer);
    observer?.disconnect();
    mount?.destroy();
    delete section.dataset.commentsLoaded;
  };
}

initializeComments();
document.addEventListener('astro:page-load', initializeComments);
document.addEventListener('astro:before-swap', () => cleanup?.());
