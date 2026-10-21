import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';
import test from 'node:test';

const moduleUrl = text => `data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(text)).toString('base64')}`;
const model = await import(moduleUrl(await readFile(new URL('../src/components/demos/rakazo-effect-model.ts', import.meta.url), 'utf8')));
const {effectReplayView, replayGate, SAVED_REQUEST, SAVED_RESULT, uncertainResult} = model;
test('approval restores all saved fields instead of the new model recipient', () => {
  const next = effectReplayView('approved', 'other@example.test');
  assert.equal(next.changed, true);
  assert.equal(next.proposedRequest.to, 'other@example.test');
  assert.deepEqual(next.executionPayload, SAVED_REQUEST);
  assert.notEqual(next.executionPayload, SAVED_REQUEST, 'view never exposes a writable archive reference');
  assert.equal(next.toolCalls, 1);
  assert.equal(effectReplayView('approved', SAVED_REQUEST.to).changed, false);
});
test('completed returns its saved receipt without an executable payload', () => {
  const next = effectReplayView('completed', 'other@example.test');
  assert.equal(next.executionPayload, null);
  assert.deepEqual(next.returnedResult, SAVED_RESULT);
  assert.equal(next.toolCalls, 0);
  assert.deepEqual(replayGate({status: 'completed', result: null}), {action: 'return', result: {duplicate: true}});
  assert.deepEqual(replayGate({status: 'completed', result: false}), {action: 'return', result: false});
});
test('denied never reopens approval and intended remains paused on duplicate replay', () => {
  const denied = effectReplayView('denied', 'other@example.test');
  assert.match(denied.returnedResult.error, /user denied/);
  assert.deepEqual(effectReplayView('intended', SAVED_REQUEST.to).gate, {action: 'paused'});
  for (const status of ['denied', 'intended']) assert.equal(effectReplayView(status, 'other@example.test').executionPayload, null);
});
test('interrupted execution and an already uncertain effect do not repeat the write', () => {
  const interrupted = effectReplayView('executing', 'other@example.test');
  assert.deepEqual(interrupted.gate, {action: 'uncertain', toolName: 'send_email'});
  for (const status of ['executing', 'uncertain']) {
    const view = effectReplayView(status, 'other@example.test');
    assert.equal(view.toolCalls, 0);
    assert.equal(view.executionPayload, null);
    assert.equal(view.returnedResult.uncertain, true);
  }
  assert.deepEqual(replayGate({status: 'uncertain', result: {custom: 'saved'}}), {action: 'return', result: {custom: 'saved'}});
  assert.equal(replayGate({status: 'unexpected'}).action, 'uncertain');
});
// Optional real-source oracle: no dependency or upstream code is vendored.
// RAKAZO_SOURCE_DIR=<checkout> node --test tests/rakazo-effect-model.test.mjs
test('matches the upstream duplicate-effect gate and plain direct approval restoration', {skip: !process.env.RAKAZO_SOURCE_DIR}, async () => {
  const source = await readFile(`${process.env.RAKAZO_SOURCE_DIR}/packages/adapters/src/approval-effect.ts`, 'utf8');
  const gateSource = source.slice(source.indexOf('export function resolveDuplicateEffectGate('), source.indexOf('export type UncertainEffectResult'));
  const argsSource = source.slice(source.indexOf('export function approvedReplayArgs('), source.indexOf('export const DIRECT_APPROVAL_TAG'));
  assert.ok(gateSource.startsWith('export function'));
  const upstream = await import(moduleUrl(`const uncertainEffectResult = ${uncertainResult.toString()}; const catalogApprovalDetails = () => undefined; const boundDirectApprovalDetails = () => undefined;\n${gateSource}\n${argsSource}`));
  for (const status of [...model.EFFECT_STATUSES, 'unknown']) for (const result of [undefined, null, false, {receipt: 'saved'}]) {
    const effect = {status, result};
    assert.deepEqual(replayGate(effect), upstream.resolveDuplicateEffectGate(effect, 'send_email'), `${status}/${JSON.stringify(result)}`);
  }
  const proposed = {...SAVED_REQUEST, to: 'other@example.test'};
  const restored = upstream.approvedReplayArgs(SAVED_REQUEST, proposed, 'fixture-marker');
  assert.deepEqual(effectReplayView('approved', proposed.to).executionPayload, restored);
});
