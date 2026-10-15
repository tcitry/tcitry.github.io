import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_INPUT, DIRECTIONS, directionPool, drawDirections, nextRandom, SECTORS, TONES} from './taste-direction-model.ts';

// Oracle: executed upstream draw.mjs --options 3 at f624f37, with an empty history.
test('seed 42 reproduces upstream options, integers and changing pool indexes', () => {
  const state = drawDirections(42);
  assert.deepEqual(state.rounds.map(r => r.chosen.id), ['editorial-report', 'quiet-instrument', 'dense-tiles']);
  assert.deepEqual(state.rounds.map(r => r.unsigned), [2581720956, 1925393290, 3661312704]);
  assert.deepEqual(state.rounds.map(r => r.index), [6, 4, 7]);
  assert.deepEqual(state.rounds.map(r => r.before.length), [11, 10, 9]);
});

test('weak tone and photograph filters preserve the previous pool at upstream thresholds', () => {
  const input = {sector: 'ecommerce', tone: 'technical', have: [], avoid: []};
  const {pool, stages} = directionPool(input);
  assert.deepEqual(pool.map(d => d.id), ['pinned-poster', 'page-is-the-object', 'contact-sheet', 'split-stage']);
  assert.equal(stages.find(s => s.key === 'pictures')!.applied, false); // only two plain choices
  assert.equal(stages.find(s => s.key === 'tone')!.applied, false); // only one technical choice
  assert.deepEqual(drawDirections(42, input).rounds.map(r => r.chosen.id), ['contact-sheet', 'page-is-the-object', 'split-stage']);
  const photo = {...input, tone: 'quiet', have: ['product-photo']};
  assert.deepEqual(drawDirections(42, photo).rounds.map(r => r.chosen.id), ['contact-sheet', 'hero-object', 'split-stage']);
});

test('empty history gives reproducible unique directions and the pointer always falls inside the chosen interval', () => {
  for (const sector of SECTORS) for (const tone of [null, ...TONES]) for (const seed of [1, 42, 99]) {
    const input = {...DEFAULT_INPUT, sector, tone};
    const a = drawDirections(seed, input);const b = drawDirections(seed, input);
    assert.deepEqual(a, b);
    assert.equal(new Set(a.rounds.map(r => r.chosen.id)).size, a.rounds.length);
    for (const round of a.rounds) {
      const n = round.before.length;
      assert.ok(round.index / n <= round.random && round.random < (round.index + 1) / n);
      assert.equal(round.chosen, round.before[round.index]);
      assert.equal(round.after.includes(round.chosen), false);
      assert.equal(round.after.length, n - 1);
    }
  }
});

test('PRNG seed truncation and fallback match the upstream numeric and empty-pool rules', () => {
  assert.deepEqual(nextRandom(42), nextRandom(42 + 2 ** 32));
  assert.equal(nextRandom(-1).unsigned, 3850105811);
  assert.notDeepEqual(drawDirections(42).rounds.map(r => r.chosen.id), drawDirections(43).rounds.map(r => r.chosen.id));
  const avoid = DIRECTIONS.filter(d => d.sectors.includes('saas')).map(d => d.id);
  const state = directionPool({...DEFAULT_INPUT, avoid});
  assert.equal(state.stages.at(-1)!.applied, true);
  assert.ok(state.pool.length);
  assert.ok(state.pool.every(d => !avoid.includes(d.id)));
});
