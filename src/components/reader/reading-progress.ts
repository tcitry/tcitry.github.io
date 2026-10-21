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

export function flushProgress(state: ProgressSyncState, now: number): {state: ProgressSyncState; send: number | null} {
  if (state.pending === null || state.pending <= state.lastSent) {
    return state.pending === null ? {state, send: null} : {state: {...state, pending: null}, send: null};
  }
  return {state: {lastSent: state.pending, lastSentAt: now, pending: null}, send: state.pending};
}
