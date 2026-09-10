import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';

const bundle = await build({entryPoints: ['src/components/demos/lieflat-trend-data.ts'], bundle: true, platform: 'node', format: 'esm', write: false});
const {makeLineData, makeDumbbellData} = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));

test('line keeps fourteen true daily values, isolated eighth-day changes, and zero days', () => {
  const initial = makeLineData(12, 1, 12), withoutSpike = makeLineData(12, 1, 0);
  assert.equal(initial.values.length, 14);
  assert.equal(initial.first, 12); assert.equal(initial.last, 25);
  assert.equal(initial.values[7], 31);
  assert.deepEqual(initial.values.filter((_, i) => i !== 7), withoutSpike.values.filter((_, i) => i !== 7));
  assert.ok(initial.highlighted.every((day, i, all) => i === 0 || Math.abs(day - all[i - 1]) >= 4));
  const empty = makeLineData(0, 0, 0);
  assert.deepEqual(empty.values, Array(14).fill(0));
  assert.deepEqual(empty.highlighted, []);
  assert.ok(empty.scale > 0);
  assert.ok(makeLineData(20, -2, 0).values.every(value => value >= 0));
  assert.throws(() => makeLineData(18.5, 1, 0));
});

test('dumbbell beads represent the absolute signed change including regressions and equality', () => {
  assert.deepEqual(makeDumbbellData([7, 10, 16]).map(row => row.saved), [5, 8, 8]);
  const slower = makeDumbbellData([20, 26, 32]);
  assert.deepEqual(slower.map(row => row.saved), [-8, -8, -8]);
  assert.deepEqual(slower.map(row => row.beads), [8, 8, 8]);
  assert.ok(makeDumbbellData([12, 18, 24]).every(row => row.beads === 0));
  assert.deepEqual(makeDumbbellData([0, 0, 0]).map(row => row.beads), [12, 18, 24]);
  assert.throws(() => makeDumbbellData([-1, 0, 0]));
});
