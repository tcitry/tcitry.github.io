import {articleContentRoot, captureSelection} from './annotation-paint.mjs';

/**
 * Fan 划线 / 高亮 / 写笔记 around the assistant launcher while article text is selected.
 * @param {{
 *   widget: HTMLElement,
 *   signal?: AbortSignal,
 *   onAction: (detail: {
 *     type: string, pathname: string, title: string, quote: string, prefix: string, suffix: string,
 *   }) => void,
 *   document?: Document,
 *   view?: Window,
 * }} options
 */
export function mountSelectionTools(options) {
  const doc = options.document ?? document;
  const view = options.view ?? window;
  const tools = options.widget.querySelector('[data-selection-tools]');
  const launcher = options.widget.querySelector('[data-chat-launcher]');
  if (!(tools instanceof HTMLElement)) return {dismiss() { return false; }, destroy() {}};
  const signal = options.signal;
  let open = false;
  /** @type {{quote: string, prefix: string, suffix: string} | null} */
  let quote = null;
  let hideTimer = 0;
  let refreshTimer = 0;
  let pointerDown = false;

  function hide() {
    open = false;
    quote = null;
    tools.removeAttribute('data-open');
    launcher?.removeAttribute('data-selection-active');
    view.clearTimeout(hideTimer);
    hideTimer = view.setTimeout(() => {
      if (!open) tools.hidden = true;
    }, 180);
  }

  /**
   * @param {{quote: string, prefix: string, suffix: string}} next
   */
  function show(next) {
    const wasOpen = open;
    view.clearTimeout(hideTimer);
    quote = next;
    tools.hidden = false;
    open = true;
    if (!wasOpen && launcher instanceof HTMLElement) {
      launcher.removeAttribute('data-selection-active');
      void launcher.offsetWidth;
      launcher.setAttribute('data-selection-active', 'true');
    } else {
      launcher?.setAttribute('data-selection-active', 'true');
    }
    view.requestAnimationFrame(() => {
      if (open) tools.setAttribute('data-open', '');
    });
  }

  function dismiss() {
    const was = open;
    hide();
    if (was) view.getSelection()?.removeAllRanges();
    return was;
  }

  function refresh() {
    const pathname = options.widget.dataset.readerPathname ?? '';
    if (!pathname) { hide(); return; }
    const captured = captureSelection(view.getSelection(), articleContentRoot(doc));
    if (!captured) { hide(); return; }
    show(captured);
  }

  function schedule() {
    view.clearTimeout(refreshTimer);
    refreshTimer = view.setTimeout(refresh, 80);
  }

  doc.addEventListener('pointerdown', event => {
    pointerDown = true;
    if (!open) return;
    const target = event.target;
    if (!(target instanceof Node)) return;
    if (tools.contains(target)) return;
    const root = articleContentRoot(doc);
    if (root?.contains(target)) return;
    dismiss();
  }, {signal, capture: true});
  doc.addEventListener('pointerup', () => {
    pointerDown = false;
    schedule();
  }, {signal});
  doc.addEventListener('pointercancel', () => {
    pointerDown = false;
    schedule();
  }, {signal});
  doc.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || event.isComposing || !open) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    dismiss();
  }, {signal, capture: true});
  doc.addEventListener('selectionchange', () => {
    if (pointerDown) return;
    schedule();
  }, {signal});
  tools.addEventListener('pointerdown', event => {
    // Keep the stored quote if the press clears the DOM selection before click.
    event.preventDefault();
  }, {signal});
  tools.addEventListener('pointerup', event => {
    activate(event.target);
  }, {signal});
  tools.addEventListener('click', event => {
    activate(event.target);
  }, {signal});

  /** @param {EventTarget | null} target */
  function activate(target) {
    const button = target instanceof Element ? target.closest('[data-selection-action]') : null;
    if (!(button instanceof HTMLElement) || !quote) return;
    const type = button.dataset.selectionAction;
    if (type !== 'underline' && type !== 'highlight' && type !== 'note') return;
    const pathname = options.widget.dataset.readerPathname ?? '';
    const title = options.widget.dataset.readerTitle ?? '';
    if (!pathname || !title) return;
    const detail = {type, pathname, title, ...quote};
    quote = null;
    options.onAction(detail);
    dismiss();
  }

  return {dismiss, destroy() { hide(); }};
}
