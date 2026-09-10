import {assistantUIState, type AssistantView} from './assistant-ui-state.mjs';

let cleanup: (() => void) | undefined;

function initializeChat() {
  cleanup?.();
  const widget = document.querySelector<HTMLElement>('[data-blog-chat-widget]');
  const launcher = widget?.querySelector<HTMLButtonElement>('[data-chat-launcher]');
  const expandHandle = widget?.querySelector<HTMLButtonElement>('[data-chat-expand]');
  const panel = widget?.querySelector<HTMLDialogElement>('#blog-chat-panel');
  const target = panel?.querySelector<HTMLElement>('[data-chat-mount]');
  if (!widget || !launcher || !expandHandle || !panel || !target) return;

  const state = assistantUIState(() => window.sessionStorage, window.location.pathname);
  const restoredView = state.restore();
  let currentView: AssistantView = restoredView ?? 'my';
  let opener = launcher;
  const events = new AbortController();
  const {signal} = events;
  const mobile = matchMedia('(max-width: 639px)');
  let loading: Promise<void> | undefined;
  let mount: ReturnType<typeof import('../components/chat/mount-chat')['mountChat']> | undefined;
  let launcherMount: ReturnType<typeof import('../components/chat/mount-launcher')['mountLauncher']> | undefined;
  let stopped = false;
  let preservedCloseEvents = 0;
  let promptRequest = 0;
  const overlayEscapes = new WeakSet<KeyboardEvent>();

  function syncReadingLayout() {
    const docked = panel!.open && !mobile.matches;
    document.documentElement.classList.toggle('blog-chat-sidebar-open', docked);
    if (!docked) {
      delete document.body.dataset.chatReadingLayout;
      return;
    }
    // Theme breakpoints use the full viewport. Adapt its public shell classes to
    // the actual space beside the assistant, without modifying the theme package.
    const available = document.documentElement.getBoundingClientRect().width - panel!.offsetWidth;
    const layout = available >= 1120 ? 'full' : available >= 800 ? 'compact' : 'narrow';
    if (document.body.dataset.chatReadingLayout !== layout) {
      for (const id of ['menu-control', 'toc-control']) {
        const control = document.getElementById(id) as HTMLInputElement | null;
        if (control) control.checked = false;
      }
    }
    document.body.dataset.chatReadingLayout = layout;
  }

  function syncViewport() {
    const viewport = window.visualViewport;
    if (!viewport || !mobile.matches) return;
    // Keep the composer above a mobile soft keyboard without scrolling the article.
    panel!.style.setProperty('--chat-viewport-height', `${viewport.height}px`);
    panel!.style.setProperty('--chat-viewport-top', `${viewport.offsetTop}px`);
  }

  function syncClosed() {
    launcher!.setAttribute('aria-expanded', 'false');
    expandHandle!.setAttribute('aria-expanded', 'false');
    expandHandle!.hidden = false;
    document.documentElement.classList.remove('blog-chat-modal-open');
    syncReadingLayout();
  }

  function close(restoreFocus = true, preserveState = false) {
    promptRequest++;
    if (!preserveState) state.clear();
    if (!panel!.open) return;
    if (preserveState) preservedCloseEvents++;
    panel!.close();
    syncClosed();
    if (restoreFocus) opener.focus({preventScroll: true});
  }

  function focusChat() {
    // Do not summon the mobile keyboard until the reader taps the input.
    const selector = mobile.matches ? '[aria-label="关闭博客助手"]' : 'textarea';
    const visible = (selector: string) => [...target!.querySelectorAll<HTMLElement>(selector)].find((element) => element.getClientRects().length);
    (visible(selector) ?? visible('[aria-label="关闭博客助手"]'))?.focus({preventScroll: true});
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
        }, {
          initialView: currentView,
          onViewChange: view => {
            currentView = view;
            if (panel!.open) state.save(view);
          },
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

  function open(trigger?: HTMLButtonElement) {
    if (panel!.open) return;
    if (trigger) opener = trigger;
    syncViewport();
    panel!.setAttribute('aria-modal', String(mobile.matches));
    if (mobile.matches) {
      panel!.showModal();
      document.documentElement.classList.add('blog-chat-modal-open');
    } else panel!.show();
    launcher!.setAttribute('aria-expanded', 'true');
    expandHandle!.setAttribute('aria-expanded', 'true');
    expandHandle!.hidden = true;
    state.save(currentView);
    syncReadingLayout();
    if (mount) focusChat();
    void loadChat();
  }

  launcher.hidden = false;
  expandHandle.hidden = false;
  const face = launcher.querySelector<HTMLElement>('[data-chat-launcher-face]');
  if (face && import.meta.env.PUBLIC_CLERK_PUBLISHABLE_KEY) {
    void (async () => {
      try {
        if (import.meta.env.DEV) await import('@vitejs/plugin-react/preamble');
        const {mountLauncher} = await import('../components/chat/mount-launcher');
        if (stopped || launcherMount) return;
        launcherMount = mountLauncher(face, launcher);
      } catch (error) {
        if (import.meta.env.DEV) console.error('[blog-chat] Could not load the signed-in launcher.', error);
      }
    })();
  }
  launcher.addEventListener('click', () => panel.open ? close() : open(launcher), {signal});
  expandHandle.addEventListener('click', () => open(expandHandle), {signal});
  document.addEventListener('blog:ask-ai', (event) => {
    const prompt = event instanceof CustomEvent && typeof event.detail?.prompt === 'string' ? event.detail.prompt.trim() : '';
    if (!prompt || prompt.length > 2000) return;
    const request = ++promptRequest;
    currentView = 'chat';
    open();
    void loadChat().then(() => {
      if (!stopped && panel.open && request === promptRequest) mount?.requestPrompt(prompt);
    });
  }, {signal});
  panel.addEventListener('click', (event) => {
    const element = event.target as Element;
    if (element.closest('[data-chat-close]')) close();
    if (element.closest('[data-chat-retry]')) void loadChat();
  }, {signal});
  panel.addEventListener('cancel', (event) => { event.preventDefault(); close(); }, {signal});
  panel.addEventListener('close', () => {
    if (preservedCloseEvents > 0) { preservedCloseEvents--; return; }
    if (panel.open) return;
    state.clear();
    syncClosed();
  }, {signal});
  // History, image and Clerk overlays own their first Escape. Remember the event:
  // either overlay may unmount before the document's bubble handler runs.
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || event.isComposing || !panel.open) return;
    const clerkModal = document.querySelector<HTMLElement>('.blog-clerk-modal');
    const clerkModalOpen = Boolean(clerkModal?.getClientRects().length);
    const imageModalOpen = [...document.querySelectorAll<HTMLElement>('[data-blog-image-modal]:not([data-exiting])')]
      .some(element => element.getClientRects().length);
    if (clerkModalOpen || imageModalOpen || panel.querySelector('[data-agent-history-popover]:not([data-exiting])')) {
      overlayEscapes.add(event);
      // The overlay still handles the key; prevent the containing mobile dialog
      // from firing its native cancel action after its child modal closes.
      if (clerkModalOpen || imageModalOpen) event.preventDefault();
      return;
    }
    if (event.target instanceof Node && panel.contains(event.target)) {
      event.preventDefault();
      close();
    }
  }, {capture: true, signal});
  // The native dialog keeps content mounted when closed, and contains focus on mobile.
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !event.isComposing && panel.open && !event.defaultPrevented && !overlayEscapes.has(event)) {
      event.preventDefault();
      close();
    }
  }, {signal});
  // A docked assistant stays open while the reader selects text and uses the page.
  mobile.addEventListener('change', () => {
    if (!panel.open) return;
    preservedCloseEvents++;
    panel.close();
    syncClosed();
    open();
  }, {signal});
  window.addEventListener('resize', syncReadingLayout, {signal});
  window.visualViewport?.addEventListener('resize', syncViewport, {signal});
  window.visualViewport?.addEventListener('scroll', syncViewport, {signal});
  cleanup = () => {
    stopped = true;
    close(false, true);
    events.abort();
    launcherMount?.destroy();
    mount?.destroy();
  };
  if (restoredView) open();
}

initializeChat();
document.addEventListener('astro:page-load', initializeChat);
document.addEventListener('astro:before-swap', () => cleanup?.());
window.addEventListener('pageshow', event => { if (event.persisted) initializeChat(); });
if (import.meta.hot) import.meta.hot.dispose(() => cleanup?.());
