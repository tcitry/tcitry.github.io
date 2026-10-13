import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createDigestMachine, projectDigest, commitDigestFields, readDigest,
  removeDigest, rebuildDigest, receiptIsStale, INITIAL_UPDATED_AT,
} from '../src/components/demos/clawhub-digest-model.ts';

test('same anonymous Query reuses its dependency version, while different args evaluate separately', () => {
  let state = readDigest(createDigestMachine());
  state = readDigest(state);
  assert.equal(state.queryRuns, 1);
  assert.equal(state.cacheHits, 1);
  assert.equal(state.receipt.result.displayName, 'Alpha');
  state = readDigest(state, 'listPublicPageV4:{sort:"name",numItems:1}:anonymous');
  assert.equal(state.queryRuns, 2);
  assert.equal(state.cacheHits, 1);
});

test('repeated projection skips writes and preserves the Query dependency revision', () => {
  let state = readDigest(createDigestMachine());
  state = projectDigest(projectDigest(state));
  assert.equal(state.writes, 0);
  assert.equal(state.skippedWrites, 2);
  assert.equal(state.revision, 0);
  state = readDigest(state);
  assert.equal(state.queryRuns, 1);
  assert.equal(state.cacheHits, 1);
});

test('an atomic field update refreshes digest but preserves the already delivered one-shot result', () => {
  const old = readDigest(createDigestMachine());
  let state = commitDigestFields(old, 'Beta', 20);
  assert.equal(state.source.displayName, 'Beta');
  assert.equal(state.digest.displayName, 'Beta');
  assert.equal(state.digest.downloads, 20);
  assert.equal(state.writes, 1);
  assert.equal(state.revision, 1);
  assert.equal(state.receipt.result.displayName, 'Alpha');
  assert.equal(receiptIsStale(state), true);
  assert.equal(old.source.displayName, 'Alpha');
  state = readDigest(state);
  assert.equal(state.receipt.result.displayName, 'Beta');
  assert.equal(state.queryRuns, 2);
  assert.equal(receiptIsStale(state), false);
});

test('restoring an earlier name is a real write and does not revive an invalid dependency', () => {
  let state = readDigest(createDigestMachine());
  state = commitDigestFields(state, 'Beta', 10);
  state = readDigest(state);
  state = commitDigestFields(state, 'Alpha', 10);
  assert.equal(state.revision, 2);
  assert.equal(state.writes, 2);
  assert.equal(state.digest.updatedAt, INITIAL_UPDATED_AT + 120_000);
  state = readDigest(state);
  assert.equal(state.queryRuns, 3);
  assert.equal(state.cacheHits, 0);
});

test('deleting the persistent digest removes the list item until an explicit rebuild', () => {
  let state = readDigest(createDigestMachine());
  state = removeDigest(state);
  assert.equal(state.source.displayName, 'Alpha');
  assert.equal(state.digest, null);
  assert.equal(state.receipt.result.displayName, 'Alpha');
  state = readDigest(state);
  assert.equal(state.receipt.result, null);
  assert.equal(state.queryRuns, 2);
  state = rebuildDigest(state);
  assert.equal(state.digest.displayName, 'Alpha');
  assert.equal(state.writes, 1);
  assert.equal(state.operation, 'rebuild');
  state = readDigest(state);
  assert.equal(state.receipt.result.displayName, 'Alpha');
  assert.equal(state.queryRuns, 3);
});

test('updatedAt belongs to the projection even when visible title and counter are unchanged', () => {
  const initial = createDigestMachine();
  const state = projectDigest(initial, {...initial.source, updatedAt: INITIAL_UPDATED_AT + 1});
  assert.equal(state.writes, 1);
  assert.equal(state.revision, 1);
  assert.equal(state.digest.updatedAt, INITIAL_UPDATED_AT + 1);
  assert.equal(initial.digest.updatedAt, INITIAL_UPDATED_AT);
  assert.throws(() => commitDigestFields(state, 'Alpha', -1), RangeError);
});
