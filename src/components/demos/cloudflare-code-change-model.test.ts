import test from 'node:test';
import assert from 'node:assert/strict';
import {INITIAL_SPLICE, prefixForSource, spliceText} from './cloudflare-code-change-model.ts';

// The 14 / [2,"25"] / 2 oracle was exercised against unchanged upstream applyCodeChange
// at ef34d8e. The teaching model deliberately does not import or emulate full CodeMirror OT.
test('the fixed replacement vector preserves every retained code unit', () => {
  const state = spliceText();
  assert.equal(state.source, 'const limit = 10;\n');
  assert.equal(state.output, 'const limit = 25;\n');
  assert.deepEqual(state.change, {7: [['server.js', {edit: [14, [2, '25'], 2]}]]});
  assert.equal(state.beforeLength, 18);
  assert.equal(state.output!.length, 18);
  assert.equal(state.deletedCells.map(cell => cell.char).join(''), '10');
  assert.deepEqual(state.sourceCells.filter(cell => cell.role === 'delete').map(cell => cell.index), [14, 15]);
  assert.equal(state.outputCells.map(cell => cell.char).join(''), state.output);
});

test('one and three inserted digits change after length, leaving the before contract intact', () => {
  for (const replacement of [1, 9, 10, 99, 100, 999]) {
    const state = spliceText({...INITIAL_SPLICE, replacement});
    assert.equal(state.expectedBeforeLength, 18);
    assert.equal(state.plannedAfterLength, 16 + String(replacement).length);
    assert.equal(state.output, `const limit = ${replacement};\n`);
    assert.equal(state.outputCells.filter(cell => cell.role === 'insert').length, String(replacement).length);
  }
});

test('an extra source space rejects the unchanged edit and never publishes a partial result', () => {
  const state = spliceText({...INITIAL_SPLICE, variant: 'extra-space'});
  assert.equal(state.source, 'const limit =  10;\n');
  assert.equal(state.beforeLength, 19);
  assert.equal(state.expectedBeforeLength, 18);
  assert.equal(state.valid, false);
  assert.equal(state.output, null);
  assert.deepEqual(state.outputCells, []);
  assert.deepEqual(state.deletedCells, []);
  assert.equal(state.uncovered, '\n');
  assert.equal(state.sourceCells.at(-1)!.role, 'uncovered');
});

test('regeneration targets the new prefix and retains its extra space', () => {
  const state = spliceText({...INITIAL_SPLICE, variant: 'extra-space', prefix: prefixForSource('extra-space'), replacement: 999});
  assert.deepEqual(state.edit, [15, [2, '999'], 2]);
  assert.equal(state.valid, true);
  assert.equal(state.expectedBeforeLength, 19);
  assert.equal(state.output, 'const limit =  999;\n');
  assert.equal(state.output!.length, 20);
  assert.equal(state.deleted, '10');
});
