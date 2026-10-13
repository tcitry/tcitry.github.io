import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';
import test from 'node:test';
const source = await readFile(new URL('../src/components/demos/openfilm-frame-model.ts', import.meta.url), 'utf8');
const {frameAt, PAGE_CLIPS} = await import(`data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source)).toString('base64')}`);

test('the same film time addresses different times in the two HTML pages', () => {
  const frame = frameAt(3);
  assert.equal(frame.title.sourceTime, 2);
  assert.equal(frame.background.sourceTime, 3);
  assert.equal(frame.title.end, 5);
  assert.equal(PAGE_CLIPS[0].track, 0); // first Track overlays the second
});
test('a trimmed HTML clip enters at its source in-point and ends exclusively', () => {
  assert.equal(frameAt(1.999).title.sourceTime, null);
  assert.equal(frameAt(2).title.sourceTime, 1);
  assert.equal(frameAt(4.999).title.active, true);
  assert.equal(frameAt(5).title.sourceTime, null);
  assert.equal(frameAt(5).background.sourceTime, 5);
  assert.equal(frameAt(6).background.active, false);
});
test('jumping backward and repeating a request reproduce the complete frame', () => {
  const expected = frameAt(3);
  for (const time of [5, 0, 2, 3, 3, 5.99, 1, 3]) frameAt(time);
  assert.deepEqual(frameAt(3), expected);
  assert.equal(expected.sunX, 156);
  assert.equal(expected.titleOpacity, 1);
  assert.equal(frameAt(2).titleOpacity, 1);
  assert.equal(frameAt(2).titleY, 124);
});
test('invalid UI time is bounded and never produces NaN geometry', () => {
  for (const t of [NaN, Infinity, -1, 99]) {
    const frame = frameAt(t);
    assert.ok(frame.t >= 0 && frame.t <= 6);
    assert.ok(Number.isFinite(frame.sunX));
  }
});
