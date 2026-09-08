let cleanup: (() => void) | undefined;

function initializeChat() {
  cleanup?.();
  const widget = document.querySelector<HTMLElement>('[data-blog-chat-widget]');
  const launcher = widget?.querySelector<HTMLButtonElement>('[data-chat-launcher]');
  const panel = widget?.querySelector<HTMLDialogElement>('#blog-chat-panel');
  const target = panel?.querySelector<HTMLElement>('[data-chat-mount]');
  if (!widget || !launcher || !panel || !target) return;

  const events = new AbortController();
  const {signal} = events;
  const mobile = matchMedia('(max-width: 639px)');
  let loading: Promise<void> | undefined;
  let mount: ReturnType<typeof import('../components/chat/mount-chat')['mountChat']> | undefined;
  let stopped = false;

  function syncViewport() {
    const viewport = window.visualViewport;
    if (!viewport || !mobile.matches) return;
    // Keep the composer above a mobile soft keyboard without scrolling the article.
    panel!.style.setProperty('--chat-viewport-height', `${viewport.height}px`);
    panel!.style.setProperty('--chat-viewport-top', `${viewport.offsetTop}px`);
  }

  function syncClosed() {
    launcher!.setAttribute('aria-expanded', 'false');
    document.documentElement.classList.remove('blog-chat-modal-open');
  }

  function close(restoreFocus = true) {
    if (!panel!.open) return;
    panel!.close();
    syncClosed();
    if (restoreFocus) launcher!.focus({preventScroll: true});
  }

  function focusChat() {
    // Do not summon the mobile keyboard until the reader taps the input.
    const selector = mobile.matches ? '[aria-label="关闭博客助手"]' : 'textarea';
    target!.querySelector<HTMLElement>(selector)?.focus({preventScroll: true});
  }

  async function loadChat() {
    if (mount) return;
    if (loading) return loading;
    const status = target!.querySelector<HTMLElement>('[data-chat-load-status]');
    const retry = target!.querySelector<HTMLButtonElement>('[data-chat-retry]');
    if (status) status.textContent = '正在打开博客助手…';
    if (retry) retry.hidden = true;
    loading = (async () => {
      try {
        // Static article pages do not have Astro's React refresh preamble.
        if (import.meta.env.DEV) await import('@vitejs/plugin-react/preamble');
        const {mountChat} = await import('../components/chat/mount-chat');
        if (stopped) return;
        mount = mountChat(target!, () => close(), () => {
          panel!.dataset.chatLoaded = 'true';
          if (panel!.open && (panel!.contains(document.activeElement) || document.activeElement === document.body)) focusChat();
        });
      } catch (error) {
        if (stopped) return;
        if (status) status.textContent = '助手未能加载，请检查网络后重试。';
        if (retry) retry.hidden = false;
        if (import.meta.env.DEV) console.error('[blog-chat] Could not load the chat.', error);
      } finally { loading = undefined; }
    })();
    return loading;
  }

  function open() {
    if (panel!.open) return;
    syncViewport();
    panel!.setAttribute('aria-modal', String(mobile.matches));
    if (mobile.matches) {
      panel!.showModal();
      document.documentElement.classList.add('blog-chat-modal-open');
    } else panel!.show();
    launcher!.setAttribute('aria-expanded', 'true');
    if (mount) focusChat();
    void loadChat();
  }

  launcher.hidden = false;
  launcher.addEventListener('click', () => panel.open ? close() : open(), {signal});
  panel.addEventListener('click', (event) => {
    const element = event.target as Element;
    if (element.closest('[data-chat-close]')) close();
    if (element.closest('[data-chat-retry]')) void loadChat();
  }, {signal});
  panel.addEventListener('cancel', (event) => { event.preventDefault(); close(); }, {signal});
  // The native dialog keeps content mounted when closed, and contains focus on mobile.
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && panel.open && !event.defaultPrevented) {
      event.preventDefault();
      close();
    }
  }, {signal});
  document.addEventListener('pointerdown', (event) => {
    if (!mobile.matches && panel.open && !widget.contains(event.target as Node)) close(false);
  }, {signal});
  mobile.addEventListener('change', () => {
    if (!panel.open) return;
    panel.close();
    syncClosed();
    open();
  }, {signal});
  window.visualViewport?.addEventListener('resize', syncViewport, {signal});
  window.visualViewport?.addEventListener('scroll', syncViewport, {signal});
  cleanup = () => {
    stopped = true;
    close(false);
    events.abort();
    mount?.destroy();
  };
}

initializeChat();
document.addEventListener('astro:page-load', initializeChat);
document.addEventListener('astro:before-swap', () => cleanup?.());
if (import.meta.hot) import.meta.hot.dispose(() => cleanup?.());
