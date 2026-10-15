import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';
import test from 'node:test';
const source = await readFile(new URL('../src/components/demos/cal-diy-availability-model.ts', import.meta.url), 'utf8');
const {subtractRanges, availabilityAt, DEFAULT_INPUT, PRESETS} = await import(`data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source)).toString('base64')}`);

test('the default UTC day leaves three actual intervals, totaling 330 minutes', () => {
  const frame = availabilityAt();
  assert.deepEqual(frame.remaining, [{start: 540, end: 600}, {start: 660, end: 840}, {start: 930, end: 1020}]);
  assert.equal(frame.minutes, 330);
  assert.equal(frame.removedMinutes, 150);
});
test('sorting, overlaps, endpoint contact, outside busy ranges and whole coverage match subtraction', () => {
  const original = [{start: 10, end: 30, label: 'preserve'}];
  const busy = [{start: 18, end: 25}, {start: 14, end: 20}];
  assert.deepEqual(subtractRanges(original, busy), [{start: 10, end: 14, label: 'preserve'}, {start: 25, end: 30, label: 'preserve'}]);
  assert.deepEqual(busy, [{start: 18, end: 25}, {start: 14, end: 20}]);
  assert.deepEqual(subtractRanges(original, [{start: 0, end: 10}, {start: 30, end: 40}]), original);
  assert.deepEqual(subtractRanges(original, [{start: 0, end: 12}, {start: 28, end: 40}]), [{start: 12, end: 28, label: 'preserve'}]);
  assert.deepEqual(subtractRanges(original, [{start: 0, end: 40}]), []);
  assert.deepEqual(subtractRanges([{start: 1, end: 1}], []), []);
});
test('step snapshots and presets preserve exact interval behavior', () => {
  assert.equal(availabilityAt({...DEFAULT_INPUT, step: 0}).minutes, 480);
  assert.equal(availabilityAt({...DEFAULT_INPUT, step: 1}).minutes, 420);
  assert.deepEqual(availabilityAt(PRESETS[1].input).remaining, [{start: 540, end: 600}, {start: 720, end: 1020}]);
  assert.deepEqual(availabilityAt(PRESETS[2].input).remaining, [{start: 540, end: 600}, {start: 720, end: 1020}]);
  assert.deepEqual(availabilityAt(PRESETS[3].input).remaining, []);
  assert.equal(availabilityAt({...DEFAULT_INPUT, secondDuration: 0}).minutes, 420);
});
test('UI inputs remain finite, and results equal a minute-cell reference across every slider position', () => {
  for (let start = 480; start <= 1020; start += 15) for (let duration = 0; duration <= 240; duration += 15) {
    const frame = availabilityAt({...DEFAULT_INPUT, secondStart: start, secondDuration: duration});
    const cells = Array.from({length: 480}, (_, i) => i + 540).filter(minute => !frame.applied.some(busy => minute >= busy.start && minute < busy.end));
    assert.equal(frame.minutes, cells.length);
    assert.equal(frame.remaining.reduce((n, range) => n + range.end - range.start, 0), cells.length);
    for (const range of frame.remaining) assert.ok(range.end > range.start && range.start >= 540 && range.end <= 1020);
  }
  for (const bad of [NaN, Infinity, -Infinity]) assert.ok(Number.isFinite(availabilityAt({...DEFAULT_INPUT, secondStart: bad, secondDuration: bad, step: bad}).minutes));
});
