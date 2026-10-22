import assert from 'node:assert/strict';
import test from 'node:test';
import {COPY_SUCCESS_MS, armCopySuccess, formatAnswerFinishedAt, releaseCopySuccess} from '../src/components/chat/answer-finished-at.ts';

const shanghai = (year, month, day, hour, minute) => Date.parse(
  `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+08:00`,
);

test('answer finish time uses Asia/Shanghai and stays compact', () => {
  const now = shanghai(2026, 10, 22, 18, 0);
  assert.equal(formatAnswerFinishedAt(shanghai(2026, 10, 22, 14, 5), now), '14:05');
  assert.equal(formatAnswerFinishedAt(shanghai(2026, 10, 22, 0, 5), now), '00:05');
  assert.equal(formatAnswerFinishedAt(shanghai(2026, 1, 5, 8, 0), now), '1/5 08:00');
  assert.equal(formatAnswerFinishedAt(shanghai(2025, 12, 31, 23, 59), now), '2025/12/31 23:59');
  assert.equal(formatAnswerFinishedAt(Number.NaN, now), null);
});

test('copy success returns to the copy icon and a new message clears it', () => {
  assert.ok(COPY_SUCCESS_MS >= 1500 && COPY_SUCCESS_MS <= 2000);
  let copied = false;
  const timer = {current: null};
  const pending = new Map();
  let nextId = 1;
  const schedule = (callback, delay) => {
    const id = nextId++;
    pending.set(id, {callback, delay});
    return id;
  };
  const cancel = id => pending.delete(id);
  armCopySuccess(value => { copied = value; }, timer, schedule, cancel);
  assert.equal(copied, true);
  assert.equal(pending.get(timer.current).delay, COPY_SUCCESS_MS);
  const first = timer.current;
  armCopySuccess(value => { copied = value; }, timer, schedule, cancel);
  assert.equal(pending.has(first), false, 'a second copy restarts the success window');
  const fired = timer.current;
  pending.get(fired).callback();
  pending.delete(fired);
  assert.equal(copied, false);
  assert.equal(timer.current, null);

  armCopySuccess(value => { copied = value; }, timer, schedule, cancel);
  releaseCopySuccess(value => { copied = value; }, timer, cancel);
  assert.equal(copied, false);
  assert.equal(pending.size, 0, 'starting another turn or unmounting drops the success icon');
});
