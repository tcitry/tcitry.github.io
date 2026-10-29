import {articleContentRoot, captureRange, captureSelection} from './annotation-paint.mjs';

/**
 * Fan 高亮 / 写笔记 around the assistant launcher, or the sidebar edge control
 * while the sidebar is open. A click on an existing highlight offers 取消高亮
 * beside that mark.
 * @param {{
 *   widget: HTMLElement,
 *   signal?: AbortSignal,
 *   onAction: (detail: {
 *     type: string, pathname: string, title: string, quote: string, prefix: string, suffix: string,
 *   }) => void,
 *   onClear?: (detail: {id: string}) => void,
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
  const clearButton = tools.querySelector('[data-selection-action="clear-highlight"]');
  let open = false;
  /** @type {{quote: string, prefix: string, suffix: string} | null} */
  let quote = null;
  /** @type {string | null} */
  let clearId = null;
  /** @type {Range | null} */
  let gestureRange = null;
  let hideTimer = 0;
  let refreshTimer = 0;
  let pointerDown = false;

  function hide() {
    open = false;
    quote = null;
    clearId = null;
    tools.removeAttribute('data-open');
    tools.removeAttribute('data-anchor');
    tools.style.left = '';
    tools.style.top = '';
    for (const node of options.widget.querySelectorAll('[data-selection-active]')) {
      node.removeAttribute('data-selection-active');
    }
    view.clearTimeout(hideTimer);
    hideTimer = view.setTimeout(() => {
      if (!open) tools.hidden = true;
    }, 180);
  }

  /**
   * @param {HTMLElement | null} anchor
   * @param {boolean} fresh
   */
  function activateAnchor(anchor, fresh) {
    for (const node of options.widget.querySelectorAll('[data-selection-active]')) {
      if (node !== anchor) node.removeAttribute('data-selection-active');
    }
    if (!(anchor instanceof HTMLElement)) return;
    if (fresh) {
      anchor.removeAttribute('data-selection-active');
      void anchor.offsetWidth;
    }
    anchor.setAttribute('data-selection-active', 'true');
  }

  /** Sidebar-open edge control. The collapsed launcher stays the anchor otherwise. */
  function edgeAnchor() {
    if (!doc.documentElement.classList.contains('blog-chat-sidebar-open')) return null;
    const candidates = options.widget.querySelectorAll('.assistant-workspace__close, .blog-chat-widget__close, [data-chat-expand]');
    for (const candidate of candidates) {
      if (!(candidate instanceof HTMLElement) || candidate.hidden) continue;
      const box = candidate.getBoundingClientRect();
      if (box.width < 1 || box.height < 1) continue;
      return candidate;
    }
    return null;
  }

  /**
   * @param {{quote: string, prefix: string, suffix: string} | null} next
   * @param {HTMLElement | null} anchor
   * @param {'launcher' | 'edge' | 'mark'} placement
   */
  function show(next, anchor, placement) {
    const wasOpen = open;
    view.clearTimeout(hideTimer);
    quote = next;
    tools.hidden = false;
    open = true;
    tools.dataset.anchor = placement;
    if (placement === 'mark') {
      tools.style.right = 'auto';
      tools.style.bottom = 'auto';
    } else {
      tools.style.left = '';
      tools.style.top = '';
      tools.style.right = '';
      tools.style.bottom = '';
    }
    activateAnchor(anchor, !wasOpen);
    view.requestAnimationFrame(() => {
      if (open) tools.setAttribute('data-open', '');
    });
  }

  /**
   * @param {string | null} id
   */
  function setClear(id) {
    clearId = id;
    if (!(clearButton instanceof HTMLElement)) return;
    if (id) {
      clearButton.hidden = false;
      clearButton.dataset.annotationId = id;
    } else {
      clearButton.hidden = true;
      delete clearButton.dataset.annotationId;
    }
  }

  /**
   * @param {boolean} fan
   */
  function setFanVisible(fan) {
    for (const button of tools.querySelectorAll('[data-selection-action="highlight"], [data-selection-action="note"]')) {
      if (button instanceof HTMLElement) button.hidden = !fan;
    }
  }

  function dismiss() {
    const was = open;
    gestureRange = null;
    hide();
    if (was) view.getSelection()?.removeAllRanges();
    return was;
  }

  function rememberGesture() {
    const selection = view.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return;
    gestureRange = selection.getRangeAt(0).cloneRange();
  }

  /**
   * @param {Range | null} range
   * @param {Element | null} root
   */
  function highlightInRange(range, root) {
    if (!range || !root) return null;
    const node = range.startContainer;
    const element = node instanceof Element ? node : node.parentElement;
    const direct = element?.closest('mark[data-annotation-type="highlight"]');
    if (direct instanceof HTMLElement && root.contains(direct) && direct.dataset.readerAnnotation) return direct;
    if (range.collapsed) return null;
    for (const mark of root.querySelectorAll('mark[data-annotation-type="highlight"]')) {
      if (!(mark instanceof HTMLElement) || !mark.dataset.readerAnnotation) continue;
      if (overlaps(range, mark)) return mark;
    }
    return null;
  }

  /**
   * Overlap that does not treat a range ending on the next boundary as a hit.
   * @param {Range} range
   * @param {Element} mark
   */
  function overlaps(range, mark) {
    const markRange = mark.ownerDocument.createRange();
    markRange.selectNodeContents(mark);
    // END_TO_START compares this start with the mark end; START_TO_END compares
    // this end with the mark start. Strict inequalities ignore a shared boundary.
    return range.compareBoundaryPoints(Range.END_TO_START, markRange) < 0
      && range.compareBoundaryPoints(Range.START_TO_END, markRange) > 0;
  }

  /**
   * @param {HTMLElement} mark
   */
  function placeOnMark(mark) {
    const box = mark.getBoundingClientRect();
    tools.style.left = `${box.left + Math.min(box.width / 2, 48)}px`;
    tools.style.top = `${Math.max(8, box.top)}px`;
  }

  function refresh() {
    const pathname = options.widget.dataset.readerPathname ?? '';
    const root = articleContentRoot(doc);
    const selection = view.getSelection();
    const saved = gestureRange;
    gestureRange = null;
    if (!pathname || !root) { hide(); return; }
    let captured = captureSelection(selection, root);
    /** @type {Range | null} */
    let range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
    if (!captured && saved) {
      captured = captureRange(saved, root);
      range = saved;
    }
    const highlight = highlightInRange(range, root);
    if (captured) {
      setFanVisible(true);
      setClear(highlight?.dataset.readerAnnotation ?? null);
      const edge = edgeAnchor();
      show(captured, edge ?? (launcher instanceof HTMLElement ? launcher : null), edge ? 'edge' : 'launcher');
      return;
    }
    const caretInHighlight = selection?.isCollapsed ? highlight : null;
    if (caretInHighlight) {
      setFanVisible(false);
      setClear(caretInHighlight.dataset.readerAnnotation ?? null);
      placeOnMark(caretInHighlight);
      show(null, null, 'mark');
      return;
    }
    hide();
  }

  function schedule() {
    view.clearTimeout(refreshTimer);
    refreshTimer = view.setTimeout(refresh, 80);
  }

  doc.addEventListener('pointerdown', event => {
    pointerDown = true;
    gestureRange = null;
    view.clearTimeout(refreshTimer);
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
    gestureRange = null;
    schedule();
  }, {signal});
  doc.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || event.isComposing || !open) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    dismiss();
  }, {signal, capture: true});
  doc.addEventListener('selectionchange', () => {
    // Triple-click commits the paragraph while the button is still down, and
    // a later collapsed selectionchange in that same press must not erase it.
    // The fan still waits for pointerup, so a drag does not flash tools.
    if (pointerDown) {
      rememberGesture();
      return;
    }
    schedule();
  }, {signal});
  tools.addEventListener('pointerdown', event => {
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
    if (!(button instanceof HTMLElement)) return;
    const type = button.dataset.selectionAction;
    if (type === 'clear-highlight') {
      const id = clearId;
      if (!id) return;
      clearId = null;
      options.onClear?.({id});
      dismiss();
      return;
    }
    if (!quote || (type !== 'highlight' && type !== 'note')) return;
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
