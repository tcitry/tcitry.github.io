import test from 'node:test';
import assert from 'node:assert/strict';
import { readingMinutes } from '../src/lib/reading-time.mjs';

test('readingMinutes uses ~400 CJK characters per minute with a one-minute floor', () => {
  assert.equal(readingMinutes(0), 0);
  assert.equal(readingMinutes(1), 1);
  assert.equal(readingMinutes(400), 1);
  assert.equal(readingMinutes(401), 2);
  assert.equal(readingMinutes(4155), 11);
});
