import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';

const bundle = await build({entryPoints: [new URL('../src/components/demos/cindy-orca-model.ts', import.meta.url).pathname], bundle: true, platform: 'node', format: 'esm', write: false});
const {createCindyOrca, actCindyOrca, tickCindyOrca, canSummarizeCindy} = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const accepted = () => tickCindyOrca(actCindyOrca(createCindyOrca(), {type: 'dispatch'}), 1);
function prepared() {
  let state = accepted();
  for (const worker of ['A', 'B']) {
    state = actCindyOrca(state, {type: 'advance', worker});
    state = actCindyOrca(state, {type: 'advance', worker});
    if (worker === 'B') state = actCindyOrca(state, {type: 'confirm', worker});
    state = actCindyOrca(state, {type: 'advance', worker});
  }
  return state;
}

test('creation has distinct contexts and histories, and does not start work', () => {
  const state = createCindyOrca();
  assert.notEqual(state.workers[0].session, state.workers[1].session);
  assert.notEqual(state.workers[0].history, state.workers[1].history);
  assert.notEqual(state.workers[0].context, state.workers[1].context);
  assert.ok(state.workers.every(worker => worker.status === 'idle'));
  assert.equal(canSummarizeCindy(state), false);
});

test('a dispatched task starts only at the accepted boundary; reduced motion preserves it', () => {
  const sending = actCindyOrca(createCindyOrca(), {type: 'dispatch'});
  const moving = tickCindyOrca(sending, 0.2);
  assert.ok(moving.workers.every(worker => worker.status === 'idle' && worker.transfer > 0 && worker.transfer < 1));
  const completed = tickCindyOrca(moving, 1);
  const still = tickCindyOrca(sending, 0, true);
  assert.ok(completed.workers.every(worker => worker.status === 'running'));
  assert.deepEqual(still, completed);
  assert.equal(sending.workers[0].history.length, 1, 'tick must leave earlier states intact');
});

test('Worker B waiting cannot advance or silently advance Worker A', () => {
  let state = accepted();
  state = actCindyOrca(state, {type: 'advance', worker: 'B'});
  state = actCindyOrca(state, {type: 'advance', worker: 'B'});
  assert.equal(state.workers[1].phase, 'waiting');
  assert.equal(state.workers[1].status, 'running', 'waiting is a session condition, not an invented persisted Worker status');
  assert.equal(state.workers[0].step, 0);
  assert.equal(state.workers[0].history.length, 2);
  assert.equal(actCindyOrca(state, {type: 'advance', worker: 'B'}), state);
  state = actCindyOrca(state, {type: 'confirm', worker: 'B'});
  assert.equal(actCindyOrca(state, {type: 'advance', worker: 'B'}).workers[1].phase, 'ready');
});

test('failure produces no successful report; retry retains that Worker history', () => {
  const state = actCindyOrca(accepted(), {type: 'fail', worker: 'B'});
  assert.equal(state.workers[1].status, 'error');
  assert.equal(state.workers[1].result, null);
  assert.equal(actCindyOrca(state, {type: 'report', worker: 'B'}), state);
  assert.equal(canSummarizeCindy(state), false);
  const resumed = tickCindyOrca(actCindyOrca(state, {type: 'retry', worker: 'B'}), 1);
  assert.ok(resumed.workers[1].history.includes('教学故障：执行中断，未取得可用成果。'));
  assert.deepEqual(resumed.workers[0], state.workers[0]);
});

test('a finished local artifact and a report in transit are insufficient to summarize', () => {
  let state = prepared();
  assert.equal(canSummarizeCindy(state), false);
  assert.equal(actCindyOrca(state, {type: 'summarize'}), state);
  state = actCindyOrca(state, {type: 'report', worker: 'A'});
  assert.equal(canSummarizeCindy(state), false);
  state = tickCindyOrca(state, 1);
  assert.equal(state.workers[0].status, 'done');
  assert.equal(state.summary, null, 'done must not claim Lead validation');
  assert.equal(canSummarizeCindy(state), false, 'the second report is still missing');
});

test('only two accepted reports enable explicit Lead checking, and duplicate reports are ignored', () => {
  let state = prepared();
  for (const worker of ['A', 'B']) state = tickCindyOrca(actCindyOrca(state, {type: 'report', worker}), 1);
  assert.equal(canSummarizeCindy(state), true);
  assert.equal(state.leadHistory.filter(line => line.startsWith('收到 Worker')).length, 2);
  assert.equal(actCindyOrca(state, {type: 'report', worker: 'A'}), state);
  const checked = actCindyOrca(state, {type: 'summarize'});
  assert.ok(checked.summary);
  assert.equal(actCindyOrca(checked, {type: 'summarize'}), checked);
});
