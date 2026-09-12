import {captureFeatureError} from '../lib/monitoring';

let cleanup: (() => void) | undefined;
let library: Promise<typeof import('../components/search/SearchCommand')> | undefined;

function initializeSearch() {
  cleanup?.();
  const host = document.querySelector<HTMLElement>('[data-blog-search-root]');
  const triggers = () => [...document.querySelectorAll<HTMLButtonElement>('[data-blog-search-trigger]')];
  if (!host) return;
  const mountHost = host;
  const events = new AbortController();
  let mount: ReturnType<typeof import('../components/search/SearchCommand')['mountSearchCommand']> | undefined;
  let previousFocus: HTMLElement | null = null;
  let opened = false;
  let generation = 0;
  let focusFrame = 0;
  const errors = document.querySelectorAll<HTMLElement>('[data-blog-search-error]');

  function restoreFocus() {
    opened = false;
    const request = generation;
    const target = previousFocus !== document.body && previousFocus?.isConnected && previousFocus.getClientRects().length
      ? previousFocus : triggers().find((trigger) => trigger.getClientRects().length);
    cancelAnimationFrame(focusFrame);
    focusFrame = requestAnimationFrame(() => {
      if (!events.signal.aborted && !opened && generation === request) target?.focus({preventScroll: true});
    });
  }

  function close() {
    generation++;
    opened = false;
    triggers().forEach((trigger) => trigger.removeAttribute('aria-busy'));
    if (mount) mount.close();
    else restoreFocus();
  }

  async function open(trigger?: HTMLElement) {
    if (opened) return;
    cancelAnimationFrame(focusFrame);
    opened = true;
    previousFocus = trigger ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    const request = ++generation;
    errors.forEach((error) => { error.hidden = true; });
    triggers().forEach((button) => button.setAttribute('aria-busy', 'true'));
    try {
      if (import.meta.env.DEV) await import('@vitejs/plugin-react/preamble');
      library ??= import('../components/search/SearchCommand');
      const module = await library;
      if (events.signal.aborted || request !== generation) return;
      mount ??= module.mountSearchCommand(mountHost, restoreFocus, document.querySelector('[data-blog-chat-widget]') ? (prompt) => {
        // The assistant takes focus after the search modal releases its focus scope.
        cancelAnimationFrame(focusFrame);
        // Command unmounts with flushSync inside the same press. Wait a frame so
        // HeroUI/Clerk teardown is not concurrent with the assistant createRoot.
        requestAnimationFrame(() => {
          setTimeout(() => {
            document.dispatchEvent(new CustomEvent('blog:ask-ai', {detail: {prompt}}));
          }, 0);
        });
      } : undefined);
      mount.open();
    } catch (error) {
      library = undefined;
      if (events.signal.aborted || request !== generation) return;
      opened = false;
      errors.forEach((message) => { message.hidden = false; });
      captureFeatureError(error, 'search', 'load');
      if (import.meta.env.DEV) console.error('[blog-search] Could not open search.', error);
    } finally {
      if (request === generation) triggers().forEach((button) => button.removeAttribute('aria-busy'));
    }
  }

  // Resolve the live trigger before React Aria consumes its bubbling click.
  document.addEventListener('click', (event) => {
    const trigger = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-blog-search-trigger]') : null;
    if (trigger) void open(trigger);
  }, {signal: events.signal, capture: true});
  // React Aria normalizes keyboard presses (including Space) without a native click.
  document.addEventListener('blog:open-search', (event) => {
    const trigger = event instanceof CustomEvent && event.detail instanceof HTMLElement ? event.detail : undefined;
    void open(trigger);
  }, {signal: events.signal});
  document.addEventListener('keydown', (event) => {
    if (event.isComposing || event.keyCode === 229 || event.defaultPrevented
      || (event.target instanceof Element && event.target.closest('[data-search-composing="true"]'))) return;
    const shortcut = (event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === 'k';
    if (shortcut || (opened && event.key === 'Escape')) {
      event.preventDefault(); event.stopPropagation();
      if (opened) close(); else void open();
      return;
    }
    const editing = event.target instanceof Element && event.target.closest('input, textarea, select, button, [contenteditable], [data-book-island], [data-demo]');
    if (!opened && !editing && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey && ['/', 's'].includes(event.key)) {
      event.preventDefault(); event.stopPropagation(); void open();
    }
  }, {signal: events.signal, capture: true});

  cleanup = () => {
    events.abort(); generation++; cancelAnimationFrame(focusFrame); mount?.destroy();
    triggers().forEach((trigger) => trigger.removeAttribute('aria-busy'));
  };
}

initializeSearch();
document.addEventListener('astro:page-load', initializeSearch);
document.addEventListener('astro:before-swap', () => cleanup?.());
