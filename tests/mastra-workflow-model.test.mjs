import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';
import test from 'node:test';

const source = await readFile(new URL('../src/components/demos/mastra-workflow-model.ts', import.meta.url), 'utf8');
const {initialWorkflowState, workflowReducer: reduce, workflowReadout} = await import(`data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source)).toString('base64')}`);

test('suspend saves completed normalize output and the approval input, before receipt', () => {
  const state = reduce(initialWorkflowState(180), {type: 'start'});
  assert.equal(state.status, 'suspended');
  assert.deepEqual(state.counts, {normalize: 1, approval: 1, receipt: 0});
  assert.deepEqual(state.snapshot.context.normalize.output, {amount: 180});
  assert.deepEqual(state.snapshot.context.approval.payload, {amount: 180});
  assert.deepEqual(state.snapshot.context.approval.suspendPayload, {amount: 180, reason: 'Amount exceeds automatic approval limit'});
  assert.equal(state.snapshot.context.approval.resumePayload, undefined);
  assert.equal(state.snapshot.context.approval.output, undefined);
  assert.equal(state.snapshot.context.receipt, undefined);
});
test('resume combines the saved input with new data, ignoring a changed pending amount', () => {
  const paused = reduce(initialWorkflowState(180), {type: 'start'});
  const changed = reduce(paused, {type: 'amount', amount: 60});
  assert.equal(changed.snapshot, paused.snapshot);
  const resumed = reduce(changed, {type: 'resume', approved: true});
  assert.equal(resumed.status, 'success');
  assert.equal(resumed.draftAmount, 60);
  assert.deepEqual(resumed.counts, {normalize: 1, approval: 2, receipt: 1});
  assert.deepEqual(resumed.snapshot.context.approval.output, {amount: 180, decision: 'approved'});
  assert.deepEqual(resumed.snapshot.context.receipt.output, {amount: 180, decision: 'approved', receipt: 'approved:180.00'});
  assert.equal(paused.snapshot.context.approval.output, undefined, 'prior snapshot remains immutable');
  assert.equal(workflowReadout(resumed).draftDiffers, true);
  assert.equal(workflowReadout(resumed).displayedAmount, 180);
});
test('a false decision completes the workflow with a rejected business result', () => {
  const paused = reduce(initialWorkflowState(180), {type: 'start'});
  const resumed = reduce(paused, {type: 'resume', approved: false});
  assert.equal(resumed.status, 'success');
  assert.deepEqual(resumed.snapshot.context.approval.resumePayload, {approved: false});
  assert.deepEqual(resumed.snapshot.context.approval.output, {amount: 180, decision: 'rejected'});
  assert.deepEqual(resumed.snapshot.context.receipt.output, {amount: 180, decision: 'rejected', receipt: 'rejected:180.00'});
  assert.equal(resumed.snapshot.context.approval.suspendPayload, undefined, 'suspension payload is cleared on completion');
  assert.deepEqual(resumed.snapshot.suspendedPaths, {});
  assert.deepEqual(resumed.snapshot.context.receipt.payload, resumed.snapshot.context.approval.output);
  assert.deepEqual(resumed.counts, {normalize: 1, approval: 2, receipt: 1});
});
test('normalize rounds cents like the executed Mastra fixture before saving the approval input', () => {
  const paused = reduce(initialWorkflowState(150.125), {type: 'start'});
  assert.deepEqual(paused.snapshot.context.input, {amount: 150.125});
  assert.deepEqual(paused.snapshot.context.normalize.payload, {amount: 150.125});
  assert.deepEqual(paused.snapshot.context.normalize.output, {amount: 150.13});
  assert.deepEqual(paused.snapshot.context.approval.payload, {amount: 150.13});
  const resumed = reduce(paused, {type: 'resume', approved: false});
  assert.deepEqual(resumed.snapshot.context.receipt.output, {amount: 150.13, decision: 'rejected', receipt: 'rejected:150.13'});
});
test('the threshold is exclusive and automatic approval needs no resume data', () => {
  for (const amount of [10, 60, 100]) {
    const state = reduce(initialWorkflowState(amount), {type: 'start'});
    assert.equal(state.status, 'success');
    assert.deepEqual(state.counts, {normalize: 1, approval: 1, receipt: 1});
    assert.deepEqual(state.snapshot.context.approval.output, {amount, decision: 'automatic'});
    assert.equal(state.snapshot.context.approval.suspendPayload, undefined);
    assert.equal(state.snapshot.context.approval.resumePayload, undefined);
  }
  assert.equal(reduce(initialWorkflowState(101), {type: 'start'}).status, 'suspended');
});
test('extra starts and resumes cannot overwrite a pending run or execute steps again', () => {
  const fresh = initialWorkflowState(180);
  assert.equal(reduce(fresh, {type: 'resume', approved: true}), fresh);
  const paused = reduce(fresh, {type: 'start'});
  assert.equal(reduce(paused, {type: 'start'}), paused);
  const done = reduce(paused, {type: 'resume', approved: true});
  assert.equal(reduce(done, {type: 'resume', approved: false}), done);
  const reset = reduce(reduce(done, {type: 'amount', amount: 60}), {type: 'reset'});
  assert.deepEqual(reset, initialWorkflowState(60));
  assert.equal(reduce(reset, {type: 'start'}).snapshot.context.receipt.output.amount, 60);
});
test('invalid UI inputs are clamped before deriving the amount fraction', () => {
  for (const amount of [NaN, Infinity, -10, 999]) {
    const state = initialWorkflowState(amount);
    const readout = workflowReadout(state);
    assert.ok(state.draftAmount >= 0 && state.draftAmount <= 300);
    assert.ok(Number.isFinite(readout.amountFraction));
  }
});
