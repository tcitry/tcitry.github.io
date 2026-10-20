import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';
import {pathToFileURL} from 'node:url';
import {DEFAULT_MEMORY_INPUT, evaluateMemoryWindow, fuseMemorySignals} from '../src/components/demos/ruflo-memory-window-model.ts';

// Optional craft check: use the project's MIT skill engine without publishing
// its implementation or a machine-specific skill path in the site repository.
test('actual slab shapes and committed painter keys stay valid along the rails', {skip: !process.env.ANATOMY_SKILL_DIR}, async () => {
  const A = await import(pathToFileURL(`${process.env.ANATOMY_SKILL_DIR}/kit/audit.mjs`));
  const asModule = source => `data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source)).toString('base64')}`;
  const kit = asModule(await readFile(new URL('../src/components/demos/anatomy-iso-kit.ts', import.meta.url), 'utf8'));
  const source = await readFile(new URL('../src/components/demos/ruflo-memory-window-geometry.ts', import.meta.url), 'utf8');
  const G = await import(asModule(source.replaceAll("'./anatomy-iso-kit'", JSON.stringify(kit))));
  const R = A.recorder(G.PROJECTION);
  for (const part of G.PARTS) {
    const {plan, z, height} = part.shape;
    R.put({name: part.name, at: [plan.x + plan.w / 2, plan.y + plan.d / 2, z + height / 2], move: part.motion ? [G.TRAVEL, 0, 0] : [0, 0, 0],
      shapes: [R.solid(A.slab(plan, z, height, {name: part.name, ground: part.name.startsWith('foot-')}))], svg: `<path d="${part.paths.outline}"/>`});
  }
  A.settle(R, G.PROJECTION, {states: [0, 0.25, 0.5, 0.75, 1]});
  for (const item of R.items) item.key = G.DEPTH_KEYS[item.name];
  const report = A.audit(R, G.PROJECTION, {frames: [0.25, 0.5, 0.75], apart: true});
  assert.equal(A.failures(report), 0, A.report(report));
});

const row = (state, id) => state.candidateRecords.find(record => record.id === id);

test('article fixture A/B/C uses current upstream default and excludes old C before scoring', () => {
  const state = evaluateMemoryWindow(DEFAULT_MEMORY_INPUT);
  assert.equal(state.query, 'token login');
  assert.equal(state.threshold, 0.2);
  assert.deepEqual(state.results.map(record => record.id), ['A', 'B']);
  assert.equal(row(state, 'A').score, 0.72);
  assert.equal(row(state, 'A').coverage, 0);
  assert.equal(row(state, 'B').score, 0.46);
  assert.equal(row(state, 'B').coverage, 1);
  assert.equal(row(state, 'B').bm25Normalized, 1);
  assert.equal(state.reason, 'window');
  for (const key of ['semantic', 'keyword', 'coverage', 'lexical', 'blendedScore', 'score']) {
    assert.equal(state[key], null);
  }
});

test('rank 1000 includes C and ranks by relevance; rank 1001 never scores it', () => {
  const inside = evaluateMemoryWindow({...DEFAULT_MEMORY_INPUT, position: 1000});
  const outside = evaluateMemoryWindow({...DEFAULT_MEMORY_INPUT, position: 1001});
  assert.deepEqual(inside.results.map(record => record.id), ['C', 'A', 'B']);
  assert.equal(inside.score, 0.95);
  assert.equal(inside.targetText, 'authorization session credentials');
  assert.equal(inside.coverage, 0);
  assert.equal(inside.resultRank, 1);
  assert.equal(outside.score, null);
  assert.equal(outside.recalled, false);
  for (const result of [inside, outside]) {
    assert.equal(row(result, 'A').rank, 1);
    assert.equal(row(result, 'B').rank, 2);
  }
});

test('C relevance is independent of its fixed text and cannot rescue a window miss', () => {
  for (const relevance of [0, 0.19, 0.2, 0.5, 1]) {
    const outside = evaluateMemoryWindow({...DEFAULT_MEMORY_INPUT, relevance});
    assert.equal(outside.score, null);
    assert.equal(outside.reason, 'window');
    const inside = evaluateMemoryWindow({...DEFAULT_MEMORY_INPUT, position: 999, relevance});
    assert.equal(inside.coverage, 0);
    assert.equal(inside.bm25Normalized, 0);
    assert.equal(inside.score, relevance);
    assert.equal(inside.passed, relevance >= 0.2);
  }
});

test('without embeddings only exact-keyword B is recalled, then threshold 0.41 empties the results', () => {
  const input = {...DEFAULT_MEMORY_INPUT, position: 999, hasEmbedding: false};
  const state = evaluateMemoryWindow(input);
  assert.deepEqual(state.results.map(record => record.id), ['B']);
  assert.equal(row(state, 'A').score, 0);
  assert.equal(row(state, 'B').score, 0.4);
  assert.equal(row(state, 'C').score, 0);
  assert.equal(state.reason, 'threshold');
  assert.deepEqual(evaluateMemoryWindow({...input, threshold: 0.41}).results, []);
  assert.equal(evaluateMemoryWindow({...input, threshold: 0.4}).results[0].id, 'B');
});

test('namespace selection runs before the rank window and prevents scoring C', () => {
  const result = evaluateMemoryWindow({...DEFAULT_MEMORY_INPUT, position: 3, namespaceMatch: false});
  assert.equal(result.inNamespace, false);
  assert.equal(result.inWindow, false);
  assert.equal(result.reason, 'namespace');
  assert.equal(result.namespaceSize, 1099);
  assert.equal(result.windowSize, 1000);
  assert.equal(result.score, null);
  assert.deepEqual(result.results.map(record => record.id), ['A', 'B']);
});

test('fusion preserves semantic recall and gives full keyword coverage its floor', () => {
  assert.equal(fuseMemorySignals(0.72, 0, 0).score, 0.72);
  assert.equal(fuseMemorySignals(0.1, 0.001, 1).score, 0.46);
  assert.equal(fuseMemorySignals(-0.5, 0.001, 1).score, 0.4);
});

test('threshold zero really admits background rows but still applies the top-10 limit', () => {
  const state = evaluateMemoryWindow({...DEFAULT_MEMORY_INPUT, position: 1000, threshold: 0, hasEmbedding: false});
  assert.equal(state.eligibleCount, 1000);
  assert.equal(state.results.length, 10);
  assert.equal(state.results[0].id, 'B');
  assert.equal(state.passed, true);
  assert.equal(state.recalled, false);
  assert.equal(state.reason, 'limit');
  assert.equal(state.resultRank, 1000);
});
