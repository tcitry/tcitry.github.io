import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';

// Bundle the actual TypeScript modules, as the other client behavior tests do.
const bundle = await build({
  stdin: {
    contents: `export {OrbitEngine} from './orbit-engine';
      export {useOrbit} from './orbit-store';
      export {SimAudio} from './orbit-audio';
      export {applyCamera, drawScene, screenToWorld} from './orbit-render';
      export {allocBody, resetBody} from './orbit-body';
      export {PHYS_DT} from './orbit-types';`,
    resolveDir: new URL('../src/components/demos/', import.meta.url).pathname,
    loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'esm', write: false,
});
const {OrbitEngine, useOrbit, SimAudio, screenToWorld, PHYS_DT} =
  await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));

const close = (actual, expected, tolerance = 1e-9) => assert.ok(
  Math.abs(actual - expected) <= tolerance,
  `Expected ${actual} to be within ${tolerance} of ${expected}`,
);

function context() {
  let matrix = [1, 0, 0, 1, 0, 0];
  const stack = [];
  const arcs = [];
  return {
    arcs,
    setTransform(...m) {matrix = m;},
    translate(x, y) {
      matrix[4] += matrix[0] * x + matrix[2] * y;
      matrix[5] += matrix[1] * x + matrix[3] * y;
    },
    scale(x, y) {matrix[0] *= x; matrix[1] *= x; matrix[2] *= y; matrix[3] *= y;},
    save() {stack.push([...matrix]);},
    restore() {matrix = stack.pop();},
    arc(x, y, radius) {
      arcs.push({x: matrix[0] * x + matrix[2] * y + matrix[4], y: matrix[1] * x + matrix[3] * y + matrix[5], radius, scale: matrix[0]});
    },
    createRadialGradient() {return {addColorStop() {}};},
    fillRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, fill() {}, stroke() {}, setLineDash() {}, closePath() {},
  };
}

function fixture(t) {
  const restored = [];
  function global(name, value) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, {value, writable: true, configurable: true});
    restored.push(() => descriptor ? Object.defineProperty(globalThis, name, descriptor) : delete globalThis[name]);
  }
  const win = Object.assign(new EventTarget(), {devicePixelRatio: 2, matchMedia: () => ({matches: true})});
  const doc = Object.assign(new EventTarget(), {hidden: false});
  const frames = new Map();
  let nextFrame = 0;
  global('window', win);
  global('document', doc);
  global('ResizeObserver', class {observe() {} disconnect() {}});
  global('requestAnimationFrame', fn => {frames.set(++nextFrame, fn); return nextFrame;});
  global('cancelAnimationFrame', id => frames.delete(id));
  const ctx = context();
  const captures = new Set();
  const canvas = Object.assign(new EventTarget(), {
    style: {}, parentElement: null,
    getContext: () => ctx,
    getBoundingClientRect: () => ({left: 0, top: 0, width: 800, height: 600}),
    setPointerCapture: id => captures.add(id),
    hasPointerCapture: id => captures.has(id),
    releasePointerCapture: id => captures.delete(id),
  });
  useOrbit.setState({intro: false, paused: true, scenario: 'empty', selectedId: null, follow: false, trails: true, collide: 'merge'});
  const engine = new OrbitEngine(canvas);
  engine.start();
  Object.assign(engine.cam, {x: 0, y: 0, zoom: 1});
  t.after(() => {engine.destroy(); for (const restore of restored.reverse()) restore();});
  function pointer(type, x = 400, y = 300, props = {}) {
    const event = Object.assign(new Event(type, {cancelable: true}), {
      clientX: x, clientY: y, button: 0, buttons: type === 'pointerup' ? 0 : 1,
      pointerType: 'mouse', pointerId: 1, ...props,
    });
    (type === 'pointerdown' ? canvas : win).dispatchEvent(event);
    return event;
  }
  return {engine, pointer, canvas, ctx, win, doc, frames, captures};
}

test('approaching free bodies bounce apart with conserved momentum and reduced kinetic energy', t => {
  const {engine} = fixture(t);
  const a = engine.spawn(-2, 0, 10, 3, 10);
  const b = engine.spawn(2, 0, -4, -2, 20);
  const px = a.mass * a.vx + b.mass * b.vx;
  const py = a.mass * a.vy + b.mass * b.vy;
  const energy = a.mass * (a.vx ** 2 + a.vy ** 2) + b.mass * (b.vx ** 2 + b.vy ** 2);
  engine.resolveCollisions('bounce');
  close(a.mass * a.vx + b.mass * b.vx, px);
  close(a.mass * a.vy + b.mass * b.vy, py);
  close(b.vx - a.vx, (10 - -4) * 0.72);
  assert.ok(b.vx > a.vx, 'the contact must now separate');
  assert.ok(a.mass * (a.vx ** 2 + a.vy ** 2) + b.mass * (b.vx ** 2 + b.vy ** 2) < energy);
  close(b.x - a.x, (a.radius + b.radius) * 0.92);
});

test('separating overlaps are corrected without a second bounce impulse', t => {
  const {engine} = fixture(t);
  const a = engine.spawn(-2, 0, -10, 0, 10);
  const b = engine.spawn(2, 0, 10, 0, 10);
  engine.resolveCollisions('bounce');
  assert.deepEqual([a.vx, b.vx], [-10, 10]);
  close(b.x - a.x, (a.radius + b.radius) * 0.92);
});

test('free-body mergers conserve mass, center of mass and momentum, including exact overlap', t => {
  const {engine} = fixture(t);
  for (const separation of [4, 0]) {
    engine.clear(true);
    const a = engine.spawn(0, 0, 15, -9, 30);
    const b = engine.spawn(separation, 0, -6, 12, 10);
    engine.resolveCollisions('merge');
    const live = engine.bodies.filter(body => body.alive);
    assert.equal(live.length, 1);
    assert.equal(live[0].mass, 40);
    close(live[0].x, separation / 4);
    close(live[0].vx, (30 * 15 - 10 * 6) / 40);
    close(live[0].vy, (-30 * 9 + 10 * 12) / 40);
    assert.equal(a.alive || b.alive, true);
  }
});

test('exact-overlap bounces produce finite separated bodies, including pinned contacts', t => {
  const {engine} = fixture(t);
  for (const pinned of [false, true]) {
    engine.clear(true);
    const a = engine.spawn(0, 0, 0, 0, 20, 'planet', pinned);
    const b = engine.spawn(0, 0, 0, 0, 10);
    engine.resolveCollisions('bounce');
    close(Math.hypot(b.x - a.x, b.y - a.y), (a.radius + b.radius) * 0.92);
    for (const body of [a, b]) assert.ok([body.x, body.y, body.vx, body.vy].every(Number.isFinite));
    if (pinned) assert.deepEqual([a.x, a.y, a.vx, a.vy], [0, 0, 0, 0]);
  }
});

test('fixed-step force integration preserves total free-body momentum and leaves anchors fixed', t => {
  const {engine} = fixture(t);
  const a = engine.spawn(-100, 30, 8, -2, 20);
  const b = engine.spawn(130, -40, -3, 5, 45);
  const momentum = () => [a.mass * a.vx + b.mass * b.vx, a.mass * a.vy + b.mass * b.vy];
  const original = momentum();
  for (let step = 0; step < 48; step++) engine.physicsStep(PHYS_DT, false, 'merge');
  close(momentum()[0], original[0], 1e-8);
  close(momentum()[1], original[1], 1e-8);
  engine.clear(true);
  const anchor = engine.spawn(0, 0, 0, 0, 2200, 'star', true);
  engine.spawn(190, 0, 0, 170, 52);
  for (let step = 0; step < 48; step++) engine.physicsStep(PHYS_DT, false, 'merge');
  assert.deepEqual([anchor.x, anchor.y, anchor.vx, anchor.vy], [0, 0, 0, 0]);
});

test('clicking or cancelling selection leaves a moving body velocity unchanged', t => {
  const {engine, pointer, captures} = fixture(t);
  const body = engine.spawn(0, 0, 31, -17, 52);
  pointer('pointerdown');
  pointer('pointerup');
  assert.deepEqual([body.vx, body.vy, body.pinned], [31, -17, false]);
  pointer('pointerdown');
  pointer('pointermove', 320, 320);
  pointer('pointercancel', 320, 320);
  assert.deepEqual([body.vx, body.vy, body.pinned], [31, -17, false]);
  assert.equal(engine.throwState.active, false);
  assert.equal(useOrbit.getState().throwing, false);
  assert.equal(captures.size, 0);
});

test('a cancelled launch creates no body; a released pull sets the launch velocity', t => {
  const {engine, pointer} = fixture(t);
  pointer('pointerdown');
  pointer('pointermove', 340, 320);
  pointer('pointercancel', 340, 320);
  pointer('pointerup', 340, 320);
  assert.equal(engine.liveCount(), 0);
  pointer('pointerdown');
  pointer('pointerup', 340, 320);
  const body = engine.bodies.find(body => body.alive);
  assert.ok(body);
  close(body.vx, 60 * 1.55);
  close(body.vy, -20 * 1.55);
});

test('two-finger navigation and an extra touch cannot launch or stop an existing body', t => {
  const {engine, pointer} = fixture(t);
  const body = engine.spawn(0, 0, 13, 8, 52);
  pointer('pointerdown', 400, 300, {pointerId: 1, pointerType: 'touch'});
  pointer('pointerdown', 500, 300, {pointerId: 2, pointerType: 'touch'});
  pointer('pointerdown', 550, 320, {pointerId: 3, pointerType: 'touch'});
  pointer('pointermove', 600, 300, {pointerId: 2, pointerType: 'touch'});
  for (const id of [3, 2, 1]) pointer('pointerup', id === 1 ? 400 : 600, 300, {pointerId: id, pointerType: 'touch'});
  assert.equal(engine.liveCount(), 1);
  assert.deepEqual([body.vx, body.vy], [13, 8]);
  assert.equal(engine.throwState.active, false);
  assert.ok(engine.cam.zoom > 1);
});

test('pinch zoom keeps the world point under the moving finger midpoint', t => {
  const {engine, pointer} = fixture(t);
  pointer('pointerdown', 100, 150, {pointerId: 1, pointerType: 'touch'});
  pointer('pointerdown', 200, 150, {pointerId: 2, pointerType: 'touch'});
  const before = screenToWorld(engine.cam, 150, 150, 800, 600);
  pointer('pointermove', 300, 150, {pointerId: 2, pointerType: 'touch'});
  const after = screenToWorld(engine.cam, 200, 150, 800, 600);
  close(after.x, before.x);
  close(after.y, before.y);
  close(engine.cam.zoom, 2);
});

test('predictions keep anchored sources fixed and selecting an anchor does not predict its release', t => {
  const {engine, pointer} = fixture(t);
  const anchor = engine.spawn(0, 0, 0, 0, 2200, 'star', true);
  engine.spawn(180, 0, 0, 150, 52);
  pointer('pointerdown', 400, 100);
  pointer('pointermove', 370, 100);
  engine.updateThrowPredict();
  assert.ok(engine.predictLen > 1);
  const anchoredGhost = engine.ghost.find(body => body.mass === anchor.mass);
  assert.deepEqual([anchoredGhost.x, anchoredGhost.y, anchoredGhost.vx, anchoredGhost.vy], [0, 0, 0, 0]);
  pointer('pointercancel', 370, 100);
  pointer('pointerdown');
  engine.updateThrowPredict();
  const selectedGhost = engine.ghost.at(-1);
  assert.equal(selectedGhost.pinned, true);
  assert.deepEqual([selectedGhost.x, selectedGhost.y], [0, 0]);
  pointer('pointermove', 360, 300);
  engine.updateThrowPredict();
  assert.equal(engine.ghost.at(-1).pinned, false);
});

test('clear, blur and Escape cancel active input without a delayed launch', t => {
  const {engine, pointer, win} = fixture(t);
  for (const cancel of [() => engine.clear(true), () => win.dispatchEvent(new Event('blur')), () => {
    win.dispatchEvent(Object.assign(new Event('keydown'), {code: 'Escape'}));
  }]) {
    pointer('pointerdown');
    pointer('pointermove', 300, 300);
    cancel();
    pointer('pointerup', 300, 300);
    assert.equal(engine.liveCount(), 0);
    assert.equal(engine.throwState.active, false);
  }
});

test('canvas and selection render in the same CSS coordinates as hit testing at DPR 2', t => {
  const {engine, ctx} = fixture(t);
  const body = engine.spawn(45, -35, 0, 0, 52);
  Object.assign(engine.cam, {x: 10, y: 5, zoom: 1.4, shakeX: 2, shakeY: -3});
  useOrbit.setState({selectedId: body.id});
  engine.tick(0, 0);
  const bodyArc = ctx.arcs.find(arc => arc.radius === body.radius);
  const selectedArc = ctx.arcs.find(arc => Math.abs(arc.radius - (body.radius + 5 / engine.cam.zoom)) < 1e-9);
  assert.ok(bodyArc && selectedArc);
  assert.deepEqual([bodyArc.x, bodyArc.y], [selectedArc.x, selectedArc.y]);
  const world = screenToWorld(engine.cam, bodyArc.x / 2, bodyArc.y / 2, 800, 600);
  close(world.x, body.x);
  close(world.y, body.y);
  close(bodyArc.scale, engine.cam.zoom * 2);
  assert.equal(engine.hitTest(world.x, world.y), body);
  assert.equal('__orbitTest' in window, false);
});

test('destroy removes listeners, scheduled frames, captured gestures and stale UI actions', t => {
  const {engine, pointer, frames, captures} = fixture(t);
  pointer('pointerdown');
  assert.equal(captures.size, 1);
  engine.destroy();
  pointer('pointerup', 300, 300);
  pointer('pointerdown');
  pointer('pointerup');
  useOrbit.getState().api.loadScenario('garden');
  assert.equal(engine.liveCount(), 0);
  assert.equal(frames.size, 0);
  assert.equal(captures.size, 0);
  assert.equal(useOrbit.getState().bodyCount, 0);
  assert.equal(useOrbit.getState().selectedId, null);
  assert.equal(useOrbit.getState().throwing, false);
});

test('audio destroy disconnects its output and closes its AudioContext once', t => {
  const {win} = fixture(t);
  let closes = 0;
  let disconnects = 0;
  win.AudioContext = class {
    state = 'running';
    destination = {};
    createGain() {return {gain: {value: 0}, connect() {}, disconnect() {disconnects++;}};}
    close() {closes++; this.state = 'closed'; return Promise.resolve();}
  };
  const audio = new SimAudio();
  audio.unlock();
  audio.destroy();
  audio.destroy();
  assert.equal(closes, 1);
  assert.equal(disconnects, 1);
});
