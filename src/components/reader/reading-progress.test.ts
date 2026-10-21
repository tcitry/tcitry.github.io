import {describe, expect, test} from 'vitest';
import {articleProgress} from './reading-progress';

describe('article scroll ratio', () => {
  test('maps the article position through the viewport', () => {
    expect(articleProgress(0, 2000, 800)).toBe(0);
    expect(articleProgress(-600, 2000, 800)).toBeCloseTo(0.5);
    expect(articleProgress(-1200, 2000, 800)).toBe(1);
    expect(articleProgress(40, 2000, 800)).toBe(0);
    expect(articleProgress(0, 400, 800)).toBe(1);
    expect(articleProgress(120, 400, 800)).toBe(0);
    expect(articleProgress(Number.NaN, 400, 800)).toBe(0);
    expect(articleProgress(-2400, 2000, 800)).toBe(1);
  });
});
