import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';
import test from 'node:test';
import {pathToFileURL} from 'node:url';

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
test('Figure records 40–80 true solids and every pose stays in its viewport', async () => {
  const kitUrl = moduleUrl(await readFile(new URL('../src/components/demos/anatomy-iso-kit.ts', import.meta.url), 'utf8'));
  const kit = await import(kitUrl);
  const source = await readFile(new URL('../src/components/demos/rakazo-effect-geometry.ts', import.meta.url), 'utf8');
  const geometry = await import(moduleUrl(source.replaceAll("'./anatomy-iso-kit'", JSON.stringify(kitUrl))));
  assert.ok(geometry.PART_COUNT >= 40 && geometry.PART_COUNT <= 80);
  assert.equal(new Set(geometry.PARTS.map(part => part.name)).size, geometry.PART_COUNT);
  for (const part of geometry.PARTS) {
    assert.ok(part.purpose.length > 10);
    for (const zOffset of part.moving ? [0, 15.5, 31] : [0]) {
      for (const point of kit.boxCorners(part.plan, part.z + zOffset, part.z + part.height + zOffset)) {
        const [x, y] = kit.iso(point, geometry.PROJECTION);
        assert.ok(x > 0 && x < geometry.WIDTH && y > 0 && y < geometry.HEIGHT, `${part.name}: ${x},${y}`);
      }
    }
    for (const field of ['fill', 'top', 'outline']) assert.ok(!/NaN|Infinity/.test(part.paths[field]), part.name);
  }
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

// Optional crafting audit, using the MIT skill rather than copying its audit engine.
test('actual painter keys, supports and moving gate have no geometry conflicts', {skip: !process.env.ANATOMY_SKILL_DIR}, async () => {
  const A = await import(pathToFileURL(`${process.env.ANATOMY_SKILL_DIR}/kit/audit.mjs`));
  const kitUrl = moduleUrl(await readFile(new URL('../src/components/demos/anatomy-iso-kit.ts', import.meta.url), 'utf8'));
  const source = await readFile(new URL('../src/components/demos/rakazo-effect-geometry.ts', import.meta.url), 'utf8');
  const geometry = await import(moduleUrl(source.replaceAll("'./anatomy-iso-kit'", JSON.stringify(kitUrl))));
  const R = A.recorder(geometry.PROJECTION);
  for (const part of geometry.PARTS) R.put({at: part.center, name: part.name, move: part.moving ? [0, 0, 31] : [0, 0, 0],
    shapes: [R.solid(A.slab(part.plan, part.z, part.height, {name: part.name, ground: part.name.startsWith('foot-')}))],
    svg: `<path d="${part.paths.outline}"/>`,
  });
  A.settle(R, geometry.PROJECTION, {states: [0, 0.25, 0.5, 0.75, 1]});
  // Verify the committed keys used by the actual drawing, not newly corrected ones.
  for (const item of R.items) item.key = geometry.DEPTH_KEYS[item.name];
  const report = A.audit(R, geometry.PROJECTION, {frames: [0.25, 0.5, 0.75], apart: true});
  assert.equal(A.failures(report), 0, A.report(report));
});
