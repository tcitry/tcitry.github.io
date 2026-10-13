import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const bundle = await build({entryPoints: [new URL('../src/components/demos/cindy-orca-model.ts', import.meta.url).pathname], bundle: true, platform: 'node', format: 'esm', write: false});
const {evaluateCindyOrca, CINDY_DEFAULT, CINDY_SESSIONS} = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));

test('a terminal report can be done and accepted while it still waits in Lead queue', () => {
  const branch = evaluateCindyOrca();
  assert.equal(branch.workerStatus, 'done');
  assert.equal(branch.mode, 'queued');
  assert.equal(branch.cardPlace, 'queue');
  assert.equal(branch.queuedCount, 1);
  assert.equal(branch.pendingState, 'cleared');
  assert.equal(branch.leadReadReceipt, null);
  assert.equal(branch.leadValidation, null);
});

test('terminal rejection preserves retry state despite done; Lead receives no message', () => {
  const branch = evaluateCindyOrca({...CINDY_DEFAULT, delivery: 'rejected'});
  assert.equal(branch.workerStatus, 'done');
  assert.equal(branch.pendingState, 'retained');
  assert.equal(branch.retryAfterRejectedDelivery, true);
  assert.equal(branch.cardPlace, 'pending');
  assert.equal(branch.queuedCount, 0);
  assert.match(branch.order[0], /先写 Worker done/);
});

test('explicit rejection does not borrow terminal done or the terminal retry flag', () => {
  const branch = evaluateCindyOrca({lead: 'busy', delivery: 'rejected', report: 'explicit'});
  assert.equal(branch.workerStatus, 'running');
  assert.equal(branch.retryAfterRejectedDelivery, false);
  assert.equal(branch.pendingState, 'terminal-close');
  assert.match(branch.order[2], /不写 done/);
  assert.equal(branch.cardPlace, 'pending');
});

test('explicit queue acceptance requests done without promising atomic Map cleanup', () => {
  const branch = evaluateCindyOrca({...CINDY_DEFAULT, report: 'explicit'});
  assert.equal(branch.receipt, 'ok: true · queued: true');
  assert.equal(branch.workerStatus, 'done');
  assert.equal(branch.pendingState, 'terminal-close');
  assert.equal(branch.retryAfterRejectedDelivery, false);
  assert.match(branch.order[2], /请求写 done/);
});

test('an idle Lead changes routing to its input, not to a read or validation result', () => {
  for (const report of ['explicit', 'terminal']) {
    const branch = evaluateCindyOrca({lead: 'idle', delivery: 'accepted', report});
    assert.equal(branch.mode, 'dispatched');
    assert.equal(branch.cardPlace, 'input');
    assert.equal(branch.queuedCount, 0);
    assert.equal(branch.leadReadReceipt, null);
    assert.equal(branch.leadValidation, null);
  }
});

test('comparing conditions neither merges histories nor mutates the caller fixture', () => {
  const conditions = {...CINDY_DEFAULT};
  const baseline = JSON.stringify(CINDY_SESSIONS);
  for (const lead of ['busy', 'idle']) for (const delivery of ['accepted', 'rejected']) for (const report of ['terminal', 'explicit']) {
    const branch = evaluateCindyOrca({lead, delivery, report});
    assert.equal(branch.queuedCount === 1, branch.mode === 'queued');
    assert.equal(branch.cardPlace === 'pending', branch.mode === 'rejected');
  }
  evaluateCindyOrca(conditions).conditions.lead = 'idle';
  assert.deepEqual(conditions, CINDY_DEFAULT);
  assert.notEqual(CINDY_SESSIONS.lead.businessId, CINDY_SESSIONS.worker.businessId);
  assert.notEqual(CINDY_SESSIONS.lead.nativeId, CINDY_SESSIONS.worker.nativeId);
  assert.equal(JSON.stringify(CINDY_SESSIONS), baseline);
});
