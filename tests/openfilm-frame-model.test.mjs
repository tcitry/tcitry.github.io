import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';
import test from 'node:test';

const source = await readFile(new URL('../src/components/demos/openfilm-frame-model.ts', import.meta.url), 'utf8');
const model = await import(`data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source)).toString('base64')}`);
const {FRAME_SEQUENCES, LAST_TIME, followTime, frameAt, initialFrameState, requestFrame, timeInRange} = model;

test('ordered and shuffled requests finish with the same complete reference frame', () => {
  const run = times => times.reduce(requestFrame, initialFrameState());
  assert.deepEqual(run(FRAME_SEQUENCES.ordered).frame, run(FRAME_SEQUENCES.shuffled).frame);
  assert.equal(run(FRAME_SEQUENCES.shuffled).frame.x, 290);
});

test('repeating a timestamp never accumulates position', () => {
  const result = FRAME_SEQUENCES.repeated.reduce(requestFrame, initialFrameState());
  assert.equal(result.requests, 4);
  assert.equal(result.referenceChecks, 4);
  assert.deepEqual(result.frame, frameAt(1.5));
  assert.equal(new Set(result.history.map(request => request.signature)).size, 1);
});

test('fractional times map to their own positions independently of a nominal frame rate', () => {
  assert.equal(frameAt(0.75).x, 165);
  assert.equal(frameAt(0.751).x, 40 + 500 * 0.751 / 3);
  assert.equal(frameAt(0).carriageTravel, 0);
  assert.equal(frameAt(1.5).carriageTravel, 103);
});

test('invalid or out-of-range UI input remains before the exclusive duration boundary', () => {
  assert.equal(timeInRange(-1), 0);
  assert.equal(timeInRange(300), LAST_TIME);
  assert.equal(timeInRange(Infinity), 0);
  assert.equal(timeInRange(NaN), 0);
  assert.ok(frameAt(LAST_TIME).t < 3);
});

test('bounded request history does not change the picture or mutate the prior state', () => {
  const start = initialFrameState();
  let result = start;
  for (let i = 0; i < 14; i++) result = requestFrame(result, i / 10);
  result = requestFrame(result, 1.5);
  assert.equal(result.history.length, 8);
  assert.equal(result.requests, 15);
  assert.deepEqual(result.frame, frameAt(1.5));
  assert.deepEqual(start.history, []);
});

test('view easing is time based, caps background gaps and becomes still for reduced motion', () => {
  assert.equal(followTime(0, 1.5, 0), 0);
  assert.equal(followTime(0, 1.5, 30), followTime(0, 1.5, 1 / 30));
  assert.equal(followTime(0, 1.5, 0.01, true), 1.5);
  const next = followTime(0, 1.5, 0.01);
  assert.ok(next > 0 && next < 1.5);
});
