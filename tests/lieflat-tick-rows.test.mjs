import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';

const bundle = await build({entryPoints: ['src/components/demos/lieflat-tick-rows.ts'], bundle: true, platform: 'node', format: 'esm', write: false});
const {buildTickRows, parseTickCount, DEFAULT_TICK_DATA, createTickAnimation} = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const withValues = values => DEFAULT_TICK_DATA.map((row, index) => ({name: row.name, value: values[index]}));

test('teaching counts remain exact and largest-category updates rescale the same unit geometry', () => {
  const initial = buildTickRows(DEFAULT_TICK_DATA);
  assert.equal(initial.total, 40);
  assert.equal(initial.share, 45);
  assert.deepEqual(initial.rows.map(row => row.ticks.length), [18, 12, 6, 4]);
  assert.equal(initial.rows.flatMap(row => row.ticks).filter(tick => tick.fifth).length, 6);
  const changed = buildTickRows(withValues([18, 24, 6, 4]));
  assert.equal(changed.total, 52);
  assert.equal(changed.share, 46.2);
  assert.equal(changed.leaders[0].name, '链接修复');
  assert.equal(changed.rows[1].ticks.length, 24);
  assert.equal(changed.baselineEnd, initial.baselineEnd);
  assert.ok(changed.step < initial.step);
  assert.equal(changed.rows[1].valueX, changed.baselineEnd + 10);
  assert.deepEqual(buildTickRows(DEFAULT_TICK_DATA), initial, 'refresh must preserve deterministic texture');
});

test('zero counts produce no invented units or invalid geometry; ties name every leading category', () => {
  const empty = buildTickRows(withValues([0, 0, 0, 0]));
  assert.equal(empty.total, 0);
  assert.equal(empty.share, 0);
  assert.equal(empty.baselineEnd, empty.x0);
  assert.deepEqual(empty.leaders, []);
  assert.ok(empty.rows.every(row => row.ticks.length === 0 && Number.isFinite(row.valueX)));
  const tied = buildTickRows(withValues([18, 18, 0, 0]));
  assert.deepEqual(tied.leaders.map(row => row.name), ['内容校对', '链接修复']);
  assert.equal(tied.share, 50);
  assert.match(tied.heading, /并列/);
  assert.equal(buildTickRows(withValues([40, 40, 40, 40])).rows.flatMap(row => row.ticks).length, 160);
});

test('fractional, signed, nonfinite, empty and out-of-range inputs never become fake ticks', () => {
  for (const value of ['', '-1', '18.5', '1e1', 'Infinity', '41', '100', ' 12 ']) assert.equal(parseTickCount(value), null, value);
  for (const value of ['0', '12', '24', '40']) assert.equal(parseTickCount(value), Number(value));
  for (const value of [-1, 18.5, NaN, Infinity, 41]) assert.throws(() => buildTickRows(withValues([value, 12, 6, 4])));
});

function animationFixture(t, reduced = false) {
  const previousWindow = globalThis.window;
  const previousObserver = globalThis.IntersectionObserver;
  const media = Object.assign(new EventTarget(), {matches: reduced});
  const calls = [];
  let intersection;
  let disconnects = 0;
  globalThis.window = {matchMedia: () => media};
  globalThis.IntersectionObserver = class {
    constructor(callback) {intersection = callback;}
    observe() {}
    disconnect() {disconnects += 1;}
  };
  const svg = {querySelectorAll: () => [{dataset: {opacity: '0.8', delay: '104'}, animate: (frames, options) => {
    const call = {frames, options, canceled: false};
    calls.push(call);
    return {cancel: () => {call.canceled = true;}};
  }}]};
  const animation = createTickAnimation(svg);
  t.after(() => {
    animation.destroy();
    if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow;
    if (previousObserver === undefined) delete globalThis.IntersectionObserver; else globalThis.IntersectionObserver = previousObserver;
  });
  return {animation, media, calls, reveal: () => intersection([{isIntersecting: true}]), disconnects: () => disconnects};
}

test('reveal waits for visibility; replay cancels old animations and unmount prevents new work', t => {
  const f = animationFixture(t);
  f.animation.refresh();
  assert.equal(f.calls.length, 0);
  f.reveal();
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].options.duration, 900);
  assert.equal(f.calls[0].options.delay, 104);
  f.animation.replay();
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[0].canceled, true);
  f.animation.destroy();
  assert.equal(f.calls[1].canceled, true);
  f.animation.replay();
  assert.equal(f.calls.length, 2);
  assert.ok(f.disconnects() >= 2);
});

test('reduced motion is immediate on first paint and cancels an animation when preference changes', t => {
  const f = animationFixture(t, true);
  f.reveal();
  f.animation.replay();
  assert.equal(f.calls.length, 0);
  f.media.matches = false;
  f.animation.replay();
  assert.equal(f.calls.length, 1);
  f.media.matches = true;
  f.media.dispatchEvent(new Event('change'));
  assert.equal(f.calls[0].canceled, true);
});
