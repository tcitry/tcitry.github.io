import {describe, expect, test} from 'vitest';
import {
  PROGRESS_MIN_INTERVAL_MS,
  articleProgress,
  flushProgress,
  noteProgress,
  scrollOffsetForProgress,
  type ProgressSyncState,
} from './reading-progress';

const idle: ProgressSyncState = {lastSent: 0, lastSentAt: 0, pending: null};

describe('article scroll ratio', () => {
  test('maps article position through the viewport and inverts it', () => {
    expect(articleProgress(0, 2000, 800)).toBe(0);
    expect(articleProgress(-600, 2000, 800)).toBeCloseTo(0.5);
    expect(articleProgress(-1200, 2000, 800)).toBe(1);
    expect(articleProgress(40, 2000, 800)).toBe(0);
    expect(articleProgress(0, 400, 800)).toBe(1);
    expect(articleProgress(120, 400, 800)).toBe(0);
    expect(articleProgress(Number.NaN, 400, 800)).toBe(0);
    expect(scrollOffsetForProgress(2000, 800, 0.5)).toBe(600);
    expect(articleProgress(-scrollOffsetForProgress(2000, 800, 0.25), 2000, 800)).toBeCloseTo(0.25);
  });
});

describe('progress write throttle', () => {
  test('sends the first 2% immediately and holds smaller or later movement', () => {
    expect(noteProgress(idle, 0.2, 1_000)).toEqual({
      state: {lastSent: 0.2, lastSentAt: 1_000, pending: null}, send: 0.2, waitMs: null,
    });
    const small = noteProgress(idle, 0.01, 1_000);
    expect(small.send).toBeNull();
    expect(small.waitMs).toBe(PROGRESS_MIN_INTERVAL_MS);
    expect(flushProgress(small.state, 2_500)).toEqual({
      state: {lastSent: 0.01, lastSentAt: 2_500, pending: null}, send: 0.01,
    });
    const held = noteProgress({lastSent: 0.2, lastSentAt: 1_000, pending: null}, 0.25, 1_100);
    expect(held.send).toBeNull();
    expect(held.state.pending).toBe(0.25);
    expect(held.waitMs).toBe(1_400);
    expect(noteProgress({lastSent: 0.2, lastSentAt: 1_000, pending: null}, 0.21, 2_500).send).toBe(0.21);
  });

  test('keeps the highest pending value and ignores decreases', () => {
    const raised = noteProgress({lastSent: 0.2, lastSentAt: 1_000, pending: 0.3}, 0.45, 1_200);
    expect(raised.send).toBeNull();
    expect(raised.state.pending).toBe(0.45);
    const ignored = noteProgress(raised.state, 0.1, 1_300);
    expect(ignored.state).toBe(raised.state);
    expect(ignored.send).toBeNull();
    expect(noteProgress(idle, Number.NaN, 1_000).state).toBe(idle);
    expect(noteProgress(idle, 1.4, 1_000).send).toBe(1);
    expect(flushProgress(idle, 1_000)).toEqual({state: idle, send: null});
  });
});
