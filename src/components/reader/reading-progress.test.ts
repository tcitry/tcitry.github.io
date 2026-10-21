import {describe, expect, test} from 'vitest';
import {
  PROGRESS_MIN_INTERVAL_MS,
  articleProgress,
  flushProgress,
  noteProgress,
  readingProgressFrame,
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

describe('progress chrome placement', () => {
  test('stays in the article column instead of covering the fixed menu', () => {
    const frame = readingProgressFrame({
      viewportWidth: 1440,
      page: {left: 320, right: 1120},
      headerBottom: null,
      obstacles: [{left: 16, right: 280, top: 16, bottom: 96}],
    });
    expect(frame.left).toBeGreaterThanOrEqual(320);
    expect(frame.right).toBeGreaterThanOrEqual(320);
    expect(frame.top).toBe(0);
  });

  test('sits below a visible mobile header and any branding that still intersects the column', () => {
    const belowHeader = readingProgressFrame({
      viewportWidth: 390,
      page: {left: 0, right: 390},
      headerBottom: 56,
      obstacles: [],
    });
    expect(belowHeader).toMatchObject({top: 56, left: 0, right: 0});
    const belowBrand = readingProgressFrame({
      viewportWidth: 390,
      page: {left: 0, right: 390},
      headerBottom: null,
      obstacles: [{left: 8, right: 220, top: 12, bottom: 44.2}],
    });
    expect(belowBrand.top).toBeGreaterThanOrEqual(45);
    expect(belowBrand.left).toBe(0);
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
