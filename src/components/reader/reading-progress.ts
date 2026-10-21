export const PROGRESS_MIN_DELTA = 0.02;
export const PROGRESS_MIN_INTERVAL_MS = 1500;

export interface ProgressSyncState {
  lastSent: number;
  lastSentAt: number;
  pending: number | null;
}

export function clampUnit(value: number) {
  if (!Number.isFinite(value)) return null;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

export function articleProgress(articleTop: number, articleHeight: number, viewHeight: number) {
  if (!Number.isFinite(articleTop) || !Number.isFinite(articleHeight) || !Number.isFinite(viewHeight) || articleHeight <= 0 || viewHeight <= 0) return 0;
  const distance = articleHeight - viewHeight;
  if (distance <= 0) return articleTop <= 1 ? 1 : 0;
  const ratio = -articleTop / distance;
  if (ratio <= 0) return 0;
  if (ratio >= 1) return 1;
  return ratio;
}

export function scrollOffsetForProgress(articleHeight: number, viewHeight: number, progress: number) {
  const clamped = clampUnit(progress);
  if (clamped === null || !Number.isFinite(articleHeight) || !Number.isFinite(viewHeight)) return 0;
  return Math.max(0, articleHeight - viewHeight) * clamped;
}

export interface ProgressDecision {
  state: ProgressSyncState;
  send: number | null;
  waitMs: number | null;
}

// The first increase of at least 2% is saved immediately. Smaller movement waits
// 1.5s. Later increases coalesce to one write per 1.5s, keeping the highest value.
export function noteProgress(state: ProgressSyncState, next: number, now: number): ProgressDecision {
  const progress = clampUnit(next);
  if (progress === null || progress <= state.lastSent) return {state, send: null, waitMs: null};
  const pending = state.pending === null ? progress : Math.max(state.pending, progress);
  const delta = pending - state.lastSent;
  const neverSent = state.lastSentAt === 0;
  const elapsed = neverSent ? 0 : now - state.lastSentAt;
  const intervalOpen = !neverSent && elapsed >= PROGRESS_MIN_INTERVAL_MS;
  const firstStep = neverSent && delta >= PROGRESS_MIN_DELTA;
  if (firstStep || intervalOpen) {
    return {state: {lastSent: pending, lastSentAt: now, pending: null}, send: pending, waitMs: null};
  }
  const waitMs = neverSent ? PROGRESS_MIN_INTERVAL_MS : Math.max(0, PROGRESS_MIN_INTERVAL_MS - elapsed);
  return {state: {...state, pending}, send: null, waitMs};
}

export interface ProgressFrameBox {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface ProgressFrame {
  top: number;
  left: number;
  right: number;
}

// Keep the fixed progress strip inside the article column and below any
// branding, search, or mobile header that would otherwise share its pixels.
export function readingProgressFrame({
  viewportWidth,
  page,
  headerBottom,
  obstacles,
}: {
  viewportWidth: number;
  page: {left: number; right: number} | null;
  headerBottom: number | null;
  obstacles: ProgressFrameBox[];
}): ProgressFrame {
  const width = Number.isFinite(viewportWidth) ? Math.max(0, viewportWidth) : 0;
  let left = 0;
  let right = 0;
  if (page && Number.isFinite(page.left) && Number.isFinite(page.right) && page.right > page.left && page.right > 0 && page.left < width) {
    left = Math.max(0, page.left);
    right = Math.max(0, width - page.right);
    if (left + right >= width - 8) {
      left = 0;
      right = 0;
    }
  }
  let top = headerBottom !== null && Number.isFinite(headerBottom) && headerBottom > 0 ? headerBottom : 0;
  for (const box of obstacles) {
    if (!Number.isFinite(box.left) || !Number.isFinite(box.right) || !Number.isFinite(box.top) || !Number.isFinite(box.bottom)) continue;
    if (box.bottom <= top + 0.5 || box.top > top + 180) continue;
    if (box.right <= left + 1 || box.left >= width - right - 1) continue;
    top = Math.max(top, box.bottom);
  }
  return {top: Math.ceil(top), left: Math.ceil(left), right: Math.ceil(right)};
}

export function flushProgress(state: ProgressSyncState, now: number): {state: ProgressSyncState; send: number | null} {
  if (state.pending === null || state.pending <= state.lastSent) {
    return state.pending === null ? {state, send: null} : {state: {...state, pending: null}, send: null};
  }
  return {state: {lastSent: state.pending, lastSentAt: now, pending: null}, send: state.pending};
}
