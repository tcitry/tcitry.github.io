// Keep native scrolling (wheel, touch, keyboard, selection and anchors), while
// painting only the thumb outside layout. Works with classic OS scrollbars too.
type Axis = 'x' | 'y';
type Thumb = { node: HTMLDivElement; range: number; travel: number };
type Area = { element: HTMLElement; thumbs: Record<Axis, Thumb>; timer?: number; removal?: number; dragging: boolean };

export function installFloatingScrollbars() {
  const controller = new AbortController();
  const { signal } = controller;
  const areas = new Map<HTMLElement, Area>();
  let frame = 0;
  const root = () => document.scrollingElement as HTMLElement;

  function remove(area: Area) {
    window.clearTimeout(area.timer);
    window.clearTimeout(area.removal);
    Object.values(area.thumbs).forEach(({ node }) => node.remove());
    areas.delete(area.element);
  }

  function scheduleHide(area: Area) {
    window.clearTimeout(area.timer);
    if (area.dragging) return;
    area.timer = window.setTimeout(() => {
      Object.values(area.thumbs).forEach(({ node }) => node.removeAttribute('data-visible'));
      area.removal = window.setTimeout(() => remove(area), 150);
    }, 650);
  }

  function makeThumb(area: Area, axis: Axis): Thumb {
    const node = document.createElement('div');
    node.className = 'blog-scroll-thumb';
    node.dataset.axis = axis;
    // This is an alternate pointer affordance for an already keyboard-scrollable
    // native region, not an additional control in the accessibility tree.
    node.setAttribute('aria-hidden', 'true');
    const thumb = { node, range: 0, travel: 0 };
    node.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || !thumb.travel) return;
      event.preventDefault();
      area.dragging = true;
      window.clearTimeout(area.timer);
      node.setPointerCapture(event.pointerId);
      const start = axis === 'y' ? event.clientY : event.clientX;
      const scroll = axis === 'y' ? area.element.scrollTop : area.element.scrollLeft;
      const move = (event: PointerEvent) => {
        const delta = (axis === 'y' ? event.clientY : event.clientX) - start;
        area.element.scrollTo({ [axis === 'y' ? 'top' : 'left']: scroll + delta * thumb.range / thumb.travel, behavior: 'instant' });
      };
      const end = () => {
        node.removeEventListener('pointermove', move);
        node.removeEventListener('lostpointercapture', end);
        area.dragging = false;
        scheduleHide(area);
      };
      node.addEventListener('pointermove', move);
      node.addEventListener('lostpointercapture', end);
    }, { signal });
    return thumb;
  }

  function update(area: Area) {
    const element = area.element;
    if (!element.isConnected) { remove(area); return; }
    const isRoot = element === root();
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    let left = isRoot ? 0 : rect.left + element.clientLeft;
    let top = isRoot ? 0 : rect.top + element.clientTop;
    let right = left + (isRoot ? innerWidth : element.clientWidth);
    let bottom = top + (isRoot ? innerHeight : element.clientHeight);
    // A nested scroller can itself move or be clipped by its ancestors.
    for (let parent = isRoot ? null : element.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
      const css = getComputedStyle(parent);
      const box = parent.getBoundingClientRect();
      if (css.overflowX !== 'visible') { left = Math.max(left, box.left); right = Math.min(right, box.right); }
      if (css.overflowY !== 'visible') { top = Math.max(top, box.top); bottom = Math.min(bottom, box.bottom); }
    }
    left = Math.max(0, left); top = Math.max(0, top);
    right = Math.min(innerWidth, right); bottom = Math.min(innerHeight, bottom);
    // A modal dialog lives above body portals. Its thumb must share that layer.
    const host = element.closest('dialog:modal') ?? document.body;
    for (const axis of ['x', 'y'] as const) {
      const thumb = area.thumbs[axis];
      const vertical = axis === 'y';
      const viewport = vertical ? element.clientHeight : element.clientWidth;
      const extent = vertical ? element.scrollHeight : element.scrollWidth;
      const overflow = vertical ? style.overflowY : style.overflowX;
      const track = (vertical ? bottom - top : right - left) - 4;
      const enabled = (isRoot ? !['hidden', 'clip'].includes(overflow) : /auto|scroll|overlay/.test(overflow));
      thumb.node.hidden = !enabled || extent <= viewport + 1 || track < 24 || right <= left || bottom <= top;
      if (thumb.node.hidden) continue;
      const length = Math.min(track, Math.max(28, track * viewport / extent));
      thumb.range = extent - viewport;
      thumb.travel = track - length;
      const offset = vertical ? element.scrollTop : Math.abs(element.scrollLeft);
      const fraction = Math.max(0, Math.min(1, offset / thumb.range));
      const position = (vertical ? top : left) + 2 + fraction * thumb.travel;
      Object.assign(thumb.node.style, {
        left: `${vertical ? right - 11 : position}px`, top: `${vertical ? position : bottom - 11}px`,
        width: `${vertical ? 11 : length}px`, height: `${vertical ? length : 11}px`,
      });
      if (thumb.node.parentElement !== host) host.append(thumb.node);
    }
  }

  function onScroll(event: Event) {
    const element = event.target === document ? root() : event.target;
    if (!(element instanceof HTMLElement)) return;
    let area = areas.get(element);
    if (!area) {
      area = { element, thumbs: {} as Record<Axis, Thumb>, dragging: false };
      area.thumbs = { x: makeThumb(area, 'x'), y: makeThumb(area, 'y') };
      areas.set(element, area);
    }
    window.clearTimeout(area.removal);
    update(area);
    Object.values(area.thumbs).forEach(({ node }) => node.setAttribute('data-visible', ''));
    scheduleHide(area);
    // Scrolling an ancestor also moves any currently visible descendant thumb.
    if (!frame) frame = requestAnimationFrame(() => { areas.forEach(update); frame = 0; });
  }

  document.addEventListener('scroll', onScroll, { capture: true, passive: true, signal });
  window.addEventListener('resize', () => areas.forEach(update), { passive: true, signal });
  const cleanup = () => {
    controller.abort(); cancelAnimationFrame(frame); areas.forEach(remove);
  };
  document.addEventListener('astro:before-swap', cleanup, { once: true, signal });
  return cleanup;
}

let dispose = installFloatingScrollbars();
document.addEventListener('astro:page-load', () => { dispose(); dispose = installFloatingScrollbars(); });
