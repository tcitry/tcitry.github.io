import {locateQuote} from './text-quote.mjs';

// Block-level skips only. Inline `code` stays in the quote: a paragraph
// selection often contains it, and rejecting that range hid the tools.
const SKIP = 'script, style, noscript, svg, canvas, nav, pre, [data-book-island], [data-pagefind-ignore], [data-blog-code], [data-demo], .blog-comments, .blog-chat-widget, .mermaid';
const CONTEXT = 48;

/** @param {ParentNode} [doc] */
export function articleContentRoot(doc = document) {
  return doc.querySelector('main .book-page article.markdown');
}

/** @param {Node} node */
function elementOf(node) {
  return node.nodeType === Node.ELEMENT_NODE ? /** @type {Element} */ (node) : node.parentElement;
}

/** @param {Node} node */
function skipped(node) {
  const element = elementOf(node);
  return !element || Boolean(element.closest(SKIP));
}

/**
 * Text-node concatenation for one article. Offsets match captureSelection,
 * not Range.toString(), so block boundaries do not invent newlines.
 * @param {Element} root
 */
export function textIndex(root) {
  /** @type {{node: Text, start: number, end: number}[]} */
  const nodes = [];
  let text = '';
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue || skipped(node)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  let current = walker.nextNode();
  while (current) {
    const value = current.nodeValue ?? '';
    nodes.push({node: /** @type {Text} */ (current), start: text.length, end: text.length + value.length});
    text += value;
    current = walker.nextNode();
  }
  return {text, nodes};
}

/**
 * @param {ReturnType<typeof textIndex>} index
 * @param {Node} node
 */
function positionBefore(index, node) {
  const following = index.nodes.find(entry =>
    entry.node === node || Boolean(node.compareDocumentPosition(entry.node) & Node.DOCUMENT_POSITION_FOLLOWING));
  return following ? following.start : index.text.length;
}

/**
 * @param {ReturnType<typeof textIndex>} index
 * @param {Node} node
 */
function positionAfter(index, node) {
  const contained = index.nodes.filter(entry => node === entry.node || (node instanceof Element && node.contains(entry.node)));
  if (contained.length) return contained[contained.length - 1].end;
  return positionBefore(index, node);
}

/**
 * @param {ReturnType<typeof textIndex>} index
 * @param {Node} container
 * @param {number} offset
 */
function offsetOf(index, container, offset) {
  if (container.nodeType === Node.TEXT_NODE) {
    const entry = index.nodes.find(item => item.node === container);
    if (!entry) return null;
    return entry.start + Math.max(0, Math.min(offset, container.nodeValue?.length ?? 0));
  }
  if (!(container instanceof Element)) return null;
  if (offset >= container.childNodes.length) {
    const last = container.childNodes[container.childNodes.length - 1];
    return last ? positionAfter(index, last) : positionBefore(index, container);
  }
  return positionBefore(index, container.childNodes[offset]);
}

/**
 * A triple-click paragraph range often ends inside the next code block, or
 * merely touches one at the boundary. `Range.intersectsNode` treats that
 * boundary as a hit, so the old check rejected the whole paragraph.
 * Endpoints inside a skipped region are pulled back to the indexed text
 * beside that region. A selection that never leaves the region stays empty.
 * @param {ReturnType<typeof textIndex>} index
 * @param {Node} container
 * @param {number} offset
 * @param {'start' | 'end'} edge
 */
function endpointOffset(index, container, offset, edge) {
  if (!skipped(container)) return offsetOf(index, container, offset);
  const element = elementOf(container);
  const region = element?.closest(SKIP);
  if (!(region instanceof Element)) return null;
  return edge === 'end' ? positionBefore(index, region) : positionAfter(index, region);
}

/**
 * @param {Range} range
 * @param {Element} root
 * @returns {{quote: string, prefix: string, suffix: string} | null}
 */
export function captureRange(range, root) {
  if (!range || range.collapsed || !root) return null;
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
  const index = textIndex(root);
  const rawStart = endpointOffset(index, range.startContainer, range.startOffset, 'start');
  const rawEnd = endpointOffset(index, range.endContainer, range.endOffset, 'end');
  if (rawStart === null || rawEnd === null || rawEnd <= rawStart) return null;
  const raw = index.text.slice(rawStart, rawEnd);
  const leading = raw.length - raw.trimStart().length;
  const trailing = raw.length - raw.trimEnd().length;
  const start = rawStart + leading;
  const end = rawEnd - trailing;
  if (end <= start) return null;
  const quote = index.text.slice(start, end);
  if (!quote.trim() || quote.length > 2_000) return null;
  return {
    quote,
    prefix: index.text.slice(Math.max(0, start - CONTEXT), start),
    suffix: index.text.slice(end, end + CONTEXT),
  };
}

/**
 * @param {Selection | null} selection
 * @param {Element | null} root
 * @returns {{quote: string, prefix: string, suffix: string} | null}
 */
export function captureSelection(selection, root) {
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed || !root) return null;
  return captureRange(selection.getRangeAt(0), root);
}

/**
 * @param {Element} root
 * @param {{id: string, type: string, quote: string, prefix?: string, suffix?: string}[]} annotations
 */
export function paintAnnotations(root, annotations) {
  clearAnnotations(root);
  for (const annotation of annotations) {
    if (annotation.type === 'underline') continue;
    const index = textIndex(root);
    const located = locateQuote(index.text, annotation.quote, annotation.prefix ?? '', annotation.suffix ?? '');
    if (!located) continue;
    wrapSlice(root, index, located.start, located.end, annotation);
  }
  return () => clearAnnotations(root);
}

/** @param {Element} root */
export function clearAnnotations(root) {
  for (const mark of [...root.querySelectorAll('[data-reader-annotation]')]) {
    const parent = mark.parentNode;
    if (!parent) continue;
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
    parent.removeChild(mark);
    parent.normalize();
  }
}

/**
 * @param {Element} root
 * @param {ReturnType<typeof textIndex>} index
 * @param {number} start
 * @param {number} end
 * @param {{id: string, type: string}} annotation
 */
function wrapSlice(root, index, start, end, annotation) {
  const parts = index.nodes.filter(entry => entry.end > start && entry.start < end);
  if (!parts.length) return;
  const first = parts[0];
  const last = parts[parts.length - 1];
  let startNode = first.node;
  const startOffset = start - first.start;
  if (startOffset > 0) startNode = startNode.splitText(startOffset);
  if (last.node === first.node) {
    if (end - start < startNode.nodeValue.length) startNode.splitText(end - start);
  } else if (end - last.start < last.node.nodeValue.length) {
    last.node.splitText(end - last.start);
  }
  /** @type {Text[]} */
  const nodes = [];
  if (startNode.nodeValue) nodes.push(startNode);
  if ((last.node === first.node ? startNode : last.node) !== startNode) {
    const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    walker.currentNode = startNode;
    let next = walker.nextNode();
    while (next) {
      if (next.nodeValue && !skipped(next)) nodes.push(/** @type {Text} */ (next));
      if (next === last.node) break;
      next = walker.nextNode();
    }
  }
  const id = String(annotation.id);
  let anchored = false;
  for (const node of nodes) {
    if (!node.parentNode || !node.nodeValue) continue;
    const mark = root.ownerDocument.createElement('mark');
    mark.className = `reader-annotation reader-annotation--${annotation.type}`;
    mark.dataset.readerAnnotation = id;
    mark.dataset.annotationType = annotation.type;
    if (!anchored) {
      mark.id = `annotation-${id}`;
      mark.classList.add('reader-annotation--anchor');
      anchored = true;
    }
    node.parentNode.insertBefore(mark, node);
    mark.appendChild(node);
  }
}

/** @param {string} id */
export function focusAnnotation(id) {
  const nodes = document.querySelectorAll(`[data-reader-annotation="${CSS.escape(id)}"]`);
  if (!nodes.length) {
    const fallback = document.getElementById(`annotation-${id}`);
    if (!fallback) return false;
    fallback.classList.add('reader-annotation--target');
    fallback.scrollIntoView({behavior: 'smooth', block: 'center'});
    return true;
  }
  nodes.forEach(node => node.classList.add('reader-annotation--target'));
  nodes[0].scrollIntoView({behavior: 'smooth', block: 'center'});
  return true;
}
